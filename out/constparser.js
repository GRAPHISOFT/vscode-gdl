"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Constants = exports.Constant = void 0;
const vscode = require("vscode");
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
    addfromtext(code) {
        if (code !== undefined) {
            const constants_ = code.match(/^\s*[A-Z][0-9A-Z~]*(_[0-9A-Z_~]+)?\s*=.*(?<!(\\|then|THEN|,))\s*$/mg);
            //ABC[_ABC] = * but not ending \ or then or , (multiline conditions, macro paramlist)
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
    async addfromfile(scriptUri) {
        const document = await vscode.workspace.openTextDocument(scriptUri);
        this.addfromtext(document.getText());
    }
    [Symbol.iterator]() {
        return this.constants.values();
    }
}
exports.Constants = Constants;
//# sourceMappingURL=constparser.js.map