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

class PathNameTreeItem {
    public children: Map<string, PathNameTreeItem> = new Map();
    static readonly ROOT = "root:";
    static readonly PLACEHOLDER = ":";
    public readonly id: string;
    public readonly isFile: boolean;
    public readonly label: string;

    /** call with undefined parent to create root, call with undefined entry to create folder */
    constructor(id: string, private _parent?: PathNameTreeItem, public readonly entry?: PathNameTableID) {
        this.label = id;                            // id used for UI label
        this.id = this.parent ? id : PathNameTreeItem.ROOT;
        this.isFile = (entry !== undefined);        // only files have a PathNameTableEntry
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

    /** calculated using parent */
    getTableEntries(): PathNameTableEntry | PathNameTableEntry[] {
        if (this.isFile) {
            return {...this.entry!, virtualPath: this.virtualPath()};
        } else {
            let files = this.files().map(e => (e.getTableEntries() as PathNameTableEntry));
            let subfiles = [...this.folders().flatMap(e => e.getTableEntries())];
            return [...files, ...subfiles];
        }
    }

    getTreeItem() {
        let collapsible;
        const emptyFolder = !this.isFile && this.parent && this.children.size === 1 && this.children.has(PathNameTreeItem.PLACEHOLDER);
        if (this.isFile || emptyFolder) {
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
            } else {
                item.iconPath = vscode.ThemeIcon.File;
            }
        } else if (emptyFolder) {
            item.iconPath = new vscode.ThemeIcon("folder", new vscode.ThemeColor("errorForeground"));
            item.label = item.label + " [empty]";
        } // don't show folder icon, horizontal positioning is counter-intuitive

        return item;
    }

    folders() {
        return [...this.children.values()].filter(e => e.isFile === false);
    }

    files() {
        return [...this.children.values()].filter(e => e.isFile === true);
    }

    addChild(id: string, entry?: PathNameTableID): PathNameTreeItem {
        const newItem = new PathNameTreeItem(id, this, entry);
        this.children.set(newItem.id, newItem);
        if (id !== PathNameTreeItem.PLACEHOLDER) {
            this.deleteChild(PathNameTreeItem.PLACEHOLDER);
        }
        return newItem;
    }

    deleteChild(id: string, keepEmptyFolder: boolean = false) {
        this.children.delete(id);
        if (keepEmptyFolder && this.children.size === 0 && !this.isFile) {
            // keep empty folders with hidden placeholder file
            this.addChild(PathNameTreeItem.PLACEHOLDER, {   fileName: PathNameTreeItem.PLACEHOLDER,
                                                            virtualFileName: PathNameTreeItem.PLACEHOLDER});
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

    private _onDidChangeTreeData: vscode.EventEmitter<ChangeEvent> = new vscode.EventEmitter<ChangeEvent>();
    readonly onDidChangeTreeData: vscode.Event<ChangeEvent> = this._onDidChangeTreeData.event;

    static readonly treeMime = 'application/vnd.code.tree.pathnametableview';

	readonly dropMimeTypes = [PathNameTableView.treeMime];
	readonly dragMimeTypes = [PathNameTableView.treeMime];

    private root: PathNameTreeItem = new PathNameTreeItem("Pathnametable not loaded");

    /** hash for known extensions */
    private static knownImageExtensions = { ".jpg":     undefined,
                                            ".jpeg":    undefined,
                                            ".tif":     undefined,
                                            ".tiff":    undefined,
                                            ".svg":     undefined,
                                            ".gif":     undefined,
                                            ".bmp":     undefined }

    constructor(context : vscode.ExtensionContext) {
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
        let json: PathNameTableEntry[] = [];
        let message: string;
        if (/^pathnametable.*?\.json$/i.test(filename)) {
            try {
                json = JSON.parse(vscode.window.activeTextEditor!.document.getText()) as PathNameTableEntry[];
                const numberOfLibparts = json.filter(e => path.extname(e.fileName) === ".gsm").length;
                const numberOfImages = json.filter(e => path.extname(e.fileName) in PathNameTableView.knownImageExtensions).length;
                message = `${filename}: ${json.length} entries, ${numberOfLibparts} libparts, ${numberOfImages} images`;
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
                    nextParent = parent.addChild(folder, undefined);    // TODO keep empty folders in data without placeholder file, write & read from json
                }
                parent = nextParent;
            }

            parent.addChild(entry.virtualFileName, entry)
        }

        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PathNameTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
    
    getChildren(element?: PathNameTreeItem | undefined): vscode.ProviderResult<PathNameTreeItem[]> {
        if (element === undefined) {    // provide root element
            return [this.root];
        }
        const sortedFolders = [...element.folders()].sort(PathNameTreeItem.compareLabel);
        const sortedFiles = [...element.files().filter(e => e.id !== PathNameTreeItem.PLACEHOLDER)].sort(PathNameTreeItem.compareLabel);
        return [...sortedFolders, ...sortedFiles];
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

        // change parents
        for (const item of filteredItems) {
            item.parent!.deleteChild(item.id, true);
            item.parent = target;
            target.children.set(item.id, item);
            // TODO merging two same-named folders (recurse!)
        }

        if (filteredItems.length > 0) {
            return this.saveChanges();  // will fire onDidChangeTreeData by editing document
        }
    }

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
            let newData = this.root.getTableEntries() as PathNameTableEntry[];  // root is a folder
            newData.sort(compareFileName);
            const json = JSON.stringify(newData, undefined, 4);
            editBuilder.replace(fullRange, json);
        });
        return success;
    }
}