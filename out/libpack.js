"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathNameTableView = exports.allPackages = void 0;
const vscode = require("vscode");
const path = require("path");
const extension_1 = require("./extension");
/** compare strings without locale algorithms */
function compareString(a, b) {
    return (a < b) ? -1 : (a > b ? 1 : 0);
}
/** compare lowercase, first by extension, then by filename */
function compareFileName(a, b) {
    const aCompare = a.fileName.toLocaleLowerCase();
    const bCompare = b.fileName.toLocaleLowerCase();
    const byExt = compareString(path.extname(aCompare), path.extname(bCompare));
    if (byExt === 0) {
        return compareString(aCompare, bCompare); // filenames have to differ
    }
    return byExt;
}
function escapeRegex(str) {
    return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}
/** return all package.infos in workspace */
async function allPackages() {
    const infos = await vscode.workspace.findFiles("**/package.info");
    const packageInfos = infos.map(async (info) => await PackageInfo.read(info));
    return (await Promise.allSettled(packageInfos)) // TODO write function for it, report rejected promises
        .flatMap(result => result.status === "fulfilled" ? result.value : undefined)
        .filter((e) => e !== undefined);
}
exports.allPackages = allPackages;
// TODO merge all pathnametables for selected localization
class PackageInfo {
    packageInfo;
    packageName;
    locDataUri;
    static async read(packageInfoUri) {
        const info = await (0, extension_1.readFile)(packageInfoUri, true);
        const packageTag = /(?<=^\s*<Package\s+).*?(?=>)/mi;
        const displayNameAttrib = /(?<=\bdisplayName\s*=\s*").*?(?=")/i;
        const locInfo = /(?<=^\s*<LocDataPath>).*?(?=<\/LocDataPath>)/mi;
        const packageAttribs = info?.match(packageTag)?.[0];
        const packageName = packageAttribs?.match(displayNameAttrib)?.[0];
        const locDataPath = info?.match(locInfo)?.[0];
        const locDataUri = vscode.Uri.joinPath(packageInfoUri, "..", locDataPath ?? "");
        const locData = await (0, extension_1.readFile)(locDataUri);
        if (packageAttribs === undefined ||
            packageName === undefined ||
            locDataPath === undefined ||
            locData === undefined) {
            return Promise.reject();
        }
        return new PackageInfo(packageInfoUri, packageName, locDataUri, locData);
    }
    /** locale -> LanguageFiles map.
     *  Contains entries of package.info->LocDataPath but file existence is not checked.
     */
    localization = new Map();
    mappingDefinitions = undefined;
    constructor(packageInfo, packageName, locDataUri, localizationData) {
        this.packageInfo = packageInfo;
        this.packageName = packageName;
        this.locDataUri = locDataUri;
        const mappingDefinitionsTag = /(?<=^\s*<MappingDefinitions>).*?(?=<\/MappingDefinitions>)/mig;
        const pathnametableTag = /(?<=^\s*<PathNameTable\s+).*?(?=\/>)/mig;
        const dictionaryTag = /(?<=^\s*<Dictionary\s+).*?(?=\/>)/mig;
        const languageAttrib = /(?<=\blanguage\s*=\s*").*?(?=")/i;
        const pathAttrib = /(?<=\bpath\s*=\s*").*?(?=")/i;
        const typeAttrib = /(?<=\btype\s*=\s*")(fileName|folderName|symbolStrings)(?=")/i;
        const mappingDefinitions = localizationData.match(mappingDefinitionsTag); // should contain at most one
        if (mappingDefinitions !== null) {
            const mappingDefinitions_path = path.join(packageInfo.fsPath, "..", mappingDefinitions[0]);
            this.mappingDefinitions = vscode.Uri.file(mappingDefinitions_path);
        }
        for (const tag of [...localizationData.matchAll(pathnametableTag)]) {
            const language = tag[0].match(languageAttrib)?.[0];
            const path = tag[0].match(pathAttrib)?.[0];
            if (language !== undefined && path !== undefined) {
                const uri = vscode.Uri.joinPath(locDataUri, "..", path ?? "");
                this.localization.set(language, { pathNameTable: uri });
            }
        }
        for (const tag of [...localizationData.matchAll(dictionaryTag)]) {
            const language = tag[0].match(languageAttrib)?.[0];
            const path = tag[0].match(pathAttrib)?.[0];
            const type = tag[0].match(typeAttrib)?.[0];
            if (language !== undefined && path !== undefined && type !== undefined) {
                const uri = vscode.Uri.joinPath(locDataUri, "..", path ?? "");
                let dictionary = this.localization.get(language);
                if (dictionary === undefined) {
                    dictionary = {};
                    this.localization.set(language, dictionary);
                }
                if (type === "fileName") {
                    dictionary.fileDictionary = uri;
                }
                else if (type === "folderName") {
                    dictionary.folderDictionary = uri;
                }
                else if (type === "symbolStrings") {
                    dictionary.scriptDictionary = uri;
                }
            }
        }
    }
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
        // context, tooltip, command
        if (this.isFile) { // file
            item.contextValue = "file";
            item.tooltip = this.entry.fileName;
            if (this.entry.meta) {
                item.tooltip += `\n\n${JSON.stringify(this.entry.meta)}`;
            }
            item.command = { command: "GDL.PNTV.showInFile",
                arguments: [this],
                title: "" };
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
            const fileTypes = entries.map(e => PathNameTableView.typeByExtension(e.fileName));
            const numberOfLibparts = fileTypes.reduce((count, e) => (e === 1 /* LibpartType.SCRIPT */) ? count + 1 : count, 0);
            const numberOfImages = fileTypes.reduce((count, e) => (e === 2 /* LibpartType.IMAGE */) ? count + 1 : count, 0);
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
            while (this.children.has(item.id)) { // TODO this checks direct children only
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
    static lineHighLight = vscode.window.createTextEditorDecorationType({
        borderColor: new vscode.ThemeColor("editor.wordHighlightTextBorder"),
        borderWidth: "1px",
        borderStyle: "solid",
        backgroundColor: new vscode.ThemeColor("editor.wordHighlightTextBackground"),
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        overviewRulerColor: new vscode.ThemeColor("minimap.selectionOccurrenceHighlight")
    });
    static typeByExtension(fileName) {
        const ext = path.extname(fileName).toLowerCase();
        if (ext === ".gsm")
            return 1 /* LibpartType.SCRIPT */;
        if (extension_1.GDLExtension.allowedImageTypes.has(ext))
            return 2 /* LibpartType.IMAGE */;
        return 0 /* LibpartType.OTHER */;
    }
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
            vscode.commands.registerCommand('GDL.PNTV.openFile', async (item) => this.openFile(item)),
        ];
        context.subscriptions.push(this.view, ...commands);
    }
    async checkContentWithProgress() {
        return vscode.window.withProgress({ location: { viewId: PathNameTableView.VIEWID },
            title: "Checking pathnametable..." }, async (p, t) => this.checkContent(p, t));
    }
    /** return path of package.info of currently edited document */
    async getPackagePath() {
        // find package.info by stepping upwards
        let packagePath = vscode.window.activeTextEditor.document.fileName;
        let found;
        do {
            packagePath = path.join(packagePath, "..");
            found = (0, extension_1.fileExists)(vscode.Uri.file(path.join(packagePath, "package.info")));
        } while (path.join(packagePath, "..") !== packagePath && !(await found));
        if (!(await found)) {
            return undefined;
        }
        else {
            return packagePath;
        }
    }
    static warnPackageInfoNotFound() {
        vscode.window.showWarningMessage("Can't find \"package.info\", don't know where to look for source files.");
    }
    /** check that pathnametable entries match the files in source
     *
     *  localization files are checked against data in package.info
     */
    async checkContent(_progress, _token) {
        const packagePath = await this.getPackagePath();
        if (packagePath === undefined) {
            PathNameTableView.warnPackageInfoNotFound();
            // go on with saving changes to purge empty folders
        }
        else {
            // assume no duplicate names TODO check
            // collect differences
            const referredLibparts = new Map();
            const tableFiles = [...this.root].filter(e => e.isFile);
            const tableLibparts = new Map(tableFiles.map(e => [e.entry.fileName, e]));
            const packageinfo_uri = vscode.Uri.file(path.join(packagePath, "package.info"));
            const packageinfo = await PackageInfo.read(packageinfo_uri);
            // files in table
            const unneededInTable = new Set(tableLibparts.keys());
            // add source files
            const source_path = path.join(packagePath, "Source");
            for await (const uri of (0, extension_1.getLibparts)(vscode.Uri.file(source_path))) {
                const key = uri.binaryFileName;
                referredLibparts.set(key, uri);
                unneededInTable.delete(key);
            }
            // add localization files
            let loc_uris = [packageinfo.packageInfo,
                packageinfo.locDataUri,
                packageinfo.mappingDefinitions,
                ...[...packageinfo.localization.values()].flatMap(loc => [loc.pathNameTable,
                    loc.fileDictionary,
                    loc.folderDictionary,
                    loc.scriptDictionary])
            ];
            for (const uri of loc_uris) {
                if (uri !== undefined) {
                    const key = path.basename(uri.fsPath);
                    referredLibparts.set(key, { binaryFileName: key, sourceUri: uri });
                    unneededInTable.delete(key);
                }
            }
            // keep not found entries
            const missingFromTable = new Set(referredLibparts.keys());
            for (const key of tableLibparts.keys()) {
                missingFromTable.delete(key);
            }
            // change table data
            for (const key of unneededInTable) {
                const remove = tableLibparts.get(key);
                remove.parent.deleteChild(remove.id);
            }
            for (const key of missingFromTable) {
                const uri = referredLibparts.get(key);
                const relPath = path.relative(packagePath, uri.sourceUri.fsPath);
                this.addEntry({ fileName: uri.binaryFileName,
                    meta: { translatePathName: null },
                    virtualFileName: path.basename(key, path.extname(key)),
                    virtualPath: relPath.split(path.sep).slice(0, -1) });
            }
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
    /** return all selected items if input is undefined, exclude root item */
    getSelection(clickeditem) {
        if (clickeditem === undefined) {
            // called from keyboard shortcut
            if (this.view.selection.length === 0) {
                return [];
            }
            return this.view.selection.filter(e => !e.isRoot);
        }
        return clickeditem.isRoot ? [] : [clickeditem];
    }
    async copyVirtualPath(clickeditem) {
        const items = this.getSelection(clickeditem);
        const virtualpaths = items.map(item => path.join(...item.virtualPath()));
        return vscode.env.clipboard.writeText(virtualpaths.join("\n"));
    }
    async rename(clickeditem) {
        let changed = false;
        for (const item of this.getSelection(clickeditem)) {
            const input = await vscode.window.showInputBox({ ignoreFocusOut: true,
                value: item.label,
                valueSelection: [item.label.length, item.label.length],
                validateInput: (value) => this.validateRename(value, item),
                title: "Rename",
                prompt: `New virtual name of "${item.id}"` });
            if (input) {
                item.label = input;
                changed = true;
            }
        }
        if (changed) {
            return this.saveChanges();
        }
    }
    validateRename(value, item) {
        const labelLC = value.toLocaleLowerCase();
        const check = item.isFile ? this.root : item.parent.children.values();
        const all = [...check].flatMap(e => e).filter(e => e.fullID() !== item.fullID() && e.isFile === item.isFile);
        const duplicates = all.filter(e => e.label.toLocaleLowerCase() === labelLC);
        if (duplicates.length > 0) {
            if (item.isFile) {
                return `Virtual filename already exists for "${duplicates[0].entry.fileName}" at "${duplicates[0].virtualPath().join("/")}"`;
            }
            else {
                return { message: `Virtual foldername already exists at "${duplicates[0].virtualPath().join("/")}", content will be merged`,
                    severity: vscode.InputBoxValidationSeverity.Info };
            }
        }
        return undefined; // value is valid
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
    /** open selected file assuming filename is correct */
    async openFile(clickeditem) {
        for (const item of this.getSelection(clickeditem).filter(e => e.isFile)) {
            //const findFile = path.basename(item.entry.fileName, path.extname(item.entry.fileName)).toLocaleLowerCase();
            const findFile = item.entry.fileName.toLocaleLowerCase();
            const packagePath = await this.getPackagePath();
            if (packagePath === undefined) {
                PathNameTableView.warnPackageInfoNotFound();
                return;
            }
            let found = false;
            for await (const uri of (0, extension_1.getLibparts)(vscode.Uri.file(packagePath))) {
                if (uri.binaryFileName.toLocaleLowerCase() === findFile) {
                    found = true;
                    if (PathNameTableView.typeByExtension(item.entry.fileName) === 1 /* LibpartType.SCRIPT */) {
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(uri.sourceUri, "libpartdata.xml"));
                    }
                    else {
                        vscode.commands.executeCommand('vscode.open', uri.sourceUri);
                    }
                }
            }
            if (!found) {
                const baseName = path.basename(item.entry.fileName, path.extname(item.entry.fileName));
                vscode.window.showWarningMessage(`"${baseName}" not found in folder "${packagePath}"`);
            }
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
    createTree(json, rootDescription) {
        this.root = new PathNameTreeItem(rootDescription);
        json.forEach(e => this.addEntry(e));
        this._onDidChangeTreeData.fire();
    }
    /** adds an entry, creating folders as necessary */
    addEntry(entry) {
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
        const oldparents = filteredItems.map(e => e.parent).filter((e) => e !== undefined);
        // move subtree
        target.mergeChildren(filteredItems);
        // delete emptied folders recursively
        let checkparents = [...new Set(oldparents)]; // remove duplicates
        while (checkparents.length > 0) {
            const item = checkparents.pop();
            if (item.children.size === 0) {
                if (item.parent) {
                    checkparents.push(item.parent);
                    item.parent.deleteChild(item.id);
                }
            }
        }
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