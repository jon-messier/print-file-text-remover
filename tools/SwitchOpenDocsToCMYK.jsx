#target illustrator
/*
    SwitchOpenDocsToCMYK.jsx  —  companion to LiveTextBatch.jsx

    Switches every OPEN document to CMYK (File > Document Color Mode > CMYK Color),
    then saves and closes it. Illustrator ignores this switch for documents a script
    opened itself, so open the files yourself first:

      1. File > Open, select all the .ai files the batch made, Open.
      2. File > Scripts > Other Script... and pick this file.

    Documents that are already CMYK are left exactly as they are (closed without saving).
    Anything that doesn't switch is left open and listed at the end.

    Switching colour mode makes Illustrator load its default swatches. This script
    notes the swatches and swatch groups each document had before the switch and
    removes only the ones the switch added (they are new, so nothing uses them).
*/
(function () {
    if (app.documents.length === 0) {
        alert("Open the .ai files first (File > Open, select them all), then run this script again.");
        return;
    }
    var docs = [];
    for (var i = 0; i < app.documents.length; i++) docs.push(app.documents[i]);
    if (!confirm("Switch " + docs.length + " open document" + (docs.length === 1 ? "" : "s") +
                 " to CMYK, save and close " + (docs.length === 1 ? "it" : "them") + "?\n(Documents that are already CMYK are closed unchanged.)")) return;

    function names(coll) { var o = {}; for (var k = 0; k < coll.length; k++) { try { o[coll[k].name] = true; } catch (e) {} } return o; }
    // remove swatches / swatch groups that appeared during the switch
    function removeAdded(doc, swBefore, grBefore) {
        var removed = 0;
        for (var k = doc.swatches.length - 1; k >= 0; k--) {
            var sw = doc.swatches[k], n = "";
            try { n = sw.name; } catch (e) { continue; }
            if (swBefore[n] || /^\[(None|Registration)\]$/.test(n)) continue;
            try { sw.remove(); removed++; } catch (e) {}
        }
        for (var g = doc.swatchGroups.length - 1; g >= 1; g--) {      // group 0 is the document's main group
            var grp = doc.swatchGroups[g], gn = "";
            try { gn = grp.name; } catch (e) { continue; }
            if (grBefore[gn]) continue;
            try { if (grp.getAllSwatches().length === 0) grp.remove(); } catch (e) {}
        }
        return removed;
    }

    var ok = 0, failed = [], cleaned = 0, already = 0;
    for (var d = 0; d < docs.length; d++) {
        var doc = docs[d], name = "";
        try {
            name = doc.name;
            app.activeDocument = doc;
            doc.selection = null;
            app.redraw();
            if (doc.documentColorSpace === DocumentColorSpace.CMYK) {   // already CMYK: don't touch it
                doc.close(SaveOptions.DONOTSAVECHANGES);
                already++;
                continue;
            }
            var swBefore = names(doc.swatches), grBefore = names(doc.swatchGroups);
            app.executeMenuCommand("doc-color-cmyk");
            app.redraw();
            if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
                cleaned += removeAdded(doc, swBefore, grBefore);
                doc.save();
                doc.close(SaveOptions.DONOTSAVECHANGES);
                ok++;
            } else {
                failed.push(name + " (still RGB, left open)");
            }
        } catch (e) {
            failed.push((name || "a document") + ": " + e.message);
        }
    }
    alert("Switched to CMYK and saved: " + ok + " of " + docs.length + "." +
          (already ? "\nAlready CMYK, left unchanged: " + already + "." : "") +
          (cleaned ? "\nRemoved " + cleaned + " default swatch" + (cleaned === 1 ? "" : "es") + " Illustrator added during the switch." : "") +
          (failed.length ? "\n\nNot switched:\n" + failed.join("\n") : ""));
})();
