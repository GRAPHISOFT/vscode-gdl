"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HSFLibpart = void 0;
const vscode = require("vscode");
const paramlistparser_1 = require("./paramlistparser");
const constparser_1 = require("./constparser");
const varparser_1 = require("./varparser");
const wssymbols_1 = require("./wssymbols");
class HSFLibpart {
    _paramlist;
    _constants = new Map();
    _variables = new Map();
    info;
    constructor(rootFolder) {
        this.info = new wssymbols_1.LibpartInfo(vscode.Uri.joinPath(rootFolder, "libpartdata.xml"), "");
    }
    refresh(paramlist, scripts) {
        if (scripts) {
            // always delete all cache because all script's results are shown
            this._constants.clear();
            this._variables.clear();
        }
        if (paramlist) {
            this._paramlist = undefined;
        }
    }
    async constants(script) {
        let constants = this._constants.get(script);
        if (constants === undefined) {
            constants = new constparser_1.Constants();
            const uri = await this.info.scriptUri(script);
            if (uri !== null) {
                await constants.addfromfile(uri);
            }
            this._constants.set(script, constants);
        }
        return constants;
    }
    async vardefs(script) {
        let variables = this._variables.get(script);
        if (variables === undefined) {
            variables = new varparser_1.Variables();
            const uri = await this.info.scriptUri(script);
            if (uri !== null) {
                await variables.addfromfile(uri);
            }
            this._variables.set(script, variables);
        }
        return variables;
    }
    async paramlist() {
        if (this._paramlist === undefined) {
            this._paramlist = new paramlistparser_1.ParamList(this.info.root_uri);
            await this._paramlist.parse();
        }
        return this._paramlist;
    }
}
exports.HSFLibpart = HSFLibpart;
//# sourceMappingURL=parsehsf.js.map