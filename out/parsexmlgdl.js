"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParseXMLGDL = exports.GDLPict = exports.GDLPictParent = exports.GDLSection = exports.GDLScript = exports.GDLFile = exports.GDLXMLSection = exports.GDLMigrationGUID = exports.GDLMainGUID = exports.GDLMacroCall = exports.GDLCalledMacro = exports.GDLComment = exports.GDLFunction = exports.GDLToken = exports.scriptName = exports.scriptAbbrev = exports.ScriptType = void 0;
const vscode = require("vscode");
const extension_1 = require("./extension");
var ScriptType;
(function (ScriptType) {
    ScriptType[ScriptType["ROOT"] = 0] = "ROOT";
    ScriptType[ScriptType["D"] = 1] = "D";
    ScriptType[ScriptType["DD"] = 2] = "DD";
    ScriptType[ScriptType["DDD"] = 3] = "DDD";
    ScriptType[ScriptType["UI"] = 4] = "UI";
    ScriptType[ScriptType["VL"] = 5] = "VL";
    ScriptType[ScriptType["PR"] = 6] = "PR";
    ScriptType[ScriptType["FWM"] = 7] = "FWM";
    ScriptType[ScriptType["BWM"] = 8] = "BWM";
    ScriptType[ScriptType["MIGTABLE"] = 9] = "MIGTABLE";
    ScriptType[ScriptType["PARAMSECTION"] = 10] = "PARAMSECTION";
    ScriptType[ScriptType["CALLEDMACROS"] = 11] = "CALLEDMACROS";
    ScriptType[ScriptType["GDLPICT"] = 12] = "GDLPICT";
})(ScriptType = exports.ScriptType || (exports.ScriptType = {}));
exports.scriptAbbrev = ["", "MASTER", "2D", "3D", "UI", "PARAM", "PROP", "FWM", "BWM", "", "", "", ""];
exports.scriptName = ["file",
    "MASTER SCRIPT",
    "2D SCRIPT",
    "3D SCRIPT",
    "UI SCRIPT",
    "PARAM SCRIPT",
    "PROPERTIES SCRIPT",
    "FORWARD MIGRATION SCRIPT",
    "BACKWARD MIGRATION SCRIPT",
    "MIGRATION TABLE",
    "PARAMETERS",
    "CALLEDMACROS",
    "EMBEDDED PICTURES"
];
// general interface representing a thing we want to catch
class GDLToken {
    constructor(start, end, name) {
        this.name = name;
        this.range = new vscode.Range(start, end);
    }
}
exports.GDLToken = GDLToken;
// function definitions
class GDLFunction extends GDLToken {
    constructor(start, end, name, inScript) {
        //console.log("GDLFunction()", name, inScript);
        super(start, end, name);
        this.inScript = inScript;
    }
}
exports.GDLFunction = GDLFunction;
GDLFunction.regex = /(?<=^\s*?)(([0-9]+)|((["'`´“”’‘])([^"'`´“”’‘]+)\4))\s*:/mg;
// special comments
class GDLComment extends GDLToken {
    constructor(start, end, name, inScript) {
        //console.log("GDLComment()", name, inScript);
        super(start, end, name);
        this.inScript = inScript;
    }
}
exports.GDLComment = GDLComment;
//public static readonly regex = /^\s*!\s*---\s*([^-]+?)---.*$/mig;		// ! --- name ---
GDLComment.regex = /^(\s*!\s*=+)\r?\n\s*!\s*(.+?)\r?\n\1/mig; // ! ============
// called macros
class GDLCalledMacro extends GDLToken {
    constructor(start, end, name, fromScripts) {
        //console.log("GDLCalledMacro()", content);
        super(start, end, name);
        this.fromScripts = fromScripts;
    }
}
exports.GDLCalledMacro = GDLCalledMacro;
GDLCalledMacro.regex = /^\s*<MName><!\[CDATA\["([\D\d]*?)"\]\]><\/MName>/mig;
// macro calls
class GDLMacroCall extends GDLToken {
    constructor(start, end, match, script) {
        //console.log("GDLMacroCall()", content);
        super(start, end, match[1]);
        this.all = (match.length >= 4 && match[4] !== undefined); // parameters all
        this.inScript = script;
    }
}
exports.GDLMacroCall = GDLMacroCall;
GDLMacroCall.regex = /(?<!!.*)\bcall\s*"([\w ]*)"(\s*(,\r?\n\s*)?(parameters\s*all))?/mig;
// main GUID
class GDLMainGUID extends GDLToken {
    constructor(start, end, guid) {
        super(start, end, guid);
    }
}
exports.GDLMainGUID = GDLMainGUID;
GDLMainGUID.regex = /^<Symbol.*?MainGUID="([-0-9A-Z]*)".*?>$/mig;
// migration table GUIDs
class GDLMigrationGUID extends GDLToken {
    constructor(start, end, content) {
        //console.log("GDLMigrationGUID()", content);
        //defaults if not found
        let GUID = "00000000-0000-0000-0000-000000000000";
        let version = -1;
        let automigration = false;
        let match;
        let subregex = /^\s*<(MainGUID|Version|AutoMigration)>([\D\d]*?)<\/\1>/mig;
        while (match = subregex.exec(content)) {
            if (match.length > 1) { // match[2] exists
                switch (match[1]) {
                    case "MainGUID":
                        GUID = match[2];
                        break;
                    case "Version":
                        version = parseInt(match[2]);
                        break;
                    case "AutoMigration":
                        automigration = (match[2] === "true" ? true : false);
                        break;
                    default:
                }
            }
        }
        super(start, end, GUID);
        this.version = version;
        this.automigration = automigration;
    }
}
exports.GDLMigrationGUID = GDLMigrationGUID;
GDLMigrationGUID.regex = /^\s*<(MigrationTableElement>)([\D\d]*?)<\/\1/mig;
// toplevel XML sections (script, migtable, etc...)
class GDLXMLSection extends GDLToken {
    constructor(start, end, scriptType, parser) {
        super(start, end, exports.scriptName[scriptType]);
        this.scriptType = scriptType;
        this.parser = parser;
    }
}
exports.GDLXMLSection = GDLXMLSection;
GDLXMLSection.regex = /^<((Script_([123]D|UI|VL|PR|[FB]WM))|ParamSection|MigrationTable|CalledMacros)[\D\d]*?<\/\1>/mg;
// whole file
class GDLFile extends GDLXMLSection {
    constructor(start, end, parser) {
        super(start, end, ScriptType.ROOT, parser);
        this.lineCount = end.line - start.line + 1;
    }
    hasChildren() {
        return false;
    }
}
exports.GDLFile = GDLFile;
// GDL scripts
class GDLScript extends GDLXMLSection {
    constructor(start, end, scriptType, parser, document) {
        super(start, end, scriptType, parser);
        this.lineCount = end.line - start.line - 1;
        let match = GDLScript.innerregex.exec(document.getText(this.range));
        if (match) {
            let innerstart = document.offsetAt(start) + match.index;
            this.innerrange = new vscode.Range(document.positionAt(innerstart), document.positionAt(innerstart + match[0].length));
        }
        else {
            this.innerrange = this.range;
        }
    }
    hasChildren() {
        let functionList = this.parser.getFunctionList(this.scriptType);
        return (functionList.length > 0 || //has funtions
            this.lineCount > 1); //longer than one line: has main function
    }
}
exports.GDLScript = GDLScript;
GDLScript.innerregex = /(?<=^.*?<\!\[CDATA\[).*(?=\]\]>[\n\r]*<\/Script_)/s;
// non-script XML sections
class GDLSection extends GDLXMLSection {
    constructor(start, end, scriptType, parser) {
        super(start, end, scriptType, parser);
        this.lineCount = end.line - start.line - 1;
    }
    hasChildren() {
        // migration GUIDs
        if (this.scriptType === ScriptType.MIGTABLE && this.parser.getGUIDList().length > 0) {
            return true;
        }
        // called macros
        if (this.scriptType === ScriptType.CALLEDMACROS && this.parser.getCalledMacroList().length > 0) {
            return true;
        }
        // anything else
        return false;
    }
}
exports.GDLSection = GDLSection;
// parent of GDLPict leafs
class GDLPictParent extends GDLToken {
    constructor(numChildren) {
        const pos = new vscode.Position(0, 0);
        super(pos, pos, exports.scriptName[ScriptType.GDLPICT]);
        this.numChildren = numChildren;
    }
}
exports.GDLPictParent = GDLPictParent;
GDLPictParent.regex = /./; // not used
// embedded GDLPict
class GDLPict extends GDLToken {
    constructor(start, end, match) {
        //console.log("GDLPict()", content);
        //defaults if not found
        let id = -1;
        let idString = "";
        let path = "";
        let file = match[0];
        if (match.length > 2) { // match[3] exists
            idString = match[1];
            id = parseInt(match[1]);
            path = match[2];
            file = match[3];
        }
        super(start, end, file);
        this.idString = idString;
        this.id = id;
        this.path = path;
        this.file = file;
    }
}
exports.GDLPict = GDLPict;
GDLPict.regex = /^\s*<GDLPict[\D\d]*?SubIdent="(\d*?)"[\D\d]*?path="(.*?\/([^\/]*))"[\D\d]*?\/>/mig;
class ParseXMLGDL {
    constructor(document) {
        this.sectionList = [];
        this.functionList = [];
        this.commentList = [];
        this.macroCallList = [];
        this.GUIDList = [];
        this.calledMacroList = [];
        this.pictList = [];
        //console.log("ParseXMLGDL()");
        this.parseall(document);
    }
    getXMLSection(scriptType) {
        // not a list, only one element
        return this.sectionList[scriptType];
    }
    getFunctionList(scriptType) {
        return this.functionList[scriptType];
    }
    getCommentList(scriptType) {
        return this.commentList[scriptType];
    }
    getGUIDList() {
        return this.GUIDList;
    }
    getMainGUID() {
        return this.mainGUID;
    }
    getCalledMacroList() {
        return this.calledMacroList;
    }
    getMacroCallList(scriptType) {
        return this.macroCallList[scriptType];
    }
    getPictList() {
        return this.pictList;
    }
    parseScripts(document) {
        //console.log("ParseXMLGDL.parseScripts");
        let match;
        this.sectionList = [];
        if (extension_1.modeGDL(document)) {
            const text = document.getText();
            while (match = GDLXMLSection.regex.exec(text)) {
                if (match.length > 0) { // match[1] exists
                    let script = ParseXMLGDL.createGDLXMLSection(document.positionAt(match.index), document.positionAt(match.index + match[0].length), match[1], this, document);
                    this.sectionList[script.scriptType] = script;
                }
            }
            // whole file
            this.sectionList[ScriptType.ROOT] = ParseXMLGDL.createGDLXMLSection(new vscode.Position(0, 0), document.positionAt(text.length), "", this, document);
        }
    }
    scriptOfPos(line) {
        let scriptType = ScriptType.ROOT;
        this.sectionList.some(script => {
            if (script !== undefined && script.scriptType !== ScriptType.ROOT && (script.range.start.line <= line) && (script.range.end.line >= line)) {
                scriptType = script.scriptType;
                return true;
            }
            return false;
        });
        return scriptType;
    }
    parseFunctions(document) {
        //console.log("ParseXMLGDL.parseFunctions");
        let match, matchedName;
        this.functionList = [];
        for (let i = ScriptType.ROOT; i <= ScriptType.MIGTABLE; i++) {
            this.functionList.push([]);
        }
        if (extension_1.modeGDL(document)) {
            while (match = GDLFunction.regex.exec(document.getText())) {
                if (match.length > 1) { // match[2] exists
                    if (match[2]) {
                        matchedName = match[2]; // number
                    }
                    else {
                        matchedName = match[3]; // name
                    }
                    const start = document.positionAt(match.index);
                    const end = document.positionAt(match.index + matchedName.length + 1);
                    const scriptType = this.scriptOfPos(start.line);
                    this.functionList[scriptType].push(new GDLFunction(start, end, matchedName, scriptType));
                }
            }
        }
    }
    parseComments(document) {
        //console.log("ParseXMLGDL.parseComments");
        let match;
        this.commentList = [];
        for (let i = ScriptType.ROOT; i <= ScriptType.MIGTABLE; i++) {
            this.commentList.push([]);
        }
        if (extension_1.modeGDL(document)) {
            while (match = GDLComment.regex.exec(document.getText())) {
                if (match.length > 1) { // match[2] exists
                    const start = document.positionAt(match.index);
                    const end = document.positionAt(match.index + match[0].length + 1);
                    const scriptType = this.scriptOfPos(start.line);
                    this.commentList[scriptType].push(new GDLComment(start, end, match[2], scriptType));
                }
            }
        }
    }
    parseGUIDs(document) {
        //console.log("ParseXMLGDL.parseGUIDs");
        let match;
        this.GUIDList = [];
        if (extension_1.modeGDL(document)) {
            const text = document.getText();
            // get main GUID
            this.mainGUID = undefined;
            while (match = GDLMainGUID.regex.exec(text)) {
                if (match.length > 0) { // match[1] exists
                    this.mainGUID = new GDLMainGUID(document.positionAt(match.index), document.positionAt(match.index + match[0].length + 1), match[1]);
                }
            }
            // get migration GUIDs
            while (match = GDLMigrationGUID.regex.exec(text)) {
                if (match.length > 1) { // match[2] exists
                    this.GUIDList.push(new GDLMigrationGUID(document.positionAt(match.index), document.positionAt(match.index + match[0].length + 1), match[2]));
                }
            }
        }
    }
    parseCalledMacros(document) {
        //console.log("ParseXMLGDL.parseCalledMacros");
        let match;
        this.macroCallList = [];
        this.calledMacroList = [];
        if (extension_1.modeGDL(document)) {
            for (let i = ScriptType.ROOT; i <= ScriptType.MIGTABLE; i++) {
                this.macroCallList.push([]);
            }
            let macroCallListMap = {};
            const text = document.getText();
            // parse macro calls
            while (match = GDLMacroCall.regex.exec(text)) {
                if (match.length > 0) {
                    const start = document.positionAt(match.index);
                    const end = document.positionAt(match.index + match[0].length + 1);
                    const scriptType = this.scriptOfPos(start.line);
                    let macroCall = new GDLMacroCall(start, end, match, scriptType);
                    this.macroCallList[scriptType].push(macroCall);
                    // temporary map used for adding info to GDLCalledMacro later
                    if (macroCallListMap[macroCall.name] === undefined) {
                        macroCallListMap[macroCall.name] = new Array();
                    }
                    macroCallListMap[macroCall.name][scriptType] = true;
                }
            }
            // parse CalledMacros section
            while (match = GDLCalledMacro.regex.exec(text)) {
                if (match.length > 0) { // match[1] exists
                    let calledFromScripts = macroCallListMap[match[1]];
                    if (calledFromScripts === undefined) {
                        calledFromScripts = new Array();
                    }
                    const start = document.positionAt(match.index);
                    const end = document.positionAt(match.index + match[0].length + 1);
                    this.calledMacroList.push(new GDLCalledMacro(start, end, match[1], calledFromScripts));
                }
            }
        }
    }
    parsePicts(document) {
        //console.log("ParseXMLGDL.parsePicts");
        let match;
        this.pictList = [];
        if (extension_1.modeGDL(document)) {
            // store GDLPicts
            while (match = GDLPict.regex.exec(document.getText())) {
                this.pictList.push(new GDLPict(document.positionAt(match.index), document.positionAt(match.index + match[0].length + 1), match));
            }
        }
    }
    getAllFunctions() {
        //console.log("ParseXMLGDL.getAllFunctions");
        // flatten array and sort by line number
        let functions = [];
        return functions.concat(...this.functionList)
            .sort((a, b) => a.range.start.line - b.range.start.line);
    }
    getAllSections() {
        //console.log("ParseXMLGDL.getAllSections");
        // skip undefineds
        return this.sectionList.filter((e) => (e !== undefined))
            .sort((a, b) => a.range.start.line - b.range.start.line);
    }
    parseall(document) {
        //console.log("ParseXMLGDL.parseall");
        this.parseScripts(document);
        this.parseFunctions(document);
        this.parseComments(document);
        this.parseGUIDs(document);
        this.parseCalledMacros(document);
        this.parsePicts(document);
    }
    static createGDLXMLSection(start, end, tag, parser, document) {
        let scriptType;
        switch (tag) {
            case "Script_1D":
                scriptType = ScriptType.D;
                break;
            case "Script_2D":
                scriptType = ScriptType.DD;
                break;
            case "Script_3D":
                scriptType = ScriptType.DDD;
                break;
            case "Script_UI":
                scriptType = ScriptType.UI;
                break;
            case "Script_VL":
                scriptType = ScriptType.VL;
                break;
            case "Script_PR":
                scriptType = ScriptType.PR;
                break;
            case "Script_FWM":
                scriptType = ScriptType.FWM;
                break;
            case "Script_BWM":
                scriptType = ScriptType.BWM;
                break;
            case "MigrationTable":
                scriptType = ScriptType.MIGTABLE;
                break;
            case "ParamSection":
                scriptType = ScriptType.PARAMSECTION;
                break;
            case "CalledMacros":
                scriptType = ScriptType.CALLEDMACROS;
                break;
            default:
                scriptType = ScriptType.ROOT;
        }
        switch (scriptType) {
            case ScriptType.D:
            case ScriptType.DD:
            case ScriptType.DDD:
            case ScriptType.UI:
            case ScriptType.VL:
            case ScriptType.PR:
            case ScriptType.FWM:
            case ScriptType.BWM:
                return new GDLScript(start, end, scriptType, parser, document);
            case ScriptType.MIGTABLE:
            case ScriptType.PARAMSECTION:
            case ScriptType.CALLEDMACROS:
                return new GDLSection(start, end, scriptType, parser);
            case ScriptType.ROOT:
            default:
                return new GDLFile(start, end, parser);
        }
    }
}
exports.ParseXMLGDL = ParseXMLGDL;
//# sourceMappingURL=parsexmlgdl.js.map