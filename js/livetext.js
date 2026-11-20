// Live text: works out, for each print file, exactly what LiveTextBuilder v12 would build
// (SKU/size detection, presets, stacking, front alignment), and where. The Illustrator
// batch script reads the resulting manifest and builds the real text.
import { PRESETS, BASE_ALIAS, FULL_ALIAS, SIZE_ORDER, LIBRARY } from './livetext-data.js?v=18';

export { LIBRARY };
export const PT = 72;
const ZERO_RATIO = 1.24;
const LIB = Object.fromEntries(LIBRARY.map(l => [l.name, l]));
const SKU_LIST = Object.keys(PRESETS).sort();

// ------------------------------------------------------------ detection (port of v12 detect())
function normSize(t) {
  t = String(t).toUpperCase();
  const map = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL', '2X': '2XL', '3X': '3XL', '4X': '4XL', SM: 'S', SMALL: 'S', MED: 'M', MEDIUM: 'M', LG: 'L', LARGE: 'L' };
  return map[t] || t;
}
// Cut-pattern aliases come from the LiveTextBuilder script (v13 adds SLSC102 -> SLSB102).
const ALL_BASE_ALIAS = { ...BASE_ALIAS };

function resolveSku(full) {
  full = full.toUpperCase();
  if (PRESETS[full]) return { sku: full, via: '' };
  if (FULL_ALIAS[full] && PRESETS[FULL_ALIAS[full]]) return { sku: FULL_ALIAS[full], via: full };
  const base = full.substr(0, 7), suf = full.substr(7);
  if (ALL_BASE_ALIAS[base] && PRESETS[ALL_BASE_ALIAS[base] + suf]) return { sku: ALL_BASE_ALIAS[base] + suf, via: full };
  return null;
}
// the measured cut a SKU maps to, whether or not that cut has presets
function cutOf(full) {
  full = full.toUpperCase();
  if (FULL_ALIAS[full]) return FULL_ALIAS[full];
  const base = full.substr(0, 7), suf = full.substr(7);
  return ALL_BASE_ALIAS[base] ? ALL_BASE_ALIAS[base] + suf : full;
}
const abDiff = (p, w, h) => Math.max(Math.abs(p.abW - w), Math.abs(p.abH - h));

// path: full relative path (folder names count, e.g. "SLVB124G - Black/SM_109433.1_YS.pdf")
export function detect(path, abW, abH) {
  const name = path.split('/').pop().replace(/\.[^.]+$/, '');
  const tokens = name.split(/[_\s]+/);
  const size = tokens.length ? normSize(tokens[tokens.length - 1]) : '';
  // SKU from the file name first, then from the nearest folder that names one
  const parts = [name, ...path.split('/').slice(0, -1).reverse()];
  let m = null;
  for (const p of parts) { m = p.match(/(SL[A-Z]{2}\d{3})([AYGL])/i); if (m) break; }
  let res = m ? resolveSku(m[1] + m[2]) : null;
  if (res && !PRESETS[res.sku][size] && size.charAt(0) === 'Y') {
    const alt = resolveSku(m[1] + 'Y');
    if (alt && PRESETS[alt.sku][size]) res = alt;
  }
  if (res && PRESETS[res.sku][size]) return { sku: res.sku, size, how: m.input === name ? 'file name' : 'folder name', via: res.via };
  if (res && abW && abH) {
    // Size isn't in the file name (e.g. SM_111042_3_inner): match the artboard against this SKU's sizes.
    let best = null, bestD = 1e9;
    for (const s of Object.keys(PRESETS[res.sku])) {
      const d = abDiff(PRESETS[res.sku][s], abW, abH);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best && bestD <= 0.05) return { sku: res.sku, size: best, how: (m.input === name ? 'file name' : 'folder name') + ' + artboard size', via: res.via };
  }
  if (m) {
    // The name says which SKU this is, but that cut has no measurements for this size.
    // Don't guess a different SKU from the artboard; say what's missing instead.
    const named = (m[1] + m[2]).toUpperCase();
    return { sku: null, size, named, cut: cutOf(named), noPreset: true, how: m.input === name ? 'file name' : 'folder name' };
  }
  let best = null, bestD = 1e9;
  const known = SIZE_ORDER.includes(size);
  for (const sku of SKU_LIST) for (const s of Object.keys(PRESETS[sku])) {
    if (known && s !== size) continue;
    const d = abDiff(PRESETS[sku][s], abW, abH);
    if (d < bestD) { bestD = d; best = { sku, size: s }; }
  }
  if (best && bestD <= (known ? 0.15 : 0.05)) return { ...best, how: known ? 'artboard size + size in file name' : 'artboard size', via: '' };
  return null;
}

export const presetFor = (sku, size) => (PRESETS[sku] && PRESETS[sku][size]) || null;

// ------------------------------------------------------------ settings
export const STOCK = c => ({ kind: 'lib', name: c });
export function defaultSettings(saved) {
  const font = saved?.font || '';
  const base = {
    makeName: true, makeNumber: true, makeFront: true,   // each line on its own; placement never changes
    styleFrom: 'vendor',      // vendor | mine
    backPlacement: 'preset',  // preset | vendor
    name: { font: saved?.nameFont || font, fill: STOCK('SquadWhite'), stroke: STOCK('SquadBlack'), sw: 20 },
    number: { font: saved?.numberFont || font, fill: STOCK('SquadWhite'), stroke: STOCK('SquadBlack'), sw: 20 },
    front: { linked: true, font: saved?.numberFont || font, fill: STOCK('SquadWhite'), stroke: STOCK('SquadBlack'), sw: 20, align: saved?.align || 'right' },
    sizes: { numH: null, nameH: null, gap: null, below: null, fH: null }, // null = SKU standard
  };
  return base;
}

// Map a color found in the vendor file to a color spec the script understands.
export function vendorColorSpec(c) {
  if (!c) return null;
  if (c.kind === 'spot' && c.tint >= 0.999) {
    // Spot colors go by name: in Illustrator the text uses the file's own swatch of that
    // name. v = the file's ink values, used only to draw the preview the same color.
    const spec = LIB[c.name] ? STOCK(c.name) : { kind: 'swatch', name: c.name };
    if (c.alt) spec.v = c.alt;
    return spec;
  }
  if (c.kind === 'cmyk') return { kind: 'cmyk', v: c.v.map(v => Math.round(v * 100) / 100) };
  return null; // RGB or tinted spot: not a production color, user must choose
}

export function specLabel(s) {
  if (!s || s.kind === 'none') return 'None';
  if (s.kind === 'lib') return s.name;
  if (s.kind === 'swatch') return s.name + ' (file swatch)';
  if (s.kind === 'cmyk') return `C${s.v[0]} M${s.v[1]} Y${s.v[2]} K${s.v[3]}`;
  return '?';
}
// Screen preview of a CMYK ink mix: each ink filters the light like real process inks
// (a plain 1-C formula shows 100/0/100/0 as neon lime; on press it's a mid green).
const INKS = [[0, 174, 239], [236, 0, 140], [255, 242, 0], [35, 31, 32]];
export function cmykToCSS(v) {
  const out = [255, 255, 255];
  v.forEach((pct, i) => {
    const t = Math.max(0, Math.min(1, pct / 100));
    for (let ch = 0; ch < 3; ch++) out[ch] *= 1 - t * (1 - INKS[i][ch] / 255);
  });
  return `rgb(${out.map(Math.round).join(',')})`;
}
export function specCSS(s) {
  if (!s || s.kind === 'none') return null;
  // the file's own values when known (what the swatch looks like in that file), else the stock values
  let v = s.kind === 'cmyk' ? s.v : (s.v || LIB[s.name]?.v || null);
  if (!v) return '#999';
  return cmykToCSS(v);
}

// ------------------------------------------------------------ roles in a file
// Which removed placeholder is the back name, back number, front number.
export function findRoles(f) {
  const pick = role => f.cands.filter(x => x.role === role).sort((a, b) => b.c.heightIn - a.c.heightIn)[0] || null;
  return { name: pick('name'), back: pick('back'), front: pick('front') };
}

// visible box (glyphs + half the outline stroke) in page points, y up
function visBox(x) {
  const h = x.c.strokeWidthPt / 2, b = x.c.glyphBox;
  return [b[0] - h, b[1] - h, b[2] + h, b[3] + h];
}

// ------------------------------------------------------------ the spec for one file
export function fileSpec(f, ls) {
  const mb = f.analysis.mediaBox;
  const abW = (mb[2] - mb[0]) / PT, abH = (mb[3] - mb[1]) / PT;
  const det = detect(f.path, abW, abH);
  const p = det && det.sku ? presetFor(det.sku, det.size) : null;
  const roles = findRoles(f);
  const notes = [], problems = [];
  const toIn = { x: v => (v - mb[0]) / PT, y: v => (mb[3] - v) / PT };

  if (!det) problems.push("Couldn't work out the SKU and size from the file or folder name, and the artboard doesn't match a preset.");
  else if (det.noPreset && ls.backPlacement !== 'vendor') problems.push(`${det.named}${det.cut !== det.named ? ` (same cut as ${det.cut})` : ''} has no measured ${det.size || ''} placement in the v12 presets. Use "Where vendor's text was", or add the measurements to v12.`);
  else if (/^artboard/.test(det.how)) problems.push(`SKU guessed as ${det.sku} ${det.size} from the artboard size only. Check it, or put the SKU in the folder name.`);
  else if (p && abDiff(p, abW, abH) > 0.1) notes.push(`Artboard is ${abW.toFixed(2)} × ${abH.toFixed(2)} in; the ${det.sku} ${det.size} preset expects ${p.abW} × ${p.abH} in.`);

  // styles: vendor colors/stroke weight where the vendor file has production colors
  const style = (base, role) => {
    const s = { ...base };
    if (ls.styleFrom === 'vendor' && role) {
      const fc = vendorColorSpec(role.c.fillColor);
      if (fc) s.fill = fc;
      if (role.c.strokeColor) {
        const sc = vendorColorSpec(role.c.strokeColor);
        if (sc) s.stroke = sc;
        s.sw = Math.round(role.c.strokeWidthPt * 4) / 4;
      } else { s.stroke = { kind: 'none' }; s.sw = 0; }
    }
    return s;
  };
  const nameSt = style(ls.name, roles.name);
  const numSt = style(ls.number, roles.back);
  // linked = same font, colors and stroke as the back number (as in v12)
  const frontSt = ls.front.linked ? { ...numSt } : style(ls.front, roles.front);

  const std = p ? { numH: p.numH, nameH: p.nameH, gap: p.gap, below: p.below } : { numH: 8, nameH: 2, gap: 1, below: false };
  const sz = {
    numH: ls.sizes.numH ?? std.numH, nameH: ls.sizes.nameH ?? std.nameH,
    gap: ls.sizes.gap ?? std.gap, below: ls.sizes.below ?? std.below,
  };
  // "Where vendor's text was" also follows the vendor's order (name above or below the number)
  let vendorBelow = null;
  if (roles.name && roles.back) {
    const nb = visBox(roles.name), bb = visBox(roles.back);
    const r = p ? p.rot : (roles.name.ocr.rot === 180 ? 180 : 0);
    const nameHigher = (nb[1] + nb[3]) / 2 > (bb[1] + bb[3]) / 2;     // PDF y goes up
    vendorBelow = r === 180 ? nameHigher : !nameHigher;
  }
  if (ls.backPlacement === 'vendor' && ls.sizes.below == null && vendorBelow != null) sz.below = vendorBelow;
  const fStd = p ? p.fH : (/[YG]$/.test(det?.sku || '') ? 3 : 4);
  const fH = ls.sizes.fH ?? fStd;

  // ---- back placement
  let back = null;
  if (ls.makeName || ls.makeNumber) {
    let x, top, rot = p ? p.rot : 0, from;
    if (ls.backPlacement === 'vendor' && (roles.name || roles.back)) {
      const boxes = [roles.name, roles.back].filter(Boolean).map(visBox);
      const u = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
      if (!p && roles.name) rot = roles.name.ocr.rot === 180 ? 180 : 0;
      x = toIn.x((u[0] + u[2]) / 2);
      top = rot === 180 ? toIn.y(u[1]) : toIn.y(u[3]);
      from = "vendor's text position";
    } else if (p) {
      x = p.x; top = p.top; from = 'SKU preset';
    } else {
      if (!det?.noPreset) problems.push('No preset for this file, so the back can only go where the vendor\'s text was.');
    }
    if (x != null) back = { x, top, rot, from };
    if (!roles.name && !roles.back) notes.push('No NAME / 00 was found on the back to compare with.');
  }

  // ---- front placement: exact from the vendor's front number when we found it
  let front = null;
  if (ls.makeFront) {
    const a = ls.front.align;
    const rot = p && p.front ? p.front.rot : 0;
    if (roles.front) {
      const v = visBox(roles.front);
      const gr = rot === 180 ? v[0] : v[2], gl = rot === 180 ? v[2] : v[0];
      const x = toIn.x(a === 'right' ? gr : a === 'left' ? gl : (v[0] + v[2]) / 2);
      const top = rot === 180 ? toIn.y(v[1]) : toIn.y(v[3]);
      front = { x, top, rot, from: "vendor's front number", vendorH: +((v[3] - v[1]) / PT).toFixed(2) };
      if (!(p && p.front)) notes.push('Front orientation not in the presets for this SKU; assumed upright.');
    } else if (p) {
      const f0 = p.front;
      if (f0) {
        const gr = f0.rot === 180 ? f0.l : f0.r, gl = f0.rot === 180 ? f0.r : f0.l;
        front = { x: a === 'right' ? gr : a === 'left' ? gl : f0.c, top: f0.top, rot: f0.rot, from: 'SKU preset (rough)' };
      } else {
        const c = { x: p.fHalf[0], y: p.fHalf[1] }, half = ZERO_RATIO * fH / 2;
        front = { x: a === 'right' ? c.x + half : a === 'left' ? c.x - half : c.x, top: c.y - fH / 2, rot: 0, from: 'front half of the artboard (no data)' };
      }
      notes.push("No front number found in the vendor file; using the rough preset position.");
    } else problems.push('No front number found and no preset to fall back on.');
  }

  for (const [label, st, on] of [['Name', nameSt, ls.makeName], ['Number', numSt, ls.makeNumber], ['Front number', frontSt, ls.makeFront]]) {
    if (!on) continue;
    if (!st.font) problems.push(`${label}: pick a font.`);
    if (st.fill?.kind === 'none') problems.push(`${label}: pick a fill color.`);
  }
  for (const [label, role] of [['name', roles.name], ['number', roles.back], ['front number', roles.front]]) {
    if (ls.styleFrom === 'vendor' && role) {
      if (!vendorColorSpec(role.c.fillColor)) notes.push(`Vendor's ${label} fill isn't a production swatch; using your fill color.`);
      if (role.c.strokeColor && !vendorColorSpec(role.c.strokeColor)) notes.push(`Vendor's ${label} outline isn't a production swatch; using your stroke color.`);
    }
  }

  const entry = {
    sku: det?.sku || '', size: det?.size || '', artboard: { w: +abW.toFixed(4), h: +abH.toFixed(4) },
    mkBack: !!back, mkFront: !!front, mode: 'preset', hideOriginal: false, tab: 0,
    name: { text: ls.makeName ? 'NAME' : '', font: nameSt.font, fill: nameSt.fill, stroke: nameSt.stroke, sw: nameSt.sw, height: sz.nameH },
    number: { text: ls.makeNumber ? '00' : '', font: numSt.font, fill: numSt.fill, stroke: numSt.stroke, sw: numSt.sw, height: sz.numH },
    sizes: sz, rot: back?.rot ?? 0, x: back ? +back.x.toFixed(4) : null, top: back ? +back.top.toFixed(4) : null,
    front: front ? { text: '00', font: frontSt.font, fill: frontSt.fill, stroke: frontSt.stroke, sw: frontSt.sw, linked: !!ls.front.linked,
      height: fH, align: ls.front.align, x: +front.x.toFixed(4), top: +front.top.toFixed(4), rot: front.rot } : null,
    frontStd: fStd,
  };
  // Preview only: draw named swatches the way this file defines them (Illustrator uses the
  // file's swatch of that name too). The script ignores v for stock swatches.
  const spots = f.analysis.spots || {};
  for (const L of [entry.name, entry.number, entry.front]) if (L) for (const k of ['fill', 'stroke'])
    if (L[k] && (L[k].kind === 'lib' || L[k].kind === 'swatch') && !L[k].v && spots[L[k].name]) L[k] = { ...L[k], v: spots[L[k].name] };
  return { entry, det, preset: p, roles, back, front, notes, problems, vendorBelow };
}

// ------------------------------------------------------------ preview (approximation of what Illustrator will build)
// lines: [{text, fontFamily, height(in), sw(pt), fill, stroke, box:{x0,y0,x1,y1} in pt y-up of the VISIBLE box, rot}]
export function measureLine(ctx, text, fam, heightIn, sw) {
  const hasStroke = sw > 0;
  ctx.font = `100px "${fam}", sans-serif`;
  const m = ctx.measureText(text);
  const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const targetInk = heightIn * PT - (hasStroke ? sw : 0);
  const k = targetInk / inkH; // pt per px at 100px
  return {
    size: 100 * k, // font size in pt
    l: -m.actualBoundingBoxLeft * k, r: m.actualBoundingBoxRight * k,
    t: -m.actualBoundingBoxAscent * k, b: m.actualBoundingBoxDescent * k, // baseline-relative, y down
    half: hasStroke ? sw / 2 : 0,
  };
}

// Lay out lines exactly like v12 buildBack/buildFront; returns ink boxes in pt (y up).
export function layout(ctx, spec, fontFamilyOf, mb) {
  const out = [];
  const abL = mb[0], abT = mb[3];
  if (spec.mkBack) {
    const s = spec.sizes, rot = spec.rot;
    const slots = s.below ? [['number', s.numH], ['name', s.nameH]] : [['name', s.nameH], ['number', s.numH]];
    const X = abL + spec.x * PT, T = abT - spec.top * PT;
    let off = 0;
    for (const [role, h] of slots) {
      const L = spec[role];
      if (!L.text) { off += h + s.gap; continue; }   // line switched off: its slot stays, nothing drawn
      const m = measureLine(ctx, L.text, fontFamilyOf(L.font), h, L.stroke?.kind === 'none' ? 0 : L.sw);
      const w = m.r - m.l, inkH = m.b - m.t;
      let y0, y1;
      if (rot === 180) { y0 = T + off * PT + m.half; y1 = y0 + inkH; }
      else { y1 = T - off * PT - m.half; y0 = y1 - inkH; }
      out.push({ L, m, rot, ink: [X - w / 2, y0, X + w / 2, y1], fam: fontFamilyOf(L.font) });
      off += h + s.gap;
    }
  }
  if (spec.mkFront && spec.front) {
    const f = spec.front, rot = f.rot;
    const m = measureLine(ctx, f.text, fontFamilyOf(f.font), f.height, f.stroke?.kind === 'none' ? 0 : f.sw);
    const w = m.r - m.l, inkH = m.b - m.t;
    const X = abL + f.x * PT, T = abT - f.top * PT;
    let x0;
    const garmentRightIsLeft = rot === 180;
    if (f.align === 'center') x0 = X - w / 2;
    else {
      const anchorIsRightEdge = (f.align === 'right') !== garmentRightIsLeft;
      x0 = anchorIsRightEdge ? X - m.half - w : X + m.half;
    }
    const y0 = rot === 180 ? T + m.half : T - m.half - inkH;
    out.push({ L: f, m, rot, ink: [x0, y0, x0 + w, y0 + inkH], fam: fontFamilyOf(f.font) });
  }
  return out;
}

export function drawPreview(ctx, lines, scale, mb) {
  for (const ln of lines) {
    const { L, m, rot, ink, fam } = ln;
    const cx = ((ink[0] + ink[2]) / 2 - mb[0]) * scale, cy = (mb[3] - (ink[1] + ink[3]) / 2) * scale;
    ctx.save();
    ctx.translate(cx, cy);
    if (rot === 180) ctx.rotate(Math.PI);
    ctx.font = `${m.size * scale}px "${fam}", sans-serif`;
    // draw so the ink box centre lands on (0,0)
    const ox = -((m.l + m.r) / 2) * scale, oy = -((m.t + m.b) / 2) * scale;
    const stroke = specCSS(L.stroke), fill = specCSS(L.fill);
    if (stroke && L.sw > 0) {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = L.sw * scale; ctx.strokeStyle = stroke;
      ctx.strokeText(L.text, ox, oy);
    }
    if (fill) { ctx.fillStyle = fill; ctx.fillText(L.text, ox, oy); }
    ctx.restore();
  }
}
