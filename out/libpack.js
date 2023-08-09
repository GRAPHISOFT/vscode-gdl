"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathNameTableView = exports.PathNameTreeItem = void 0;
const vscode = require("vscode");
const path = require("path");
class VirtualPath {
    isFile;
    pathParts;
    id;
    static ROOT = "root:";
    constructor(isFile, pathParts = []) {
        this.isFile = isFile;
        this.pathParts = pathParts;
        this.id = path.join(VirtualPath.ROOT, ...this.pathParts);
    }
}
class PathNameTreeItem {
    entry;
    label;
    virtualPath;
    children;
    parent = undefined;
    constructor(entry, children, label, virtualPath) {
        this.entry = entry;
        this.label = label;
        this.virtualPath = virtualPath;
        this.children = new Map(children.map(e => [e.virtualPath.id, e]));
    }
    getTreeItem() {
        let collapsible;
        if (this.virtualPath.isFile) {
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
        item.id = this.virtualPath.id;
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
        if (this.virtualPath.isFile) {
            if (this.entry?.meta?.translatePathName === true) {
                item.iconPath = new vscode.ThemeIcon("book");
            }
            else {
                item.iconPath = vscode.ThemeIcon.File;
            }
        } // don't show folder icon, horizontal positioning is counter-intuitive
        return item;
    }
    folders() {
        return [...this.children.values()].filter(e => e.virtualPath.isFile === false);
    }
    files() {
        return [...this.children.values()].filter(e => e.virtualPath.isFile === true);
    }
    static compareLabel(a, b) {
        return a.label.localeCompare(b.label);
    }
}
exports.PathNameTreeItem = PathNameTreeItem;
class PathNameTableView {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    static treeMime = 'application/vnd.code.tree.pathnametableview';
    dropMimeTypes = [PathNameTableView.treeMime];
    dragMimeTypes = [PathNameTableView.treeMime];
    root = new PathNameTreeItem(undefined, [], "Pathnametable not loaded", new VirtualPath(false));
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
        this.root = new PathNameTreeItem(undefined, [], message, new VirtualPath(false));
        for (const entry of json) {
            let parent = this.root;
            for (const folder of entry.virtualPath) {
                const newPath = new VirtualPath(false, [...parent.virtualPath.pathParts, folder]);
                let nextParent = parent.children.get(newPath.id);
                if (nextParent === undefined) {
                    const newItem = new PathNameTreeItem(undefined, [], folder, newPath);
                    newItem.parent = parent;
                    parent.children.set(newPath.id, newItem);
                    nextParent = newItem;
                }
                parent = nextParent;
            }
            const newPath = new VirtualPath(true, [...entry.virtualPath, entry.virtualFileName]);
            const newItem = new PathNameTreeItem(entry, [], entry.virtualFileName, newPath);
            newItem.parent = parent;
            parent.children.set(newPath.id, newItem);
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
        if (target?.virtualPath.isFile) {
            target = target.parent;
        }
        if (target === undefined) {
            return;
        }
        const filteredEntries = source.filter(e => e.parent !== undefined && // not root element
            e.parent.virtualPath.id !== target.virtualPath.id && // target is not the existing parent
            !target.virtualPath.id.startsWith(e.virtualPath.id)); // target is not the same or subfolder of element
        const oldParents = filteredEntries.map(e => e.parent);
        for (const entry of filteredEntries) {
            const oldID = entry.virtualPath.id;
            entry.virtualPath = new VirtualPath(entry.virtualPath.isFile, [...target.virtualPath.pathParts, entry.virtualPath.pathParts.at(-1)]);
            entry.parent.children.delete(oldID);
            entry.parent = target;
            target.children.set(entry.virtualPath.id, entry);
        }
        this._onDidChangeTreeData.fire([...oldParents, target]);
    }
}
exports.PathNameTableView = PathNameTableView;
//# sourceMappingURL=libpack.js.map