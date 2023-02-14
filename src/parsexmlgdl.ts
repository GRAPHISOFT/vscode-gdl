import * as vscode from 'vscode';

export enum ScriptType { ROOT = 0, D, DD, DDD, UI, VL, PR, FWM, BWM, MIGTABLE, PARAMSECTION, CALLEDMACROS, GDLPICT }
export const scriptAbbrev = [ "FILE", "MASTER", "2D", "3D", "UI", "PARAM", "PROP", "FWM", "BWM", "", "", "", "" ];
export const scriptFile = [ "", "1d", "2d", "3d", "ui", "vl", "pr", "fwm", "bwm", "", "", "", "" ];
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

export const ScriptsExceptMaster = [ScriptType.DD,
									ScriptType.DDD,
									ScriptType.UI,
									ScriptType.VL,
									ScriptType.PR,
									ScriptType.FWM,
									ScriptType.BWM];

export const Scripts = [ScriptType.D, ...ScriptsExceptMaster];

export function getRelatedScripts(scriptType : ScriptType) : ScriptType[] {
	// returns scripts related to scriptType
	if (scriptType === ScriptType.D) {
		// master script relates to all scripts
		return Scripts;
	} else {
		// others relate to master and self
		return [ScriptType.D, scriptType];
	}
}

// general interface representing a thing we want to catch
export abstract class GDLToken {
	public static readonly regex : RegExp;											// regex string needed to catch all
	public range(document : vscode.TextDocument) {									// range in editor
		return new vscode.Range(document.positionAt(this.start),
								document.positionAt(this.end));
	}

	constructor(public readonly start : number,
				public readonly end : number,
				public readonly name : string) {}
}

// function definitions
export class GDLFunction extends GDLToken {
	public static readonly regex = /(?<=^\s*?)(([0-9]+)|((["'`´“”’‘])([^"'`´“”’‘]+)\4))\s*:/mg;

	constructor(start : number, end : number, name : string) {
		//console.log("GDLFunction()", name);
		super(start, end, name);
	}
}

// special comments
export class GDLComment extends GDLToken {
	//public static readonly regex = /^\s*!\s*---\s*([^-]+?)---.*$/mig;		// ! --- name ---

	public static readonly regex = /^(\s*!\s*=+)\r?\n\s*!\s*(.+?)\r?\n\1/mig;	// ! ============
																				// ! name
																				// ! ============

	constructor(start : number, end : number, name : string) {
		//console.log("GDLComment()", name);
		super(start, end, name);
	}
}

// called macros
export class GDLCalledMacro extends GDLToken {
	public static readonly regex = /^\s*<MName><!\[CDATA\["([\D\d]*?)"\]\]><\/MName>/mig;

	public readonly fromScripts : boolean[];

	constructor(start : number, end : number, name : string, fromScripts : boolean[]) {
		//console.log("GDLCalledMacro()", content);
		super(start, end, name);
		this.fromScripts = fromScripts;
	}
}

// macro calls
export class GDLMacroCall extends GDLToken {
	public static readonly regex = /(?<!!.*)\bcall\s*"(.*?)"(\s*(,\r?\n\s*)?(parameters\s*all))?/mig;

	// TODO LIBRARYGLOBALS?

	public readonly all : boolean;
	private readonly innerstart : number;
	private readonly innerend : number;

	public namerange(document : vscode.TextDocument) {
		return new vscode.Range(document.positionAt(this.innerstart),
								document.positionAt(this.innerend));
	}

	constructor(start : number, end : number, match : RegExpExecArray) {
		//console.log("GDLMacroCall()", content);
		super(start, end, match[1]);
		this.innerstart = start + 6 + match[0].substring(6).search(match[1]);
		this.innerend = this.innerstart + match[1].length;
		this.all = (match.length >= 4 && match[4] !== undefined);	// parameters all
	}
}

// main GUID
export class GDLMainGUID extends GDLToken {
	public static readonly regex = /^<Symbol.*?MainGUID="([-0-9A-Z]*)".*?>$/mig;

	constructor(start : number, end : number, guid : string) {
		super(start, end, guid);
	}
}

// migration table GUIDs
export class GDLMigrationGUID extends GDLToken {
	public static readonly regex = /^\s*<(MigrationTableElement>)([\D\d]*?)<\/\1/mig;

	public readonly version : number;
	public readonly automigration : boolean;

	constructor(start : number, end : number, content : string) {
		//console.log("GDLMigrationGUID()", content);

		//defaults if not found
		let GUID = "00000000-0000-0000-0000-000000000000";
		let version = -1;
		let automigration = false;

		let match : RegExpExecArray | null;

		const subregex = /^\s*<(MainGUID|Version|AutoMigration)>([\D\d]*?)<\/\1>/mig;
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
	public static readonly newlineregex = /[\n\r]/;

	public readonly multiline : boolean;

	constructor(start : number, end : number,
				public readonly innerstart : number, public readonly innerend : number,
				public readonly scriptType : ScriptType,	// integer ID of tag
				protected readonly parser : ParseXMLGDL,	// needed for other elements' lists
				subtext : string) {							// inner part
		super(start, end, scriptName[scriptType]);
		this.multiline = GDLXMLSection.newlineregex.test(subtext);

	}

	// range in editor
	public innerrange(document : vscode.TextDocument) {
		return new vscode.Range(document.positionAt(this.innerstart),
								document.positionAt(this.innerend));
	}

	public abstract hasChildren() : boolean;		// can be opened down when has children
}

// whole file
export class GDLFile extends GDLXMLSection {
	constructor(start : number, parser : ParseXMLGDL, text : string) {
		const end = start + text.length;
		super(start, end, start, end, ScriptType.ROOT, parser, text);
	}

	public hasChildren() : boolean {
		return false;
	}
}

// GDL scripts
export class GDLScript extends GDLXMLSection {
	public static readonly innerregex = /(?<=^.*?<\!\[CDATA\[).*(?=\]\]>[\n\r]*<\/Script_)/s;

	constructor(start : number, scriptType : ScriptType, parser : ParseXMLGDL, text : string) {
		const match = GDLScript.innerregex.exec(text);

		let innerstart : number;
		let subtext : string;
		if (match) {
			innerstart = start + match.index;
			subtext = match[0];
		} else {
			innerstart = start;
			subtext = text;
		}
		super(start, start + text.length,
			  innerstart, innerstart + subtext.length,
			  scriptType, parser, subtext);
	}

	public hasChildren() : boolean {
		const functionList = this.parser.getFunctionList(this.scriptType);
		return  (functionList.length > 0 ||		//has funtions
				 this.multiline);				//longer than one line: has main function
	}
}

// non-script XML sections
export class GDLSection extends GDLXMLSection {
	public static readonly innerregex = /(?<=<(ParamSection|MigrationTable|CalledMacros)[^>]*>[\n\r]+)(.*?)(?=<\/\1>)/sg;

	constructor(start : number, scriptType : ScriptType, parser : ParseXMLGDL, text : string) {
		const end = start + text.length;
		let subtext = text.substring(start, end + 1);
		const match = GDLSection.innerregex.exec(subtext);

		let innerstart : number;
		if (match?.length) {
			subtext = match[0];		// what if zero-length match?
			innerstart = start + match.index;
		} else {
			innerstart = start;
		}
		super(start, end, innerstart, innerstart + subtext.length, scriptType, parser, subtext);
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
		super(0, 0, scriptName[ScriptType.GDLPICT]);
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

	constructor(start : number, end : number, match : RegExpExecArray) {
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

	constructor(text? : string,
				functions : boolean = true,
				comments : boolean = true,
				guids : boolean = true,
				calledmacros : boolean = true,
				picts : boolean = true) {
		//console.log("ParseXMLGDL()");

		// this needs to be first to know script boundaries
		this.parseScripts(text);

		this.parseFunctions(functions ? text : undefined);
		this.parseComments(comments ? text : undefined);
		this.parseGUIDs(guids ? text : undefined);
		this.parseCalledMacros(calledmacros ? text : undefined);
		this.parsePicts(picts ? text : undefined);
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

	private parseScripts(text? : string) {
		//console.log("ParseXMLGDL.parseScripts");
		let match : RegExpExecArray | null;
		this.sectionList = [];

		if (text) {
			while (match = GDLXMLSection.regex.exec(text)) {
				if (match.length > 0) { // match[1] exists
					const script = ParseXMLGDL.createGDLXMLSection(	match.index,
																	match[1], this, match[0]);

					this.sectionList[script.scriptType] = script;
				}
			}

			// whole file
			this.sectionList[ScriptType.ROOT] = ParseXMLGDL.createGDLXMLSection(0,
																				"", this, text);
		}
	}

	private scriptOfPos(start : number) : ScriptType {
		let scriptType = ScriptType.ROOT;

		this.sectionList.some(script => {
			if (script !== undefined && script.scriptType !== ScriptType.ROOT && (script.start <= start) && (script.end >= start)) {
				scriptType = script.scriptType;
				return true;
			}
			return false;
		});

		return scriptType;
	}

	private parseFunctions(text? : string) {
		//console.log("ParseXMLGDL.parseFunctions");
		let match : RegExpExecArray | null, matchedName : string;
		this.functionList = [];

		for (let i = ScriptType.ROOT; i <= ScriptType.BWM; i++) {
			this.functionList.push([]);
		}
		
		if (text) {
			while (match = GDLFunction.regex.exec(text)) {
				if (match.length > 1) { // match[2] exists
					if (match[2]) {
						matchedName = match[2]; // number
					} else {
						matchedName = match[3]; // name
					}
					const start = match.index;
					const end = match.index + matchedName.length + 1;
					const scriptType = this.scriptOfPos(start);
					this.functionList[scriptType].push(new GDLFunction(	start,
																		end,
																		matchedName));
				}
			}
		}
	}

	private parseComments(text? : string) {
		//console.log("ParseXMLGDL.parseComments");
		let match : RegExpExecArray | null;
		this.commentList = [];

		for (let i = ScriptType.ROOT; i <= ScriptType.BWM; i++) {
			this.commentList.push([]);
		}

		if (text) {
			while (match = GDLComment.regex.exec(text)) {
				if (match.length > 1) { // match[2] exists
					const start = match.index;
					const end = match.index + match[0].length + 1; 
					const scriptType = this.scriptOfPos(start);
					this.commentList[scriptType].push(new GDLComment(	start,
																		end,
																		match[2]));
				}
			}
		}
	}

	private parseGUIDs(text? : string) {
		//console.log("ParseXMLGDL.parseGUIDs");
		let match : RegExpExecArray | null;
		this.GUIDList = [];

		if (text) {
			// get main GUID
			this.mainGUID = undefined;
			while (match = GDLMainGUID.regex.exec(text)) {
				if (match.length > 0) { // match[1] exists
					this.mainGUID = new GDLMainGUID(match.index,
													match.index + match[0].length + 1,
													match[1]);
				}
			}

			// get migration GUIDs
			while (match = GDLMigrationGUID.regex.exec(text)) {
				if (match.length > 1) { // match[2] exists
					this.GUIDList.push(new GDLMigrationGUID(match.index,
															match.index + match[0].length + 1,
															match[2]));
				}
			}
		}
	}

	private parseCalledMacros(text? : string) {
		//console.log("ParseXMLGDL.parseCalledMacros");
		let match : RegExpExecArray | null;
		this.macroCallList = [];
		this.calledMacroList = [];

		for (let i = ScriptType.ROOT; i <= ScriptType.BWM; i++) {
			this.macroCallList.push([]);
		}

		interface MapMacro { [name: string] : boolean[]; }
		const macroCallListMap : MapMacro = {};

		if (text) {
			// parse macro calls
			while (match = GDLMacroCall.regex.exec(text)) {
				if (match.length > 0) {
					const start = match.index;
					const end = match.index + match[0].length + 1;
					const scriptType = this.scriptOfPos(start);
					const macroCall = new GDLMacroCall(	start,
														end,
														match);

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
					const start = match.index;
					const end = match.index + match[0].length + 1;
					this.calledMacroList.push(new GDLCalledMacro(	start,
																	end,
																	match[1],
																	calledFromScripts));
				}
			}
		}
	}

	private parsePicts(text? : string) {
		//console.log("ParseXMLGDL.parsePicts");
		let match : RegExpExecArray | null;
		this.pictList = [];

		if (text) {
			// store GDLPicts
			while (match = GDLPict.regex.exec(text)) {
				this.pictList.push(new GDLPict(	match.index,
												match.index + match[0].length + 1,
												match));
			}
		}
	}

	getAllFunctions() : GDLFunction[] {
		//console.log("ParseXMLGDL.getAllFunctions");
		// flatten array and sort by line number
		const functions : GDLFunction[] = [];
		return functions.concat(...this.functionList)
						.sort((a : GDLFunction, b : GDLFunction) => a.start - b.start);
	}

	getAllSections() : GDLXMLSection[] {
		//console.log("ParseXMLGDL.getAllSections");
		// skip undefineds
		return this.sectionList
				.filter((e) : e is GDLXMLSection => (e !== undefined))
				.sort((a : GDLXMLSection, b : GDLXMLSection) => a.start - b.start);
	}

	private static createGDLXMLSection (start : number, tag : string, parser : ParseXMLGDL, text: string) : GDLXMLSection {
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
				return new GDLScript(start, scriptType, parser, text);

			case ScriptType.MIGTABLE:
			case ScriptType.PARAMSECTION:
			case ScriptType.CALLEDMACROS:
				return new GDLSection(start, scriptType, parser, text);

			case ScriptType.ROOT:
			default:
				return new GDLFile(start, parser, text);
		}
	}
}