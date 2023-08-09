import * as vscode from 'vscode';

import path = require('path');

import { GDLExtension } from './extension';

export type PathNameTableEntry = {
    fileName: string,
    meta?: { translatePathName?: string},
    virtualFileName: string,
    virtualPath: string[],
}

export class PathNameTreeItem {
    public folders: Map<string, PathNameTreeItem>;
    public files: Map<string, PathNameTreeItem>;

    constructor(folders: PathNameTreeItem[], files: PathNameTreeItem[], public label: string, public id: string = "root:") {
        this.folders = new Map(folders.map(e => [e.label, e]));
        this.files = new Map(files.map(e => [e.label, e]));
    }

    getTreeItem() {
        const collapsible = (this.folders.size + this.files.size) > 0   ? vscode.TreeItemCollapsibleState.Expanded
                                                                        : vscode.TreeItemCollapsibleState.None;
        const item = new vscode.TreeItem(this.label, collapsible);
        item.id = this.id;
        return item;
    }
}

type ChangeEvent = PathNameTreeItem | undefined | null | void;

export class PathNameTableView
    implements vscode.TreeDataProvider<PathNameTreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<ChangeEvent> = new vscode.EventEmitter<ChangeEvent>();
    readonly onDidChangeTreeData: vscode.Event<ChangeEvent> = this._onDidChangeTreeData.event;

    private root: PathNameTreeItem = new PathNameTreeItem([], [], "Pathnametable not loaded");

    // hash for known extensions
    private static knownImageExtensions = { ".jpg":     undefined,
                                            ".jpeg":    undefined,
                                            ".tif":     undefined,
                                            ".tiff":    undefined,
                                            ".svg":     undefined,
                                            ".gif":     undefined,
                                            ".bmp":     undefined }

    constructor(extension : GDLExtension) {
        console.log("PathNameTableView constructor called");
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
            parent.files.set(   entry.virtualFileName,
                                new PathNameTreeItem(   [], [],
                                                        entry.virtualFileName,
                                                        id));
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
        return [...element.folders.values(), ...element.files.values()];
    }

}