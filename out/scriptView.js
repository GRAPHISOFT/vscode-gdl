"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutlineView = void 0;
const vscode = require("vscode");
const Parser = require("./parsexmlgdl");
const extension_1 = require("./extension");
class OutlineView {
    constructor(extension) {
        //console.log("OutlineView())");
        this.extension = extension;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.specComments = true;
        this.macroCalls = true;
        // parsed file
        this.extension.onDidParse(() => {
            this.refresh();
        }, this);
    }
    async newSettings(specComments, macroCalls) {
        const changed = (this.specComments !== specComments || this.macroCalls !== macroCalls);
        this.specComments = specComments;
        this.macroCalls = macroCalls;
        if (changed) {
            this.refresh();
        }
    }
    async toggleSpecComments() {
        this.specComments = !this.specComments;
        this.refresh();
    }
    async toggleMacroCalls() {
        this.macroCalls = !this.macroCalls;
        this.refresh();
    }
    refresh() {
        //console.log("OutlineView.refresh ", this.extension.updateEnabled);
        if (this.extension.updateEnabled) {
            this._onDidChangeTreeData.fire(null); //refresh root
        }
    }
    getTreeItems(scriptType) {
        //console.log("OutlineView.getTreeItems", Parser.scriptName[scriptType], Date.now());
        const children = [];
        //add "main" function for script longer than one line
        if ((0, extension_1.modeGDLXML)(this.extension.editor?.document)) {
            if (scriptType <= Parser.ScriptType.BWM) {
                const script = this.extension.parser.getXMLSection(scriptType);
                if ((script instanceof Parser.GDLScript) && script.multiline) {
                    children.push(new Parser.GDLFunction(script.innerstart, script.innerstart, //length 0
                    "%main"));
                }
            }
        }
        // merge arrays
        if (this.extension.parser.getFunctionList(scriptType) !== undefined) {
            children.push(...this.extension.parser.getFunctionList(scriptType));
        }
        if (this.specComments && this.extension.parser.getCommentList(scriptType) !== undefined) {
            children.push(...this.extension.parser.getCommentList(scriptType));
        }
        if (this.macroCalls && this.extension.parser.getMacroCallList(scriptType) !== undefined) {
            children.push(...this.extension.parser.getMacroCallList(scriptType));
        }
        // sort by position
        return children.sort((a, b) => {
            return a.start - b.start;
        });
    }
    // build hierarchy of tree: return children of node id
    getChildren(id) {
        //console.log("OutlineView.getChildren", (id instanceof Parser.GDLToken) ?  id.name : "root");
        const children = [];
        if (id instanceof Parser.GDLToken) {
            if (id instanceof Parser.GDLScript) {
                //functions, comments and macro calls
                children.push(...this.getTreeItems(id.scriptType));
            }
            if (id instanceof Parser.GDLSection) {
                // migration table GUIDs
                if (id.scriptType === Parser.ScriptType.MIGTABLE) {
                    children.push(...this.extension.parser.getGUIDList());
                }
                // called macros
                if (id.scriptType === Parser.ScriptType.CALLEDMACROS) {
                    children.push(...this.extension.parser.getCalledMacroList());
                }
            }
            // GDLPicts
            if (id instanceof Parser.GDLPictParent) {
                children.push(...this.extension.parser.getPictList());
            }
        }
        else { // root of tree
            //add mainGUID if found
            const mainGUID = this.extension.parser.getMainGUID();
            if (mainGUID !== undefined) {
                children.push(mainGUID);
                //scripts
                // show only scripts that have some lines in them
                for (const i of Parser.Scripts) {
                    const script = this.extension.parser.getXMLSection(i);
                    if (script !== undefined && script.multiline) {
                        children.push(script);
                    }
                }
                // add non-script XML sections
                for (let i = Parser.ScriptType.MIGTABLE; i <= Parser.ScriptType.CALLEDMACROS; i++) {
                    const script = this.extension.parser.getXMLSection(i);
                    if (script !== undefined && script.multiline) {
                        children.push(script);
                    }
                }
                // add GDLPicts if there is at least one
                const picts = this.extension.parser.getPictList();
                if (picts.length > 0) {
                    children.push(new Parser.GDLPictParent(picts.length));
                }
            }
            else { // no GUID -> no XML sections probably
                children.push(...this.getTreeItems(Parser.ScriptType.ROOT));
            }
        }
        return Promise.resolve(children);
    }
    getTreeItem(id) {
        //console.log("OutlineView.getTreeItem", (id instanceof Parser.GDLXMLSection ? Parser.scriptName[id.scriptType] : id.name));
        if (!this.extension.editor) {
            console.log("unexpected: editor not found in scriptView.getTreeItem");
        }
        return new TokenUI(id, this.extension.editor.document).getTreeItem(this.extension.context);
    }
}
exports.OutlineView = OutlineView;
class TokenUI {
    constructor(token, document) {
        this.label = "";
        this.collapsible = vscode.TreeItemCollapsibleState.None;
        this.id = "";
        this.context = "";
        this.revealonclick = true;
        this.revealLine = 0;
        this.tooltip = "";
        this.lighticon = "";
        this.darkicon = "";
        switch (token.constructor) {
            case Parser.GDLFunction:
                this.GDLFunctionUI(token, document);
                break;
            case Parser.GDLComment:
                this.GDLCommentUI(token, document);
                break;
            case Parser.GDLCalledMacro:
                this.GDLCalledMacroUI(token, document);
                break;
            case Parser.GDLMacroCall:
                this.GDLMacroCallUI(token, document);
                break;
            case Parser.GDLMainGUID:
                this.GDLMainGUIDUI(token, document);
                break;
            case Parser.GDLMigrationGUID:
                this.GDLMigrationGUIDUI(token, document);
                break;
            case Parser.GDLFile:
                this.GDLFileUI(token, document);
                break;
            case Parser.GDLScript:
                this.GDLScriptUI(token, document);
                break;
            case Parser.GDLSection:
                this.GDLSectionUI(token, document);
                break;
            case Parser.GDLPictParent:
                this.GDLPictParentUI(token);
                break;
            case Parser.GDLPict:
                this.GDLPictUI(token, document);
                break;
            default:
        }
    }
    GDLFunctionUI(token, document) {
        let icon;
        let revealLineDelta;
        let showName = token.name;
        if (token.name === "%main") {
            showName = "main";
            icon = "main_icon16x16.svg";
            revealLineDelta = 1;
        }
        else {
            icon = "func_icon16x16.svg";
            revealLineDelta = 0;
        }
        this.label = showName;
        this.context = "function";
        this.id = token.start.toString() + " : " + token.name;
        let range = token.range(document);
        this.revealLine = range.start.line - 2 + revealLineDelta;
        this.tooltip = "Line " + (range.start.line + 1);
        this.lighticon = "light/" + icon;
        this.darkicon = "dark/" + icon;
    }
    GDLCommentUI(token, document) {
        this.label = token.name;
        this.context = "comment";
        this.id = token.start.toString() + " ! " + token.name;
        let range = token.range(document);
        this.revealLine = range.start.line - 2;
        this.tooltip = "Line " + (range.start.line + 1);
        this.lighticon = "light/comment_icon16x16.svg";
        this.darkicon = "dark/comment_icon16x16.svg";
    }
    GDLCalledMacroUI(token, document) {
        let calledFromScripts = "";
        for (const i of Parser.Scripts) {
            if (token.fromScripts[i]) {
                calledFromScripts += " \u00a0" + Parser.scriptAbbrev[i];
            }
        }
        this.label = "\"" + token.name + "\"" + calledFromScripts;
        this.context = "macro";
        this.id = token.start.toString() + " macro " + token.name;
        this.revealLine = token.range(document).start.line - 2;
        this.lighticon = "light/macro_icon16x16.svg";
        this.darkicon = "dark/macro_icon16x16.svg";
    }
    GDLMacroCallUI(token, document) {
        this.context = "macrocall";
        this.label = "\"" + token.name + "\"" + (token.all ? " \u00a0parameters ALL" : "");
        this.id = token.start.toString() + " macrocall " + token.name;
        this.revealLine = token.range(document).start.line - 2;
        this.lighticon = "light/macro_icon16x16.svg";
        this.darkicon = "dark/macro_icon16x16.svg";
    }
    GDLMainGUIDUI(token, document) {
        this.context = "MainGUID";
        this.label = token.name;
        this.id = token.start.toString() + " mainGUID";
        this.revealLine = token.range(document).start.line - 2;
        this.tooltip = "click icon to insert GUID at cursor";
        this.lighticon = "light/GUID_icon16x16.svg";
        this.darkicon = "dark/GUID_icon16x16.svg";
    }
    GDLMigrationGUIDUI(token, document) {
        const version = (token.version < 10 ? "\u00a0" : "") + token.version.toString();
        const showName = version + " " + token.name + (token.automigration ? " auto" : "");
        this.context = "GUID";
        this.label = showName;
        this.id = token.start.toString() + " GUID " + token.name;
        this.revealLine = token.range(document).start.line - 2;
        this.tooltip = "click icon to insert GUID at cursor";
        this.lighticon = "light/GUID_icon16x16.svg";
        this.darkicon = "dark/GUID_icon16x16.svg";
    }
    GDLXMLSectionUI(token, document) {
        let lighticon = "", darkicon = "";
        let expand = token.hasChildren() ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
        switch (token.scriptType) {
            case Parser.ScriptType.D:
                if (token.multiline === false) {
                    expand = vscode.TreeItemCollapsibleState.None;
                }
            case Parser.ScriptType.D:
            case Parser.ScriptType.ROOT:
                lighticon = "light/masterscript_icon16x16.svg",
                    darkicon = "dark/masterscript_icon16x16.svg";
                break;
            case Parser.ScriptType.DD:
                lighticon = "2Dscript_icon16x16.svg",
                    darkicon = lighticon;
                break;
            case Parser.ScriptType.DDD:
                lighticon = "3Dscript_icon16x16.svg",
                    darkicon = lighticon;
                break;
            case Parser.ScriptType.VL:
                lighticon = "paramscript_icon16x16.svg",
                    darkicon = lighticon;
                break;
            case Parser.ScriptType.PR:
                lighticon = "propscript_icon16x16.svg",
                    darkicon = lighticon;
                break;
            case Parser.ScriptType.UI:
                lighticon = "UIscript_icon16x16.svg",
                    darkicon = lighticon;
                break;
            case Parser.ScriptType.FWM:
            case Parser.ScriptType.BWM:
                lighticon = "migscript_icon16x16.svg",
                    darkicon = lighticon;
                break;
            case Parser.ScriptType.MIGTABLE:
                lighticon = "light/migtable_icon16x16.svg",
                    darkicon = "dark/migtable_icon16x16.svg";
                break;
            case Parser.ScriptType.PARAMSECTION:
                lighticon = "light/parameters_icon16x16.svg",
                    darkicon = "dark/parameters_icon16x16.svg";
                break;
            case Parser.ScriptType.CALLEDMACROS:
            default:
                lighticon = "light/calledmacros_icon16x16.svg",
                    darkicon = "dark/calledmacros_icon16x16.svg";
                break;
        }
        this.label = token.name;
        this.collapsible = expand;
        this.id = token.start.toString() + " <> " + token.name;
        this.revealonclick = (expand === vscode.TreeItemCollapsibleState.None ? true : false);
        let range = token.range(document);
        this.revealLine = (expand === vscode.TreeItemCollapsibleState.None ? range.start.line : 0);
        this.tooltip = "Line " + (range.start.line + 1) + " - " + (range.end.line + 1);
        this.lighticon = lighticon;
        this.darkicon = darkicon;
    }
    GDLFileUI(token, document) {
        this.GDLXMLSectionUI(token, document);
        this.context = "script";
    }
    GDLScriptUI(token, document) {
        this.GDLXMLSectionUI(token, document);
        this.context = "script";
    }
    GDLSectionUI(token, document) {
        this.GDLXMLSectionUI(token, document);
        this.context = "xmlsection";
    }
    GDLPictParentUI(token) {
        this.context = "GDLPictParent";
        this.label = token.name;
        this.collapsible = vscode.TreeItemCollapsibleState.Expanded;
        this.id = token.start.toString() + " GDLPicts " + token.name;
        this.revealonclick = false;
        this.tooltip = token.numChildren.toString() + " " + token.name;
        this.lighticon = "light/pict_icon16x16.svg";
        this.darkicon = "dark/pict_icon16x16.svg";
    }
    GDLPictUI(token, document) {
        const showName = token.idString + " \u00a0" + token.file;
        this.context = "gdlpict";
        this.label = showName;
        this.id = token.start.toString() + " pict " + token.name;
        this.revealLine = token.range(document).start.line;
        this.tooltip = token.path + "\n\nClick icon to insert index at cursor and comment at end of line.";
    }
    getTreeItem(extcontext) {
        const treeItem = new vscode.TreeItem(this.label, this.collapsible);
        treeItem.id = this.id;
        treeItem.contextValue = this.context;
        if (this.revealonclick) {
            treeItem.command = {
                command: 'revealLine',
                title: '',
                arguments: [{
                        "lineNumber": Math.max(this.revealLine, 0),
                        "at": "top"
                    }]
            };
        }
        treeItem.iconPath = {
            light: extcontext.asAbsolutePath("images/" + this.lighticon),
            dark: extcontext.asAbsolutePath("images/" + this.darkicon)
        };
        treeItem.tooltip = this.tooltip;
        //console.log("TokenUI.getTreeItem", treeItem);
        return treeItem;
    }
}
//# sourceMappingURL=scriptView.js.map