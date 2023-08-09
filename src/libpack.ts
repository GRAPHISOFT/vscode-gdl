import * as vscode from 'vscode';

import path = require('path');

export type PathNameTableEntry = {
    fileName: string,
    meta?: { translatePathName?: boolean | null },
    virtualFileName: string,
    virtualPath: string[],
}

class VirtualPath {
    public readonly id: string;
    static readonly ROOT = "root:";

    constructor(public readonly isFile: boolean, public readonly pathParts: string[] = []) {
        this.id = path.join(VirtualPath.ROOT, ...this.pathParts);
    }
}

export class PathNameTreeItem {
    public children: Map<string, PathNameTreeItem>;
    public parent?: PathNameTreeItem = undefined;

    constructor(private entry: PathNameTableEntry | undefined, children: PathNameTreeItem[], public label: string, public virtualPath: VirtualPath) {
        this.children = new Map(children.map(e => [e.virtualPath.id, e]));
    }

    getTreeItem() {
        let collapsible;
        if (this.virtualPath.isFile) {
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
            } else {
                item.iconPath = vscode.ThemeIcon.File;
            }
        }   // don't show folder icon, horizontal positioning is counter-intuitive

        return item;
    }

    folders() {
        return [...this.children.values()].filter(e => e.virtualPath.isFile === false);
    }

    files() {
        return [...this.children.values()].filter(e => e.virtualPath.isFile === true);
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

    private root: PathNameTreeItem = new PathNameTreeItem(undefined, [], "Pathnametable not loaded", new VirtualPath(false));

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

    getTreeItem(element: PathNameTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
    
    getChildren(element?: PathNameTreeItem | undefined): vscode.ProviderResult<PathNameTreeItem[]> {
        if (element === undefined) {    // provide root element
            return [this.root];
        }
        const sortedFolders = [...element.folders()].sort(PathNameTreeItem.compareLabel);
        const sortedFiles = [...element.files()].sort(PathNameTreeItem.compareLabel);
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
        if (target?.virtualPath.isFile) {
            target = target.parent;
        }
        if (target === undefined) {
            return;
        }
        
        const filteredEntries = source.filter(e =>  e.parent !== undefined &&                                   // not root element
                                                    e.parent.virtualPath.id !== target!.virtualPath.id &&       // target is not the existing parent
                                                    !target!.virtualPath.id.startsWith(e.virtualPath.id) );     // target is not the same or subfolder of element
        const oldParents = filteredEntries.map(e => e.parent!);

        for (const entry of filteredEntries) {
            const oldID = entry.virtualPath.id;
            entry.virtualPath = new VirtualPath(entry.virtualPath.isFile, [...target.virtualPath.pathParts, entry.virtualPath.pathParts.at(-1)!]);

            entry.parent!.children.delete(oldID);
            entry.parent = target;
            target.children.set(entry.virtualPath.id, entry);
        }
        this._onDidChangeTreeData.fire([...oldParents, target]);
    }
}