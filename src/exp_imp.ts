/*
   Copyright 2026 DGFiP / DTNum / Fabrique Numérique

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
import {openZip, ZipRandomAccessReader, ZipWriter} from "web-jszipp";

function getOrInsert<K, V>(map: Map<K, V>, key: K, value: V): V {
    if (map.has(key)) {
        return map.get(key)!;
    } else {
        map.set(key, value);
        return value;
    }
}

type GristColInfo = {
    colType: string
    isFormula: boolean
    hasTriggerFormula: boolean
};

type GristListValue = [string, ...number[]];
type GristListValueOrNull = GristListValue | null;

type ExpImpMeta = {
    TemplateId: string
    Version: string
    [key: string]: grist.CellValue
}

type ExpImpAttachmentData = {
    name: string
    type: string
    bytes: any
}

type ExpImpImportOptions = {
    ignoreMeta: boolean
    ignoreExtraTables: boolean
    ignoreMissingCols: boolean
    ignoreFormulas: boolean
}

type ExpImpUserParameters = {
    exportId?: string
    importId?: string
    output?: Output
    getArchiveName?: () => string
    before?: (docApi: grist.GristDocAPI) => Promise<void>
    prepareArchive?: (archive: Archive, meta: ExpImpMeta, output: Output) => Promise<void>
    after?: (docApi: grist.GristDocAPI) => Promise<void>
    importErr?: (error: any, parameters: ExpImpParameters) => void,
    importOptions?: Partial<ExpImpImportOptions>
    locale: string
}

type ExpImpParameters = {
    exportId: string
    importId: string
    output: Output
    getArchiveName: () => string
    before: (docApi: grist.GristDocAPI) => Promise<void>
    prepareArchive: (archive: Archive, meta: ExpImpMeta, output: Output) => Promise<void>
    after: (docApi: grist.GristDocAPI) => Promise<void>
    importErr: (error: any, parameters: ExpImpParameters) => void,
    importOptions: ExpImpImportOptions
    translate: (key: string, vars?: any) => string;
}

const META_TABLE = "Meta";
const COL_VERSION = "Version";
const COL_TEMPLATE_ID = "TemplateId";

interface Output {
    begin(title: string, info?: string): void

    next(info: string): void

    err(err: unknown): void

    end(): void;
}

class ConsoleOutput implements Output {
    begin(title: string, info?: string) {
        console.info("> begin output");
        console.info(`title: ${title}`);
        if (info !== undefined) {
            this.next(info);
        }
    }

    next(info: string) {
        if (info !== undefined) {
            console.info(`* info: ${info}`);
        }
    }

    err(err: unknown) {
        if (err !== undefined) {
            console.error("> err: ${err}`")
        }
    }

    end() {
        console.info("> end output");
    }
}

class ArchiveCreator {
    docApi: grist.GristDocAPI;
    parameters: ExpImpParameters;

    constructor(docApi: grist.GristDocAPI, parameters: ExpImpParameters) {
        /*
         * @param {Object} docApi - the grist doc API
         */
        this.docApi = docApi;
        this.parameters = parameters;
    }

    async create(): Promise<Blob> {
        /*
         * Create the exporter
         *
         * @param {Object} docApi - the grist doc API
         */
        const output = this.parameters.output;
        const t = this.parameters.translate;
        console.info("GrEI: Creating archive...");
        const writer = new ZipWriter({outputAs: "blob"});

        output.next(t("Add tables"));
        await this.#addTables(writer);
        output.next(t("Add attachments"));
        await this.#addAttachments(writer);
        output.next(t("Write ZIP"));
        return await writer.close();
    }

    async #addTables(writer: ZipWriter<"blob">) {
        /*
         * Add tables to zip
         *
         * @param {Object} writer - the zip writer
         */
        const tablesIds = await this.docApi.listTables();
        for (const tableId of tablesIds) {
            await writer.add({
                path: `table/${tableId}.json`,
                data: JSON.stringify(await this.docApi.fetchTable(tableId))
            });
        }
        console.info(`GrEI: Tables added: ${tablesIds}`);
    }

    async #addAttachments(writer: ZipWriter<"blob">) {
        /*
         * Add attachments to zip
         *
         * @param {Object} writer - the zip writer
         */
        const colsIdsByTableId = await this.#findColsIdsByTableId();
        const attachmentNameById = await this.#findAttachmentNameById();

        const tokenInfo = await this.docApi.getAccessToken({readOnly: true});

        const addedAttachmentIds = new Set<number>();
        for (let [tableId, colsIds] of colsIdsByTableId) {
            const table = await this.docApi.fetchTable(tableId);
            for (const colId of colsIds) {
                let col = table[colId];
                for (let attachmentsIds of col) {
                    if (attachmentsIds === null || attachmentsIds === undefined) {
                        continue;
                    }
                    if (!Array.isArray(attachmentsIds)) {
                        console.error(`GrEI: Value ${attachmentsIds} is not an array`);
                        continue;
                    }

                    for (let attachmentId of (attachmentsIds as number[]).slice(1)) {
                        if (addedAttachmentIds.has(attachmentId)) {
                            continue;
                        }
                        let attachmentName = attachmentNameById.get(attachmentId);
                        const getURL = `${tokenInfo.baseUrl}/attachments/${attachmentId}/download?auth=${tokenInfo.token}`;
                        let response = await fetch(getURL);
                        if (!response.ok) {
                            console.error(`GrEI: can't get attanchement ${attachmentName}: ${response.statusText}`);
                            continue;
                        }

                        let blob = await response.blob();
                        let bytes = await blob.bytes();

                        let data = {
                            name: attachmentName,
                            type: blob.type,
                        };
                        let jsonStr = JSON.stringify(data);
                        console.info("GrEI: Export attachment", attachmentId, jsonStr);

                        await writer.add({
                            path: `attachment/${attachmentId}/meta.json`,
                            data: jsonStr,
                        });

                        await writer.add({
                            path: `attachment/${attachmentId}/${attachmentName}`,
                            data: bytes,
                        });
                        addedAttachmentIds.add(attachmentId);
                    }
                }
            }
        }
    }

    async #findColsIdsByTableId(): Promise<Map<string, string[]>> {
        /*
         * @returns {Map} tableId -> colsId
         */
        const colsIdsByTableId = new Map<string, string[]>();
        const gristColumns = await this.docApi.fetchTable("_grist_Tables_column");
        const gristTables = await this.docApi.fetchTable("_grist_Tables");
        gristColumns.parentId.forEach((parentId: grist.CellValue, index: number, _arr: grist.CellValue[]) => {
            if (gristColumns.type[index] === "Attachments") {
                const tableIndex = gristTables.id.findIndex((id: number) => id === (parentId as number));
                const tableId = gristTables.tableId[tableIndex];
                const colsIds = getOrInsert(colsIdsByTableId, tableId, []);
                colsIds.push(gristColumns.colId[index] as string);
            }
        });
        return colsIdsByTableId;
    }

    async #findAttachmentNameById(): Promise<Map<number, string>> {
        /*
         * @returns {Map} attachmentId -> attachment name
         */
        // TODO : take also timeUpload + new Date(timestamp);
        // The date info might be useful
        const attachmentNameById = new Map<number, string>();
        const gristAttachments = await this.docApi.fetchTable("_grist_Attachments");
        gristAttachments.id.forEach((id: number, index: number, _arr: number[]) => {
            attachmentNameById.set(id, gristAttachments.fileName[index] as string);
        });
        return attachmentNameById;
    }
}

class DefaultArchiveExporter {
    parameters: ExpImpParameters;

    constructor(parameters: ExpImpParameters) {
        this.parameters = parameters;
    }

    async exportArchive(zipContent: Blob) {
        const output = this.parameters.output;
        const t = this.parameters.translate;
        const suggestedName = this.getArchiveName();
        output.next(t("Export archive...", {name: suggestedName}));
        this.#download(zipContent, suggestedName);
    }

    getArchiveName(): string {
        let dateStr = new Date().toISOString();
        return `export_${dateStr}.zip`;
    }

    #download(zipContent: Blob, suggestedName: string) {
        /*
         * @param {Object} zipContent - the zip as blob
         * @returns {String} suggestedName -> the zip name
         */
        const url = URL.createObjectURL(zipContent);

        // begin horrible hack
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;

        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
        // end horrible hack
    }
}

function tableToMeta(meta: grist.TableData | undefined): ExpImpMeta {
    if (meta === undefined) {
        throw new Error("Meta table not found");
    }
    if (!(COL_TEMPLATE_ID in meta && COL_VERSION in meta)) {
        throw new Error("Meta table missing mandatory columns");
    }
    return Object.fromEntries(
        Object.entries(meta)
            .map(([key, values]) => [key, values[0]])
    ) as ExpImpMeta;
}

class Archive {
    tableById: Map<string, grist.TableData>;
    attachmentDataById: Map<number, ExpImpAttachmentData>;
    tablesIdsToOverwrite: Array<string>;

    constructor(tableById: Map<string, any>, attachmentDataById: Map<number, ExpImpAttachmentData>) {
        this.tableById = tableById;
        this.attachmentDataById = attachmentDataById;
        this.tablesIdsToOverwrite = [];
    }

    get Version(): string {
        return this.meta.Version;
    }

    get TemplateId(): string {
        return this.meta.TemplateId;
    }

    get meta(): ExpImpMeta {
        let meta = this.tableById.get(META_TABLE);
        return tableToMeta(meta);
    }

    get tablesIds(): IteratorObject<string> {
        return this.tableById.keys().filter((tableId) => tableId !== META_TABLE);
    }

    tableEntries(): IteratorObject<[string, grist.TableData]> {
        return this.tableById.entries().filter(([tableId, _table], _tableIdx) => tableId !== META_TABLE);
    }

    // begin user funcs
    filterRows(tableId: string, func: (row: grist.RowRecord) => boolean) {
        const table = this.tableById.get(tableId);
        if (table === undefined) {
            console.warn(`GrEI: Table ${tableId} not found`);
            return;
        }
        const rows = this.#tableToRows(table);
        const newRows = rows.filter((row) => func(row));
        const newTable = this.#rowsToTable(newRows);
        this.tableById.set(tableId, newTable);
    }

    mapRows(tableId: string, func: (row: grist.RowRecord) => grist.RowRecord) {
        const table = this.tableById.get(tableId);
        if (table === undefined) {
            console.warn(`GrEI: Table ${tableId} not found`);
            return;
        }
        const rows = this.#tableToRows(table);
        const newRows = rows.map((row) => func(row));
        const newTable = this.#rowsToTable(newRows);
        this.tableById.set(tableId, newTable);
    }

    renameCols(tableId: string, newNameByOldName: { [k: string]: string }) {
        const table = this.tableById.get(tableId);
        if (table === undefined) {
            console.warn(`GrEI: Table ${tableId} not found`);
            return;
        }

        const newTable: grist.TableData = {id: []};
        const keys = Object.keys(table);
        keys.forEach((key) => {
            let newKey = newNameByOldName[key];
            if (newKey === undefined) {
                newKey = key;
            }
            newTable[newKey] = table[key];
        });
        this.tableById.set(tableId, newTable);
    }

    removeCols(tableId: string, colNames: string[]) {
        const table = this.tableById.get(tableId);
        if (table === undefined) {
            console.warn(`GrEI: Table ${tableId} not found`);
            return;
        }

        const newTable: grist.TableData = {id: []};
        const keys = Object.keys(table);
        keys.forEach((key) => {
            if (!colNames.includes(key)) {
                newTable[key] = table[key];
            }
        });
        this.tableById.set(tableId, newTable);
    }

    renameTable(srcTableId: string, destTableId: string) {
        const table = this.tableById.get(srcTableId);
        if (table === undefined) {
            console.warn(`GrEI: Table ${srcTableId} not found`);
            return;
        }

        this.tableById.delete(srcTableId);
        this.tableById.set(destTableId, table);
    }

    removeTable(srcTableId: string) {
        this.tableById.delete(srcTableId);
    }

    duplicateTable(curTableId: string, newTableId: string) {
        const table = this.tableById.get(curTableId);
        if (table === undefined) {
            console.warn(`GrEI: Table ${curTableId} not found`);
            return;
        }

        this.tableById.set(newTableId, structuredClone(table));
    }

    forceOverwrite(...tablesIds: string[]) {
        this.tablesIdsToOverwrite.push(...tablesIds);
    }

    // end user funcs

    #tableToRows(table: grist.TableData): grist.RowRecord[] {
        let keys = Object.keys(table);
        const rows: grist.RowRecord[] = Array();
        table.id.forEach((_id: number, index: number, _arr: number[]) => {
            const row = Object.fromEntries(keys.map((k) => [k, table[k][index]]));
            rows.push(row as grist.RowRecord);
        });
        return rows;
    }

    #rowsToTable(rows: grist.RowRecord[]): grist.TableData {
        console.assert(rows.length > 0);
        const table: grist.TableData = {id: []};
        const keys = Object.keys(rows[0]);
        if (!("id" in keys)) {
            throw new Error(`key id not found in "${keys}"`);
        }
        keys.forEach((key) => {
            table[key] = [];
        });
        rows.forEach((row) => {
            keys.forEach((key) => {
                table[key].push(row[key]);
            });
        });
        return table
    }
}

class ArchiveReader {
    parameters: ExpImpParameters;

    constructor(parameters: ExpImpParameters) {
        this.parameters = parameters;
    }

    async readFromEvent(event: Event): Promise<Archive | null> {
        const output = this.parameters.output;
        const t = this.parameters.translate;

        console.log("GrEI: Read file...");

        const file = this.#getFile(event);
        if (file === null) {
            return null;
        }
        output.next(t("Open file", {name: file.name}));

        try {
            const zip = await openZip(file, {
                pathMode: "strict-package",
                maxArchiveSize: 50 * 1024 * 1024,
                maxEntrySize: 10 * 1024 * 1024
            });
            return await this.readZip(zip);
        } catch (error) {
            this.parameters.importErr(error, this.parameters);
            return null;
        }
    }

    #getFile(event: Event): File | null {
        /*
         * @param {Object} event - the event from input
         * @returns the file name
         */
        const input = event.target;
        if (input === null) {
            return null;
        }
        const files = (input as HTMLInputElement).files;
        if (files === null || files.length === 0) {
            return null;
        }

        return files[0];
    }

    async readZip(zip: ZipRandomAccessReader): Promise<Archive> {
        const tableById = new Map<string, string>();
        const attachmentDataById = new Map<number, ExpImpAttachmentData>();
        for (const entry of zip.entries) {
            const path = entry.path;
            let arr = path.split("/");
            if (arr.length <= 1) {
                console.error("GrEI: Weird entry", path);
                continue;
            }

            const type = arr[0];
            if (type === "table") {
                const data = await this.#getJSONData(zip, path);
                if (data === null) {
                    continue;
                }
                const tableId = arr[1].replace(/\.[^/.]+$/, "");
                tableById.set(tableId, data);
            } else if (type === "attachment" && arr.length === 3) {
                const attachmentId = parseInt(arr[1]);
                if (Number.isNaN(attachmentId)) {
                    console.error("GrEI: Weird entry", path);
                    continue;
                }
                const attachmentData = getOrInsert(attachmentDataById, attachmentId, {
                    name: "",
                    type: "",
                    bytes: []
                });
                if (arr[2] === "meta.json") {
                    const data = await this.#getJSONData(zip, path);
                    if (data === null) {
                        continue;
                    }
                    attachmentData.name = data.name;
                    attachmentData.type = data.type;
                } else {
                    const bytes = await zip.get(path)?.bytes();
                    if (bytes === null) {
                        continue;
                    }
                    attachmentData.bytes = bytes;
                }
            } else {
                console.error("GrEI: Weird entry", path)
            }
        }

        return new Archive(tableById, attachmentDataById);
    }

    async #getJSONData(zip: ZipRandomAccessReader, path: string): Promise<any> {
        /*
         * @param {Object} zip - the zip
         * @param {String} path - the path
         */
        const jsonStr = await zip.get(path)?.text();
        if (jsonStr === undefined) {
            console.error("GrEI: Can't read data");
            return null;
        }
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("GrEI: Bad JSON data", e);
            return null;
        }
    }
}

class ArchiveImporterFactory {
    async create(docApi: grist.GristDocAPI, parameters: ExpImpParameters): Promise<ArchiveImporter> {
        const tokenInfo = await docApi.getAccessToken({readOnly: false});
        const colInfoByColIdByTableId = await this.findColInfoByColIdByTableId(docApi);
        return new ArchiveImporter(docApi, colInfoByColIdByTableId, tokenInfo, parameters);
    }

    async findColInfoByColIdByTableId(
        docApi: grist.GristDocAPI): Promise<Map<string, Map<string, GristColInfo>>> {
        /*
         * Analyse the current document.
         * @param {Object} docApi - the grist doc API
         * @returns {Map} tableId -> colId -> colType
         */
        const colTypeByColIdByTableId = new Map<string, Map<string, GristColInfo>>();
        const gristColumns = await docApi.fetchTable("_grist_Tables_column");
        const gristTables = await docApi.fetchTable("_grist_Tables");
        gristColumns.parentId.forEach((parentId: grist.CellValue, index: number, _arr: grist.CellValue[]) => {
            const tableIndex = gristTables.id.findIndex((id: number) => id === (parentId as number));
            const tableId = gristTables.tableId[tableIndex];
            const colTypeByColId = getOrInsert(colTypeByColIdByTableId, tableId, new Map<string, GristColInfo>());
            const colId = gristColumns.colId[index] as string;
            const colType = gristColumns.type[index] as string;
            const isFormula = gristColumns.isFormula[index] as boolean;
            const formula = gristColumns.formula[index] as string;
            const hasTriggerFormula = !isFormula && formula !== "";
            let colInfo: GristColInfo = {
                "colType": colType,
                "isFormula": isFormula,
                "hasTriggerFormula": hasTriggerFormula
            };
            colTypeByColId.set(colId, colInfo);
        });
        return colTypeByColIdByTableId;
    }
}

const REF_LIST_REGEXP = new RegExp("^RefList:(.*)$");
const REF_REGEXP = new RegExp("^Ref:(.*)$");

class ArchiveImporter {
    docApi: grist.GristDocAPI;
    colInfoByColIdByTableId: Map<string, Map<string, GristColInfo>>;
    tokenInfo: grist.AccessTokenResult;
    parameters: ExpImpParameters;

    constructor(
        docApi: grist.GristDocAPI, colInfoByColIdByTableId: Map<string, Map<string, GristColInfo>>, tokenInfo: grist.AccessTokenResult, parameters: ExpImpParameters) {
        this.docApi = docApi;
        this.colInfoByColIdByTableId = colInfoByColIdByTableId;
        this.tokenInfo = tokenInfo;
        this.parameters = parameters;
    }

    async importArchive(archive: Archive) {
        /*
         * Basic function that simply import the data.
         */
        const output = this.parameters.output;
        const t = this.parameters.translate;

        output.next(t("Archive version", {id: archive.TemplateId, version: archive.Version}));
        console.log("GrEI: Importing...", archive.TemplateId, archive.Version);

        output.next(t("Initialization"));
        await this.parameters.before(this.docApi);
        output.next(t("Prepare archive"));
        await this.parameters.prepareArchive(archive, await this.fetchMeta(), this.parameters.output);
        await this.#writeArchive(archive);
        output.next(t("Finalization"));
        await this.parameters.after(this.docApi);
    }

    async fetchMeta(): Promise<ExpImpMeta> {
        let meta = await this.docApi.fetchTable(META_TABLE);
        return tableToMeta(meta);
    }

    async #writeArchive(archive: Archive) {
        const output = this.parameters.output;
        const t = this.parameters.translate;

        output.next(t("Erase tables to overwrite"));
        await this.#removeTablesToOverwrite(archive.tablesIdsToOverwrite);
        output.next(t("Write tables (without refs)"));
        const addActions = await this.#buildAddActions(archive);
        const result = await this.docApi.applyUserActions(addActions);
        console.info(`GrEI: Actions: ${addActions.length} tables added`);

        const newIdsByTableId = this.buildNewIdsByTableId(addActions, result.retValues as number[][]);
        const newIdByOldIdByTableId = this.buildNewIdByOldIdByTableId(archive, newIdsByTableId);
        console.info("GrEI: ", newIdByOldIdByTableId);

        output.next(t("Write ref columns"));
        const updateRefsActions = await this.#buildUpdateRefsActions(
            archive, newIdsByTableId, newIdByOldIdByTableId);
        await this.docApi.applyUserActions(updateRefsActions);
        console.info(`GrEI: Actions: ${updateRefsActions.length} tables fixed`);

        output.next(t("Write trigger formula columns"));
        const updateTriggerActions = await this.#buildUpdateTriggerActions(
            archive, newIdsByTableId);
        await this.docApi.applyUserActions(updateTriggerActions);
        console.info(`GrEI: Trigger formulas: ${updateTriggerActions.length} tables fixed`)
    }

    async #removeTablesToOverwrite(tablesIdsToOverwrite: string[]) {
        // we're looking for every tableId that has a dependent table out of
        // tablesIdsToOverwrite
        // usingId has a ref to usedId
        const output = this.parameters.output;
        const t = this.parameters.translate;

        const usingIdsByUsedId = await this.#findUsingIdsByUsedId();
        const orphanUsingIds = this.#findOrphanUsingIds(tablesIdsToOverwrite, usingIdsByUsedId);

        if (orphanUsingIds.size > 0) {
            const text = orphanUsingIds.values().map(([usingId, usedId], _index) => `${usingId} -> ${usedId}`).toArray().join(", ");
            output.err(t("Following dependencies have been found", {text: text}));
            console.error("GrEI: Found dependencies", text);
        }

        const truncateUserActions = Array<grist.UserAction>();
        for (let tableId of tablesIdsToOverwrite) {
            const table = await grist.docApi.fetchTable(tableId);
            truncateUserActions.push(
                ["BulkRemoveRecord", tableId, table.id]);
        }
        await grist.docApi.applyUserActions(truncateUserActions);
    }

    #findOrphanUsingIds(tablesIdsToOverwrite: string[], usingIdsByUsedId: Map<string, Set<string>>): Set<[string, string]> {
        const willBeDeletedIds = new Set<string>(tablesIdsToOverwrite);
        const orphanUsingIds = new Set<[string, string]>();

        for (let possibleUsedId of tablesIdsToOverwrite) {
            const usingIds = usingIdsByUsedId.get(possibleUsedId);
            if (usingIds === undefined) {
                continue;
            }

            for (const usingId of usingIds) {
                if (!willBeDeletedIds.has(usingId)) {
                    orphanUsingIds.add([usingId, possibleUsedId]);
                }
            }
        }
        return orphanUsingIds;
    }

    async #findUsingIdsByUsedId(): Promise<Map<string, Set<string>>> {
        const usingIdsByUsedId = new Map<string, Set<string>>();

        for (let [tableId, colInfoByColId] of this.colInfoByColIdByTableId.entries()) {
            for (let [colId, colInfo] of colInfoByColId.entries()) {
                const refListM = colInfo.colType.match(REF_LIST_REGEXP);
                if (refListM !== null) {
                    const refTableId = refListM[1];
                    getOrInsert(usingIdsByUsedId, refTableId, new Set()).add(tableId);
                    continue;
                }
                const refM = colInfo.colType.match(REF_REGEXP);
                if (refM !== null) {
                    const refTableId = refM[1];
                    getOrInsert(usingIdsByUsedId, refTableId, new Set()).add(tableId);
                }
            }
        }
        return usingIdsByUsedId;
    }

    async #buildAddActions(archive: Archive): Promise<grist.UserAction[]> {
        const output = this.parameters.output;
        const t = this.parameters.translate;
        const importOptions = this.parameters.importOptions;

        const addActions = Array<grist.UserAction>();

        for (let tableId of archive.tablesIds) {
            output.next(t("Table", {tableId: tableId}));
            if (tableId === META_TABLE) {
                if (importOptions.ignoreMeta) {
                    console.warn(`GrEI: Ignore table Meta from the archive`);
                    continue;
                }
            }
            if (!this.colInfoByColIdByTableId.has(tableId)) {
                if (importOptions.ignoreExtraTables) {
                    console.warn(`GrEI: Ignore extra table ${tableId} from the archive`);
                    continue;
                } else {
                    throw Error();
                }
            }
            const colInfoByColId = this.colInfoByColIdByTableId.get(tableId);
            if (colInfoByColId === undefined) {
                continue;
            }
            const table = archive.tableById.get(tableId);
            if (table === undefined) {
                continue;
            }

            const records = await this.#buildRecords(archive, colInfoByColId, table);
            const values: grist.CellValue[] = Object.values(records)[0];
            const nulls: (number | null)[] = Array(values.length).fill(null);
            addActions.push(["BulkAddRecord", tableId, nulls, records]);
        }
        console.log("GrEI: actions", addActions);
        return addActions;
    }


    async #buildUpdateRefsActions(
        archive: Archive, newIdsByTableId: Map<string, number[]>, newIdByOldIdByTableId: Map<string, Map<number, number>>): Promise<grist.UserAction[]> {
        const options = this.parameters.importOptions;

        const updateActions = Array<grist.UserAction>();
        for (let [tableId, table] of archive.tableEntries()) {
            let colInfoByColId = this.colInfoByColIdByTableId.get(tableId);
            if (colInfoByColId === undefined) {
                continue;
            }
            const records: grist.TableDataWithoutId = {};
            for (let [colId, colInfo] of colInfoByColId.entries()) {
                if (colInfo.isFormula) {
                    if (options.ignoreFormulas) {
                        console.warn(`GrEI: Ignore formula col ${colId} from the archive`);
                        continue;
                    } else {
                        throw new Error();
                    }
                }
                const refListM = colInfo.colType.match(REF_LIST_REGEXP);
                if (refListM !== null) {
                    const refTableId = refListM[1];
                    console.log("GrEI: RefList", tableId, colId, "->", refTableId);
                    const newIdByOldId = newIdByOldIdByTableId.get(refTableId);
                    if (newIdByOldId === undefined) {
                        continue;
                    }
                    const newValues = Array<GristListValueOrNull>();
                    let col = table[colId] as GristListValueOrNull[];
                    for (let arr of col) {
                        if (arr === null || arr === undefined) {
                            newValues.push(null);
                        } else {
                            console.assert(arr[0] === "L");
                            let ids = arr.slice(1) as number[];

                            let newArr: GristListValue = ["L"];
                            ids.forEach((oldId: number, index: number, _arr: number[]) => {
                                const newId = newIdByOldId.get(oldId);
                                if (newId != undefined) {
                                    newArr.push(newId);
                                }
                            });
                            newValues.push(newArr);
                        }
                    }
                    records[colId] = newValues
                } else {
                    const refM = colInfo.colType.match(REF_REGEXP);
                    if (refM !== null) {
                        const refTableId = refM[1];
                        console.log("GrEI: Ref", tableId, colId, "->", refTableId);
                        const newIdByOldId = newIdByOldIdByTableId.get(refTableId);
                        if (newIdByOldId === undefined) {
                            continue;
                        }
                        let newIds = [];
                        let col = table[colId] as (number | null)[];
                        for (let oldId of col) {
                            let newId;
                            if (oldId === null) {
                                newId = null;
                            } else {
                                newId = newIdByOldId.get(oldId);
                            }
                            newIds.push(newId);
                        }
                        records[colId] = newIds
                    }
                }
            }
            if (Object.keys(records).length > 0) {
                const newIds = newIdsByTableId.get(tableId);
                updateActions.push(["BulkUpdateRecord", tableId, newIds, records]) // for each col
            }
        }
        console.log("GrEI: actions", updateActions);
        return updateActions;
    }

    buildNewIdByOldIdByTableId(archive: Archive, newIdsByTableId: Map<string, number[]>): Map<string, Map<number, number>> {
        const newIdByOldIdByTableId = new Map<string, Map<number, number>>();
        for (let [tableId, table] of archive.tableEntries()) {
            const newIds = newIdsByTableId.get(tableId);
            if (newIds === undefined) {
                continue;
            }
            const newIdByOldId = getOrInsert(newIdByOldIdByTableId, tableId, new Map<number, number>());
            table.id.forEach((id, index) => {
                newIdByOldId.set(id, newIds[index]);
            });
        }
        console.log("GrEI: newIdByOldIdByTableId", newIdByOldIdByTableId);
        return newIdByOldIdByTableId;
    }

    buildNewIdsByTableId(actions: grist.UserAction[], results: number[][]): Map<string, number[]> {
        const newIdsByTableId = new Map<string, number[]>();
        actions.forEach((action, index) => {
            const tableId = action[1] as string;
            const newIds = results[index] as number[];
            newIdsByTableId.set(tableId, newIds);
        });
        return newIdsByTableId;
    }

    async #buildRecords(
        archive: Archive, colInfoByColId: Map<string, GristColInfo>, table: grist.TableData): Promise<grist.TableDataWithoutId> {
        const attachmentDataById = archive.attachmentDataById;
        const options = this.parameters.importOptions;
        const records: grist.TableDataWithoutId = {};
        for (let [colId, colInfo] of colInfoByColId) {
            const values = table[colId];
            if (values === undefined) {
                if (options.ignoreMissingCols) {
                    console.warn(`GrEI: Ignore missing col ${colId} in the archive`);
                    continue;
                } else {
                    throw new Error();
                }
            }
            if (colInfo.isFormula) {
                if (options.ignoreFormulas) {
                    console.warn(`GrEI: Ignore formula col ${colId} from the archive`);
                    continue;
                } else {
                    throw new Error();
                }
            }
            if (colInfo.colType.startsWith("Ref:") || colInfo.colType.startsWith("RefList:")) {
                console.info(`GrEI: First pass: ignore ref col: ${colId} (${colInfo.colType})`);
                continue;
            } else if (colInfo.hasTriggerFormula) {
                console.info(`GrEI: First pass: ignore col with trigger formula: ${colId} (${colInfo.colType})`);
                continue;
            }

            let newValues;
            if (colInfo.colType === "Attachments") {
                newValues = await this.#uploadAttachments(values as GristListValueOrNull[], attachmentDataById);
            } else {
                newValues = table[colId];
            }
            records[colId] = newValues;
        }
        return records;
    }

    async #buildUpdateTriggerActions(archive: Archive, newIdsByTableId: Map<string, number[]>): Promise<grist.UserAction[]> {
        const updateActions = Array<grist.UserAction>();
        for (let [tableId, table] of archive.tableEntries()) {
            let colInfoByColId = this.colInfoByColIdByTableId.get(tableId);
            if (colInfoByColId === undefined) {
                continue;
            }
            const records: grist.TableDataWithoutId = {};
            for (let [colId, colInfo] of colInfoByColId.entries()) {
                if (colInfo.hasTriggerFormula) {
                    records[colId] = table[colId];
                }
            }
            if (Object.keys(records).length > 0) {
                updateActions.push(["BulkUpdateRecord", tableId, newIdsByTableId.get(tableId), records]) // for each col
            }
        }
        console.log(updateActions);
        return updateActions;
    }

    async #uploadAttachments(
        values: GristListValueOrNull[], attachmentDataById: Map<number, ExpImpAttachmentData>): Promise<GristListValueOrNull[]> {
        const newValues = Array<GristListValueOrNull>();
        for (let arr of values) {
            if (arr === null) {
                newValues.push(null);
            } else {
                console.assert(arr[0] === "L");
                let col = arr.slice(1) as number[];

                const newArr: GristListValue = ["L"];
                for (let attachmentId of col) {
                    const attachmentData = attachmentDataById.get(attachmentId);
                    if (attachmentData === undefined) {
                        continue;
                    }
                    const newId = await this.#uploadAttachment(attachmentData);
                    if (newId > 0) {
                        newArr.push(newId);
                    } else {
                        console.error(`GrEI: Can't upload ${attachmentData.name}`);
                    }
                }
                newValues.push(newArr)
            }
        }
        return newValues;
    }

    async #uploadAttachment(data: ExpImpAttachmentData): Promise<number> {
        /*
         * @param {Object} tokenInfo - the grist token info
         * @param {Map} data - the attachment data
         */
        // https://community.getgrist.com/t/upload-attachment-from-custom-widget/13612
        const formData = new FormData();

        const attachmentName = data.name;
        const blob = new Blob([data.bytes], {type: data.type});
        formData.append('upload', blob, attachmentName);
        const postURL = `${this.tokenInfo.baseUrl}/attachments?auth=${this.tokenInfo.token}`;
        const response = await fetch(postURL, {
            method: 'POST',
            body: formData,
            headers: {
                "X-Requested-With": "XMLHttpRequest",
            },
        });
        if (!response.ok) {
            console.error(`GrEI: Upload fail: ${response.status} ${response.statusText}`);
            return -1;
        }

        console.log(`GrEI: Upload ${attachmentName}`);
        const result = await response.json();
        return result[0] as number;
    }

    async getCurTemplateId(): Promise<string> {
        const metaTable = await this.docApi.fetchTable(META_TABLE);
        return metaTable[COL_TEMPLATE_ID][0] as string;
    }

    async getCurVersion(): Promise<string> {
        const metaTable = await this.docApi.fetchTable(META_TABLE);
        return metaTable[COL_VERSION][0] as string;
    }
}

grist.ready({
    requiredAccess: 'full',
});

async function fixParameters(userParameters: ExpImpUserParameters): Promise<ExpImpParameters> {
    const importOptions: ExpImpImportOptions = {
        ...defaultExpImpParameters.importOptions,
        ...(userParameters.importOptions ?? {}),
    };

    const parameters = {
        ...defaultExpImpParameters,
        ...userParameters,
        "importOptions": importOptions,
    };

    try {
        let locale = userParameters.locale;
        // sanitize, but you won't hack yourself
        locale = locale.replace(/[^\w-]+/g, "");
        const lang = await import(`./locales/${locale}.json`) as { [key: string]: string };

        function translate(key: string, vars?: any): string {
            let text = lang[key];
            if (text === undefined) {
            }
            if (vars) {
                for (const [k, v] of Object.entries(vars)) {
                    text = text.replaceAll(`{{${k}}}`, String(v));
                }
            }
            return text;
        }

        parameters.translate = translate;
    } catch (e) {
        console.error(`GrEI: Locale ${userParameters.locale} not found: ${e}`);
    }
    return parameters;
}


async function main(userParameters: ExpImpUserParameters) {
    const docApi: grist.GristDocAPI = grist.docApi;
    console.info("GrEI: User parameters", userParameters);

    const parameters = await fixParameters(userParameters);

    async function exportArchive(_event: Event) {
        const output = parameters.output;
        const t = parameters.translate;
        output.begin(t("Export archive"));
        try {
            const archiveCreator = new ArchiveCreator(docApi, parameters);
            const zipContent = await archiveCreator.create();
            const archiveExporter = new DefaultArchiveExporter(parameters);
            await archiveExporter.exportArchive(zipContent);
            output.next(t("End of export"))
        } catch (error) {
            output.err(t("Error", {error: error}));
            console.error("GrEI: ", error);
        } finally {
            output.end()
        }
    }

    async function importArchive(event: Event) {
        const output = parameters.output;
        const t = parameters.translate;
        output.begin(t("Import archive"));
        try {
            const reader = new ArchiveReader(parameters);
            const archive = await reader.readFromEvent(event);
            if (archive === null) {
                console.error(`GrEI: Can't load archive`);
                return
            }
            const archiveImporter = await new ArchiveImporterFactory().create(docApi, parameters);
            await archiveImporter.importArchive(archive);
            output.next(t("End of import"));
        } catch (error) {
            output.err(t("Error", {error: error}));
            console.error("GrEI: ", error);
        } finally {
            output.end()
        }
    }

    const exportElement = document.getElementById(parameters.exportId);
    if (exportElement === null) {
        console.warn(`GrEI: No ${parameters.exportId} element found`);
    } else {
        exportElement.onclick = exportArchive;
    }
    const importElement = document.getElementById(parameters.importId);
    if (importElement === null) {
        console.warn(`GrEI: No ${parameters.importId} element found`);
    } else {
        importElement.onchange = importArchive;
    }
}

function defaultGetArchiveName(): string {
    let dateStr = new Date().toISOString();
    return `export_${dateStr}.zip`;
}

async function defaultBefore(_docApi: grist.GristDocAPI) {
}

async function defaultPrepareArchive(archive: Archive, meta: ExpImpMeta, output: Output) {
    // just check id and version...
    if (archive.TemplateId !== meta.TemplateId || archive.Version > meta.Version) {
        output.begin("Error", `Can't import a tool of type ${archive.TemplateId} v.${archive.Version}`);
        throw Error(`Wrong archive ${archive.TemplateId}`);
    }
}

function defaultImportErr(error: any, parameters: ExpImpParameters) {
    /* Error when reading ZIP file */
    const output = parameters.output;
    const t = parameters.translate;

    output.err(t("Can't read ZIP", {error: error}));
    console.error("GrEI: Can't read zip file", error);
}

async function defaultAfter(_docApi: grist.GristDocAPI) {
}

function defaultTranslate(key: string, vars?: any): string {
    return `${key} ${vars}`;
}

const defaultImportOptions: ExpImpImportOptions = {
    ignoreMeta: true, // ignore the Meta table from the archive
    ignoreExtraTables: true, // ignore tables from the archive that are not in the document
    ignoreMissingCols: true, // ignore cols from the document that are not in the archive
    ignoreFormulas: true, // ignore the formula cols from the archive
};

const defaultExpImpParameters: ExpImpParameters = {
    exportId: "export",
    importId: "import",
    output: new ConsoleOutput(),
    getArchiveName: defaultGetArchiveName,
    before: defaultBefore,
    prepareArchive: defaultPrepareArchive,
    after: defaultAfter,
    importErr: defaultImportErr,
    importOptions: defaultImportOptions,
    translate: defaultTranslate,
};

export function register(parameters: ExpImpUserParameters) {
    document.addEventListener("DOMContentLoaded", (_event) => main(parameters))
}
