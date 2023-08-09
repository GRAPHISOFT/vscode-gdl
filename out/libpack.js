"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathNameTableView = exports.PathNameTreeItem = void 0;
const vscode = require("vscode");
const path = require("path");
class PathNameTreeItem {
    constructor(folders, files, label, id = "root:") {
        this.label = label;
        this.id = id;
        this.folders = new Map(folders.map(e => [e.label, e]));
        this.files = new Map(files.map(e => [e.label, e]));
    }
    getTreeItem() {
        const collapsible = (this.folders.size + this.files.size) > 0 ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        const item = new vscode.TreeItem(this.label, collapsible);
        item.id = this.id;
        return item;
    }
}
exports.PathNameTreeItem = PathNameTreeItem;
class PathNameTableView {
    constructor(extension) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.root = new PathNameTreeItem([], [], "Pathnametable not loaded");
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
        this.root = new PathNameTreeItem([], [], message);
        for (const entry of json) {
            let parent = this.root;
            for (const folder of entry.virtualPath) {
                let nextParent = parent.folders.get(folder);
                if (nextParent === undefined) {
                    const newItem = new PathNameTreeItem([], [], folder, path.join(parent.id, folder));
                    parent.folders.set(folder, newItem);
                    nextParent = newItem;
                }
                parent = nextParent;
            }
            const id = path.join(...entry.virtualPath, entry.virtualFileName);
            parent.files.set(entry.virtualFileName, new PathNameTreeItem([], [], entry.virtualFileName, id));
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
        return [...element.folders.values(), ...element.files.values()];
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