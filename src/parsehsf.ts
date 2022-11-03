import * as vscode from 'vscode';

import * as Parser from './parsexmlgdl';
import { ParamList } from './paramlistparser';
import { Constants } from './constparser';
import { LibpartInfo } from './wssymbols';

export class HSFLibpart {
    private readonly _paramlist: ParamList = new ParamList();
    get paramlist() : ParamList { return this._paramlist; }

    private readonly _constants = new Map<Parser.ScriptType, Constants>();

    readonly processing : Promise<PromiseSettledResult<void>[]>;
    public readonly info : LibpartInfo;

    constructor(rootFolder : vscode.Uri, currentScript : Parser.ScriptType) {
        this.info = new LibpartInfo(vscode.Uri.joinPath(rootFolder, "libpartdata.xml"), ""); 

        this.processing = Promise.allSettled([  // parallel execution
            this.constants(Parser.ScriptType.D) as unknown as Promise<void>,
            this.constants(currentScript) as unknown as Promise<void>,
            this.read_paramlist()
        ]);

        //TODO register paramlist observer
    }

    public async refresh(script: Parser.ScriptType) {
        this._constants.delete(script);
        await this.constants(script);
    }

    private async read_paramlist() {
        await this._paramlist.addfrom(this.info.root_uri);
    }

    public async constants(script: Parser.ScriptType) : Promise<Constants> {
        let constants = this._constants.get(script);
        if (constants === undefined) {
            constants = new Constants();
            await constants.addfromfile(this.info.root_uri, `scripts/${Parser.scriptFile[script]}.gdl`)
            this._constants.set(script, constants);
        }
        return constants;
    }
}