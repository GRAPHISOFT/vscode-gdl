import * as vscode from 'vscode';
import { modeGDL } from './extension';

export enum ScriptType { ROOT = 0, D, DD, DDD, UI, VL, PR, FWM, BWM, MIGTABLE, PARAMSECTION, CALLEDMACROS, GDLPICT }
export const scriptAbbrev = [ "", "MASTER", "2D", "3D", "UI", "PARAM", "PROP", "FWM", "BWM", "", "", "", "" ];
export const scriptName = [ "file",
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
export abstract class GDLToken {
	public static readonly regex : RegExp;											// regex string needed to catch all
	public readonly range : vscode.Range;											// range in editor

	constructor(start : vscode.Position, end : vscode.Position, public readonly name : string) {
		this.range = new vscode.Range(start, end);
	}
}

// function definitions
export class GDLFunction extends GDLToken {
	public static readonly regex = /(?<=^\s*?)(([0-9]+)|((["'`´“”’‘])([^"'`´“”’‘]+)\4))\s*:/mg;

	public readonly inScript : ScriptType;

	constructor(start : vscode.Position, end : vscode.Position, name : string, inScript : ScriptType) {
		//console.log("GDLFunction()", name, inScript);
		super(start, end, name);
		this.inScript = inScript;
	}
}

// special comments
export class GDLComment extends GDLToken {
	//public static readonly regex = /^\s*!\s*---\s*([^-]+?)---.*$/mig;		// ! --- name ---

	public static readonly regex = /^(\s*!\s*=+)\r?\n\s*!\s*(.+?)\r?\n\1/mig;	// ! ============
																				// ! name
																				// ! ============

	public readonly inScript : ScriptType;

	constructor(start : vscode.Position, end : vscode.Position, name : string, inScript : ScriptType) {
		//console.log("GDLComment()", name, inScript);
		super(start, end, name);
		this.inScript = inScript;
	}
}

// called macros
export class GDLCalledMacro extends GDLToken {
	public static readonly regex = /^\s*<MName><!\[CDATA\["([\D\d]*?)"\]\]><\/MName>/mig;

	public readonly fromScripts : boolean[];

	constructor(start : vscode.Position, end : vscode.Position, name : string, fromScripts : boolean[]) {
		//console.log("GDLCalledMacro()", content);
		super(start, end, name);
		this.fromScripts = fromScripts;
	}
}

// macro calls
export class GDLMacroCall extends GDLToken {
	public static readonly regex = /(?<!!.*)\bcall\s*"([\w ]*)"(\s*(,\r?\n\s*)?(parameters\s*all))?/mig;

	public readonly all : boolean;
	public readonly inScript : ScriptType;

	constructor(start : vscode.Position, end : vscode.Position, match : RegExpExecArray, script : ScriptType) {
		//console.log("GDLMacroCall()", content);
		super(start, end, match[1]);
		this.all = (match.length >= 4 && match[4] !== undefined);	// parameters all
		this.inScript = script;
	}
}

// main GUID
export class GDLMainGUID extends GDLToken {
	public static readonly regex = /^<Symbol.*?MainGUID="([-0-9A-Z]*)".*?>$/mig;

	constructor(start : vscode.Position, end : vscode.Position, guid : string) {
		super(start, end, guid);
	}
}

// migration table GUIDs
export class GDLMigrationGUID extends GDLToken {
	public static readonly regex = /^\s*<(MigrationTableElement>)([\D\d]*?)<\/\1/mig;

	public readonly version : number;
	public readonly automigration : boolean;

	constructor(start : vscode.Position, end : vscode.Position, content : string) {
		//console.log("GDLMigrationGUID()", content);

		//defaults if not found
		let GUID = "00000000-0000-0000-0000-000000000000";
		let version = -1;
		let automigration = false;

		let match : RegExpExecArray | null;

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

// toplevel XML sections (script, migtable, etc...)
export abstract class GDLXMLSection extends GDLToken {
	public static readonly regex = /^<((Script_([123]D|UI|VL|PR|[FB]WM))|ParamSection|MigrationTable|CalledMacros)[\D\d]*?<\/\1>/mg;

	public readonly scriptType : ScriptType;		// integer ID of tag
	protected readonly parser : ParseXMLGDL;		// needed for other elements' lists
	public abstract readonly lineCount : number;

	constructor(start : vscode.Position, end : vscode.Position, scriptType : ScriptType, parser : ParseXMLGDL) {
		super(start, end, scriptName[scriptType]);

		this.scriptType = scriptType;
		this.parser = parser;
	}

	public abstract hasChildren() : boolean;		// can be opened down when has children
}

// whole file
export class GDLFile extends GDLXMLSection {
	public readonly lineCount : number;

	constructor(start : vscode.Position, end : vscode.Position, parser : ParseXMLGDL) {
		super(start, end, ScriptType.ROOT, parser);
		this.lineCount = end.line - start.line + 1;
	}

	public hasChildren() : boolean {
		return false;
	}
}

// GDL scripts
export class GDLScript extends GDLXMLSection {
	public readonly lineCount : number; 	// lines between CDATA, including start
	public static readonly innerregex = /(?<=^.*?<\!\[CDATA\[).*(?=\]\]>[\n\r]*<\/Script_)/s;
	public readonly innerrange : vscode.Range;

	constructor(start : vscode.Position, end : vscode.Position, scriptType : ScriptType, parser : ParseXMLGDL, document : vscode.TextDocument) {
		super(start, end, scriptType, parser);
		this.lineCount = end.line - start.line - 1;
		let match = GDLScript.innerregex.exec(document.getText(this.range));
		if (match) {
			let innerstart = document.offsetAt(start) + match.index;
			this.innerrange = new vscode.Range(	document.positionAt(innerstart),
												document.positionAt(innerstart + match[0].length));
		} else {
			this.innerrange = this.range;
		}
	}

	public hasChildren() : boolean {
		let functionList = this.parser.getFunctionList(this.scriptType);
		return  (functionList.length > 0 ||		//has funtions
				 this.lineCount > 1);			//longer than one line: has main function
	}
}

// non-script XML sections
export class GDLSection extends GDLXMLSection {
	public readonly lineCount : number; 	// lines between CDATA, including start

	constructor(start : vscode.Position, end : vscode.Position, scriptType : ScriptType, parser : ParseXMLGDL) {
		super(start, end, scriptType, parser);
		this.lineCount = end.line - start.line - 1;
	}

	public hasChildren() : boolean {
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

// parent of GDLPict leafs
export class GDLPictParent extends GDLToken {
	public static readonly regex = /./;															// not used

	public readonly numChildren : number;

	constructor(numChildren : number) {
		const pos = new vscode.Position(0, 0);
		super(pos, pos, scriptName[ScriptType.GDLPICT]);
		this.numChildren = numChildren;
	}
}

// embedded GDLPict
export class GDLPict extends GDLToken {
	public static readonly regex = /^\s*<GDLPict[\D\d]*?SubIdent="(\d*?)"[\D\d]*?path="(.*?\/([^\/]*))"[\D\d]*?\/>/mig;

	public readonly id : number;
	public readonly idString : string;
	public readonly path : string;
	public readonly file : string;

	constructor(start : vscode.Position, end : vscode.Position, match : RegExpExecArray) {
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

export class ParseXMLGDL {

	private sectionList : (GDLXMLSection | undefined)[] = [];
	private functionList : GDLFunction[][] = [];
	private commentList : GDLComment[][] = [];
	private macroCallList : GDLMacroCall[][] = [];
	private mainGUID? : GDLMainGUID;
	private GUIDList : GDLMigrationGUID[] = [];
	private calledMacroList : GDLCalledMacro[] = [];
	private pictList : GDLPict[] = [];

	constructor(document? : vscode.TextDocument) {
		//console.log("ParseXMLGDL()");
		this.parseall(document);
	}
	
	public getXMLSection(scriptType : ScriptType) : GDLXMLSection | undefined {
		// not a list, only one element
		return this.sectionList[scriptType];
	}
		
	public getFunctionList(scriptType : ScriptType) : GDLFunction[] {
		return this.functionList[scriptType];
	}

	public getCommentList(scriptType : ScriptType) : GDLComment[] {
		return this.commentList[scriptType];
	}

	public getGUIDList() : GDLToken[] {
		return this.GUIDList;
	}

	public getMainGUID() : GDLMainGUID | undefined {
		return this.mainGUID;
	}

	public getCalledMacroList() : GDLCalledMacro[] {
		return this.calledMacroList;
	}

	public getMacroCallList(scriptType : ScriptType) : GDLMacroCall[] {
		return this.macroCallList[scriptType];
	}

	public getPictList() : GDLPict[] {
		return this.pictList;
	}

	private parseScripts(document? : vscode.TextDocument) {
		//console.log("ParseXMLGDL.parseScripts");
		let match : RegExpExecArray | null;
		this.sectionList = [];

		if (modeGDL(document)) {
			const text = document!.getText();
			while (match = GDLXMLSection.regex.exec(text)) {
				if (match.length > 0) { // match[1] exists
					let script = ParseXMLGDL.createGDLXMLSection(document!.positionAt(match.index),
																 document!.positionAt(match.index + match[0].length),
																 match[1], this, document!);

					this.sectionList[script.scriptType] = script;
				}
			}

			// whole file
			this.sectionList[ScriptType.ROOT] = ParseXMLGDL.createGDLXMLSection(new vscode.Position(0, 0),
																				document!.positionAt(text.length),
																				"", this, document!);
		}
	}

	private scriptOfPos(line : number) : ScriptType {
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

	private parseFunctions(document? : vscode.TextDocument) {
		//console.log("ParseXMLGDL.parseFunctions");
		let match : RegExpExecArray | null, matchedName : string;
		this.functionList = [];

		for (let i = ScriptType.ROOT; i <= ScriptType.MIGTABLE; i++) {
			this.functionList.push([]);
		}
		
		if (modeGDL(document)) {
			while (match = GDLFunction.regex.exec(document!.getText())) {
				if (match.length > 1) { // match[2] exists
					if (match[2]) {
						matchedName = match[2]; // number
					} else {
						matchedName = match[3]; // name
					}
					const start = document!.positionAt(match.index);
					const end = document!.positionAt(match.index + matchedName.length + 1);
					const scriptType = this.scriptOfPos(start.line);
					this.functionList[scriptType].push(new GDLFunction(	start,
																		end,
																		matchedName,
																		scriptType));
				}
			}
		}
	}

	private parseComments(document? : vscode.TextDocument) {
		//console.log("ParseXMLGDL.parseComments");
		let match : RegExpExecArray | null;
		this.commentList = [];

		for (let i = ScriptType.ROOT; i <= ScriptType.MIGTABLE; i++) {
			this.commentList.push([]);
		}

		if (modeGDL(document)) {
			while (match = GDLComment.regex.exec(document!.getText())) {
				if (match.length > 1) { // match[2] exists
					const start = document!.positionAt(match.index);
					const end = document!.positionAt(match.index + match[0].length + 1); 
					const scriptType = this.scriptOfPos(start.line);
					this.commentList[scriptType].push(new GDLComment(	start,
																		end,
																		match[2],
																		scriptType));
				}
			}
		}
	}

	private parseGUIDs(document? : vscode.TextDocument) {
		//console.log("ParseXMLGDL.parseGUIDs");
		let match : RegExpExecArray | null;
		this.GUIDList = [];

		if (modeGDL(document)) {
			const text = document!.getText();

			// get main GUID
			this.mainGUID = undefined;
			while (match = GDLMainGUID.regex.exec(text)) {
				if (match.length > 0) { // match[1] exists
					this.mainGUID = new GDLMainGUID(document!.positionAt(match.index),
													document!.positionAt(match.index + match[0].length + 1),
													match[1]);
				}
			}

			// get migration GUIDs
			while (match = GDLMigrationGUID.regex.exec(text)) {
				if (match.length > 1) { // match[2] exists
					this.GUIDList.push(new GDLMigrationGUID(document!.positionAt(match.index),
															document!.positionAt(match.index + match[0].length + 1),
															match[2]));
				}
			}
		}
	}

	private parseCalledMacros(document? : vscode.TextDocument) {
		//console.log("ParseXMLGDL.parseCalledMacros");
		let match : RegExpExecArray | null;
		this.macroCallList = [];
		this.calledMacroList = [];

		if (modeGDL(document)) {
			for (let i = ScriptType.ROOT; i <= ScriptType.MIGTABLE; i++) {
				this.macroCallList.push([]);
			}

			interface MapMacro { [name: string] : boolean[]; }
			let macroCallListMap : MapMacro = {};

			const text = document!.getText();

			// parse macro calls
			while (match = GDLMacroCall.regex.exec(text)) {
				if (match.length > 0) {
					const start = document!.positionAt(match.index);
					const end = document!.positionAt(match.index + match[0].length + 1); 
					const scriptType = this.scriptOfPos(start.line);
					let macroCall = new GDLMacroCall(	start,
														end,
														match,
														scriptType);

					this.macroCallList[scriptType].push(macroCall);
					// temporary map used for adding info to GDLCalledMacro later
					if (macroCallListMap[macroCall.name] === undefined) {
						macroCallListMap[macroCall.name] = new Array<boolean>();
					}
					macroCallListMap[macroCall.name][scriptType] = true;
				}
			}

			// parse CalledMacros section
			while (match = GDLCalledMacro.regex.exec(text)) {
				if (match.length > 0) { // match[1] exists
					let calledFromScripts  = macroCallListMap[match[1]];
					if (calledFromScripts === undefined) {
						calledFromScripts = new Array<boolean>();
					}
					const start = document!.positionAt(match.index);
					const end = document!.positionAt(match.index + match[0].length + 1); 
					this.calledMacroList.push(new GDLCalledMacro(	start,
																	end,
																	match[1],
																	calledFromScripts));
				}
			}
		}
	}

	private parsePicts(document? : vscode.TextDocument) {
		//console.log("ParseXMLGDL.parsePicts");
		let match : RegExpExecArray | null;
		this.pictList = [];

		if (modeGDL(document)) {
			// store GDLPicts
			while (match = GDLPict.regex.exec(document!.getText())) {
				this.pictList.push(new GDLPict(	document!.positionAt(match.index),
												document!.positionAt(match.index + match[0].length + 1),
												match));
			}
		}
	}

	getAllFunctions() : GDLFunction[] {
		//console.log("ParseXMLGDL.getAllFunctions");
		// flatten array and sort by line number
		let functions : GDLFunction[] = [];
		return functions.concat(...this.functionList)
						.sort((a : GDLFunction, b : GDLFunction) => a.range.start.line - b.range.start.line);
	}

	getAllSections() : GDLXMLSection[] {
		//console.log("ParseXMLGDL.getAllSections");
		// skip undefineds
		return (this.sectionList.filter((e) => (e !== undefined)) as GDLXMLSection[])
				.sort((a : GDLXMLSection, b : GDLXMLSection) => a.range.start.line - b.range.start.line);
	}

	private parseall(document? : vscode.TextDocument) {
		//console.log("ParseXMLGDL.parseall");

		this.parseScripts(document);
		this.parseFunctions(document);
		this.parseComments(document);
		this.parseGUIDs(document);
		this.parseCalledMacros(document);
		this.parsePicts(document);
	}

	private static createGDLXMLSection (start : vscode.Position, end : vscode.Position, tag : string, parser : ParseXMLGDL, document : vscode.TextDocument) : GDLXMLSection {
		let scriptType : ScriptType;

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