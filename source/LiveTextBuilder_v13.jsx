#target illustrator
/*
    LiveTextBuilder.jsx  —  v13 (v12 + SLSB102A/Y presets, SLSC102 / SLSC122 -> SLSB102 aliases)

    Builds live back personalization (name + number) and an optional front number,
    and places them on the print file. Back and Front each have their own tab and
    their own "include" checkbox; one Generate makes both (as separate groups).

    FRONT NUMBER
      • Always uses the same number text as the back.
      • Font / colors / stroke follow the back number unless unlinked; height is its own.
      • Alignment (Right default / Center / Left) works like paragraph alignment: that
        edge (or the center) stays put and the number grows away from it. The live
        text's own paragraph alignment is set to match.
      • Position comes from the print-file data. With no data it falls back to the front
        half of the artboard (vertically centered; offset so "00" sits centered and longer
        numbers grow into the open side).

    TEXT ENGINE (carried over from v7)
      • height = glyph ink + visible stroke, in inches
      • Appearance: Fill -> Stroke -> Fill so the stroke sits behind the fill
      • SquadLocker stock swatches + custom CMYK
      • type-to-filter font picker, step log, crash-safe text handling

    PLACEMENT
      • Preset: SKU + size placement from Back_Personalization_Placements.xlsx.
        X = horizontal center of the name + number group.
        Top Y = the GARMENT-TOP edge of the group (top of the name, or of the number
        when the name sits below it), in inches down from the artboard top. That edge
        is pinned: changing heights or the gap only moves what is below it.
        On rotation 180 the garment top is the lower edge on the artboard.
      • Artboard center / Selection center: same as the earlier versions.

    AUTO-DETECT: SKU + size from the file name (cut-pattern aliases included); if the
    SKU isn't in the name, size from the name + closest artboard size.

    MEMORY: every input is remembered between runs. Heights / gap / name position
    that differ from the standard are remembered per SKU until "Reset to standard".

    EDIT: select a group made by this script and run it again to rebuild it.

    COLOR MODE: on Generate (not on Cancel), the document is set to CMYK before any text
    is made. A file already in CMYK is switched to RGB and back to CMYK, which clears the
    color-display glitches seen in some vendor files; an RGB file is switched to CMYK.
*/

(function () {

    if (app.documents.length === 0) { alert("Open a document first."); return; }

    var doc = app.activeDocument;
    var TAG = "LTB9:";
    var ZERO_RATIO = 1.24;   // width / height of "00" in the measured files (fallback spacing)
    var PT_PER_IN = 72;
    var MAX_FONT_PT = 1296;
    var LBL = 74;
    var SETTINGS_FILE = new File(Folder.userData + "/LiveTextBuilder_v9_settings.txt");
    var LOG_FILE = new File(Folder.userData + "/LiveTextBuilder_log.txt");

    // ------------------------------------------------------------------ placement presets
    // Generated from Back_Personalization_Placements.xlsx (Placements sheet).
    //   x     group horizontal center (in, from artboard left)
    //   top   garment-top edge of the group (in, down from artboard top)
    //   rot   0 or 180
    //   numH / nameH / gap   standard sizes (in), editable in the dialog
    //   below true = name sits below the number
    //   abW / abH            artboard size the preset was measured on (in)
    //   fH    front number default height; fStd = 4 (A/L) or 3 (Y/G)
    //   fHalf center of the front half [x, y] (fallback when there is no front data)
    //   front { l, c, r, top, rot } measured front number edges (artboard terms), or null
    var PRESETS = {
        "SLBA101A": {
            "S": { x: 46.856, top: 14.1455, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 56.875, abH: 41.595,
                fH: 4.0, fStd: 4.0, fHalf: [14.2188, 20.7975], front: null },
            "M": { x: 45.436, top: 14.9227, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 55.94, abH: 42.87,
                fH: 4.0, fStd: 4.0, fHalf: [13.985, 21.435], front: null },
            "L": { x: 46.2508, top: 15.4775, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 57.76, abH: 43.925,
                fH: 4.0, fStd: 4.0, fHalf: [14.44, 21.9625], front: null },
            "XL": { x: 45.6972, top: 16.2366, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.27, abH: 45.19,
                fH: 4.0, fStd: 4.0, fHalf: [14.5675, 22.595], front: null },
            "2XL": { x: 43.951, top: 17.431, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 57.955, abH: 47.4,
                fH: 4.0, fStd: 4.0, fHalf: [14.4887, 23.7], front: null },
            "3XL": { x: 43.4456, top: 4.0399, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.33, abH: 58.915,
                fH: 4.0, fStd: 4.0, fHalf: [14.5825, 29.4575], front: null },
            "4XL": { x: 43.7411, top: 4.3295, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 59.375, abH: 68.98,
                fH: 4.0, fStd: 4.0, fHalf: [14.8438, 34.49], front: null }
        },
        "SLBA101Y": {
            "YXS": { x: 49.0317, top: 3.6101, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 57.275, abH: 23.925,
                fH: 3.0, fStd: 3.0, fHalf: [14.3187, 11.9625], front: null },
            "YS": { x: 48.5835, top: 3.4399, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 57.205, abH: 25.275,
                fH: 3.0, fStd: 3.0, fHalf: [14.3012, 12.6375], front: null },
            "YM": { x: 48.6613, top: 3.4701, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 57.665, abH: 27.04,
                fH: 3.0, fStd: 3.0, fHalf: [14.4162, 13.52], front: null },
            "YL": { x: 48.286, top: 3.5194, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 57.665, abH: 28.595,
                fH: 3.0, fStd: 3.0, fHalf: [14.4162, 14.2975], front: null },
            "YXL": { x: 48.176, top: 13.3869, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.18, abH: 40.705,
                fH: 3.0, fStd: 3.0, fHalf: [14.545, 20.3525], front: null }
        },
        "SLBA103A": {
            "S": { x: 48.0097, top: 38.9808, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 59.135, abH: 41.995,
                fH: 4.0, fStd: 4.0, fHalf: [14.7838, 20.9975], front: null },
            "M": { x: 46.68, top: 40.6441, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.805, abH: 43.65,
                fH: 4.0, fStd: 4.0, fHalf: [14.7012, 21.825], front: null },
            "L": { x: 47.065, top: 43.0883, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 60.26, abH: 46.095,
                fH: 4.0, fStd: 4.0, fHalf: [15.065, 23.0475], front: null },
            "XL": { x: 44.3444, top: 44.3433, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.47, abH: 47.38,
                fH: 4.0, fStd: 4.0, fHalf: [14.6175, 23.69], front: null },
            "2XL": { x: 43.26, top: 32.5071, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.385, abH: 55.04,
                fH: 4.0, fStd: 4.0, fHalf: [14.5963, 27.52], front: null },
            "3XL": { x: 42.625, top: 33.6235, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.75, abH: 68.205,
                fH: 4.0, fStd: 4.0, fHalf: [14.6875, 34.1025], front: null },
            "4XL": { x: 40.9, top: 34.1362, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.12, abH: 70.19,
                fH: 4.0, fStd: 4.0, fHalf: [14.53, 35.095], front: null }
        },
        "SLBA103Y": {
            "YXS": { x: 49.36, top: 3.6261, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.11, abH: 23.75,
                fH: 3.0, fStd: 3.0, fHalf: [14.5275, 11.875], front: null },
            "YS": { x: 49.1098, top: 3.7053, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.36, abH: 25.785,
                fH: 3.0, fStd: 3.0, fHalf: [14.59, 12.8925], front: null },
            "YM": { x: 48.275, top: 3.9476, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.15, abH: 28.035,
                fH: 3.0, fStd: 3.0, fHalf: [14.5375, 14.0175], front: null },
            "YL": { x: 47.1098, top: 12.1735, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 57.985, abH: 38.26,
                fH: 3.0, fStd: 3.0, fHalf: [14.4962, 19.13], front: null },
            "YXL": { x: 46.65, top: 13.4124, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.15, abH: 42.025,
                fH: 3.0, fStd: 3.0, fHalf: [14.5375, 21.0125], front: null }
        },
        "SLBA104A": {
            "S": { x: 14.4378, top: 37.3702, rot: 180, numH: 7.0, nameH: 2.5, gap: 1.5, below: false, abW: 58.51, abH: 40.84,
                fH: 3.0, fStd: 4.0, fHalf: [43.8825, 20.42], front: { l: 50.4595, c: 52.2726, r: 54.0858, top: 28.0126, rot: 0 } },
            "M": { x: 12.9927, top: 41.2323, rot: 180, numH: 7.0, nameH: 2.5, gap: 1.5, below: false, abW: 58.885, abH: 44.715,
                fH: 3.0, fStd: 4.0, fHalf: [44.1638, 22.3575], front: { l: 50.1662, c: 51.9794, r: 53.7925, top: 30.5648, rot: 0 } },
            "L": { x: 14.3828, top: 31.973, rot: 180, numH: 7.0, nameH: 2.5, gap: 1.5, below: false, abW: 58.735, abH: 57.34,
                fH: 3.0, fStd: 4.0, fHalf: [44.0512, 28.67], front: { l: 48.8706, c: 50.6837, r: 52.4969, top: 41.988, rot: 0 } },
            "XL": { x: 26.5179, top: 34.7695, rot: 180, numH: 7.0, nameH: 2.5, gap: 1.5, below: false, abW: 59.135, abH: 59.485,
                fH: 3.0, fStd: 4.0, fHalf: [44.3513, 29.7425], front: { l: 6.077, c: 7.8902, r: 9.7033, top: 43.7647, rot: 0 } },
            "2XL": { x: 21.0628, top: 43.4422, rot: 180, numH: 7.0, nameH: 2.5, gap: 1.5, below: false, abW: 58.51, abH: 69.065,
                fH: 3.0, fStd: 4.0, fHalf: [43.8825, 34.5325], front: { l: 40.9429, c: 42.7561, r: 44.5693, top: 19.6697, rot: 0 } },
            "3XL": { x: 21.3928, top: 43.8314, rot: 180, numH: 7.0, nameH: 2.5, gap: 1.5, below: false, abW: 58.495, abH: 70.68,
                fH: 3.0, fStd: 4.0, fHalf: [43.8713, 35.34], front: { l: 42.5489, c: 44.362, r: 46.1752, top: 19.8569, rot: 0 } },
            "4XL": { x: 21.5178, top: 40.872, rot: 180, numH: 7.0, nameH: 2.5, gap: 1.5, below: false, abW: 58.605, abH: 73.22,
                fH: 3.0, fStd: 4.0, fHalf: [43.9538, 36.61], front: { l: 44.7536, c: 46.5667, r: 48.3799, top: 19.7316, rot: 0 } }
        },
        "SLBA104Y": {
            "YXS": { x: 9.2056, top: 29.2116, rot: 180, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.25, abH: 32.175,
                fH: 2.5, fStd: 3.0, fHalf: [43.6875, 16.0875], front: { l: 51.5801, c: 53.1273, r: 54.6744, top: 21.3011, rot: 0 } },
            "YS": { x: 9.6683, top: 30.8143, rot: 180, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.235, abH: 33.815,
                fH: 2.5, fStd: 3.0, fHalf: [43.6762, 16.9075], front: { l: 51.182, c: 52.7291, r: 54.2762, top: 21.7109, rot: 0 } },
            "YM": { x: 10.5808, top: 32.776, rot: 180, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.36, abH: 35.745,
                fH: 2.5, fStd: 3.0, fHalf: [43.77, 17.8725], front: { l: 50.5699, c: 52.117, r: 53.6641, top: 22.4476, rot: 0 } },
            "YL": { x: 11.1109, top: 34.1993, rot: 180, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.055, abH: 37.15,
                fH: 2.5, fStd: 3.0, fHalf: [43.5412, 18.575], front: { l: 49.5873, c: 51.1344, r: 52.6816, top: 22.6063, rot: 0 } },
            "YXL": { x: 11.9708, top: 37.8074, rot: 180, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.125, abH: 40.745,
                fH: 2.5, fStd: 3.0, fHalf: [43.5938, 20.3725], front: { l: 48.9214, c: 50.4685, r: 52.0156, top: 24.2242, rot: 0 } }
        },
        "SLBB112A": {
            "S": { x: 47.8971, top: 29.1214, rot: 0, numH: 8.0, nameH: 2.5, gap: 1.5, below: false, abW: 57.4, abH: 56.61,
                fH: 6.0, fStd: 4.0, fHalf: [14.35, 28.305], front: { l: 7.3689, c: 11.0373, r: 14.7057, top: 39.6535, rot: 0 } },
            "M": { x: 46.4371, top: 29.2582, rot: 0, numH: 8.0, nameH: 2.5, gap: 1.5, below: false, abW: 56.94, abH: 57.22,
                fH: 6.0, fStd: 4.0, fHalf: [14.235, 28.61], front: { l: 7.5352, c: 11.2036, r: 14.872, top: 39.7566, rot: 0 } },
            "L": { x: 12.1301, top: 29.5602, rot: 0, numH: 8.0, nameH: 2.5, gap: 1.5, below: false, abW: 57.19, abH: 58.025,
                fH: 6.0, fStd: 4.0, fHalf: [42.8925, 29.0125], front: { l: 42.0221, c: 45.6905, r: 49.359, top: 40.0679, rot: 0 } },
            "XL": { x: 45.1771, top: 30.4258, rot: 0, numH: 8.0, nameH: 2.5, gap: 1.5, below: false, abW: 57.68, abH: 59.4,
                fH: 6.0, fStd: 4.0, fHalf: [14.42, 29.7], front: { l: 9.2621, c: 12.9306, r: 16.599, top: 40.9379, rot: 0 } },
            "2XL": { x: 43.7321, top: 30.9724, rot: 0, numH: 8.0, nameH: 2.5, gap: 1.5, below: false, abW: 57.83, abH: 60.94,
                fH: 6.0, fStd: 4.0, fHalf: [14.4575, 30.47], front: { l: 10.7871, c: 14.4556, r: 18.124, top: 41.4614, rot: 0 } },
            "3XL": { x: 42.7471, top: 4.6396, rot: 0, numH: 8.0, nameH: 2.5, gap: 1.5, below: false, abW: 57.625, abH: 63.19,
                fH: 6.0, fStd: 4.0, fHalf: [14.4062, 31.595], front: { l: 11.5785, c: 15.2469, r: 18.9154, top: 42.6917, rot: 0 } }
        },
        "SLBB112Y": {
            "YXS": { x: 49.2975, top: 19.7023, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.535, abH: 40.055,
                fH: 5.0, fStd: 3.0, fHalf: [14.3838, 20.0275], front: { l: 29.1865, c: 32.3252, r: 35.4639, top: 27.9122, rot: 0 } },
            "YS": { x: 49.1, top: 20.4242, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.73, abH: 42.345,
                fH: 5.0, fStd: 3.0, fHalf: [14.4325, 21.1725], front: { l: 28.3238, c: 31.4625, r: 34.6012, top: 28.7116, rot: 0 } },
            "YM": { x: 48.4747, top: 20.433, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.47, abH: 44.02,
                fH: 5.0, fStd: 3.0, fHalf: [14.3675, 22.01], front: { l: 26.5111, c: 29.6498, r: 32.7885, top: 28.7822, rot: 0 } },
            "YL": { x: 47.86, top: 20.0866, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.235, abH: 45.18,
                fH: 5.0, fStd: 3.0, fHalf: [14.3087, 22.59], front: { l: 25.1663, c: 28.305, r: 31.4437, top: 28.5806, rot: 0 } },
            "YXL": { x: 47.58, top: 25.7938, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.607, abH: 53.125,
                fH: 5.0, fStd: 3.0, fHalf: [14.4017, 26.5625], front: { l: 8.3613, c: 11.5, r: 14.6387, top: 34.3086, rot: 0 } }
        },
        "SLBB119A": {
            "S": { x: 45.8223, top: 29.5733, rot: 180, numH: 8.0, nameH: 2.5, gap: 1.0, below: false, abW: 55.403, abH: 35.528,
                fH: 6.0, fStd: 4.0, fHalf: [13.8507, 17.7639], front: { l: 9.66, c: 13.335, r: 17.01, top: 16.575, rot: 0 } },
            "M": { x: 45.5173, top: 31.0473, rot: 180, numH: 8.0, nameH: 2.5, gap: 1.0, below: false, abW: 56.333, abH: 36.611,
                fH: 6.0, fStd: 4.0, fHalf: [14.0833, 18.3056], front: { l: 10.7299, c: 14.4049, r: 18.08, top: 17.5261, rot: 0 } },
            "L": { x: 44.2823, top: 31.7529, rot: 180, numH: 8.0, nameH: 2.5, gap: 1.0, below: false, abW: 55.556, abH: 37.611,
                fH: 6.0, fStd: 4.0, fHalf: [13.8889, 18.8056], front: { l: 11.34, c: 15.015, r: 18.69, top: 17.7386, rot: 0 } },
            "XL": { x: 45.7273, top: 32.2855, rot: 180, numH: 8.0, nameH: 2.5, gap: 1.0, below: false, abW: 58.236, abH: 38.167,
                fH: 6.0, fStd: 4.0, fHalf: [14.559, 19.0833], front: { l: 12.585, c: 16.2601, r: 19.9351, top: 18.1236, rot: 0 } },
            "2XL": { x: 45.1723, top: 32.7001, rot: 180, numH: 8.0, nameH: 2.5, gap: 1.0, below: false, abW: 58.0, abH: 51.139,
                fH: 6.0, fStd: 4.0, fHalf: [14.5, 25.5694], front: { l: 12.8928, c: 16.5678, r: 20.2429, top: 30.5272, rot: 0 } },
            "3XL": { x: 44.5073, top: 33.551, rot: 180, numH: 8.0, nameH: 2.5, gap: 1.0, below: false, abW: 58.681, abH: 63.5,
                fH: 6.0, fStd: 4.0, fHalf: [14.6701, 31.75], front: { l: 14.2505, c: 17.9255, r: 21.6006, top: 42.4336, rot: 0 } }
        },
        "SLBB119Y": {
            "YS": { x: 39.7797, top: 23.8502, rot: 180, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 47.444, abH: 29.167,
                fH: 5.0, fStd: 3.0, fHalf: [11.8611, 14.5833], front: { l: 9.1034, c: 12.15, r: 15.1966, top: 16.2022, rot: 0 } },
            "YM": { x: 40.5622, top: 26.6252, rot: 180, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 49.0, abH: 31.917,
                fH: 5.0, fStd: 3.0, fHalf: [12.25, 15.9583], front: { l: 9.8873, c: 12.9339, r: 15.9805, top: 17.1644, rot: 0 } },
            "YL": { x: 41.2894, top: 28.4835, rot: 180, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 50.444, abH: 33.736,
                fH: 5.0, fStd: 3.0, fHalf: [12.6111, 16.8681], front: { l: 10.6084, c: 13.655, r: 16.7016, top: 17.2712, rot: 0 } },
            "YXL": { x: 42.2258, top: 29.4399, rot: 180, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 54.111, abH: 34.722,
                fH: 5.0, fStd: 3.0, fHalf: [13.5278, 17.3611], front: { l: 11.5484, c: 14.5949, r: 17.6415, top: 16.5179, rot: 0 } }
        },
        "SLSB102G": {
            "YXS": { x: 22.2359, top: 19.1577, rot: 180, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 56.845, abH: 22.12,
                fH: 2.0, fStd: 3.0, fHalf: [42.6338, 11.06], front: { l: 9.0378, c: 10.2918, r: 11.5459, top: 11.7495, rot: 0 } },
            "YS": { x: 24.8099, top: 20.9911, rot: 180, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 58.035, abH: 23.885,
                fH: 2.0, fStd: 3.0, fHalf: [43.5263, 11.9425], front: { l: 9.7959, c: 11.05, r: 12.304, top: 11.8537, rot: 0 } },
            "YM": { x: 27.1425, top: 22.8593, rot: 180, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.27, abH: 25.735,
                fH: 2.0, fStd: 3.0, fHalf: [42.9525, 12.8675], front: { l: 10.7057, c: 11.9598, r: 13.2138, top: 11.9781, rot: 0 } },
            "YL": { x: 29.811, top: 24.9892, rot: 180, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 58.3, abH: 27.895,
                fH: 2.0, fStd: 3.0, fHalf: [14.575, 13.9475], front: { l: 11.8028, c: 13.0569, r: 14.3109, top: 12.5321, rot: 0 } },
            "YXL": { x: 47.9375, top: 26.8284, rot: 180, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 58.315, abH: 29.69,
                fH: 2.0, fStd: 3.0, fHalf: [14.5788, 14.845], front: { l: 12.2821, c: 13.5362, r: 14.7902, top: 12.6569, rot: 0 } }
        },
        "SLSB102L": {
            "S": { x: 48.343, top: 26.5442, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.245, abH: 29.73,
                fH: 2.5, fStd: 4.0, fHalf: [14.5613, 14.865], front: { l: 11.5615, c: 13.3249, r: 15.0883, top: 17.791, rot: 0 } },
            "M": { x: 31.0494, top: 27.2837, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.76, abH: 30.315,
                fH: 2.5, fStd: 4.0, fHalf: [14.69, 15.1575], front: { l: 12.2305, c: 13.9938, r: 15.7572, top: 17.8901, rot: 0 } },
            "L": { x: 48.1544, top: 28.754, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.535, abH: 31.825,
                fH: 2.5, fStd: 4.0, fHalf: [14.6338, 15.9125], front: { l: 12.512, c: 14.2754, r: 16.0387, top: 18.7129, rot: 0 } },
            "XL": { x: 47.5796, top: 27.6253, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.465, abH: 34.855,
                fH: 2.5, fStd: 4.0, fHalf: [14.6162, 17.4275], front: { l: 13.1626, c: 14.926, r: 16.6894, top: 20.9621, rot: 0 } },
            "2XL": { x: 37.7094, top: 29.5322, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.51, abH: 45.76,
                fH: 2.5, fStd: 4.0, fHalf: [14.6275, 22.88], front: { l: 15.082, c: 16.8454, r: 18.6088, top: 31.3826, rot: 0 } },
            "3XL": { x: 44.1849, top: 46.1329, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.065, abH: 49.19,
                fH: 2.5, fStd: 4.0, fHalf: [14.5163, 24.595], front: { l: 16.6117, c: 18.3751, r: 20.1385, top: 31.238, rot: 0 } }
        },
        // SLSB102A / SLSB102Y measured from finished SLSC102A / SLSC102Y files (two finished designs, Nov 2026).
        // Back: both designs agree. Front: one design's position (front placement varies by design).
        "SLSB102A": {
            "S": { x: 10.577, top: 14.2368, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 56.15, abH: 41.705,
                fH: 2.5, fStd: 4.0, fHalf: [42.1125, 20.8525], front: { l: 48.0957, c: 49.4967, r: 50.8978, top: 17.5872, rot: 0 } },
            "M": { x: 11.2471, top: 14.763, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 55.235, abH: 42.73,
                fH: 2.5, fStd: 4.0, fHalf: [41.4262, 21.365], front: { l: 47.31, c: 48.7111, r: 50.1122, top: 17.9857, rot: 0 } },
            "L": { x: 12.6625, top: 14.9024, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.19, abH: 43.37,
                fH: 2.5, fStd: 4.0, fHalf: [43.6425, 21.685], front: { l: 49.5458, c: 50.9469, r: 52.348, top: 18.2221, rot: 0 } },
            "XL": { x: 13.2559, top: 16.4371, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 58.26, abH: 45.495,
                fH: 2.5, fStd: 4.0, fHalf: [43.695, 22.7475], front: { l: 49.1614, c: 50.5625, r: 51.9636, top: 19.7605, rot: 0 } },
            "2XL": { x: 14.8138, top: 17.8677, rot: 0, numH: 8.0, nameH: 2.0, gap: 1.5, below: false, abW: 57.955, abH: 47.855,
                fH: 2.5, fStd: 4.0, fHalf: [43.4663, 23.9275], front: { l: 47.9397, c: 49.3407, r: 50.7418, top: 21.2208, rot: 0 } }
        },
        "SLSB102Y": {
            "YXS": { x: 27.9933, top: 3.5396, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 55.065, abH: 23.84,
                fH: 2.0, fStd: 3.0, fHalf: [41.2987, 11.92], front: { l: 48.9598, c: 50.0986, r: 51.2374, top: 5.4443, rot: 0 } },
            "YS": { x: 30.1564, top: 3.452, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.235, abH: 25.26,
                fH: 2.0, fStd: 3.0, fHalf: [42.9262, 12.63], front: { l: 50.8207, c: 51.9595, r: 53.0983, top: 5.382, rot: 0 } },
            "YM": { x: 29.1884, top: 3.2741, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.33, abH: 26.84,
                fH: 2.0, fStd: 3.0, fHalf: [42.9975, 13.42], front: { l: 50.7078, c: 51.8466, r: 52.9854, top: 5.2394, rot: 0 } },
            "YL": { x: 29.2032, top: 3.7042, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.9, abH: 28.76,
                fH: 2.0, fStd: 3.0, fHalf: [43.425, 14.38], front: { l: 51.0287, c: 52.1675, r: 53.3063, top: 5.6728, rot: 0 } },
            "YXL": { x: 10.8875, top: 13.4618, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.345, abH: 40.76,
                fH: 2.0, fStd: 3.0, fHalf: [43.0087, 20.38], front: { l: 50.0965, c: 51.2353, r: 52.3741, top: 15.4661, rot: 0 } }
        },
        "SLSB105G": {
            "YXS": { x: 50.4933, top: 2.7999, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.79, abH: 20.245,
                fH: 2.5, fStd: 3.0, fHalf: [14.4475, 10.1225], front: { l: 8.1488, c: 9.9487, r: 11.7485, top: 10.5615, rot: 0 } },
            "YS": { x: 50.0781, top: 2.8785, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 58.125, abH: 22.8,
                fH: 2.5, fStd: 3.0, fHalf: [14.5312, 11.4], front: { l: 9.1964, c: 10.9962, r: 12.7961, top: 10.7224, rot: 0 } },
            "YM": { x: 49.2847, top: 3.2386, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 58.08, abH: 25.635,
                fH: 2.5, fStd: 3.0, fHalf: [14.52, 12.8175], front: { l: 9.6118, c: 11.4117, r: 13.2115, top: 11.1741, rot: 0 } },
            "YL": { x: 48.3878, top: 2.9208, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 58.065, abH: 26.705,
                fH: 2.5, fStd: 3.0, fHalf: [14.5163, 13.3525], front: { l: 10.4943, c: 12.2941, r: 14.094, top: 11.0846, rot: 0 } },
            "YXL": { x: 47.5631, top: 3.0537, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.985, abH: 28.205,
                fH: 2.5, fStd: 3.0, fHalf: [14.4962, 14.1025], front: { l: 11.2585, c: 13.0584, r: 14.8583, top: 11.1492, rot: 0 } }
        },
        "SLSB105L": {
            "S": { x: 47.5588, top: 28.9184, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.375, abH: 31.678,
                fH: 4.0, fStd: 4.0, fHalf: [14.5938, 15.8391], front: { l: 11.892, c: 14.8344, r: 17.7768, top: 13.1943, rot: 0 } },
            "M": { x: 46.9421, top: 36.655, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.26, abH: 39.105,
                fH: 4.0, fStd: 4.0, fHalf: [14.565, 19.5525], front: { l: 12.3609, c: 15.3033, r: 18.2457, top: 20.4246, rot: 0 } },
            "L": { x: 46.4989, top: 39.4793, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.315, abH: 41.94,
                fH: 4.0, fStd: 4.0, fHalf: [14.5788, 20.97], front: { l: 12.8619, c: 15.8043, r: 18.7468, top: 22.7119, rot: 0 } },
            "XL": { x: 45.8339, top: 40.174, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.455, abH: 42.675,
                fH: 4.0, fStd: 4.0, fHalf: [14.6137, 21.3375], front: { l: 13.5787, c: 16.5211, r: 19.4636, top: 23.0194, rot: 0 } },
            "2XL": { x: 45.239, top: 41.0489, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.62, abH: 43.495,
                fH: 4.0, fStd: 4.0, fHalf: [14.655, 21.7475], front: { l: 14.4846, c: 17.4271, r: 20.3695, top: 23.195, rot: 0 } },
            "3XL": { x: 43.794, top: 42.0374, rot: 180, numH: 8.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.135, abH: 44.505,
                fH: 4.0, fStd: 4.0, fHalf: [14.5338, 22.2525], front: { l: 15.1324, c: 18.0749, r: 21.0173, top: 24.0407, rot: 0 } }
        },
        "SLSB106G": {
            "YXS": { x: 49.945, top: 4.2749, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.45, abH: 20.66,
                fH: 3.0, fStd: 3.0, fHalf: [14.3625, 10.33], front: { l: 9.2474, c: 11.2673, r: 13.2872, top: 11.554, rot: 0 } },
            "YS": { x: 48.7908, top: 3.9002, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 56.925, abH: 21.775,
                fH: 3.0, fStd: 3.0, fHalf: [14.2313, 10.8875], front: { l: 9.5102, c: 11.5302, r: 13.5501, top: 11.3146, rot: 0 } },
            "YM": { x: 48.8603, top: 4.1175, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.745, abH: 24.01,
                fH: 3.0, fStd: 3.0, fHalf: [14.4363, 12.005], front: { l: 10.4549, c: 12.4749, r: 14.4948, top: 11.6417, rot: 0 } },
            "YL": { x: 47.5256, top: 3.9452, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.16, abH: 26.09,
                fH: 3.0, fStd: 3.0, fHalf: [14.29, 13.045], front: { l: 10.9385, c: 12.9585, r: 14.9784, top: 11.5724, rot: 0 } },
            "YXL": { x: 47.7908, top: 4.2052, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 58.05, abH: 28.34,
                fH: 3.0, fStd: 3.0, fHalf: [14.5125, 14.17], front: { l: 11.8449, c: 13.8649, r: 15.8848, top: 11.9275, rot: 0 } }
        },
        "SLSB106L": {
            "S": { x: 47.6375, top: 3.804, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.5, below: false, abW: 58.15, abH: 28.97,
                fH: 3.5, fStd: 4.0, fHalf: [14.5375, 14.485], front: { l: 12.0879, c: 14.5206, r: 16.9533, top: 13.1448, rot: 0 } },
            "M": { x: 47.4544, top: 6.1264, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.5, below: false, abW: 58.715, abH: 32.26,
                fH: 3.5, fStd: 4.0, fHalf: [14.6787, 16.13], front: { l: 13.4179, c: 15.8506, r: 18.2833, top: 15.6975, rot: 0 } },
            "L": { x: 46.3044, top: 5.5817, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.5, below: false, abW: 58.315, abH: 32.205,
                fH: 3.5, fStd: 4.0, fHalf: [14.5788, 16.1025], front: { l: 13.6429, c: 16.0756, r: 18.5083, top: 15.3984, rot: 0 } },
            "XL": { x: 45.4992, top: 6.1779, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.5, below: false, abW: 58.26, abH: 33.05,
                fH: 3.5, fStd: 4.0, fHalf: [14.565, 16.525], front: { l: 14.4629, c: 16.8956, r: 19.3283, top: 16.1999, rot: 0 } },
            "2XL": { x: 44.5594, top: 6.4578, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.5, below: false, abW: 58.19, abH: 34.12,
                fH: 3.5, fStd: 4.0, fHalf: [14.5475, 17.06], front: { l: 15.3079, c: 17.7406, r: 20.1733, top: 16.8256, rot: 0 } },
            "3XL": { x: 44.0669, top: 6.2977, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.5, below: false, abW: 58.315, abH: 35.495,
                fH: 3.5, fStd: 4.0, fHalf: [14.5788, 17.7475], front: { l: 15.9654, c: 18.3981, r: 20.8308, top: 16.9506, rot: 0 } }
        },
        "SLVB117G": {
            "YS": { x: 7.4161, top: 6.1768, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 56.8, abH: 23.87,
                fH: 5.0, fStd: 3.0, fHalf: [42.6, 11.935], front: { l: 46.2141, c: 49.0241, r: 51.8341, top: 11.6824, rot: 0 } },
            "YM": { x: 8.3825, top: 5.5742, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.815, abH: 25.105,
                fH: 5.0, fStd: 3.0, fHalf: [43.3613, 12.5525], front: { l: 46.8587, c: 49.6688, r: 52.4788, top: 11.029, rot: 0 } },
            "YL": { x: 9.0927, top: 5.9042, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.285, abH: 26.94,
                fH: 5.0, fStd: 3.0, fHalf: [43.7138, 13.47], front: { l: 46.9614, c: 49.7714, r: 52.5815, top: 11.3712, rot: 0 } },
            "YXL": { x: 10.0674, top: 19.1593, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.995, abH: 41.65,
                fH: 5.0, fStd: 3.0, fHalf: [43.4963, 20.825], front: { l: 34.1566, c: 36.9666, r: 39.7766, top: 24.7727, rot: 0 } }
        },
        // SLVB124G: same cut as SLVB117G, but the name goes ABOVE the number.
        // x / top / artboard measured from the vendor's SLVB124G print files (top = top of the name).
        "SLVB124G": {
            "YS": { x: 7.34, top: 4.65, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 56.73, abH: 23.3,
                fH: 5.0, fStd: 3.0, fHalf: [42.6, 11.935], front: { l: 46.2141, c: 49.0241, r: 51.8341, top: 11.6824, rot: 0 } },
            "YM": { x: 7.96, top: 4.67, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.45, abH: 24.88,
                fH: 5.0, fStd: 3.0, fHalf: [43.3613, 12.5525], front: { l: 46.8587, c: 49.6688, r: 52.4788, top: 11.029, rot: 0 } },
            "YL": { x: 8.62, top: 4.75, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.84, abH: 26.25,
                fH: 5.0, fStd: 3.0, fHalf: [43.7138, 13.47], front: { l: 46.9614, c: 49.7714, r: 52.5815, top: 11.3712, rot: 0 } },
            "YXL": { x: 9.58, top: 18.11, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.57, abH: 40.85,
                fH: 5.0, fStd: 3.0, fHalf: [43.4963, 20.825], front: { l: 34.1566, c: 36.9666, r: 39.7766, top: 24.7727, rot: 0 } }
        },
        "SLVB117L": {
            "S": { x: 9.342, top: 15.5218, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.44, abH: 38.01,
                fH: 5.0, fStd: 4.0, fHalf: [43.83, 19.005], front: { l: 46.9273, c: 49.7373, r: 52.5473, top: 21.0594, rot: 0 } },
            "M": { x: 10.4532, top: 23.3044, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.87, abH: 46.415,
                fH: 5.0, fStd: 4.0, fHalf: [44.1525, 23.2075], front: { l: 34.525, c: 37.335, r: 40.145, top: 28.8156, rot: 0 } },
            "L": { x: 10.7167, top: 26.7027, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.605, abH: 50.76,
                fH: 5.0, fStd: 4.0, fHalf: [43.9538, 25.38], front: { l: 32.6574, c: 35.4675, r: 38.2775, top: 32.4154, rot: 0 } },
            "XL": { x: 11.2765, top: 28.9152, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.26, abH: 53.525,
                fH: 5.0, fStd: 4.0, fHalf: [43.695, 26.7625], front: { l: 30.6474, c: 33.4574, r: 36.2674, top: 34.198, rot: 0 } },
            "2XL": { x: 13.0485, top: 36.7933, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 57.965, abH: 61.925,
                fH: 5.0, fStd: 4.0, fHalf: [43.4737, 30.9625], front: { l: 39.2783, c: 42.0883, r: 44.8983, top: 42.3154, rot: 0 } },
            "3XL": { x: 14.2891, top: 37.934, rot: 0, numH: 6.0, nameH: 2.0, gap: 1.0, below: false, abW: 58.72, abH: 64.415,
                fH: 5.0, fStd: 4.0, fHalf: [44.04, 32.2075], front: { l: 41.481, c: 44.2911, r: 47.1011, top: 43.5673, rot: 0 } }
        },
        "SLVB125G": {
            "YS": { x: 7.4114, top: 3.41, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.135, abH: 21.315,
                fH: 4.0, fStd: 3.0, fHalf: [42.8513, 10.6575], front: { l: 47.8919, c: 50.3884, r: 52.885, top: 14.0503, rot: 180 } },
            "YM": { x: 7.9445, top: 3.4137, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.675, abH: 23.19,
                fH: 4.0, fStd: 3.0, fHalf: [43.2563, 11.595], front: { l: 47.5625, c: 50.059, r: 52.5555, top: 14.7727, rot: 180 } },
            "YL": { x: 8.8573, top: 3.344, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.4, abH: 24.745,
                fH: 4.0, fStd: 3.0, fHalf: [43.05, 12.3725], front: { l: 46.4126, c: 48.9091, r: 51.4056, top: 16.8394, rot: 180 } },
            "YXL": { x: 9.7018, top: 3.3371, rot: 0, numH: 6.0, nameH: 1.5, gap: 1.0, below: false, abW: 57.565, abH: 26.355,
                fH: 4.0, fStd: 3.0, fHalf: [43.1738, 13.1775], front: { l: 45.7105, c: 48.2071, r: 50.7036, top: 19.02, rot: 180 } }
        },
        "SLVB125L": {
            "S": { x: 49.038, top: 3.375, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.0, below: false, abW: 57.7, abH: 27.485,
                fH: 4.0, fStd: 4.0, fHalf: [14.425, 13.7425], front: { l: 6.3268, c: 8.8429, r: 11.359, top: 19.7741, rot: 180 } },
            "M": { x: 9.5839, top: 3.2755, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.0, below: false, abW: 57.275, abH: 27.9,
                fH: 4.0, fStd: 4.0, fHalf: [42.9562, 13.95], front: { l: 45.5714, c: 48.0875, r: 50.6036, top: 19.8998, rot: 180 } },
            "L": { x: 10.1087, top: 3.3371, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.0, below: false, abW: 57.705, abH: 28.675,
                fH: 4.0, fStd: 4.0, fHalf: [43.2787, 14.3375], front: { l: 45.13, c: 47.6461, r: 50.1621, top: 20.9101, rot: 180 } },
            "XL": { x: 10.577, top: 3.4898, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.0, below: false, abW: 57.87, abH: 29.11,
                fH: 4.0, fStd: 4.0, fHalf: [43.4025, 14.555], front: { l: 44.9062, c: 47.4223, r: 49.9384, top: 18.992, rot: 180 } },
            "2XL": { x: 12.1916, top: 4.1323, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.0, below: false, abW: 57.84, abH: 37.145,
                fH: 4.0, fStd: 4.0, fHalf: [43.38, 18.5725], front: { l: 43.2254, c: 45.7414, r: 48.2575, top: 27.7224, rot: 180 } },
            "3XL": { x: 13.2001, top: 14.4146, rot: 0, numH: 8.5, nameH: 2.5, gap: 1.0, below: false, abW: 57.76, abH: 41.33,
                fH: 4.0, fStd: 4.0, fHalf: [43.32, 20.665], front: { l: 42.1869, c: 44.703, r: 47.2191, top: 33.2312, rot: 180 } }
        }
    };
    // SKUs that share a cut pattern with a measured SKU (Standards workbook)
    var BASE_ALIAS = { SLSC101: "SLBA101", SLMS126: "SLBA101", SLVB131: "SLSB106", SLSC112: "SLBB112",
                       SLMS127: "SLBB112", SLVB124: "SLVB117", SLVB118: "SLVB125",
                       SLSC102: "SLSB102", SLSC122: "SLSB102" };
    var FULL_ALIAS = { SLSC102L: "SLSB102L" };
    var SIZE_ORDER = ["YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
    var SKU_LIST = [];
    for (var sk in PRESETS) if (PRESETS.hasOwnProperty(sk)) SKU_LIST.push(sk);
    SKU_LIST.sort();
    function sizesOf(sku) {
        var out = [], p = PRESETS[sku];
        if (!p) return out;
        for (var i = 0; i < SIZE_ORDER.length; i++) if (p.hasOwnProperty(SIZE_ORDER[i])) out.push(SIZE_ORDER[i]);
        for (var s in p) if (p.hasOwnProperty(s) && indexOf(out, s) < 0) out.push(s);
        return out;
    }
    function indexOf(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return i; return -1; }

    // ------------------------------------------------------------------ stock swatches
    // From SquadLocker_2023_SwatchLibrary.ase — all CMYK spot colors (percent values).
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

    // ------------------------------------------------------------------ step log
    try { LOG_FILE.encoding = "UTF-8"; LOG_FILE.open("w"); LOG_FILE.writeln("Live Text Builder run " + new Date()); LOG_FILE.close(); } catch (e) {}
    function log(msg) {
        try { LOG_FILE.open("a"); LOG_FILE.writeln(msg); LOG_FILE.close(); } catch (e) {}
    }

    // ------------------------------------------------------------------ helpers
    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
    function num(s, fb) { var n = parseFloat(String(s).replace(",", ".")); return isNaN(n) ? fb : n; }
    function clone(o) { return eval(o.toSource()); }
    function round(n, d) { var p = Math.pow(10, d || 0); return Math.round(n * p) / p; }

    function mergeDefaults(target, defs) {
        for (var k in defs) {
            if (!defs.hasOwnProperty(k)) continue;
            if (target[k] === undefined) target[k] = clone({ v: defs[k] }).v;
            else if (typeof defs[k] === "object" && defs[k] !== null && !(defs[k] instanceof Array) &&
                     typeof target[k] === "object") mergeDefaults(target[k], defs[k]);
        }
        return target;
    }

    // ------------------------------------------------------------------ fonts
    function styleRank(s) {
        var t = s.toLowerCase(), r = 50;
        var w = [["hairline", 5], ["thin", 10], ["extralight", 20], ["ultralight", 20], ["extra light", 20],
                 ["light", 30], ["book", 38], ["regular", 40], ["roman", 40], ["normal", 40], ["medium", 50],
                 ["semibold", 60], ["semi bold", 60], ["demibold", 60], ["demi", 60], ["extrabold", 80],
                 ["extra bold", 80], ["ultrabold", 80], ["heavy", 85], ["black", 90], ["ultra", 95], ["bold", 70]];
        for (var i = 0; i < w.length; i++) if (t.indexOf(w[i][0]) >= 0) { r = w[i][1]; break; }
        if (t.indexOf("italic") >= 0 || t.indexOf("oblique") >= 0) r += 1;
        if (t.indexOf("condensed") >= 0 || t.indexOf("narrow") >= 0 || t.indexOf("compressed") >= 0) r += 200;
        if (t.indexOf("extended") >= 0 || t.indexOf("expanded") >= 0 || t.indexOf("wide") >= 0) r += 300;
        return r;
    }

    var FAMILIES = [], FONT_INDEX = {};   // FONT_INDEX[psName] = [famIdx, styleIdx]
    (function () {
        var map = {}, tf = app.textFonts, n = tf.length;
        for (var i = 0; i < n; i++) {
            try {
                var f = tf[i], fam = f.family, sty = f.style, nm = f.name;
                if (!map.hasOwnProperty(fam)) { map[fam] = { family: fam, lower: fam.toLowerCase(), styles: [] }; FAMILIES.push(map[fam]); }
                map[fam].styles.push({ style: sty, name: nm, rank: styleRank(sty) });
            } catch (e) {}
        }
        FAMILIES.sort(function (a, b) { return a.lower < b.lower ? -1 : a.lower > b.lower ? 1 : 0; });
        for (var j = 0; j < FAMILIES.length; j++) {
            FAMILIES[j].styles.sort(function (a, b) {
                return a.rank !== b.rank ? a.rank - b.rank : (a.style < b.style ? -1 : 1);
            });
            for (var k = 0; k < FAMILIES[j].styles.length; k++) FONT_INDEX[FAMILIES[j].styles[k].name] = [j, k];
        }
    })();

    function defaultFontName() {
        var prefs = ["ArialMT", "Helvetica", "MyriadPro-Regular"];
        for (var p = 0; p < prefs.length; p++) if (FONT_INDEX.hasOwnProperty(prefs[p])) return prefs[p];
        return FAMILIES.length ? FAMILIES[0].styles[0].name : "";
    }

    // ------------------------------------------------------------------ colors
    // Color specs (plain objects so they can be saved/restored):
    //   {kind:"none"} | {kind:"lib",name} | {kind:"swatch",name} | {kind:"cmyk",v:[c,m,y,k]}
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
    function specLabel(spec) {
        if (spec.kind === "none") return "[None]";
        if (spec.kind === "lib") return spec.name;
        if (spec.kind === "swatch") return spec.name + "  (document)";
        if (spec.kind === "cmyk") return "Custom  C" + spec.v[0] + " M" + spec.v[1] + " Y" + spec.v[2] + " K" + spec.v[3];
        return "?";
    }
    function specEquals(a, b) {
        if (!a || !b || a.kind !== b.kind) return false;
        if (a.kind === "none") return true;
        if (a.kind === "lib" || a.kind === "swatch") return a.name === b.name;
        for (var i = 0; i < 4; i++) if (round(a.v[i], 2) !== round(b.v[i], 2)) return false;
        return true;
    }
    function askCMYK(initial) {
        var v = initial && initial.kind === "cmyk" ? initial.v : [0, 0, 0, 0];
        var d = new Window("dialog", "Custom CMYK");
        d.alignChildren = ["fill", "top"];
        var g = d.add("group");
        var labels = ["C", "M", "Y", "K"], fields = [];
        for (var i = 0; i < 4; i++) {
            g.add("statictext", undefined, labels[i]);
            fields[i] = g.add("edittext", undefined, String(v[i]));
            fields[i].characters = 5;
        }
        d.add("statictext", undefined, "Percent, 0\u2013100");
        var bg = d.add("group"); bg.alignment = "right";
        bg.add("button", undefined, "Cancel", { name: "cancel" });
        var ok = bg.add("button", undefined, "OK", { name: "ok" });
        var out = null;
        ok.onClick = function () {
            var vals = [];
            for (var i = 0; i < 4; i++) {
                var n = num(fields[i].text, NaN);
                if (!(n >= 0 && n <= 100)) { alert(labels[i] + " must be between 0 and 100."); return; }
                vals.push(round(n, 2));
            }
            out = { kind: "cmyk", v: vals };
            d.close(1);
        };
        fields[0].active = true;
        d.show();
        return out;
    }

    // ------------------------------------------------------------------ settings (remembered)
    function preferredFont(ps) { return FONT_INDEX.hasOwnProperty(ps) ? ps : defaultFontName(); }
    var DEFAULTS = {
        name:   { text: "NAME", font: defaultFontName(), sw: 20,
                  fill: { kind: "lib", name: "SquadWhite" }, stroke: { kind: "lib", name: "SquadBlack" } },
        number: { text: "00", font: defaultFontName(), sw: 20,
                  fill: { kind: "lib", name: "SquadWhite" }, stroke: { kind: "lib", name: "SquadBlack" } },
        front:  { linked: true, font: defaultFontName(), sw: 20, align: "right",
                  fill: { kind: "lib", name: "SquadWhite" }, stroke: { kind: "lib", name: "SquadBlack" } },
        includeBack: true, includeFront: true, tab: 0,
        perSkuFront: {},           // custom front heights remembered per SKU
        mode: "preset",            // preset | artboard | selection
        hideOriginal: true,
        lastSku: SKU_LIST[0], lastSize: "M",
        manual: { nameH: 2, numH: 8, gap: 1, below: false, rot: 0 },   // sizes when no preset is used
        perSku: {},                // custom sizes remembered per SKU
        sw20: true
    };
    function loadSaved() {
        try {
            if (SETTINGS_FILE.exists) {
                SETTINGS_FILE.encoding = "UTF-8";
                SETTINGS_FILE.open("r"); var s = SETTINGS_FILE.read(); SETTINGS_FILE.close();
                var o = eval(s);
                if (o && typeof o === "object") {
                    if (!o.sw20) {   // one-time switch to the new 20 pt default stroke
                        if (o.name) o.name.sw = 20;
                        if (o.number) o.number.sw = 20;
                        if (o.front) o.front.sw = 20;
                        o.sw20 = true;
                    }
                    return mergeDefaults(o, DEFAULTS);
                }
            }
        } catch (e) {}
        return clone(DEFAULTS);
    }
    function saveSettings(st) {
        try {
            SETTINGS_FILE.encoding = "UTF-8";
            SETTINGS_FILE.open("w"); SETTINGS_FILE.write(st.toSource()); SETTINGS_FILE.close();
        } catch (e) {}
    }
    var settings = loadSaved();

    // ------------------------------------------------------------------ detection
    function activeArtboardRect() { return doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect; }
    var AB = activeArtboardRect();
    var AB_W = (AB[2] - AB[0]) / PT_PER_IN, AB_H = (AB[1] - AB[3]) / PT_PER_IN;

    function normSize(t) {
        t = String(t).toUpperCase();
        var map = { XXL: "2XL", XXXL: "3XL", XXXXL: "4XL", "2X": "2XL", "3X": "3XL", "4X": "4XL",
                    SM: "S", SMALL: "S", MED: "M", MEDIUM: "M", LG: "L", LARGE: "L" };
        return map.hasOwnProperty(t) ? map[t] : t;
    }
    function resolveSku(full) {
        full = full.toUpperCase();
        if (PRESETS[full]) return { sku: full, via: "" };
        if (FULL_ALIAS[full] && PRESETS[FULL_ALIAS[full]]) return { sku: FULL_ALIAS[full], via: full };
        var base = full.substr(0, 7), suf = full.substr(7);
        if (BASE_ALIAS[base] && PRESETS[BASE_ALIAS[base] + suf]) return { sku: BASE_ALIAS[base] + suf, via: full };
        return null;
    }
    function artboardDiff(p) { return Math.max(Math.abs(p.abW - AB_W), Math.abs(p.abH - AB_H)); }
    function detect() {
        var name = doc.name.replace(/\.[^.]+$/, "");
        var tokens = name.split(/[_\s]+/);
        var size = tokens.length ? normSize(tokens[tokens.length - 1]) : "";
        var m = name.match(/(SL[A-Z]{2}\d{3})([AYGL])/i);
        var res = m ? resolveSku(m[1] + m[2]) : null;
        // file named with an adult SKU but a youth size (e.g. "..._SLBA103A_YM")
        if (res && !PRESETS[res.sku][size] && size.charAt(0) === "Y") {
            var alt = resolveSku(m[1] + "Y");
            if (alt && PRESETS[alt.sku][size]) res = alt;
        }
        if (res && PRESETS[res.sku][size]) {
            return { sku: res.sku, size: size, how: "file name", via: res.via };
        }
        // fallback: artboard size (+ size from the name when it is a known size)
        var best = null, bestD = 1e9, knownSize = indexOf(SIZE_ORDER, size) >= 0;
        for (var i = 0; i < SKU_LIST.length; i++) {
            var sz = PRESETS[SKU_LIST[i]];
            for (var s in sz) {
                if (!sz.hasOwnProperty(s)) continue;
                if (knownSize && s !== size) continue;
                var d = artboardDiff(sz[s]);
                if (d < bestD) { bestD = d; best = { sku: SKU_LIST[i], size: s }; }
            }
        }
        if (best && bestD <= (knownSize ? 0.15 : 0.05))
            return { sku: best.sku, size: best.size, how: knownSize ? "artboard size + size in file name" : "artboard size", via: "" };
        return null;
    }
    var DETECTED = detect();
    log("file " + doc.name + " | artboard " + round(AB_W, 3) + " x " + round(AB_H, 3) +
        " | detected " + (DETECTED ? DETECTED.sku + " " + DETECTED.size + " via " + DETECTED.how : "nothing"));

    // ------------------------------------------------------------------ selection / edit mode
    var origSel = [];
    try { for (var s0 = 0; s0 < doc.selection.length; s0++) origSel.push(doc.selection[s0]); } catch (e) {}
    var editGroup = null, editData = null;
    if (origSel.length === 1 && origSel[0].typename === "GroupItem") {
        var nt = "";
        try { nt = origSel[0].note; } catch (e) {}
        if (nt && nt.indexOf(TAG) === 0) {
            try { editData = eval(nt.substr(TAG.length)); editGroup = origSel[0]; } catch (e) { editGroup = null; }
        }
    }
    var hasArtSelection = !editGroup && origSel.length > 0;
    function buildColorRow(parent, label, allowNone, initialSpec) {
        var g = parent.add("group");
        g.add("statictext", undefined, label).preferredSize.width = LBL;
        var dd = g.add("dropdownlist");
        dd.preferredSize.width = 200;
        var it, i;
        if (allowNone) { it = dd.add("item", "[None]"); it.spec = { kind: "none" }; }
        for (i = 0; i < LIBRARY.length; i++) { it = dd.add("item", LIBRARY[i].name); it.spec = { kind: "lib", name: LIBRARY[i].name }; }
        var btn = g.add("button", undefined, "CMYK\u2026");
        btn.preferredSize.width = 70;
        btn.helpTip = "Enter a custom CMYK color";

        function select(spec) {
            for (var i = 0; i < dd.items.length; i++)
                if (dd.items[i].spec && specEquals(dd.items[i].spec, spec)) { dd.selection = i; return; }
            if (spec.kind === "cmyk") { var it = dd.add("item", specLabel(spec)); it.spec = spec; dd.selection = it; return; }
            // unknown/removed swatch or old RGB spec: fall back to first real color
            for (var j = 0; j < dd.items.length; j++) if (dd.items[j].spec && dd.items[j].spec.kind !== "none") { dd.selection = j; return; }
        }
        btn.onClick = function () {
            var sp = askCMYK(dd.selection ? dd.selection.spec : null);
            if (sp) select(sp);
        };
        select(initialSpec);
        return { group: g, get: function () { return dd.selection && dd.selection.spec ? dd.selection.spec : { kind: "none" }; } };
    }

    // Type-to-filter font picker: a text field with the family list right under it.
    // Empty field = every installed family. Typing narrows to families that START with
    // what you typed. Up/Down arrows move through the list, Return accepts.
    // Type-to-filter font picker.
    // The search box is ONLY a filter: picking a font never writes into it (on the Mac,
    // writing into it counted as typing and rebuilt the list mid-click, which swallowed
    // clicks). The picked family is shown in its own label, and the list is rebuilt
    // only when the search text really changes.
    function buildFontPicker(parent, initialName, sampleText) {
        var top = parent.add("group");
        top.add("statictext", undefined, "Font:").preferredSize.width = LBL;
        var search = top.add("edittext", undefined, "");
        search.preferredSize.width = 220;
        search.helpTip = "Type to filter (matches the start of the family name). Click a font, or use \u2191/\u2193 and Return.";
        var styDD = top.add("dropdownlist");
        styDD.preferredSize.width = 150;

        var mid = parent.add("group"); mid.alignChildren = ["left", "top"];
        mid.add("statictext", undefined, "").preferredSize.width = LBL;
        var list = mid.add("listbox", undefined, [], { multiselect: false });
        list.preferredSize = [220, 104];
        var side = mid.add("group"); side.orientation = "column"; side.alignChildren = ["left", "top"]; side.spacing = 2;
        side.add("statictext", undefined, "Selected:");
        var picked = side.add("statictext", undefined, ""); picked.preferredSize.width = 150;
        try { picked.graphics.font = ScriptUI.newFont("dialog", "BOLD", 12); } catch (e) {}
        var count = side.add("statictext", undefined, ""); count.preferredSize.width = 150;

        var pv = parent.add("group");
        pv.add("statictext", undefined, "").preferredSize.width = LBL;
        var preview = pv.add("statictext", undefined, sampleText);
        preview.preferredSize = [380, 34];

        var chosen = -1, suppress = false, lastFilter = null, filledText = null;

        function fillStyles(famIdx, keepName, keepStyle) {
            styDD.removeAll();
            var st = FAMILIES[famIdx].styles, sel = -1, regular = -1;
            for (var i = 0; i < st.length; i++) {
                styDD.add("item", st[i].style);
                if (keepName && st[i].name === keepName) sel = i;
                if (sel < 0 && keepStyle && st[i].style === keepStyle) sel = i;
                if (regular < 0 && /^(regular|roman|book|normal)$/i.test(st[i].style)) regular = i;
            }
            styDD.selection = sel >= 0 ? sel : (regular >= 0 ? regular : 0);
        }
        function currentFont() {
            if (chosen < 0 || !styDD.selection) return null;
            return FAMILIES[chosen].styles[styDD.selection.index];
        }
        function updatePreview() {
            var f = currentFont();
            if (!f) return;
            try { preview.graphics.font = ScriptUI.newFont(f.name, "REGULAR", 24); } catch (e) {}
        }
        function choose(famIdx, keepName) {
            if (famIdx === chosen && !keepName) return;
            var keepStyle = styDD.selection ? styDD.selection.text : null;
            chosen = famIdx;
            picked.text = FAMILIES[famIdx].family;
            fillStyles(famIdx, keepName, keepStyle);
            updatePreview();
        }
        function populate(filter, autoPick) {
            var f = trim(filter).toLowerCase();
            if (f === lastFilter) return;          // nothing changed: leave the list alone
            lastFilter = f;
            var sel = null, first = null, n = 0;
            suppress = true;
            list.removeAll();
            for (var i = 0; i < FAMILIES.length; i++) {
                if (f && FAMILIES[i].lower.indexOf(f) !== 0) continue;
                var it = list.add("item", FAMILIES[i].family);
                it.famIdx = i;
                if (!first) first = it;
                if (i === chosen) sel = it;
                n++;
            }
            count.text = f ? (n + (n === 1 ? " match" : " matches")) : (n + " families");
            // while typing, the top match becomes the pick (like Illustrator's font field)
            var pick = (autoPick && f) ? first : sel;
            if (pick) {
                list.selection = pick;
                try { list.revealItem(pick); } catch (e) {}
                choose(pick.famIdx, null);
            }
            suppress = false;
        }

        // Clicking a font fills the box with its name. The box remembers that it was
        // filled by the script (filledText), so that text is never treated as a new
        // search and the list stays as it was under your click.
        function fillBox(famIdx) {
            filledText = FAMILIES[famIdx].family;
            search.text = filledText;
        }
        list.onChange = function () {
            if (suppress || !list.selection) return;
            choose(list.selection.famIdx, null);
            fillBox(list.selection.famIdx);
        };
        styDD.onChange = updatePreview;
        search.onChanging = function () {
            if (filledText !== null && search.text === filledText) return;   // our own fill, not typing
            filledText = null;
            populate(search.text, true);
        };
        search.addEventListener("keydown", function (e) {
            var k = e.keyName;
            if (k === "Down" || k === "Up") {
                if (!list.items.length) return;
                var i = list.selection ? list.selection.index : -1;
                i = k === "Down" ? Math.min(i + 1, list.items.length - 1) : Math.max(i - 1, 0);
                suppress = true;
                list.selection = i;
                try { list.revealItem(list.items[i]); } catch (x) {}
                suppress = false;
                choose(list.items[i].famIdx, null);
                e.preventDefault();
            } else if (k === "Enter" || k === "Return") {
                if (list.selection) fillBox(list.selection.famIdx);
                e.preventDefault();
            }
        });

        var idx = FONT_INDEX[initialName] || FONT_INDEX[defaultFontName()] || null;
        if (idx) choose(idx[0], FAMILIES[idx[0]].styles[idx[1]].name);
        populate("", false);   // full list, current family selected and scrolled into view

        return {
            get: function () { var f = currentFont(); return f ? f.name : ""; },
            setSample: function (t) { preview.text = t; }
        };
    }

    // ------------------------------------------------------------------ UI
    function field(parent, label, value, chars, unit, labelW) {
        var g = parent.add("group");
        g.add("statictext", undefined, label).preferredSize.width = labelW || LBL;
        var e = g.add("edittext", undefined, String(value)); e.characters = chars || 6;
        if (unit) g.add("statictext", undefined, unit);
        return e;
    }
    function styleBlock(parent, st, sample) {     // font + colors + stroke weight
        var font = buildFontPicker(parent, st.font, sample);
        var fill = buildColorRow(parent, "Fill:", false, st.fill);
        var stroke = buildColorRow(parent, "Stroke:", true, st.stroke);
        var row = parent.add("group");
        row.add("statictext", undefined, "Stroke wt:").preferredSize.width = LBL;
        var sw = row.add("edittext", undefined, String(st.sw)); sw.characters = 5;
        row.add("statictext", undefined, "pt  (half shows outside the letters)");
        return { font: font, get: function () { return { font: font.get(), fill: fill.get(), stroke: stroke.get(), sw: num(sw.text, NaN) }; } };
    }
    function heightRow(parent) {
        var row = parent.add("group");
        row.add("statictext", undefined, "Height:").preferredSize.width = LBL;
        var h = row.add("edittext", undefined, ""); h.characters = 6;
        row.add("statictext", undefined, "in  (glyph + stroke; standard prefilled)");
        return h;
    }

    log("building dialog (" + FAMILIES.length + " font families)");
    var w = new Window("dialog", editGroup ? "Live Text Builder \u2014 Edit" : "Live Text Builder");
    w.orientation = "column"; w.alignChildren = ["fill", "top"]; w.spacing = 8;

    // --- row 1: SKU / size / status / buttons (always visible)
    var top = w.add("group"); top.alignChildren = ["left", "center"];
    top.add("statictext", undefined, "SKU:");
    var skuDD = top.add("dropdownlist", undefined, SKU_LIST); skuDD.preferredSize.width = 110;
    top.add("statictext", undefined, "Size:");
    var sizeDD = top.add("dropdownlist"); sizeDD.preferredSize.width = 70;
    var status = top.add("statictext", undefined, "", { multiline: true });
    status.preferredSize = [560, 34];
    var btns = top.add("group"); btns.alignment = ["right", "center"];
    btns.add("button", undefined, "Cancel", { name: "cancel" });
    // Not named "ok": Return in a font field must not trigger Generate.
    var okBtn = btns.add("button", undefined, editGroup ? "Rebuild" : "Generate", { name: "generate" });

    // --- row 2: the text (typed once) + what to make
    var src = editData || settings;
    var tr = w.add("panel"); tr.orientation = "row"; tr.alignChildren = ["left", "center"]; tr.margins = [12, 10, 12, 8];
    tr.add("statictext", undefined, "Name:");
    var nameTxt = tr.add("edittext", undefined, src.name.text); nameTxt.preferredSize.width = 240;
    tr.add("statictext", undefined, "   Number:");
    var numTxt = tr.add("edittext", undefined, src.number.text); numTxt.preferredSize.width = 80;
    tr.add("statictext", undefined, "      Make:");
    var cbBack = tr.add("checkbox", undefined, "Back name + number");
    var cbFront = tr.add("checkbox", undefined, "Front number");
    cbBack.value = editData ? editData.part === "back" : !!settings.includeBack;
    cbFront.value = editData ? editData.part === "front" : !!settings.includeFront;

    // --- tabs
    // --- BACK / FRONT tabs (caps, larger bold labels that also show whether each part is on)
    var tabs = w.add("tabbedpanel"); tabs.alignChildren = ["fill", "top"];
    var tBack = tabs.add("tab", undefined, "BACK \u2014 NAME + NUMBER");
    var tFront = tabs.add("tab", undefined, "FRONT \u2014 NUMBER");
    try { var TABFONT = ScriptUI.newFont("dialog", "BOLD", 14); tabs.graphics.font = TABFONT; tBack.graphics.font = TABFONT; tFront.graphics.font = TABFONT; } catch (e) {}
    tBack.orientation = tFront.orientation = "column";
    tBack.alignChildren = tFront.alignChildren = ["fill", "top"];
    tBack.margins = tFront.margins = [10, 14, 10, 8];

    // BACK tab
    var bl = tBack.add("group"); bl.orientation = "row"; bl.alignChildren = ["fill", "top"];
    var pName = bl.add("panel", undefined, "Name style");
    var pNum = bl.add("panel", undefined, "Number style");
    var allP = [pName, pNum];
    for (var ap = 0; ap < allP.length; ap++) {
        allP[ap].orientation = "column"; allP[ap].alignChildren = ["left", "top"]; allP[ap].margins = [12, 16, 12, 8]; allP[ap].spacing = 5;
    }
    var NAME = styleBlock(pName, src.name, src.name.text);
    var nameH = heightRow(pName);
    var NUMBER = styleBlock(pNum, src.number, src.number.text);
    var numH = heightRow(pNum);

    var lay = tBack.add("group"); lay.orientation = "row"; lay.alignChildren = ["fill", "top"];
    var sp = lay.add("panel", undefined, "Stacking");
    sp.orientation = "column"; sp.alignChildren = ["left", "top"]; sp.margins = [12, 16, 12, 8]; sp.spacing = 5;
    var gapField = field(sp, "Gap:", "", 6, "in  (stroke edge to stroke edge)");
    var pg = sp.add("group");
    pg.add("statictext", undefined, "Name:").preferredSize.width = LBL;
    var posDD = pg.add("dropdownlist", undefined, ["Above number", "Below number"]); posDD.preferredSize.width = 130; posDD.selection = 0;
    var rg = sp.add("group");
    var customNote = rg.add("statictext", undefined, ""); customNote.preferredSize.width = 250;
    var resetBtn = rg.add("button", undefined, "Reset to standard");

    var pp = lay.add("panel", undefined, "Back placement");
    pp.orientation = "column"; pp.alignChildren = ["left", "top"]; pp.margins = [12, 16, 12, 8]; pp.spacing = 5;
    var mg = pp.add("group");
    var rbPreset = mg.add("radiobutton", undefined, "SKU / size preset");
    var rbArt = mg.add("radiobutton", undefined, "Artboard center");
    var rbSel = mg.add("radiobutton", undefined, "Selection center");
    rbSel.enabled = hasArtSelection;
    var cg = pp.add("group");
    cg.add("statictext", undefined, "X:");
    var xField = cg.add("edittext", undefined, ""); xField.characters = 7;
    cg.add("statictext", undefined, "in    Top Y:");
    var yField = cg.add("edittext", undefined, ""); yField.characters = 7;
    cg.add("statictext", undefined, "in    Rotation:");
    var rotDD = cg.add("dropdownlist", undefined, ["0\u00B0", "180\u00B0"]); rotDD.preferredSize.width = 64; rotDD.selection = 0;
    xField.helpTip = "Horizontal center of the group, inches from the artboard's left edge.";
    yField.helpTip = "Garment-top edge of the group (top of the name, or of the number when the name is below),\ninches down from the artboard top. This edge stays put when sizes change.";
    var cbHide = pp.add("checkbox", undefined, "Hide the selected artwork after placing (non-destructive)");
    cbHide.value = !!settings.hideOriginal; cbHide.enabled = hasArtSelection;

    // FRONT tab
    var fl = tFront.add("group"); fl.orientation = "row"; fl.alignChildren = ["fill", "top"];
    var pfs = fl.add("panel", undefined, "Front number style");
    pfs.orientation = "column"; pfs.alignChildren = ["left", "top"]; pfs.margins = [12, 16, 12, 8]; pfs.spacing = 5;
    var cbLink = pfs.add("checkbox", undefined, "Same font, colors and stroke as the back number");
    var fStyleGrp = pfs.add("group"); fStyleGrp.orientation = "column"; fStyleGrp.alignChildren = ["left", "top"]; fStyleGrp.spacing = 5;
    var fsrc = editData && editData.front ? editData.front : settings.front;
    var FRONT = styleBlock(fStyleGrp, fsrc, src.number.text);
    var fH = heightRow(pfs);
    cbLink.value = fsrc.linked !== false;

    var pfp = fl.add("panel", undefined, "Front placement");
    pfp.orientation = "column"; pfp.alignChildren = ["left", "top"]; pfp.margins = [12, 16, 12, 8]; pfp.spacing = 6;
    var ag = pfp.add("group");
    ag.add("statictext", undefined, "Alignment:").preferredSize.width = LBL;
    var alignDD = ag.add("dropdownlist", undefined, ["Right", "Center", "Left"]); alignDD.preferredSize.width = 90;
    var fg = pfp.add("group");
    var fxLabel = fg.add("statictext", undefined, "Right edge X:"); fxLabel.preferredSize.width = 86;
    var fxField = fg.add("edittext", undefined, ""); fxField.characters = 7;
    fg.add("statictext", undefined, "in");
    var fg2 = pfp.add("group");
    fg2.add("statictext", undefined, "Top Y:").preferredSize.width = 86;
    var fyField = fg2.add("edittext", undefined, ""); fyField.characters = 7;
    fg2.add("statictext", undefined, "in    Rotation:");
    var fRotDD = fg2.add("dropdownlist", undefined, ["0\u00B0", "180\u00B0"]); fRotDD.preferredSize.width = 64; fRotDD.selection = 0;
    var fSrcNote = pfp.add("statictext", undefined, "", { multiline: true }); fSrcNote.preferredSize = [330, 46];
    var fReset = pfp.add("button", undefined, "Reset front to standard");
    fyField.helpTip = "Garment-top edge of the front number, inches down from the artboard top.";

    // ------------------------------------------------------------------ behaviour
    function presetFor(sku, size) { return PRESETS[sku] && PRESETS[sku][size] ? PRESETS[sku][size] : null; }
    function currentSku() { return skuDD.selection ? skuDD.selection.text : null; }
    function currentSize() { return sizeDD.selection ? sizeDD.selection.text : null; }
    function currentPreset() { return presetFor(currentSku(), currentSize()); }
    function fmt(v) { return String(round(v, 4)); }
    function alignKey() { return ["right", "center", "left"][alignDD.selection ? alignDD.selection.index : 0]; }

    // back sizes
    function setSizes(vals) {
        numH.text = fmt(vals.numH); nameH.text = fmt(vals.nameH); gapField.text = fmt(vals.gap);
        posDD.selection = vals.below ? 1 : 0;
    }
    function standardSizes() {
        var p = currentPreset();
        return p ? { numH: p.numH, nameH: p.nameH, gap: p.gap, below: p.below } : clone(settings.manual);
    }
    function refreshCustomNote() {
        var c = settings.perSku[currentSku()];
        customNote.text = (rbPreset.value && c) ? "Custom sizes remembered for " + currentSku() : "";
        resetBtn.enabled = rbPreset.value && !!c;
    }

    // front placement: anchor X for the chosen alignment, in artboard terms
    var frontAuto = true;   // fields follow alignment / height until the user types in them
    function frontStdHeight() {
        var p = currentPreset();
        if (p) return p.fH;
        var sku = currentSku() || "";
        return /[YG]$/.test(sku) ? 3 : 4;
    }
    function frontHalf() {
        var p = currentPreset();
        if (p) return { x: p.fHalf[0], y: p.fHalf[1] };
        return { x: AB_W / 4, y: AB_H / 2 };      // unknown file: assume the front is the left half
    }
    function computeFront() {
        var p = currentPreset(), a = alignKey(), h = num(fH.text, frontStdHeight());
        var f = p ? p.front : null, out = {};
        if (f) {
            // garment right is artboard left when the piece is upside down
            var gr = f.rot === 180 ? f.l : f.r, gl = f.rot === 180 ? f.r : f.l;
            out.x = a === "right" ? gr : (a === "left" ? gl : f.c);
            out.top = f.top; out.rot = f.rot; out.src = "file";
        } else {
            var c = frontHalf(), half = ZERO_RATIO * h / 2;
            out.x = a === "right" ? c.x + half : (a === "left" ? c.x - half : c.x);
            out.top = c.y - h / 2; out.rot = 0; out.src = "fallback";
        }
        return out;
    }
    function refreshFrontFields(force) {
        var a = alignKey();
        fxLabel.text = a === "right" ? "Right edge X:" : (a === "left" ? "Left edge X:" : "Center X:");
        var c = computeFront();
        if (force || frontAuto) {
            fxField.text = fmt(c.x); fyField.text = fmt(c.top); fRotDD.selection = c.rot === 180 ? 1 : 0;
        }
        var custom = settings.perSkuFront[currentSku()];
        fSrcNote.text = (c.src === "file" ? "Position from the print-file data (rough \u2014 varies by design)." :
                         "No front data for this SKU / size: centered on the front half; \"00\" sits centered and longer numbers grow into the open side.") +
                        (custom !== undefined ? "  Custom front height remembered for " + currentSku() + "." : "");
    }
    function loadFront() {
        var custom = settings.perSkuFront[currentSku()];
        fH.text = fmt(custom !== undefined ? custom : frontStdHeight());
        frontAuto = true;
        refreshFrontFields(true);
    }
    fxField.onChanging = fyField.onChanging = function () { frontAuto = false; };
    fRotDD.onChange = function () { frontAuto = false; };
    alignDD.onChange = function () { frontAuto = true; refreshFrontFields(true); updateHint(); };
    fH.onChanging = function () { if (computeFront().src === "fallback") refreshFrontFields(false); updateHint(); };
    fReset.onClick = function () { delete settings.perSkuFront[currentSku()]; loadFront(); };
    cbLink.onClick = function () { fStyleGrp.enabled = cbFront.value && !cbLink.value; };

    function refreshStatus() {
        var p = currentPreset(), msg = "";
        if (DETECTED) {
            msg = "Detected " + DETECTED.sku + " " + DETECTED.size + " from " + DETECTED.how +
                  (DETECTED.via ? " (" + DETECTED.via + " shares this cut pattern)" : "") + ". ";
        } else {
            msg = "Couldn't detect the SKU from the file name or artboard \u2014 check the selection. ";
        }
        if (p) {
            var d = artboardDiff(p);
            msg += d <= 0.1 ? "Artboard matches." :
                   "\u26A0 Artboard is " + round(AB_W, 2) + " \u00D7 " + round(AB_H, 2) + " in; preset expects " +
                   p.abW + " \u00D7 " + p.abH + " in.";
        }
        status.text = msg;
    }
    function loadPreset() {
        var p = currentPreset();
        if (p && rbPreset.value) {
            xField.text = fmt(p.x); yField.text = fmt(p.top); rotDD.selection = p.rot === 180 ? 1 : 0;
        }
        var c = settings.perSku[currentSku()];
        if (rbPreset.value) setSizes(c || standardSizes());
        loadFront();
        refreshCustomNote(); refreshStatus();
    }
    function fillSizeDD(keep) {
        sizeDD.removeAll();
        var sz = sizesOf(currentSku()), sel = 0;
        for (var i = 0; i < sz.length; i++) { sizeDD.add("item", sz[i]); if (sz[i] === keep) sel = i; }
        if (sz.length) sizeDD.selection = sel;
    }
    function updateModeUI() {
        var pre = rbPreset.value;
        xField.enabled = yField.enabled = pre;
        if (!pre) { setSizes(settings.manual); rotDD.selection = settings.manual.rot === 180 ? 1 : 0; }
        loadPreset();
    }
    function updateEnabled() {
        // grey out the contents, not the tab itself, so both tabs stay clickable
        bl.enabled = lay.enabled = cbBack.value;
        fl.enabled = cbFront.value;
        fStyleGrp.enabled = cbFront.value && !cbLink.value;
    }

    skuDD.onChange = function () { fillSizeDD(currentSize()); loadPreset(); };
    sizeDD.onChange = loadPreset;
    rbPreset.onClick = rbArt.onClick = rbSel.onClick = updateModeUI;
    resetBtn.onClick = function () { delete settings.perSku[currentSku()]; setSizes(standardSizes()); refreshCustomNote(); };
    // tab labels show whether each part will be made
    function updateHint() {
        tBack.text = "BACK \u2014 NAME + NUMBER" + (cbBack.value ? "  (ON)" : "  (off)");
        tFront.text = "FRONT \u2014 NUMBER" + (cbFront.value ? "  (ON)" : "  (off)");
    }
    function showPage(front) {
        tabs.selection = front ? tFront : tBack;
        updateHint();
    }
    cbBack.onClick = function () { updateEnabled(); if (cbBack.value) showPage(false); updateHint(); };
    cbFront.onClick = function () { updateEnabled(); if (cbFront.value) showPage(true); updateHint(); };
    nameTxt.onChanging = function () { NAME.font.setSample(nameTxt.text); };
    numTxt.onChanging = function () { NUMBER.font.setSample(numTxt.text); FRONT.font.setSample(numTxt.text); };

    // --- initial state: edit data > detection > last used
    var startSku = DETECTED ? DETECTED.sku : settings.lastSku;
    var startSize = DETECTED ? DETECTED.size : settings.lastSize;
    if (editData && editData.sku) { startSku = editData.sku; startSize = editData.size; }
    var si = indexOf(SKU_LIST, startSku); skuDD.selection = si >= 0 ? si : 0;
    fillSizeDD(startSize);
    var mode = editData && editData.mode ? editData.mode : settings.mode;
    if (mode === "selection" && !hasArtSelection) mode = "artboard";
    rbPreset.value = mode === "preset"; rbArt.value = mode === "artboard"; rbSel.value = mode === "selection";
    var aIdx = indexOf(["right", "center", "left"], (editData && editData.front ? editData.front.align : settings.front.align));
    alignDD.selection = aIdx >= 0 ? aIdx : 0;
    updateModeUI();
    if (editData && editData.part === "back") {
        setSizes(editData.sizes);
        if (editData.mode === "preset") { xField.text = fmt(editData.x); yField.text = fmt(editData.top); }
        rotDD.selection = editData.rot === 180 ? 1 : 0;
    }
    if (editData && editData.part === "front") {
        fH.text = fmt(editData.front.height); frontAuto = false; refreshFrontFields(false);
        fxField.text = fmt(editData.front.x); fyField.text = fmt(editData.front.top);
        fRotDD.selection = editData.front.rot === 180 ? 1 : 0;
    }
    showPage((editData && editData.part === "front") || (!cbBack.value && cbFront.value));
    updateEnabled();

    // --- generate
    var result = null;
    okBtn.onClick = function () {
        var err = [], mkBack = cbBack.value, mkFront = cbFront.value;
        if (!mkBack && !mkFront) { alert("Tick Back name + number, Front number, or both."); return; }
        var nm = NAME.get(), nu = NUMBER.get(), fr = cbLink.value ? NUMBER.get() : FRONT.get();
        nm.text = nameTxt.text; nm.height = num(nameH.text, NaN);
        nu.text = numTxt.text; nu.height = num(numH.text, NaN);
        var front = { text: numTxt.text, font: fr.font, fill: fr.fill, stroke: fr.stroke, sw: fr.sw, linked: cbLink.value,
                      height: num(fH.text, NaN), align: alignKey(), x: num(fxField.text, NaN), top: num(fyField.text, NaN),
                      rot: fRotDD.selection.index === 1 ? 180 : 0 };
        function checkStyle(L, n) {
            if (!L.font) err.push(n + "pick a font.");
            if (!(L.height > 0)) err.push(n + "height must be a number above 0.");
            if (!(L.sw >= 0)) err.push(n + "stroke weight must be 0 or more.");
            if (L.height > 0 && L.sw >= 0 && L.stroke.kind !== "none" && L.height * PT_PER_IN <= L.sw)
                err.push(n + "stroke is thicker than the total height.");
        }
        var sizes = { numH: nu.height, nameH: nm.height, gap: num(gapField.text, NaN), below: posDD.selection.index === 1 };
        var mode = rbPreset.value ? "preset" : (rbSel.value ? "selection" : "artboard");
        var x = num(xField.text, NaN), topY = num(yField.text, NaN);
        if (mkBack) {
            if (!trim(nm.text) && !trim(nu.text)) err.push("Back: enter a name, a number, or both.");
            if (trim(nm.text)) checkStyle(nm, "Back name: ");
            if (trim(nu.text)) checkStyle(nu, "Back number: ");
            if (!(sizes.gap >= 0)) err.push("Back: gap must be 0 or more.");
            if (!(nm.height > 0)) sizes.nameH = 0;
            if (mode === "preset") {
                if (!currentPreset()) err.push("Back: choose a SKU and size.");
                if (isNaN(x) || isNaN(topY)) err.push("Back: X and Top Y must be numbers.");
            }
        }
        if (mkFront) {
            if (!trim(front.text)) err.push("Front: the front number uses the Number text, which is empty.");
            else checkStyle(front, "Front number: ");
            if (isNaN(front.x) || isNaN(front.top)) err.push("Front: X and Top Y must be numbers.");
        }
        if (err.length) { alert(err.join("\n")); return; }
        var p = currentPreset();
        if (p && artboardDiff(p) > 0.1 && ((mkBack && mode === "preset") || (mkFront && p.front))) {
            if (!confirm("This artboard is " + round(AB_W, 2) + " \u00D7 " + round(AB_H, 2) + " in, but the " +
                         currentSku() + " " + currentSize() + " preset was measured on a " + p.abW + " \u00D7 " + p.abH +
                         " in artboard.\n\nThe placement may be off. Place anyway?")) return;
        }
        result = { name: nm, number: nu, front: front, sizes: sizes, mode: mode, rot: rotDD.selection.index === 1 ? 180 : 0,
                   x: x, top: topY, sku: currentSku(), size: currentSize(), hideOriginal: cbHide.value,
                   mkBack: mkBack, mkFront: mkFront, frontStd: frontStdHeight(), tab: tabs.selection === tFront ? 1 : 0 };
        w.close(1);
    };

    if (w.show() !== 1 || !result) { log("cancelled"); return; }

    // ------------------------------------------------------------------ remember inputs
    (function () {
        var r = result;
        settings.name = { text: r.name.text, font: r.name.font, fill: r.name.fill, stroke: r.name.stroke, sw: r.name.sw };
        settings.number = { text: r.number.text, font: r.number.font, fill: r.number.fill, stroke: r.number.stroke, sw: r.number.sw };
        settings.front = { linked: r.front.linked, font: r.front.font, fill: r.front.fill, stroke: r.front.stroke,
                           sw: r.front.sw, align: r.front.align };
        settings.includeBack = r.mkBack; settings.includeFront = r.mkFront; settings.tab = r.tab;
        settings.mode = r.mode; settings.hideOriginal = r.hideOriginal;
        settings.lastSku = r.sku; settings.lastSize = r.size;
        var s = r.sizes, p = presetFor(r.sku, r.size);
        if (r.mkBack) {
            if (r.mode === "preset" && p) {
                var std = p.numH === s.numH && p.nameH === s.nameH && p.gap === s.gap && p.below === s.below;
                if (std) delete settings.perSku[r.sku];
                else settings.perSku[r.sku] = { numH: s.numH, nameH: s.nameH, gap: s.gap, below: s.below };
            } else if (r.mode !== "preset") {
                settings.manual = { numH: s.numH, nameH: s.nameH, gap: s.gap, below: s.below, rot: r.rot };
            }
        }
        if (r.mkFront && r.sku) {
            if (r.front.height === r.frontStd) delete settings.perSkuFront[r.sku];
            else settings.perSkuFront[r.sku] = r.front.height;
        }
        saveSettings(settings);
    })();

    // ------------------------------------------------------------------ build
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


    // ------------------------------------------------------------------ color mode
    // File > Document Color Mode, via its menu commands. Runs once per Generate.
    function ensureCMYK() {
        var wasCMYK = doc.documentColorSpace === DocumentColorSpace.CMYK;
        log("color mode: file was " + (wasCMYK ? "CMYK" : "RGB"));
        doc.selection = null;
        if (wasCMYK) {
            app.executeMenuCommand("doc-color-rgb");   // double switch clears vendor-file display glitches
            app.redraw();
            log("color mode: switched to RGB");
        }
        app.executeMenuCommand("doc-color-cmyk");
        app.redraw();
        var ok = doc.documentColorSpace === DocumentColorSpace.CMYK;
        log("color mode: switched to CMYK" + (ok ? "" : " \u2014 FAILED, file is still RGB"));
        return ok;
    }
    var colorModeOK = true;
    try { colorModeOK = ensureCMYK(); }
    catch (e) { colorModeOK = false; log("color mode: error " + e.message); }
    if (!colorModeOK)
        alert("Live Text Builder couldn't switch this file to CMYK. The text will still be created; " +
              "please set File > Document Color Mode > CMYK Color by hand.");

    // ------------------------------------------------------------------ place
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

    // BACK: stacks name + number from the garment-top edge downward (garment orientation).
    // rot 0: garment top = top edge on the artboard; rot 180: lines upside down, garment top = bottom edge.
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

    // FRONT: one number. The edge matching the alignment (or the center) is pinned at X,
    // the garment-top edge at Top Y. Upside down (180): garment right = artboard left.
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

    var saved = {};
    try {
        saved.fill = doc.defaultFillColor; saved.stroke = doc.defaultStrokeColor;
        saved.filled = doc.defaultFilled; saved.stroked = doc.defaultStroked; saved.sw = doc.defaultStrokeWidth;
    } catch (e) {}

    var layer = doc.activeLayer;
    if (layer.locked || !layer.visible) { alert("The active layer is locked or hidden."); return; }
    var made = [], groups = [];
    try {
        if (result.mkBack) {
            var gb2 = buildBack(layer, made); made.push(gb2); groups.push(gb2);
            if (editGroup && editData.part === "back") { gb2.move(editGroup, ElementPlacement.PLACEBEFORE); editGroup.remove(); editGroup = null; }
        }
        if (result.mkFront) {
            var gf = buildFront(layer, made); made.push(gf); groups.push(gf);
            if (editGroup && editData.part === "front") { gf.move(editGroup, ElementPlacement.PLACEBEFORE); editGroup.remove(); editGroup = null; }
        }
        if (hasArtSelection && result.hideOriginal)
            for (var j = 0; j < origSel.length; j++) try { origSel[j].hidden = true; } catch (e) {}
        doc.selection = null;
        for (j = 0; j < groups.length; j++) groups[j].selected = true;
        log("done");
    } catch (e) {
        log("error: " + e.message);
        for (var m = 0; m < made.length; m++) try { made[m].remove(); } catch (x) {}
        alert("Live Text Builder: " + e.message);
    } finally {
        try {
            if (saved.fill) {
                var keep = doc.selection; doc.selection = null;
                doc.defaultFillColor = saved.fill; doc.defaultStrokeColor = saved.stroke;
                doc.defaultFilled = saved.filled; doc.defaultStroked = saved.stroked; doc.defaultStrokeWidth = saved.sw;
                doc.selection = keep;
            }
        } catch (e) {}
        app.redraw();
    }
})();
