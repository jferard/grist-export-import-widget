## Import/export

Copyright 2026 DGFiP / DTNum / Fabrique Numérique

Licensed under the Apache License, Version 2.0.

**This Grist widget aims to provide a convenient way to update Grist
tools that are published as templates.**

> [!TIP]
> Direct link to the widget (URL to copy paste to Grist): `https://jferard.github.io/grist/export-import`

> [!NOTE]
> This Grist widget is an adaptation of the [Custom widget 
> builder](https://github.com/gristlabs/grist-widget/blob/master/custom-widget-builder/README.md).
> See original instructions below.


When you provide a template, the users instantiate the template and get
their own version of the tool. This means that several tools, coming
from the same template, are now independent.

If you update the template, the modifications are not broadcasted to the
documents. The users have to update their tool themselves: export the
tables and the attachment, instantiate the new template, import manually
the tables and fix what's now broken (the column names have changed,
there is a new table...). They have to handle all the differences
between the new tool and the old tool.

This widget provides a raw export of the data, including the
attachments.

The import process is more subtle: you can simply import the data in the
new document, or process the data : change a table name, change a column
name, rewrite the records and so on... before importing. That's the
role of the JavaScript code in the widget.

See:
[dsfr-example.js](https://github.com/jferard/grist-export-import-widget/blob/main/dsfr-example.js)
for a complete example.

### Usage

> [!IMPORTANT]
> The document must have a "Meta" table, and the following
>
> - "TemplateId": the id of the tool (you may choose whatever you want)
> - "Version": the current version

The widget must be installed in the template.

When a new version of the template is created, any instance of the old
template can export the existing tables into an archive.

Any instance of the new template can import the existing tables from the
archive.

### The export format

The exports data in a ZIP archive:

- the `attachment` directory contains a subdirectory (the number of
  the attachment) for each attachment of the original document. This
  subdirectory contains the file itself and a small JSON file with the
  name and the type of the file.
- the `table` directory contains a subdirectory (the table id) for
  each table. This subdirectory contains the table as a JSON file (a raw
  `fetchTable` result).

#### JavaScript code

You have to register your parameters. If you register nothing, default behavior will apply.

```
expimp.register({});
```

The parameters are:

```typescript
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
    before?: (docApi: grist.GristDocAPI) => Promise&lt;void&gt;
    prepareArchive?: (archive: Archive, meta: ExpImpMeta, output: Output) => Promise&lt;void&gt;
    after?: (docApi: grist.GristDocAPI) => Promise&lt;void&gt;
    importOptions?: Partial&lt;ExpImpImportOptions&gt;
}
```

### The import

The import will read the archive and apply some functions to the data.
You simply need to inherit from the default classes to tailor the data
to the new document format.

#### The data

You may extend the `DefaultArchiveImporter` and provide `before`,
`prepareArchive` and `after` methods. The `prepareArchive` takes
an `archive` argument, that is an object of type `Archive`, with the
following in-place methods:

- `filterRows(tableId, func)`
- `mapRows(tableId, func)`
- `renameCols(tableId, newNameByOldName)`
- `removeCols(tableId, colNames)`
- `renameTable(srcTableId, destTableId)`
- `removeTable(srcTableId)`
- `duplicateTable(curTableId, newTableId)`

#### The output

The default output is the browser console. Unless you use dev tools, you
won't see anything. But you can provide a customized output, e.g. in a
modal window. You have to provide a class:

```javascript
    class DocumentOutput {
      constructor(doc) {
        // doc is the current widget
      }

      begin(title, info) {
        // open the modal window with the title and a first information.
      }

      next(info) {
        // add a new information
      }

      end() {
        // close the modal window
      }
    }
```


### HTML

The HTML code must have :

- An export button having the "export" id
- An import input having the "import" id

Thus, the minimal HTML body is:

```html
<button id="export" type="button">export</button>
<input id="import" type="file">
```

But you can use more complex layout: see
[dsfr-example.html](https://github.com/jferard/grist-export-import-widget/blob/main/dsfr-example.html).

> [!IMPORTANT]
> Firefox: set <code>network.lna.blocking</code> to false for local testing (the widget must access localhost to retrieve attachments).

## Original custom widget builder help

### How to use this editor

This editor allows you to write code for a custom widget and "install"
it inside a Grist document.

There are two tabs: **JavaScript** and **HTML**. The **JavaScript** tab
is where you write code that interacts with the Grist plugin API, while
the **HTML** tab is where you write the code that displays the results
of the JavaScript code.

### Modifying the Custom Widget

To open the editor, click the `"Open configuration"` button in the
creator panel or clear saved filter settings for this tab.

### Installing the Custom Widget

- When you click the `"Preview"` button, the widget (both the JavaScript
  and HTML code) will be saved in the document's metadata, and the
  editor will then replace itself with the widget you have created.
- After installing the widget, you need to press the `"Save"` button and
  save the configuration for a tab. It works similarly to saving filters
  in Grist.

**Note:** There is no autosave feature, so if you refresh the page
without installing or saving, the widget content will be lost.

### Note for Developers

The widget's state is persisted in the widget's metadata as **JSON**,
with content encoded as two properties: `_js` and `_html`.

```javascript
grist.setOptions({
_installed: true, // Flat indicating that the widget is installed.
_js: `...your js code....`,
_html: `...your html code...`,
});
```

In the final widget, the `_html` field is inserted as is into an iframe,
and the `_js` field is embedded within a script tag afterwards.

For more details on custom widget development, please refer to the
[official Grist documentation](https://support.getgrist.com/widget-custom/).

