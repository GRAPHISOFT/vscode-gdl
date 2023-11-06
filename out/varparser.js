"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Variables = void 0;
const vscode = require("vscode");
class Variables {
    constructor() {
        this.has_init = [];
    }
    addfromtext(code) {
        if (code !== undefined) {
            /*
            mark lines continuing an expression / list
                ,   ! comment
                \   ! comment
            skipping lines with whitespace / comment only (assuming no multiline strings)
                check only lines which are not after a marked line

            variable definitions:
                ... =
                dict ...
                dim ...
                TODO handle multiline dim, dict, handle returned_parameters, requests, appquerys...
            */
            const lines = code.split(/\r?\n/);
            const is_continued = lines.map(line => line.search(/[,\\](?=\s*(!.*)?$)/i) >= 0);
            const is_empty = lines.map(line => line.search(/^\s*(!.*)?$/i) >= 0);
            this.has_init = lines.map(() => false); // init array with same size
            let i = 0;
            let prevline_finished = true;
            while (i < lines.length) {
                if (!is_empty[i]) {
                    let line_finished = !is_continued[i];
                    if (prevline_finished) {
                        this.has_init[i] = (lines[i].search(/^\s*([_~a-z][_~0-9a-z]*\s*=|dim|dict)\s*./i) >= 0);
                    }
                    // proceed
                    prevline_finished = line_finished;
                }
                i++;
            }
        }
    }
    async addfromfile(scriptUri) {
        const document = await vscode.workspace.openTextDocument(scriptUri);
        this.addfromtext(document.getText());
    }
    [Symbol.iterator]() {
        return this.has_init.values();
    }
}
exports.Variables = Variables;
//# sourceMappingURL=varparser.js.map