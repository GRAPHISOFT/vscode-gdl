import * as vscode from 'vscode';

import * as Parser from './parsexmlgdl';
import { ParamList } from './paramlistparser';
import { Constants } from './constparser';
import { Variables } from './varparser';
import { LibpartInfo } from './wssymbols';

export class HSFLibpart {
    private _paramlist: ParamList | undefined;

    private readonly _constants = new Map<Parser.ScriptType, Constants>();
    private readonly _variables = new Map<Parser.ScriptType, Variables>();

    public readonly info : LibpartInfo;

    constructor(rootFolder : vscode.Uri) {
        this.info = new LibpartInfo(vscode.Uri.joinPath(rootFolder, "libpartdata.xml"), ""); 
    }


    public async refresh(script: Parser.ScriptType) {
        this._constants.delete(script);
        this._variables.delete(script);
        //TODO register paramlist observer
    }

    public async constants(script: Parser.ScriptType) : Promise<Constants> {
        let constants = this._constants.get(script);
        if (constants === undefined) {
            constants = new Constants();
            const uri = await this.info.scriptUri(script);
            if (uri !== null) {
                await constants.addfromfile(uri);
            }
            this._constants.set(script, constants);
        }
        return constants;
    }

    public async vardefs(script: Parser.ScriptType) : Promise<Variables> {
        let variables = this._variables.get(script);
        if (variables === undefined) {
            variables = new Variables();
            const uri = await this.info.scriptUri(script);
            if (uri !== null) {
                await variables.addfromfile(uri);
            }
            this._variables.set(script, variables);
        }
        return variables;
    }

    public async paramlist() : Promise<ParamList> {
        if (this._paramlist === undefined) {
            this._paramlist = new ParamList(this.info.root_uri);
            await this._paramlist.parse();
        }
        return this._paramlist;
    }
}