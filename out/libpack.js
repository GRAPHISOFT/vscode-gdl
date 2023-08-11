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
    static ROOT = "root:";
    static EMPTYFOLDERID = ":";
    static EMPTYFOLDER = {
        fileName: PathNameTreeItem.EMPTYFOLDERID,
        meta: { description: "empty folder", translatePathName: false },
        virtualFileName: PathNameTreeItem.EMPTYFOLDERID
    };
    children = new Map();
    id;
    isFile = false;
    label;
    entry;
    /** call with string and undefined parent to create root, string to create folder, PathNameTableID to create file */
    constructor(id, _parent) {
        this._parent = _parent;
        if (!this.parent) {
            this.id = PathNameTreeItem.ROOT;
            this.label = id;
        }
        else {
            if (typeof id === "string") {
                this.id = id;
            }
            else { // id is PathNameTableID
                this.entry = id;
                this.id = id.virtualFileName.length > 0 ? id.virtualFileName : PathNameTreeItem.EMPTYFOLDERID;
                this.isFile = true;
            }
            this.label = this.id; // id used for UI label
        }
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
    *[Symbol.iterator]() {
        yield this;
        for (const child of this.children.values()) {
            yield* child;
        }
    }
    /** calculated using parent */
    getTableEntries(excludEmpty = false) {
        // TODO use iterator
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
        // context, tooltip, uri command
        if (this.isFile) { // file
            item.contextValue = "file";
            item.tooltip = this.entry.fileName;
            if (this.entry.meta) {
                item.tooltip += `\n\n${JSON.stringify(this.entry.meta)}`;
            }
            //item.resourceUri = this.uri;
            //item.description = true;
            //item.command = ...
        }
        else {
            if (this.id === PathNameTreeItem.ROOT) {
                item.contextValue = "root";
            }
            else {
                item.contextValue = "folder";
            }
            // count file types
            const entries = this.getTableEntries(true);
            const numberOfLibparts = entries.filter(e => path.extname(e.fileName) === ".gsm").length;
            const numberOfImages = entries.filter(e => path.extname(e.fileName) in PathNameTableView.knownImageExtensions).length;
            item.tooltip = `${entries.length} entries\n${numberOfLibparts} libparts\n${numberOfImages} images`;
        }
        // icon
        if (this.isFile) {
            if (this.entry?.meta?.translatePathName === true) {
                item.iconPath = new vscode.ThemeIcon("book");
            }
            else {
                item.iconPath = vscode.ThemeIcon.File;
            }
        }
        else if (this.parent && this.getTableEntries(true).length === 0) { // empty folder
            item.iconPath = new vscode.ThemeIcon("folder", new vscode.ThemeColor("errorForeground"));
            item.description = "[empty]";
        } // don't show folder icon, horizontal positioning is counter-intuitive
        return item;
    }
    folders(excludeEmpty = false) {
        return [...this.children.values()].filter(e => e.isFile === false && !(excludeEmpty && e.id === PathNameTreeItem.EMPTYFOLDERID));
    }
    files() {
        return [...this.children.values()].filter(e => e.isFile === true);
    }
    /** add folder with string, file with PathNameTableID, or existing item with PathNameTreeItem
     *
     *  rename virtualFileName if duplicate
     *
     *  re-root if existing item is used
     *
     *  return added PathNameTreeItem (new one if rename was necessary)
     */
    addChild(id) {
        let item;
        if (id instanceof PathNameTreeItem) { // existing entry
            item = id;
            item.parent = this;
        }
        else {
            item = new PathNameTreeItem(id, this);
        }
        if (item.isFile) {
            while (this.children.has(item.id)) {
                let newEntry = { ...item.entry }; // copy object
                newEntry.virtualFileName = `${item.id} duplicate`;
                item = new PathNameTreeItem(newEntry, this);
            }
        }
        this.children.set(item.id, item); // overwriting duplicate folder should be handled outside
        return item;
    }
    deleteChild(id) {
        this.children.delete(id);
    }
    /** recursively merge content from other distinct trees */
    mergeChildren(items) {
        for (const item of items) {
            item.parent.deleteChild(item.id);
            if (item.isFile) {
                this.addChild(item); // TODO show info on renames
            }
            else {
                if (this.children.has(item.id)) {
                    this.children.get(item.id).mergeChildren([...item.children.values()]);
                }
                else {
                    this.addChild(item);
                }
            }
        }
    }
    static compareLabel(a, b) {
        return a.label.localeCompare(b.label);
    }
}
class PathNameTableView {
    /** hash for known extensions */
    static knownImageExtensions = { ".jpg": undefined,
        ".jpeg": undefined,
        ".tif": undefined,
        ".tiff": undefined,
        ".svg": undefined,
        ".gif": undefined,
        ".bmp": undefined };
    static treeMime = 'application/vnd.code.tree.pathnametableview';
    dropMimeTypes = [PathNameTableView.treeMime];
    dragMimeTypes = [PathNameTableView.treeMime];
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    root = new PathNameTreeItem("Pathnametable not loaded");
    unsaved = false;
    view;
    constructor(context) {
        this.view = vscode.window.createTreeView('PathNameTableView', { treeDataProvider: this,
            showCollapseAll: true,
            canSelectMany: true,
            dragAndDropController: this });
        const commands = [
            vscode.commands.registerCommand('GDL.PNTV.deleteEmptyFolders', () => this.deleteEmptyFolders()),
            vscode.commands.registerCommand('GDL.PNTV.moveSelectionTo', () => this.moveSelectionTo()),
            vscode.commands.registerCommand('GDL.PNTV.expandAll', async (subtree) => await this.expandAll(subtree)),
            vscode.commands.registerCommand('GDL.PNTV.createSubPath', (item) => this.createSubPath(item)),
            vscode.commands.registerCommand('GDL.PNTV.copyVirtualPath', async (item) => this.copyVirtualPath(item)),
            vscode.commands.registerCommand('GDL.PNTV.showInFile', (item) => this.showInFile(item)),
        ];
        context.subscriptions.push(this.view, ...commands);
    }
    async expandAll(subtree) {
        for (const item of subtree ?? this.root) {
            if (!item.isFile) {
                await this.view.reveal(item, { select: false,
                    expand: true });
            }
        }
    }
    deleteEmptyFolders() {
    }
    createSubPath(item) {
    }
    moveSelectionTo() {
    }
    async copyVirtualPath(item) {
        return vscode.env.clipboard.writeText(path.join(...item.virtualPath()));
    }
    showInFile(item) {
    }
    /** reads JSON in active editor, then triggers a refresh of the UI */
    refresh() {
        const filename = path.basename(vscode.window.activeTextEditor?.document.fileName ?? "");
        let json = [];
        let message;
        this.unsaved = false;
        if (/^pathnametable.*?\.json$/i.test(filename)) {
            try {
                json = JSON.parse(vscode.window.activeTextEditor.document.getText());
                message = filename;
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
                    nextParent = parent.addChild(folder);
                }
                parent = nextParent;
            }
            if (entry.fileName !== PathNameTreeItem.EMPTYFOLDERID) {
                const added = parent.addChild(entry);
                if (added.entry.virtualFileName !== entry.virtualFileName) {
                    this.unsaved = true;
                    const virtualPath = path.join(...entry.virtualPath);
                    vscode.window.showInformationMessage(`renamed duplicate virtual name ${entry.virtualFileName} at ${virtualPath}`);
                }
            }
        }
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        let treeItem = element.getTreeItem();
        // show if tree is unsaved
        if (element === this.root && this.unsaved) {
            treeItem.description = "[tree changes not shown in editor]";
            treeItem.iconPath = new vscode.ThemeIcon("circle-filled");
        }
        return treeItem;
    }
    getChildren(element) {
        if (element === undefined) { // provide root element
            return [this.root];
        }
        const sortedFolders = [...element.folders()].sort(PathNameTreeItem.compareLabel);
        const sortedFiles = [...element.files()].sort(PathNameTreeItem.compareLabel);
        return [...sortedFolders, ...sortedFiles];
    }
    getParent(element) {
        return element.parent;
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
        // move subtree
        target.mergeChildren(filteredItems);
        if (filteredItems.length > 0) {
            return this.saveChanges();
        }
    }
    /** will fire onDidChangeTreeData by editing document */
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