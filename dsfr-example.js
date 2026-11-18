class DocumentOutput {
    constructor(doc) {
        this.titleElement = doc.getElementById("titre");
        this.ulElement = doc.getElementById("info");
        this.modalDialog = doc.getElementById("modal");
    }

    begin(title, info) {
        this.titleElement.innerHTML = title;
        this.ulElement.innerHTML = '';
        this.next(info)
        dsfr(this.modalDialog).modal.disclose();
    }

    next(info) {
        if (info !== undefined) {
            this.ulElement.innerHTML += `<li>${info}</li>`;
        }
    }

    end() {}
}

class ArchiveExporter extends DefaultArchiveExporter {
    getArchiveName() {
        let dateStr = new Date().toISOString();
        return `my_export_${dateStr}.zip`;
    }
}

class ArchiveImporter extends DefaultArchiveImporter {
    static async create(docApi, modal) {
        const tokenInfo = await docApi.getAccessToken({readOnly: false});
        const colInfoByColIdByTableId = await DefaultArchiveImporter.findColInfoByColIdByTableId(docApi);
        return new ArchiveImporter(docApi, tokenInfo, modal, colInfoByColIdByTableId);
    }

    async prepareArchive(archive) {
        await super.prepareArchive(archive);

        // use:
        // mapRows(tableId, func)
        // renameCols(tableId, newNameByOldName)
        // removeCols(tableId, colNames)
        // renameTable(srcTableId, destTableId)
        // removeTable(srcTableId)
        // duplicateTable(curTableId, newTableId)
        // to update the archive
    }
}