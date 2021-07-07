"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HSFLibpart = void 0;
const paramlistparser_1 = require("./paramlistparser");
const constparser_1 = require("./constparser");
class HSFLibpart {
    constructor(rootFolder) {
        this.rootFolder = rootFolder;
        this._paramlist = new paramlistparser_1.ParamList(this.rootFolder);
        this._masterconstants = new constparser_1.Constants(this.rootFolder, "scripts/1d.gdl");
    }
    get paramlist() { return this._paramlist; }
    get masterconstants() { return this._masterconstants; }
}
exports.HSFLibpart = HSFLibpart;
//# sourceMappingURL=parsehsf.js.map