"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Jumps = void 0;
const vscode = require("vscode");
class Jumps {
    constructor(code) {
        this.jumps = code.split("\n")
            .flatMap(Jumps.matchLine);
    }
    static matchLine(line, linenumber) {
        const match = line.match(Jumps.regex);
        if (match) {
            return [{
                    command: match[1].toLowerCase(),
                    target: match[3],
                    range: new vscode.Range(linenumber, match.index, linenumber, match.index + match[0].length)
                }];
        }
        else {
            return [];
        }
    }
}
exports.Jumps = Jumps;
Jumps.regex = /((then|goto|gosub)\s+)(([0-9]+)|((["'`´“”’‘])([^"'`´“”’‘]+)\6))/i;
//# sourceMappingURL=jumpparser.js.map