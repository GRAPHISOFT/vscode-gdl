import * as vscode from 'vscode';
import { TextDecoder } from 'util';

import * as Parser from './parsexmlgdl';
import { OutlineView } from './scriptView';
import { RefGuide } from './refguide';
import { HSFLibpart } from './parsehsf';
import { WSSymbols } from './wssymbols';
import { CallTree } from './calltree';
import { Constants } from './constparser';

import path = require('path');
import { Jumps } from './jumpparser';

export async function activate(context: vscode.ExtensionContext) {
    //console.log("extension.activate");

    // create extension
    const extension = new GDLExtension(context);
    context.subscriptions.push(extension);
    extension.init();   // start async operation
}

type PromiseParse = Promise<Parser.ParseXMLGDL>;

type FormattedTokens = {
	type: vscode.TextEditorDecorationType,
	tokens: Parser.GDLToken[]
};

export class GDLExtension
    implements vscode.HoverProvider,
               vscode.CompletionItemProvider,
               vscode.DocumentSymbolProvider,
               vscode.DefinitionProvider,
               vscode.ReferenceProvider {

    // data
    private parseTimer? : NodeJS.Timer;
    public parser: Parser.ParseXMLGDL;
    private _updateEnabled: boolean = false;
    private currentScript : Parser.ScriptType = Parser.ScriptType.ROOT;
    private hsflibpart? : HSFLibpart;
    private readonly wsSymbols : WSSymbols;
    private readonly callTree : CallTree;

    // user settings
    private refguidePath: string = "";
    private infoFromHSF: boolean = true;

    // UI elements
    private _editor? : vscode.TextEditor;
    private statusXMLposition : vscode.StatusBarItem;
    private statusHSF : vscode.StatusBarItem;
    private refguide? : RefGuide;
    public outlineView : OutlineView;

	// fired when finished parsing, multiple delays might occur before starting
	private _onDidParse: vscode.EventEmitter<null> = new vscode.EventEmitter<null>();
	readonly onDidParse: vscode.Event<null> = this._onDidParse.event;

    // UI style
    private static readonly lineHighLight = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        borderColor: new vscode.ThemeColor("editor.lineHighlightBorder"),
        borderWidth: "2px",
        borderStyle: "solid",
        backgroundColor: new vscode.ThemeColor("editor.lineHighlightBackground")
    });
    private static readonly functionDecoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        overviewRulerColor: '#cc3333',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    private suggestHSF : vscode.Disposable | undefined;

    private readonly sectionDecorations : vscode.TextEditorDecorationType[] = [];

    constructor(public context : vscode.ExtensionContext) {
        this.parser = new Parser.ParseXMLGDL();  // without text only initializes
        this.wsSymbols = new WSSymbols(context);
        this.callTree = new CallTree(context, this.wsSymbols);

        // GDLOutline view initialization
        this.outlineView = new OutlineView(this);
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

        context.subscriptions.push(
            // callbacks
            // changed settings
            vscode.workspace.onDidChangeConfiguration(async () => this.onConfigChanged()),
            // switched between open files
            vscode.window.onDidChangeActiveTextEditor(async () => this.onActiveEditorChanged()),
            // file edited
            vscode.workspace.onDidChangeTextDocument((e : vscode.TextDocumentChangeEvent) => this.onDocumentChanged(e)),
            // opened or changed language mode
            vscode.workspace.onDidOpenTextDocument((e: vscode.TextDocument) => this.onDocumentOpened(e)),
            // moved cursor
            vscode.window.onDidChangeTextEditorSelection(() => this.updateCurrentScript()),

            // extension commands
            vscode.commands.registerCommand('GDL.gotoCursor', () => this.gotoCursor()),
            vscode.commands.registerCommand('GDL.gotoScript', async (id? : Parser.GDLToken) => this.gotoScript(id)),
            vscode.commands.registerCommand('GDL.gotoRelative', async (id? : Parser.GDLToken) => this.gotoRelative(id)),
            vscode.commands.registerCommand('GDL.selectScript', async (id? : Parser.GDLToken) => this.selectScript(id)),
            vscode.commands.registerCommand('GDL.insertGUID', (id? : Parser.GDLToken) => this.insertGUID(id)),
            vscode.commands.registerCommand('GDL.insertPict', (id: Parser.GDLPict) => this.insertPict(id)),
            vscode.commands.registerCommand('GDLOutline.toggleSpecComments', async () => this.outlineView.toggleSpecComments()),
            vscode.commands.registerCommand('GDLOutline.toggleMacroCalls', async () => this.outlineView.toggleMacroCalls()),
    
            vscode.commands.registerCommand('GDL.switchToGDL', async () => this.switchLang("gdl-xml")),
            vscode.commands.registerCommand('GDL.switchToHSF', async () => this.switchLang("gdl-hsf")),
            vscode.commands.registerCommand('GDL.switchToXML', async () => this.switchLang("xml")),
            vscode.commands.registerCommand('GDL.refguide', async () => this.showRefguide()),
    
            vscode.commands.registerCommand('GDL.infoFromHSF', () => this.setInfoFromHSF(!this.infoFromHSF)),
            vscode.commands.registerCommand('GDL.rescanFolders', async () => this.rescanFolders()),


            // language features
            vscode.languages.registerHoverProvider(["gdl-hsf"], this),
            vscode.languages.registerDocumentSymbolProvider(["gdl-xml", "gdl-hsf"], this),
            vscode.languages.registerWorkspaceSymbolProvider(this.wsSymbols),
            vscode.languages.registerDefinitionProvider(["gdl-hsf"], this),
            vscode.languages.registerReferenceProvider(["gdl-hsf"], this),
            vscode.languages.registerCallHierarchyProvider(["gdl-hsf"], this.callTree)
        );
    }

    async init() {
        await this.onConfigChanged();   // wait for configuration
        this.onActiveEditorChanged();   // start async operation
        this.wsSymbols.changeFolders(); // handles waiting for result on its own
    }

    get updateEnabled() : boolean { return this._updateEnabled; }

    get editor() : vscode.TextEditor | undefined { return this._editor; }

    reparseDoc(document : vscode.TextDocument | undefined, delay : number = 100) {
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

    private initUIDecorations() {
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

    private updateUI() {

        // status bar
        this.updateCurrentScript();
        this.updateStatusHSF();

        const isGDLXML = (this.parser.getMainGUID() !== undefined);	// only gdl-xml files contain main guid in <Symbol> tag

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
        this.decorateParameters();  // start async operation
    }
    
    private async parse(document : vscode.TextDocument | undefined, delay : number) : PromiseParse {
        //console.log("GDLExtension parse");

        // promise to create new Parser.ParseXMLGDL after delay
        return new Promise<Parser.ParseXMLGDL>((resolve) => {
            //console.log("GDLExtension.parse set timeout");
            this.cancelParseTimer();
            this.parseTimer = setTimeout((document? : vscode.TextDocument) => {
                this.parseTimer = undefined;
                //console.log("GDLExtension.parse reached timeout");
                resolve(new Parser.ParseXMLGDL(document?.getText()));
            }, delay, document);
        });
    }
    
    private async onActiveEditorChanged() {
        //console.log("GDLExtension.onActiveEditorChanged",  vscode.window.activeTextEditor?.document.uri.fsPath);
        this._editor = vscode.window.activeTextEditor;

        // xml files opened as gdl-xml by extension
        // switch non-libpart .xml to XML language
        if (modeGDLXML(this._editor?.document) && !(await IsLibpart(this._editor?.document))) {
            this.switchLang("xml");
        }

        this.updateHsfLibpart();
        this.reparseDoc(this._editor?.document, 0);
    }

    private updateHsfLibpart() {
        // create new HSFLibpart if root folder changed
        const rootFolder = this.getNewHSFLibpartFolder(this.hsflibpart?.info.root_uri);
        if (rootFolder !== undefined) {
            const script = HSFScriptType(this._editor!.document.uri)!;
            if (rootFolder) {
                //start async operations
                this.hsflibpart = new HSFLibpart(rootFolder, script);
            } else {
                this.hsflibpart?.refresh(script);
            }
        } else if (rootFolder === undefined) {
            // delete HSFLibpart
            this.hsflibpart = undefined;
        }
    }

    private getNewHSFLibpartFolder(oldRoot? : vscode.Uri) : vscode.Uri | false | undefined {
        // return false if didn't change (either not hsf of not new hsf)
        //        undefined if changed to non-hsf
        //        Uri if hsf and changed root folder
        let changed : vscode.Uri | false | undefined = undefined;

        if (this._editor?.document.uri.scheme === 'file' && modeGDLHSF(this._editor.document)) {
            const parentFolder = vscode.Uri.joinPath(this._editor.document.uri, "../..");
            if (parentFolder.fsPath !== oldRoot?.fsPath) {
                changed = parentFolder;
            } else {
                changed = false;
            }
        } else {
            if (oldRoot === undefined) {
                changed = false;
            }
        }

        return changed;
    }

    private static paramDecoration : vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
        fontWeight: "bold"
    });

    private async decorateParameters() {
        //console.log("GDLExtension.decorateParameters", this._editor?.document.fileName);
        const paramRanges : vscode.Range[] = [];

        if (this.hsflibpart) {
            await this.hsflibpart.processing;
            // editor and settings might change during processing
            if (this._editor && this.infoFromHSF) {
                const text = this._editor.document.getText();
                if (text) {
                    for (const p of this.hsflibpart.paramlist) {
                        //TODO store regexs?
                        const find = new RegExp("\\b" + p.nameCS + "\\b", "ig");
                        let current : RegExpExecArray | null;
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

    setDecorations(tokens : FormattedTokens) {
        //console.log("GDLExtension.setDecorations");
        if (this.editor) {
            this.editor.setDecorations(tokens.type,
                tokens.tokens.map((e : Parser.GDLToken) => {
                    return { range: e.range(this.editor!.document) };
                }, this)
            );
        }
    }

    public setInfoFromHSF(infoFromHSF : boolean) {
        this.infoFromHSF = infoFromHSF;
        if (this.editor) {
            this.updateStatusHSF();
            this.decorateParameters();  // start async operation
        }
    }

    private async rescanFolders() {
        await this.wsSymbols.changeFolders();
    }

    private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent) {
        //console.log("GDLExtension.onDocumentChanged", changeEvent.document.uri.toString());
        this.updateHsfLibpart();
        this.reparseDoc(changeEvent.document);  // with default timeout
    }

    private onDocumentOpened(document: vscode.TextDocument) {
        //console.log("GDLExtension.onDocumentOpened", document.uri.toString());
        
        // handle only top editor - other can be SCM virtual document / other document opened by extension
        if (vscode.window.activeTextEditor?.document.uri === document.uri) {
            this.updateHsfLibpart();
            this.reparseDoc(document, 0);
        }
    }

    private async onConfigChanged() {
        //console.log("GDLExtension.onConfigChanged");
        const config = vscode.workspace.getConfiguration("gdl");

        //don't change if not found in setting
        let specComments = config.get<boolean>("showSpecialComments");
        if (specComments === undefined) {
            specComments = true;
        }
        let macroCalls = config.get<boolean>("showMacroCalls");
        if (macroCalls === undefined) {
            macroCalls = true;
        }
        this.outlineView.newSettings(specComments, macroCalls);

        const refguideSetting = config.get<string>("refguidePath");
        const lastPath = this.refguidePath;
        if (refguideSetting !== undefined &&
            refguideSetting !== "" &&
            (await fileExists(vscode.Uri.file(refguideSetting)))) {
                this.refguidePath = refguideSetting;
        } else {
            this.refguidePath = this.getExtensionRefguidePath();
        }
        // close webview if reference guide root changed
        if (path.normalize(path.join(lastPath, ".")) !== path.normalize(path.join(this.refguidePath, "."))) {   // compare normalized paths
            this.refguide?.dispose();  // will be created in showRefguide with new refguidePath
        }

        let infoFromHSF = config.get<boolean>("showInfoFromHSF");
        if (infoFromHSF === undefined) {
            this.setInfoFromHSF(true);
        } else {
            this.setInfoFromHSF(infoFromHSF);
        }
    }
    
    private cancelParseTimer() {
        if (this.parseTimer) {
            //console.log("GDLExtension.cancelParseTimer clear timeout");
            clearTimeout(this.parseTimer);
            this.parseTimer = undefined;
        }
    }

    private cancelSuggestHSF() {
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
            vscode.commands.executeCommand(
                'revealLine',
                {
                    "lineNumber" : this.editor.selection.active.line,
                    "at": "center"
                });
        }
    }

    private gotoScriptType(scriptType : Parser.ScriptType) {
        const line = this.parser.getXMLSection(scriptType)!.range(this.editor!.document).start.line;

        // reveal line
        vscode.commands.executeCommand(
            'revealLine',
            {
                "lineNumber" : line,
                "at": "top"
            }
        );
    }

    private async pickScript(lastScript : Parser.ScriptType = Parser.ScriptType.CALLEDMACROS) : Promise<Parser.ScriptType> {
        //console.log("GDLExtension.pickScript");
        let scriptType = Parser.ScriptType.ROOT;
        
        //list only existing scripts
        const scripts : string[] = [];
        const scriptIDs : Parser.ScriptType[] = [];
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
    
    async gotoScript(id? : Parser.GDLToken) {
        //console.log("GDLExtension.gotoScript");
        if (this.editor) {

            let scriptType = Parser.ScriptType.ROOT;

            if (!id || !(id instanceof Parser.GDLXMLSection)) { //called without script id
                scriptType = await this.pickScript();
            } else {
                scriptType = id.scriptType;
            }

            this.gotoScriptType(scriptType);
        }
    }

    async selectScript(id? : Parser.GDLToken) {
        if (this.editor) {
            let scriptType = Parser.ScriptType.ROOT;

            if (!id || !(id instanceof Parser.GDLXMLSection)) { //called without script id
                scriptType = await this.pickScript();
            } else {
                scriptType = id.scriptType;
            }

            const script = this.parser.getXMLSection(scriptType)!;

            let range = script.innerrange(this.editor!.document);
            let start = range.start;
            let end = range.end;
            
            // reveal top line
            vscode.commands.executeCommand(
                'revealLine',
                {
                    "lineNumber" : start.line,
                    "at": "top"
                });

            //select all
            this.editor.selection = new vscode.Selection(end, start);
        }
    }

    private deleteHighlight() {
        if (this.editor) {
            this.editor.setDecorations(GDLExtension.lineHighLight, []);
            this.editor.revealRange(new vscode.Range(this.editor.selection.active, this.editor.selection.active), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }

    private peekline(line : string, promptstring : string, scriptStart : vscode.Position, scriptLength : number, delta : number = 0) : string {
        const jump = parseInt(line);
        if (jump < 1 || jump > scriptLength || !this.editor) {
            return promptstring;
        } else {
            const gotoLine = scriptStart.translate(jump + delta);

            // highlight line
            const gotoRange = new vscode.Range(gotoLine, gotoLine);
            this.editor.revealRange(gotoRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            const newDecoration = { range: gotoRange };
            this.editor.setDecorations(GDLExtension.lineHighLight, [newDecoration]);

        }
        return "";
    }

    private async jumpInScript(scriptType : Parser.ScriptType) : Promise<boolean> {
        // get input # of line to jump to
        // and go there
        // returns false when user ESC'd line input dialog

        let retval = false;
        const script = this.parser.getXMLSection(scriptType);
        if (this.editor && script !== undefined) {
            let range = script.innerrange(this.editor!.document);
            let length : number;
            if (script instanceof Parser.GDLFile) {
                length = range.end.line - range.start.line + 1;
            } else {    // don't count open/closing tags
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
                                    validateInput: (line : string) : string =>
                                        this.peekline(line, promptstring, range.start, length, delta)
                                    });

            // jump to result
            if (result !== undefined) {
                const jump = parseInt(result);
                
                if (jump !== Number.NaN) {
                    let gotoLine = range.start.translate(jump + delta);
                    
                    if (scriptType !== Parser.ScriptType.ROOT && jump === 1) {   //goto to pos. 9 of first line
                        gotoLine = gotoLine.translate(0, 9);
                    }
                    
                    // move cursor
                    this.editor.selection = new vscode.Selection(gotoLine, gotoLine);
                    retval = true;
                }
            } 
            if (!retval ) {
                this.editor.selection = savedSelection;
            }
            this.deleteHighlight();
        }

        return Promise.resolve<boolean>(retval);
    }

    async gotoRelative(id? : Parser.GDLToken) {
        if (this.editor) {
            let scriptType = Parser.ScriptType.ROOT;

            if (!id || !(id instanceof Parser.GDLXMLSection)) { //called without script id
                if (this.currentScript !== Parser.ScriptType.ROOT) {   //use current script (ROOT == no script)
                    scriptType = this.currentScript;
                } else {
                    scriptType = await this.pickScript(Parser.ScriptType.BWM);  // ask user for script
                }
            } else {
                scriptType = id.scriptType;
            }
          
            let result = await this.jumpInScript(scriptType);

            while (!result && scriptType !== Parser.ScriptType.ROOT) {  // pressed ESC, try again selecting another script type - find in file quits for ESC
                scriptType = await this.pickScript(Parser.ScriptType.BWM);
                result = await this.jumpInScript(scriptType);
            }
        }

        return Promise.resolve();
    }

    private getScriptAtPos(pos : vscode.Position) : Parser.GDLScript | undefined {
        // check if position is in range of script
        let script : Parser.GDLScript | undefined;
        for (const i of Parser.Scripts) {
            script = this.parser.getXMLSection(i);

            if (script &&   // -> range defined
                script.innerrange(this.editor!.document).contains(pos)) {
                    break;  // break for
            }
        }
        return script;
    }

    private updateCurrentScript() {
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

    private updateStatusXML(line : number) {
        if (this.currentScript === Parser.ScriptType.ROOT) {
            //hide if not found 
            this.statusXMLposition.hide();
        } else {
            this.statusXMLposition.text = `${Parser.scriptName[this.currentScript]} : line ${line}`;
            this.statusXMLposition.show();
        }
    }

    private updateStatusHSF() {
        if (modeGDLHSF(this.editor?.document) && this.hsflibpart) {
            if (this.infoFromHSF) {
                if (this.suggestHSF === undefined) {
                    this.suggestHSF = vscode.languages.registerCompletionItemProvider("*", this);
                }
                this.statusHSF.text = `GDL-HSF Parameter Hints ON`;
            } else {
                this.statusHSF.text = `GDL-HSF Parameter Hints OFF`;
            }
            this.statusHSF.show();
        } else {
            this.cancelSuggestHSF();
            this.statusHSF.hide();
        }
    }

    async switchLang(langid : string) {
        if (this.editor?.document) {
            switch (langid) {
                case "gdl-xml":
                case "gdl-hsf":
                case "xml":
                    vscode.languages.setTextDocumentLanguage(this.editor.document, langid);
            }
        }
    }

    insertGUID(id? : Parser.GDLToken) {
        let guid = "";

        if (this.editor) {
            if (id instanceof Parser.GDLMigrationGUID) {
                guid = id.name;
            } else {    // copy main guid if selected from menu or editor context menu
                const mainguid = this.parser.getMainGUID();
                if (mainguid instanceof Parser.GDLMainGUID) {
                    guid = mainguid.name;
                }
            }

            // insert "guid"
            const insertposition = this.editor.selection.active;
            this.editor.edit( edit => {
                edit.insert(insertposition, "\"" + guid + "\"");
            });

            // show inserted text
            this.editor.revealRange(new vscode.Range(insertposition,
                                                     insertposition),
                                    vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }
    
    insertPict(id: Parser.GDLPict) {
        if (this.editor) {
            // insert "id"
            const insertposition = this.editor.selection;

            // insert "\t! id: filename" at end of line
            const insertposition2 = this.editor.document.lineAt(insertposition.end).range.end;

            // trim last .extension
			const regex_trimlastextension = /(.+?)(\.[^.]*?)?$/i;
			const trimmed = regex_trimlastextension.exec(id.file);
            const comment = "\t! " + id.idString + ": " + ((trimmed && trimmed.length > 0) ? trimmed[1] : id.file);

            this.editor.edit( edit => {
                edit.replace(insertposition, id.idString);
                edit.insert(insertposition2, comment);
           });

            // show inserted text
            this.editor.revealRange(new vscode.Range(insertposition.active,
                                                     insertposition2),
                                    vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }

    private getExtensionRefguidePath() : string {
        return this.context.asAbsolutePath('VSCodeRef');
    }

    async showRefguide() {
        if (this.editor) {
            // create refguide view if doesn't exist
            if (!this.refguide?.opened()) {
                this.refguide = new RefGuide(this, this.refguidePath);
            }
            
            // load content
            const word = RefGuide.helpFor(this.editor.document, this.editor.selection.active);
            await this.refguide.showHelp(word);
        }
    }

    async provideHover (document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover> {
        // implemented only for hsf libparts
        if (this.hsflibpart && this.infoFromHSF) {
            const word = document.getText(document.getWordRangeAtPosition(position));

            const p = this.hsflibpart.paramlist.get(word);
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

        return Promise.reject();    // paramlist.xml or word not found
    }

    async provideCompletionItems(document : vscode.TextDocument, position : vscode.Position) : Promise<vscode.CompletionList | undefined> {
        // implemented only for hsf libparts
        if (this.hsflibpart) {
            const completions = new vscode.CompletionList();

            for (const p of this.hsflibpart.paramlist) {
                const padding = " ".repeat(34 - p.nameCS.length); // max. parameter name length is 32 chars
                const completion = new vscode.CompletionItem(p.nameCS + padding + p.type + p.getDimensionString(), vscode.CompletionItemKind.Field);
                completion.insertText = p.nameCS;
                completion.detail = "\"" + p.desc + "\"";
                completion.documentation = p.getDocString(false, false);
                completions.items.push(completion);
            }

            let masterconstants : Constants | undefined = undefined;
            let scriptType = HSFScriptType(document.uri)!;
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
                    completion.sortText = c.value.length.toString() + c.value;  // shorter values probably smaller numbers
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
        } else {
            return undefined;
        }
    }

    private static mapFunctionSymbols(parser : Parser.ParseXMLGDL, scriptType : Parser.ScriptType, document : vscode.TextDocument) {
        return parser.getFunctionList(scriptType).map((f : Parser.GDLFunction, i : number, array : Parser.GDLFunction[]) => {
            let endpos : vscode.Position;
            let range = f.range(document);
            if (i + 1 < array.length) {
                // start of next function in same script
                endpos = array[i + 1].range(document).start;
            } else {
                // end of script
                const script = parser.getXMLSection(scriptType);
                if (script) {
                    endpos = script.innerrange(document).end;
                } else {    // shouldn't happen
                    endpos = range.end;
                }
            }
            
            const end = document.positionAt(document.offsetAt(endpos) - 1);
            return new vscode.DocumentSymbol(
                f.name,
                "",
                vscode.SymbolKind.Method,
                new vscode.Range(range.start, end),
                range);
        });
    }

    private mapOwnFuncionSymbols(scriptType : Parser.ScriptType) {
        //console.log("GDLExtension.mapOwnFunctionSymbols");
        return GDLExtension.mapFunctionSymbols(this.parser, scriptType, this.editor!.document);
    }

    private mapCommentSymbols(scriptType : Parser.ScriptType) {
        //console.log("GDLExtension.mapCommentSymbols");
        return this.parser.getCommentList(scriptType).map((c : Parser.GDLComment) => {
            const range = c.range(this.editor!.document);
            return new vscode.DocumentSymbol(
                "! " + c.name,
                "",
                vscode.SymbolKind.Property,
                range,
                range);
        }, this);
    }

    private mapCallSymbols(scriptType : Parser.ScriptType) {
        //console.log("GDLExtension.mapCallSymbols");
        return this.parser.getMacroCallList(scriptType).map((m : Parser.GDLMacroCall) => {
            const range = m.range(this.editor!.document);
            return new vscode.DocumentSymbol(
                "call " + m.name,
                m.all ? " \u00a0parameters ALL" : "",
                vscode.SymbolKind.Object,
                range,
                range);
        }, this);
    }

    private async parseFinished(cancel : vscode.CancellationToken) {
        return new Promise((resolve, reject) => {
            //console.log("GDLExtension.parseFinsihed promise created");
            this.onDidParse(resolve);
            cancel.onCancellationRequested(reject);
        });
    }

    async immediateParse(document: vscode.TextDocument, cancel : vscode.CancellationToken) {
        // if parsing already scheduled, start it immediately and wait until finishes
        if (this.parseTimer) {
            this.reparseDoc(document, 0);
            await this.parseFinished(cancel);
        }
        //console.log("GDLExtension.immediateParse ready");
    }
    
    async provideDocumentSymbols(document: vscode.TextDocument, cancel : vscode.CancellationToken) : Promise<vscode.DocumentSymbol[]> {
        //console.log("GDLExtension.provideDocumentSymbols");
        await this.immediateParse(document, cancel);

        let symbols : vscode.DocumentSymbol[] = [];
        const allsections = this.parser.getAllSections();
        const noroot = (allsections.length === 1 && allsections[0] instanceof Parser.GDLFile);
        if (noroot) {   // GDL-HSF
            symbols = [...this.mapOwnFuncionSymbols(Parser.ScriptType.ROOT),
                       ...this.mapCallSymbols(Parser.ScriptType.ROOT),
                       ...this.mapCommentSymbols(Parser.ScriptType.ROOT)];
        } else {
            for (const section of allsections) {
                if (!(section instanceof Parser.GDLFile)) {  // don't need file root in GDL-XML
                    const showRange = (section instanceof Parser.GDLScript)
                                        ? section.innerrange(this.editor!.document)
                                        : section.range(this.editor!.document);
                    const symbol = new vscode.DocumentSymbol(section.name,
                                                             "",
                                                             vscode.SymbolKind.File,
                                                             showRange,
                                                             showRange);
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

    async provideDefinition(document: vscode.TextDocument, position: vscode.Position, cancel: vscode.CancellationToken): Promise<vscode.LocationLink[]> {
        let definitions : vscode.LocationLink[] = [];

        const originRange = document.getWordRangeAtPosition(position);
        if (originRange !== undefined) {
            const origin = document.getText(originRange);

            // try macro calls
            const link = await this.macroLinks(document, originRange, cancel); 
            if (link !== undefined) {
                // if there are multiple results, select target by matching workspace folder
                if (link.length > 1) {
                    definitions = link.filter(t => {
                        const target_wsfolder = vscode.workspace.getWorkspaceFolder(t.targetUri);
                        const call_wsfolder = vscode.workspace.getWorkspaceFolder(document.uri);
                        return target_wsfolder === call_wsfolder;
                    });
                    // if narrowed results are zero, show all matches
                    if (definitions.length === 0) {
                        definitions = link;
                    }
                } else {
                    definitions = link;
                }
            } else {
                // look for subroutine calls only if not a macro call
                const jumps = new Jumps(document.lineAt(position.line).text);
                
                if (jumps.jumps.find(j => j.range.contains(position.with(0)))) {
                    let functionSymbols : {symbol: vscode.DocumentSymbol, document: vscode.TextDocument}[] = [];

                    for await (const scriptUri of await this.hsflibpart!.info.allScripts()) {
                        if (scriptUri) {
                            const otherdoc = await vscode.workspace.openTextDocument(scriptUri);
                            const otherscript = new Parser.ParseXMLGDL(otherdoc.getText(),
                            true, false, false, false, false);
                            
                            functionSymbols = functionSymbols.concat(
                                GDLExtension.mapFunctionSymbols(otherscript, Parser.ScriptType.ROOT, otherdoc)
                                            .map(s => {return {symbol: s, document: otherdoc}}));
                        }
                    }
                                
                    definitions = functionSymbols
                        .filter(s => (origin === s.symbol.name ||                                        // number
                                      origin === s.symbol.name.substring(1, s.symbol.name.length - 1)))  // "name"
                        .map(s => ({ originSelectionRange:  originRange,
                                     targetRange:           s.symbol.range,
                                     targetSelectionRange:  s.symbol.selectionRange,
                                     targetUri:             s.document.uri }));
                }
            }
        }

        return definitions;
    }

    static readonly zero_range = new vscode.Range(0, 0, 0, 0);
    static readonly peek_range = new vscode.Range(0, 0, 10, 0);

    private async macroLinks(document: vscode.TextDocument, originRange: vscode.Range, cancel: vscode.CancellationToken) : Promise<vscode.LocationLink[] | undefined> {
        // find by position in document
        const callsymbol = this.parser.getMacroCallList(Parser.ScriptType.ROOT)
                                .find(m => m.range(document).contains(originRange));
        if (callsymbol) {

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
                    originSelectionRange:  call_range,
                    targetRange:           GDLExtension.peek_range,
                    targetSelectionRange:  GDLExtension.zero_range,
                    targetUri:             t.location.uri}));
        }

        return undefined;
    }

    async provideReferences(document: vscode.TextDocument, position: vscode.Position,
                            _context: vscode.ReferenceContext, cancel: vscode.CancellationToken) : Promise<vscode.Location[]> {

        let references : vscode.Location[] = [];

        await this.immediateParse(document, cancel);

        // should we provide references of a definition?
        let label = this.mapOwnFuncionSymbols(Parser.ScriptType.ROOT).filter(s => {
            return s.selectionRange.contains(position);
        })[0]?.name; // there shouldn't be more results

        // should we provide all other references like this?
        if (label === undefined) {
            const jumps = new Jumps(document.getText());
            const selection = jumps.jumps.find(j => j.range.contains(position));
            if (selection !== undefined) {
                label = selection.target;
            }
        }
        
        if (label !== undefined) {
            for await (const scriptUri of await this.hsflibpart!.info.allScripts()) {
                if (scriptUri) {
                    const searchDocument = await vscode.workspace.openTextDocument(scriptUri);

                    const jumps = new Jumps(searchDocument.getText());
                    references = references.concat(jumps.jumps.filter(j => j.target === label)
                                                              .map(j => new vscode.Location(searchDocument.uri, j.range)));
                }
            }
        }
        
        return references;
    }
}

export function modeGDL(document? : vscode.TextDocument) : boolean {
    // undefined document returns false
    // language ID 'gdl-hsf' / 'gdl-xml' returns true
    return (modeGDLXML(document) || modeGDLHSF(document));
}

export function modeGDLXML(document? : vscode.TextDocument) : boolean {
    return document?.languageId === 'gdl-xml';
}

export function modeGDLHSF(document? : vscode.TextDocument) : boolean {
    return document?.languageId === 'gdl-hsf';
}

export async function hasLibPartData(uri? : vscode.Uri) : Promise<boolean> {
    //does libpartdata.xml exist in same folder?
    if (uri?.scheme === 'file') {
        const libpartdata = vscode.Uri.joinPath(uri, "libpartdata.xml");
        return await fileExists(libpartdata);
    } else {
        return false;
    }
}

async function IsLibpart(document? : vscode.TextDocument) : Promise<boolean> {
    if (modeGDLXML(document)) {
        // xml files opened as gdl-xml by extension
        // if libpartdata.xml exists in same folder, this is pure xml
        // TODO check xml root tag instead
        // if an xml file is not saved yet, it is a libpart by languageID
        return !(await hasLibPartData(vscode.Uri.joinPath(document!.uri, "..")));
    } else if (modeGDLHSF(document))  {
        // gdl files of libparts should have a libpartdata.xml at parent folder
        return await hasLibPartData(vscode.Uri.joinPath(document!.uri, "../.."));
    } else {
        return false;
    }
}

export async function fileExists(uri : vscode.Uri) : Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return !(stat.type & vscode.FileType.Directory);
    } catch {
        return false;
    }
}

export async function readFile(uri: vscode.Uri, exists : boolean = false, cancel? : vscode.CancellationToken) : Promise<string | undefined> {
    // read an utf-8 file
    // call with exists = true to skip check
    return new Promise(async (resolve, reject) => {
        cancel?.onCancellationRequested(reject);

        if (exists || await fileExists(uri)) {
        
            const data = await vscode.workspace.fs.readFile(uri);
            const utf8_decoder = new TextDecoder("utf8");
            resolve(utf8_decoder.decode(data));
        } else {
            resolve(undefined);
        }
    });

}

export function HSFScriptType(uri : vscode.Uri) : Parser.ScriptType | undefined {
    // return scriptype derived from filename
    const filename = path.basename(uri.fsPath, ".gdl");
    return Parser.Scripts.find(script => Parser.scriptFile[script] === filename);
}

export async function fileScriptType(uri : vscode.Uri) : Promise<Parser.ScriptType | undefined> {
    // return ScriptType.ROOT for non-HSF files
    //      scriptype derived from filename otherwise
    if (await hasLibPartData(vscode.Uri.joinPath(uri, "../.."))) {
        return HSFScriptType(uri);
    } else {
        return Parser.ScriptType.ROOT;
    }
}

export function HSFNameOfScript(script : vscode.Uri) : string {
    return path.basename(path.dirname(path.dirname(script.fsPath)));
}