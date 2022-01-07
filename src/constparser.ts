import * as vscode from 'vscode';

import { readFile } from './extension';

export class Constant {
    readonly prefix: string;
    readonly id: string;
    readonly value: string;

    constructor(gdl: string) {
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

    get name() : string {
        return this.prefix + this.id;
    }
}

export class Constants {
    private constants: Map<string, Constant[]> = new Map<string, Constant[]>();

    async addfrom(rootfolder: vscode.Uri, relpath: string) {
        //console.log("Constants.addfrom()", rootfolder.fsPath, relpath);
        let script = vscode.Uri.joinPath(rootfolder, relpath);
        const code = await readFile(script);

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