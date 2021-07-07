"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Constants = exports.Constant = void 0;
const vscode = require("vscode");
const extension_1 = require("./extension");
const fs = require("fs");
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
    constructor(rootfolder, filename) {
        if (extension_1.hasLibPartData(rootfolder)) {
            //console.log("Constants() read master of", rootfolder.fsPath);
            this.constants = this.parse(vscode.Uri.joinPath(rootfolder, filename));
        }
        else {
            this.constants = new Map();
        }
    }
    parse(uri) {
        let constants = new Map();
        let masterscript = uri.fsPath;
        if (fs.existsSync(masterscript)) {
            let data = fs.readFileSync(masterscript, "utf8");
            let constants_ = data.match(/^\s*[A-Z][0-9A-Z~]*(_[0-9A-Z_~]+)?\s*=.*$/mg);
            if (constants_) {
                for (const gdl of constants_) {
                    let constant = new Constant(gdl);
                    let group = constants.get(constant.prefix);
                    if (group) {
                        group.push(constant);
                    }
                    else {
                        group = [];
                        group.push(constant);
                        constants.set(constant.prefix, group);
                    }
                }
            }
        }
        return constants;
    }
    [Symbol.iterator]() {
        return this.constants.values();
    }
}
exports.Constants = Constants;
//# sourceMappingURL=constparser.js.map