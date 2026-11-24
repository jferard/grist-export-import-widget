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

    err(err) {
        if (err !== undefined) {
            this.ulElement.innerHTML += `<li style="color: darkred;">ERREUR: ${err}</li>`;
        }
    }

    end() {}
}

function getArchiveName() {
    let dateStr = new Date().toISOString();
    return `my_export_${dateStr}.zip`;
}

async function prepareArchive(archive, meta, output) {
    // use:
    // mapRows(tableId, func)
    // renameCols(tableId, newNameByOldName)
    // removeCols(tableId, colNames)
    // renameTable(srcTableId, destTableId)
    // removeTable(srcTableId)
    // duplicateTable(curTableId, newTableId)
    // to update the archive
}

expimp.register({
    "output": new DocumentOutput(window.document),
    "getArchiveName": getArchiveName,
    "prepareArchive": prepareArchive,
    "locale": "fr"
});
