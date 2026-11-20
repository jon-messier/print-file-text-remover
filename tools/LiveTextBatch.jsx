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
    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
    function num(s, fb) { var n = parseFloat(String(s).replace(",", ".")); return isNaN(n) ? fb : n; }
    function clone(o) { return eval(o.toSource()); }
    function round(n, d) { var p = Math.pow(10, d || 0); return Math.round(n * p) / p; }

    // ------------------------------------------------------------------ stock swatches (v12)
    var LIBRARY = [
        { name: "SquadRed", v: [0, 100, 100, 0] },
        { name: "Cardinal", v: [0, 100, 75, 20] },
        { name: "Maroon", v: [0, 87, 43, 40] },
        { name: "HotPink", v: [0, 100, 12, 0] },
        { name: "Pink", v: [0, 60, 15, 0] },
        { name: "BurntOrange", v: [0, 79, 90, 0] },
        { name: "StixOrange", v: [0, 72, 91, 2] },
        { name: "SquadOrange", v: [0, 50, 100, 0] },
        { name: "AthleticGold", v: [0, 25, 100, 0] },
        { name: "SquadYellow", v: [0, 0, 100, 0] },
        { name: "DarkVegas", v: [0, 25, 100, 20] },
        { name: "OldGold", v: [0, 9, 48, 25] },
        { name: "VegasGold", v: [0, 15, 60, 20] },
        { name: "DarkGreen", v: [100, 0, 100, 40] },
        { name: "KellyGreen", v: [100, 0, 100, 0] },
        { name: "LimeGreen", v: [23, 0, 100, 0] },
        { name: "Royal", v: [100, 70, 0, 0] },
        { name: "DarkNavy", v: [100, 87.08, 42.09, 51.79] },
        { name: "Navy", v: [87, 65, 0, 40] },
        { name: "ColumbiaBlue", v: [50, 14, 0, 0] },
        { name: "CarolinaBlue", v: [30, 0, 0, 0] },
        { name: "DarkTeal", v: [80, 0, 23, 0] },
        { name: "Turquoise", v: [70, 0, 30, 0] },
        { name: "Purple", v: [55, 100, 0, 0] },
        { name: "LightPurple", v: [33, 60, 0, 0] },
        { name: "Brown", v: [0, 75, 100, 60] },
        { name: "DarkGrey", v: [0, 0, 0, 75] },
        { name: "MediumGrey", v: [0, 0, 0, 50] },
        { name: "LightGrey", v: [0, 0, 0, 30] },
        { name: "SquadBlack", v: [35, 45, 15, 95] },
        { name: "SquadWhite", v: [0, 0, 0, 0] }
    ];
    var LIB_BY_NAME = {};
    for (var li = 0; li < LIBRARY.length; li++) LIB_BY_NAME[LIBRARY[li].name] = LIBRARY[li];

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
        function libSpotColor(entry) {
            // Use the document's swatch of that name if it exists, otherwise add the stock spot.
            var sp = null;
            try { sp = doc.spots.getByName(entry.name); } catch (e) { sp = null; }
            if (!sp) {
                var c = new CMYKColor();
                c.cyan = entry.v[0]; c.magenta = entry.v[1]; c.yellow = entry.v[2]; c.black = entry.v[3];
                sp = doc.spots.add();
                sp.name = entry.name;
                sp.colorType = ColorModel.SPOT;
                sp.color = c;
                log("added swatch " + entry.name);
            }
            var sc = new SpotColor();
            sc.spot = sp;
            sc.tint = 100;
            return sc;
        }
        function specToColor(spec) {
            if (!spec || spec.kind === "none") return null;
            if (spec.kind === "lib") {
                if (!LIB_BY_NAME.hasOwnProperty(spec.name)) throw new Error("Unknown stock swatch \"" + spec.name + "\".");
                return libSpotColor(LIB_BY_NAME[spec.name]);
            }
            if (spec.kind === "swatch") {
                try { return doc.swatches.getByName(spec.name).color; }
                catch (e) { throw new Error("Swatch \"" + spec.name + "\" is not in this document."); }
            }
            if (spec.kind === "cmyk") {
                var c = new CMYKColor();
                c.cyan = spec.v[0]; c.magenta = spec.v[1]; c.yellow = spec.v[2]; c.black = spec.v[3];
                return c;
            }
            return null;
        }

        // ---------------------------------------------------------------- build (v12)
        function charAttrs(tf) { return tf.textRange.characterAttributes; }

        function measureInk(tf) {
            var d = tf.duplicate();
            var g = d.createOutline();
            var b = g.geometricBounds; // [left, top, right, bottom]
            g.remove();
            return b;
        }

        function makeLine(spec, layer, label) {
            var hasStroke = spec.stroke.kind !== "none" && spec.sw > 0;
            log(label + ": create text");
            var tf = layer.textFrames.pointText([0, 0]);
            tf.contents = spec.text;
            log(label + ": set font " + spec.font);
            charAttrs(tf).textFont = app.textFonts.getByName(spec.font);
            var size = 100;
            charAttrs(tf).size = size;
            charAttrs(tf).horizontalScale = 100;
            charAttrs(tf).verticalScale = 100;
            charAttrs(tf).baselineShift = 0;
            var k = new GrayColor(); k.gray = 100;
            charAttrs(tf).fillColor = k;
            charAttrs(tf).strokeColor = new NoColor();
            tf.textRange.paragraphAttributes.justification = Justification.CENTER;

            var targetInk = spec.height * PT_PER_IN - (hasStroke ? spec.sw : 0);
            for (var it = 0; it < 3; it++) {
                log(label + ": measure pass " + (it + 1) + " at " + round(size, 3) + " pt");
                var b = measureInk(tf), h = b[1] - b[3];
                if (!(h > 0)) throw new Error("Couldn't measure \"" + spec.text + "\" \u2014 does it contain visible characters?");
                var ns = size * targetInk / h;
                if (ns > MAX_FONT_PT) throw new Error("\"" + spec.text + "\" would need a " + round(ns, 1) +
                    " pt font size; Illustrator's maximum is " + MAX_FONT_PT + " pt.");
                if (Math.abs(ns - size) < 0.001) break;
                size = ns;
                charAttrs(tf).size = size;
            }
            return { frame: tf, spec: spec, hasStroke: hasStroke, half: hasStroke ? spec.sw / 2 : 0, label: label };
        }

        function setStrokeDefaults(col, wgt) {
            doc.defaultStroked = true;
            doc.defaultStrokeColor = col;
            doc.defaultStrokeWidth = wgt;
            try { doc.defaultStrokeJoin = StrokeJoin.ROUNDENDJOIN; } catch (e) {}
            try { doc.defaultStrokeCap = StrokeCap.ROUNDENDCAP; } catch (e) {}
        }
        function setFillDefaults(col) { doc.defaultFilled = true; doc.defaultFillColor = col; }

        // ---- Appearance: Fill stacked ABOVE an object-level Stroke ----------------
        // Illustrator's rules for type objects (confirmed in testing):
        //   • the first Add New Fill/Stroke creates a Stroke + Fill pair (stroke on top);
        //   • every later add is inserted directly ABOVE the row just added.
        // So Fill -> Stroke -> Fill produces, top to bottom:
        //     Stroke [None]  (from the pair; invisible)
        //     Fill           <- letter color
        //     Stroke         <- sits behind the fill
        //     Fill           (from the pair; hidden under everything)
        //     Characters
        // The row just added is the targeted one, so setting the document's current
        // fill/stroke immediately afterwards paints that row.
        function applyAppearance(L) {
            var fillCol = specToColor(L.spec.fill);
            if (!L.hasStroke) {
                log(L.label + ": apply fill (no stroke)");
                charAttrs(L.frame).fillColor = fillCol;
                charAttrs(L.frame).strokeColor = new NoColor();
                return;
            }
            var strokeCol = specToColor(L.spec.stroke);

            log(L.label + ": clear character paint");
            charAttrs(L.frame).fillColor = new NoColor();
            charAttrs(L.frame).strokeColor = new NoColor();
            doc.selection = null;
            L.frame.selected = true;
            app.redraw();   // REQUIRED: lets Illustrator register the selection/new row

            log(L.label + ": add fill");
            app.executeMenuCommand("Adobe New Fill Shortcut");
            setFillDefaults(fillCol);
            app.redraw();   // REQUIRED

            log(L.label + ": add stroke");
            app.executeMenuCommand("Adobe New Stroke Shortcut");
            setStrokeDefaults(strokeCol, L.spec.sw);
            app.redraw();   // REQUIRED

            log(L.label + ": add top fill");
            app.executeMenuCommand("Adobe New Fill Shortcut");
            setFillDefaults(fillCol);
            app.redraw();   // REQUIRED

            doc.selection = null;
        }


        // Colour mode is switched afterwards by SwitchOpenDocsToCMYK.jsx: Illustrator ignores the
        // colour-mode menu command for documents a script opened, and copying the artwork into a
        // new CMYK document was too slow for big print files.
        log("color mode: " + doc.documentColorSpace + " (switch to CMYK afterwards with SwitchOpenDocsToCMYK.jsx)");

        // ---------------------------------------------------------------- place (v12)
        function visibleBox(L) {
            var b = measureInk(L.frame), h = L.half;
            return [b[0] - h, b[1] + h, b[2] + h, b[3] - h];   // [left, top, right, bottom], y up
        }
        function setJustification(tf, a) {
            tf.textRange.paragraphAttributes.justification =
                a === "right" ? Justification.RIGHT : (a === "left" ? Justification.LEFT : Justification.CENTER);
        }
        function noteGroup(grp, part, center) {
            var store = clone(result);
            store.part = part; store.center = center;
            grp.note = TAG + store.toSource();
        }
        function groupCenter(list) {
            var vb = null;
            for (var i = 0; i < list.length; i++) {
                var v = visibleBox(list[i]);
                vb = vb ? [Math.min(vb[0], v[0]), Math.max(vb[1], v[1]), Math.max(vb[2], v[2]), Math.min(vb[3], v[3])] : v;
            }
            return [(vb[0] + vb[2]) / 2, (vb[1] + vb[3]) / 2];
        }

        function buildBack(layer, made) {
            var s = result.sizes, rot = result.rot, ab = AB;
            var slots = s.below ? [["number", s.numH], ["name", s.nameH]] : [["name", s.nameH], ["number", s.numH]];
            var used = [];
            for (var i = 0; i < slots.length; i++) used.push(!!trim((slots[i][0] === "name" ? result.name : result.number).text));
            var last = used[1] ? 1 : 0, totalH = 0;
            for (i = 0; i <= last; i++) totalH += slots[i][1] + (i < last ? s.gap : 0);
            totalH *= PT_PER_IN;

            var X, T;
            if (result.mode === "preset") {
                X = ab[0] + result.x * PT_PER_IN; T = ab[1] - result.top * PT_PER_IN;
            } else {
                var cx, cy;
                if (editGroup && editData && editData.part === "back" && editData.center) {
                    cx = editData.center[0]; cy = editData.center[1];
                } else if (result.mode === "selection" && hasArtSelection) {
                    var u = origSel[0].geometricBounds.slice();
                    for (var k = 1; k < origSel.length; k++) {
                        var gb = origSel[k].geometricBounds;
                        u[0] = Math.min(u[0], gb[0]); u[1] = Math.max(u[1], gb[1]);
                        u[2] = Math.max(u[2], gb[2]); u[3] = Math.min(u[3], gb[3]);
                    }
                    cx = (u[0] + u[2]) / 2; cy = (u[1] + u[3]) / 2;
                } else { cx = (ab[0] + ab[2]) / 2; cy = (ab[1] + ab[3]) / 2; }
                X = cx; T = rot === 180 ? cy - totalH / 2 : cy + totalH / 2;
            }
            log("back: target X " + round(X, 2) + " T " + round(T, 2) + " rot " + rot + " mode " + result.mode);

            var built = [], off = 0;
            for (i = 0; i < slots.length; i++) {
                var role = slots[i][0], h = slots[i][1], src2 = role === "name" ? result.name : result.number;
                if (used[i]) {
                    var L = makeLine({ text: src2.text, font: src2.font, height: h, sw: src2.sw, fill: src2.fill, stroke: src2.stroke }, layer, "back " + role);
                    made.push(L.frame);
                    if (rot === 180) L.frame.rotate(180);
                    var b = measureInk(L.frame);
                    var dy = rot === 180 ? (T + off * PT_PER_IN + L.half) - b[3] : (T - off * PT_PER_IN - L.half) - b[1];
                    L.frame.translate(X - (b[0] + b[2]) / 2, dy);
                    built.push(L);
                }
                off += h + s.gap;
            }
            for (i = 0; i < built.length; i++) applyAppearance(built[i]);
            var grp = layer.groupItems.add();
            for (i = 0; i < built.length; i++) built[i].frame.move(grp, ElementPlacement.PLACEATEND);
            grp.name = "Back personalization \u2013 " + trim(result.name.text + " " + result.number.text) +
                       (result.mode === "preset" ? " (" + result.sku + " " + result.size + ")" : "");
            noteGroup(grp, "back", groupCenter(built));
            return grp;
        }

        function buildFront(layer, made) {
            var f = result.front, ab = AB, rot = f.rot;
            var X = ab[0] + f.x * PT_PER_IN, T = ab[1] - f.top * PT_PER_IN;
            log("front: target X " + round(X, 2) + " T " + round(T, 2) + " rot " + rot + " align " + f.align);
            var L = makeLine({ text: f.text, font: f.font, height: f.height, sw: f.sw, fill: f.fill, stroke: f.stroke }, layer, "front number");
            made.push(L.frame);
            setJustification(L.frame, f.align);
            if (rot === 180) L.frame.rotate(180);
            var b = measureInk(L.frame), hlf = L.half;
            var visL = b[0] - hlf, visR = b[2] + hlf, dx;
            var garmentRight = rot === 180 ? visL : visR, garmentLeft = rot === 180 ? visR : visL;
            if (f.align === "right") dx = X - garmentRight;
            else if (f.align === "left") dx = X - garmentLeft;
            else dx = X - (b[0] + b[2]) / 2;
            var dy = rot === 180 ? (T + hlf) - b[3] : (T - hlf) - b[1];
            L.frame.translate(dx, dy);
            applyAppearance(L);
            var grp = layer.groupItems.add();
            L.frame.move(grp, ElementPlacement.PLACEATEND);
            grp.name = "Front number \u2013 " + f.text + (result.sku ? " (" + result.sku + " " + result.size + ")" : "");
            noteGroup(grp, "front", groupCenter([L]));
            return grp;
        }

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
