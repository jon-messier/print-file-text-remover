#target illustrator
/*
    LiveTextBatch.jsx  —  companion to the Print File Text Remover web page

    Builds the live back name + number and the front number in every print file of a
    folder that came out of the Text Remover, with no dialog per file, then saves each
    file as .ai next to its PDF.

    The settings and positions for every file were worked out on the web page and are
    stored in _live_text_manifest.json (same folder as this script in the download).
    The text itself is built by the SAME code as LiveTextBuilder v12 (copied unchanged
    below): one text object per line, Fill -> Stroke -> Fill appearance, SquadLocker
    stock spot swatches. The document colour mode is NOT changed here: run
    SwitchOpenDocsToCMYK.jsx on the opened .ai files afterwards.

    HOW TO RUN (macOS or Windows)
      1. Unzip the download from the Text Remover.
      2. In Illustrator: File > Scripts > Other Script... and pick this file.
      3. Choose the unzipped folder (the one containing _live_text_manifest.json).
    A log (LiveTextBatch_log.txt) is written to that folder.

    Generated from LiveTextBuilder_v12.jsx — v12 functions are marked "v12".
*/

(function () {

    var TAG = "LTB9:";
    var PT_PER_IN = 72;
    var MAX_FONT_PT = 1296;
    var MANIFEST_NAME = "_live_text_manifest.json";
    var LOG_FILE = null;

    function log(msg) {
        if (!LOG_FILE) return;
        try { LOG_FILE.open("a"); LOG_FILE.writeln(msg); LOG_FILE.close(); } catch (e) {}
    }

    // ------------------------------------------------------------------ helpers (v12)
//@@HELPERS@@

    // ------------------------------------------------------------------ stock swatches (v12)
//@@LIBRARY@@

    // ------------------------------------------------------------------ pick the folder
    function findManifest(folder) {
        var f = new File(folder.fsName + "/" + MANIFEST_NAME);
        if (f.exists) return f;
        var subs = folder.getFiles(function (x) { return x instanceof Folder; });
        for (var i = 0; i < subs.length; i++) {
            var g = new File(subs[i].fsName + "/" + MANIFEST_NAME);
            if (g.exists) return g;
        }
        return null;
    }

    var picked = Folder.selectDialog("Choose the folder you unzipped from the Text Remover");
    if (!picked) return;
    var mfFile = findManifest(picked);
    if (!mfFile) { alert("No " + MANIFEST_NAME + " found in that folder.\n\nChoose the folder you unzipped from the Text Remover download."); return; }
    var ROOT = mfFile.parent;
    var manifest;
    try {
        mfFile.encoding = "UTF-8"; mfFile.open("r"); var mfText = mfFile.read(); mfFile.close();
        manifest = eval("(" + mfText + ")");
    } catch (e) { alert("Couldn't read " + MANIFEST_NAME + ": " + e.message); return; }
    var ENTRIES = manifest.files || [];
    if (!ENTRIES.length) { alert("The manifest lists no files to build."); return; }

    // ------------------------------------------------------------------ options dialog (once)
    var dlg = new Window("dialog", "Live Text Batch");
    dlg.orientation = "column"; dlg.alignChildren = ["fill", "top"];
    dlg.add("statictext", undefined, ENTRIES.length + " print file" + (ENTRIES.length === 1 ? "" : "s") + " in " + decodeURI(ROOT.name) + ".");
    dlg.add("statictext", undefined, "Each one gets its live text and is saved as .ai next to its PDF.");
    var cbSkip = dlg.add("checkbox", undefined, "Skip files that already have an .ai");
    cbSkip.value = true;
    var cbDelete = dlg.add("checkbox", undefined, "Delete each PDF after its .ai is saved");
    cbDelete.value = false;
    dlg.add("statictext", undefined, "Files are saved in their current color mode. Afterwards, open the .ai files");
    dlg.add("statictext", undefined, "and run SwitchOpenDocsToCMYK.jsx to switch them to CMYK and save.");
    var bRow = dlg.add("group"); bRow.alignment = "right";
    bRow.add("button", undefined, "Cancel", { name: "cancel" });
    bRow.add("button", undefined, "Start", { name: "ok" });
    if (dlg.show() !== 1) return;
    var SKIP_EXISTING = cbSkip.value, DELETE_PDF = cbDelete.value;

    LOG_FILE = new File(ROOT.fsName + "/LiveTextBatch_log.txt");
    try { LOG_FILE.encoding = "UTF-8"; LOG_FILE.open("w"); LOG_FILE.writeln("Live Text Batch run " + new Date() + " | " + ENTRIES.length + " files"); LOG_FILE.close(); } catch (e) {}

    // ------------------------------------------------------------------ one document
    // Everything inside here is v12 code working on "doc" and "result" (the manifest entry).
    function processDoc(doc, result, warnings) {
        var AB = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var AB_W = (AB[2] - AB[0]) / PT_PER_IN, AB_H = (AB[1] - AB[3]) / PT_PER_IN;
        // v12's edit / selection modes are not used in batch runs
        var editGroup = null, editData = null, origSel = [], hasArtSelection = false;

        if (result.artboard && (Math.abs(result.artboard.w - AB_W) > 0.05 || Math.abs(result.artboard.h - AB_H) > 0.05))
            warnings.push("artboard is " + round(AB_W, 3) + " x " + round(AB_H, 3) + " in, web page measured " +
                          result.artboard.w + " x " + result.artboard.h + " in. Positions may be off.");

        // fonts must be installed
        var need = [];
        if (result.mkBack) {                       // a line with no text isn't made, so its font isn't needed
            if (trim(result.name.text)) need.push(result.name.font);
            if (trim(result.number.text)) need.push(result.number.font);
        }
        if (result.mkFront && result.front) need.push(result.front.font);
        for (var nf = 0; nf < need.length; nf++) {
            try { app.textFonts.getByName(need[nf]); }
            catch (e) { throw new Error("Font \"" + need[nf] + "\" is not installed on this computer."); }
        }

        // ---------------------------------------------------------------- colors (v12)
//@@COLORS@@

        // ---------------------------------------------------------------- build (v12)
//@@BUILD@@

        // Colour mode is switched afterwards by SwitchOpenDocsToCMYK.jsx: Illustrator ignores the
        // colour-mode menu command for documents a script opened, and copying the artwork into a
        // new CMYK document was too slow for big print files.
        log("color mode: " + doc.documentColorSpace + " (switch to CMYK afterwards with SwitchOpenDocsToCMYK.jsx)");

        // ---------------------------------------------------------------- place (v12)
//@@PLACE@@

//@@BACK@@

//@@FRONT@@

        // ---------------------------------------------------------------- run (adapted from v12: no alerts)
        var saved = {};
        try {
            saved.fill = doc.defaultFillColor; saved.stroke = doc.defaultStrokeColor;
            saved.filled = doc.defaultFilled; saved.stroked = doc.defaultStroked; saved.sw = doc.defaultStrokeWidth;
        } catch (e) {}

        // Where the text belongs: the active layer, as in v12 (or a new layer if it is locked/hidden).
        var target = doc.activeLayer;
        var targetOK = !target.locked && target.visible;
        // Speed: v12's appearance code must redraw the screen several times per line. Hide the
        // print artwork while the text is built in a temporary layer, so redraws only draw the text.
        var shown = [];
        for (var li = 0; li < doc.layers.length; li++) { shown.push(doc.layers[li].visible); }
        var layer = doc.layers.add(); layer.name = "Live text";
        for (li = 1; li < doc.layers.length; li++) { try { doc.layers[li].visible = false; } catch (e) {} }
        var made = [], groupsMade = [];
        try {
            if (result.mkBack) { var gb2 = buildBack(layer, made); made.push(gb2); groupsMade.push(gb2); }
            if (result.mkFront && result.front) { var gf = buildFront(layer, made); made.push(gf); groupsMade.push(gf); }
            doc.selection = null;
            log("done");
        } catch (e) {
            for (var m = 0; m < made.length; m++) try { made[m].remove(); } catch (x) {}
            throw e;
        } finally {
            try {
                if (saved.fill) {
                    doc.selection = null;
                    doc.defaultFillColor = saved.fill; doc.defaultStrokeColor = saved.stroke;
                    doc.defaultFilled = saved.filled; doc.defaultStroked = saved.stroked; doc.defaultStrokeWidth = saved.sw;
                }
            } catch (e) {}
            // show the artwork again and put the text where v12 would have put it
            for (li = 1; li < doc.layers.length; li++) { try { doc.layers[li].visible = shown[li - 1]; } catch (e) {} }
            if (targetOK) {
                for (var gi = groupsMade.length - 1; gi >= 0; gi--) { try { groupsMade[gi].move(target, ElementPlacement.PLACEATBEGINNING); } catch (e) {} }
                try { if (layer.pageItems.length === 0) layer.remove(); } catch (e) {}
            }
            app.redraw();
        }
        return doc;
    }

    // ------------------------------------------------------------------ the batch
    var oldUIL = app.userInteractionLevel;
    var pdfOpts = app.preferences.PDFFileOptions;
    var oldPage = pdfOpts.pageToOpen, oldBox = pdfOpts.pDFCropToBox;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    pdfOpts.pageToOpen = 1;
    try { pdfOpts.pDFCropToBox = PDFBoxType.PDFMEDIABOX; } catch (e) {}

    var prog = new Window("palette", "Live Text Batch");
    prog.alignChildren = ["fill", "top"];
    var progText = prog.add("statictext", undefined, "Starting…"); progText.preferredSize.width = 420;
    var progBar = prog.add("progressbar", undefined, 0, ENTRIES.length); progBar.preferredSize.width = 420;
    prog.show();

    var ok = 0, skipped = 0, failed = [], warned = [];
    try {
        for (var i = 0; i < ENTRIES.length; i++) {
            var entry = ENTRIES[i];
            var pdf = new File(ROOT.fsName + "/" + entry.path);
            var aiFile = new File(pdf.fsName.replace(/\.pdf$/i, "") + ".ai");
            progText.text = (i + 1) + " / " + ENTRIES.length + "  " + entry.path;
            progBar.value = i; prog.update();
            log("--- " + entry.path + " (" + entry.sku + " " + entry.size + ")");
            if (!pdf.exists) { failed.push(entry.path + ": file not found"); log("missing"); continue; }
            if (SKIP_EXISTING && aiFile.exists) { skipped++; log("skipped: .ai exists"); continue; }
            var doc = null, warnings = [];
            try {
                doc = app.open(pdf);
                doc = processDoc(doc, entry, warnings);
                var so = new IllustratorSaveOptions();
                so.pdfCompatible = true;
                so.compressed = true;
                doc.saveAs(aiFile, so);
                doc.close(SaveOptions.DONOTSAVECHANGES); doc = null;
                if (DELETE_PDF) pdf.remove();
                ok++;
                for (var w = 0; w < warnings.length; w++) { warned.push(entry.path + ": " + warnings[w]); log("warning: " + warnings[w]); }
            } catch (e) {
                failed.push(entry.path + ": " + e.message);
                log("error: " + e.message);
                if (doc) try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (x) {}
            }
        }
    } finally {
        app.userInteractionLevel = oldUIL;
        try { pdfOpts.pageToOpen = oldPage; pdfOpts.pDFCropToBox = oldBox; } catch (e) {}
        try { prog.close(); } catch (e) {}
    }

    var msg = "Built " + ok + " of " + ENTRIES.length + " file" + (ENTRIES.length === 1 ? "" : "s") + "." +
              (skipped ? "\nSkipped " + skipped + " (already had an .ai)." : "");
    if (warned.length) msg += "\n\nWarnings (" + warned.length + "):\n" + warned.slice(0, 8).join("\n") + (warned.length > 8 ? "\n…" : "");
    if (failed.length) msg += "\n\nProblems (" + failed.length + "):\n" + failed.slice(0, 8).join("\n") + (failed.length > 8 ? "\n…" : "");
    msg += "\n\nDetails: LiveTextBatch_log.txt in the folder.";
    if (ok) msg += "\n\nNext: open the .ai files (File > Open, select them all) and run SwitchOpenDocsToCMYK.jsx to switch them to CMYK and save.";
    log("finished: " + ok + " ok, " + skipped + " skipped, " + failed.length + " failed");
    alert(msg);
})();
