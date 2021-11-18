import * as vscode from 'vscode';
import path = require('path');
import fs = require('fs');

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

        this.changeFolders();
    }

    get folders() {
        return vscode.workspace.workspaceFolders ?? [];
    }

    private async collectLibparts(roots: readonly vscode.WorkspaceFolder[]) {
        this.libparts = new Map();
        await Promise.all(
            roots.map(async folder => this.libparts.set(folder.uri.fsPath, await this.collectLibpartsInFolder(folder.uri)))
        );
    }

    private async collectLibpartsInFolder(folder: vscode.Uri) : Promise<LibpartInfo[]> {
        //console.log("WSSymbols collectLibpartsInFolder", folder.fsPath)
        const contents = await vscode.workspace.fs.readDirectory(folder);
        const libpartdata = contents.filter(content => content[1] & vscode.FileType.File && content[0] === "libpartdata.xml");
        const dirs = contents.filter(content => content[1] & vscode.FileType.Directory);

        if (libpartdata.length > 0) {   // has libpartdata.xml
            const libpartdata_uri = vscode.Uri.joinPath(folder, libpartdata[0][0]);    // there can be only one
            // read mainguid
            let data = fs.readFileSync(libpartdata_uri.fsPath, "utf8");
            let guid_ = data.match(/^\s*<MainGUID>([-0-9A-F]*)<\/MainGUID>/mi);
            let guid = "";
            if (guid_) {
                guid = guid_[1];
            }
            return [{uri: libpartdata_uri, guid: guid}];
        } else {                        // no libpartdata: dive deeper
            if (dirs.length > 0) {
                const subtree = await Promise.all(
                    dirs.map(async subdir => await this.collectLibpartsInFolder(vscode.Uri.joinPath(folder, subdir[0])))
                );
                return subtree.reduce((a, b) => a.concat(b));
            } else {
                return [];
            }
        }
    }

    async changeFolders() {
        //console.log("WSSymbols changeFolders");
        await this.collectLibparts(this.folders);
    }

    async provideWorkspaceSymbols(_query : string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {

        return new Promise(async (resolve, reject) => {
            token.onCancellationRequested(reject);

            let symbols: vscode.SymbolInformation[] = [];

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
    
            for (const [root, libparts] of this.libparts) {
                const symbolpairs = await Promise.all(
                    libparts.map(async libpart => {
                        const dirname = path.dirname(libpart.uri.fsPath);
                        const relparent = path.relative(root, path.resolve(dirname, ".."));
    
                        let target = vscode.Uri.joinPath(libpart.uri, open_relative);
                        try {
                            await vscode.workspace.fs.stat(target);
                        } catch {   // file not found, revert to libpartdata.xml
                            target = libpart.uri;
                        }
    
                        const libpartByName = new vscode.SymbolInformation(`"${path.basename(dirname)}"`,
                                                            vscode.SymbolKind.File,
                                                            ` -  ${relparent} `,
                                                            new vscode.Location(target,
                                                                                new vscode.Position(0, 0))
                                                            );
                        const libpartByGUID = new vscode.SymbolInformation(libpart.guid,
                                                                     vscode.SymbolKind.File,
                                                                     ` -  ${path.basename(dirname)} `,
                                                                     new vscode.Location(target,
                                                                                         new vscode.Position(0, 0))
                                                                     );

                        return [libpartByName, libpartByGUID];
                        })
                );

                symbols = symbols.concat(symbolpairs.reduce((a, b) => a.concat(...b)));
            }

            resolve(symbols);
        });
    }

}