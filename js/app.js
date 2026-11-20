import { analyzePDF, buildCleanPDF, normalizeText, isPlaceholder, isVendorLabel } from './engine.js?v=18';
import { initOCR, ocrCandidate, thumbnail, coreCount } from './ocr.js?v=18';
import { fileSpec } from './livetext.js?v=18';
import { assignRoles, propagate, ROLE_LABEL } from './roles.js?v=18';
import { newSettings, renderLivePanel, paintLivePreview, loadLocalFonts } from './livepanel.js?v=18';
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const OCR_TEXT = 85;   // confident text
const OCR_LOW = 60;    // shown as "possible text", off by default
const VERIFY_W = 700;  // px width for the automatic pixel check

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { files: [], groups: new Map(), current: -1, mode: 'compare', busy: false, panelTab: 'remove' };
window.__state = state; // for debugging / automated tests

// ------------------------------------------------------------ intake
const isJunk = p => /(^|\/)(__MACOSX|\.DS_Store$|\._)/.test(p) || /(^|\/)\.[^/]+$/.test(p) || /(^|\/)Thumbs\.db$/i.test(p);

async function addEntries(list) { // list of {path, file|bytes}
  const out = [];
  for (const it of list) {
    if (isJunk(it.path)) continue;
    if (/\.zip$/i.test(it.path)) {
      const zip = await JSZip.loadAsync(it.bytes || await it.file.arrayBuffer());
      const base = it.path.replace(/\.zip$/i, '');
      const inner = [];
      zip.forEach((p, e) => { if (!e.dir) inner.push({ p, e }); });
      // if the zip has a single top folder, keep it; otherwise use the zip name as root
      const tops = new Set(inner.filter(x => !isJunk(x.p)).map(x => x.p.split('/')[0]));
      const hasRoot = tops.size === 1 && inner.every(x => isJunk(x.p) || x.p.includes('/'));
      for (const { p, e } of inner) {
        if (isJunk(p)) continue;
        out.push({ path: hasRoot ? p : base.split('/').pop() + '/' + p, bytes: new Uint8Array(await e.async('arraybuffer')) });
      }
    } else out.push(it);
  }
  return out;
}

async function readDropped(dt) {
  const items = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const out = [];
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, prefix + entry.name + '/');
      }
    }
  }
  if (items.length) { for (const e of items) await walk(e, ''); }
  else for (const f of dt.files) out.push({ path: f.name, file: f });
  return out;
}

function designKey(path) {
  const parts = path.split('/');
  const name = parts.pop().replace(/\.pdf$/i, '');
  const folder = parts.join('/');
  // Reversible jerseys: SM_111042_3_inner / _outer -> design "SM_111042_inner", size "3"
  const side = name.match(/^(.+)_(\d{1,2})_(inner|outer|reverse|rev|side[_-]?[ab12])$/i);
  if (side) {
    const design = side[1] + '_' + side[3];
    return { folder, design, size: side[2], name, key: folder + '|' + design };
  }
  let m = name.match(/^(.+?)\.\d+_[^_]+$/) || name.match(/^(.+)_[^_]+$/);
  const design = m ? m[1] : name;
  const size = m ? name.slice(design.length).replace(/^\.\d+_|^_/, '') : '';
  return { folder, design, size, name, key: folder + '|' + design };
}

async function start(entries) {
  entries = await addEntries(entries);
  if (!entries.length) return;
  entries.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  state.files = entries.map((e, i) => {
    const pdf = /\.pdf$/i.test(e.path);
    return { id: i, path: e.path, file: e.file, bytes: e.bytes, isPdf: pdf, ...(pdf ? designKey(e.path) : {}), cands: [], flags: [], version: 0 };
  });
  $('#intake').hidden = true;
  $('#progress').hidden = false;
  $('#btn-reset').hidden = false;
  await processAll();
}

// ------------------------------------------------------------ processing
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

function setProgress(frac, text) {
  $('#bar-fill').style.width = Math.round(frac * 100) + '%';
  $('#progress-text').textContent = text;
}

async function processAll() {
  state.busy = true;
  const t0 = performance.now();
  const pdfs = state.files.filter(f => f.isPdf);
  setProgress(0.02, 'Starting OCR engine…');
  const n = await initOCR((r, total) => setProgress(0.02 + 0.08 * r / total, `Starting OCR engine (${r}/${total} cores)…`));
  let done = 0;
  await pool(pdfs, n * 2, async f => {
    try {
      if (!f.bytes) f.bytes = new Uint8Array(await f.file.arrayBuffer());
      f.analysis = await analyzePDF(f.bytes);
      const cands = f.analysis.candidates;
      f.all = await Promise.all(cands.map(async c => {
        let r = await ocrCandidate(c);
        if (window.__ocrHook) r = window.__ocrHook(f, c, r) || r; // test hook: simulate misreads
        const norm = normalizeText(r.text);
        // the vendor's info box / cut labels: by wording, or tiny lettering (~0.5 in)
        const label = isVendorLabel(norm) || c.heightIn < 0.6;
        return { c, ocr: r, norm, label };
      }));
      assignRoles(f.all);
    } catch (err) {
      console.error(f.path, err);
      f.error = err.message || String(err);
    }
    done++;
    setProgress(0.1 + 0.75 * done / pdfs.length, `Reading files ${done} of ${pdfs.length} · ${n} cores`);
  });
  // every size of a design has the same personalization layer: make them agree
  const byDesign = new Map();
  for (const f of pdfs) if (!f.error) { if (!byDesign.has(f.key)) byDesign.set(f.key, []); byDesign.get(f.key).push(f); }
  for (const fs of byDesign.values()) {
    const wrap = fs.map(f => ({ f, cands: f.all }));
    const notes = propagate(wrap);
    for (const w of wrap) w.f.roleNotes = notes.get(w) || [];
  }
  for (const f of pdfs) if (!f.error) f.cands = classify(f.all);
  buildGroups();
  setProgress(0.86, 'Removing text and checking results…');
  let v = 0;
  await pool(pdfs, 3, async f => { await rebuild(f); v++; setProgress(0.86 + 0.14 * v / pdfs.length, `Checking results ${v} of ${pdfs.length}`); });
  await loadLocalFonts(false); // only succeeds silently if Chrome already granted font access
  for (const g of state.groups.values()) refreshLive(g);
  state.busy = false;
  state.elapsed = (performance.now() - t0) / 1000;
  $('#progress').hidden = true;
  $('#review').hidden = false;
  $('#btn-download').hidden = false;
  $('#btn-download').disabled = false;
  refreshFlags();
  renderSummary();
  renderSelect();
  select(firstFlaggedOr(0));
}

function classify(all) {
  const out = [];
  for (const x of all) {
    let cls = 'none', key;
    const isNum = /^\d+$/.test(x.norm);
    if (x.role) { cls = 'placeholder'; key = 'ROLE:' + x.role; }
    else if (x.label) cls = 'none';
    else if (isNum && x.c.heightIn < 1.0) cls = x.ocr.score >= OCR_LOW ? 'low' : 'none';
    else if (x.ocr.score >= OCR_TEXT && x.norm.length >= 2) cls = 'text';
    else if (x.ocr.score >= OCR_LOW) cls = 'low';
    if (cls === 'none') continue;
    x.cls = cls;
    x.key = key || (cls === 'low' ? '~' : '') + (x.norm || '?') + '#' + x.c.n;
    out.push(x);
  }
  return out;
}

function buildGroups() {
  state.groups = new Map();
  for (const f of state.files.filter(f => f.isPdf)) {
    let g = state.groups.get(f.key);
    if (!g) { g = { key: f.key, folder: f.folder, design: f.design, files: [], items: new Map(), ls: newSettings() }; state.groups.set(f.key, g); }
    g.files.push(f);
    for (const x of f.cands) {
      let it = g.items.get(x.key);
      if (!it) {
        it = { key: x.key, label: x.role ? ROLE_LABEL[x.role] : (x.norm || '(unreadable)'), role: x.role || null, cls: x.cls, on: x.cls === 'placeholder', files: new Set(), conf: x.ocr.score, sample: x, readings: new Set() };
        g.items.set(x.key, it);
      }
      it.files.add(f.id);
      if (x.norm) it.readings.add(x.norm);
      it.conf = Math.max(it.conf, x.ocr.score);
    }
  }
}

function refreshLive(g) {
  for (const f of g.files) {
    if (f.error) { f.lt = null; continue; }
    try { f.lt = fileSpec(f, g.ls); } catch (e) { console.error(e); f.lt = { problems: ['Live text: ' + e.message], notes: [], entry: null }; }
  }
}

function removalIds(f) {
  const g = state.groups.get(f.key);
  return f.cands.filter(x => g.items.get(x.key)?.on).map(x => x.c.id);
}

async function rebuild(f) {
  if (f.error) return;
  const ids = removalIds(f);
  f.removed = ids;
  f.clean = await buildCleanPDF(f.analysis, ids);
  f.version++;
  f.views = null;
  try { await verify(f); } catch (e) { console.error(e); f.verify = { ok: false, msg: 'Could not render for checking: ' + e.message }; }
}

// ------------------------------------------------------------ rendering
async function renderPDF(bytes, width) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / vp1.width });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
    return cv;
  } finally { doc.destroy(); }
}

function boxesFor(f, scale, cvH) {
  const mb = f.analysis.mediaBox;
  return f.removed.map(id => {
    const c = f.analysis.candidates[id];
    const m = c.marginPt;
    const [x0, y0, x1, y1] = c.pageBox;
    return [(x0 - m - mb[0]) * scale, cvH - (y1 + m - mb[1]) * scale, (x1 - x0 + 2 * m) * scale, (y1 - y0 + 2 * m) * scale];
  });
}

// Pixel check: nothing outside the removed text areas may change.
async function verify(f) {
  if (!f.verifyOrig) f.verifyOrig = await renderPDF(f.bytes, VERIFY_W);
  const a = f.verifyOrig;
  if (!f.removed.length) { f.verify = { ok: true, changed: 0 }; return; }
  const b = await renderPDF(f.clean, VERIFY_W);
  const W = a.width, Hh = a.height;
  const da = a.getContext('2d').getImageData(0, 0, W, Hh).data;
  const db = b.getContext('2d').getImageData(0, 0, W, Hh).data;
  const mask = new Uint8Array(W * Hh);
  const mb = f.analysis.mediaBox;
  const scale = W / (mb[2] - mb[0]);
  for (const [x, y, w, h] of boxesFor(f, scale, Hh)) {
    const xa = Math.max(0, Math.floor(x) - 2), ya = Math.max(0, Math.floor(y) - 2);
    const xb = Math.min(W, Math.ceil(x + w) + 2), yb = Math.min(Hh, Math.ceil(y + h) + 2);
    for (let yy = ya; yy < yb; yy++) mask.fill(1, yy * W + xa, yy * W + xb);
  }
  let changed = 0, inside = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const d = Math.max(Math.abs(da[p] - db[p]), Math.abs(da[p + 1] - db[p + 1]), Math.abs(da[p + 2] - db[p + 2]), Math.abs(da[p + 3] - db[p + 3]));
    if (d > 40) { if (mask[i]) inside++; else changed++; }
  }
  f.verify = { ok: changed <= 25, changed, inside };
}

// ------------------------------------------------------------ flags
function refreshFlags() {
  for (const g of state.groups.values()) {
    // what each size removes, as a multiset signature
    const sig = f => f.cands.filter(x => g.items.get(x.key)?.on).map(x => x.key).sort().join(',');
    const counts = new Map();
    for (const f of g.files) if (!f.error) counts.set(sig(f), (counts.get(sig(f)) || 0) + 1);
    const majority = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const f of g.files) {
      f.flags = [];
      if (f.error) { f.flags.push(['bad', `Couldn't process this file (${f.error}). It will be copied to the zip unchanged.`]); continue; }
      if (f.verify && !f.verify.ok) f.flags.push(['bad', `Pixel check failed: ${f.verify.changed} pixels changed outside the removed text. Review before using.`]);
      if (!f.removed.length) f.flags.push(['warn', 'Nothing will be removed from this file. Check for text the detector missed.']);
      for (const t of f.roleNotes || []) f.flags.push(['warn', t]);
      for (const x of f.cands) if (x.role && x.strength < 2 && g.items.get(x.key)?.on)
        f.flags.push(['warn', `${ROLE_LABEL[x.role]} was found by position only (${x.why}). Check it.`]);
      if (f.lt) for (const t of f.lt.problems) f.flags.push(['warn', 'Live text: ' + t]);
      if (g.files.length > 1 && counts.size > 1 && sig(f) !== majority) {
        const mine = f.cands.filter(x => g.items.get(x.key)?.on).map(x => x.norm || '?');
        f.flags.push(['warn', `Removes something different from the other sizes of this design (${mine.join(', ') || 'nothing'}).`]);
      }
    }
  }
  for (const f of state.files) if (!f.isPdf) f.flags = [];
}

const flagLevel = f => f.flags.some(x => x[0] === 'bad') ? 'bad' : f.flags.length ? 'warn' : '';
function firstFlaggedOr(d) { const pdfs = state.files.filter(f => f.isPdf); const i = pdfs.findIndex(f => flagLevel(f)); return (i >= 0 ? pdfs[i] : pdfs[d])?.id ?? -1; }

// ------------------------------------------------------------ UI
function renderSummary() {
  const pdfs = state.files.filter(f => f.isPdf);
  const removed = pdfs.reduce((a, f) => a + (f.removed?.length || 0), 0);
  const warn = pdfs.filter(f => flagLevel(f) === 'warn').length;
  const bad = pdfs.filter(f => flagLevel(f) === 'bad').length;
  const other = state.files.length - pdfs.length;
  const stats = [
    ['', pdfs.length, 'print files'],
    ['', state.groups.size, 'designs'],
    ['good', removed, 'text items removed'],
    [warn ? 'warn' : '', warn, 'need a look'],
    [bad ? 'bad' : '', bad, 'problems'],
  ];
  if (other) stats.push(['', other, 'other files (copied as-is)']);
  $('#summary').innerHTML = stats.map(([c, n, l]) => `<div class="stat ${c}"><b>${n}</b><span>${l}</span></div>`).join('')
    + (state.elapsed ? `<div class="stat"><b>${state.elapsed.toFixed(1)}s</b><span>on ${coreCount()} core${coreCount() === 1 ? '' : 's'}</span></div>` : '');
  $('#status').textContent = '';
}

function renderSelect() {
  const sel = $('#file-select');
  const byFolder = new Map();
  for (const f of state.files.filter(f => f.isPdf)) {
    if (!byFolder.has(f.folder)) byFolder.set(f.folder, []);
    byFolder.get(f.folder).push(f);
  }
  sel.innerHTML = [...byFolder].map(([folder, fs]) =>
    `<optgroup label="${esc(folder || '(top level)')}">` + fs.map(f => {
      const lv = flagLevel(f);
      return `<option value="${f.id}">${lv === 'bad' ? '⛔ ' : lv === 'warn' ? '⚠️ ' : '✓ '}${esc(f.name)}</option>`;
    }).join('') + '</optgroup>').join('');
  if (state.current >= 0) sel.value = state.current;
}

function pdfOrder() { return state.files.filter(f => f.isPdf).map(f => f.id); }

function step(d) {
  const order = pdfOrder();
  const i = order.indexOf(state.current);
  const j = Math.max(0, Math.min(order.length - 1, i + d));
  select(order[j]);
}
function nextFlagged() {
  const order = pdfOrder();
  const i = order.indexOf(state.current);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(i + k) % order.length];
    if (flagLevel(state.files[id])) return select(id);
  }
  $('#status').textContent = 'No flagged files 🎉';
}

let renderToken = 0;
async function select(id) {
  if (id < 0) return;
  state.current = id;
  const f = state.files[id];
  $('#file-select').value = id;
  renderDesignPanel(f);
  renderFileFlags(f);
  const stage = $('#stage');
  const token = ++renderToken;
  if (f.error) { stage.classList.remove('loading'); return; }
  // keep tall garments on screen: cap preview height at ~72% of the window
  const mb = f.analysis.mediaBox;
  const aspect = (mb[3] - mb[1]) / (mb[2] - mb[0]);
  stage.style.maxWidth = Math.max(320, Math.round(window.innerHeight * 0.72 / aspect)) + 'px';
  const width = Math.min(2400, Math.round(stage.clientWidth * (window.devicePixelRatio || 1)));
  if (!f.views || f.views.width !== width || f.views.version !== f.version) {
    stage.classList.add('loading');
    const orig = f.views && f.views.width === width ? f.views.orig : await renderPDF(f.bytes, width);
    const clean = f.removed.length ? await renderPDF(f.clean, width) : orig;
    if (token !== renderToken) return;
    f.views = { width, version: f.version, orig, clean };
  }
  if (token !== renderToken) return;
  paintStage(f);
  stage.classList.remove('loading');
}

function copyCanvas(dst, src) {
  dst.width = src.width; dst.height = src.height;
  dst.getContext('2d').drawImage(src, 0, 0);
}

function paintStage(f) {
  if (!f || !f.views) return; // still rendering; select() paints when it's ready
  const { orig, clean } = f.views;
  copyCanvas($('#cv-orig'), orig);
  copyCanvas($('#cv-clean'), clean);
  $('#cv-orig').style.width = '100%';
  const svg = $('#overlay');
  svg.setAttribute('viewBox', `0 0 ${clean.width} ${clean.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const mb = f.analysis.mediaBox;
  const scale = clean.width / (mb[2] - mb[0]);
  svg.innerHTML = $('#chk-boxes').checked ? boxesFor(f, scale, clean.height).map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`).join('') : '';
  const live = $('#cv-live');
  live.width = clean.width; live.height = clean.height;
  live.getContext('2d').clearRect(0, 0, live.width, live.height);
  if ($('#chk-live').checked && f.lt?.entry) {
    const token = f.version + ':' + JSON.stringify(f.lt.entry);
    live.dataset.token = token;
    paintLivePreview(live, f).then(exact => {
      if (live.dataset.token !== token) return;
      $('#live-note').textContent = exact ? '' : 'Preview uses a stand-in font. Load fonts in the Live text tab for a true preview.';
    });
  } else $('#live-note').textContent = '';
  applyMode();
}

function applyMode() {
  const stage = $('#stage');
  stage.classList.toggle('mode-orig', state.mode === 'orig');
  stage.classList.toggle('mode-clean', state.mode === 'clean');
  const v = $('#slider').value / 10;
  $('#orig-clip').style.clipPath = state.mode === 'compare' ? `inset(0 ${100 - v}% 0 0)` : 'none';
  $('#divider').style.left = v + '%';
  document.querySelectorAll('.seg').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
}

function renderFileFlags(f) {
  const el = $('#file-flags');
  if (!f.flags.length && f.verify) {
    el.innerHTML = `<div class="flag ok">✓ ${f.removed.length} text item${f.removed.length === 1 ? '' : 's'} removed. Pixel check passed: nothing else changed.</div>`;
  } else el.innerHTML = f.flags.map(([lv, msg]) => `<div class="flag ${lv}">${esc(msg)}</div>`).join('');
}

function renderDesignPanel(f) {
  const g = state.groups.get(f.key);
  const items = [...g.items.values()];
  const section = (title, list, help) => list.length ? `<h4>${title}</h4>` + list.map(it => itemRow(g, it)).join('') : (help ? `<h4>${title}</h4><div class="empty">${help}</div>` : '');
  const sizes = g.files.map(x => `<span class="size ${x.id === f.id ? 'cur' : ''} ${flagLevel(x)==='bad' ? 'bad' : flagLevel(x) ? 'flagged' : ''}" data-id="${x.id}">${esc(x.size || x.name)}</span>`).join('');
  const panel = $('#design-panel');
  panel.innerHTML = `
    <h3>${esc(g.design)}</h3>
    <div class="meta">${esc(g.folder || 'top level')} · ${g.files.length} size${g.files.length === 1 ? '' : 's'}</div>
    <div class="sizes">${sizes}</div>
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="remove" class="${state.panelTab === 'remove' ? 'on' : ''}">Remove</button>
      <button role="tab" data-tab="live" class="${state.panelTab === 'live' ? 'on' : ''}">Live text</button>
    </div>
    <div id="tab-body"></div>`;
  const body = panel.querySelector('#tab-body');
  if (state.panelTab === 'remove') {
    body.innerHTML = `
      ${section('Personalization (removed)', items.filter(i => i.cls === 'placeholder').sort((a, b) => ['name', 'back', 'front'].indexOf(a.role) - ['name', 'back', 'front'].indexOf(b.role)), 'No player name or number found in this design.')}
      ${section('Other lettering (kept by default)', items.filter(i => i.cls === 'text'))}
      ${section('Possible text, low confidence', items.filter(i => i.cls === 'low'))}
      <p class="meta" style="margin-top:12px">Switches apply to every size of this design.</p>`;
    body.querySelectorAll('input[data-key]').forEach(inp => inp.addEventListener('change', () => toggleItem(g, inp.dataset.key, inp.checked)));
  } else if (f.error) {
    body.innerHTML = '<div class="empty">This file couldn\'t be read, so no live text can be planned for it.</div>';
  } else {
    renderLivePanel(body, g, f, (all, fontsOnly) => liveChanged(g, all, fontsOnly));
  }
  panel.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { state.panelTab = b.dataset.tab; renderDesignPanel(state.files[state.current]); paintStage(state.files[state.current]); }));
  panel.querySelectorAll('.size').forEach(s => s.addEventListener('click', () => select(+s.dataset.id)));
}

function liveChanged(g, all, fontsOnly) {
  const groups = all ? [...state.groups.values()] : [g];
  if (all) for (const o of groups) if (o !== g) {
    // Copy fonts, what to make, placement and alignment. Each design keeps its own
    // colors (Match vendor / Use mine, fill, stroke, stroke weight) and heights.
    const keep = o.ls, next = structuredClone(g.ls);
    next.sizes = keep.sizes;
    next.styleFrom = keep.styleFrom;
    for (const k of ['name', 'number', 'front']) for (const c of ['fill', 'stroke', 'sw']) next[k][c] = keep[k][c];
    o.ls = next;
  }
  if (!fontsOnly) for (const o of groups) refreshLive(o);
  refreshFlags();
  renderSummary();
  renderSelect();
  const f = state.files[state.current];
  const scroll = $('#design-panel').scrollTop;
  renderDesignPanel(f);
  $('#design-panel').scrollTop = scroll;
  renderFileFlags(f);
  if (f.views) paintStage(f);
  if (all) $('#status').textContent = `Live text settings copied to ${groups.length} designs`;
}

function itemRow(g, it) {
  if (!it.thumb) it.thumb = thumbnail(it.sample.c, it.sample.ocr.rot || 0);
  const n = it.files.size, total = g.files.length;
  const why = it.role ? (it.sample.why ? it.sample.why[0].toUpperCase() + it.sample.why.slice(1) : 'Personalization') : it.cls === 'text' ? 'Lettering' : 'Unclear shape';
  return `<div class="item">
    <div class="thumb">${it.thumb ? `<img alt="" src="${it.thumb}">` : ''}</div>
    <div><div class="label">${esc(it.label)}${it.role && it.readings.size ? ` <span class="meta">(${esc([...it.readings].slice(0, 3).join(', '))})</span>` : ''}</div><div class="why">${why} · in ${n}/${total} size${total === 1 ? '' : 's'}</div></div>
    <label class="switch" title="${it.on ? 'Will be removed' : 'Will be kept'}"><input type="checkbox" data-key="${esc(it.key)}" ${it.on ? 'checked' : ''} aria-label="Remove ${esc(it.label)}"><span></span></label>
  </div>`;
}

async function toggleItem(g, key, on) {
  g.items.get(key).on = on;
  $('#status').textContent = 'Updating…';
  $('#btn-download').disabled = true;
  await pool(g.files, 3, rebuild);
  refreshLive(g);
  refreshFlags();
  renderSummary();
  renderSelect();
  $('#btn-download').disabled = false;
  select(state.current);
}

// ------------------------------------------------------------ export
async function download() {
  const btn = $('#btn-download');
  btn.disabled = true;
  $('#status').textContent = 'Building zip…';
  const zip = new JSZip();
  for (const f of state.files) {
    let data = f.bytes || new Uint8Array(await f.file.arrayBuffer());
    if (f.isPdf && !f.error && f.clean) data = f.clean;
    zip.file(f.path, data, { binary: true });
  }
  // live text manifest + Illustrator script, at the top of the folder structure
  const tops = new Set(state.files.map(f => f.path.includes('/') ? f.path.split('/')[0] : ''));
  const base = tops.size === 1 && [...tops][0] ? [...tops][0] + '/' : '';
  const entries = state.files.filter(f => f.isPdf && !f.error && f.lt?.entry && (f.lt.entry.mkBack || f.lt.entry.mkFront))
    .map(f => ({ path: f.path.slice(base.length), ...f.lt.entry }));
  if (entries.length) {
    const manifest = { tool: 'Print File Text Remover', version: 1, created: new Date().toISOString(), files: entries };
    zip.file(base + '_live_text_manifest.json', JSON.stringify(manifest, null, 1));
    for (const name of ['LiveTextBatch.jsx', 'SwitchOpenDocsToCMYK.jsx']) {
      try {
        const jsx = await (await fetch(new URL('../tools/' + name, import.meta.url))).text();
        zip.file(base + name, jsx);
      } catch (e) { console.error('could not add script', name, e); }
    }
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
  const roots = new Set(state.files.map(f => f.path.includes('/') ? f.path.split('/')[0] : ''));
  const root = roots.size === 1 && [...roots][0] ? [...roots][0] : 'print_files';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${root}_cleaned.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  $('#status').textContent = `Downloaded ${a.download}`;
  if (entries.length) $('#next-step').hidden = false;
  btn.disabled = false;
  window.__lastZip = blob;
}

// ------------------------------------------------------------ wiring
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (!$('#intake').hidden) drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; drop.classList.remove('over'); }));
document.addEventListener('drop', async e => { if ($('#intake').hidden || state.busy) return; start(await readDropped(e.dataTransfer)); });
$('#in-folder').addEventListener('change', e => start([...e.target.files].map(f => ({ path: f.webkitRelativePath || f.name, file: f }))));
$('#in-files').addEventListener('change', e => start([...e.target.files].map(f => ({ path: f.name, file: f }))));
$('#file-select').addEventListener('change', e => select(+e.target.value));
$('#btn-prev').addEventListener('click', () => step(-1));
$('#btn-next').addEventListener('click', () => step(1));
$('#btn-next-flag').addEventListener('click', nextFlagged);
$('#btn-download').addEventListener('click', download);
$('#btn-reset').addEventListener('click', () => location.reload());
$('#btn-hide-next').addEventListener('click', () => { $('#next-step').hidden = true; });
$('#slider').addEventListener('input', applyMode);
$('#chk-boxes').addEventListener('change', () => state.current >= 0 && paintStage(state.files[state.current]));
$('#chk-live').addEventListener('change', () => state.current >= 0 && paintStage(state.files[state.current]));
document.querySelectorAll('.seg').forEach(b => b.addEventListener('click', () => { state.mode = b.dataset.mode; applyMode(); }));
document.addEventListener('keydown', e => {
  if ($('#review').hidden || document.getElementById('help')?.open || e.target.matches('input[type=checkbox], select')) return;
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => state.current >= 0 && select(state.current), 250); });

// test hook: feed files programmatically
window.__start = start;
