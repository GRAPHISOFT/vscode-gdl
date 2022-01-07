"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Constants = exports.Constant = void 0;
const vscode = require("vscode");
const extension_1 = require("./extension");
class Constant {
    constructor(gdl) {
        let result_ = gdl.match(/(?<=^\s*)([A-Z][0-9A-Z~]*)(_[0-9A-Z_~]+)?\s*=\s*(.*)\s*$/);
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
        let script = vscode.Uri.joinPath(rootfolder, relpath);
        const code = await (0, extension_1.readFile)(script);
        if (code) {
            let constants_ = code.match(/^\s*[A-Z][0-9A-Z~]*(_[0-9A-Z_~]+)?\s*=.*$/mg);
            if (constants_) {
                for (const gdl of constants_) {
                    let constant = new Constant(gdl);
                    let group = this.constants.get(constant.prefix);
                    if (group) {
                        group.push(constant);
                    }
                    else {
                        group = [];
                        group.push(constant);
                        this.constants.set(constant.prefix, group);
                    }
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