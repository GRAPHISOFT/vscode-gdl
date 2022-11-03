"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HSFLibpart = void 0;
const vscode = require("vscode");
const paramlistparser_1 = require("./paramlistparser");
const constparser_1 = require("./constparser");
const wssymbols_1 = require("./wssymbols");
class HSFLibpart {
    constructor(rootFolder) {
        this._paramlist = new paramlistparser_1.ParamList();
        this._masterconstants = new constparser_1.Constants();
        this.processing = Promise.allSettled([
            this.read_master_constants(),
            this.read_paramlist()
        ]);
        this.info = new wssymbols_1.LibpartInfo(vscode.Uri.joinPath(rootFolder, "libpartdata.xml"), "");
    }
    get paramlist() { return this._paramlist; }
    get masterconstants() { return this._masterconstants; }
    async read_paramlist() {
        await this._paramlist.addfrom(this.info.root_uri);
    }
    async read_master_constants() {
        await this._masterconstants.addfromfile(this.info.root_uri, "scripts/1d.gdl");
    }
}
exports.HSFLibpart = HSFLibpart;
//# sourceMappingURL=parsehsf.js.map