import * as vscode from 'vscode';

import { fileExists, GDLExtension, readFile } from "./extension";

import path = require('path');


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
        let word = undefined;

        const wordRange = document.getWordRangeAtPosition(position);
        //do own matching regarding {2}
        if (wordRange) {
            word = document.getText(wordRange);
            const line = document.lineAt(wordRange.start.line).text;

            // is it something{n}?
            if (word.match(/^\d+$/)) {
                // cursor at {n}, find prefix
                const beforeword = line.slice(0, wordRange.start.character);
                const prefix = beforeword.match(/\w+\{$/);
                if (prefix && prefix.length > 0) {
                    word = prefix[0] + word + "}";
                }
            } else {
                // cursor at something, find version
                const afterword = line.slice(wordRange.end.character);
                const version = afterword.match(/^\{\d+\}/);
                if (version && version.length > 0) {
                    word = word + version[0];
                }
            }
        }

        return word;
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

    private getReferenceFilename(word: string) : string {

        // transform tube{2} to TUBE2
        const id = RefGuide.getLinkID(word);
        
        // make filename
        return path.join(this.refguideroot, 'reference', id + ".html")
    }

    private getIndexFilename() : string {
        return path.join(this.refguideroot, "002.017.html")
    }

    private async getReferenceToShow(word: string | undefined, allowIndexRedirect: boolean) : Promise<string | undefined> {

        let found = false;
        let refguidefile : string | undefined;

        if (word != undefined) {
            // make filename
            refguidefile = this.getReferenceFilename(word);
            // check if file exist
            found = await fileExists(vscode.Uri.file(refguidefile));
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
    }

    async showHelp(word? : string) {
        if (this.refguideView) {
            const refguidefile = await this.getReferenceToShow(word, true);

            // load file
            const furi = vscode.Uri.file(refguidefile ?? "");   // getReferenceToShow didn't return undefined 
            // debug: open in external browser
            //vscode.env.openExternal(furi);
            this.refguideView.webview.html = await this.refguideHtml(furi);

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