"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HSFLibpart = void 0;
const paramlistparser_1 = require("./paramlistparser");
const constparser_1 = require("./constparser");
class HSFLibpart {
    constructor(rootFolder) {
        this.rootFolder = rootFolder;
        this._paramlist = new paramlistparser_1.ParamList();
        this._masterconstants = new constparser_1.Constants();
    }
    get paramlist() { return this._paramlist; }
    get masterconstants() { return this._masterconstants; }
    async read_paramlist() {
        await this._paramlist.addfrom(this.rootFolder);
    }
    async read_master_constants() {
        await this._masterconstants.addfrom(this.rootFolder, "scripts/1d.gdl");
    }
}
exports.HSFLibpart = HSFLibpart;
//# sourceMappingURL=parsehsf.js.map