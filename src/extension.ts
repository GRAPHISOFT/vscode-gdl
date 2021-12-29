import * as vscode from 'vscode';
import { TextDecoder } from 'util';

import * as Parser from './parsexmlgdl';
import { OutlineView } from './scriptView';
import { RefGuide } from './refguide';
import { HSFLibpart } from './parsehsf';
import { WSSymbols } from './wssymbols'

import path = require('path');

export async function activate(context: vscode.ExtensionContext) {
    //console.log("extension.activate");

    // create extension
    const extension = new GDLExtension(context);
    context.subscriptions.push(extension);
    setTimeout(() => extension.init(), 10); //don't block UI
}

type PromiseParse = Promise<Parser.ParseXMLGDL>;

type FormattedTokens = {
	type: vscode.TextEditorDecorationType,
	tokens: Parser.GDLToken[]
}

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
        this.parser = new Parser.ParseXMLGDL();  // without document only initializes
        this.wsSymbols = new WSSymbols(context);

        // GDLOutline view initialization
        this.outlineView = new OutlineView(this);
        context.subscriptions.push(vscode.window.registerTreeDataProvider('GDLOutline', this.outlineView));

        //status bar initialization - XML
        this.statusXMLposition = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9999);
        this.statusXMLposition.tooltip = "Go to Line of Script..."
    	this.statusXMLposition.command = 'GDL.gotoRelative';
        context.subscriptions.push(this.statusXMLposition);

        //status bar initialization - HSF
        this.statusHSF = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusHSF.tooltip = "Show Info from HSF Files"
    	this.statusHSF.command = 'GDL.infoFromHSF';
        context.subscriptions.push(this.statusHSF);

        //init extension-relative paths
        this.initUIDecorations();

        context.subscriptions.push(
            // callbacks
            // changed settings
            vscode.workspace.onDidChangeConfiguration(async () => this.onConfigChanged()),
            // switched between open files
            vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged()),
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

            // language features
            vscode.languages.registerHoverProvider(["gdl-hsf"], this),
            vscode.languages.registerDocumentSymbolProvider(["gdl-xml", "gdl-hsf"], this),
            vscode.languages.registerWorkspaceSymbolProvider(this.wsSymbols),
            vscode.languages.registerDefinitionProvider(["gdl-hsf"], this),
            vscode.languages.registerReferenceProvider(["gdl-hsf"], this)
        );
    }

    async init() {
        
        await this.onConfigChanged();           // 1 read configuration
        this.wsSymbols.changeFolders();         // 2 start looking for workspace symbols TODO status bar progress indicator?
        this.onActiveEditorChanged();           // 3 start parsing
    }

    get updateEnabled() : boolean { return this._updateEnabled; }

    get editor() : vscode.TextEditor | undefined { return this._editor; }

    reparseDoc(document : vscode.TextDocument | undefined, delay : number = 100) {
        console.log("GDLExtension.reparseDoc");
        this._updateEnabled = modeGDL(document);
        vscode.commands.executeCommand('setContext', 'GDLOutlineEnabled', this._updateEnabled);
        
        // reparse document after delay
        this.parse(document, delay).then(result => {
            console.log("reparseDoc resolved");
            this.parser = result;
            this.updateUI();
            this._onDidParse.fire(null);
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

        const isGDLXML = (this.parser.getMainGUID() != undefined);	// only gdl-xml files contain main guid in <Symbol> tag

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
        this.decorateParameters();
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
                resolve(new Parser.ParseXMLGDL(document));
            }, delay, document);
        });
    }
    
    private onActiveEditorChanged() {
        console.log("GDLExtension.onActiveEditorChanged");
        this._editor = vscode.window.activeTextEditor;

        // xml files opened as gdl-xml by extension
        // switch non-libpart .xml to XML language
        if (modeGDLXML(this._editor?.document) && !IsLibpart(this._editor?.document)) {
            this.switchLang("xml");
        }

        // these calls start timer to not block UI
        this.updateHsfLibpart();
        this.reparseDoc(this._editor?.document, 0);
    }

    private updateHsfLibpart() {
        // create new HSFLibpart if root folder changed
        const rootFolder = this.getNewHSFLibpartFolder(this.hsflibpart?.rootFolder);
        if (rootFolder) {
            this.hsflibpart = new HSFLibpart(rootFolder);
            //this doesn't have to be finsihed immediately
            setTimeout(async (hsflibpart) => {
                await Promise.allSettled([
                    hsflibpart.read_master_constants(),
                    hsflibpart.read_paramlist()]);
                this.updateUI();    // TODO call only once when all is finished
                }, 0, this.hsflibpart);
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
            if (parentFolder.fsPath != oldRoot?.fsPath) {
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

    private decorateParameters() {
        console.log("GDLExtension.decorateParameters", this._editor?.document.fileName);
        const paramRanges : vscode.Range[] = [];

        if (this._editor && this.hsflibpart && this.infoFromHSF) {
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

        if (this._editor) {
            this._editor.setDecorations(GDLExtension.paramDecoration, paramRanges);
        }
    }

    setDecorations(tokens : FormattedTokens) {
        //console.log("GDLExtension.setDecorations");
        if (this.editor) {
            this.editor.setDecorations(tokens.type,
                tokens.tokens.map((e : Parser.GDLToken) => {
                    return { range: e.range };
                }, this)
            );
        }
    }

    public setInfoFromHSF(infoFromHSF : boolean) {
        this.infoFromHSF = infoFromHSF;
        this.updateStatusHSF();
        this.decorateParameters();
    }

    private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent) {
        console.log("GDLExtension.onDocumentChanged", changeEvent.document.uri.toString());
        this.reparseDoc(changeEvent.document);  // with default timeout
    }

    private onDocumentOpened(document: vscode.TextDocument) {
        //console.log("GDLExtension.onDocumentOpened", document.uri.toString());
        
        // handle only top editor - other can be SCM virtual document
        if (vscode.window.activeTextEditor?.document.uri == document.uri) {
            this.updateHsfLibpart();
            this.reparseDoc(document, 0);
        }
    }

    private async onConfigChanged() {
        console.log("GDLExtension.onConfigChanged");
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
        if (path.normalize(path.join(lastPath, ".")) != path.normalize(path.join(this.refguidePath, "."))) {   // compare normalized paths
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
        const line = this.parser.getXMLSection(scriptType)!.range.start.line;

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

            let start = script.range.start;
            let end = script.range.end;
            
            // reveal top line
            vscode.commands.executeCommand(
                'revealLine',
                {
                    "lineNumber" : start.line,
                    "at": "top"
                });

            if (scriptType !== Parser.ScriptType.ROOT) {
                //end of end-previous line - 3
                const len = this.editor.document.lineAt(end.line - 1).range.end.character;
                end = end.with(end.line - 1, len - 3);
                //start of start-next line + 9
                start = start.with(start.line + 1, 9);
            }

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
            const length = script.lineCount;
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
                                    validateInput: (line : string) : string => this.peekline(line, promptstring, script!.range.start, length, delta)
                                    });

            // jump to result
            if (result !== undefined) {
                const jump = parseInt(result);
                
                if (jump !== Number.NaN) {
                    let gotoLine = script.range.start.translate(jump + delta);
                    
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
                if (this.currentScript != Parser.ScriptType.ROOT) {   //use current script (ROOT == no script)
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

    private getScriptAtPos(pos : vscode.Position) : Parser.GDLXMLSection | undefined {
        // check if position is in range of script
        let script : Parser.GDLXMLSection | undefined;
        for (let i = Parser.ScriptType.D; i <= Parser.ScriptType.BWM; i++) {
            script = this.parser.getXMLSection(i);

            if (script &&   // -> range defined
                pos.line > script.range.start.line && pos.line < script.range.end.line) {   //<Script> tags at start and end lines
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
                line = pos.line - script.range.start.line;
              
            }
        }

        this.updateStatusXML(line);
    }

    private updateStatusXML(line : number) {
        if (this.currentScript == Parser.ScriptType.ROOT) {
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
                    this.suggestHSF = vscode.languages.registerCompletionItemProvider(["gdl-hsf"], this);
                }
                this.statusHSF.text = `GDL: Show Info from HSF Files`;
            } else {
                this.cancelSuggestHSF();
                this.statusHSF.text = `GDL: Show Info from Local File Only`;
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
                                              "  \n" + p.meaning +
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

            for (const prefix of this.hsflibpart.masterconstants) {
                for (const c of prefix) {
                    const completion = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Constant);
                    completion.sortText = c.value.length.toString() + c.value;  // shorter values probably smaller numbers
                    completion.detail = c.value;
                    const wordRange = document.getWordRangeAtPosition(position);
                    if (wordRange) {
                        completion.range = {
                            inserting: wordRange,
                            replacing: wordRange
                        }
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

    private mapFuncionSymbols(scriptType : Parser.ScriptType) {
        //console.log("GDLExtension.mapFunctionSymbols");
        return this.parser.getFunctionList(scriptType).map((f : Parser.GDLFunction, i : number, array : Parser.GDLFunction[]) => {
            let endpos : vscode.Position;
            if (i + 1 < array.length) {
                // start of next function in same script
                endpos = array[i + 1].range.start;
            } else {
                // end of script
                const script = this.parser.getXMLSection(scriptType);
                if (script instanceof Parser.GDLScript) {       // gdl-xml
                    endpos = script.innerrange.end;
                } else if (script instanceof Parser.GDLFile) {  // gdl-hsf
                    endpos = script.range.end;
                } else {                                        // shouldn't happen
                    endpos = f.range.end;
                }
            }
            
            const end = this.editor!.document.positionAt(this.editor!.document.offsetAt(endpos) - 1);
            return new vscode.DocumentSymbol(
                f.name,
                "",
                vscode.SymbolKind.Method,
                new vscode.Range(f.range.start, end),
                f.range);
        }, this);
    }

    private mapCommentSymbols(scriptType : Parser.ScriptType) {
        //console.log("GDLExtension.mapCommentSymbols");
        return this.parser.getCommentList(scriptType).map((c : Parser.GDLComment) => {
            return new vscode.DocumentSymbol(
                "! " + c.name,
                "",
                vscode.SymbolKind.Property,
                c.range,
                c.range);
        }, this);
    }

    private mapCallSymbols(scriptType : Parser.ScriptType) {
        //console.log("GDLExtension.mapCallSymbols");
        return this.parser.getMacroCallList(scriptType).map((m : Parser.GDLMacroCall) => {
            return new vscode.DocumentSymbol(
                "call " + m.name,
                m.all ? " \u00a0parameters ALL" : "",
                vscode.SymbolKind.Object,
                m.range,
                m.range);
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
        const noroot = (allsections.length == 1 && allsections[0] instanceof Parser.GDLFile);
        if (noroot) {   // GDL-HSF
            symbols = [...this.mapFuncionSymbols(Parser.ScriptType.ROOT),
                       ...this.mapCallSymbols(Parser.ScriptType.ROOT),
                       ...this.mapCommentSymbols(Parser.ScriptType.ROOT)];
        } else {
            for (const section of allsections) {
                if (!(section instanceof Parser.GDLFile)) {  // don't need file root in GDL-XML
                    const showRange = (section instanceof Parser.GDLScript) ? section.innerrange : section.range;
                    const symbol = new vscode.DocumentSymbol(section.name,
                                                             "",
                                                             vscode.SymbolKind.File,
                                                             showRange,
                                                             showRange);
                    if (section instanceof Parser.GDLScript) {
                        symbol.children = [...this.mapFuncionSymbols(section.scriptType),
                                           ...this.mapCallSymbols(section.scriptType),
                                           ...this.mapCommentSymbols(section.scriptType)]
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
            const lineBefore = document.lineAt(position.line).text.substring(0, originRange.start.character);

            if (lineBefore.match(/(then|goto|gosub)\s*["'`´“”’‘]?$/i)) {
                await this.immediateParse(document, cancel);

                definitions = this.mapFuncionSymbols(Parser.ScriptType.ROOT)
                    .filter(s => {
                        return (origin == s.name ||                                 // number
                                origin == s.name.substring(1, s.name.length - 1))   // "name"
                    }).map(s => {
                        return {
                            originSelectionRange: originRange,
                            targetRange: s.range,
                            targetSelectionRange: s.selectionRange,
                            targetUri: document.uri
                        }
                    });
            }
        }

        return definitions;
    }

    async provideReferences(document: vscode.TextDocument, position: vscode.Position,
                            _context: vscode.ReferenceContext, cancel: vscode.CancellationToken) : Promise<vscode.Location[]> {

        const references : vscode.Location[] = [];

        await this.immediateParse(document, cancel);

        const origin = this.mapFuncionSymbols(Parser.ScriptType.ROOT).filter(s => {
            return s.selectionRange.contains(position);
        })[0]?.name; // there shouldn't be more results

        for (const match of document.getText().matchAll(/(then|goto|gosub)\s*/gmi)) {
            const start = document.positionAt(match.index!);
            const end = start.translate(undefined, match[0].length);
            const end_full = end.translate(undefined, origin.length);
            const rest = document.getText(new vscode.Range(end, end_full));

            if (rest == origin) {
                references.push(new vscode.Location(document.uri, new vscode.Range(start, end_full)));
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

export async function readFile(uri: vscode.Uri, exists : boolean = false) : Promise<string | undefined> {
    // read an utf-8 file
    // call with exists = true to skip check
    if (exists || await fileExists(uri)) {
        const data = await vscode.workspace.fs.readFile(uri);
        const utf8_decoder = new TextDecoder("utf8");
        return utf8_decoder.decode(data);
    } else {
        return undefined;
    }
}