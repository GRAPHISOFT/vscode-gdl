import path = require('path');
import * as vscode from 'vscode';

import { fileExists, readFile } from './extension';

class LibpartInfo {
    private _root_uri : vscode.Uri | undefined;
    private _name : string | undefined;
    constructor(public readonly libpartdata_uri: vscode.Uri, public readonly guid: string) {}

    get name() : string {
        if (this._name === undefined) {
            this._name = path.basename(this.root_uri.fsPath);
        }
        return this._name;
    }

    get root_uri() : vscode.Uri {
        if (this._root_uri === undefined) {
           this._root_uri = vscode.Uri.joinPath(this.libpartdata_uri, "..");
        }
        return this._root_uri;
    }

    async relative_withFallback(relative: string, masterscript: boolean) : Promise<vscode.Uri> {
        // check whether has file relative to root_uri
        // optionally offering masterscript as fallback
        // then offering libpartdata.xml as fallback

        let target = vscode.Uri.joinPath(this.root_uri, relative);
        if ((await fileExists(target))) {
            return target;
        } else {
            if (masterscript) {
                target = vscode.Uri.joinPath(this.root_uri, "scripts/1d.gdl");
            } else {
                target = this.libpartdata_uri;
            }
            if ((await fileExists(target))) {
                return target;
            } else {
                return this.libpartdata_uri;   // assume always exists
            }
        }
    }
}

export class WSSymbols implements vscode.WorkspaceSymbolProvider<vscode.SymbolInformation> {

    // folder contents indexed by root folder (for multi-root workspaces)
    private libparts: LibpartInfo[] = [];
    private unprocessed = true;

    // fired when finished scanning workspace
	private _onDidCollect: vscode.EventEmitter<null> = new vscode.EventEmitter<null>();
	readonly onDidCollect: vscode.Event<null> = this._onDidCollect.event;

    constructor(context : vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(async () => this.changeFolders()),
            vscode.workspace.onDidCreateFiles(async () => this.changeFolders()),
            vscode.workspace.onDidDeleteFiles(async () => this.changeFolders()),
            vscode.workspace.onDidRenameFiles(async () => this.changeFolders())
        );
    }

    private async collectLibparts() {
        const libpartdata = await vscode.workspace.findFiles("**/libpartdata.xml");
        const libparts = await Promise.allSettled(
            libpartdata.map(async libpartdata_uri => {
                const xml = (await readFile(libpartdata_uri, true))!;    //can't be undefined because file exists
                const guid_ = xml.match(/^\s*<MainGUID>([-0-9A-F]*)<\/MainGUID>/mi);
                let guid = "";
                if (guid_) {
                    guid = guid_[1];
                }
                return new LibpartInfo(libpartdata_uri, guid);
            }));

        this.libparts = libparts
            .map(result => result.status === "fulfilled" ? result.value : undefined)
            .filter((e) : e is LibpartInfo => (e !== undefined));

        this.unprocessed = false;
        this._onDidCollect.fire(null);
    }

    async changeFolders() {
        //console.log("WSSymbols changeFolders");
        this.unprocessed = true;
        vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Window,
              title: 'Collecting libparts in workspace...'
            },
            async () => await this.collectLibparts());
    }

    async provideWorkspaceSymbols(query : string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
        // when called from UI don't offer master script as fallback
        return this.provideWorkspaceSymbols_withFallback(false, query, token);
    }

    async provideWorkspaceSymbols_withFallback(masterscript: boolean, query : string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
        //console.log("provideWorkspaceSymbols");

        if (this.unprocessed) {
            //wait for workspace scanning to finish
            await new Promise((resolve, reject) => {
                this.onDidCollect(resolve);
                token.onCancellationRequested(reject);
            });
        }

        return new Promise(async (resolve, reject) => {
            token.onCancellationRequested(reject);

            //get filename from active editor
            const editorpath = vscode.window.activeTextEditor?.document.fileName;
            let open_relative = "";
            if (editorpath) {
                const ext = path.extname(editorpath);
                const fname = path.basename(editorpath, ext);
                if (ext === ".gdl") {
                    // open in scripts folder
                    open_relative = `scripts/${fname}${ext}`;
                } else if (ext === ".xml") {
                    // open in base folder
                    open_relative = `${fname}${ext}`;
                }
            }
    
            const targetposition = new vscode.Position(0, 0);
            const query_lc = query.toLowerCase();

            const symbolpairs = await Promise.allSettled(this.libparts
                .filter(e => filterquery(e, query_lc))
                .map(async libpart => {
                        let target = await libpart.relative_withFallback(open_relative, masterscript);

                        const libpartByName = new vscode.SymbolInformation(`"${libpart.name}"`,
                                                            vscode.SymbolKind.File,
                                                            "",
                                                            new vscode.Location(target, targetposition)
                                                            );
                        const libpartByGUID = new vscode.SymbolInformation(libpart.guid,
                                                                    vscode.SymbolKind.File,
                                                                    ` -  ${libpart.name} `,
                                                                    new vscode.Location(target, targetposition)
                                                                    );

                        return [libpartByName, libpartByGUID];
                        })
            );

            const symbols = symbolpairs
                .map(result => result.status === "fulfilled" ? result.value : undefined)
                .filter((e) : e is vscode.SymbolInformation[] => (e !== undefined))
                .flat();

            resolve(symbols);
        });
    }
}

function filterquery(libpart : LibpartInfo, query_lc : string) : libpart is LibpartInfo {
    // select element if contains all the characters of query in order,
    // but not necessarily continuously (as required by the API)
    const name_lc = libpart.name.toLowerCase();
    const guid_lc = libpart.guid.toLowerCase();
    let i = 0, j = 0;
    for (const char of query_lc) {
        if (i >= 0) {
            i = name_lc.indexOf(char, i);
        }
        if (j >= 0) {
            j = guid_lc.indexOf(char, j);
        }
        if (i < 0 && j < 0) {
            break;
        }
    }
    return (i >= 0 || j >= 0);
}
