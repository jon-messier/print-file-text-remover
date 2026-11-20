// "Live text" tab of the design panel + font access + preview drawing.
import { LIBRARY, defaultSettings, fileSpec, specLabel, specCSS, layout, drawPreview, presetFor } from './livetext.js?v=18';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS_KEY = 'ltb-web-defaults-v1';

// ------------------------------------------------------------ remembered defaults (per browser)
export function loadDefaults() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function saveDefaults(ls) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ nameFont: ls.name.font, numberFont: ls.number.font, align: ls.front.align,
      name: ls.name, number: ls.number, front: ls.front, styleFrom: ls.styleFrom }));
  } catch {}
}
export function newSettings() {
  const d = loadDefaults();
  const ls = defaultSettings(d);
  if (d.name) Object.assign(ls.name, d.name);
  if (d.number) Object.assign(ls.number, d.number);
  if (d.front) Object.assign(ls.front, d.front);
  if (d.styleFrom) ls.styleFrom = d.styleFrom;
  return ls;
}

// ------------------------------------------------------------ fonts (Chrome Local Font Access)
export const fonts = { list: null, byPs: new Map(), families: new Map(), faces: new Map(), error: '' };

export async function loadLocalFonts(fromClick) {
  if (fonts.list) return true;
  if (!('queryLocalFonts' in window)) { fonts.error = 'This browser can\'t list installed fonts. Use Chrome, or type the PostScript name.'; return false; }
  try {
    if (!fromClick && navigator.permissions) {
      const st = await navigator.permissions.query({ name: 'local-fonts' }).catch(() => null);
      if (!st || st.state !== 'granted') return false;
    }
    const list = await window.queryLocalFonts();
    fonts.list = list;
    for (const f of list) {
      fonts.byPs.set(f.postscriptName, f);
      if (!fonts.families.has(f.family)) fonts.families.set(f.family, []);
      fonts.families.get(f.family).push(f);
    }
    return true;
  } catch (e) { fonts.error = 'Font access was blocked: ' + e.message; return false; }
}

// returns the CSS family to use for preview (falls back to sans-serif)
export function familyFor(ps) { return fonts.faces.get(ps) === 'ok' ? 'ltb-' + ps : 'sans-serif'; }
export async function ensureFace(ps) {
  if (!ps || fonts.faces.has(ps) || !fonts.byPs.has(ps)) return;
  fonts.faces.set(ps, 'loading');
  try {
    const blob = await fonts.byPs.get(ps).blob();
    const face = new FontFace('ltb-' + ps, await blob.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    fonts.faces.set(ps, 'ok');
  } catch { fonts.faces.set(ps, 'fail'); }
}

// ------------------------------------------------------------ panel
function colorSelect(id, spec, allowNone, spots) {
  if (spec && spec.kind !== 'cmyk' && !spec.v && spots && spots[spec.name]) spec = { ...spec, v: spots[spec.name] }; // chip as this file shows it
  const opts = [];
  if (allowNone) opts.push(['{"kind":"none"}', 'None']);
  for (const l of LIBRARY) opts.push([JSON.stringify({ kind: 'lib', name: l.name }), l.name]);
  // stock swatches match by name (a file's own values only tint the chip)
  const cur = spec && spec.kind === 'lib' ? JSON.stringify({ kind: 'lib', name: spec.name }) : JSON.stringify(spec);
  if (spec && (spec.kind === 'cmyk' || spec.kind === 'swatch') && !opts.some(o => o[0] === cur)) opts.push([cur, specLabel(spec)]);
  opts.push(['custom', 'Custom CMYK…']);
  const chip = specCSS(spec);
  return `<span class="chip" style="${chip ? 'background:' + chip : ''}" aria-hidden="true"></span><select id="${id}">${opts.map(([v, l]) => `<option value='${esc(v)}' ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function fontField(id, ps) {
  if (fonts.list) {
    const f = fonts.byPs.get(ps);
    const fam = f ? f.family : '';
    const styles = fam ? fonts.families.get(fam) : [];
    return `<input id="${id}-fam" list="ltb-families" value="${esc(fam)}" placeholder="Type a font family" autocomplete="off">
      <select id="${id}-sty">${styles.map(s => `<option value="${esc(s.postscriptName)}" ${s.postscriptName === ps ? 'selected' : ''}>${esc(s.style)}</option>`).join('')}</select>
      ${ps && !f ? `<div class="hint warn">“${esc(ps)}” isn't installed on this computer.</div>` : ''}`;
  }
  return `<input id="${id}-ps" value="${esc(ps)}" placeholder="PostScript name, e.g. Freshman-Regular" autocomplete="off">`;
}

function styleBlock(prefix, st, title, opts = {}, spots) {
  return `<fieldset class="lt-block"><legend>${title}</legend>
    ${opts.noFont ? '' : `<div class="lt-row"><label>Font</label><div class="lt-font">${fontField(prefix + '-font', st.font)}</div></div>`}
    <div class="lt-row"><label>Fill</label><div class="lt-color">${colorSelect(prefix + '-fill', st.fill, false, spots)}</div></div>
    <div class="lt-row"><label>Stroke</label><div class="lt-color">${colorSelect(prefix + '-stroke', st.stroke, true, spots)}</div></div>
    <div class="lt-row"><label>Stroke wt</label><div><input id="${prefix}-sw" type="number" min="0" step="0.25" value="${st.sw}"> pt</div></div>
    ${opts.extra || ''}
  </fieldset>`;
}

const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

export function renderLivePanel(el, g, f, onChange) {
  const ls = g.ls;
  const spec = f.lt;
  const p = spec?.preset;
  const vendor = ls.styleFrom === 'vendor';
  const roles = spec?.roles || {};
  const dsku = spec?.det?.noPreset ? `${esc(spec.det.named)} · ${esc(spec.det.size)} <span class="warn">no preset${spec.det.cut !== spec.det.named ? ' (cut ' + esc(spec.det.cut) + ')' : ''}</span>`
    : spec?.det ? `${spec.det.sku} · ${spec.det.size}` + (spec.det.via ? ` <span class="meta">(${esc(spec.det.via)} shares this cut)</span>` : '') + ` <span class="meta">from ${esc(spec.det.how)}</span>` : '<span class="warn">not detected</span>';
  const hInput = (key, std, label) => `<div class="lt-row"><label>${label}</label><div><input id="lt-h-${key}" type="number" step="0.125" min="0" value="${ls.sizes[key] ?? ''}" placeholder="${std ?? ''}"> in ${ls.sizes[key] != null ? `<button class="linkbtn" data-reset="${key}">standard</button>` : '<span class="meta">standard</span>'}</div></div>`;
  // what this file will actually get, after matching the vendor
  const used = key => {
    const L = key === 'front' ? spec?.entry?.front : spec?.entry?.[key];
    if (!L) return '';
    const st = L.stroke?.kind === 'none' || !L.sw ? 'no stroke' : `${specLabel(L.stroke)} ${L.sw} pt stroke`;
    return `<div class="hint used">This file gets: ${specLabel(L.fill)} fill · ${st}</div>`;
  };
  const vendorHint = (role, label) => used(label === 'name' ? 'name' : label === 'number' ? 'number' : 'front');

  // In "Match vendor file" mode the dropdowns show what this file actually gets.
  const shown = (key, mine) => {
    const L = vendor ? (key === 'front' ? spec?.entry?.front : spec?.entry?.[key]) : null;
    return L ? { ...mine, fill: L.fill, stroke: L.stroke, sw: L.sw } : mine;
  };
  const spots = f.analysis?.spots || {};
  const shownName = shown('name', ls.name), shownNum = shown('number', ls.number), shownFront = shown('front', ls.front);

  el.innerHTML = `
    <div class="lt-det">SKU: <b>${dsku}</b></div>
    ${fonts.list ? '' : `<div class="lt-fonts"><button class="btn small" id="lt-load-fonts">Use fonts from this computer</button><span class="meta">${esc(fonts.error) || 'Chrome asks once. Lets you pick fonts by name and shows a true preview.'}</span></div>`}
    <datalist id="ltb-families">${fonts.list ? [...fonts.families.keys()].sort().map(f => `<option value="${esc(f)}">`).join('') : ''}</datalist>
    <div class="lt-row top"><label>Make</label><div>
      <label class="chk"><input type="checkbox" id="lt-mk-name" ${ls.makeName ? 'checked' : ''}> Back name</label>
      <label class="chk"><input type="checkbox" id="lt-mk-num" ${ls.makeNumber ? 'checked' : ''}> Back number</label>
      <label class="chk"><input type="checkbox" id="lt-mk-front" ${ls.makeFront ? 'checked' : ''}> Front number</label></div></div>
    <div class="lt-row"><label>Colors</label><div class="seg-sm">
      <button data-style="vendor" class="${vendor ? 'on' : ''}">Match vendor file</button><button data-style="mine" class="${!vendor ? 'on' : ''}">Use mine</button></div></div>
    ${vendor ? '<div class="hint">Fill, stroke and stroke weight below are what was detected in this file\'s vendor text. Change any of them to switch to your own colors. Fonts and sizes always come from you.</div>' : ''}

    <div ${ls.makeName || ls.makeNumber ? '' : 'class="dim"'}>
      <h4>Back</h4>
      ${styleBlock('lt-name', shownName, 'Name', {}, spots)}
      ${styleBlock('lt-num', shownNum, 'Number', {}, spots)}
      <fieldset class="lt-block"><legend>Sizes & stacking</legend>
        ${hInput('nameH', p?.nameH ?? 2, 'Name height')}
        ${hInput('numH', p?.numH ?? 8, 'Number height')}
        ${hInput('gap', p?.gap ?? 1, 'Gap')}
        <div class="lt-row"><label>Name</label><div><select id="lt-below"><option value="std" ${ls.sizes.below == null ? 'selected' : ''}>${ls.backPlacement === 'vendor' && spec?.vendorBelow != null ? `As in vendor file (${spec.vendorBelow ? 'below' : 'above'} number)` : `Standard (${(p?.below) ? 'below' : 'above'} number)`}</option><option value="above" ${ls.sizes.below === false ? 'selected' : ''}>Above number</option><option value="below" ${ls.sizes.below === true ? 'selected' : ''}>Below number</option></select></div></div>
      </fieldset>
      <div class="lt-row"><label>Placement</label><div class="seg-sm">
        <button data-place="preset" class="${ls.backPlacement === 'preset' ? 'on' : ''}">Script default</button><button data-place="vendor" class="${ls.backPlacement === 'vendor' ? 'on' : ''}">Where vendor's text was</button></div></div>
    </div>

    <div ${ls.makeFront ? '' : 'class="dim"'}>
      <h4>Front number</h4>
      <label class="chk"><input type="checkbox" id="lt-linked" ${ls.front.linked ? 'checked' : ''}> Same font, colors and stroke as the back number</label>
      ${ls.front.linked ? '' : styleBlock('lt-front', shownFront, 'Front style', {}, spots)}
      ${hInput('fH', spec?.entry?.frontStd ?? 4, 'Height')}
      <div class="lt-row"><label>Alignment</label><div><select id="lt-align">${['right', 'center', 'left'].map(a => `<option value="${a}" ${ls.front.align === a ? 'selected' : ''}>${a[0].toUpperCase() + a.slice(1)}</option>`).join('')}</select></div></div>
      ${spec?.front ? `<div class="hint">Position: ${esc(spec.front.from)}${spec.front.vendorH ? ` · vendor's number was ${spec.front.vendorH} in tall` : ''} · ${spec.front.rot === 180 ? 'upside down' : 'upright'}</div>` : ''}
    </div>

    ${spec && (spec.problems.length || spec.notes.length) ? `<div class="lt-notes">${spec.problems.map(t => `<div class="flag warn">${esc(t)}</div>`).join('')}${spec.notes.map(t => `<div class="note">${esc(t)}</div>`).join('')}</div>` : ''}
    <div class="lt-actions"><button class="btn small" id="lt-copy-all">Use these fonts & placement for every design</button></div>
    <p class="meta">Copies fonts, which lines to make, placement and alignment. Each design keeps its own colors and stroke weights.</p>
    <p class="meta">Settings apply to every size of this design. Fonts and colors are remembered for next time.</p>`;

  // ---- wiring
  const $ = s => el.querySelector(s);
  const changed = (all = false) => { saveDefaults(ls); onChange(all); };
  $('#lt-load-fonts')?.addEventListener('click', async () => { await loadLocalFonts(true); onChange(false, true); });
  $('#lt-mk-name').onchange = e => { ls.makeName = e.target.checked; changed(); };
  $('#lt-mk-num').onchange = e => { ls.makeNumber = e.target.checked; changed(); };
  $('#lt-mk-front').onchange = e => { ls.makeFront = e.target.checked; changed(); };
  el.querySelectorAll('[data-style]').forEach(b => b.onclick = () => { ls.styleFrom = b.dataset.style; changed(); });
  el.querySelectorAll('[data-place]').forEach(b => b.onclick = () => { ls.backPlacement = b.dataset.place; changed(); });
  $('#lt-linked').onchange = e => { ls.front.linked = e.target.checked; changed(); };
  $('#lt-align').onchange = e => { ls.front.align = e.target.value; changed(); };
  $('#lt-below').onchange = e => { ls.sizes.below = e.target.value === 'std' ? null : e.target.value === 'below'; changed(); };
  for (const k of ['nameH', 'numH', 'gap', 'fH']) {
    const inp = $('#lt-h-' + k);
    if (inp) inp.onchange = () => { const v = num(inp.value); ls.sizes[k] = v != null && v >= 0 ? v : null; changed(); };
  }
  el.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => { ls.sizes[b.dataset.reset] = null; changed(); });
  $('#lt-copy-all').onclick = () => onChange(true);

  const bindFont = (id, target) => {
    const ps = $(`#${id}-ps`), fam = $(`#${id}-fam`), sty = $(`#${id}-sty`);
    if (ps) ps.onchange = () => { target.font = ps.value.trim(); changed(); };
    if (fam) fam.onchange = () => {
      const list = fonts.families.get(fam.value);
      if (!list) return;
      const reg = list.find(s => /^(regular|roman|book|normal)$/i.test(s.style)) || list[0];
      target.font = reg.postscriptName; changed();
    };
    if (sty) sty.onchange = () => { target.font = sty.value; changed(); };
  };
  // Editing a detected color/weight: keep everything shown, apply the edit, switch to "Use mine".
  const takeOver = () => {
    if (!vendor) return;
    for (const [t, sh] of [[ls.name, shownName], [ls.number, shownNum], [ls.front, shownFront]]) {
      for (const k of ['fill', 'stroke']) { const v = { ...sh[k] }; delete v.v; t[k] = v; }
      t.sw = sh.sw;
    }
    ls.styleFrom = 'mine';
  };
  const bindStyle = (prefix, target) => {
    bindFont(prefix + '-font', target);
    for (const k of ['fill', 'stroke']) {
      const sel = $(`#${prefix}-${k}`);
      if (!sel) continue;
      sel.onchange = () => {
        takeOver();
        if (sel.value === 'custom') {
          const cur = target[k]?.kind === 'cmyk' ? target[k].v.join(', ') : '0, 0, 0, 0';
          const ans = prompt('Custom CMYK (percent), e.g. 0, 100, 100, 0', cur);
          const v = ans && ans.split(/[\s,]+/).map(Number);
          if (v && v.length === 4 && v.every(x => x >= 0 && x <= 100)) target[k] = { kind: 'cmyk', v };
        } else target[k] = JSON.parse(sel.value);
        changed();
      };
    }
    const sw = $(`#${prefix}-sw`);
    if (sw) sw.onchange = () => { const v = num(sw.value); if (v != null && v >= 0) { takeOver(); target.sw = v; } changed(); };
  };
  bindStyle('lt-name', ls.name);
  bindStyle('lt-num', ls.number);
  bindStyle('lt-front', ls.front);
}

// ------------------------------------------------------------ preview
export async function paintLivePreview(canvas, f) {
  const spec = f.lt?.entry;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!spec || (!spec.mkBack && !spec.mkFront)) return;
  const fontsUsed = [spec.name.font, spec.number.font, spec.front?.font].filter(Boolean);
  await Promise.all(fontsUsed.map(ensureFace));
  const mb = f.analysis.mediaBox;
  const scale = canvas.width / (mb[2] - mb[0]);
  const lines = layout(ctx, spec, familyFor, mb);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPreview(ctx, lines, scale, mb);
  return fontsUsed.every(ps => familyFor(ps) !== 'sans-serif');
}
