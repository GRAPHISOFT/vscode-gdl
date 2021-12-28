"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasLibPartData = exports.modeGDLHSF = exports.modeGDLXML = exports.modeGDL = exports.GDLExtension = exports.activate = void 0;
const vscode = require("vscode");
const Parser = require("./parsexmlgdl");
const scriptView_1 = require("./scriptView");
const refguide_1 = require("./refguide");
const parsehsf_1 = require("./parsehsf");
const wssymbols_1 = require("./wssymbols");
const path = require("path");
const fs = require("fs");
async function activate(context) {
    //console.log("extension.activate");
    // check preview version and notify to uninstall
    if (vscode.extensions.getExtension("pbaksa@graphisoft.com.gdl-xml") != undefined) {
        let notice = "# Important\n" +
            "Before starting to use the **GDL** extension by Graphisoft (`Graphisoft@gdl`), please uninstall or disable **GDLForVSCode** extension (`pbaksa@graphisoft.com.gdl-xml`)! It was a preview version, and the public extension id became different. To prevent UI ambiguities we decided to make them incompatible. All its features are available in the public version.";
        let doc = await vscode.workspace.openTextDocument({ content: notice, language: "markdown" });
        vscode.window.showTextDocument(doc, vscode.ViewColumn.Active, true);
    }
    // create extension
    context.subscriptions.push(new GDLExtension(context));
}
exports.activate = activate;
class GDLExtension {
    constructor(context) {
        this.context = context;
        this._updateEnabled = false;
        this.currentScript = Parser.ScriptType.ROOT;
        // user settings
        this.refguidePath = "";
        this.infoFromHSF = true;
        // fired when finished parsing, multiple delays might occur before starting
        this._onDidParse = new vscode.EventEmitter();
        this.onDidParse = this._onDidParse.event;
        this.sectionDecorations = [];
        this.parser = new Parser.ParseXMLGDL(); // without document only initializes
        // GDLOutline view initialization
        this.outlineView = new scriptView_1.OutlineView(this);
        context.subscriptions.push(vscode.window.registerTreeDataProvider('GDLOutline', this.outlineView));
        this.onActiveEditorChanged(); // after registering, will create parser from document
        //status bar initialization - XML
        this.statusXMLposition = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9999);
        this.statusXMLposition.tooltip = "Go to Line of Script...";
        this.statusXMLposition.command = 'GDL.gotoRelative';
        context.subscriptions.push(this.statusXMLposition);
        //status bar initialization - HSF
        this.statusHSF = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusHSF.tooltip = "Show Info from HSF Files";
        this.statusHSF.command = 'GDL.infoFromHSF';
        context.subscriptions.push(this.statusHSF);
        // read configuration
        this.onConfigChanged();
        this.initUIDecorations();
        context.subscriptions.push(
        // callbacks
        // changed settings
        vscode.workspace.onDidChangeConfiguration(async () => this.onConfigChanged()), 
        // switched between open files
        vscode.window.onDidChangeActiveTextEditor(async () => this.onActiveEditorChanged()), 
        // file edited
        vscode.workspace.onDidChangeTextDocument(async (e) => this.onDocumentChanged(e)), 
        // opened or changed language mode
        vscode.workspace.onDidOpenTextDocument(async (e) => this.onDocumentOpened(e)), 
        // moved cursor
        vscode.window.onDidChangeTextEditorSelection(() => this.updateCurrentScript()), 
        // extension commands
        vscode.commands.registerCommand('GDL.gotoCursor', () => this.gotoCursor()), vscode.commands.registerCommand('GDL.gotoScript', async (id) => this.gotoScript(id)), vscode.commands.registerCommand('GDL.gotoRelative', async (id) => this.gotoRelative(id)), vscode.commands.registerCommand('GDL.selectScript', async (id) => this.selectScript(id)), vscode.commands.registerCommand('GDL.insertGUID', (id) => this.insertGUID(id)), vscode.commands.registerCommand('GDL.insertPict', (id) => this.insertPict(id)), vscode.commands.registerCommand('GDLOutline.toggleSpecComments', async () => this.outlineView.toggleSpecComments()), vscode.commands.registerCommand('GDLOutline.toggleMacroCalls', async () => this.outlineView.toggleMacroCalls()), vscode.commands.registerCommand('GDL.switchToGDL', async () => this.switchLang("gdl-xml")), vscode.commands.registerCommand('GDL.switchToHSF', async () => this.switchLang("gdl-hsf")), vscode.commands.registerCommand('GDL.switchToXML', async () => this.switchLang("xml")), vscode.commands.registerCommand('GDL.refguide', async () => this.showRefguide()), vscode.commands.registerCommand('GDL.infoFromHSF', () => this.setInfoFromHSF(!this.infoFromHSF)), 
        // language features
        vscode.languages.registerHoverProvider(["gdl-hsf"], this), vscode.languages.registerDocumentSymbolProvider(["gdl-xml", "gdl-hsf"], this), vscode.languages.registerWorkspaceSymbolProvider(new wssymbols_1.WSSymbols(context)), vscode.languages.registerDefinitionProvider(["gdl-hsf"], this), vscode.languages.registerReferenceProvider(["gdl-hsf"], this));
    }
    get updateEnabled() { return this._updateEnabled; }
    get editor() { return this._editor; }
    async reparseDoc(document, delay = 100) {
        //console.log("GDLExtension.reparseDoc");
        this._updateEnabled = modeGDL(document);
        vscode.commands.executeCommand('setContext', 'GDLOutlineEnabled', this._updateEnabled);
        // reparse document after delay
        this.parse(document, delay).then(result => {
            //console.log("reparseDoc resolved");
            this.parser = result;
            this.updateUI();
            this._onDidParse.fire(null);
        });
    }
    initUIDecorations() {
        // init UI decorations with extension-context-specific image paths
        this.sectionDecorations[Parser.ScriptType.ROOT] = vscode.window.createTextEditorDecorationType({});
        this.sectionDecorations[Parser.ScriptType.D] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#000000',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/light/masterscript.svg"),
            gutterIconSize: 'cover',
            dark: {
                overviewRulerColor: '#ffffff',
                gutterIconPath: this.context.asAbsolutePath("images/dark/masterscript.svg")
            }
        });
        this.sectionDecorations[Parser.ScriptType.DD] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#d22600',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/2Dscript.svg"),
            gutterIconSize: 'cover'
        });
        this.sectionDecorations[Parser.ScriptType.DDD] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#ffa500',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/3Dscript.svg"),
            gutterIconSize: 'cover'
        });
        this.sectionDecorations[Parser.ScriptType.VL] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#5d9e67',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/paramscript.svg"),
            gutterIconSize: 'cover'
        });
        this.sectionDecorations[Parser.ScriptType.PR] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#8d602f',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/propscript.svg"),
            gutterIconSize: 'cover'
        });
        this.sectionDecorations[Parser.ScriptType.UI] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#a349a4',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/UIscript.svg"),
            gutterIconSize: 'cover'
        });
        this.sectionDecorations[Parser.ScriptType.FWM] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#00a2e8',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/migscript.svg"),
            gutterIconSize: 'cover'
        });
        this.sectionDecorations[Parser.ScriptType.BWM] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#00a2e8',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/migscript.svg"),
            gutterIconSize: 'cover'
        });
        this.sectionDecorations[Parser.ScriptType.MIGTABLE] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#00a2e8',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/migscript.svg"),
            gutterIconSize: 'cover'
        });
        this.sectionDecorations[Parser.ScriptType.PARAMSECTION] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#00de00',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.context.asAbsolutePath("images/parameters.svg"),
            gutterIconSize: 'cover'
        });
        this.sectionDecorations[Parser.ScriptType.CALLEDMACROS] = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerColor: '#ff0080',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
        });
        this.sectionDecorations[Parser.ScriptType.GDLPICT] = vscode.window.createTextEditorDecorationType({});
    }
    updateUI() {
        // status bar
        this.updateCurrentScript();
        this.updateStatusHSF();
        let isGDLXML = (this.parser.getMainGUID() != undefined); // only gdl-xml files contain main guid in <Symbol> tag
        // script decorations
        let sectionList = this.parser.getAllSections();
        for (const section of sectionList) {
            // decorate only .xml of gdl-xml
            this.setDecorations({ type: this.sectionDecorations[section.scriptType],
                tokens: isGDLXML ? [section] : [] });
        }
        // remove unused
        let sectionTypes = sectionList.map(section => section.scriptType);
        for (let i = Parser.ScriptType.D; i <= Parser.ScriptType.CALLEDMACROS; i++) {
            if (!(i in sectionTypes)) {
                this.setDecorations({ type: this.sectionDecorations[i],
                    tokens: [] });
            }
        }
        // function decorations
        this.setDecorations({ type: GDLExtension.functionDecoration,
            tokens: this.parser.getAllFunctions() });
        // parameter decorations
        this.decorateParameters();
    }
    async parse(document, delay) {
        //console.log("GDLExtension parse");
        // promise to create new Parser.ParseXMLGDL after delay
        return new Promise((resolve) => {
            //console.log("GDLExtension.parse set timeout");
            this.cancelParseTimer();
            this.parseTimer = setTimeout((document) => {
                this.parseTimer = undefined;
                //console.log("GDLExtension.parse reached timeout");
                resolve(new Parser.ParseXMLGDL(document));
            }, delay, document);
        });
    }
    async onActiveEditorChanged() {
        //console.log("GDLExtension.onActiveEditorChanged");
        this._editor = vscode.window.activeTextEditor;
        // xml files opened as gdl-xml by extension
        // switch non-libpart .xml to XML language
        if (modeGDLXML(this._editor?.document) && !IsLibpart(this._editor?.document)) {
            this.switchLang("xml");
        }
        this.updateHsfLibpart();
        await this.reparseDoc(this._editor?.document, 0);
    }
    updateHsfLibpart() {
        // create new HSFLibpart if root folder changed
        let rootFolder = this.getNewHSFLibpartFolder(this.hsflibpart?.rootFolder);
        if (rootFolder) {
            this.hsflibpart = new parsehsf_1.HSFLibpart(rootFolder);
        }
        else if (rootFolder === undefined) {
            // delete HSFLibpart
            this.hsflibpart = undefined;
        }
    }
    getNewHSFLibpartFolder(oldRoot) {
        // return false if didn't change (either not hsf of not new hsf)
        //        undefined if changed to non-hsf
        //        Uri if hsf and changed root folder
        let changed = undefined;
        if (this._editor?.document.uri.scheme === 'file' && modeGDLHSF(this._editor.document)) {
            let parentFolder = vscode.Uri.joinPath(this._editor.document.uri, "../..");
            if (parentFolder.fsPath != oldRoot?.fsPath) {
                changed = parentFolder;
            }
            else {
                changed = false;
            }
        }
        else {
            if (oldRoot === undefined) {
                changed = false;
            }
        }
        return changed;
    }
    decorateParameters() {
        //console.log("GDLExtension.decorateParameters", this._editor?.document.fileName);
        let paramRanges = [];
        if (this._editor && this.hsflibpart && this.infoFromHSF) {
            let text = this._editor.document.getText();
            if (text) {
                for (const p of this.hsflibpart.paramlist) {
                    //TODO store regexs?
                    let find = new RegExp("\\b" + p.nameCS + "\\b", "ig");
                    let current;
                    while ((current = find.exec(text)) !== null) {
                        let start = this._editor.document.positionAt(current.index);
                        let end = this._editor.document.positionAt(find.lastIndex);
                        paramRanges.push(new vscode.Range(start, end));
                    }
                }
            }
        }
        if (this._editor) {
            this._editor.setDecorations(GDLExtension.paramDecoration, paramRanges);
        }
    }
    setDecorations(tokens) {
        //console.log("GDLExtension.setDecorations");
        if (this.editor) {
            this.editor.setDecorations(tokens.type, tokens.tokens.map((e) => {
                return { range: e.range };
            }, this));
        }
    }
    setInfoFromHSF(infoFromHSF) {
        this.infoFromHSF = infoFromHSF;
        this.updateStatusHSF();
        this.decorateParameters();
    }
    async onDocumentChanged(changeEvent) {
        //console.log("GDLExtension.onDocumentChanged", changeEvent.document.uri.toString());
        this.updateHsfLibpart();
        await this.reparseDoc(changeEvent.document); // with default timeout
    }
    async onDocumentOpened(document) {
        //console.log("GDLExtension.onDocumentOpened", document.uri.toString());
        // handle only top editor - other can be SCM virtual document
        if (vscode.window.activeTextEditor?.document.uri == document.uri) {
            await this.onDocumentChanged({ contentChanges: [], document: document });
        }
    }
    onConfigChanged() {
        let config = vscode.workspace.getConfiguration("gdl");
        //don't change if not found in setting
        let specComments = config.get("showSpecialComments");
        if (specComments === undefined) {
            specComments = true;
        }
        let macroCalls = config.get("showMacroCalls");
        if (macroCalls === undefined) {
            macroCalls = true;
        }
        this.outlineView.newSettings(specComments, macroCalls);
        let refguidePath = config.get("refguidePath");
        let lastPath = this.refguidePath;
        if (refguidePath !== undefined &&
            refguidePath !== "" &&
            fs.existsSync(refguidePath)) {
            this.refguidePath = refguidePath;
        }
        else {
            this.refguidePath = this.getExtensionRefguidePath();
        }
        // close webview if reference guide root changed
        if (path.normalize(path.join(lastPath, ".")) != path.normalize(path.join(this.refguidePath, "."))) { // compare normalized paths
            this.refguide?.dispose(); // will be created in showRefguide with new refguidePath
        }
        let infoFromHSF = config.get("showInfoFromHSF");
        if (infoFromHSF === undefined) {
            this.setInfoFromHSF(true);
        }
        else {
            this.setInfoFromHSF(infoFromHSF);
        }
    }
    cancelParseTimer() {
        if (this.parseTimer) {
            //console.log("GDLExtension.cancelParseTimer clear timeout");
            clearTimeout(this.parseTimer);
            this.parseTimer = undefined;
        }
    }
    cancelSuggestHSF() {
        if (this.suggestHSF) {
            this.suggestHSF.dispose();
            this.suggestHSF = undefined;
        }
    }
    dispose() {
        //console.log("GDLExtension.dispose");
        this.cancelParseTimer();
        this.cancelSuggestHSF();
    }
    gotoCursor() {
        if (this.editor) {
            // reveal line
            vscode.commands.executeCommand('revealLine', {
                "lineNumber": this.editor.selection.active.line,
                "at": "center"
            });
        }
    }
    gotoScriptType(scriptType) {
        let line = this.parser.getXMLSection(scriptType).range.start.line;
        // reveal line
        vscode.commands.executeCommand('revealLine', {
            "lineNumber": line,
            "at": "top"
        });
    }
    async pickScript(lastScript = Parser.ScriptType.CALLEDMACROS) {
        //console.log("GDLExtension.pickScript");
        let scriptType = Parser.ScriptType.ROOT;
        //list only existing scripts
        let scripts = [];
        let scriptIDs = [];
        for (let i = Parser.ScriptType.D; i <= lastScript; i++) {
            let script = this.parser.getXMLSection(i);
            if (script !== undefined) {
                scripts.push(Parser.scriptName[i]);
                scriptIDs.push(i);
            }
        }
        if (scriptIDs.length > 1) { //otherwise ScriptType.ROOT
            //show dialog
            let result = await vscode.window.showQuickPick(scripts);
            //lookup result
            scriptIDs.some(scriptID => {
                if (Parser.scriptName[scriptID] === result) {
                    scriptType = scriptID;
                    return true;
                }
                return false;
            });
        }
        return Promise.resolve(scriptType);
    }
    async gotoScript(id) {
        //console.log("GDLExtension.gotoScript");
        if (this.editor) {
            let scriptType = Parser.ScriptType.ROOT;
            if (!id || !(id instanceof Parser.GDLXMLSection)) { //called without script id
                scriptType = await this.pickScript();
            }
            else {
                scriptType = id.scriptType;
            }
            this.gotoScriptType(scriptType);
        }
    }
    async selectScript(id) {
        if (this.editor) {
            let scriptType = Parser.ScriptType.ROOT;
            if (!id || !(id instanceof Parser.GDLXMLSection)) { //called without script id
                scriptType = await this.pickScript();
            }
            else {
                scriptType = id.scriptType;
            }
            let script = this.parser.getXMLSection(scriptType);
            let start = script.range.start;
            let end = script.range.end;
            // reveal top line
            vscode.commands.executeCommand('revealLine', {
                "lineNumber": start.line,
                "at": "top"
            });
            if (scriptType !== Parser.ScriptType.ROOT) {
                //end of end-previous line - 3
                let len = this.editor.document.lineAt(end.line - 1).range.end.character;
                end = end.with(end.line - 1, len - 3);
                //start of start-next line + 9
                start = start.with(start.line + 1, 9);
            }
            //select all
            this.editor.selection = new vscode.Selection(end, start);
        }
    }
    deleteHighlight() {
        if (this.editor) {
            this.editor.setDecorations(GDLExtension.lineHighLight, []);
            this.editor.revealRange(new vscode.Range(this.editor.selection.active, this.editor.selection.active), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }
    peekline(line, promptstring, scriptStart, scriptLength, delta = 0) {
        let jump = parseInt(line);
        if (jump < 1 || jump > scriptLength || !this.editor) {
            return promptstring;
        }
        else {
            let gotoLine = scriptStart.translate(jump + delta);
            // highlight line
            let gotoRange = new vscode.Range(gotoLine, gotoLine);
            this.editor.revealRange(gotoRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            const newDecoration = { range: gotoRange };
            this.editor.setDecorations(GDLExtension.lineHighLight, [newDecoration]);
        }
        return "";
    }
    async jumpInScript(scriptType) {
        // get input # of line to jump to
        // and go there
        // returns false when user ESC'd line input dialog
        let retval = false;
        let script = this.parser.getXMLSection(scriptType);
        if (this.editor && script !== undefined) {
            let length = script.lineCount;
            let savedSelection = this.editor.selection;
            //show script start for feedback
            this.gotoScriptType(scriptType);
            let delta = ((scriptType === Parser.ScriptType.ROOT) ? -1 : 0);
            // show input box
            let promptstring = "Go to line # of " + Parser.scriptName[scriptType] + " [1 - " + length + "]";
            let result = await vscode.window.showInputBox({
                value: "1",
                prompt: promptstring,
                ignoreFocusOut: false,
                validateInput: (line) => this.peekline(line, promptstring, script.range.start, length, delta)
            });
            // jump to result
            if (result !== undefined) {
                let jump = parseInt(result);
                if (jump !== Number.NaN) {
                    let gotoLine = script.range.start.translate(jump + delta);
                    if (scriptType !== Parser.ScriptType.ROOT && jump === 1) { //goto to pos. 9 of first line
                        gotoLine = gotoLine.translate(0, 9);
                    }
                    // move cursor
                    this.editor.selection = new vscode.Selection(gotoLine, gotoLine);
                    retval = true;
                }
            }
            if (!retval) {
                this.editor.selection = savedSelection;
            }
            this.deleteHighlight();
        }
        return Promise.resolve(retval);
    }
    async gotoRelative(id) {
        if (this.editor) {
            let scriptType = Parser.ScriptType.ROOT;
            if (!id || !(id instanceof Parser.GDLXMLSection)) { //called without script id
                if (this.currentScript != Parser.ScriptType.ROOT) { //use current script (ROOT == no script)
                    scriptType = this.currentScript;
                }
                else {
                    scriptType = await this.pickScript(Parser.ScriptType.BWM); // ask user for script
                }
            }
            else {
                scriptType = id.scriptType;
            }
            let result = await this.jumpInScript(scriptType);
            while (!result && scriptType !== Parser.ScriptType.ROOT) { // pressed ESC, try again selecting another script type - find in file quits for ESC
                scriptType = await this.pickScript(Parser.ScriptType.BWM);
                result = await this.jumpInScript(scriptType);
            }
        }
        return Promise.resolve();
    }
    getScriptAtPos(pos) {
        // check if position is in range of script
        let script;
        for (let i = Parser.ScriptType.D; i <= Parser.ScriptType.BWM; i++) {
            script = this.parser.getXMLSection(i);
            if (script && // -> range defined
                pos.line > script.range.start.line && pos.line < script.range.end.line) { //<Script> tags at start and end lines
                break; // break for
            }
        }
        return script;
    }
    updateCurrentScript() {
        this.currentScript = Parser.ScriptType.ROOT;
        let line = 0;
        if (this.updateEnabled && this.editor) {
            let pos = this.editor.selection.active;
            let script = this.getScriptAtPos(pos);
            if (script) {
                this.currentScript = script.scriptType;
                line = pos.line - script.range.start.line;
            }
        }
        this.updateStatusXML(line);
    }
    updateStatusXML(line) {
        if (this.currentScript == Parser.ScriptType.ROOT) {
            //hide if not found 
            this.statusXMLposition.hide();
        }
        else {
            this.statusXMLposition.text = `${Parser.scriptName[this.currentScript]} : line ${line}`;
            this.statusXMLposition.show();
        }
    }
    updateStatusHSF() {
        if (modeGDLHSF(this.editor?.document) && this.hsflibpart) {
            if (this.infoFromHSF) {
                if (this.suggestHSF === undefined) {
                    this.suggestHSF = vscode.languages.registerCompletionItemProvider(["gdl-hsf"], this);
                }
                this.statusHSF.text = `GDL: Show Info from HSF Files`;
            }
            else {
                this.cancelSuggestHSF();
                this.statusHSF.text = `GDL: Show Info from Local File Only`;
            }
            this.statusHSF.show();
        }
        else {
            this.cancelSuggestHSF();
            this.statusHSF.hide();
        }
    }
    async switchLang(langid) {
        if (this.editor?.document) {
            switch (langid) {
                case "gdl-xml":
                case "gdl-hsf":
                case "xml":
                    vscode.languages.setTextDocumentLanguage(this.editor.document, langid);
            }
        }
    }
    insertGUID(id) {
        let guid = "";
        if (this.editor) {
            if (id instanceof Parser.GDLMigrationGUID) {
                guid = id.name;
            }
            else { // copy main guid if selected from menu or editor context menu
                let mainguid = this.parser.getMainGUID();
                if (mainguid instanceof Parser.GDLMainGUID) {
                    guid = mainguid.name;
                }
            }
            // insert "guid"
            let insertposition = this.editor.selection.active;
            this.editor.edit(edit => {
                edit.insert(insertposition, "\"" + guid + "\"");
            });
            // show inserted text
            this.editor.revealRange(new vscode.Range(insertposition, insertposition), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }
    insertPict(id) {
        if (this.editor) {
            // insert "id"
            let insertposition = this.editor.selection;
            // insert "\t! id: filename" at end of line
            let insertposition2 = this.editor.document.lineAt(insertposition.end).range.end;
            // trim last .extension
            let regex_trimlastextension = /(.+?)(\.[^.]*?)?$/i;
            let trimmed = regex_trimlastextension.exec(id.file);
            let comment = "\t! " + id.idString + ": " + ((trimmed && trimmed.length > 0) ? trimmed[1] : id.file);
            this.editor.edit(edit => {
                edit.replace(insertposition, id.idString);
                edit.insert(insertposition2, comment);
            });
            // show inserted text
            this.editor.revealRange(new vscode.Range(insertposition.active, insertposition2), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }
    getExtensionRefguidePath() {
        return this.context.asAbsolutePath('VSCodeRef');
    }
    async showRefguide() {
        if (this.editor) {
            // create refguide view if doesn't exist
            if (!this.refguide?.opened()) {
                this.refguide = new refguide_1.RefGuide(this, this.refguidePath);
            }
            // load content
            const word = refguide_1.RefGuide.helpFor(this.editor.document, this.editor.selection.active);
            this.refguide.showHelp(word);
        }
    }
    async provideHover(document, position) {
        // implemented only for hsf libparts
        if (this.hsflibpart && this.infoFromHSF) {
            let word = document.getText(document.getWordRangeAtPosition(position));
            let p = this.hsflibpart.paramlist.get(word);
            if (p) {
                return new vscode.Hover([
                    new vscode.MarkdownString("**\"" + p.desc + "\"** `" + p.nameCS + "`" +
                        "  \n**" + p.type + "**" +
                        (p.fix ? " `Fix`" : "") +
                        (p.hidden ? " `Hidden`" : "") +
                        (p.child ? " `Child`" : "") +
                        (p.bold ? " `BoldName`" : "") +
                        "  \n" + p.meaning +
                        "  \n" + p.getDefaultString())
                ]);
            }
        }
        return Promise.reject(); // paramlist.xml or word not found
    }
    async provideCompletionItems(document, position) {
        // implemented only for hsf libparts
        if (this.hsflibpart) {
            let completions = new vscode.CompletionList();
            for (const p of this.hsflibpart.paramlist) {
                let padding = " ".repeat(34 - p.nameCS.length); // max. parameter name length is 32 chars
                let completion = new vscode.CompletionItem(p.nameCS + padding + p.type + p.getDimensionString(), vscode.CompletionItemKind.Field);
                completion.insertText = p.nameCS;
                completion.detail = "\"" + p.desc + "\"";
                completion.documentation = p.getDocString(false, false);
                completions.items.push(completion);
            }
            for (const prefix of this.hsflibpart.masterconstants) {
                for (const c of prefix) {
                    let completion = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Constant);
                    completion.sortText = c.value.length.toString() + c.value; // shorter values probably smaller numbers
                    completion.detail = c.value;
                    let wordRange = document.getWordRangeAtPosition(position);
                    if (wordRange) {
                        completion.range = {
                            inserting: wordRange,
                            replacing: wordRange
                        };
                    }
                    //completion.documentation = p.getDocString(false, false);
                    completions.items.push(completion);
                }
            }
            return completions;
        }
        else {
            return undefined;
        }
    }
    mapFuncionSymbols(scriptType) {
        //console.log("GDLExtension.mapFunctionSymbols");
        return this.parser.getFunctionList(scriptType).map((f, i, array) => {
            let endpos;
            if (i + 1 < array.length) {
                // start of next function in same script
                endpos = array[i + 1].range.start;
            }
            else {
                // end of script
                let script = this.parser.getXMLSection(scriptType);
                if (script instanceof Parser.GDLScript) { // gdl-xml
                    endpos = script.innerrange.end;
                }
                else if (script instanceof Parser.GDLFile) { // gdl-hsf
                    endpos = script.range.end;
                }
                else { // shouldn't happen
                    endpos = f.range.end;
                }
            }
            let end = this.editor.document.positionAt(this.editor.document.offsetAt(endpos) - 1);
            return new vscode.DocumentSymbol(f.name, "", vscode.SymbolKind.Method, new vscode.Range(f.range.start, end), f.range);
        }, this);
    }
    mapCommentSymbols(scriptType) {
        //console.log("GDLExtension.mapCommentSymbols");
        return this.parser.getCommentList(scriptType).map((c) => {
            return new vscode.DocumentSymbol("! " + c.name, "", vscode.SymbolKind.Property, c.range, c.range);
        }, this);
    }
    mapCallSymbols(scriptType) {
        //console.log("GDLExtension.mapCallSymbols");
        return this.parser.getMacroCallList(scriptType).map((m) => {
            return new vscode.DocumentSymbol("call " + m.name, m.all ? " \u00a0parameters ALL" : "", vscode.SymbolKind.Object, m.range, m.range);
        }, this);
    }
    async parseFinished(cancel) {
        return new Promise((resolve, reject) => {
            //console.log("GDLExtension.parseFinsihed promise created");
            this.onDidParse(resolve);
            cancel.onCancellationRequested(reject);
        });
    }
    async immediateParse(document, cancel) {
        if (this.parseTimer) {
            this.reparseDoc(document, 0);
            await this.parseFinished(cancel);
        }
        //console.log("GDLExtension.immediateParse ready");
    }
    async provideDocumentSymbols(document, cancel) {
        //console.log("GDLExtension.provideDocumentSymbols");
        await this.immediateParse(document, cancel);
        let symbols = [];
        const allsections = this.parser.getAllSections();
        const noroot = (allsections.length == 1 && allsections[0] instanceof Parser.GDLFile);
        if (noroot) { // GDL-HSF
            symbols = [...this.mapFuncionSymbols(Parser.ScriptType.ROOT),
                ...this.mapCallSymbols(Parser.ScriptType.ROOT),
                ...this.mapCommentSymbols(Parser.ScriptType.ROOT)];
        }
        else {
            for (const section of allsections) {
                if (!(section instanceof Parser.GDLFile)) { // don't need file root in GDL-XML
                    let showRange = (section instanceof Parser.GDLScript) ? section.innerrange : section.range;
                    let symbol = new vscode.DocumentSymbol(section.name, "", vscode.SymbolKind.File, showRange, showRange);
                    if (section instanceof Parser.GDLScript) {
                        symbol.children = [...this.mapFuncionSymbols(section.scriptType),
                            ...this.mapCallSymbols(section.scriptType),
                            ...this.mapCommentSymbols(section.scriptType)];
                    }
                    symbols.push(symbol);
                }
            }
        }
        return symbols;
    }
    async provideDefinition(document, position, cancel) {
        let definitions = [];
        const originRange = document.getWordRangeAtPosition(position);
        if (originRange !== undefined) {
            const origin = document.getText(originRange);
            const lineBefore = document.lineAt(position.line).text.substring(0, originRange.start.character);
            if (lineBefore.match(/(then|goto|gosub)\s*["'`´“”’‘]?$/i)) {
                await this.immediateParse(document, cancel);
                definitions = this.mapFuncionSymbols(Parser.ScriptType.ROOT)
                    .filter(s => {
                    return (origin == s.name || // number
                        origin == s.name.substring(1, s.name.length - 1)); // "name"
                }).map(s => {
                    return {
                        originSelectionRange: originRange,
                        targetRange: s.range,
                        targetSelectionRange: s.selectionRange,
                        targetUri: document.uri
                    };
                });
            }
        }
        return definitions;
    }
    async provideReferences(document, position, _context, cancel) {
        let references = [];
        await this.immediateParse(document, cancel);
        const origin = this.mapFuncionSymbols(Parser.ScriptType.ROOT).filter(s => {
            return s.selectionRange.contains(position);
        })[0]?.name; // there shouldn't be more results
        for (const match of document.getText().matchAll(/(then|goto|gosub)\s*/gmi)) {
            let start = document.positionAt(match.index);
            let end = start.translate(undefined, match[0].length);
            let end_full = end.translate(undefined, origin.length);
            let rest = document.getText(new vscode.Range(end, end_full));
            if (rest == origin) {
                references.push(new vscode.Location(document.uri, new vscode.Range(start, end_full)));
            }
        }
        return references;
    }
}
exports.GDLExtension = GDLExtension;
// UI style
GDLExtension.lineHighLight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderColor: new vscode.ThemeColor("editor.lineHighlightBorder"),
    borderWidth: "2px",
    borderStyle: "solid",
    backgroundColor: new vscode.ThemeColor("editor.lineHighlightBackground")
});
GDLExtension.functionDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerColor: '#cc3333',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
});
GDLExtension.paramDecoration = vscode.window.createTextEditorDecorationType({
    fontWeight: "bold"
});
function modeGDL(document) {
    // undefined document returns false
    // language ID 'gdl-hsf' / 'gdl-xml' returns true
    return (modeGDLXML(document) || modeGDLHSF(document));
}
exports.modeGDL = modeGDL;
function modeGDLXML(document) {
    return document?.languageId === 'gdl-xml';
}
exports.modeGDLXML = modeGDLXML;
function modeGDLHSF(document) {
    return document?.languageId === 'gdl-hsf';
}
exports.modeGDLHSF = modeGDLHSF;
function hasLibPartData(uri) {
    //does libpartdata.xml exist in same folder?
    if (uri?.scheme === 'file') {
        return fs.existsSync(vscode.Uri.joinPath(uri, "libpartdata.xml").fsPath);
    }
    else {
        return false;
    }
}
exports.hasLibPartData = hasLibPartData;
function IsLibpart(document) {
    if (modeGDLXML(document)) {
        // xml files opened as gdl-xml by extension
        // if libpartdata.xml exists, this is pure xml
        // TODO check xml root tag instead
        // if an xml file is not saved yet, it is a libpart by languageID
        return !hasLibPartData(vscode.Uri.joinPath(document.uri, ".."));
    }
    else if (modeGDLHSF(document)) {
        // gdl files of libparts should have a libpartdata.xml at parent folder
        return hasLibPartData(vscode.Uri.joinPath(document.uri, "../.."));
    }
    else {
        return false;
    }
}
//# sourceMappingURL=extension.js.map