import * as vscode from 'vscode';

export type Jump = {
    command: string,
    target: string,
    range: vscode.Range
}

export class Jumps {
    private static regex = /((then|goto|gosub)\s+)(([0-9]+)|((["'`´“”’‘])([^"'`´“”’‘]+)\6))/i;
                           // keep synced with Parser.GDLFunction.regex, but backreference index differs!
    public readonly jumps: Array<Jump>;

    constructor(code : string) {
        this.jumps = code.split("\n")
                         .flatMap(Jumps.matchLine);
    }

    private static matchLine(line: string, linenumber: number) : Jump[] {
        const match = line.match(Jumps.regex);
        if (match) {
            return [{
                command: match[1].toLowerCase(),
                target: match[3],       //match[4] ?? match[7],   // strings unquoted
                range: new vscode.Range(linenumber, match.index!,
                                        linenumber, match.index! + match[0].length)
            }];
        } else {
            return [];
        }
    }
}