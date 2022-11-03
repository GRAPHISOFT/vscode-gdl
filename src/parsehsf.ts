import * as vscode from 'vscode';
import { ParamList } from './paramlistparser';
import { Constants } from './constparser';

export class HSFLibpart {
    private readonly _paramlist: ParamList = new ParamList();
    get paramlist() : ParamList { return this._paramlist; }

    private readonly _masterconstants: Constants = new Constants();
    get masterconstants() : Constants { return this._masterconstants; }

    readonly processing : Promise<[PromiseSettledResult<void>, PromiseSettledResult<void>]>;

    constructor(public readonly rootFolder : vscode.Uri) {
        this.processing = Promise.allSettled([  // parallel execution
            this.read_master_constants(),
            this.read_paramlist()
        ]);
    }

    private async read_paramlist() {
        await this._paramlist.addfrom(this.rootFolder);
    }

    private async read_master_constants() {
        await this._masterconstants.addfrom(this.rootFolder, "scripts/1d.gdl");
    }
}