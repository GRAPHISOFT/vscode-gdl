"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Variables = void 0;
const vscode = require("vscode");
class SubLine {
    text;
    start;
    is_continued;
    is_empty;
    constructor(text, start) {
        this.text = text;
        this.start = start;
        this.is_continued = (text.search(/[,\\](?=\s*(!.*)?$)/i) >= 0);
        this.is_empty = (text.search(/^\s*(!.*)?$/i) >= 0);
    }
    /** create sublines guaranteed to contain no more than one statement */
    static fromText(line, linenumber) {
        const splitlines = line.replace(/"[^"]+"/g, m => "_".repeat(m.length)) // change strings to dummy variable, removing ! and : characters (assuming no multiline strings)
            .replace(/'[^']+'/g, m => "_".repeat(m.length))
            .replace(/`[^`]+`/g, m => "_".repeat(m.length))
            .replace(/“[^“]+“/g, m => "_".repeat(m.length))
            .replace(/”[^”]+”/g, m => "_".repeat(m.length))
            .replace(/´[^´]+´/g, m => "_".repeat(m.length))
            .replace(/’[^’]+’/g, m => "_".repeat(m.length))
            .replace(/‘[^‘]+‘/g, m => "_".repeat(m.length))
            .replace(/!.*$/g, m => " ".repeat(m.length)) // remove everything after first !
            .replace(/\b(then|else)\b/g, m => ":".repeat(m.length)) // split at then/else
            .split(":");
        let start = 0;
        return splitlines.map(subline => {
            const sl = new SubLine(line.substring(start, start + subline.length), new vscode.Position(linenumber, start));
            start += subline.length + 1;
            return sl;
        });
    }
}
class Variables {
    vardefs = new Map(); // array ordered on line numbers
    addfromtext(code) {
        if (code !== undefined) {
            /*  variable definitions:
                ... =
                ...[...] =      assuming no = inside []
                TODO handle dim, dict, returned_parameters, requests, appquerys...
            */
            const lines = code.split(/\r?\n/);
            // remove comments and split lines at : (assuming no multiline strings)
            const sublines = lines.flatMap(SubLine.fromText);
            // skip lines with whitespace (assuming no multiline strings)
            // check only lines which are not after a statement continuation
            //     ,
            //     \
            let prevline_finished = true;
            const vardefs = sublines.map(subline => {
                if (subline.is_empty)
                    return undefined; // prevline_finished unchanged
                let result;
                if (prevline_finished) {
                    const match = subline.text.match(/^\s*([_~a-z][_~0-9a-z]*)\s*(\[[^=]*\])?\s*=\s*./id);
                    if ((match?.index ?? -1) >= 0) {
                        const variable = match[1];
                        const varstart = match.indices[1][0];
                        result = [variable, { subline: subline,
                                varstart: varstart,
                                defstart: match[0].length - 1 }];
                    }
                }
                prevline_finished = !subline.is_continued;
                return result;
            }).filter((e) => e !== undefined);
            for (const [variable, vardef] of vardefs) {
                if (!this.vardefs.has(variable)) {
                    this.vardefs.set(variable, new Array());
                }
                this.vardefs.get(variable).push(vardef);
            }
        }
    }
    async addfromfile(scriptUri) {
        const document = await vscode.workspace.openTextDocument(scriptUri);
        this.addfromtext(document.getText());
    }
    get(variable) {
        return this.vardefs.get(variable) ?? [];
    }
    [Symbol.iterator]() {
        return this.vardefs.keys();
    }
}
exports.Variables = Variables;
//# sourceMappingURL=varparser.js.map