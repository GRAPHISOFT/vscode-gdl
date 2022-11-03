import * as vscode from 'vscode';

import { ParamList } from './paramlistparser';
import { Constants } from './constparser';
import { LibpartInfo } from './wssymbols';

export class HSFLibpart {
    private readonly _paramlist: ParamList = new ParamList();
    get paramlist() : ParamList { return this._paramlist; }

    private readonly _masterconstants: Constants = new Constants();
    get masterconstants() : Constants { return this._masterconstants; }

    readonly processing : Promise<PromiseSettledResult<void>[]>;
    public readonly info : LibpartInfo;

    constructor(rootFolder : vscode.Uri) {
        this.processing = Promise.allSettled([  // parallel execution
            this.read_master_constants(),
            this.read_paramlist()
        ]);

        this.info = new LibpartInfo(vscode.Uri.joinPath(rootFolder, "libpartdata.xml"), ""); 
    }

    private async read_paramlist() {
        await this._paramlist.addfrom(this.info.root_uri);
    }

    private async read_master_constants() {
        await this._masterconstants.addfromfile(this.info.root_uri, "scripts/1d.gdl");
    }
}