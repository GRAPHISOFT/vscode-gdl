import * as vscode from 'vscode';

export class SubLine {
    public readonly is_continued: boolean;
    public readonly is_empty: boolean;
    
    constructor(public text: string, public start: vscode.Position) {
        this.is_continued = (text.search(/[,\\](?=\s*$)/i) >= 0);
        this.is_empty = (text.search(/^\s*$/i) >= 0);
    }
    
    /** create sublines guaranteed to contain no more than one statement, and comments removed */
    static fromText(line: string, linenumber: number) : SubLine[] {
        const splitlines = line.replace(/"[^"]+"/g, m => "_".repeat(m.length)) // change strings to dummy variable, removing ! and : characters (assuming no multiline strings)
                               .replace(/'[^']+'/g, m => "_".repeat(m.length))
                               .replace(/`[^`]+`/g, m => "_".repeat(m.length))
                               .replace(/“[^“]+“/g, m => "_".repeat(m.length))
                               .replace(/”[^”]+”/g, m => "_".repeat(m.length))
                               .replace(/´[^´]+´/g, m => "_".repeat(m.length))
                               .replace(/’[^’]+’/g, m => "_".repeat(m.length))
                               .replace(/‘[^‘]+‘/g, m => "_".repeat(m.length))
                               .replace(/!.*$/g, "")   // remove everything after first !
                               .split(":");

        let start = 0;
        return splitlines.map(subline => {
            const sl = new SubLine(line.substring(start, start + subline.length), new vscode.Position(linenumber, start))
            start += subline.length + 1;
            return sl;
        });
    }
}

export class Variables {
    private init_ranges: SubLine[] = [];

    addfromtext(code: string | undefined) {
        if (code !== undefined) {
            /*
            variable definitions:
                ... = 
                dict ...
                dim ...
                TODO handle multiline dim, dict, handle returned_parameters, requests, appquerys...
            */

            const lines = code.split(/\r?\n/);

            // remove comments and split lines at : (assuming no multiline strings)
            const sublines = lines.flatMap(SubLine.fromText);

            // skip lines with whitespace (assuming no multiline strings)
            // check only lines which are not after a statement continuation
            //     ,
            //     \

            let prevline_finished = true;
            this.init_ranges = sublines.filter(subline => {
                if (subline.is_empty) return false;
                const hasinit = prevline_finished && (subline.text.search(/^\s*([_~a-z][_~0-9a-z]*\s*=|dim|dict)\s*./i) >= 0);
                prevline_finished = !subline.is_continued;
                return hasinit;
            });
        }
    }

    async addfromfile(scriptUri: vscode.Uri) {
        const document = await vscode.workspace.openTextDocument(scriptUri);
        this.addfromtext(document.getText());
    }

    [Symbol.iterator]() {
        return this.init_ranges.values();
    }
}