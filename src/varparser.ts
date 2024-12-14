import * as vscode from 'vscode';

class SubLine {
    public readonly is_continued: boolean;
    public readonly is_empty: boolean;
    public readonly text: string;
    
    constructor(src_line: string, readonly maskedText: string, readonly start: vscode.Position) {
        this.is_continued = (maskedText.search(/[,\\](?=\s*(!.*)?$)/i) >= 0);
        this.is_empty = (maskedText.search(/^\s*(!.*)?$/i) >= 0);
        this.text = src_line.substring(start.character, start.character + this.maskedText.length)
    }

    get is_comma_continued() {
        return (this.maskedText.search(/,(?=\s*(!.*)?$)/i) >= 0);
    }
    
    /** create sublines guaranteed to contain no more than one statement */
    static fromText(line: string, linenumber: number) : SubLine[] {
        const splitlines = line .replace(/"[^"]+"/g, m => "_".repeat(m.length)) // change strings to dummy variable, removing ! and : characters (assuming no multiline strings)
                                .replace(/'[^']+'/g, m => "_".repeat(m.length))
                                .replace(/`[^`]+`/g, m => "_".repeat(m.length))
                                .replace(/“[^“]+“/g, m => "_".repeat(m.length))
                                .replace(/”[^”]+”/g, m => "_".repeat(m.length))
                                .replace(/´[^´]+´/g, m => "_".repeat(m.length))
                                .replace(/’[^’]+’/g, m => "_".repeat(m.length))
                                .replace(/‘[^‘]+‘/g, m => "_".repeat(m.length))
                                .replace(/!.*$/g, m => " ".repeat(m.length))             // remove everything after first !
                                .replace(/\b(then|else)\b/g, m => ":".repeat(m.length))  // split at then/else
                                .split(":");

        let start = 0;
        return splitlines.map(subline => {
            const sl = new SubLine(line, subline, new vscode.Position(linenumber, start));
            start += subline.length + 1;
            return sl;
        });
    }
}

type RegExpMatchArryWithIndices = RegExpMatchArray & { indices: Array<Array<number>> } | null;
export type Vardef = { subline: SubLine, varstart: number, defstart: number, isSubkey: boolean };
type VardefOf = [string, Vardef];  // key, position

export class Variables {
    /*  variable definitions:
        ... = 
        ...[...] =
        dim ..., ...
        dict ..., ...
        returned_parameters ..., ...
        TODO handle requests, appquerys...
        out of scope:   one-line do/while/repeat blocks (bad style)
                        parameters ... = ... (bad style if not the same)
    */
    private vardefs = new Map<string, Array<Vardef>>(); // array ordered on line numbers

    private addfromtext(code: string | undefined) {
        if (code !== undefined) {
            for (const [variable, vardef] of Variables.variable_definitions(code)) {
                if (!this.vardefs.has(variable)) {
                    this.vardefs.set(variable, new Array<Vardef>());
                }
                this.vardefs.get(variable)!.push(vardef);
            }
        }
    }

    private static* variable_definitions(code: string): Generator<VardefOf> {
        // split code to sublines with maximum one statement (or part of it)
        // skip lines with whitespace (assuming no multiline strings)
        const nonempty = code
                .split(/\r?\n/)
                .flatMap(SubLine.fromText)
                .filter(subline => !subline.is_empty);

        let i = -1;
        while (++i < nonempty.length) {
            // multiple dim / dict / returned_parameters separated by ,
            if (nonempty[i].maskedText.match(/^\s*(di(m|ct)|returned_parameters)\s+/i)) {

                let ignoreFirstMatch = true; // ignore keyword on first line
                let continue_group = true; // handle sub-lines until next non-continued
                while (i < nonempty.length && continue_group) {
                    // can have multiple declarations separated by ,
                    for (const vd of Variables.identifiers(nonempty[i])) {
                        if (ignoreFirstMatch) {
                            ignoreFirstMatch = false;
                            continue;
                        }
                        yield vd;
                    }

                    // loop
                    continue_group = nonempty[i].is_comma_continued;
                    if (continue_group) i++;    // otherwise incremented by outer while statement
                }
            } else {    // single-line assignment
                // skip lines which are after a statement continuation, can't be valid assignment
                if (i > 0 && nonempty[i - 1].is_continued) continue;

                for (const vd of Variables.single_definitions(nonempty[i])) {
                    yield vd;
                }
            }
        }
    }

    private static* useFirstNonEmpty<VardefOf>(gens: Iterable<Generator<VardefOf>>): Generator<VardefOf> {
        for (const gen of gens) {
            let hasYielded = false;
            for (const value of gen) {
                hasYielded = true;
                yield value;
            }
            if (hasYielded) {
                return; // Stop after yielding from the first non-empty generator
            }
        }
    }

    private static* single_definitions(subline: SubLine): Generator<VardefOf> {
        for (const vd of Variables.useFirstNonEmpty([ Variables.isForDeclaration(subline),
                                                      Variables.isRequest(subline),
                                                      Variables.isAssignment(subline)])) {
            yield vd;
        }
    }

    private static* isAssignment(subline: SubLine): Generator<VardefOf> {
        // remove []-s
        let nodim = subline.maskedText;
        const dimregex = /\[[^[]*?\]/g;
        while (dimregex.test(nodim)) {
            nodim = nodim.replace(dimregex, m => " ".repeat(m.length));
        }

        // var or dict.keys or dict.dim[...].keys
        const match = nodim.match(/^(\s*([_~a-z][_~0-9a-z]*)((\s*\.([_~a-z][_~0-9a-z]*))*))\s*=\s*/id) as RegExpMatchArryWithIndices;
        if (match && match.index! >= 0) {
            const variable = match[2];
            const varstart = match.indices[2][0];
            const isSubkey = match[4] !== undefined;

            yield [ variable,
                    {   subline: subline,
                        varstart: varstart,
                        defstart: match[1].length,
                        isSubkey: false }];


            if (isSubkey) {
                // repeated capturing group can't return each match on its own, only all together
                for (const subkey of match[3].split(".")) {
                    const subkeyTrimmed = subkey.trimEnd();
                    if (subkeyTrimmed.length > 0) {
                        yield [ subkeyTrimmed,
                                {   subline: subline,
                                    varstart: varstart,
                                    defstart: match[1].length,
                                    isSubkey: true }];
                    }
                }
            }
        }
    }

    private static* identifiers(subline: SubLine): Generator<VardefOf> {
        for (const match of subline.maskedText.matchAll(/\b([_~a-z][_~0-9a-z]*\b)/ig)) {
            yield [ match[0],
                    {   subline: subline,
                        varstart: match.index!,
                        defstart: match.index! + match[0].length,
                        isSubkey: false }];
        }
    }

    private static* isForDeclaration(subline: SubLine): Generator<VardefOf> {
        const match = subline.maskedText.match(/^\s*for\s+([_~a-z][_~0-9a-z]*)\s*=\s*/id) as RegExpMatchArryWithIndices;
        if ((match?.index ?? -1) >= 0) {
            const variable = match![1];
            const varstart = match!.indices[1][0];
            yield [ variable,
                    {   subline: subline,
                        varstart: varstart,
                        defstart: varstart + match![1].length,
                        isSubkey: false}];
        }
    }

    private static* isRequest(_subline: SubLine): Generator<VardefOf> {
        return; // empty generator
    }

    async addfromfile(scriptUri: vscode.Uri) {
        const document = await vscode.workspace.openTextDocument(scriptUri);
        this.addfromtext(document.getText());
    }

    get(variable: string) {
        return this.vardefs.get(variable) ?? [];
    }

    [Symbol.iterator]() {
        return this.vardefs.keys();
    }
}