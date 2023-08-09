"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathNameTableView = exports.PathNameTreeItem = void 0;
const vscode = require("vscode");
const path = require("path");
class PathNameTreeItem {
    constructor(entry, folders, files, label, id = "root:") {
        this.entry = entry;
        this.label = label;
        this.id = id;
        this.folders = new Map(folders.map(e => [e.label, e]));
        this.files = new Map(files.map(e => [e.label, e]));
    }
    getTreeItem() {
        //expand folders containing only subfolders
        let collapsible;
        if (this.folders.size > 0 && this.files.size === 0) {
            collapsible = vscode.TreeItemCollapsibleState.Expanded;
        }
        else {
            if (this.files.size > 0) {
                collapsible = vscode.TreeItemCollapsibleState.Collapsed;
            }
            else {
                collapsible = vscode.TreeItemCollapsibleState.None;
            }
        }
        const item = new vscode.TreeItem(this.label, collapsible);
        item.id = this.id;
        if (this.entry) {
            item.tooltip = this.entry.fileName;
            if (this.entry.meta) {
                item.tooltip += `\n\n${JSON.stringify(this.entry.meta)}`;
            }
            //item.resourceUri = this.uri;
            //item.description = true;
        }
        if (this.folders.size + this.files.size > 0) {
            item.iconPath = vscode.ThemeIcon.Folder;
        }
        else {
            if (this.entry?.meta?.translatePathName === true) {
                item.iconPath = new vscode.ThemeIcon("book");
            }
            else {
                item.iconPath = vscode.ThemeIcon.File;
            }
        }
        return item;
    }
    static compareLabel(a, b) {
        return a.label.localeCompare(b.label);
    }
}
exports.PathNameTreeItem = PathNameTreeItem;
class PathNameTableView {
    constructor(extension) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.root = new PathNameTreeItem(undefined, [], [], "Pathnametable not loaded");
        console.log("PathNameTableView constructor called");
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
        this.root = new PathNameTreeItem(undefined, [], [], message);
        for (const entry of json) {
            let parent = this.root;
            for (const folder of entry.virtualPath) {
                let nextParent = parent.folders.get(folder);
                if (nextParent === undefined) {
                    const newItem = new PathNameTreeItem(undefined, [], [], folder, path.join(parent.id, folder));
                    parent.folders.set(folder, newItem);
                    nextParent = newItem;
                }
                parent = nextParent;
            }
            const id = path.join(...entry.virtualPath, entry.virtualFileName);
            parent.files.set(entry.virtualFileName, new PathNameTreeItem(entry, [], [], entry.virtualFileName, id));
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
        const sortedFolders = [...element.folders.values()].sort(PathNameTreeItem.compareLabel);
        const sortedFiles = [...element.files.values()].sort(PathNameTreeItem.compareLabel);
        return [...sortedFolders, ...sortedFiles];
    }
}
exports.PathNameTableView = PathNameTableView;
// hash for known extensions
PathNameTableView.knownImageExtensions = { ".jpg": undefined,
    ".jpeg": undefined,
    ".tif": undefined,
    ".tiff": undefined,
    ".svg": undefined,
    ".gif": undefined,
    ".bmp": undefined };
//# sourceMappingURL=libpack.js.map