
import * as vscode from 'vscode';

import * as Parser from './parsexmlgdl';
import { HSFScriptType, HSFNameOfScript, fileExists, readFile, GDLExtension } from './extension';
import { WSSymbols } from './wssymbols';

import path = require('path');

type callData = {
    from: string,
    to: vscode.CallHierarchyIncomingCall
};

export class CallTree implements vscode.CallHierarchyProvider {
    
    // store already searched files' calls
    private callsCache = new Map<string, Parser.GDLLibpartReference[]>();

    private static scriptTypeOfMode = new Map<string, Parser.ScriptType>();
    static scriptOfMode(mode : string) {
        return CallTree.scriptTypeOfMode.get(mode) ?? Parser.ScriptType.ROOT;
    }

    constructor(context : vscode.ExtensionContext, private wsSymbols : WSSymbols) {
        const watcher = vscode.workspace.createFileSystemWatcher("**/*.gdl", true); // don't watch new files
        watcher.onDidChange(e => this.invalidateCache(e));
        watcher.onDidDelete(e => this.invalidateCache(e));
        context.subscriptions.push(watcher);

        for (const script of Parser.Scripts) {
            CallTree.scriptTypeOfMode.set(Parser.scriptAbbrev[script], script);
        }
    }

    private invalidateCache(changed : vscode.Uri) {
        // delete the given uri's data from the cache
        this.callsCache.delete(changed.path);
    }

    async inWorkspaceCalls(document : vscode.TextDocument, name : string, cancel : vscode.CancellationToken) : Promise<vscode.SymbolInformation[]> {
        // search name in wsSymbols and return Uri
        const callname_lc = name.toLowerCase();
        const inWorkspaceCall = (await this.wsSymbols.provideWorkspaceSymbols_withFallback(document, false, callname_lc, false, cancel))
            // provided symbols are a loose filename match, have to be exact
            .filter(t => (callname_lc === t.name.substring(1, t.name.length - 1).toLowerCase()));
        return inWorkspaceCall;
    }

    static getOutgoingMode(uri : vscode.Uri, rootmode? : Parser.ScriptType) {
        const scriptType = HSFScriptType(uri);
        const targetmode = scriptType ?? Parser.ScriptType.ROOT;
        return rootmode ?? targetmode;
    }

    static getIncomingMode(uri : vscode.Uri, searchMode : Parser.ScriptType) {
        const scriptType = HSFScriptType(uri) ?? Parser.ScriptType.ROOT;

        if (searchMode === Parser.ScriptType.D && scriptType !== Parser.ScriptType.D) {
            // tighten master mode if called from non-master script
            return scriptType;
        } else {
            return searchMode;
        }
    }

    static async scriptOf(uri : vscode.Uri, scriptType : Parser.ScriptType) {
        const newpath = path.join(uri.fsPath, "..", `${Parser.scriptFile[scriptType]}.gdl`);
        const newuri = uri.with({ path: newpath });
        if (await fileExists(newuri)) {
            return newuri;
        }
        else {
            return undefined;
        }
    }

    static createIncomingDocumentItem(document : vscode.TextDocument, referrer : Parser.GDLLibpartReference, searchMode : Parser.ScriptType) {
        // don't show line in result, an item can have multiple ranges
        const hint = (referrer instanceof Parser.GDLMacroCall) ? GDLExtension.libpartReferenceDetail(referrer) : "";
        return new vscode.CallHierarchyItem(vscode.SymbolKind.File, `${HSFNameOfScript(document.uri)}`, `${CallTree.formatContext(searchMode)} ${referrer.keyword()} "${referrer.name}"${hint} ${CallTree.formatScriptReference(document.uri)}`, document.uri, referrer.range(document), referrer.namerange(document));
    }

    static formatScriptReference(uri : vscode.Uri, range? : vscode.Range) {
        if (range === undefined) {
            return `- ${path.basename(uri.fsPath, ".gdl")}`;
        } else {
            return `- ${path.basename(uri.fsPath, ".gdl")} : ${range.start.line + 1}`;
        }
    }

    static modeRegex = /(?<=^\[).*?(?= context\])/;
    static modeRegexFull = /^\[.*? context\]/;

    static formatContext(mode : Parser.ScriptType) {
        return `[${Parser.scriptAbbrev[mode]} context]`;
    }

    static getContext(text? : string) {
        const match = text?.match(CallTree.modeRegex) ?? [""];
        return CallTree.scriptOfMode(match[0]);
    }

    static createReferencedItem(document : vscode.TextDocument, reference : Parser.GDLLibpartReference, direction : string, searchMode? : Parser.ScriptType) {
        const range = reference.range(document);
        const newMode = CallTree.getOutgoingMode(document.uri, searchMode);
        const hint = (reference instanceof Parser.GDLMacroCall) ? GDLExtension.libpartReferenceDetail(reference) : "";
        return new vscode.CallHierarchyItem(vscode.SymbolKind.Object, `${reference.keyword()} "${reference.name}"${hint}`, `${CallTree.formatContext(newMode)} ${direction}${HSFNameOfScript(document.uri)} ${CallTree.formatScriptReference(document.uri, range)}`, document.uri, range, reference.namerange(document));
    }

    static createDocumentItem(uri : vscode.Uri, direction : string, searchMode? : Parser.ScriptType) {
        const newMode = CallTree.getOutgoingMode(uri, searchMode);
        return new vscode.CallHierarchyItem(vscode.SymbolKind.File, `all calls`, `${CallTree.formatContext(newMode)} ${direction}${HSFNameOfScript(uri)} ${CallTree.formatScriptReference(uri)}`, uri, GDLExtension.zero_range, GDLExtension.zero_range);
    }

    static copyOutgoingItem(item : vscode.CallHierarchyItem, searchMode : Parser.ScriptType) {
        const newMode = CallTree.formatContext(searchMode);
        const newDetail = item.detail?.replace(CallTree.modeRegexFull, `${newMode} from`) ?? "";
        return new vscode.CallHierarchyItem(item.kind, item.name, newDetail, item.uri, item.range, item.selectionRange);
    }

    static createOutgoingReference(document : vscode.TextDocument, reference : Parser.GDLLibpartReference, searchMode? : Parser.ScriptType) {
        const item = CallTree.createReferencedItem(document, reference, "from ", searchMode);
        item.detail += GDLExtension.libpartReferenceDetail(reference);
        return new vscode.CallHierarchyOutgoingCall(item, [item.selectionRange]);
    }

    static createOutgoingScript(uri : vscode.Uri, scriptType : Parser.ScriptType) {
        const item = CallTree.createDocumentItem(uri, "from ", scriptType);
        return new vscode.CallHierarchyOutgoingCall(item, [item.selectionRange]);
    }

    prepareCallHierarchy(document : vscode.TextDocument, position : vscode.Position, _cancel : vscode.CancellationToken) : vscode.CallHierarchyItem {
        //console.log("prepare", HSFNameOfScript(document.uri), HSFScriptType(document.uri), position.line);
        const parser = new Parser.ParseXMLGDL(document.getText(), false, false, false, true, false);    // read possibly unsaved document
        const callsymbol = parser.getLibpartReferenceList(Parser.ScriptType.ROOT).find(m => m.range(document).contains(position));
        if (callsymbol) { // selected macro
            return CallTree.createReferencedItem(document, callsymbol, "");
        }
        else { // this script
            return CallTree.createDocumentItem(document.uri, "");
        }
    }

    async provideCallHierarchyIncomingCalls(item : vscode.CallHierarchyItem, cancel : vscode.CancellationToken) : Promise<vscode.CallHierarchyIncomingCall[]> {
        //console.log("incoming", item.name, item.uri.fsPath);
        return new Promise(async (resolve, reject) => {
            cancel.onCancellationRequested(reject);
            resolve(await this.getCallHierarchyIncomingCalls(item, cancel));
        });
    }

    async provideCallHierarchyOutgoingCalls(item : vscode.CallHierarchyItem, cancel : vscode.CancellationToken) : Promise<vscode.CallHierarchyOutgoingCall[]> {
        //console.log("outgoing", item.name, HSFNameOfScript(item.uri), HSFScriptType(item.uri));
        return new Promise((resolve, reject) => {
            cancel.onCancellationRequested(reject);
            resolve(this.getCallHierarchyOutgoingCalls(item, cancel));
        });
    }

    async getUrisToSearch(item : vscode.CallHierarchyItem, searchScripts : Parser.ScriptType[], cancel : vscode.CancellationToken) : Promise<vscode.Uri[]>{
        let uris : Array<vscode.Uri>;

        if (item.kind !== vscode.SymbolKind.File) {
            const document = await vscode.workspace.openTextDocument(item.uri);
            const targetName = document.getText(item.selectionRange);
            // all possibly duplicate libparts
            uris = (await this.inWorkspaceCalls(document, targetName, cancel)).map(symbol => symbol.location.uri);
        } else { // all calls from file, target is item.uri with mode
            uris = [item.uri];
        }

        // try different scripts of uris and filter undefined
        let result : Array<vscode.Uri> = [];
        for (const uri of uris) {
            for (const script of searchScripts) {
                const target = await CallTree.scriptOf(uri, script);
                if (target !== undefined) {
                    result.push(target);
                }
            }
        }
        return result;
    }

    async getCallHierarchyOutgoingCalls(item : vscode.CallHierarchyItem, cancel : vscode.CancellationToken) : Promise<vscode.CallHierarchyOutgoingCall[]> {
        const searchMode = CallTree.getContext(item.detail);
        const searchScripts = Parser.getRelatedScripts(searchMode);
        let calls : Promise<vscode.CallHierarchyOutgoingCall[]>[];
        if (searchMode === Parser.ScriptType.D) {
            // add all subscripts if looking at master script
            if (item.kind === vscode.SymbolKind.File) {
                calls = Parser.ScriptsExceptMaster.map(async (script) => [CallTree.createOutgoingScript(item.uri, script)]);
            }
            else { // macro
                calls = Parser.ScriptsExceptMaster.map(async (script) => {
                        const scriptItem = CallTree.copyOutgoingItem(item, script);
                        return [new vscode.CallHierarchyOutgoingCall(scriptItem, [scriptItem.selectionRange])];
                    });
            }
        }
        else {
            const uris = await this.getUrisToSearch(item, searchScripts, cancel);
            calls = uris.map(async (target) => {
                const document = await vscode.workspace.openTextDocument(target);
                const parser = new Parser.ParseXMLGDL(document.getText(), false, false, false, true, false);
                const references = parser.getLibpartReferenceList(Parser.ScriptType.ROOT);
                return references.map(reference => CallTree.createOutgoingReference(document, reference, searchMode));
            });
        }
        return (await Promise.allSettled(calls))
            .flatMap(result => result.status === "fulfilled" ? result.value : undefined)
            .filter((e) : e is vscode.CallHierarchyOutgoingCall => (e !== undefined));
    }

    async getCallHierarchyIncomingCalls(item : vscode.CallHierarchyItem, cancel : vscode.CancellationToken) {

        // macro name to search for
        let targetName : string;
        if (item.kind === vscode.SymbolKind.File) {
            targetName = HSFNameOfScript(item.uri).toLowerCase();
        }
        else { // macro, toplevel
            const document = vscode.workspace.openTextDocument(item.uri);
            targetName = (await document).getText(item.selectionRange).toLowerCase();
        }
        
        const searchMode = CallTree.getIncomingMode(item.uri, CallTree.getContext(item.detail));
        const searchScripts = Parser.getRelatedScripts(searchMode);

        const libparts = await this.wsSymbols.values(cancel);
        const calldata = libparts.map(async (libpart) => {
            let results : callData[] = [];

            const searchUris = searchScripts.map(async (script) => libpart.scriptUri(script));  // null if script doesn't exist
            for await (const scriptUri of searchUris) {
                if (scriptUri?.fsPath.endsWith(".gdl")) {
                    const references = (await this.getReferenceList(scriptUri, cancel))
                        .filter(reference => (reference.name.toLowerCase() === targetName));

                    if (references.length > 0) {
                        // add one item with all found ranges
                        let searchDocument = await vscode.workspace.openTextDocument(scriptUri);
                        const ranges = references.map(macrocall => macrocall.range(searchDocument));
                        const targetItem = CallTree.createIncomingDocumentItem(searchDocument, references[0], searchMode);

                        results.push({
                            from: libpart.name,
                            to: new vscode.CallHierarchyIncomingCall(targetItem, ranges)
                        });
                    }
                }
            }

            return results;
        });

        return (await Promise.allSettled(calldata))
            .flatMap(result => result.status === "fulfilled" ? result.value : undefined)
            .filter((e) : e is callData => (e !== undefined))
            .sort((a, b) => a.from.localeCompare(b.from, "en", { sensitivity: "accent", numeric: true }))
            .map(e => e.to);
    }

    private async getReferenceList(scriptUri : vscode.Uri, cancel : vscode.CancellationToken) : Promise<Parser.GDLLibpartReference[]> {
        const cachedValue = this.callsCache.get(scriptUri.path);

        if (cachedValue) {
            return cachedValue;
        } else {
            // can't use many concurrent OpenTextDocument's will be rejected, have to read file directly
            const parser = new Parser.ParseXMLGDL(await readFile(scriptUri, true, cancel), false, false, false, true, false);
            const result = parser.getLibpartReferenceList(Parser.ScriptType.ROOT);
            this.callsCache.set(scriptUri.path, result);
            return result;
        }
    }
}
