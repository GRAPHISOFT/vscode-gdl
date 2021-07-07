import * as vscode from 'vscode';

import { hasLibPartData } from './extension';

import fs = require('fs');

export class Parameter {
    public readonly type : string;
    public readonly nameCS : string; // case sensitive
    public readonly desc : string;
    public readonly defaultvalue : string;

    public readonly meaning? : string;
    public readonly vardim1 : number;
    public readonly vardim2 : number;

    public readonly child : boolean;
    public readonly bold : boolean;
    public readonly fix : boolean;
    public readonly hidden : boolean;

    constructor(xml : string) {
        let result_ = xml.match(/^\t\t<(.*?) Name="(.*?)">((.|[\n\r])*?)^\t\t<\/\1>/m);
        if (result_) {
            this.type = result_[1];
            this.nameCS = result_[2];
            let content = result_[3];

            let desc_ = content.match(/<Description><!\[CDATA\["(.*?)"\]\]><\/Description>/);
            if (desc_) {
                this.desc = desc_[1];
            } else {
                this.desc = "";
            }

            this.fix = (content.match(/<Fix\/>/) !== null);
            
            let flags = content.match(/(?<=<ParFlg_).*?(?=\/>)/g);
            if (flags === null) flags = [];
            this.child  = (flags.indexOf("Child") !== -1);
            this.bold   = (flags.indexOf("BoldName") !== -1);
            this.hidden = (flags.indexOf("Hidden") !== -1);
            
            if (this.type == "Title") {
                this.defaultvalue = "";
                this.vardim1 = 0;
                this.vardim2 = 0;
            } else {
                let defaultvalue_ = content.match(/<(Value|ArrayValues)(.*?)>((.|[\n\r])*?)(?=<\/\1>)/m);
                let isArray = (defaultvalue_![1] == "ArrayValues")
                let attribs = defaultvalue_![2];
                let value = defaultvalue_![3];

                let meaning_ = attribs.match(/Meaning="(.*?)"/);
                if (meaning_) {
                    this.meaning = meaning_[1];
                }

                if (!isArray && this.type != "Dictionary") {    // simple type
                    if (this.type == "String") {
                        let value_ = value.match(/<!\[CDATA\[(".*?")\]\]>/);
                        if (value_) {
                            this.defaultvalue = value_[1];
                        } else {
                            this.defaultvalue = "";
                        }
                    } else {
                        this.defaultvalue = value;
                    }
                    this.vardim1 = 0;
                    this.vardim2 = 0;

                } else {  // array or dict
                    
                    this.defaultvalue = value.replace(/^\s*[\n\r]*/, "").replace(/^\t\t\t\t/gm, "");

                    let dim1_ = attribs.match(/FirstDimension="(\d+)"/);
                    let dim2_ = attribs.match(/SecondDimension="(\d+)"/);
                    if (dim1_) {
                        this.vardim1 = parseInt(dim1_[1], 10);
                    } else {
                        this.vardim1 = 0;
                    }
                    if (dim2_) {
                        this.vardim2 = parseInt(dim2_[1], 10);
                    } else {
                        this.vardim2 = 0;
                    }
                }
            }
        } else {
            this.type           = "";
            this.nameCS         = "";
            this.desc           = "";
            this.defaultvalue   = ""

            this.vardim1        = 0;
            this.vardim2        = 0;

            this.child          = false;
            this.bold           = false;
            this.fix            = false;
            this.hidden         = false;
        }
    }

    public getDocString(desc : boolean = true, name : boolean = true, defaultvalue : boolean = true) : vscode.MarkdownString {
        return new vscode.MarkdownString(
            (desc ? ("**\"" + this.desc + "\"** ") : "") + 
            (name ? ("`" + this.nameCS + "`") : "") + 
            "\n\n" +
            "**" + this.type + "**" +
            this.getFlagString("`") +
            "\n\n" + 
            (this.meaning ? this.meaning : "") +
            "\n\n" + 
            (defaultvalue ? this.getDefaultString() : ""));
    }

    public getFlagString(markdown : string = "") : string {
        return  (this.fix ? (" " + markdown + "Fix" + markdown) : "") +
                (this.hidden ? (" " + markdown + "Hidden" + markdown) : "") +
                (this.child ? (" " + markdown + "Child" + markdown) : "") +
                (this.bold ? (" " + markdown + "BoldName" + markdown) : "");
    }

    public getDefaultString() : string {
        let defaultvalue : string; 
        if (this.type == "Dictionary" || this.vardim1 || this.vardim2) {
            defaultvalue =  this.getDimensionString() +
                            "\n```xml\n" + this.defaultvalue + "\n```";
        } else {
            defaultvalue = this.defaultvalue;
        }

        return "default " + defaultvalue;
    }

    public getDimensionString() : string {
        return  (this.vardim1 ? ("[" + this.vardim1 + "]") : "") +
                (this.vardim2 ? ("[" + this.vardim2 + "]") : "");
    }
}

export class ParamList implements Iterable<Parameter> {
    private readonly parameters : Map<string, Parameter>;
    readonly uri? : vscode.Uri;

    constructor(rootfolder? : vscode.Uri) {
        if (hasLibPartData(rootfolder)) {
            //console.log("ParamList() read paramlist of", rootfolder.fsPath);
            this.uri = vscode.Uri.joinPath(rootfolder!, "paramlist.xml");
            this.parameters = this.parse();
        } else {
            this.parameters = new Map<string, Parameter>();
        }
    }

    private parse() : Map<string, Parameter> {
        let parameters = new Map<string, Parameter>();

        let paramlist = this.uri!.fsPath;
        if (fs.existsSync(paramlist)) {
            let data = fs.readFileSync(paramlist, "utf8");

            let parameters_ = data.match(/^\t\t<(.*?) Name=.*?>((.|[\n\r])*?)^\t\t<\/\1>/mg);
            if (parameters_) {
                for (const xml of parameters_) {
                    let parameter = new Parameter(xml);
                    parameters.set(parameter.nameCS.toLowerCase(), parameter);
                }
            }
        }

        return parameters;
    }

    has(name : string) : boolean {
        return this.parameters.has(name);
    }

    get(name : string) {
        return this.parameters.get(name.toLowerCase());
    }

    [Symbol.iterator]() {
        return this.parameters.values();
    }
}