import * as vscode from 'vscode';

import { readFile } from './extension';

export class Constant {
    readonly prefix: string;
    readonly id: string;
    readonly value: string;

    constructor(gdl: string) {
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

    get name() : string {
        return this.prefix + this.id;
    }
}

export class Constants {
    private constants: Map<string, Constant[]> = new Map<string, Constant[]>();

    async addfrom(rootfolder: vscode.Uri, relpath: string) {
        const script = vscode.Uri.joinPath(rootfolder, relpath);
        const code = await readFile(script);

        if (code) {
            const constants_ = code.match(/^\s*[A-Z][0-9A-Z~]*(_[0-9A-Z_~]+)?\s*=.*$/mg);

            if (constants_) {
                for (const gdl of constants_) {
                    const constant = new Constant(gdl);
    
                    if (!this.constants.has(constant.prefix)) {
                        this.constants.set(constant.prefix, []);
                    }
                    this.constants.get(constant.prefix)!.push(constant);
                }
            }
        }
    }

    [Symbol.iterator]() {
        return this.constants.values();
    }

}