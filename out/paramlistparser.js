"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParamList = exports.Parameter = void 0;
const vscode = require("vscode");
class Parameter {
    type;
    nameCS; // case sensitive
    desc;
    defaultvalue;
    meaning;
    vardim1;
    vardim2;
    child;
    bold;
    fix;
    hidden;
    unique;
    subkeys = new Map(); // d => [a.b.c.d, a.e.d]
    constructor(xml) {
        const result_ = xml.match(/^\t\t<(.*?) Name="(.*?)">((.|[\n\r])*?)^\t\t<\/\1>/m);
        if (result_) {
            this.type = result_[1];
            this.nameCS = result_[2];
            const content = result_[3];
            const desc_ = content.match(/<Description><!\[CDATA\["(.*?)"\]\]><\/Description>/);
            if (desc_) {
                this.desc = desc_[1];
            }
            else {
                this.desc = "";
            }
            this.fix = (content.match(/<Fix\/>/) !== null);
            let flags = content.match(/(?<=<ParFlg_).*?(?=\/>)/g) ?? [];
            this.child = (flags.indexOf("Child") !== -1);
            this.bold = (flags.indexOf("BoldName") !== -1);
            this.hidden = (flags.indexOf("Hidden") !== -1);
            this.unique = (flags.indexOf("Unique") !== -1);
            const defaultvalue_ = content.match(/<(Value|ArrayValues)(.*?)>((.|[\n\r])*?)(?=<\/\1>)/m)
                ?? ["", "", "", ""]; // Value tag isn't present for Title and Separator, or empty <Value/> in Dictionary
            const isArray = (defaultvalue_[1] === "ArrayValues");
            const attribs = defaultvalue_[2];
            const value = defaultvalue_[3];
            const meaning_ = attribs.match(/Meaning="(.*?)"/);
            if (meaning_) {
                this.meaning = meaning_[1];
            }
            if (!isArray && this.type !== "Dictionary") { // simple type
                if (this.type === "String") {
                    const value_ = value.match(/<!\[CDATA\[(".*?")\]\]>/);
                    if (value_) {
                        this.defaultvalue = value_[1];
                    }
                    else {
                        this.defaultvalue = "";
                    }
                }
                else {
                    this.defaultvalue = value;
                }
                this.vardim1 = 0;
                this.vardim2 = 0;
            }
            else { // array or dict
                this.defaultvalue = value.replace(/^\s*[\n\r]*/, "").replace(/^\t\t\t\t/gm, "");
                const dim1_ = attribs.match(/FirstDimension="(\d+)"/);
                const dim2_ = attribs.match(/SecondDimension="(\d+)"/);
                if (dim1_) {
                    this.vardim1 = parseInt(dim1_[1], 10);
                }
                else {
                    this.vardim1 = 0;
                }
                if (dim2_) {
                    this.vardim2 = parseInt(dim2_[1], 10);
                }
                else {
                    this.vardim2 = 0;
                }
                if (this.type === "Dictionary") {
                    this.addsubkeys(this.defaultvalue, this.nameCS);
                }
            }
        }
        else {
            this.type = "";
            this.nameCS = "";
            this.desc = "";
            this.defaultvalue = "";
            this.vardim1 = 0;
            this.vardim2 = 0;
            this.child = false;
            this.bold = false;
            this.fix = false;
            this.hidden = false;
            this.unique = false;
        }
    }
    static unindent(xml) {
        // remove indent of first line from all lines
        const firstLineIndent = xml.match(/^\s*/)?.[0] ?? "";
        const regex = new RegExp(`^${firstLineIndent}`, "gm");
        return xml.replace(regex, "");
    }
    addsubkeys(xml, prefix) {
        const subkeys = /^<((?<collection>Dictionary|Array)|(Integer|RealNum|String))\s+(?<idType>Index|Name)="(?<id>.*?)"\s*(\/>|>\s*(((.*?)<\/\3\s*>)|(\s*[\n\r]+(?<content>(^\s.*[\n\r]+)*?)^<\/\2\s*>)))/gm;
        // group count     12                             2 3                      31   4                   4  5        5    6        789   9         8 A          B          C            C  B          A76
        for (const match of xml.matchAll(subkeys)) {
            const id = match.groups?.id ?? "";
            if (match.groups?.collection !== undefined) {
                // array or dict
                const content = Parameter.unindent(match.groups?.content ?? "");
                const inArray = match.groups?.idType === "Index";
                if (inArray) {
                    this.addsubkeys(content, prefix);
                }
                else {
                    const name = this.addsubkey(id, prefix);
                    this.addsubkeys(content, name);
                }
            }
            else {
                // string or number
                this.addsubkey(id, prefix);
            }
        }
    }
    addsubkey(key, prefix) {
        const name = `${prefix}.${key}`;
        const keyLC = key.toLowerCase();
        if (!this.subkeys.has(keyLC))
            this.subkeys.set(keyLC, []);
        this.subkeys.get(keyLC).push(name);
        return name;
    }
    hasSubKey(key) {
        return this.subkeys.has(key.toLowerCase());
    }
    getSubKeys() {
        return this.subkeys.entries();
    }
    getDocString(block, desc = true, name = true, defaultvalue = true) {
        const md = new vscode.MarkdownString();
        if (desc) {
            md.appendMarkdown(`${this.getDescString(block)}  \n`);
        }
        if (name) {
            md.appendMarkdown(`\`${this.nameCS}\``);
        }
        md.appendMarkdown(`${this.getFlagString(block)}  \n`);
        if (defaultvalue) {
            md.appendMarkdown(`**${this.type}** ${this.getDefaultString()}`);
        }
        return md;
    }
    getDescString(block, plaintext = false) {
        const description = plaintext ? `"${this.desc}"` : `**"${this.desc}"**`;
        if (block) {
            return `"${block.desc}" / ` + description;
        }
        return description;
    }
    getFlagString(block) {
        let flags = (this.fix ? " `Fix`" : "");
        flags += (this.bold ? " `BoldName`" : "");
        flags += (this.hidden ? " `Hidden`" : "");
        flags += (this.unique ? " `Unique`" : "");
        if (block === this) {
            flags += (this.child ? " `Child`" : ""); // probably wrong but show it
            flags += " `PARAMETER BLOCK`";
        }
        else if (block) {
            // shouldn't have block without child flag but show it
            flags += ` \`${this.child ? "Child" : ""} of ${block.nameCS}\``;
        }
        else {
            flags += (this.child ? " `Child`" : ""); // probably wrong but show it
        }
        return flags;
    }
    getDefaultString() {
        if (this.type !== "Title" && this.type !== "Separator") {
            let defaultvalue;
            if (this.type === "Dictionary" || this.vardim1 || this.vardim2) {
                defaultvalue = this.getDimensionString() +
                    "\n```xml\n" + this.defaultvalue + "\n```";
            }
            else {
                defaultvalue = this.defaultvalue;
            }
            const meaning = (this.meaning ? (" meaning " + this.meaning) : "");
            return "default " + defaultvalue + meaning;
        }
        else {
            return "";
        }
    }
    getDimensionString() {
        return (this.vardim1 ? ("[" + this.vardim1 + "]") : "") +
            (this.vardim2 ? ("[" + this.vardim2 + "]") : "");
    }
}
exports.Parameter = Parameter;
class ParamList {
    parameters = new Map();
    group = new Map();
    uri;
    static subpath = "paramlist.xml";
    constructor(rootfolder) {
        this.uri = vscode.Uri.joinPath(rootfolder, ParamList.subpath);
    }
    async parse() {
        const paramlist = await vscode.workspace.openTextDocument(this.uri);
        this.parameters.clear();
        this.group.clear();
        if (paramlist) {
            //const parameters_ = paramlist.getText().matchAll(/^\t\t<(!--) (.*?): PARAMETER BLOCK.*?-->|^\t\t<(.*?) Name=.*?>((.|[\n\r])*?)^\t\t<\/\1>/mg);
            const parameters_ = paramlist.getText().matchAll(/^\t\t<(.*?) (Name=.*?>((.|[\n\r])*?)^\t\t<\/\1>|(.*?): PARAMETER BLOCK.*?-->)/mg);
            let group = "";
            for (const match of parameters_) {
                if (match[1] == "!--") {
                    group = match[5];
                }
                else {
                    const parameter = new Parameter(match[0]);
                    const nameLC = parameter.nameCS.toLowerCase();
                    if (group.toLowerCase() !== nameLC && !parameter.child) {
                        // group applies to child parameters only
                        // first parameter in group must have group name, is not child
                        group = "";
                    }
                    this.group.set(nameLC, group);
                    const position = paramlist.positionAt(match.index);
                    this.parameters.set(nameLC, [parameter, position]);
                }
            }
        }
    }
    has(name) {
        return this.parameters.has(name.toLowerCase());
    }
    get(name) {
        return this.parameters.get(name.toLowerCase())?.[0];
    }
    block_of(parameter) {
        return this.get(this.group.get(parameter.nameCS.toLowerCase()) ?? "");
    }
    position(name) {
        return this.parameters.get(name.toLowerCase())?.[1];
    }
    *[Symbol.iterator]() {
        yield* this.all_of_type();
    }
    *all_of_type(type = undefined) {
        for (const [parameter, _] of this.parameters.values()) {
            if (type === undefined || type === parameter.type)
                yield parameter;
        }
    }
}
exports.ParamList = ParamList;
//# sourceMappingURL=paramlistparser.js.map