import * as vscode from 'vscode';
import { ParamList } from './paramlistparser';
import { Constants } from './constparser';

export class HSFLibpart {
    private readonly _paramlist: ParamList;
    get paramlist() : ParamList { return this._paramlist; }

    private readonly _masterconstants: Constants;
    get masterconstants() : Constants { return this._masterconstants; }

    constructor(public readonly rootFolder : vscode.Uri) {
        this._paramlist = new ParamList(this.rootFolder);
        this._masterconstants = new Constants(this.rootFolder, "scripts/1d.gdl");
    }
}