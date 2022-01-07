import path = require('path');
import * as vscode from 'vscode';

import { readFile } from './extension';

type LibpartInfo = {
    readonly uri: vscode.Uri,
    readonly guid: string
}

export class WSSymbols implements vscode.WorkspaceSymbolProvider<vscode.SymbolInformation> {

    // folder contents indexed by root folder (for multi-root workspaces)
    private libparts: Map<string, LibpartInfo[]>;

    constructor(context : vscode.ExtensionContext) {
        this.libparts = new Map();

        context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(async () => this.changeFolders()),
            vscode.workspace.onDidCreateFiles(async () => this.changeFolders()),
            vscode.workspace.onDidDeleteFiles(async () => this.changeFolders()),
            vscode.workspace.onDidRenameFiles(async () => this.changeFolders())
        );
    }

    private async collectLibparts() {
        this.libparts = new Map();

        const libpartdata = await vscode.workspace.findFiles("**/libpartdata.xml");
        const libparts = await Promise.allSettled(
            libpartdata.map(async libpartdata_uri => {
                const xml = (await readFile(libpartdata_uri, true))!;    //can't be undefined because file exists
                const guid_ = xml.match(/^\s*<MainGUID>([-0-9A-F]*)<\/MainGUID>/mi);
                let guid = "";
                if (guid_) {
                    guid = guid_[1];
                }
                return {uri: libpartdata_uri, guid: guid};
            }));

        this.libparts = libparts
            .map(result => result.status === "fulfilled" ? result.value : undefined)
            .filter((e) : e is LibpartInfo => (e !== undefined))
            .reduce((all, libpartinfo) => {        // map by workspace root folder
                const folder = vscode.workspace.getWorkspaceFolder(libpartinfo.uri)?.uri.fsPath ?? "";
                if (!all.has(folder)) {
                    all.set(folder, []);
                }
                all.get(folder)!.push(libpartinfo);
                return all;
                }, this.libparts);
    }

    async changeFolders() {
        console.log("WSSymbols changeFolders");
        await this.collectLibparts();
    }

    async provideWorkspaceSymbols(_query : string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
        //console.log("provideWorkspaceSymbols");

        return new Promise(async (resolve, reject) => {
            token.onCancellationRequested(reject);

            const symbols: vscode.SymbolInformation[] = [];

            //get filename from active editor
            const editorpath = vscode.window.activeTextEditor?.document.fileName;
            let open_relative = "";
            if (editorpath) {
                const ext = path.extname(editorpath);
                const fname = path.basename(editorpath, ext);
                if (ext === ".gdl") {
                    // open in scripts folder
                    open_relative = `../scripts/${fname}${ext}`;
                } else if (ext === ".xml") {
                    // open in base folder
                    open_relative = `../${fname}${ext}`;
                }
            }
    
            const targetposition = new vscode.Position(0, 0);
            for (const [root, libparts] of this.libparts) {
                const symbolpairs = await Promise.allSettled(
                    WSSymbols.filterquery(_query, libparts).map(async libpart => {
                        const dirname = path.dirname(libpart.uri.fsPath);
                        const relparent = path.relative(root, path.resolve(dirname, ".."));
                        //TODO vscode.workspace.asRelativePath
                        let target = vscode.Uri.joinPath(libpart.uri, open_relative);
                        try {
                            await vscode.workspace.fs.stat(target);
                        } catch {   // file not found, revert to libpartdata.xml
                            target = libpart.uri;
                        }
                        const basename = path.basename(dirname);
                        const libpartByName = new vscode.SymbolInformation(`"${basename}"`,
                                                            vscode.SymbolKind.File,
                                                            ` -  ${relparent} `,
                                                            new vscode.Location(target, targetposition)
                                                            );
                        const libpartByGUID = new vscode.SymbolInformation(libpart.guid,
                                                                     vscode.SymbolKind.File,
                                                                     ` -  ${basename} `,
                                                                     new vscode.Location(target, targetposition)
                                                                     );

                        return [libpartByName, libpartByGUID];
                        })
                );

                symbols.push(...symbolpairs
                    .map(result => result.status === "fulfilled" ? result.value : undefined)
                    .filter((e) : e is vscode.SymbolInformation[] => (e !== undefined))
                    .flat());
            }

            resolve(symbols);
        });
    }

    private static filterquery(query: string, libparts : LibpartInfo[]) : LibpartInfo[] {
        const query_lc = query.toLowerCase();

        return libparts.filter(libpart => {
            const name_lc = path.basename(path.dirname(libpart.uri.fsPath)).toLowerCase();
            const guid_lc = libpart.guid.toLowerCase();
            let i = 0, j = 0;
            for (const char of query_lc) {
                i = name_lc.indexOf(char, i);
                j = guid_lc.indexOf(char, i);
                if (i < 0 && j < 0) break;
            }
            return (i >= 0 || j >= 0);
        });
    }
}