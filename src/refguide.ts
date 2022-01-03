import * as vscode from 'vscode';

import { fileExists, GDLExtension, readFile } from "./extension";

import path = require('path');

type WordAt = {
    word: string;
    range : vscode.Range;
}

export class RefGuide {

    private refguideView? : vscode.WebviewPanel;
    private readonly refguideroot : string;
    private callbacks : vscode.Disposable[] = [];

    constructor(private extension: GDLExtension, root: string) {
        
        this.refguideroot = root;
        //console.log("RefGuide()", this.refguideroot);
        this.refguideView = vscode.window.createWebviewPanel(
            'refguide',
            'GDL reference guide',
            {   preserveFocus: true,
                viewColumn: vscode.ViewColumn.Beside
            },
            {
                enableFindWidget: true,
                enableScripts: true,
                enableCommandUris: true,
                localResourceRoots: [ vscode.Uri.file(root) ]
            });
            
        this.refguideView.webview.onDidReceiveMessage(this.onMessage, this, this.callbacks);
            
        // delete reference when user closes window
        this.refguideView.onDidDispose(() => this.onDispose(), this, this.extension.context.subscriptions);

    }

    async onMessage(message: any) {
        //console.log(message);
        if (message.href) {
            await this.showLink(message.href);
        }
    }

    static helpFor(document: vscode.TextDocument, position: vscode.Position) : string | undefined {
        // return word at cursor that might have help

        let wordAtCursor = RefGuide.wordAt(document, position) ?? { word: "", range: new vscode.Range(position, position)};
        
        let prevWord : string | undefined;
        let thisWord = (wordAtCursor.word.length > 0) ? wordAtCursor.word.toUpperCase() : undefined;
        let nextWord : string | undefined;

        let line = document.lineAt(wordAtCursor.range.start.line).text;
        // get string before, strip trailing whitespace
        let beforeWord = line.slice(0, wordAtCursor.range.start.character).trimEnd();
        let before = beforeWord.length - 1;
        if (beforeWord.length > 0) {
            prevWord = RefGuide.wordAt(document, wordAtCursor.range.start.with(undefined, before))?.word.toUpperCase();
        }

        // get string after, strip leading whitespace
        let afterWord = line.slice(wordAtCursor.range.end.character + 1).trimStart();
        let after = line.length - afterWord.length;
        if (afterWord.length > 0) {
            nextWord = RefGuide.wordAt(document, wordAtCursor.range.end.with(undefined, after))?.word.toUpperCase();
        }
        //console.log(prevWord, thisWord, nextWord);
    
        // special multiword identifiers with space between
        const double = new Set(["DEL", "SET", "DEFINE", "REF"]);
        // optional SET keyword
        const optional_set = new Set(["FILL", "LINE_TYPE", "STYLE", "MATERIAL", "BUILDING_MATERIAL"]);

        const thisOrNext = (thisWord ?? nextWord ?? "");
        const thisOrPrev = (thisWord ?? prevWord ?? "");

        if (prevWord && double.has(prevWord)) {
            return prevWord + thisOrNext;
        } else if (nextWord && double.has(thisOrPrev)) {
            return thisOrPrev + nextWord;
        } else if (optional_set.has(thisOrNext)) {
            return "SET" + thisWord;
        } else {
            return thisWord;
        }
    }

    static wordAt(document: vscode.TextDocument, position: vscode.Position) : WordAt | undefined {
        // return GDL word at position
        let wordAt = undefined;

        //do own matching regarding {2}
        let wordRange = document.getWordRangeAtPosition(position, /[_~a-z][_~0-9a-z]*(\{\d+\})?/i);
        
        if (wordRange) {
            let word = document.getText(wordRange);
            wordAt = { word: word, range: wordRange }
        }

        return wordAt;
    }

    private async refguideHtml(url: vscode.Uri) : Promise<string> {
        const refguideUri = this.refguideView!.webview.asWebviewUri(vscode.Uri.file(this.refguideroot))
        
        // this is merged with the existing head in the files
        const head = `<head>
<meta http-equiv="Content-Security-Policy" content="img-src ${this.refguideView!.webview.cspSource} 'unsafe-inline'; style-src ${this.refguideView!.webview.cspSource} self 'unsafe-inline'; script-src ${this.refguideView!.webview.cspSource} 'unsafe-inline';"/>
    <base href="${refguideUri}/"/>
    <script>
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', event => {
            let node = event && event.target;
            while (node) {
                if (node.tagName && node.tagName === 'A' && node.href) {
                    // send href to extension, local navigation is disabled in WebView
                    
                    vscode.postMessage({href: node.href});
                    node.href = "#";    // disable opening link in external browser
                    event.preventDefault();
                    return;
                }
                node = node.parentNode;
            }
        }, true);
        window.addEventListener('message', event => {
            if (event.data.scroll_id) {
                document.getElementById(event.data.scroll_id).scrollIntoView();
            } else if (event.data.scroll_top) {
                document.getElementsByTagName('body')[0].scrollIntoView();
            }
        }, true);
    </script>
</head>`;

        const html = await readFile(vscode.Uri.file(url.fsPath));   // convert to file uri
        return head + html;
    }

    private static getLinkID(word: string) : string {
        // transform tube{2} to TUBE2
        const id = word.replace(/{(\d+)\}$/, "$1").toUpperCase();
        //console.log("RefGuide.getLinkID", id);
        return id;
    }

    private getKeywordFilename(id: string) : string {
        // make filename
        return path.join(this.refguideroot, 'reference', id + ".html")
    }

    private getRequestFilename(id: string) : string {
        // make filename
        return path.join(this.refguideroot, 'reference', 'requests', id + ".html")
    }


    private getIndexFilename() : string {
        return path.join(this.refguideroot, "002.017.html")
    }

    private async getReferenceToShow(word: string | undefined, allowIndexRedirect: boolean) : Promise<string | undefined> {

        let found = false;
        let refguidefile : string | undefined;

        if (word != undefined) {
            // transform tube{2} to TUBE2
            var id = RefGuide.getLinkID(word);

            // make filename & check if exists
            // is it a keyword?
            refguidefile = this.getKeywordFilename(id);
            found = await fileExists(vscode.Uri.file(refguidefile));
            // is it a request?
            if (!found) {
                refguidefile = this.getRequestFilename(id);
                found = await fileExists(vscode.Uri.file(refguidefile));
            }
        }

        if (!found && allowIndexRedirect) { // redirect to index 
            if (word) {                     // shown unknown keyword (unless undefined)
                vscode.window.showInformationMessage(word + " not found in reference");
            }
            return this.getIndexFilename();
        } else {
            return (found ? refguidefile : undefined);
        }
    }

    private async showLink(href : string) {
        const uri = vscode.Uri.parse(href);
        this.refguideView!.webview.html = await this.refguideHtml(uri);
        this.refguideView!.webview.postMessage({scroll_id: uri.fragment});
    }

    async showHelp(word? : string) {
        if (this.refguideView) {
            const refguidefile = await this.getReferenceToShow(word, true);

            // load file
            const furi = vscode.Uri.file(refguidefile ?? "");   // getReferenceToShow didn't return undefined 
            // debug: open in external browser
            //vscode.env.openExternal(furi);
            this.refguideView.webview.html = await this.refguideHtml(furi);
            this.refguideView!.webview.postMessage({scroll_top: true});

            this.refguideView.reveal(vscode.ViewColumn.Beside);
        }
    }

    dispose() {
        this.refguideView?.dispose();
    }

    private onDispose() {
        for (const c of this.callbacks) {
            c.dispose();
        }
        this.refguideView = undefined;
    }

    opened() : boolean {
        return (this.refguideView !== undefined);
    }

}