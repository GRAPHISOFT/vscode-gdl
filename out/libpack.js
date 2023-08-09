"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathNameTableView = void 0;
const vscode = require("vscode");
const path = require("path");
class PathNameTableView {
    constructor(extension) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.entries = new Map();
        this.root = { valid: false,
            message: "PathNameTable not loaded" };
        console.log("PathNameTableView constructor called");
    }
    refresh() {
        const filename = path.basename(vscode.window.activeTextEditor?.document.fileName ?? "");
        let json = [];
        if (/^pathnametable.*?\.json$/i.test(filename)) {
            try {
                json = JSON.parse(vscode.window.activeTextEditor.document.getText());
                const numberOfLibparts = json.filter(e => path.extname(e.fileName) === ".gsm").length;
                const numberOfImages = json.filter(e => path.extname(e.fileName) in PathNameTableView.knownImageExtensions).length;
                this.root = { valid: true, message: `${filename}: ${json.length} entries, ${numberOfLibparts} libparts, ${numberOfImages} images` };
            }
            catch (e) {
                this.root = { valid: false, message: "bad pathnametable JSON format" };
            }
        }
        else {
            this.root = { valid: false, message: "only PathNameTable*.json is handled" };
        }
        this.entries = new Map(json.map(e => [e.fileName, e]));
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        if ('valid' in element) {
            const collapsible = element.valid ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
            return new vscode.TreeItem(element.message, collapsible);
        }
        else {
            return new vscode.TreeItem(element.fileName);
        }
    }
    getChildren(element) {
        if (element === undefined) {
            return [this.root];
        }
        return [...this.entries.values()].sort();
        ;
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