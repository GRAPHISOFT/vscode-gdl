"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSSymbols = void 0;
const vscode = require("vscode");
const path = require("path");
class WSSymbols {
    constructor(context) {
        this.libparts = new Map();
        context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => __awaiter(this, void 0, void 0, function* () { return this.changeFolders(); })), vscode.workspace.onDidCreateFiles(() => __awaiter(this, void 0, void 0, function* () { return this.changeFolders(); })), vscode.workspace.onDidDeleteFiles(() => __awaiter(this, void 0, void 0, function* () { return this.changeFolders(); })), vscode.workspace.onDidRenameFiles(() => __awaiter(this, void 0, void 0, function* () { return this.changeFolders(); })));
        this.changeFolders();
    }
    get folders() {
        var _a;
        return (_a = vscode.workspace.workspaceFolders) !== null && _a !== void 0 ? _a : [];
    }
    collectLibparts(roots) {
        return __awaiter(this, void 0, void 0, function* () {
            this.libparts = new Map();
            yield Promise.all(roots.map((folder) => __awaiter(this, void 0, void 0, function* () { return this.libparts.set(folder.uri.fsPath, yield this.collectLibpartsInFolder(folder.uri)); })));
        });
    }
    collectLibpartsInFolder(folder) {
        return __awaiter(this, void 0, void 0, function* () {
            //console.log("WSSymbols collectLibpartsInFolder", folder.fsPath)
            const contents = yield vscode.workspace.fs.readDirectory(folder);
            const libpartdata = contents.filter(content => content[1] & vscode.FileType.File && content[0] === "libpartdata.xml");
            const dirs = contents.filter(content => content[1] & vscode.FileType.Directory);
            if (libpartdata.length > 0) { // has libpartdata.xml
                return [vscode.Uri.joinPath(folder, libpartdata[0][0])]; // there can be only one
            }
            else { // no libpartdata: dive deeper
                if (dirs.length > 0) {
                    const subtree = yield Promise.all(dirs.map((subdir) => __awaiter(this, void 0, void 0, function* () { return yield this.collectLibpartsInFolder(vscode.Uri.joinPath(folder, subdir[0])); })));
                    return subtree.reduce((a, b) => a.concat(b));
                }
                else {
                    return [];
                }
            }
        });
    }
    changeFolders() {
        return __awaiter(this, void 0, void 0, function* () {
            //console.log("WSSymbols changeFolders");
            yield this.collectLibparts(this.folders);
        });
    }
    provideWorkspaceSymbols(_query, token) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                token.onCancellationRequested(reject);
                let symbols = [];
                for (const [root, libparts] of this.libparts) {
                    symbols = symbols.concat(yield Promise.all(libparts.map((libpart) => __awaiter(this, void 0, void 0, function* () {
                        var _a;
                        const dirname = path.dirname(libpart.fsPath);
                        const relparent = path.relative(root, path.resolve(dirname, ".."));
                        //get filename from active editor
                        const editorpath = (_a = vscode.window.activeTextEditor) === null || _a === void 0 ? void 0 : _a.document.fileName;
                        let open_relative = "";
                        if (editorpath) {
                            const ext = path.extname(editorpath);
                            const fname = path.basename(editorpath, ext);
                            if (ext === ".gdl") {
                                // open in scripts folder
                                open_relative = `../scripts/${fname}${ext}`;
                            }
                            else if (ext === ".xml") {
                                // open in base folder
                                open_relative = `../${fname}${ext}`;
                            }
                        }
                        let target = vscode.Uri.joinPath(libpart, open_relative);
                        try {
                            yield vscode.workspace.fs.stat(target);
                        }
                        catch ( // file not found, revert to libpartdata.xml
                        _b) { // file not found, revert to libpartdata.xml
                            target = libpart;
                        }
                        return new vscode.SymbolInformation(`"${path.basename(dirname)}"`, vscode.SymbolKind.File, ` -  ${relparent} `, new vscode.Location(target, new vscode.Position(0, 0)));
                    }))));
                }
                resolve(symbols);
            }));
        });
    }
}
exports.WSSymbols = WSSymbols;
//# sourceMappingURL=wssymbols.js.map