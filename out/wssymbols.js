"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSSymbols = exports.LibpartInfo = void 0;
const path = require("path");
const vscode = require("vscode");
const extension_1 = require("./extension");
const Parser = require("./parsexmlgdl");
class LibpartInfo {
    libpartdata_uri;
    guid;
    _root_uri;
    _images_uri;
    _name;
    scriptsCache = new Map();
    imagesCache;
    constructor(libpartdata_uri, guid) {
        this.libpartdata_uri = libpartdata_uri;
        this.guid = guid;
    }
    get name() {
        if (this._name === undefined) {
            this._name = path.basename(this.root_uri.fsPath);
        }
        return this._name;
    }
    get root_uri() {
        if (this._root_uri === undefined) {
            this._root_uri = vscode.Uri.joinPath(this.libpartdata_uri, "..");
        }
        return this._root_uri;
    }
    get images_uri() {
        if (this._images_uri === undefined) {
            this._images_uri = vscode.Uri.joinPath(this.root_uri, "images");
        }
        return this._images_uri;
    }
    /** check whether has file relative to root_uri
     *  optionally offering masterscript as fallback
     *  then offering libpartdata.xml as fallback
     */
    async relative_withFallback(relative, masterscript) {
        let target = vscode.Uri.joinPath(this.root_uri, relative);
        if ((await (0, extension_1.fileExists)(target))) {
            return target;
        }
        else {
            if (masterscript) {
                target = vscode.Uri.joinPath(this.root_uri, "scripts/1d.gdl");
            }
            if (masterscript && await (0, extension_1.fileExists)(target)) {
                return target;
            }
            else {
                return this.libpartdata_uri; // assume always exists
            }
        }
    }
    async scriptUri(script) {
        const cachedValue = this.scriptsCache.get(script);
        if (cachedValue !== undefined) { // null if script doesn't exist
            return cachedValue;
        }
        else {
            const target = vscode.Uri.joinPath(this.root_uri, "scripts", `${Parser.scriptFile[script]}.gdl`);
            let result;
            if (await (0, extension_1.fileExists)(target)) {
                result = target;
            }
            else {
                result = null;
            }
            this.scriptsCache.set(script, result);
            return result;
        }
    }
    /** return map of existing script types and uris (unsaved files not included) */
    async allScripts() {
        const uris = await Promise.all(Parser.Scripts.map(async (script) => [script, await this.scriptUri(script)]));
        return new Map(uris.filter((e) => e[1] !== null));
    }
    /** return names and uris of files in images folder */
    async allImages() {
        try {
            const entries = await vscode.workspace.fs.readDirectory(this.images_uri);
            const imagenames = entries.filter(e => e[1] !== vscode.FileType.Directory)
                .map(e => e[0]);
            return new Map(imagenames.map(e => [e, vscode.Uri.joinPath(this.images_uri, e)]));
        }
        catch {
            return new Map();
        }
    }
    async imageIndex(name) {
        if (this.imagesCache === undefined) {
            // enumerate images in libpartdata - creates this.imagesCache
            await this.embedded_image_insertposition();
        }
        return this.imagesCache.get(name);
    }
    /**  returns position and picture index where new embedded images can be added */
    async embedded_image_insertposition() {
        const libpartdata_doc = await vscode.workspace.openTextDocument(this.libpartdata_uri);
        const libpartdata = libpartdata_doc.getText();
        let greatestIndex = -1;
        let lastPosition = -1;
        // find greatest index and last image position
        this.imagesCache = new Map();
        for (const match of libpartdata.matchAll(/<GDLPict\s(.*?\s*SubIdent\s*=\s*"(\d+)".*?)\/>/migd)) {
            const index = parseInt(match[2]);
            greatestIndex = Math.max(greatestIndex, index);
            lastPosition = Math.max(lastPosition, match.indices[0][1]);
            // get name and store in cache with index
            const namematch = match[1].match(/\sName\s*=\s*"(.*?)"/i);
            if (namematch) {
                this.imagesCache.set(namematch[1], index);
            }
        }
        // determine insert position
        let insertPosition;
        if (lastPosition == -1) {
            // no images yet, insert before end of LibpartData
            const found = libpartdata.search(/<\/LibpartData>/mig);
            if (found !== -1) {
                insertPosition = libpartdata_doc.positionAt(found);
            }
            else {
                // no LibpartData, insert at end
                insertPosition = libpartdata_doc.positionAt(libpartdata.length - 1);
            }
        }
        else {
            // insert after last GDLPict
            insertPosition = libpartdata_doc.positionAt(lastPosition + 1);
        }
        return { position: insertPosition, index: greatestIndex + 1 };
    }
}
exports.LibpartInfo = LibpartInfo;
class WSSymbols {
    // folder contents indexed by root folder (for multi-root workspaces)
    libparts = [];
    unprocessed = true;
    // fired when finished scanning workspace
    _onDidCollect = new vscode.EventEmitter();
    onDidCollect = this._onDidCollect.event;
    constructor(context) {
        context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(async () => this.changeFolders()), vscode.workspace.onDidCreateFiles(async () => this.changeFolders()), vscode.workspace.onDidDeleteFiles(async () => this.changeFolders()), vscode.workspace.onDidRenameFiles(async () => this.changeFolders()));
    }
    async collectLibparts() {
        const libpartdata = await vscode.workspace.findFiles("**/libpartdata.xml");
        const libparts = await Promise.allSettled(libpartdata.map(async (libpartdata_uri) => {
            const xml = (await (0, extension_1.readFile)(libpartdata_uri, true)); //can't be undefined because file exists
            const guid_ = xml.match(/^\s*<MainGUID>([-0-9A-F]*)<\/MainGUID>/mi);
            let guid = "";
            if (guid_) {
                guid = guid_[1];
            }
            return new LibpartInfo(libpartdata_uri, guid);
        }));
        this.libparts = libparts
            .map(result => result.status === "fulfilled" ? result.value : undefined)
            .filter((e) => (e !== undefined));
        this.unprocessed = false;
        this._onDidCollect.fire(null);
    }
    async changeFolders() {
        //console.log("WSSymbols changeFolders");
        this.unprocessed = true;
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: 'Collecting libparts in workspace...'
        }, async () => await this.collectLibparts());
    }
    async provideWorkspaceSymbols(query, token) {
        // when called from UI don't offer master script as fallback
        return this.provideWorkspaceSymbols_withFallback(vscode.window.activeTextEditor?.document, false, query, true, token);
    }
    async provideWorkspaceSymbols_withFallback(document, masterscript, query, addGuids, token) {
        //get filename from document
        let open_relative = "";
        if (document) {
            const editorpath = document.fileName;
            const ext = path.extname(editorpath);
            const fname = path.basename(editorpath, ext);
            if (ext === ".gdl") {
                // open in scripts folder
                open_relative = `scripts/${fname}${ext}`;
            }
            else if (ext === ".xml") {
                // open in base folder
                open_relative = `${fname}${ext}`;
            }
        }
        return this.provideWorkspaceSymbolsSimilarTo(open_relative, masterscript, query, addGuids, token);
    }
    async provideWorkspaceSymbolsSimilarTo(relative, masterscript, query, addGuids, token) {
        //console.log("provideWorkspaceSymbols");
        return new Promise(async (resolve, reject) => {
            token.onCancellationRequested(reject);
            const targetposition = new vscode.Position(0, 0);
            const query_lc = query.toLowerCase();
            const symbolpairs = await Promise.allSettled((await this.values(token))
                .filter(e => filterquery(e, query_lc))
                .map(async (libpart) => {
                let target = await libpart.relative_withFallback(relative, masterscript);
                const libpartByName = new vscode.SymbolInformation(`"${libpart.name}"`, vscode.SymbolKind.File, "", new vscode.Location(target, targetposition));
                if (addGuids) {
                    const libpartByGUID = new vscode.SymbolInformation(libpart.guid, vscode.SymbolKind.File, ` -  ${libpart.name} `, new vscode.Location(target, targetposition));
                    return [libpartByName, libpartByGUID];
                }
                return [libpartByName, undefined];
            }));
            const symbols = symbolpairs
                .flatMap(result => result.status === "fulfilled" ? result.value : undefined)
                .filter((e) => (e !== undefined));
            resolve(symbols);
        });
    }
    async values(cancel) {
        if (this.unprocessed) {
            //wait for workspace scanning to finish
            await new Promise((resolve, reject) => {
                cancel.onCancellationRequested(reject);
                this.onDidCollect(resolve);
            });
        }
        return [...this.libparts];
    }
}
exports.WSSymbols = WSSymbols;
function filterquery(libpart, query_lc) {
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
//# sourceMappingURL=wssymbols.js.map