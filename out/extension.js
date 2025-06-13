"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HSFNameOfScript = exports.fileScriptType = exports.HSFScriptType = exports.readFile = exports.fileExists = exports.getLibPartData = exports.getLibparts = exports.hasLibPartData = exports.modeGDLHSF = exports.modeGDLXML = exports.modeGDL = exports.GDLExtension = exports.activate = void 0;
const vscode = require("vscode");
const util_1 = require("util");
const Parser = require("./parsexmlgdl");
const scriptView_1 = require("./scriptView");
const libpack_1 = require("./libpack");
const refguide_1 = require("./refguide");
const parsehsf_1 = require("./parsehsf");
const wssymbols_1 = require("./wssymbols");
const calltree_1 = require("./calltree");
const path = require("path");
const jumpparser_1 = require("./jumpparser");
const paramlistparser_1 = require("./paramlistparser");
async function activate(context) {
    //console.log("extension.activate");
    // create extension
    const extension = new GDLExtension(context);
    context.subscriptions.push(extension);
    extension.init(); // start async operation
}
exports.activate = activate;
;
class GDLExtension {
    context;
    // data
    parseTimer;
    parser;
    _updateEnabled = false;
    currentScript = Parser.ScriptType.ROOT;
    hsflibpart;
    wsSymbols;
    callTree;
    // user settings
    refguidePath = "";
    infoFromHSF = true;
    // UI elements
    _editor;
    statusXMLposition;
    statusHSF;
    refguide;
    outlineView;
    pathnametableView;
    // fired when finished parsing, multiple delays might occur before starting
    _onDidParse = new vscode.EventEmitter();
    onDidParse = this._onDidParse.event;
    // UI style
    static lineHighLight = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        borderColor: new vscode.ThemeColor("editor.lineHighlightBorder"),
        borderWidth: "2px",
        borderStyle: "solid",
        backgroundColor: new vscode.ThemeColor("editor.lineHighlightBackground")
    });
    static functionDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        overviewRulerColor: '#cc3333',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    /** hash for allowed image extensions */
    static allowedImageTypes = new Map([[".svg", "image/svg+xml"],
        [".bmp", "image/bmp"],
        [".png", "image/png"],
        [".jpg", "image/jpeg"],
        [".jpeg", "image/jpeg"],
        [".gif", "image/gif"],
        [".tif", "image/tiff"],
        [".tiff", "image/tiff"]]);
    static allowedImageMimes = new Set(GDLExtension.allowedImageTypes.values());
    suggestHSF;
    sectionDecorations = [];
    error_decoration;
    warning_decoration;
    // filesystem observers
    paramlist_watcher;
    gdl_watcher;
    constructor(context) {
        this.context = context;
        this.parser = new Parser.ParseXMLGDL(); // without text only initializes
        this.wsSymbols = new wssymbols_1.WSSymbols(context);
        this.callTree = new calltree_1.CallTree(context, this.wsSymbols);
        // GDLOutline view initialization
        this.outlineView = new scriptView_1.OutlineView(this);
        this.pathnametableView = new libpack_1.PathNameTableView(context);
        context.subscriptions.push(vscode.window.registerTreeDataProvider('GDLOutline', this.outlineView));
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
        //init extension-relative paths
        this.initUIDecorations();
        this.warning_decoration = vscode.window.createTextEditorDecorationType({
            textDecoration: "orange dotted underline",
            after: {
                color: "orange",
                fontStyle: "italic"
            }
        });
        this.error_decoration = vscode.window.createTextEditorDecorationType({
            textDecoration: "red dotted underline",
            after: {
                color: "red",
                fontStyle: "italic"
            }
        });
        context.subscriptions.push(
        // callbacks
        // changed settings
        vscode.workspace.onDidChangeConfiguration(async () => this.onConfigChanged()), 
        // switched between open files
        vscode.window.onDidChangeActiveTextEditor(async () => this.onActiveEditorChanged()), 
        // file edited
        vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChanged(e)), 
        // opened or changed language mode
        vscode.workspace.onDidOpenTextDocument((e) => this.onDocumentOpened(e)), 
        // moved cursor
        vscode.window.onDidChangeTextEditorSelection(() => this.updateCurrentScript()), 
        // extension commands
        vscode.commands.registerCommand('GDL.gotoCursor', () => this.gotoCursor()), vscode.commands.registerCommand('GDL.gotoScript', async (id) => this.gotoScript(id)), vscode.commands.registerCommand('GDL.gotoRelative', async (id) => this.gotoRelative(id)), vscode.commands.registerCommand('GDL.selectScript', async (id) => this.selectScript(id)), vscode.commands.registerCommand('GDL.insertGUID', (id) => this.insertGUID(id)), vscode.commands.registerCommand('GDL.insertPict', (id) => this.insertPict(id)), vscode.commands.registerCommand('GDLOutline.toggleSpecComments', async () => this.outlineView.toggleSpecComments()), vscode.commands.registerCommand('GDLOutline.toggleMacroCalls', async () => this.outlineView.toggleMacroCalls()), vscode.commands.registerCommand('GDL.switchToGDL', async () => this.switchLang("gdl-xml")), vscode.commands.registerCommand('GDL.switchToHSF', async () => this.switchLang("gdl-hsf")), vscode.commands.registerCommand('GDL.switchToXML', async () => this.switchLang("xml")), vscode.commands.registerCommand('GDL.refguide', async () => this.showRefguide()), vscode.commands.registerCommand('GDL.infoFromHSF', () => this.setInfoFromHSF(!this.infoFromHSF)), vscode.commands.registerCommand('GDL.rescanFolders', async () => this.rescanFolders()), vscode.commands.registerCommand('GDL.clearErrorDecorations', async () => this.clearErrorDecorations()), 
        // language features
        vscode.languages.registerHoverProvider(["gdl-hsf"], this), vscode.languages.registerDocumentSymbolProvider(["gdl-xml", "gdl-hsf"], this), vscode.languages.registerWorkspaceSymbolProvider(this.wsSymbols), vscode.languages.registerDefinitionProvider(["gdl-hsf"], this), vscode.languages.registerReferenceProvider(["gdl-hsf"], this), vscode.languages.registerCallHierarchyProvider(["gdl-hsf"], this.callTree), vscode.languages.registerDocumentDropEditProvider(["gdl-hsf"], this), vscode.window.registerTerminalLinkProvider(this), 
        //vscode.languages.registerCodeActionsProvider(["gdl-hsf"], this, { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] })
        vscode.languages.registerDocumentPasteEditProvider(["gdl-hsf"], this, { pasteMimeTypes: ["text/plain"], providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text] }));
    }
    async init() {
        await this.onConfigChanged(); // wait for configuration
        this.onActiveEditorChanged(); // start async operation
        this.wsSymbols.changeFolders(); // handles waiting for result on its own
        // TODO this is just a demo
        // const packages = await allPackages();
        // console.log(packages.map(p => p.packageName));
    }
    get updateEnabled() { return this._updateEnabled; }
    get editor() { return this._editor; }
    reparseDoc(document, delay = 100) {
        //console.log("GDLExtension.reparseDoc");
        this._updateEnabled = modeGDL(document);
        vscode.commands.executeCommand('setContext', 'GDLOutlineEnabled', this._updateEnabled);
        // reparse document after delay
        this.parse(document, delay).then(result => {
            //console.log("reparseDoc resolved");
            this.parser = result;
            this._onDidParse.fire(null);
            this.updateUI();
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
        const isGDLXML = (this.parser.getMainGUID() !== undefined); // only gdl-xml files contain main guid in <Symbol> tag
        // script decorations
        const sectionList = this.parser.getAllSections();
        for (const section of sectionList) {
            // decorate only .xml of gdl-xml
            this.setDecorations({ type: this.sectionDecorations[section.scriptType],
                tokens: isGDLXML ? [section] : [] });
        }
        // remove unused
        const sectionTypes = sectionList.map(section => section.scriptType);
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
        this.decorateParameters(); // start async operation
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
                resolve(new Parser.ParseXMLGDL(document?.getText()));
            }, delay, document);
        });
    }
    async onActiveEditorChanged() {
        //console.log("GDLExtension.onActiveEditorChanged",  vscode.window.activeTextEditor?.document.uri.fsPath);
        this._editor = vscode.window.activeTextEditor;
        // xml files opened as gdl-xml by extension
        // switch non-libpart .xml to XML language
        if (modeGDLXML(this._editor?.document) && !(await IsLibpart(this._editor?.document))) {
            this.switchLang("xml");
        }
        this.pathnametableView.refreshFromEditor();
        this.updateHsfLibpart();
        this.reparseDoc(this._editor?.document, 0);
    }
    updateHsfLibpart() {
        // create new HSFLibpart if root folder changed
        const newRootFolder = this.getNewHSFLibpartFolder(this.hsflibpart?.info.root_uri);
        if (newRootFolder !== undefined && this._editor !== undefined) { // no editor on startup
            if (newRootFolder) {
                //start async operations
                this.hsflibpart = new parsehsf_1.HSFLibpart(newRootFolder);
                // observe file changes not in opened editor
                // didn't work in HSFLibpart (maybe accidental async?)
                this.paramlist_watcher?.dispose();
                this.gdl_watcher?.dispose();
                this.paramlist_watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(newRootFolder, paramlistparser_1.ParamList.subpath));
                this.gdl_watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(newRootFolder, "scripts/*.gdl"));
                this.paramlist_watcher.onDidChange(() => this.hsflibpart?.refresh(true, false));
                this.gdl_watcher.onDidChange(() => this.hsflibpart?.refresh(false, true));
            }
        }
        else if (newRootFolder === undefined) {
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
            const parentFolder = vscode.Uri.joinPath(this._editor.document.uri, "../..");
            if (parentFolder.fsPath !== oldRoot?.fsPath) {
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
    static paramDecoration = vscode.window.createTextEditorDecorationType({
        fontWeight: "bold"
    });
    async decorateParameters() {
        //console.log("GDLExtension.decorateParameters", this._editor?.document.fileName);
        const paramRanges = [];
        if (this.hsflibpart) {
            // editor and settings might change during processing
            if (this._editor && this.infoFromHSF) {
                const text = this._editor.document.getText();
                if (text) {
                    for (const p of await this.hsflibpart.paramlist()) {
                        const find = new RegExp("\\b(?<!\\.)" + p.nameCS + "\\b", "ig");
                        // this matches param.key even if param is not a dict,
                        // better to highlight possible error
                        let current;
                        while ((current = find.exec(text)) !== null) {
                            const start = this._editor.document.positionAt(current.index);
                            const end = this._editor.document.positionAt(find.lastIndex);
                            paramRanges.push(new vscode.Range(start, end));
                        }
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
                return { range: e.range(this.editor.document) };
            }, this));
        }
    }
    setInfoFromHSF(infoFromHSF) {
        this.infoFromHSF = infoFromHSF;
        if (this.editor) {
            this.updateStatusHSF();
            this.decorateParameters(); // start async operation
        }
    }
    async rescanFolders() {
        await this.wsSymbols.changeFolders();
    }
    onDocumentChanged(changeEvent) {
        //console.log("GDLExtension.onDocumentChanged", changeEvent.document.uri.toString());
        this.pathnametableView.refreshFromEditor();
        this.hsflibpart?.refresh(false, true);
        this.clearErrorDecorations();
        this.reparseDoc(changeEvent.document); // with default timeout
    }
    onDocumentOpened(document) {
        //console.log("GDLExtension.onDocumentOpened", document.uri.toString());
        // handle only top editor - other can be SCM virtual document / other document opened by extension
        if (vscode.window.activeTextEditor?.document.uri === document.uri) {
            this.pathnametableView.refreshFromEditor();
            this.updateHsfLibpart();
            this.reparseDoc(document, 0);
        }
    }
    async onConfigChanged() {
        //console.log("GDLExtension.onConfigChanged");
        const config = vscode.workspace.getConfiguration("gdl");
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
        const refguideSetting = config.get("refguidePath");
        const lastPath = this.refguidePath;
        if (refguideSetting !== undefined &&
            refguideSetting !== "" &&
            (await fileExists(vscode.Uri.file(refguideSetting)))) {
            this.refguidePath = refguideSetting;
        }
        else {
            this.refguidePath = this.getExtensionRefguidePath();
        }
        // close webview if reference guide root changed
        if (path.normalize(path.join(lastPath, ".")) !== path.normalize(path.join(this.refguidePath, "."))) { // compare normalized paths
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
        this.paramlist_watcher?.dispose();
        this.gdl_watcher?.dispose();
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
        const line = this.parser.getXMLSection(scriptType).range(this.editor.document).start.line;
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
        const scripts = [];
        const scriptIDs = [];
        for (let i = Parser.ScriptType.D; i <= lastScript; i++) {
            const script = this.parser.getXMLSection(i);
            if (script !== undefined) {
                scripts.push(Parser.scriptName[i]);
                scriptIDs.push(i);
            }
        }
        if (scriptIDs.length > 1) { //otherwise ScriptType.ROOT
            //show dialog
            const result = await vscode.window.showQuickPick(scripts);
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
            const script = this.parser.getXMLSection(scriptType);
            let range = script.innerrange(this.editor.document);
            let start = range.start;
            let end = range.end;
            // reveal top line
            vscode.commands.executeCommand('revealLine', {
                "lineNumber": start.line,
                "at": "top"
            });
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
        const jump = parseInt(line);
        if (jump < 1 || jump > scriptLength || !this.editor) {
            return promptstring;
        }
        else {
            const gotoLine = scriptStart.translate(jump + delta);
            // highlight line
            const gotoRange = new vscode.Range(gotoLine, gotoLine);
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
        const script = this.parser.getXMLSection(scriptType);
        if (this.editor && script !== undefined) {
            let range = script.innerrange(this.editor.document);
            let length;
            if (script instanceof Parser.GDLFile) {
                length = range.end.line - range.start.line + 1;
            }
            else { // don't count open/closing tags
                length = range.end.line - range.start.line - 1;
            }
            const savedSelection = this.editor.selection;
            //show script start for feedback
            this.gotoScriptType(scriptType);
            const delta = ((scriptType === Parser.ScriptType.ROOT) ? -1 : 0);
            // show input box
            const promptstring = "Go to line # of " + Parser.scriptName[scriptType] + " [1 - " + length + "]";
            const result = await vscode.window.showInputBox({
                value: "1",
                prompt: promptstring,
                ignoreFocusOut: false,
                validateInput: (line) => this.peekline(line, promptstring, range.start, length, delta)
            });
            // jump to result
            if (result !== undefined) {
                const jump = parseInt(result);
                if (jump !== Number.NaN) {
                    let gotoLine = range.start.translate(jump + delta);
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
                if (this.currentScript !== Parser.ScriptType.ROOT) { //use current script (ROOT == no script)
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
        for (const i of Parser.Scripts) {
            script = this.parser.getXMLSection(i);
            if (script && // -> range defined
                script.innerrange(this.editor.document).contains(pos)) {
                break; // break for
            }
        }
        return script;
    }
    updateCurrentScript() {
        this.currentScript = Parser.ScriptType.ROOT;
        let line = 0;
        if (this.updateEnabled && this.editor) {
            const pos = this.editor.selection.active;
            const script = this.getScriptAtPos(pos);
            if (script) {
                this.currentScript = script.scriptType;
                line = pos.line - this.editor.document.positionAt(script.start).line;
            }
        }
        this.updateStatusXML(line);
    }
    updateStatusXML(line) {
        if (this.currentScript === Parser.ScriptType.ROOT) {
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
                    this.suggestHSF = vscode.languages.registerCompletionItemProvider("*", this);
                }
                this.statusHSF.text = `GDL-HSF Parameter Hints ON`;
            }
            else {
                this.statusHSF.text = `GDL-HSF Parameter Hints OFF`;
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
                const mainguid = this.parser.getMainGUID();
                if (mainguid instanceof Parser.GDLMainGUID) {
                    guid = mainguid.name;
                }
            }
            // insert "guid"
            const insertposition = this.editor.selection.active;
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
            const insertposition = this.editor.selection;
            // insert "\t! id: filename" at end of line
            const insertposition2 = this.editor.document.lineAt(insertposition.end).range.end;
            // trim last .extension
            const regex_trimlastextension = /(.+?)(\.[^.]*?)?$/i;
            const trimmed = regex_trimlastextension.exec(id.file);
            const comment = "\t! " + id.idString + ": " + ((trimmed && trimmed.length > 0) ? trimmed[1] : id.file);
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
            await this.refguide.showHelp(word);
        }
    }
    async provideDocumentDropEdits(_document, _position, dataTransfer, _cancel) {
        /*
        contents of dataTransfer.get("<mime>")[][1]
        dropped from windows explorer:
            text/uri-list       list of file:// uris
            <mimetype>          DataTransferItems containing DataTransferFile with uri of original file
        dropped from browser:
            text/uri-list       http:// uri
            text/plain          http:// uri
            text/html           html code containing img
            <mimetype>          DataTransferItems containing DataTransferFile
                                    Firefox: always bmp, with uri of temp file
                                    Edge: original file format, no uri
        dropped from vscode explorer:
            text/uri-list       list of file:// uris
            text/plain          list of paths
        */
        // direct image drops
        let droppedData;
        droppedData = Array.from(dataTransfer).filter(d => GDLExtension.allowedImageMimes.has(d[0]))
            .map(d => ({ mime: d[0], item: d[1], file: d[1].asFile() }))
            .filter((d) => d.file !== undefined);
        // use text/uri-list only if there were no attached known mimetype
        if (droppedData.length === 0) {
            // text/uri-list contains a list of uris separated by new lines
            const urllist = (await dataTransfer.get("text/uri-list")?.asString());
            const urls = urllist?.split(/[\r\n]+/) ?? [];
            // handle only file:// with known extension (no urls) 
            droppedData = urls.map(str => vscode.Uri.parse(str))
                .filter(uri => uri.scheme === "file" && GDLExtension.allowedImageTypes.has(path.extname(uri.fsPath)))
                .map(uri => ({ mime: GDLExtension.allowedImageTypes.get(path.extname(uri.fsPath)),
                uri: uri }));
        }
        if (droppedData.length === 0) {
            // nothing useable found
            return undefined;
        }
        // add images as embedded pictures
        let edit = new vscode.DocumentDropEdit("");
        const libpartinfo = this.hsflibpart.info;
        let insert = await libpartinfo.embedded_image_insertposition();
        const existing_embedded = await libpartinfo.allImages();
        for (const image of droppedData) {
            let fname;
            let content;
            if ("uri" in image) { // DroppedUri
                fname = image.uri.fsPath;
                content = await vscode.workspace.fs.readFile(image.uri);
            }
            else { // DroppedImage
                fname = image.file.name;
                content = image.file;
            }
            const fname_noext = path.basename(fname, path.extname(fname));
            const fname_nopath = path.basename(fname);
            //console.log(`${image.mime} ${fname}`);
            const existing_ref = await libpartinfo.imageIndex(fname_nopath);
            if (!edit.additionalEdit) {
                edit.additionalEdit = new vscode.WorkspaceEdit();
            }
            // add index reference and comment in gdl code
            const ref_index = existing_ref ?? insert.index++; // reference existing index in libpartdata, new otherwise
            edit.insertText += `${ref_index}\t! ${ref_index}: ${fname_noext}\n`;
            //bad UX for insertion as additionalEdit only
            //const endofline = position.with(undefined, document.lineAt(position.line).range.end.character);
            //const comment = `\t! ${insertIndex}: ${fname_noext}\n`;
            //edit.additionalEdit.insert(document.uri, endofline, comment,
            //    { label: "Add image(s)",
            //      description: "as embedded picture(s)",
            //      iconPath: new vscode.ThemeIcon("settings-edit"),
            //      needsConfirmation: false });
            // copy file
            if (existing_embedded.has(fname_nopath)) {
                // overwrite if not dropped from current object's images
                if (fname !== existing_embedded.get(fname_nopath)?.fsPath) {
                    edit.additionalEdit.createFile(existing_embedded.get(fname_nopath), { overwrite: true,
                        contents: content
                    }, { label: "Overwrite file(s)",
                        iconPath: new vscode.ThemeIcon("explorer-view-icon"),
                        needsConfirmation: true
                    });
                }
            }
            else {
                // add
                const newpath = path.join(libpartinfo.images_uri.fsPath, fname_nopath);
                edit.additionalEdit.createFile(vscode.Uri.file(newpath), { ignoreIfExists: true,
                    contents: content
                }, { label: "Copy file(s)",
                    iconPath: new vscode.ThemeIcon("explorer-view-icon"),
                    needsConfirmation: true
                });
            }
            // libpartdata entry, keep existing
            if (existing_ref === undefined) {
                let insertMime;
                let insertFlag;
                if (image.mime === "image/svg+xml") {
                    insertMime = "image/svg";
                    insertFlag = "1";
                }
                else {
                    insertMime = image.mime;
                    insertFlag = "0";
                }
                const imgref = `\t<GDLPict MIME="${insertMime}" Name="${fname_nopath}" SectVersion="19" SectionFlags="${insertFlag}" SubIdent="${ref_index}"/>\n`;
                edit.additionalEdit.insert(libpartinfo.libpartdata_uri, insert.position, imgref, { label: "Add image(s)",
                    description: "as embedded picture(s)",
                    iconPath: new vscode.ThemeIcon("settings-edit"),
                    needsConfirmation: false });
            }
        }
        return edit;
    }
    async provideHover(document, position) {
        if (this.infoFromHSF) {
            const p = await this.isParameter(document, position);
            if (p) {
                return new vscode.Hover([
                    new vscode.MarkdownString("**\"" + p.desc + "\"** `" + p.nameCS + "`" +
                        "  \n**" + p.type + "**" +
                        (p.fix ? " `Fix`" : "") +
                        (p.hidden ? " `Hidden`" : "") +
                        (p.child ? " `Child`" : "") +
                        (p.bold ? " `BoldName`" : "") +
                        "  \n" + p.getDefaultString())
                ]);
            }
        }
        return Promise.reject(); // paramlist.xml or word not found
    }
    async provideCompletionItems(document, position) {
        // implemented only for hsf libparts
        if (this.hsflibpart) {
            const completions = new vscode.CompletionList();
            for (const p of await this.hsflibpart.paramlist()) {
                const padding = " ".repeat(34 - p.nameCS.length); // max. parameter name length is 32 chars
                const completion = new vscode.CompletionItem(p.nameCS + padding + p.type + p.getDimensionString(), vscode.CompletionItemKind.Field);
                completion.insertText = p.nameCS;
                completion.detail = "\"" + p.desc + "\"";
                completion.documentation = p.getDocString(false, false);
                completions.items.push(completion);
            }
            let masterconstants = undefined;
            let scriptType = HSFScriptType(document.uri);
            if (scriptType !== Parser.ScriptType.D) {
                // get master script constants
                masterconstants = await this.hsflibpart.constants(Parser.ScriptType.D);
            }
            // get current script constants
            const editedconstants = await this.hsflibpart.constants(scriptType);
            const mergedconstants = [...masterconstants ?? [], ...editedconstants];
            for (const prefix of mergedconstants) {
                for (const c of prefix) {
                    const completion = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Constant);
                    completion.sortText = c.value.length.toString() + c.value; // shorter values probably smaller numbers
                    completion.detail = c.value;
                    const wordRange = document.getWordRangeAtPosition(position);
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
    static mapFunctionSymbols(parser, scriptType, document) {
        return parser.getFunctionList(scriptType).map((f, i, array) => {
            let endpos;
            let range = f.range(document);
            if (i + 1 < array.length) {
                // start of next function in same script
                endpos = array[i + 1].range(document).start;
            }
            else {
                // end of script
                const script = parser.getXMLSection(scriptType);
                if (script) {
                    endpos = script.innerrange(document).end;
                }
                else { // shouldn't happen
                    endpos = range.end;
                }
            }
            const end = document.positionAt(document.offsetAt(endpos) - 1);
            return new vscode.DocumentSymbol(f.name, "", vscode.SymbolKind.Method, new vscode.Range(range.start, end), range);
        });
    }
    mapOwnFuncionSymbols(scriptType) {
        //console.log("GDLExtension.mapOwnFunctionSymbols");
        return GDLExtension.mapFunctionSymbols(this.parser, scriptType, this.editor.document);
    }
    mapCommentSymbols(scriptType) {
        //console.log("GDLExtension.mapCommentSymbols");
        return this.parser.getCommentList(scriptType).map((c) => {
            const range = c.range(this.editor.document);
            return new vscode.DocumentSymbol("! " + c.name, "", vscode.SymbolKind.Property, range, range);
        }, this);
    }
    mapCallSymbols(scriptType) {
        //console.log("GDLExtension.mapCallSymbols");
        return this.parser.getLibpartReferenceList(scriptType).
            filter((reference) => reference instanceof Parser.GDLMacroCall).
            map((reference) => {
            const range = reference.range(this.editor.document);
            const detail = GDLExtension.libpartReferenceDetail(reference);
            return new vscode.DocumentSymbol(`${reference.keyword()} ${reference.name}`, detail, vscode.SymbolKind.Object, range, range);
        }, this);
    }
    static libpartReferenceDetail(reference) {
        if (reference instanceof Parser.GDLMacroCall) {
            return reference.all ? "  parameters ALL" : "";
        }
        else if (reference instanceof Parser.GDLLibrayGlobalCall) {
            return `  ${reference.global}`;
        }
        return "";
    }
    async parseFinished(cancel) {
        return new Promise((resolve, reject) => {
            //console.log("GDLExtension.parseFinsihed promise created");
            this.onDidParse(resolve);
            cancel.onCancellationRequested(reject);
        });
    }
    async immediateParse(document, cancel) {
        // if parsing already scheduled, start it immediately and wait until finishes
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
        const noroot = (allsections.length === 1 && allsections[0] instanceof Parser.GDLFile);
        if (noroot) { // GDL-HSF
            symbols = [...this.mapOwnFuncionSymbols(Parser.ScriptType.ROOT),
                ...this.mapCallSymbols(Parser.ScriptType.ROOT),
                ...this.mapCommentSymbols(Parser.ScriptType.ROOT)];
        }
        else {
            for (const section of allsections) {
                if (!(section instanceof Parser.GDLFile)) { // don't need file root in GDL-XML
                    const showRange = (section instanceof Parser.GDLScript)
                        ? section.innerrange(this.editor.document)
                        : section.range(this.editor.document);
                    const symbol = new vscode.DocumentSymbol(section.name, "", vscode.SymbolKind.File, showRange, showRange);
                    if (section instanceof Parser.GDLScript) {
                        symbol.children = [...this.mapOwnFuncionSymbols(section.scriptType),
                            ...this.mapCallSymbols(section.scriptType),
                            ...this.mapCommentSymbols(section.scriptType)];
                    }
                    symbols.push(symbol);
                }
            }
        }
        return symbols;
    }
    async isParameter(document, position) {
        // implemented only for hsf libparts
        if (!this.hsflibpart)
            return undefined;
        const wordRange = document.getWordRangeAtPosition(position, /\b(?<!\.)[_~a-z][_~0-9a-z]*\b/i);
        if (wordRange === undefined)
            return undefined;
        const word = document.getText(wordRange);
        const paramlist = await this.hsflibpart.paramlist();
        return paramlist.get(word);
    }
    async libpartReferenceLinks(ref, document, cancel) {
        const links = await this.libpartLinks(ref, document, cancel);
        if (links === undefined)
            return [];
        // if there are multiple results, select target by matching workspace folder
        if (links.length > 1) {
            const links_in_folder = links.filter(t => {
                const target_wsfolder = vscode.workspace.getWorkspaceFolder(t.targetUri);
                const call_wsfolder = vscode.workspace.getWorkspaceFolder(document.uri);
                return target_wsfolder === call_wsfolder;
            });
            // if narrowed results are zero, show all matches
            if (links_in_folder.length === 0) {
                return links;
            }
            else {
                return links_in_folder;
            }
        }
        else {
            return links;
        }
    }
    async paramlistLinks(document, position) {
        const param = await this.isParameter(document, position);
        if (param === undefined)
            return []; // can't have a Parameter without a ParamList
        const paramlist = await this.hsflibpart.paramlist(); // isParameter cached awaited paramlist, will return immediately
        const paramlist_position = paramlist.position(param.nameCS);
        // parameter info is shown customized in hover, hide xml from this definition by returning empty range
        const link = { targetUri: paramlist.uri,
            targetRange: new vscode.Range(paramlist_position, paramlist_position) };
        return [link];
    }
    async jumpLinks(jump) {
        let functionSymbols = [];
        for await (const [_scriptType, scriptUri] of this.hsflibpart.info.allScripts()) {
            const otherdoc = await vscode.workspace.openTextDocument(scriptUri);
            const otherscript = new Parser.ParseXMLGDL(otherdoc.getText(), true, false, false, false, false);
            functionSymbols = functionSymbols.concat(GDLExtension.mapFunctionSymbols(otherscript, Parser.ScriptType.ROOT, otherdoc)
                .map(s => { return { symbol: s, document: otherdoc }; }));
        }
        return functionSymbols
            .filter(s => (jump.target === s.symbol.name || // number
            jump.target === s.symbol.name.substring(1, s.symbol.name.length - 1))) // "name"
            .map(s => ({ originSelectionRange: jump.range,
            targetRange: s.symbol.range,
            targetSelectionRange: s.symbol.selectionRange,
            targetUri: s.document.uri }));
    }
    async variableLinks(document, position) {
        const wordRange = document.getWordRangeAtPosition(position, /\b[_~a-z][_~0-9a-z]*\b/i);
        if (wordRange === undefined)
            return [];
        // match .key in dict.key
        const dictTestRange = document.getWordRangeAtPosition(position, /\.[_~a-z][_~0-9a-z]*\b/i);
        const isSubkey = dictTestRange !== undefined;
        const word = document.getText(wordRange);
        const allVariableDefinitions = await this.getRelevantVariableDefinitions(word, isSubkey);
        const definitionsForWord = [...allVariableDefinitions.keys()].flatMap(uri => {
            const scriptDefinitionsForWord = allVariableDefinitions.get(uri);
            return scriptDefinitionsForWord.map(vardef => ({ uri: uri, vardef: vardef }));
        });
        return definitionsForWord.map(({ uri, vardef }) => {
            const selectionRange = new vscode.Range(vardef.subline.start.translate(0, vardef.varstart), vardef.subline.start.translate(0, vardef.defstart));
            const targetRange = new vscode.Range(vardef.subline.start, vardef.subline.start.translate(0, vardef.subline.text.length));
            return { originSelectionRange: wordRange,
                targetRange: targetRange,
                targetSelectionRange: selectionRange,
                targetUri: uri };
        });
    }
    async dictParamSubkeyLinks(document, position) {
        // give links for dict.key in paramlist if key exists as any subkey of any dict parameter
        // it could be copied to any other structure, eg:
        // paramlist: param.a.b
        // dict var : var = param.a
        // var.b    ! is param.a.b
        const wordRange = document.getWordRangeAtPosition(position, /(?<=\.)[_~a-z][_~0-9a-z]*\b/i);
        if (wordRange === undefined)
            return [];
        const subkey = document.getText(wordRange);
        let links = [];
        const paramlist = await this.hsflibpart.paramlist();
        for (const dict of paramlist.all_of_type("Dictionary")) {
            if (dict.hasSubKey(subkey)) {
                const paramlist_position = paramlist.position(dict.nameCS);
                links.push({ targetUri: paramlist.uri,
                    targetRange: new vscode.Range(paramlist_position, paramlist_position) });
            }
        }
        return links;
    }
    async provideDefinition(document, position, cancel) {
        // different kinds of jumps
        const label = (this.isLibpartReference(document, position) // Parser.GDLLibpartReference
            ?? this.isSubroutineDefinition(position) // vscode.DocumentSymbol
            ?? this.isSubroutineCall(document, position)); // Jump
        if (label) { // these can't be other types too
            if (label instanceof Parser.GDLLibpartReference) {
                return await this.libpartReferenceLinks(label, document, cancel);
            }
            else if (label instanceof vscode.DocumentSymbol) { // link back to itself
                return [{ originSelectionRange: label.selectionRange,
                        targetRange: label.range,
                        targetSelectionRange: label.selectionRange,
                        targetUri: document.uri }];
            }
            else { // instanceof Jump
                return await this.jumpLinks(label);
            }
        }
        else {
            const definitions = await Promise.all([this.paramlistLinks(document, position),
                this.dictParamSubkeyLinks(document, position),
                this.variableLinks(document, position)]);
            return definitions.flat();
        }
    }
    /** return variable definitions from libpart */
    async getRelevantVariableDefinitions(word, isSubkey) {
        const result = new Map();
        for await (const [scriptType, scriptUri] of this.hsflibpart.info.allScripts()) {
            const vardefs = await this.hsflibpart.vardefs(scriptType);
            result.set(scriptUri, vardefs.get(word).filter(v => v.isSubkey == isSubkey));
        }
        return result;
    }
    static zero_range = new vscode.Range(0, 0, 0, 0);
    static peek_range = new vscode.Range(0, 0, 10, 0);
    async libpartLinks(callsymbol, document, cancel) {
        // find exactly where is the string (can have spaces, whitespace after call)
        let call_range = callsymbol.range(document);
        const name_offset = document.getText(call_range).indexOf(callsymbol.name, 6); // start search after call "
        if (name_offset >= 6) {
            const call_start = call_range.start.translate(0, name_offset);
            call_range = call_range.with(call_start, call_start.translate(0, callsymbol.name.length));
        }
        // get target uri from wsSymbols
        const callname_lc = callsymbol.name.toLowerCase();
        return (await this.wsSymbols.provideWorkspaceSymbols_withFallback(document, true, callname_lc, false, cancel))
            // provided symbols are a loose filename match, have to be exact
            .filter(t => (callname_lc === t.name.substring(1, t.name.length - 1).toLowerCase()))
            .map(t => ({
            originSelectionRange: call_range,
            targetRange: GDLExtension.peek_range,
            targetSelectionRange: GDLExtension.zero_range,
            targetUri: t.location.uri
        }));
    }
    isLibpartReference(document, position) {
        return this.parser.getLibpartReferenceList(Parser.ScriptType.ROOT)
            .find(m => m.range(document).contains(position));
    }
    isSubroutineDefinition(position) {
        // return subroutine label or undefined if not found
        return this.mapOwnFuncionSymbols(Parser.ScriptType.ROOT)
            .filter(s => s.selectionRange.contains(position))[0]; // there shouldn't be more results
    }
    isSubroutineCall(document, position) {
        // return subroutine label at position
        const jumps = new jumpparser_1.Jumps(document.getText());
        return jumps.jumps.find(j => j.range.contains(position));
    }
    async provideReferences(document, position, _context, cancel) {
        let references = [];
        await this.immediateParse(document, cancel);
        const label = this.isSubroutineDefinition(position) // vscode.DocumentSymbol
            ?? this.isSubroutineCall(document, position); // Jump
        if (label !== undefined) {
            const target = (label instanceof vscode.DocumentSymbol) ? label.name : label.target;
            //const target = ("command" in label) ? label.target : label.name;
            for await (const [_scriptType, scriptUri] of this.hsflibpart.info.allScripts()) {
                const searchDocument = await vscode.workspace.openTextDocument(scriptUri);
                const jumps = new jumpparser_1.Jumps(searchDocument.getText());
                references = references.concat(jumps.jumps.filter(j => j.target === target)
                    .map(j => new vscode.Location(searchDocument.uri, j.range)));
            }
        }
        return references;
    }
    provideTerminalLinks(context, _token) {
        const line = context.line;
        // ...\Source\Macros\MEP_m_Connections(8) : warning: (in Script_2D) : Use of real types can result in precision problems 
        // ...\Source\Macros\MEP_m_Connections(10) : error: (in Script_2D) : Keywords can't be used as variables
        // -> open source code
        const error_re = /^(?<libpart>.*?)\((?<err_line>\d+)\) : (?<type>error|warning): \(in (Script_(?<script>1D|2D|3D|VL|UI|PR|FWM|BWM))\) : (?<msg>.*)$/;
        const match = line.match(error_re);
        if (match) {
            const { libpart, err_line, type, script, msg } = match.groups;
            const err_line_num = Number.parseInt(err_line);
            const path = vscode.Uri.joinPath(vscode.Uri.file(libpart), "scripts", `${script}.gdl`);
            const tooltip = `show ${type} in ${script} script`;
            const link = {
                ...new vscode.TerminalLink(match.index, match[0].length, tooltip),
                path: path,
                err_line: err_line_num,
                is_error: type === "error",
                msg: msg
            };
            return [link];
        }
        return [];
    }
    decorateError(link, editor, range) {
        const options = {
            range: range,
            renderOptions: {
                after: {
                    contentText: ` ${link.msg}`
                }
            }
        };
        const decor = link.is_error ? this.error_decoration : this.warning_decoration;
        const other_decor = link.is_error ? this.warning_decoration : this.error_decoration;
        editor.setDecorations(decor, [options]);
        editor.setDecorations(other_decor, []);
    }
    clearErrorDecorations() {
        const editor = vscode.window.activeTextEditor;
        if (editor !== undefined) {
            editor.setDecorations(this.error_decoration, []);
            editor.setDecorations(this.warning_decoration, []);
        }
    }
    async openError(link) {
        const document = await vscode.workspace.openTextDocument(link.path);
        const editor = await vscode.window.showTextDocument(document);
        let range;
        if (link.err_line !== undefined && !isNaN(link.err_line)) {
            const line = document.lineAt(link.err_line - 1);
            const stripped_match = line.text.match(/^(?<ws>\s*).*?(?<comment>\s*!.*)?$/);
            const { ws, comment } = stripped_match.groups;
            range = new vscode.Range(link.err_line - 1, ws.length, link.err_line - 1, line.text.length - (comment?.length ?? 0));
        }
        else {
            range = new vscode.Range(0, 0, 0, 0); // no line number, show start of document
        }
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return [editor, range];
    }
    async handleTerminalLink(link) {
        const [editor, range] = await this.openError(link);
        this.decorateError(link, editor, range);
    }
    /*public async provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, cancel: vscode.CancellationToken) : Promise<vscode.CodeAction[] | undefined> {

        if (!range.isEmpty) {
            const clipboardText = (await vscode.env.clipboard.readText()).trimStart();
            if (clipboardText && clipboardText.length > 0) {
                const [first, second] = clipboardText.split(/\s+/, 2);
                let endtag: string | undefined;
                switch (first.toLowerCase()) {
                    case "if":
                        endtag = "endif";
                        break;
                    case "for":
                        endtag = `next ${second}`;
                        break;
                    case "while":
                        endtag = "endwhile";
                        break;
                    case "do":
                        endtag = "while";
                        break;
                    case "repeat":
                        endtag = "until";
                        break;
                }
                if (endtag === undefined) return;

                let ca = new vscode.CodeAction(
                    "Paste clipboard as new block before selection, close block after selection",
                    vscode.CodeActionKind.RefactorRewrite);
                ca.edit = new vscode.WorkspaceEdit();

                //TODO if selection ends newline
                const indent = document.getText(new vscode.Range(range.start.with({character: 0}), range.start));
                ca.edit.insert(document.uri, range.end, `\n${indent}${endtag}`);
                ca.edit.insert(document.uri, range.start, `${clipboardText}\n${indent}`);
                ca.command = { command: "editor.action.indentLines", title: "Indent" };

                return [ca];
            }
        }

    }*/
    async provideDocumentPasteEdits(document, ranges, dataTransfer, _context, _token) {
        // TODO prepareDocumentPaste -> process indentation when copied
        if (ranges.length > 0 && !ranges[0].isEmpty) {
            const range = ranges[0];
            // Get clipboard text from the paste event's DataTransfer
            const text = (await dataTransfer.get("text/plain")?.asString() ?? "");
            if (this._editor && text.length > 0) {
                const [first, second] = text.trimStart().split(/\s+/, 2);
                let endtag;
                switch (first.toLowerCase()) {
                    case "if":
                        endtag = "endif";
                        break;
                    case "for":
                        endtag = `next ${second}`;
                        break;
                    case "while":
                        endtag = "endwhile";
                        break;
                    case "do":
                        endtag = "while";
                        break;
                    case "repeat":
                        endtag = "until";
                        break;
                }
                if (endtag === undefined)
                    return;
                // TODO handle ending newlines better
                const indent = this._editor.options.insertSpaces ? " ".repeat(this._editor.options.indentSize) : "\t";
                const selection = document.getText(range);
                const leadingWS = selection.split(/[^\s]/, 1)[0];
                const selectionIndented = this.indentBlock(selection, indent);
                const textIndented = this.indentBlock(this.unIndentBlock(text), leadingWS);
                const pasteText = `${textIndented}\n${selectionIndented}\n${leadingWS}${endtag}\n`;
                const edit = new vscode.DocumentPasteEdit(pasteText, "Paste as new block before selection, close block after selection", vscode.DocumentDropOrPasteEditKind.Text);
                return [edit];
            }
        }
        return;
    }
    // remove leading whitespace of first line from all lines
    unIndentBlock(text) {
        const lines = text.split(/\r?\n/);
        const leadingWS = lines[0].split(/[^\s]/, 1)[0].length;
        const unindented = lines.map(line => line.substring(leadingWS)).join("\n");
        return unindented.trimEnd(); //remove ending empty lines
    }
    // add leading whitespace to all lines
    indentBlock(text, indent) {
        const lines = text.split(/\r?\n/);
        const indented = lines.map(line => `${indent}${line}`).join("\n");
        return indented.trimEnd(); //remove ending empty lines
    }
}
exports.GDLExtension = GDLExtension;
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
async function hasLibPartData(uri) {
    //does libpartdata.xml exist in same folder?
    if (uri?.scheme === 'file') {
        const libpartdata = vscode.Uri.joinPath(uri, "libpartdata.xml");
        return await fileExists(libpartdata);
    }
    else {
        return false;
    }
}
exports.hasLibPartData = hasLibPartData;
function gsmUri(rooturi) {
    const binaryFileName = `${path.basename(rooturi.fsPath)}.gsm`;
    return { binaryFileName: binaryFileName, sourceUri: rooturi };
}
function fileUri(parenturi, filename) {
    let sourceUri = vscode.Uri.joinPath(parenturi, filename);
    const binaryFileName = filename.replace(/\.svg$/i, ".tif");
    return { binaryFileName: binaryFileName, sourceUri: sourceUri };
}
async function* getLibparts(uri) {
    if (await hasLibPartData(uri)) {
        // return uri, don't go deeper
        yield gsmUri(uri);
    }
    else {
        const content = vscode.workspace.fs.readDirectory(uri);
        for (const [name, type] of await content) {
            if (type & vscode.FileType.File) {
                // return file uri
                if (name !== "IDEntryList.dbe" && !name.endsWith("_Interface.xml")) { // skip (TODO only at specific location)
                    yield fileUri(uri, name);
                }
            }
            else {
                // continue with contents of folder
                yield* getLibparts(vscode.Uri.joinPath(uri, name));
            }
        }
    }
}
exports.getLibparts = getLibparts;
async function getLibPartData(document) {
    //does libpartdata.xml exist in same folder?
    if (document?.uri.scheme === 'file' && modeGDLHSF(document)) {
        const libpartdata = vscode.Uri.joinPath(document.uri, "..", "..", "libpartdata.xml");
        if (await fileExists(libpartdata)) {
            return libpartdata;
        }
    }
    return undefined;
}
exports.getLibPartData = getLibPartData;
async function IsLibpart(document) {
    if (modeGDLXML(document)) {
        // check xml root tag
        const gdlXML = /^[\n\r\s]*(<\?xml\s.*?\?>[\n\r\s]*)?<Symbol\s/mi;
        return gdlXML.test(document.getText());
    }
    else if (modeGDLHSF(document)) {
        // gdl files of libparts should have a libpartdata.xml at parent folder
        return await hasLibPartData(vscode.Uri.joinPath(document.uri, "../.."));
    }
    else {
        return false;
    }
}
async function fileExists(uri, type = vscode.FileType.File) {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return ((stat.type & type) > 0);
    }
    catch {
        return false;
    }
}
exports.fileExists = fileExists;
async function readFile(uri, exists = false, cancel) {
    // read an utf-8 file
    // call with exists = true to skip check
    return new Promise(async (resolve, reject) => {
        cancel?.onCancellationRequested(reject);
        if (exists || await fileExists(uri)) {
            const data = await vscode.workspace.fs.readFile(uri);
            const utf8_decoder = new util_1.TextDecoder("utf8");
            resolve(utf8_decoder.decode(data));
        }
        else {
            resolve(undefined);
        }
    });
}
exports.readFile = readFile;
function HSFScriptType(uri) {
    // return scriptype derived from filename
    const filename = path.basename(uri.fsPath, ".gdl");
    return Parser.Scripts.find(script => Parser.scriptFile[script] === filename);
}
exports.HSFScriptType = HSFScriptType;
async function fileScriptType(uri) {
    // return ScriptType.ROOT for non-HSF files
    //      scriptype derived from filename otherwise
    if (await hasLibPartData(vscode.Uri.joinPath(uri, "../.."))) {
        return HSFScriptType(uri);
    }
    else {
        return Parser.ScriptType.ROOT;
    }
}
exports.fileScriptType = fileScriptType;
function HSFNameOfScript(script) {
    return path.basename(path.dirname(path.dirname(script.fsPath)));
}
exports.HSFNameOfScript = HSFNameOfScript;
//# sourceMappingURL=extension.js.map