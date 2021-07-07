import * as vscode from 'vscode';

import { hasLibPartData } from './extension';

import fs = require('fs');

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
    private constants: Map<string, Constant[]>;

    constructor(rootfolder: vscode.Uri, filename: string) {
        if (hasLibPartData(rootfolder)) {
            //console.log("Constants() read master of", rootfolder.fsPath);
            this.constants = this.parse(vscode.Uri.joinPath(rootfolder, filename));
        }
        else {
            this.constants = new Map<string, Constant[]>();
        }
    }

    parse(uri: vscode.Uri) : Map<string, Constant[]> {
        let constants = new Map<string, Constant[]>();
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