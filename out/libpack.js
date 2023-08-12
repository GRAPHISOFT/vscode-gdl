"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathNameTableView = void 0;
const vscode = require("vscode");
const path = require("path");
const extension_1 = require("./extension");
function compareFileName(a, b) {
    // first by extension
    const byExt = path.extname(a.fileName).localeCompare(path.extname(b.fileName));
    if (byExt === 0) {
        return a.fileName.localeCompare(b.fileName); // filenames have to differ
        // TODO Essential AUT order changed!
    }
    return byExt;
}
function escapeRegex(str) {
    return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
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
    _id = "";
    isFile = false;
    isRoot = false;
    _label = "";
    entry;
    /** call with string and undefined parent to create root, string to create folder, PathNameTableID to create file */
    constructor(id, _parent) {
        this._parent = _parent;
        if (!this.parent) {
            this.label = id;
            this._id = PathNameTreeItem.ROOT;
            this.isRoot = true;
        }
        else {
            if (typeof id === "string") {
                this.label = id;
            }
            else { // id is PathNameTableID
                this.entry = id;
                this.label = id.virtualFileName;
                this.isFile = true;
            }
        }
    }
    set parent(parent) {
        if (this.isRoot) {
            throw new Error("root element can't be moved");
        }
        else {
            if (parent === undefined) {
                throw new RangeError("non-root elements must have a parent");
            }
            this._parent = parent;
        }
    }
    get parent() {
        return this._parent;
    }
    /** based on label */
    get id() {
        return this._id;
    }
    /** change label, name and ID */
    set label(label) {
        this._label = label.length > 0 ? label : PathNameTreeItem.EMPTYFOLDERID;
        if (!this.isRoot) {
            this._id = this._label; // id can be UI label as long as there are no duplicates
            if (this.isFile) {
                this.entry.virtualFileName = this._label;
            }
        }
    }
    get label() {
        return this._label;
    }
    /** calculated using parent */
    fullID() {
        return path.join(this.parent?.fullID() ?? "", this.id);
    }
    /** calculated using parent */
    virtualPath() {
        if (this.isRoot) {
            return [];
        }
        return [...this.parent.virtualPath(), ...(this.isFile ? [] : [this.label])];
    }
    *[Symbol.iterator]() {
        yield this;
        for (const child of this.children.values()) {
            yield* child;
        }
    }
    getTableEntries(excludeEmpty = false) {
        return [...this].flatMap(e => {
            if (e.isFile) {
                return [{ ...e.entry, virtualPath: e.virtualPath() }];
            }
            else if (e.children.size === 0 && !excludeEmpty) {
                return [e.emptyFolder()];
            }
            return [];
        });
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
            //item.command = ...
        }
        else {
            if (this.isRoot) {
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
        else if (!this.isRoot && this.getTableEntries(true).length === 0) { // empty folder
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
    static lineHighLight = vscode.window.createTextEditorDecorationType({
        borderColor: new vscode.ThemeColor("editor.wordHighlightTextBorder"),
        borderWidth: "1px",
        borderStyle: "solid",
        backgroundColor: new vscode.ThemeColor("editor.wordHighlightTextBackground"),
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        overviewRulerColor: new vscode.ThemeColor("minimap.selectionOccurrenceHighlight")
    });
    static VIEWID = "PathNameTableView";
    static treeMime = 'application/vnd.code.tree.pathnametableview';
    dropMimeTypes = [PathNameTableView.treeMime];
    dragMimeTypes = [PathNameTableView.treeMime];
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    root = new PathNameTreeItem("Pathnametable not loaded");
    unsaved = false;
    view;
    constructor(context) {
        this.view = vscode.window.createTreeView(PathNameTableView.VIEWID, { treeDataProvider: this,
            showCollapseAll: true,
            canSelectMany: true,
            dragAndDropController: this });
        const commands = [
            vscode.commands.registerCommand('GDL.PNTV.checkContent', async () => this.checkContentWithProgress()),
            vscode.commands.registerCommand('GDL.PNTV.expandAll', async (subtree) => this.expandAll(subtree)),
            vscode.commands.registerCommand('GDL.PNTV.createSubPath', async (item) => this.createSubPath(item)),
            vscode.commands.registerCommand('GDL.PNTV.copyVirtualPath', async (item) => this.copyVirtualPath(item)),
            vscode.commands.registerCommand('GDL.PNTV.rename', async (item) => this.rename(item)),
            vscode.commands.registerCommand('GDL.PNTV.showInFile', async (item) => this.showInFile(item)),
        ];
        context.subscriptions.push(this.view, ...commands);
    }
    async checkContentWithProgress() {
        return vscode.window.withProgress({ location: { viewId: PathNameTableView.VIEWID },
            title: "Checking pathnametable..." }, async (p, t) => this.checkContent(p, t));
    }
    async checkContent(_progress, _token) {
        // find package.info by stepping upwards
        let searchPath = vscode.window.activeTextEditor.document.fileName;
        let found;
        do {
            searchPath = path.join(searchPath, "..");
            found = (0, extension_1.fileExists)(vscode.Uri.file(path.join(searchPath, "package.info")));
        } while (path.join(searchPath, "..") !== searchPath && !(await found));
        // use ./Source folder as source
        if (!(await found)) {
            vscode.window.showWarningMessage("Can't find \"package.info\", don't know where to look for source files.");
        }
        else {
            // assume no duplicate names TODO check
            const diskLibparts = new Map();
            const tableLibparts = new Set(this.root.getTableEntries(true).map(e => {
                // pathnametable contains binary filenames, source filenames are different
                return e.fileName.replace(/\.gsm$/i, "")
                    .replace(/\.tif$/i, ".svg");
            }));
            const unneededInTable = new Set(tableLibparts);
            unneededInTable.delete("mappingDefinitions.json"); // TODO handle based on localizationdata.info
            for await (const libpart of (0, extension_1.getLibparts)(vscode.Uri.file(searchPath))) {
                const key = path.basename(libpart.fsPath);
                diskLibparts.set(key, libpart);
                unneededInTable.delete(key);
            }
            const missingFromTable = new Set(diskLibparts.keys());
            for (const key of tableLibparts) {
                missingFromTable.delete(key);
            }
            console.log({ unneeded: unneededInTable, missing: missingFromTable });
        }
        return this.saveChanges(true);
    }
    async expandAll(subtree) {
        for (const item of subtree ?? this.root) {
            if (!item.isFile) {
                await this.view.reveal(item, { select: false,
                    expand: true });
            }
        }
    }
    async createSubPath(item) {
        const atpath = path.join(...item.virtualPath());
        const subpath = await vscode.window.showInputBox({ ignoreFocusOut: true,
            placeHolder: "some\\path or some/path",
            title: "Enter sub-path to create",
            prompt: `${atpath}${path.sep}...` });
        if (subpath) {
            //console.log(path.join(atpath, subpath));
            let next = item;
            for (const folder of subpath.replace(/[\\/]$/, "").split(/[\\/]/)) { //remove trailing separator
                if (next.children.has(folder)) {
                    next = next.children.get(folder);
                }
                else {
                    next = next.addChild(folder);
                }
            }
            await this.saveChanges(); //can't expand before save finishes
            return this.expandAll(next);
        }
    }
    async copyVirtualPath(item) {
        return vscode.env.clipboard.writeText(path.join(...item.virtualPath()));
    }
    async rename(item) {
        const input = await vscode.window.showInputBox({ ignoreFocusOut: true,
            placeHolder: "new name",
            title: "Rename",
            prompt: item.id });
        if (input) {
            item.label = input;
            return this.saveChanges();
        }
    }
    async showInFile(item) {
        // JSON.parse can't save the original text position, so we have to search, assuming there aren't duplicate keys
        // search for original filename keys, these aren't changed
        const escapedFilename = escapeRegex(item.entry.fileName);
        const findFileName = new RegExp(`(?<!\\\\)"fileName"\\s*:\\s*"${escapedFilename}"`, "igd");
        const editor = vscode.window.activeTextEditor;
        const document = editor.document;
        const text = document.getText();
        const matches = [...text.matchAll(findFileName)];
        if (matches.length === 0) {
            vscode.window.showWarningMessage(`"fileName": "${item.entry.fileName}" not found in text`);
        }
        else {
            const ranges = matches.map(e => {
                const match = e.indices[0];
                return new vscode.Range(document.positionAt(match[0]), document.positionAt(match[1]));
            });
            // reveal first match
            editor.revealRange(ranges[0], vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            // highlight all matches
            editor.setDecorations(PathNameTableView.lineHighLight, ranges);
            // remove highlights after cursor change
            const onetime = vscode.window.onDidChangeTextEditorSelection((e) => {
                if (e.textEditor === editor) {
                    editor.setDecorations(PathNameTableView.lineHighLight, []);
                    onetime.dispose();
                }
            });
        }
    }
    /** reads JSON in active editor, then triggers a refresh of the UI */
    refreshFromEditor() {
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
        const filteredItems = source.filter(e => !e.isRoot && // not root element
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
    async saveChanges(excludEmpty = false) {
        let tryagain;
        do {
            const success = await this.writeToEditor(excludEmpty);
            if (!success) {
                tryagain = await vscode.window.showWarningMessage("Failed to save modifications to file", "Retry");
            }
        } while (tryagain !== undefined);
    }
    async writeToEditor(excludEmpty = false) {
        const editor = vscode.window.activeTextEditor;
        const success = editor.edit(editBuilder => {
            const fullRange = editor.document.validateRange(new vscode.Range(0, 0, editor.document.lineCount, 0));
            let newData = this.root.getTableEntries(excludEmpty).sort(compareFileName);
            const json = JSON.stringify(newData, undefined, 4);
            editBuilder.replace(fullRange, json);
        });
        return success;
    }
}
exports.PathNameTableView = PathNameTableView;
//# sourceMappingURL=libpack.js.map