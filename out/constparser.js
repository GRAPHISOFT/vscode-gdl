"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Constants = exports.Constant = void 0;
const vscode = require("vscode");
const extension_1 = require("./extension");
class Constant {
    constructor(gdl) {
        const result_ = gdl.match(/(?<=^\s*)([A-Z][0-9A-Z~]*)(_[0-9A-Z_~]+)?\s*=\s*(.*)\s*$/);
        if (result_) {
            this.prefix = result_[1];
            this.id = (result_[2] ? result_[2] : "");
            this.value = result_[3];
        }
        else {
            this.prefix = "";
            this.id = "";
            this.value = "";
        }
    }
    get name() {
        return this.prefix + this.id;
    }
}
exports.Constant = Constant;
class Constants {
    constructor() {
        this.constants = new Map();
    }
    async addfrom(rootfolder, relpath) {
        //console.log("Constants.addfrom()", rootfolder.fsPath, relpath);
        const script = vscode.Uri.joinPath(rootfolder, relpath);
        const code = await (0, extension_1.readFile)(script);
        if (code) {
            const constants_ = code.match(/^\s*[A-Z][0-9A-Z~]*(_[0-9A-Z_~]+)?\s*=.*$/mg);
            if (constants_) {
                for (const gdl of constants_) {
                    const constant = new Constant(gdl);
                    if (!this.constants.has(constant.prefix)) {
                        this.constants.set(constant.prefix, []);
                    }
                    this.constants.get(constant.prefix).push(constant);
                }
            }
        }
    }
    [Symbol.iterator]() {
        return this.constants.values();
    }
}
exports.Constants = Constants;
//# sourceMappingURL=constparser.js.map