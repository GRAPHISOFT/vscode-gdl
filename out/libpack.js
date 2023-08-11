"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathNameTableView = void 0;
const vscode = require("vscode");
const path = require("path");
function compareFileName(a, b) {
    // first by extension
    const byExt = path.extname(a.fileName).localeCompare(path.extname(b.fileName));
    if (byExt === 0) {
        return a.fileName.localeCompare(b.fileName); // filenames have to differ
    }
    return byExt;
}
class PathNameTreeItem {
    _parent;
    entry;
    static ROOT = "root:";
    static EMPTYFOLDERID = ":";
    static EMPTYFOLDER = {
        fileName: PathNameTreeItem.EMPTYFOLDERID,
        meta: { description: "empty folder", translatePathName: false },
        virtualFileName: PathNameTreeItem.EMPTYFOLDERID
    };
    children = new Map();
    id;
    isFile;
    label;
    /** call with undefined parent to create root, call with undefined entry to create folder */
    constructor(id, _parent, entry) {
        this._parent = _parent;
        this.entry = entry;
        this.label = id; // id used for UI label
        this.id = this.parent ? id : PathNameTreeItem.ROOT;
        this.isFile = (entry !== undefined); // only files have a PathNameTableEntry
    }
    set parent(parent) {
        if (this.parent === undefined) {
            throw new Error("root element can't be moved");
        }
        else {
            this._parent = parent;
        }
    }
    get parent() {
        return this._parent;
    }
    /** calculated using parent */
    fullID() {
        return path.join(this.parent?.fullID() ?? "", this.id);
    }
    /** calculated using parent */
    virtualPath() {
        if (this.parent) {
            return [...this.parent.virtualPath(), ...(this.isFile ? [] : [this.id])];
        }
        return [];
    }
    /** calculated using parent */
    getTableEntries(excludEmpty = false) {
        if (this.isFile) {
            return [{ ...this.entry, virtualPath: this.virtualPath() }];
        }
        else {
            let files = [...this.files().flatMap(e => e.getTableEntries())];
            if (this.children.size === 0 && !excludEmpty) {
                files = [this.emptyFolder()];
            }
            let subfiles = [...this.folders().flatMap(e => e.getTableEntries(excludEmpty))];
            return [...files, ...subfiles];
        }
    }
    emptyFolder() {
        return { ...PathNameTreeItem.EMPTYFOLDER,
            virtualPath: this.virtualPath() };
    }
    getTreeItem() {
        let collapsible;
        if (this.isFile || this.children.size === 0) {
            collapsible = vscode.TreeItemCollapsibleState.None;
        }
        else {
            //expand folders containing only subfolders
            if (this.files().length === 0) {
                collapsible = vscode.TreeItemCollapsibleState.Expanded;
            }
            else {
                collapsible = vscode.TreeItemCollapsibleState.Collapsed;
            }
        }
        const item = new vscode.TreeItem(this.label, collapsible);
        item.id = this.fullID();
        // tooltip, uri command
        if (this.entry) {
            item.tooltip = this.entry.fileName;
            if (this.entry.meta) {
                item.tooltip += `\n\n${JSON.stringify(this.entry.meta)}`;
            }
            //item.resourceUri = this.uri;
            //item.description = true;
            //item.command = ...
        }
        //icon
        if (this.isFile) {
            if (this.entry?.meta?.translatePathName === true) {
                item.iconPath = new vscode.ThemeIcon("book");
            }
            else {
                item.iconPath = vscode.ThemeIcon.File;
            }
        }
        else if (this.getTableEntries(true).length === 0) { // empty folder
            item.iconPath = new vscode.ThemeIcon("folder", new vscode.ThemeColor("errorForeground"));
            item.label = item.label + " [empty]";
        } // don't show folder icon, horizontal positioning is counter-intuitive
        return item;
    }
    folders(excludeEmpty = false) {
        return [...this.children.values()].filter(e => e.isFile === false && !(excludeEmpty && e.id === PathNameTreeItem.EMPTYFOLDERID));
    }
    files() {
        return [...this.children.values()].filter(e => e.isFile === true);
    }
    addChild(id, entry) {
        const newItem = new PathNameTreeItem(id, this, entry);
        this.children.set(newItem.id, newItem);
        return newItem;
    }
    deleteChild(id) {
        this.children.delete(id);
    }
    static compareLabel(a, b) {
        return a.label.localeCompare(b.label);
    }
}
class PathNameTableView {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    static treeMime = 'application/vnd.code.tree.pathnametableview';
    dropMimeTypes = [PathNameTableView.treeMime];
    dragMimeTypes = [PathNameTableView.treeMime];
    root = new PathNameTreeItem("Pathnametable not loaded");
    /** hash for known extensions */
    static knownImageExtensions = { ".jpg": undefined,
        ".jpeg": undefined,
        ".tif": undefined,
        ".tiff": undefined,
        ".svg": undefined,
        ".gif": undefined,
        ".bmp": undefined };
    constructor(context) {
        let view = vscode.window.createTreeView('PathNameTableView', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true, dragAndDropController: this });
        context.subscriptions.push(view);
        // TODO actions
        // sort
        // expand all
        // delete empty folders
        // create folder
        // move selection to folder
    }
    /** reads JSON in active editor, then triggers a refresh of the UI */
    refresh() {
        const filename = path.basename(vscode.window.activeTextEditor?.document.fileName ?? "");
        let json = [];
        let message;
        if (/^pathnametable.*?\.json$/i.test(filename)) {
            try {
                json = JSON.parse(vscode.window.activeTextEditor.document.getText());
                const numberOfLibparts = json.filter(e => path.extname(e.fileName) === ".gsm").length;
                const numberOfImages = json.filter(e => path.extname(e.fileName) in PathNameTableView.knownImageExtensions).length;
                message = `${filename}: ${json.length} entries, ${numberOfLibparts} libparts, ${numberOfImages} images`;
            }
            catch (e) {
                message = "bad pathnametable JSON format";
            }
        }
        else {
            message = "only PathNameTable*.json is handled";
        }
        this.createTree(json, message);
    }
    /** creates tree by virtualPath */
    createTree(json, message) {
        this.root = new PathNameTreeItem(message);
        for (const entry of json) {
            let parent = this.root;
            for (const folder of entry.virtualPath) {
                let nextParent = parent.children.get(folder);
                if (nextParent === undefined) {
                    nextParent = parent.addChild(folder, undefined);
                }
                parent = nextParent;
            }
            if (entry.fileName !== PathNameTreeItem.EMPTYFOLDERID) {
                parent.addChild(entry.virtualFileName, entry);
            }
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element.getTreeItem();
    }
    getChildren(element) {
        if (element === undefined) { // provide root element
            return [this.root];
        }
        const sortedFolders = [...element.folders()].sort(PathNameTreeItem.compareLabel);
        const sortedFiles = [...element.files()].sort(PathNameTreeItem.compareLabel);
        return [...sortedFolders, ...sortedFiles];
    }
    handleDrag(source, dataTransfer, _token) {
        dataTransfer.set(PathNameTableView.treeMime, new vscode.DataTransferItem(source));
    }
    handleDrop(target, dataTransfer, _token) {
        const source = dataTransfer.get(PathNameTableView.treeMime)?.value;
        if (source === undefined) { //how can we not have a source?
            return;
        }
        // when dropped on a file, move to parent folder
        if (target?.isFile) {
            target = target.parent;
        }
        if (target === undefined) {
            return;
        }
        // select which ones to handle
        const targetFullID = target.fullID();
        const filteredItems = source.filter(e => e.parent !== undefined && // not root element
            e.parent !== target && // target is not the existing parent
            e !== target && // target is not the same (with multi-selection)
            !targetFullID.startsWith(e.fullID() + path.sep)); // target is not subfolder of element
        // change parents
        for (const item of filteredItems) {
            item.parent.deleteChild(item.id);
            item.parent = target;
            target.children.set(item.id, item);
            // TODO merging two same-named folders (recurse!)
        }
        if (filteredItems.length > 0) {
            return this.saveChanges(); // will fire onDidChangeTreeData by editing document
        }
    }
    async saveChanges() {
        let tryagain;
        do {
            const success = await this.writeToEditor();
            if (!success) {
                tryagain = await vscode.window.showWarningMessage("Failed to save modifications to file", "Retry");
            }
        } while (tryagain !== undefined);
    }
    async writeToEditor() {
        const editor = vscode.window.activeTextEditor;
        const success = editor.edit(editBuilder => {
            const fullRange = editor.document.validateRange(new vscode.Range(0, 0, editor.document.lineCount, 0));
            let newData = this.root.getTableEntries().sort(compareFileName);
            const json = JSON.stringify(newData, undefined, 4);
            editBuilder.replace(fullRange, json);
        });
        return success;
    }
}
exports.PathNameTableView = PathNameTableView;
//# sourceMappingURL=libpack.js.map