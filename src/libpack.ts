import * as vscode from 'vscode';

import path = require('path');

import { GDLExtension, readFile } from './extension';

export interface PathNameTableEntry {
    fileName: string,
    meta?: { translatePathName?: string},
    virtualFileName: string,
    virtualPath: string[],
}

export interface PathNameTableRoot {
    valid: boolean,
    message: string
}

type ChangeEvent = PathNameTableEntry | PathNameTableRoot | undefined | null | void;

export class PathNameTableView
    implements vscode.TreeDataProvider<PathNameTableEntry | PathNameTableRoot> {

    private _onDidChangeTreeData: vscode.EventEmitter<ChangeEvent> = new vscode.EventEmitter<ChangeEvent>();
    readonly onDidChangeTreeData: vscode.Event<ChangeEvent> = this._onDidChangeTreeData.event;

    private entries: Map<string, PathNameTableEntry> = new Map();
    private root: PathNameTableRoot = {  valid: false,
                                         message: "PathNameTable not loaded" };

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
    
    refresh() {
        const filename = path.basename(vscode.window.activeTextEditor?.document.fileName ?? "");
        let json: PathNameTableEntry[] = [];
        if (/^pathnametable.*?\.json$/i.test(filename)) {
            try {
                json = JSON.parse(vscode.window.activeTextEditor!.document.getText()) as PathNameTableEntry[];
                const numberOfLibparts = json.filter(e => path.extname(e.fileName) === ".gsm").length;
                const numberOfImages = json.filter(e => path.extname(e.fileName) in PathNameTableView.knownImageExtensions).length;
                this.root = {valid: true, message: `${filename}: ${json.length} entries, ${numberOfLibparts} libparts, ${numberOfImages} images`};
            } catch (e) {
                this.root = {valid: false, message: "bad pathnametable JSON format"};
            }
        } else {
            this.root = {valid: false, message: "only PathNameTable*.json is handled"};
        }

        this.entries = new Map(json.map(e => [e.fileName, e]));
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PathNameTableRoot | PathNameTableEntry): vscode.TreeItem | Thenable<vscode.TreeItem> {
        if ('valid' in element) {
            const collapsible = element.valid ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
            return new vscode.TreeItem(element.message, collapsible);
        } else {
            return new vscode.TreeItem(element.fileName);
        }
    }
    
    getChildren(element?: PathNameTableRoot | PathNameTableEntry | undefined): vscode.ProviderResult<PathNameTableRoot[] | PathNameTableEntry[]> {
        if (element === undefined) {
            return [this.root];
        } 
        return [...this.entries.values()].sort();;
    }

}