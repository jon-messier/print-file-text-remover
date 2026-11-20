# Print File Text Remover

Static site, with no build step and no server code. Everything runs in the user's browser.

## Deploy to Netlify
- **From this repo:** connect it in Netlify, leave the build command empty and set the publish directory to `/`. Every push to `main` is a production deploy; pushes to other branches and pull requests make free preview deploys.
- **By hand:** drag the repo folder (without `source/`) onto https://app.netlify.com/drop.

## Run locally (no Netlify)
On a Mac, double-click `Start (Mac).command`, or run `python3 serve.py` in this folder and open http://localhost:8765.

## How to use it
Click **How to** in the site's top bar for the full step-by-step guide (site, LiveTextBatch.jsx, SwitchOpenDocsToCMYK.jsx).

## Files
- `index.html`, `css/app.css`: the page
- `js/engine.js`: PDF reading, text detection, path deletion (incremental save; original bytes kept)
- `js/ocr.js`: Tesseract OCR, one worker per CPU core (minus one), cached across sizes
- `js/app.js`: upload, review, per-design switches, zip export
- `vendor/`: Tesseract.js 5.1.1 + English model, pdf.js 4.10.38, JSZip 3.10.1 (all local; no CDN calls)

## Live text (v12 replacement)
- `js/livetext.js` and `js/livetext-data.js`: SKU/size detection, presets, stacking and front alignment, ported from LiveTextBuilder. `livetext-data.js` is generated from the script's PRESETS / BASE_ALIAS / FULL_ALIAS / SIZE_ORDER / LIBRARY (currently LiveTextBuilder_v13.jsx), so regenerate it whenever the presets change.
- `js/livepanel.js`: the Live text tab, Chrome font access, and the preview.
- `tools/LiveTextBatch.jsx`: the Illustrator script added to every download with `_live_text_manifest.json`. Its text-building functions are copied unchanged from v12. It does not change colour mode.
- `tools/SwitchOpenDocsToCMYK.jsx`: run on the opened `.ai` files afterwards; switches each to CMYK, saves and closes. (Illustrator ignores the colour-mode menu for documents a script opened, so this has to run on files you opened.)

## Detection (js/roles.js)
- Numbers: 1–2 glyph groups ≥ 1 in; whole, digits-only and digit-by-digit OCR, plus the front/back pair structure. Back number = strongest number evidence ≥ 3 in (then biggest). Front number = the same lettering or reading as the back number.
- Outlines: one stroke path for the whole word, or one per glyph; both are removed with the lettering.
- Player name: NAME/PLAYER if read, otherwise the word centred next to the back number. Lettering that appears more than once (team names) is excluded.
- Every size of a design must agree: lettering is matched across sizes by glyph structure.
- Tested on 228 generated files across 46 fonts (block, slab, sans, condensed, serif, script, handwriting): 644/644 caught, 0 wrong removals.

## Rules (edit in js/engine.js and js/app.js)
- `PLACEHOLDERS` in engine.js: words removed automatically (NAME, PLAYER, PLAYERNAME, 00)
- `OCR_TEXT` (85) / `OCR_LOW` (60) in app.js: confidence thresholds
- Design grouping: `SM_<order>.<n>_<size>.pdf` -> one design per folder + order number

## Source (`source/`, not used by the site at runtime)
- `LiveTextBuilder_v13.jsx`: the standalone Illustrator builder and the source of every SKU preset (positions, heights, stacking, aliases, swatch library).
- `extract-presets.cjs`: regenerates `js/livetext-data.js` from it. Run after changing a preset:
  `node source/extract-presets.cjs source/LiveTextBuilder_v13.jsx js/livetext-data.js`
- `template.jsx` + `build-batch.cjs`: rebuild `tools/LiveTextBatch.jsx` (the template plus text-building code copied verbatim from v13):
  `node source/build-batch.cjs source/LiveTextBuilder_v13.jsx source/template.jsx tools/LiveTextBatch.jsx`

After any change, bump `?v=` on the script tags in `index.html` and the build stamp in the header so browsers pick up the new code.
