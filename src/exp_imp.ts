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
import {ZipWriter, openZip, ZipRandomAccessReader} from "web-jszipp";
import CellValue = grist.CellValue;
import TableData = grist.TableData;
import RowRecord = grist.RowRecord;
import UserAction = grist.UserAction;

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

type ExpImpImportOptions = {
    ignoreMeta: boolean
    ignoreExtraTables: boolean
    ignoreMissingCols: boolean
    ignoreFormulas: boolean
}

type ExpImpAttachmentData = {
    name: string
    type: string
    bytes: any
}

const META_TABLE = "Meta";
const COL_VERSION = "Version";
const COL_TEMPLATE_ID = "TemplateId";

interface Output {
    begin(title: string, info?: string): void;
    next(info: string): void;
    end(): void;
}

class ConsoleOutput implements Output {
    begin(title: string, info?: string) {
        console.info("> begin output")
        console.info(`tìtle: ${title}`);
        if (info !== undefined) {
            this.next(info);
        }
    }

    next(info: string) {
        if (info !== undefined) {
            console.info(`* info: ${info}`);
        }
    }

    end() {
        console.info("> end output");
    }
}

class DefaultArchiveCreator {
    docApi: grist.GristDocAPI
    output: ConsoleOutput

    constructor(docApi: grist.GristDocAPI, output: ConsoleOutput) {
        /*
         * @param {Object} docApi - the grist doc API
         */
        this.docApi = docApi;
        this.output = output;
    }

    async create(): Promise<Blob> {
        /*
         * Create the exporter
         *
         * @param {Object} docApi - the grist doc API
         */
        console.info("Creating archive...");
        const writer = new ZipWriter({outputAs: "blob"});

        this.output.next("Ajout des tables")
        await this.#addTables(writer);
        this.output.next("Ajout des PJ")
        await this.#addAttachments(writer);
        this.output.next("Écriture du zip")
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
        console.info("Tables %s ajoutées", tablesIds);
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
                        console.error(`Value ${attachmentsIds} is not an array`);
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
                            console.error(response.statusText);
                            continue;
                        }

                        let blob = await response.blob();
                        let bytes = await blob.bytes();

                        let data = {
                            name: attachmentName,
                            type: blob.type,
                        };
                        let jsonStr = JSON.stringify(data);
                        console.info("Export", attachmentId, jsonStr);

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

    async #findColsIdsByTableId() {
        /*
         * @returns {Map} tableId -> colsId
         */
        const colsIdsByTableId = new Map();
        const gristColumns = await this.docApi.fetchTable("_grist_Tables_column");
        const gristTables = await this.docApi.fetchTable("_grist_Tables");
        gristColumns.parentId.forEach((parentId: CellValue, index: number, _arr: CellValue[]) => {
            if (gristColumns.type[index] === "Attachments") {
                const tableIndex = gristTables.id.findIndex((id: number) => id === (parentId as number)) ;
                const tableId = gristTables.tableId[tableIndex];
                const colsIds = getOrInsert(colsIdsByTableId, tableId, []);
                colsIds.push(gristColumns.colId[index]);
            }
        });
        return colsIdsByTableId;
    }

    async #findAttachmentNameById() {
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
    output: Output;

    constructor(output: Output) {
        this.output = output;
    }

    async exportArchive(zipContent: Blob) {
        this.output.next("Export...");
        const suggestedName = this.getArchiveName();
        this.#download(zipContent, suggestedName);
    }

    getArchiveName() {
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

class Archive {
    tableById: Map<string, TableData>
    attachmentDataById: Map<number, ExpImpAttachmentData>
    importOptions: ExpImpImportOptions = {
        "ignoreMeta": true, // ignore the Meta table from the archive
        "ignoreExtraTables": true, // ignore tables from the archive that are not in the document
        "ignoreMissingCols": true, // ignore cols from the document that are not in the archive
        "ignoreFormulas": true, // // ignore the formula cols from the archive

    }

    constructor(tableById: Map<string, any>, attachmentDataById: Map<number, ExpImpAttachmentData>) {
        this.tableById = tableById;
        this.attachmentDataById = attachmentDataById;

        this.importOptions = {
            "ignoreMeta": true, // ignore the Meta table from the archive
            "ignoreExtraTables": true, // ignore tables from the archive that are not in the document
            "ignoreMissingCols": true, // ignore cols from the document that are not in the archive
            "ignoreFormulas": true, // // ignore the formula cols from the archive
        }
    }

    get version(): string {
        return this.meta[COL_VERSION];
    }

    get templateId(): string {
        return this.meta[COL_TEMPLATE_ID];
    }

    get meta(): {[k: string]: any} {
        let meta = this.tableById.get(META_TABLE);
        if (meta === undefined) {
            throw new Error("Meta table not found");
        }
        return Object.fromEntries(
            Object.entries(meta)
                .map(([key, values]) => [key, values[0]])
        );
    }

    get tablesIds() {
        return this.tableById.keys().filter((tableId) => tableId !== META_TABLE);
    }

    tableEntries() {
        return this.tableById.entries().filter(([tableId, _table], _tableIdx) => tableId !== META_TABLE);
    }

    // begin user funcs
    filterRows(tableId: string, func: (row: grist.RowRecord) => boolean) {
        const table = this.tableById.get(tableId);
        if (table === undefined) {
            console.warn(`Table ${tableId} not found`);
            return;
        }
        const rows = this.#tableToRows(table);
        const newRows = rows.filter((row) => func(row))
        const newTable = this.#rowsToTable(newRows);
        this.tableById.set(tableId, newTable);
    }

    mapRows(tableId: string, func: (row: grist.RowRecord) => grist.RowRecord) {
        const table = this.tableById.get(tableId);
        if (table === undefined) {
            console.warn(`Table ${tableId} not found`);
            return;
        }
        const rows = this.#tableToRows(table);
        const newRows = rows.map((row) => func(row))
        const newTable = this.#rowsToTable(newRows);
        this.tableById.set(tableId, newTable);
    }

    renameCols(tableId: string, newNameByOldName: {[k: string]: string}) {
        const table = this.tableById.get(tableId);
        if (table === undefined) {
            console.warn(`Table ${tableId} not found`);
            return;
        }

        const newTable: TableData = { id: [] };
        const keys = Object.keys(table);
        keys.forEach((key) => {
            let newKey = newNameByOldName[key];
            if (newKey === undefined) {
                newKey = key;
            }
            newTable[newKey] = table[key];
        })
        this.tableById.set(tableId, newTable);
    }

    removeCols(tableId: string, colNames: string[]) {
        const table = this.tableById.get(tableId);
        if (table === undefined) {
            console.warn(`Table ${tableId} not found`);
            return;
        }

        const newTable: TableData = { id: [] };
        const keys = Object.keys(table);
        keys.forEach((key) => {
            if (!colNames.includes(key)) {
                newTable[key] = table[key];
            }
        })
        this.tableById.set(tableId, newTable);
    }

    renameTable(srcTableId: string, destTableId: string) {
        const table = this.tableById.get(srcTableId);
        if (table === undefined) {
            console.warn(`Table ${srcTableId} not found`);
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
            console.warn(`Table ${curTableId} not found`);
            return;
        }

        this.tableById.set(newTableId, structuredClone(table));
    }

    // end user funcs

    #tableToRows(table: TableData): grist.RowRecord[] {
        let keys = Object.keys(table);
        const rows: grist.RowRecord[] = Array();
        table.id.forEach((_id: number, index: number, _arr: number[]) => {
            const row = Object.fromEntries(keys.map((k) => [k, table[k][index]]))
            rows.push(row as grist.RowRecord);
        })
        return rows;
    }

    #rowsToTable(rows: grist.RowRecord[]): TableData {
        console.assert(rows.length > 0)
        const table: TableData = { id: [] }
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
        })
        return table
    }
}

class DefaultArchiveReader {
    output: any

    constructor(output: Output) {
        this.output = output;
    }

    async readFromEvent(event: Event): Promise<Archive|null> {
        this.output.next("Lecture depuis la balise 'input'")
        console.log("Read...");

        const file = this.#getFile(event);
        if (file === null) {
            return null;
        }
        this.output.next(`Fichier : ${file.name}`);

        try {
            const zip = await openZip(file, {
                pathMode: "strict-package",
                maxArchiveSize: 50 * 1024 * 1024,
                maxEntrySize: 10 * 1024 * 1024
            });
            return await this.readZip(zip);
        } catch (error) {
            this.importErr(error);
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

    async readZip(zip: ZipRandomAccessReader) {
        const tableById = new Map<string, string>();
        const attachmentDataById = new Map<number, ExpImpAttachmentData>();
        for (const entry of zip.entries) {
            const path = entry.path;
            let arr = path.split("/");
            if (arr.length <= 1) {
                console.error("Weird entry", path)
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
                    console.error("Weird entry", path)
                    continue;
                }
                const attachmentData = getOrInsert(attachmentDataById, attachmentId, { name: "", type: "", bytes: [] });
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
                console.error("Weird entry", path)
            }
        }

        return new Archive(tableById, attachmentDataById);
    }

    async #getJSONData(zip: ZipRandomAccessReader, path: string) {
        /*
         * @param {Object} zip - the zip
         * @param {String} path - the path
         */
        const jsonStr = await zip.get(path)?.text();
        if (jsonStr === undefined) {
            console.error("Can't read data");
            return null;
        }
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("Bad JSON data", e);
            return null;
        }
    }

    importErr(error: any) {
        /* Error when reading ZIP file */
        window.alert("Can't read zip file");
        console.error("Can't read zip file", error);
    }
}

class DefaultArchiveImporter {
    static async create(docApi: grist.GristDocAPI, output: Output) {
        const tokenInfo = await docApi.getAccessToken({readOnly: false});
        const colInfoByColIdByTableId = await DefaultArchiveImporter.findColInfoByColIdByTableId(docApi);
        return new DefaultArchiveImporter(docApi, tokenInfo, output, colInfoByColIdByTableId);
    }

    static async findColInfoByColIdByTableId(docApi: grist.GristDocAPI) {
        /*
         * Analyse the current document.
         * @param {Object} docApi - the grist doc API
         * @returns {Map} tableId -> colId -> colType
         */
        const colTypeByColIdByTableId = new Map<string, Map<string, GristColInfo>>();
        const gristColumns = await docApi.fetchTable("_grist_Tables_column");
        const gristTables = await docApi.fetchTable("_grist_Tables");
        gristColumns.parentId.forEach((parentId: CellValue, index: number, _arr: CellValue[]) => {
            const tableIndex = gristTables.id.findIndex((id: number) => id === (parentId as number));
            const tableId = gristTables.tableId[tableIndex];
            const colTypeByColId = getOrInsert(colTypeByColIdByTableId, tableId, new Map());
            const colId = gristColumns.colId[index] as number;
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

    docApi: grist.GristDocAPI
    tokenInfo: grist.AccessTokenResult
    output: Output
    colInfoByColIdByTableId: Map<string, Map<string, GristColInfo>>

    constructor(docApi: grist.GristDocAPI, tokenInfo: grist.AccessTokenResult, output: Output, colInfoByColIdByTableId: Map<string, Map<string, GristColInfo>>) {
        this.docApi = docApi;
        this.tokenInfo = tokenInfo;
        this.output = output;
        this.colInfoByColIdByTableId = colInfoByColIdByTableId;
    }

    async importArchive(archive: Archive) {
        /*
         * Basic function that simply import the data.
         */
        this.output.next(`Version de l'archive ${archive.templateId} v.${archive.version}`);
        console.log("Importing...", archive.version);

        this.output.next("Initialisation");
        await this.before(archive);
        this.output.next("Préparation de l'archive");
        await this.prepareArchive(archive);
        await this.#writeArchive(archive);
        this.output.next("Finalisation");
        await this.after(archive);
    }

    async before(archive: Archive) {
        // do nothing
    }

    async prepareArchive(archive: Archive) {
        // just check id and version...
        const curTemplateId = await this.getCurTemplateId();
        const curVersion = await this.getCurVersion();
        if (archive.templateId !== curTemplateId || archive.version > curVersion) {
            this.output.begin("Erreur", `Impossible d'importer un outil de type ${archive.templateId} v.${archive.version}`);
            throw Error(`Wrong archive ${archive.templateId}`);
        }
        // ...and do nothing
    }

    async after(archive: Archive) {
        // do nothing
    }

    async #writeArchive(archive: Archive) {
        this.output.next("Écriture des tables (sans les références)");
        const addActions = await this.#buildAddActions(archive);
        const result = await this.docApi.applyUserActions(addActions);
        console.info(`Actions: ${addActions.length} tables added`)

        const newIdsByTableId = this.buildNewIdsByTableId(addActions, result.retValues as number[]);
        const newIdByOldIdByTableId = this.buildNewIdByOldIdByTableId(archive, newIdsByTableId);
        console.info(newIdByOldIdByTableId);

        this.output.next("Écriture des colonnes références");
        const updateRefsActions = await this.#buildUpdateRefsActions(
            archive, newIdsByTableId, newIdByOldIdByTableId);
        await this.docApi.applyUserActions(updateRefsActions);
        console.info(`Actions: ${updateRefsActions.length} tables fixed`)

        this.output.next("Écriture des colonnes formule d'initialisation");
        const updateTriggerActions = await this.#buildUpdateTriggerActions(
            archive, newIdsByTableId);
        await this.docApi.applyUserActions(updateTriggerActions);
        console.info(`Trigger formulas: ${updateTriggerActions.length} tables fixed`)
    }

    async #buildAddActions(archive: Archive): Promise<UserAction[]> {
        const importOptions = archive.importOptions;

        const addActions = Array<grist.UserAction>();

        for (let tableId of archive.tablesIds) {
            this.output.next(`Table : ${tableId}`);
            if (tableId === META_TABLE) {
                if (importOptions.ignoreMeta) {
                    console.warn(`Ignore table Meta from the archive`);
                    continue;
                }
            }
            if (!this.colInfoByColIdByTableId.has(tableId)) {
                if (importOptions.ignoreExtraTables) {
                    console.warn(`Ignore extra table ${tableId} from the archive`);
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
            const values: CellValue[] = Object.values(records)[0];
            const nulls = Array(values.length).fill(null);
            addActions.push(["BulkAddRecord", tableId, nulls, records]);
        }
        console.log(addActions);
        return addActions;
    }


    async #buildUpdateRefsActions(
        archive: Archive, newIdsByTableId: Map<string, number[]>, newIdByOldIdByTableId: Map<string, Map<number, number>>) {
        const updateActions = Array();
        const refListRegexp = new RegExp("^RefList:(.*)$");
        const refRegexp = new RegExp("^Ref:(.*)$");
        for (let [tableId, table] of archive.tableEntries()) {
            let colInfoByColId = this.colInfoByColIdByTableId.get(tableId);
            if (colInfoByColId === undefined) {
                continue;
            }
            const records: TableData = { id: [] };
            for (let [colId, colInfo] of colInfoByColId.entries()) {
                const refListM = colInfo.colType.match(refListRegexp);
                if (refListM !== null) {
                    const refTableId = refListM[1];
                    console.log("RefList", tableId, colId, "->", refTableId);
                    const newIdByOldId = newIdByOldIdByTableId.get(refTableId)
                    if (newIdByOldId === undefined) {
                        continue;
                    }
                    const newValues = [];
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
                    const refM = colInfo.colType.match(refRegexp);
                    if (refM !== null) {
                        const refTableId = refM[1];
                        console.log("Ref", tableId, colId, "->", refTableId);
                        const newIdByOldId = newIdByOldIdByTableId.get(refTableId)
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
        console.log(updateActions)
        return updateActions;
    }

    buildNewIdByOldIdByTableId(archive: Archive, newIdsByTableId: Map<string, string[]>) {
        const newIdByOldIdByTableId = new Map();
        for (let [tableId, table] of archive.tableEntries()) {
            const newIds = newIdsByTableId.get(tableId);
            if (newIds === undefined) {
                continue;
            }
            const newIdByOldId = getOrInsert(newIdByOldIdByTableId, tableId, new Map<string, string>())
            table.id.forEach((id, index) => {
                newIdByOldId.set(id, newIds[index]);
            });
        }
        console.log(newIdByOldIdByTableId);
        return newIdByOldIdByTableId;
    }

    buildNewIdsByTableId(actions: UserAction[], results: number[]) {
        const newIdsByTableId = new Map();
        actions.forEach((action, index) => {
            const tableId = action[1];
            const newIds = results[index];
            newIdsByTableId.set(tableId, newIds);
        });
        return newIdsByTableId;
    }

    async #buildRecords(archive: Archive, colInfoByColId: Map<string, GristColInfo>, table: TableData) {
        const attachmentDataById = archive.attachmentDataById;
        const options = archive.importOptions;
        const records: TableData = { id: [] }
        for (let [colId, colInfo] of colInfoByColId) {
            const values = table[colId];
            if (values === undefined) {
                if (options.ignoreMissingCols) {
                    console.warn(`Ignore missing col ${colId} in the archive`);
                    continue;
                } else {
                    throw new Error();
                }
            }
            if (colInfo.isFormula) {
                if (options.ignoreFormulas) {
                    console.warn(`Ignore formula col ${colId} from the archive`);
                    continue;
                } else {
                    throw new Error();
                }
            }
            if (colInfo.colType.startsWith("Ref:") || colInfo.colType.startsWith("RefList:")) {
                console.info(`First pass: ignore ref col: ${colId} (${colInfo.colType})`)
                continue;
            } else if (colInfo.hasTriggerFormula) {
                console.info(`First pass: ignore col with trigger formula: ${colId} (${colInfo.colType})`)
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

    async #buildUpdateTriggerActions(archive: Archive, newIdsByTableId: Map<string, string[]>) {
        const newIdByOldIdByTableId = this.buildNewIdByOldIdByTableId(archive, newIdsByTableId);
        console.info(newIdByOldIdByTableId);

        const updateActions = Array();
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
        console.log(updateActions)
        return updateActions;
    }

    async #uploadAttachments(values: GristListValueOrNull[], attachmentDataById: Map<number, ExpImpAttachmentData>) {
        const newValues = Array<GristListValueOrNull>();
        for (let arr of values) {
            let newArr: string[] | null;
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
                        console.error(attachmentData.name);
                    }
                }
                newValues.push(newArr)
            }
        }
        return newValues;
    }

    async #uploadAttachment(data: ExpImpAttachmentData) {
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
            console.error(`Upload échoué: ${response.status} ${response.statusText}`);
            return -1;
        }

        console.log(`Upload ${attachmentName}`)
        const result = await response.json();
        return result[0];
    }

    async getCurTemplateId() {
        const metaTable = await this.docApi.fetchTable(META_TABLE);
        return metaTable[COL_TEMPLATE_ID][0];
    }

    async getCurVersion() {
        const metaTable = await this.docApi.fetchTable(META_TABLE);
        return metaTable[COL_VERSION][0] as string;
    }
}

grist.ready({
    requiredAccess: 'full',
});

async function main(_event: Event) {
    const docApi: grist.GristDocAPI = grist.docApi;

    // https://github.com/JSZipp/JSZipp
    function createOutput(): Output {
        try {
            // responsibility of user
            // @ts-ignore
            return new DocumentOutput(document);
        } catch (ReferenceError) {
            return new ConsoleOutput();
        }
    }

    function createArchiveCreator(docApi: grist.GristDocAPI, output: Output): DefaultArchiveCreator {
        try {
            // responsibility of user
            // @ts-ignore
            return new ArchiveCreator(docApi, output);
        } catch (ReferenceError) {
            return new DefaultArchiveCreator(docApi, output);
        }
    }

    function createArchiveExporter(output: Output, zipContent: Blob): DefaultArchiveExporter {
        try {
            // responsibility of user
            // @ts-ignore
            return new ArchiveExporter(output)
        } catch (ReferenceError) {
            return new DefaultArchiveExporter(output)
        }
    }

    async function exportArchive(_event: Event) {
        const output = createOutput();
        output.begin("Export de l'archive")
        const archiveCreator = createArchiveCreator(docApi, output);
        const zipContent = await archiveCreator.create();
        const archiveExporter = createArchiveExporter(output, zipContent);
        await archiveExporter.exportArchive(zipContent);
        output.next("Terminé")
        output.end()
    }

function createArchiveReader(output: Output): DefaultArchiveReader {
        try {
            // responsibility of user
            // @ts-ignore
            return new ArchiveReader(output);
        } catch (ReferenceError) {
            return new DefaultArchiveReader(output);
        }
    }

    function createArchiveImporter(docApi: grist.GristDocAPI, output: Output) {
        try {
            // responsibility of user
            // @ts-ignore
            return ArchiveImporter.create(docApi, output);
        } catch (ReferenceError) {
            return DefaultArchiveImporter.create(docApi, output)
        }
    }

    async function importArchive(event: Event) {
        const output = createOutput();
        output.begin("Import de l'archive")
        const reader = createArchiveReader(output);
        const archive = await reader.readFromEvent(event);
        const archiveImporter = await createArchiveImporter(docApi, output);
        await archiveImporter.importArchive(archive);
        output.next("Terminé")
        output.end()
    }

    const exportElement = document.getElementById("export");
    if (exportElement === null) {
        console.warn(`No "export" element found`);
    } else {
        exportElement.onclick = exportArchive;
    }
    const importElement = document.getElementById("import");
    if (importElement === null) {
        console.warn(`No "import" element found`);
    } else {
        importElement.onchange = importArchive;
   }
}

document.addEventListener("DOMContentLoaded", main)
