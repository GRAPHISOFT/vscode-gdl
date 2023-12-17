import * as vscode from 'vscode';

import path = require('path');
import { GDLExtension, LibpartUri, fileExists, getLibparts, readFile } from './extension';

type RegExpMatchArrayWithIndices = RegExpMatchArray & { indices: Array<[number, number]> };

type PathNameTableID = {
    fileName: string,
    meta?: { translatePathName?: boolean | null },
    virtualFileName: string 
}

/** compare strings without locale algorithms */
function compareString(a: string, b: string): number {
    return (a < b) ? -1 : (a > b ? 1 : 0);
}

/** compare lowercase, first by extension, then by filename */
function compareFileName(a: PathNameTableID, b: PathNameTableID) {
    const aCompare = a.fileName.toLocaleLowerCase();
    const bCompare = b.fileName.toLocaleLowerCase();
    const byExt = compareString(path.extname(aCompare), path.extname(bCompare));
    if (byExt === 0) {
        return compareString(aCompare, bCompare);    // filenames have to differ
    }
    return byExt;
}

function escapeRegex(str: string) {
    return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

/** return all package.infos in workspace */
export async function allPackages(): Promise<PackageInfo[]> {
    const infos = await vscode.workspace.findFiles("**/package.info");
    const packageInfos = infos.map(async info => await PackageInfo.read(info));
    return (await Promise.allSettled(packageInfos)) // TODO write function for it, report rejected promises
        .flatMap(result => result.status === "fulfilled" ? result.value : undefined)
        .filter((e) : e is PackageInfo => e !== undefined);
}

// TODO parse all libpartdata->localizationinfo
// create localization-pathnametable pairs
// merge all pathnametables for selected localization
class PackageInfo {
    static async read(packageInfoUri: vscode.Uri): Promise<PackageInfo> {
        const info = await readFile(packageInfoUri, true);

        const packageTag = /(?<=^\s*<Package\s+).*?(?=>)/mi;
        const displayNameAttrib = /(?<=\bdisplayName\s*=\s*").*?(?=")/i;
        const locInfo = /(?<=^\s*<LocDataPath>).*?(?=<\/LocDataPath>)/mi;

        const packageAttribs = info?.match(packageTag)?.[0];
        const packageName = packageAttribs?.match(displayNameAttrib)?.[0];
        const locDataPath = info?.match(locInfo)?.[0];

        const locDataUri = vscode.Uri.joinPath(packageInfoUri, "..", locDataPath ?? "")
        const locData = await readFile(locDataUri);

        if (packageAttribs === undefined ||
            packageName === undefined ||
            locDataPath === undefined ||
            locData === undefined) {
            return Promise.reject();
        }

        return new PackageInfo(packageInfoUri, packageName, locDataUri, locData);
        
    }

    /** locale -> pathNameTable map.
     *  Contains only entries with both sides filled but file existence is not checked.
     */
    public readonly _pathNameTableLocalizations: Map<string, vscode.Uri>;

    constructor(public readonly packageInfo: vscode.Uri,
                public readonly packageName: string,
                public readonly locDataUri: vscode.Uri,
                localizationData: string) {

        const pathnametableTag = /(?<=^\s*<PathNameTable\s+).*?(?=\/>)/mig;
        const languageAttrib = /(?<=\blanguage\s*=\s*").*?(?=")/i;
        const pathAttrib = /(?<=\bpath\s*=\s*").*?(?=")/i;
        
        const pathNameTableTags = [...localizationData.matchAll(pathnametableTag)];
        this._pathNameTableLocalizations = new Map(pathNameTableTags.map(tag => {
            const language = tag[0].match(languageAttrib)?.[0];
            const path = tag[0].match(pathAttrib)?.[0];
            if (language === undefined || path === undefined) {
                return undefined;
            }
            return [language, vscode.Uri.joinPath(locDataUri, "..", path ?? "")];
        }).filter((e) : e is [string, vscode.Uri] => e !== undefined));
    }
}


type PathNameTableEntry = PathNameTableID & {
    virtualPath: string[],
}

class PathNameTreeItem 
    implements Iterable<PathNameTreeItem>
{

    static readonly ROOT = "root:";
    static readonly EMPTYFOLDERID = ":";
    static readonly EMPTYFOLDER = {
        fileName: PathNameTreeItem.EMPTYFOLDERID,
        meta: { description: "empty folder", translatePathName: false },
        virtualFileName: PathNameTreeItem.EMPTYFOLDERID    
    }

    public children: Map<string, PathNameTreeItem> = new Map();
    private _id: string = "";
    public readonly isFile: boolean = false;
    public readonly isRoot: boolean = false;
    private _label: string = "";
    public readonly entry?: PathNameTableID;

    /** call with string and undefined parent to create root, string to create folder, PathNameTableID to create file */
    constructor(id: string | PathNameTableID, private _parent?: PathNameTreeItem) {
        if (!this.parent) {
            this.label = id as string; 
            this._id = PathNameTreeItem.ROOT;
            this.isRoot = true;
        } else {
            if (typeof id === "string") {
                this.label = id;
            } else {    // id is PathNameTableID
                this.entry = id;
                this.label = id.virtualFileName;
                this.isFile = true;
            }
        }
    }

    public set parent(parent: PathNameTreeItem | undefined) {
        if (this.isRoot) {
            throw new Error("root element can't be moved");
        } else {
            if (parent === undefined) {
                throw new RangeError("non-root elements must have a parent");
            }
            this._parent = parent;
        }
    }

    public get parent() : PathNameTreeItem | undefined {
        return this._parent;
    }

    /** based on label */
    public get id() {
        return this._id;
    }

    /** change label, name and ID */
    public set label(label: string) {
        this._label = label.length > 0 ? label : PathNameTreeItem.EMPTYFOLDERID;
        if (!this.isRoot) {
            this._id = this._label;     // id can be UI label as long as there are no duplicates
            if (this.isFile) {
                this.entry!.virtualFileName = this._label;
            }
        }
    }

    public get label() {
        return this._label;
    }

    /** calculated using parent */
    fullID(): string {
        return path.join(this.parent?.fullID() ?? "", this.id);
    }
    
    /** calculated using parent */
    virtualPath(): string[] {
        if (this.isRoot) {
            return [];
        }
        return [...this.parent!.virtualPath(), ...(this.isFile ? [] : [this.label])];
    }

    *[Symbol.iterator](): IterableIterator<PathNameTreeItem> {
        yield this;
        for (const child of this.children.values()) {
            yield* child;
        }
    }

    getTableEntries(excludeEmpty: boolean = false): PathNameTableEntry[] {
        return [...this].flatMap(e => {
            if (e.isFile) {
                return [{...e.entry!, virtualPath: e.virtualPath()}];
            } else if (e.children.size === 0 && !excludeEmpty) {
                return [e.emptyFolder()];
            }
            return [];   
        });
    }

    private emptyFolder(): PathNameTableEntry {
        return {    ...PathNameTreeItem.EMPTYFOLDER,
                    virtualPath: this.virtualPath() };
    }

    getTreeItem() {
        let collapsible;
        if (this.isFile || this.children.size === 0) {
            collapsible = vscode.TreeItemCollapsibleState.None;
        } else {
            //expand folders containing only subfolders
            if (this.files().length === 0) {
                collapsible = vscode.TreeItemCollapsibleState.Expanded;
            } else {
                collapsible = vscode.TreeItemCollapsibleState.Collapsed;
            }
        }

        const item = new vscode.TreeItem(this.label, collapsible);
        item.id = this.fullID();

        // context, tooltip, uri command
        if (this.isFile) {   // file
            item.contextValue = "file";

            item.tooltip = this.entry!.fileName;
            if (this.entry!.meta) {
                item.tooltip += `\n\n${JSON.stringify(this.entry!.meta)}`;
            }
            

            //item.resourceUri = this.uri;
            //item.command = ...
        } else {
            if (this.isRoot) {
                item.contextValue = "root";
            } else {
                item.contextValue = "folder";
            }

            // count file types
            const entries = this.getTableEntries(true);
            const fileTypes = entries.map(e => PathNameTableView.typeByExtension(e.fileName));
            const numberOfLibparts = fileTypes.reduce((count, e) => (e === LibpartType.SCRIPT) ? count + 1 : count, 0);
            const numberOfImages = fileTypes.reduce((count, e) => (e === LibpartType.IMAGE) ? count + 1 : count, 0);

            item.tooltip = `${entries.length} entries\n${numberOfLibparts} libparts\n${numberOfImages} images`;
        }

        // icon
        if (this.isFile) {
            if (this.entry?.meta?.translatePathName === true) {
                item.iconPath = new vscode.ThemeIcon("book");
            } else {
                item.iconPath = vscode.ThemeIcon.File;
            }
        } else if (!this.isRoot && this.getTableEntries(true).length === 0) {   // empty folder
            item.iconPath = new vscode.ThemeIcon("folder", new vscode.ThemeColor("errorForeground"));
            item.description = "[empty]";
        } // don't show folder icon, horizontal positioning is counter-intuitive

        return item;
    }

    folders(excludeEmpty: boolean = false) {
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
    addChild(id: string | PathNameTableID | PathNameTreeItem): PathNameTreeItem {
        let item: PathNameTreeItem;

        if (id instanceof PathNameTreeItem) {   // existing entry
            item = id;
            item.parent = this;
        } else {
            item = new PathNameTreeItem(id, this);
        }

        if (item.isFile) {
            while (this.children.has(item.id)) {
                let newEntry = {...item.entry!};    // copy object
                newEntry.virtualFileName = `${item.id} duplicate`;
                item = new PathNameTreeItem(newEntry, this);
            }
        }
  
        this.children.set(item.id, item);      // overwriting duplicate folder should be handled outside
        return item;
    }

    deleteChild(id: string) {
        this.children.delete(id);
    }

    /** recursively merge content from other distinct trees */
    mergeChildren(items: PathNameTreeItem[]) {
        for (const item of items) {
            item.parent!.deleteChild(item.id);
            if (item.isFile) {
                this.addChild(item);        // TODO show info on renames
            } else {
                if (this.children.has(item.id)) {
                    this.children.get(item.id)!.mergeChildren([...item.children.values()]);
                } else {
                    this.addChild(item);
                }
            }
        }
    }

    static compareLabel(a : PathNameTreeItem, b : PathNameTreeItem) {
        return a.label.localeCompare(b.label);
    }
}

type ChangeEvent = PathNameTreeItem | PathNameTreeItem[] | undefined | null | void;

export const enum LibpartType { OTHER = 0, SCRIPT, IMAGE }

export class PathNameTableView
    implements  vscode.TreeDataProvider<PathNameTreeItem>,
                vscode.TreeDragAndDropController<PathNameTreeItem> {

    private static readonly lineHighLight = vscode.window.createTextEditorDecorationType({
        borderColor: new vscode.ThemeColor("editor.wordHighlightTextBorder"),
        borderWidth: "1px",
        borderStyle: "solid",
        backgroundColor: new vscode.ThemeColor("editor.wordHighlightTextBackground"),
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        overviewRulerColor: new vscode.ThemeColor("minimap.selectionOccurrenceHighlight")
    });

    static typeByExtension(fileName: string) {
        const ext = path.extname(fileName).toLowerCase();
        if (ext === ".gsm") return LibpartType.SCRIPT;
        if (GDLExtension.allowedImageTypes.has(ext)) return LibpartType.IMAGE;
        return LibpartType.OTHER;
    }

    static readonly VIEWID = "PathNameTableView";
    static readonly treeMime = 'application/vnd.code.tree.pathnametableview';
	readonly dropMimeTypes = [PathNameTableView.treeMime];
	readonly dragMimeTypes = [PathNameTableView.treeMime];

    private _onDidChangeTreeData: vscode.EventEmitter<ChangeEvent> = new vscode.EventEmitter<ChangeEvent>();
    readonly onDidChangeTreeData: vscode.Event<ChangeEvent> = this._onDidChangeTreeData.event;

    private root: PathNameTreeItem = new PathNameTreeItem("Pathnametable not loaded");
    private unsaved: boolean = false;
    private view: vscode.TreeView<PathNameTreeItem>;

    constructor(context : vscode.ExtensionContext) {
        this.view = vscode.window.createTreeView(PathNameTableView.VIEWID, { treeDataProvider: this,
                                                                             showCollapseAll: true,
                                                                             canSelectMany: true,
                                                                             dragAndDropController: this });

        const commands = [
            vscode.commands.registerCommand('GDL.PNTV.checkContent', async () => this.checkContentWithProgress()),
            vscode.commands.registerCommand('GDL.PNTV.expandAll', async (subtree?: PathNameTreeItem) => this.expandAll(subtree)),
            vscode.commands.registerCommand('GDL.PNTV.createSubPath', async (item: PathNameTreeItem) => this.createSubPath(item)),
            vscode.commands.registerCommand('GDL.PNTV.copyVirtualPath', async (item: PathNameTreeItem) => this.copyVirtualPath(item)),
            vscode.commands.registerCommand('GDL.PNTV.rename', async (item: PathNameTreeItem) => this.rename(item)),
            vscode.commands.registerCommand('GDL.PNTV.showInFile', async (item: PathNameTreeItem) => this.showInFile(item)),
            vscode.commands.registerCommand('GDL.PNTV.openFile', async (item: PathNameTreeItem) => this.openFile(item)),
        ];

        context.subscriptions.push(this.view, ...commands);
    }

    async checkContentWithProgress() {
        return vscode.window.withProgress({ location: { viewId: PathNameTableView.VIEWID },
                                            title: "Checking pathnametable..." },
                                            async (p, t) => this.checkContent(p, t));
    }

    /** return path of package.info of currently edited document */
    private async getPackagePath() {
        // find package.info by stepping upwards
        let packagePath = vscode.window.activeTextEditor!.document.fileName;
        let found: Promise<boolean>;
        do {
            packagePath = path.join(packagePath, "..");
            found = fileExists(vscode.Uri.file(path.join(packagePath, "package.info")));
        } while (path.join(packagePath, "..") !== packagePath && !(await found))

        if (!(await found)) {
            return undefined;
        } else {
            return packagePath;
        }
    }

    private static warnPackageInfoNotFound() {
        vscode.window.showWarningMessage("Can't find \"package.info\", don't know where to look for source files.");
    }

    private async checkContent(_progress: vscode.Progress<{increment: number, message: string}>, _token: vscode.CancellationToken) {
        const packagePath = await this.getPackagePath();
        if (packagePath === undefined) {
            PathNameTableView.warnPackageInfoNotFound();
            // go on with saving changes to purge empty folders
        } else {
            // assume no duplicate names TODO check

            // collect differences
            const diskLibparts = new Map<string, LibpartUri>();
            const tableFiles = [...this.root].filter(e => e.isFile);
            const tableLibparts = new Map<string, PathNameTreeItem>(tableFiles.map(e => [e.entry!.fileName, e]));

            const unneededInTable = new Set(tableLibparts.keys());
            unneededInTable.delete("mappingDefinitions.json");  // TODO handle based on localizationdata.info
            for await (const uri of getLibparts(vscode.Uri.file(packagePath))) {
                const key = uri.binaryFileName;
                diskLibparts.set(key, uri);
                unneededInTable.delete(key);
            }
            const missingFromTable = new Set(diskLibparts.keys());
            for (const key of tableLibparts.keys()) {
                missingFromTable.delete(key);
            }
            
            // change table tada
            for (const key of unneededInTable) {
                const remove = tableLibparts.get(key)!;
                remove.parent!.deleteChild(remove.id);
            }
            for (const key of missingFromTable) {
                const uri = diskLibparts.get(key)!;
                const relPath = path.relative(packagePath, uri.sourceUri.fsPath);
                this.addEntry({ fileName: uri.binaryFileName,
                                meta: { translatePathName: null },
                                virtualFileName: path.basename(key, path.extname(key)), // remove extension
                                virtualPath: relPath.split(path.sep).slice(0, -1) })
            }
        }

        return this.saveChanges(true);
    }

    async expandAll(subtree?: PathNameTreeItem) {
        for (const item of subtree ?? this.root) {
            if (!item.isFile) {
                await this.view.reveal(item, {  select: false,
                                                expand: true});
            }
        }
    }

    async createSubPath(item: PathNameTreeItem) {
        const atpath = path.join(...item.virtualPath());
        const subpath = await vscode.window.showInputBox({  ignoreFocusOut: true,
                                                            placeHolder: "some\\path or some/path",
                                                            title: "Enter sub-path to create",
                                                            prompt: `${atpath}${path.sep}...`});
        if (subpath) {
            //console.log(path.join(atpath, subpath));
            let next = item;
            for (const folder of subpath.replace(/[\\/]$/, "").split(/[\\/]/)) {    //remove trailing separator
                if (next.children.has(folder)) {
                    next = next.children.get(folder)!;
                } else {
                    next = next.addChild(folder);
                }
            }
            await this.saveChanges();   //can't expand before save finishes
            return this.expandAll(next);
        }
    }

    async copyVirtualPath(item: PathNameTreeItem) {
        return vscode.env.clipboard.writeText(path.join(...item.virtualPath()));
    }

    async rename(item: PathNameTreeItem) {
        const input = await vscode.window.showInputBox({ignoreFocusOut: true,
                                                        placeHolder: "new name",
                                                        title: "Rename",
                                                        prompt: item.id});
        if (input) {
            item.label = input;
            return this.saveChanges();
        }
    }

    async showInFile(item: PathNameTreeItem) {
        // JSON.parse can't save the original text position, so we have to search, assuming there aren't duplicate keys
        // search for original filename keys, these aren't changed
        const escapedFilename = escapeRegex(item.entry!.fileName);
        const findFileName = new RegExp(`(?<!\\\\)"fileName"\\s*:\\s*"${escapedFilename}"`, "igd");

        const editor = vscode.window.activeTextEditor!;
        const document = editor.document;
        const text = document.getText();
        const matches = [...text.matchAll(findFileName)];
        
        if (matches.length === 0) {
            vscode.window.showWarningMessage(`"fileName": "${item.entry!.fileName}" not found in text`);
        } else {
            const ranges = matches.map(e => {
                const match = (e as RegExpMatchArrayWithIndices).indices![0];
                return new vscode.Range(document.positionAt(match[0]),
                                        document.positionAt(match[1]));
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
    async openFile(item: PathNameTreeItem) {
        if (item.entry !== undefined) {
            //const findFile = path.basename(item.entry.fileName, path.extname(item.entry.fileName)).toLocaleLowerCase();
            const findFile = item.entry.fileName.toLocaleLowerCase();
            const packagePath = await this.getPackagePath();
            if (packagePath === undefined) {
                PathNameTableView.warnPackageInfoNotFound();
                return;
            }

            let found = false;
            for await (const uri of getLibparts(vscode.Uri.file(packagePath))) {
                if (uri.binaryFileName.toLocaleLowerCase() === findFile) {
                    found = true;
                    if (PathNameTableView.typeByExtension(item.entry.fileName) === LibpartType.SCRIPT) {
                        vscode.commands.executeCommand('vscode.open',
                                                        vscode.Uri.joinPath(uri.sourceUri, "libpartdata.xml"));
                    } else {
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
        let json: PathNameTableEntry[] = [];
        let message: string;

        this.unsaved = false;
        if (/^pathnametable.*?\.json$/i.test(filename)) {
            try {
                json = JSON.parse(vscode.window.activeTextEditor!.document.getText()) as PathNameTableEntry[];
                message = filename;
            } catch (e) {
                message = "bad pathnametable JSON format";
            }
        } else {
            message = "only PathNameTable*.json is handled";
        }

        this.createTree(json, message);
    }
    
    /** creates tree by virtualPath */
    private createTree(json: PathNameTableEntry[], rootDescription: string) {
        this.root = new PathNameTreeItem(rootDescription);
        json.forEach(e => this.addEntry(e));
        this._onDidChangeTreeData.fire();
    }

    /** adds an entry, creating folders as necessary */
    private addEntry(entry: PathNameTableEntry) {
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
            if (added.entry!.virtualFileName !== entry.virtualFileName) {
                this.unsaved = true;
                const virtualPath = path.join(...entry.virtualPath);
                vscode.window.showInformationMessage(`renamed duplicate virtual name ${entry.virtualFileName} at ${virtualPath}`);
            }
        }
    }

    getTreeItem(element: PathNameTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        let treeItem = element.getTreeItem();

        // show if tree is unsaved
        if (element === this.root && this.unsaved) {
            treeItem.description = "[tree changes not shown in editor]";
            treeItem.iconPath = new vscode.ThemeIcon("circle-filled");
        }

        return treeItem;
    }
    
    getChildren(element?: PathNameTreeItem | undefined): vscode.ProviderResult<PathNameTreeItem[]> {
        if (element === undefined) {    // provide root element
            return [this.root];
        }
        const sortedFolders = [...element.folders()].sort(PathNameTreeItem.compareLabel);
        const sortedFiles = [...element.files()].sort(PathNameTreeItem.compareLabel);
        return [...sortedFolders, ...sortedFiles];
    }

    getParent(element: PathNameTreeItem): vscode.ProviderResult<PathNameTreeItem> {
        return element.parent;
    }

    handleDrag(source: PathNameTreeItem[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
        dataTransfer.set(PathNameTableView.treeMime, new vscode.DataTransferItem(source));
    }

    handleDrop(target: PathNameTreeItem | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void | Thenable<void> {
        const source: PathNameTreeItem[] | undefined = dataTransfer.get(PathNameTableView.treeMime)?.value;
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
        const targetFullID = target!.fullID();
        const filteredItems = source.filter(e =>    !e.isRoot &&                                        // not root element
                                                    e.parent !== target &&                              // target is not the existing parent
                                                    e !== target &&                                     // target is not the same (with multi-selection)
                                                    !targetFullID.startsWith(e.fullID() + path.sep));   // target is not subfolder of element

        // move subtree
        target.mergeChildren(filteredItems);

        if (filteredItems.length > 0) {
            return this.saveChanges();
        }
    }

    /** will fire onDidChangeTreeData by editing document */
    private async saveChanges(excludEmpty: boolean = false) {
        let tryagain;
        do {
            const success = await this.writeToEditor(excludEmpty);
            if (!success) {
                tryagain = await vscode.window.showWarningMessage("Failed to save modifications to file", "Retry");
            }
        } while (tryagain !== undefined)
    }

    private async writeToEditor(excludEmpty: boolean = false) {
        const editor = vscode.window.activeTextEditor!;
        const success = editor.edit(editBuilder => {
            const fullRange = editor.document.validateRange(new vscode.Range(0, 0, editor.document.lineCount, 0));
            let newData = this.root.getTableEntries(excludEmpty).sort(compareFileName);
            const json = JSON.stringify(newData, undefined, 4);
            editBuilder.replace(fullRange, json);
        });
        return success;
    }
}