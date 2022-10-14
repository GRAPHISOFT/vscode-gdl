# GDL extension for Visual Studio Code

Development environment for Archicad 26 GDL language (XML, HSF and GDL source code): syntax coloring, snippets, code outline, quick reference.

# Usage

[You can get the extension from the marketplace.](https://marketplace.visualstudio.com/items?itemName=GRAPHISOFT.gdl)

.xml files will be automatically detected as GDL-XML, .gdl files as GDL-HSF language.
  * To switch between XML and GDL-XML syntax coloring, use context menu commands: "Switch language to GDL-XML" or "Switch language to XML"
  * Change unknown file types to GDL-XML or GDL-HSF by using the context menu.
  * Or just use VS Code's language selector, in the lower right of the status bar.

Use the themes _GDL Dark_ or _GDL Light_ for GDL-specific coloring
  * In Extensions View: select the GDL extension, click the Set Color Theme button, then choose Light or Dark.
  * See also the section on "Customizing Themes" below.

# Settings

1. Press Ctrl-Shift-P, type _User_, select _Preferences: Open user settings_
1. In the top search field, type _gdl_
    * Select Extensions / GDL Configuration
1. In the top search field, type _gdl-_
    * Click _Edit in setting.json_ to customize editor defaults for gdl-xml and gdl-hsf files
      * tabs/spaces
      * indentation size
      * line-end rulers


# Snippets

__any GDL command, global or request__ - expand required parameters

__sub__ - subroutine header and body

__hotspot__ or __hotspot2__ - length edit hotspot triplet

# VSCode standard language features for GDL-HSF

* Document symbols (Ctrl-Shift-O)
  * Subroutines, macro calls and special comments (between !=====... ) are shown
  * Type after @ to filter results
  * Type after @: to group results by type and filter them
  * This list is also visible and can be filtered in the Breadcrumbs bar and the Explorer/Outline view
  * The Breadcrumbs bar also shows which subroutine the cursor is in
* Workspace symbols (Ctrl-T) searches library parts in the opened folders by name or GUID
  * The search opens with the currently selected text
  * Type to filter results
  * Select to open the same script or xml that the current editor contains, or libpartdata.xml if unknown
  * If the workspace changed in a process outside VSCode, use the "Re-scan library parts in workspace folders" command to refresh the known library parts.
* When a folder of HSF files is opened, further features are available:
  * Show info about parameters when the mouse hovers on them
  * Show parameters with bold font
  * IntelliSense lists constants (ALL_CAPS) with their initialized values
  * IntelliSense lists parameters with their description, type, flags and default value. This list can be filtered by parameter type too.
  * These can all be toggled on/off together with Ctrl-Shift-Space
  * Follow macro calls with Ctrl-click
* Go to definitions/references, find all references of subroutines in same gdl-hsf file (Ctrl-click or F12, Shift-F12, Shift-Alt-F12)
* Show Call Hierarchy (Shift-Alt-H), Peek Call Hierarchy
  * Incoming or outgoing macro calls are shown, respecting the execution context of the edited scipt. Eg. all scripts are searched outgoing from a master script, but only master and 2d scripts are searched outgoing from a 2d script.
  * HSF library parts inside the workspace are searched. If the workspace changed in a process outside VSCode, use the "Re-scan library parts in workspace folders" command to refresh the known library parts.
  * Until VSCode API improvement the feature is only available if the cursor is on a word (not whitespace). If the cursor is on a macro call, that macro will be searched, otherwise the edited file will be searched. Outgoing calls' peek documents are faulty, but double-clicking an item opens the correct document.
* Automatic indentation on typing
  * Increase after lines with block-opening keywords (for, if, while, group, subroutine...)
  * Decrease after block-closing keywords (next, else, endif, endwhile, endgroup, return...)
  * Increase after first command continuation with , or \ (prevoius line ends without , or \ and this line ends with it)
  * Decrease after end of command (previous line ends with , or \ and this line ends without it)
  * Line ending comments are handled, comment-only lines and difficult syntax with : or multiline strings are not

# Script outline view

* Active for GDL-XML and GDL-HSF language in Explorer View
* Lists subroutines (also shown as red dots in the right-side overview)
* Lists special comments (can be toggled on/off)
* Lists macro calls (can be toggled on/off)
* Click listed element to show its code in the editor
* Use these extra features to help navigate among scripts contained in a single GDL-XML file:
  * Lists existing scripts
  * Scripts are color-coded alongside the line numbers (left side) and the overview (right side)
  * Scripts that are longer than one line are shown as having a "main" part
  * Lists main and migration GUIDs (with version and automigration)
  * Lists the called macros (with info about which scripts they are called from)
  * Lists embedded images
  * "Go to Cursor" icon scrolls the editor to the cursor
  * See additional navigation icons (explained in hover text), also available as commands for setting keyboard shortcuts

# Reference guide
If the cursor is on a known keyword, command, request, global variable or ac_ parameter: Use Ctrl-F1 (or context menu command) to bring up its reference in a VSCode tab. Double-word commands (eg. define fill) are recognized. For unknown words, the Index is displayed.

Use the Related... link at the bottom of the page to see similar commands: this link takes you to the chapter of the GDL Reference Guide that contains the keyword. Ctrl-C copies the selected text, Ctrl-F searches on the shown page.

# Syntax coloring

## Capabilities
* Highlight keywords, globals, fixed named parameters, add-on parameters, strings, request strings, autotext strings, subroutine labels
* Distinguish imperial numeric constants
* Deprecated keywords and globals
* Match for-next loop variables
* Detect parentheses, array dimension and range \[]() mixups
* Detect function calls with missing parentheses
* Highlight illegal variable names (e.g. 0var)
* Highlight innermost loop, macro call, group boundaries

## Extra capabilities with GDL themes
* Different styles for 2d/3d/parameter/properties/ui script-related commands
* Different styles for i/o, attribute, transformation commands
* Further distinctions possible, but not implemented in themes
* Different color for CONST and _temporary variables

## Known limitations
This is not a full parser: the underlying mechanism doesn't allow matching the end of a statement.
Some valid syntaxes won't be highlighted, and some invalid syntaxes will be highlighted (the trouble starts when commands are split into multiple lines).
* Can't detect uninitialized variables
* Can't detect undefined subroutines
* Fixed name variables and requests are colored as valid in strings with different delimiters '”
* Keywords in illegal position (e.g. in function parameters) are colored as valid
* Can't detect if enough function/command parameters are used
* Can't detect missing or unneeded commas
* Can't edit or view GSM files properly

## Customizing themes

1. Press Ctrl-Shift-P, type _settings json_, select _Preferences: Open Settings (JSON)_
1. Insert the following JSON object into the list (add it between the list elements):
    ```
      "editor.tokenColorCustomizations": {
            "[<GDL Dark|GDL Light>]": {
                  "textMateRules": [
                  ]
            }
      }
    ```
1. Open the theme source you want to customize: `\.vscode\extensions\graphisoft.gdl-<version>\themes\..._theme.json`
1. To customize certain colors:
    1. Open a GDL file and go to the color you want to change
    1. Use the VS Code command _Inspect TM Scopes_ to get the name of the scope at the cursor position
    1. Copy the JSON object from `..._theme.json` whose scope matches the `"textMateRules": []` array
    1. The file `\.vscode\extensions\gdl\misc\usedclasses.txt` shows the syntax tree
1. To customize all colors:
    * copy the JSON objects from `..._theme.json` whose names begin with GDL to the `"textMateRules": []` array
1. Modify/add `"foreground"` and/or `"fontstyle"` entries
1. Example:
    ```
        ...
        },
        "editor.tokenColorCustomizations": {
            "[GDL Dark]": {
                "textMateRules": [
                    {
                      "name": "GDL: Array index []",
                      "scope": "meta.gdl.arrayitem",
                      "settings": {
                        "foreground": "#d4d4d4"
                        }
                    },
                    {
                        "name": "GDL: Contents of ()",
                        "scope": "meta.gdl.grouping",
                        "settings": {
                            "foreground": "#d4d4d4"
                        }
                    }
                ]
            }
        },
        ...
    ```
1. Press Ctrl-S to apply changes to the user settings

# Release Notes

## 1.26.2
* Intellisense reads constants from edited file too, besides saved master script version

## 1.26.1
* `Show Call Hierarchy`, `Peek Call Hierarchy` context menu items list incoming or outgoing macro calls inside the workspace
* New command `Re-scan library parts in workspace folders` available in explorer context menu to reconcile file changes outside vscode
* Auto-indentation on typing enter and block-closing keywords
* Snippet bugfixing, added snippets for some missing recent global variables, angle editing hotspots

## 1.25.3
* Follow macro calls with Ctrl-click
* Reference guide
  * Find requests by name
  * Links are followed on long pages
  * Recognize double-word commands (DEFINE, SET)

## 1.25.2
* Go to definitions/references, find all references of subroutines in same gdl-hsf file (Ctrl-click or F12, Shift-F12, Shift-Alt-F12)
* Exclude commented macro calls from outline and symbols
* Workspace symbols (Ctrl-T) can find library parts by GUID
* Highlight innermost loop, macro call, group boundaries
* Automatic unindentation of loop end keywords and groups, automatic indentation of do and repeat blocks
* IntelliSense lists parameter types in second row

## 1.25.1
* Document symbols (Ctrl-Shift-O)
* Workspace symbols (Ctrl-T)
* IntelliSense lists parameters and constants (toggle with Ctrl-Shift-Space)
* Show parameter info in hover
* Show parameters with bold font
* Highlighting of built-in property ID strings
* Highlighting of deprecated global variables
* Reference guide updates

## 1.24.5
* Reference Guide fix for VSCode 1.56
* Reference Guide supports dark themes
* Reference Guide supports copying and searching by keyboard shortcut

## 1.24.4
* fix installation problem

## 1.24.3
* Reference Guide updates
* LABEL_ASSOC_ELEM_GEOMETRY, STAIR_BREAKMARK_GEOMETRY

## 1.24.2
## 1.24.1
* First non-preview version. If you have the preview version called pbaksa@graphisoft.com.gdl-xml, you must uninstall it: both versions cannot be used at the same time.
* Contains Archicad 24.0.0 INT R1 (build 3008) GDL features and GDL Reference Guide

# License

MIT License

https://github.com/GRAPHISOFT/vscode-gdl/blob/main/LICENSE.md
