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
        return [...line.matchAll(Jumps.regex)].map(match => ({
            //command: match[1].toLowerCase(),
            target: match[3],
            range: new vscode.Range(linenumber, match.index, linenumber, match.index + match[0].length)
        }));
    }
}
exports.Jumps = Jumps;
Jumps.regex = /((then|goto|gosub|else)\s+)(([0-9]+)|((["'`´“”’‘])([^"'`´“”’‘]+)\6))/ig;
//# sourceMappingURL=jumpparser.js.map