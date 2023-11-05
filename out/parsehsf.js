"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HSFLibpart = void 0;
const vscode = require("vscode");
const Parser = require("./parsexmlgdl");
const paramlistparser_1 = require("./paramlistparser");
const constparser_1 = require("./constparser");
const varparser_1 = require("./varparser");
const wssymbols_1 = require("./wssymbols");
class HSFLibpart {
    constructor(rootFolder, currentScript) {
        this._paramlist = new paramlistparser_1.ParamList();
        this._constants = new Map();
        this._variables = new Map();
        this.info = new wssymbols_1.LibpartInfo(vscode.Uri.joinPath(rootFolder, "libpartdata.xml"), "");
        this.processing = Promise.allSettled([
            this.constants(Parser.ScriptType.D),
            this.constants(currentScript),
            this.vardefs(currentScript),
            this.read_paramlist()
        ]);
        //TODO register paramlist observer
    }
    get paramlist() { return this._paramlist; }
    async refresh(script) {
        this._constants.delete(script);
        await this.constants(script);
    }
    async read_paramlist() {
        await this._paramlist.addfrom(this.info.root_uri);
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
}
exports.HSFLibpart = HSFLibpart;
//# sourceMappingURL=parsehsf.js.map