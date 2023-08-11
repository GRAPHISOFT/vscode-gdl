import * as vscode from 'vscode';

import path = require('path');

type PathNameTableID = {
    fileName: string,
    meta?: { translatePathName?: boolean | null },
    virtualFileName: string 
}

function compareFileName(a: PathNameTableID, b: PathNameTableID) {
    // first by extension
    const byExt = path.extname(a.fileName).localeCompare(path.extname(b.fileName));
    if (byExt === 0) {
        return a.fileName.localeCompare(b.fileName);    // filenames have to differ
    }
    return byExt;
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
    public readonly id: string;
    public readonly isFile: boolean = false;
    public readonly label: string;
    public readonly entry?: PathNameTableID;

    /** call with string and undefined parent to create root, string to create folder, PathNameTableID to create file */
    constructor(id: string | PathNameTableID, private _parent?: PathNameTreeItem) {
        if (!this.parent) {
            this.id = PathNameTreeItem.ROOT;
            this.label = id as string; 
        } else {
            if (typeof id === "string") {
                this.id = id;
            } else {    // id is PathNameTableID
                this.entry = id;
                this.id = id.virtualFileName.length > 0 ? id.virtualFileName : PathNameTreeItem.EMPTYFOLDERID;
                this.isFile = true;
            }
            this.label = this.id;      // id used for UI label
        }
    }

    public set parent(parent: PathNameTreeItem) {
        if (this.parent === undefined) {
            throw new Error("root element can't be moved");
        } else {
            this._parent = parent;
        }
    }

    public get parent() : PathNameTreeItem | undefined {
        return this._parent;
    }

    /** calculated using parent */
    fullID(): string {
        return path.join(this.parent?.fullID() ?? "", this.id);
    }
    
    /** calculated using parent */
    virtualPath(): string[] {
        if (this.parent) {
            return [...this.parent.virtualPath(), ...(this.isFile ? [] : [this.id])];
        }
        return [];
    }

    *[Symbol.iterator](): IterableIterator<PathNameTreeItem> {
        yield this;
        for (const child of this.children.values()) {
            yield* child;
        }
    }

    /** calculated using parent */
    getTableEntries(excludEmpty: boolean = false): PathNameTableEntry[] {
        // TODO use iterator
        if (this.isFile) {
            return [{...this.entry!, virtualPath: this.virtualPath()}];
        } else {
            let files = [...this.files().flatMap(e => e.getTableEntries())];
            if (this.children.size === 0 && !excludEmpty) {
                files = [this.emptyFolder()];
            }
            let subfiles = [...this.folders().flatMap(e => e.getTableEntries(excludEmpty))];
            return [...files, ...subfiles];
        }
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
            //item.description = true;
            //item.command = ...
        } else {
            if (this.id === PathNameTreeItem.ROOT) {
                item.contextValue = "root";
            } else {
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
            } else {
                item.iconPath = vscode.ThemeIcon.File;
            }
        } else if (this.parent && this.getTableEntries(true).length === 0) {   // empty folder
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

export class PathNameTableView
    implements  vscode.TreeDataProvider<PathNameTreeItem>,
                vscode.TreeDragAndDropController<PathNameTreeItem> {

    /** hash for known extensions */
    static readonly knownImageExtensions = { ".jpg":     undefined,
                                             ".jpeg":    undefined,
                                             ".tif":     undefined,
                                             ".tiff":    undefined,
                                             ".svg":     undefined,
                                             ".gif":     undefined,
                                             ".bmp":     undefined }

    static readonly treeMime = 'application/vnd.code.tree.pathnametableview';
	readonly dropMimeTypes = [PathNameTableView.treeMime];
	readonly dragMimeTypes = [PathNameTableView.treeMime];

    private _onDidChangeTreeData: vscode.EventEmitter<ChangeEvent> = new vscode.EventEmitter<ChangeEvent>();
    readonly onDidChangeTreeData: vscode.Event<ChangeEvent> = this._onDidChangeTreeData.event;

    private root: PathNameTreeItem = new PathNameTreeItem("Pathnametable not loaded");
    private unsaved: boolean = false;
    private view: vscode.TreeView<PathNameTreeItem>;

    constructor(context : vscode.ExtensionContext) {
        this.view = vscode.window.createTreeView('PathNameTableView', { treeDataProvider: this,
                                                                        showCollapseAll: true,
                                                                        canSelectMany: true,
                                                                        dragAndDropController: this });

        const commands = [
            vscode.commands.registerCommand('GDL.PNTV.deleteEmptyFolders', () => this.deleteEmptyFolders()),
            vscode.commands.registerCommand('GDL.PNTV.moveSelectionTo', () => this.moveSelectionTo()),
            vscode.commands.registerCommand('GDL.PNTV.expandAll', async (subtree?: PathNameTreeItem) => this.expandAll(subtree)),
            vscode.commands.registerCommand('GDL.PNTV.createSubPath', async (item: PathNameTreeItem) => this.createSubPath(item)),
            vscode.commands.registerCommand('GDL.PNTV.copyVirtualPath', async (item: PathNameTreeItem) => this.copyVirtualPath(item)),
            vscode.commands.registerCommand('GDL.PNTV.showInFile', (item: PathNameTreeItem) => this.showInFile(item)),
        ];

        context.subscriptions.push(this.view, ...commands);
    }

    async expandAll(subtree?: PathNameTreeItem) {
        for (const item of subtree ?? this.root) {
            if (!item.isFile) {
                await this.view.reveal(item, {  select: false,
                                                expand: true});
            }
        }
    }

    deleteEmptyFolders() {

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

    moveSelectionTo() {

    }

    async copyVirtualPath(item: PathNameTreeItem) {
        return vscode.env.clipboard.writeText(path.join(...item.virtualPath()));
    }

    showInFile(item: PathNameTreeItem) {

    }
    
    /** reads JSON in active editor, then triggers a refresh of the UI */
    refresh() {
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
    private createTree(json: PathNameTableEntry[], message: string) {
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
                if (added.entry!.virtualFileName !== entry.virtualFileName) {
                    this.unsaved = true;
                    const virtualPath = path.join(...entry.virtualPath);
                    vscode.window.showInformationMessage(`renamed duplicate virtual name ${entry.virtualFileName} at ${virtualPath}`);
                }
            }
        }

        this._onDidChangeTreeData.fire();
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
        const filteredItems = source.filter(e =>    e.parent !== undefined &&                           // not root element
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
    private async saveChanges() {
        let tryagain;
        do {
            const success = await this.writeToEditor();
            if (!success) {
                tryagain = await vscode.window.showWarningMessage("Failed to save modifications to file", "Retry");
            }
        } while (tryagain !== undefined)
    }

    private async writeToEditor() {
        const editor = vscode.window.activeTextEditor!;
        const success = editor.edit(editBuilder => {
            const fullRange = editor.document.validateRange(new vscode.Range(0, 0, editor.document.lineCount, 0));
            let newData = this.root.getTableEntries().sort(compareFileName);
            const json = JSON.stringify(newData, undefined, 4);
            editBuilder.replace(fullRange, json);
        });
        return success;
    }
}