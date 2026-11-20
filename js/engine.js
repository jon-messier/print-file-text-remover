// Outlined-text remover engine.
// Pure JS (browser + Node 18+). Parses a PDF, finds flattened text runs,
// and writes an incremental update that deletes the chosen paths while
// leaving every original byte of the file in place.

const enc = new TextEncoder();
const dec = new TextDecoder('latin1');

// ---------------------------------------------------------------- lexer
const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1;

class Lexer {
  constructor(buf, pos = 0, end = buf.length) { this.b = buf; this.p = pos; this.end = end; }
  skipWS() {
    const b = this.b;
    while (this.p < this.end) {
      const c = b[this.p];
      if (WS[c]) { this.p++; continue; }
      if (c === 37) { while (this.p < this.end && b[this.p] !== 10 && b[this.p] !== 13) this.p++; continue; }
      break;
    }
  }
  // returns {k:kind, v:value, s:start, e:end}
  next() {
    this.skipWS();
    const b = this.b, s = this.p;
    if (s >= this.end) return null;
    const c = b[s];
    if (c === 47) { // name
      let p = s + 1;
      while (p < this.end && !WS[b[p]] && !DELIM[b[p]]) p++;
      this.p = p;
      let raw = dec.decode(b.subarray(s + 1, p));
      if (raw.includes('#')) raw = raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return { k: 'name', v: raw, s, e: p };
    }
    if (c === 40) { // literal string
      let p = s + 1, depth = 1;
      while (p < this.end && depth) {
        const d = b[p];
        if (d === 92) { p += 2; continue; }
        if (d === 40) depth++; else if (d === 41) depth--;
        p++;
      }
      this.p = p;
      return { k: 'str', v: b.subarray(s, p), s, e: p };
    }
    if (c === 60) {
      if (b[s + 1] === 60) { this.p = s + 2; return { k: '<<', s, e: s + 2 }; }
      let p = s + 1;
      while (p < this.end && b[p] !== 62) p++;
      this.p = p + 1;
      return { k: 'hex', v: b.subarray(s, p + 1), s, e: p + 1 };
    }
    if (c === 62 && b[s + 1] === 62) { this.p = s + 2; return { k: '>>', s, e: s + 2 }; }
    if (c === 91) { this.p = s + 1; return { k: '[', s, e: s + 1 }; }
    if (c === 93) { this.p = s + 1; return { k: ']', s, e: s + 1 }; }
    if (c === 123 || c === 125) { this.p = s + 1; return { k: 'op', v: String.fromCharCode(c), s, e: s + 1 }; }
    let p = s;
    while (p < this.end && !WS[b[p]] && !DELIM[b[p]]) p++;
    if (p === s) p = s + 1;
    this.p = p;
    const t = dec.decode(b.subarray(s, p));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return { k: 'num', v: parseFloat(t), s, e: p, int: /^[+-]?\d+$/.test(t) };
    return { k: 'op', v: t, s, e: p };
  }
}

// ---------------------------------------------------------------- PDF objects
// values: number | {name} | {ref:[n,g]} | Array | Dict(Map) | {str:bytes} | {hex:bytes} | true/false/null
class Name { constructor(n) { this.name = n; } }
class Ref { constructor(n, g) { this.n = n; this.g = g; } }

function parseValue(lx, tok) {
  tok = tok || lx.next();
  if (!tok) throw new Error('unexpected EOF');
  switch (tok.k) {
    case 'name': return new Name(tok.v);
    case 'str': return { str: tok.v };
    case 'hex': return { hex: tok.v };
    case '[': {
      const arr = [];
      for (;;) {
        const t = lx.next();
        if (!t) throw new Error('unterminated array');
        if (t.k === ']') return arr;
        arr.push(parseRefOr(lx, t));
      }
    }
    case '<<': {
      const d = new Map();
      for (;;) {
        const t = lx.next();
        if (!t) throw new Error('unterminated dict');
        if (t.k === '>>') return d;
        if (t.k !== 'name') throw new Error('bad dict key');
        d.set(t.v, parseRefOr(lx, lx.next()));
      }
    }
    case 'num': return tok.v;
    case 'op':
      if (tok.v === 'true') return true;
      if (tok.v === 'false') return false;
      if (tok.v === 'null') return null;
      return { op: tok.v };
  }
  throw new Error('bad token ' + tok.k);
}

function parseRefOr(lx, tok) {
  if (tok.k === 'num' && tok.int) {
    const save = lx.p;
    const t2 = lx.next();
    if (t2 && t2.k === 'num' && t2.int) {
      const t3 = lx.next();
      if (t3 && t3.k === 'op' && t3.v === 'R') return new Ref(tok.v, t2.v);
    }
    lx.p = save;
    return tok.v;
  }
  return parseValue(lx, tok);
}

function serialize(v) {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  if (v instanceof Name) return '/' + v.name.replace(/[^\x21-\x7e]|[#()<>\[\]{}\/%]/g, ch => '#' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
  if (v instanceof Ref) return `${v.n} ${v.g} R`;
  if (Array.isArray(v)) return '[' + v.map(serialize).join(' ') + ']';
  if (v instanceof Map) { let s = '<<'; for (const [k, x] of v) s += serialize(new Name(k)) + ' ' + serialize(x); return s + '>>'; }
  if (v.str) return dec.decode(v.str);
  if (v.hex) return dec.decode(v.hex);
  throw new Error('cannot serialize');
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
async function deflate(bytes) {
  const cs = new CompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
}

function lastIndexOf(buf, str, from = buf.length) {
  const s = enc.encode(str);
  outer: for (let i = Math.min(from, buf.length - s.length); i >= 0; i--) {
    for (let j = 0; j < s.length; j++) if (buf[i + j] !== s[j]) continue outer;
    return i;
  }
  return -1;
}

export class PDFDoc {
  constructor(bytes) {
    this.bytes = bytes;
    this.offsets = new Map(); // objnum -> {off, gen}
    this.cache = new Map();
    const sx = lastIndexOf(bytes, 'startxref');
    if (sx < 0) throw new Error('No startxref found');
    const lx = new Lexer(bytes, sx + 9);
    this.startxref = lx.next().v;
    this.trailer = null;
    let off = this.startxref;
    const seen = new Set();
    while (off != null && !seen.has(off)) {
      seen.add(off);
      const tl = new Lexer(bytes, off);
      const t = tl.next();
      if (!t || t.k !== 'op' || t.v !== 'xref') throw new Error('Unsupported PDF: compressed cross-reference stream');
      for (;;) {
        const a = tl.next();
        if (a.k === 'op' && a.v === 'trailer') break;
        const count = tl.next().v;
        for (let i = 0; i < count; i++) {
          const o = tl.next().v, g = tl.next().v, f = tl.next().v;
          const num = a.v + i;
          if (f === 'n' && !this.offsets.has(num)) this.offsets.set(num, { off: o, gen: g });
          if (f === 'f' && !this.offsets.has(num)) this.offsets.set(num, null);
        }
      }
      const tr = parseValue(tl);
      if (!this.trailer) this.trailer = tr;
      if (tr.has('XRefStm')) throw new Error('Unsupported PDF: hybrid cross-reference');
      off = tr.has('Prev') ? tr.get('Prev') : null;
    }
    let maxN = 0; for (const k of this.offsets.keys()) maxN = Math.max(maxN, k);
    this.size = Math.max(this.trailer.get('Size') || 0, maxN + 1);
  }
  get(num) {
    if (this.cache.has(num)) return this.cache.get(num);
    const ent = this.offsets.get(num);
    if (!ent) return null;
    const lx = new Lexer(this.bytes, ent.off);
    lx.next(); lx.next(); const objKw = lx.next();
    if (!objKw || objKw.v !== 'obj') throw new Error('Bad object ' + num);
    const val = parseValue(lx);
    let obj = { num, gen: ent.gen, dict: val instanceof Map ? val : null, value: val };
    const save = lx.p;
    const t = lx.next();
    if (t && t.k === 'op' && t.v === 'stream') {
      let p = t.e;
      if (this.bytes[p] === 13) p++;
      if (this.bytes[p] === 10) p++;
      let len = this.resolve(val.get('Length'));
      // sanity: confirm endstream follows, else search for it
      const after = dec.decode(this.bytes.subarray(p + len, p + len + 20));
      if (!/^\s*endstream/.test(after)) {
        const idx = indexOf(this.bytes, 'endstream', p);
        len = idx - p;
        while (len > 0 && (this.bytes[p + len - 1] === 10 || this.bytes[p + len - 1] === 13)) len--;
      }
      obj.raw = this.bytes.subarray(p, p + len);
      obj.stream = true;
    } else lx.p = save;
    this.cache.set(num, obj);
    return obj;
  }
  resolve(v) {
    while (v instanceof Ref) { const o = this.get(v.n); v = o ? o.value : null; }
    return v;
  }
  async decoded(obj) {
    if (obj._decoded) return obj._decoded;
    let filt = this.resolve(obj.dict.get('Filter'));
    if (filt instanceof Name) filt = [filt];
    let data = obj.raw;
    for (const f of (filt || [])) {
      if (f.name === 'FlateDecode' || f.name === 'Fl') {
        const parms = this.resolve(obj.dict.get('DecodeParms'));
        if (parms && parms.get && parms.get('Predictor') > 1) throw new Error('Unsupported stream predictor');
        data = await inflate(data);
      } else throw new Error('Unsupported stream filter ' + f.name);
    }
    obj._decoded = data;
    return data;
  }
  firstPage() {
    const root = this.resolve(this.trailer.get('Root'));
    let node = this.resolve(root.get('Pages'));
    let ref = root.get('Pages');
    const inherited = {};
    while (node.get('Type') && node.get('Type').name === 'Pages') {
      if (node.has('Resources')) inherited.Resources = node.get('Resources');
      ref = node.get('Kids')[0];
      node = this.resolve(ref);
    }
    return { dict: node, ref, resources: this.resolve(node.get('Resources') || inherited.Resources) };
  }
}

function indexOf(buf, str, from = 0) {
  const s = enc.encode(str);
  outer: for (let i = from; i <= buf.length - s.length; i++) {
    for (let j = 0; j < s.length; j++) if (buf[i + j] !== s[j]) continue outer;
    return i;
  }
  return -1;
}

// ---------------------------------------------------------------- content streams
const PATH_OPS = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const FILL_OPS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const STROKE_OPS = new Set(['S', 's']);
const PAINT_OPS = new Set([...FILL_OPS, ...STROKE_OPS, 'n']);

function tokenizeContent(buf) {
  const lx = new Lexer(buf);
  const ops = [];
  let args = [], start = -1;
  const stack = [];
  for (;;) {
    const t = lx.next();
    if (!t) break;
    if (start < 0) start = t.s;
    if (t.k === 'op') {
      if (t.v === 'BI') { // inline image: skip to EI
        let p = indexOf(buf, 'ID', t.e);
        p += 3;
        for (;;) {
          const q = indexOf(buf, 'EI', p);
          if (q < 0) { p = buf.length; break; }
          if (WS[buf[q - 1]] && (q + 2 >= buf.length || WS[buf[q + 2]])) { p = q + 2; break; }
          p = q + 2;
        }
        lx.p = p;
        ops.push({ op: 'BI', args: [], s: start, e: p });
        args = []; start = -1; continue;
      }
      if (t.v === 'true' || t.v === 'false' || t.v === 'null') { args.push(t.v); continue; }
      ops.push({ op: t.v, args, s: start, e: t.e });
      args = []; start = -1;
    } else if (t.k === 'num') args.push(t.v);
    else if (t.k === 'name') args.push({ name: t.v });
    else if (t.k === '[' || t.k === '<<') { lx.p = t.s; parseValue(lx); args.push({ other: true }); }
    else args.push({ other: true });
  }
  return ops;
}

const mul = (a, b) => [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3], a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3], a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5]];
const tp = (m, x, y) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];

function bez(p0, p1, p2, p3, n = 8) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0], u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]]);
  }
  return out;
}

// Extract painted shapes (in the stream's own coordinate space) + form XObject calls.
function extractShapes(ops) {
  const shapes = [], xobjs = [];
  const stack = [];
  let m = [1, 0, 0, 1, 0, 0], fill = null, cs = null, stroke = null, scs = null, lw = 1;
  let polys = [], cur = null, nsub = 0, npts = 0, clip = false, pathStart = -1;
  let bb = null;
  const add = p => { npts++; if (!bb) bb = [p[0], p[1], p[0], p[1]]; else { if (p[0] < bb[0]) bb[0] = p[0]; if (p[1] < bb[1]) bb[1] = p[1]; if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] > bb[3]) bb[3] = p[1]; } };
  const reset = () => { polys = []; cur = null; nsub = 0; npts = 0; clip = false; pathStart = -1; bb = null; };
  ops.forEach((o, i) => {
    const a = o.args;
    switch (o.op) {
      case 'q': stack.push([m, fill, cs, stroke, scs, lw]); break;
      case 'Q': if (stack.length) [m, fill, cs, stroke, scs, lw] = stack.pop(); break;
      case 'w': if (typeof a[0] === 'number') lw = a[0]; break;
      case 'CS': scs = a[0] && a[0].name; break;
      case 'SC': case 'SCN': case 'RG': case 'G': case 'K':
        stroke = o.op.toLowerCase() + '|' + scs + '|' + a.map(x => typeof x === 'number' ? x.toFixed(4) : (x.name || '?')).join(','); break;
      case 'cm': if (a.length === 6) m = mul(a, m); break;
      case 'cs': cs = a[0] && a[0].name; break;
      case 'sc': case 'scn': case 'rg': case 'g': case 'k':
        fill = o.op + '|' + cs + '|' + a.map(x => typeof x === 'number' ? x.toFixed(4) : (x.name || '?')).join(','); break;
      case 'm': {
        if (pathStart < 0) pathStart = i;
        const p = tp(m, a[0], a[1]); add(p); nsub++; cur = [p]; polys.push(cur); break;
      }
      case 'l': { if (pathStart < 0) pathStart = i; const p = tp(m, a[0], a[1]); add(p); if (cur) cur.push(p); break; }
      case 'c': case 'v': case 'y': {
        if (pathStart < 0) pathStart = i;
        const pts = []; for (let k = 0; k + 1 < a.length; k += 2) pts.push(tp(m, a[k], a[k + 1]));
        pts.forEach(add);
        if (cur) {
          const p0 = cur[cur.length - 1];
          let c1, c2, p3;
          if (o.op === 'c') [c1, c2, p3] = pts; else if (o.op === 'v') { c1 = p0; [c2, p3] = pts; } else { [c1, p3] = pts; c2 = p3; }
          cur.push(...bez(p0, c1, c2, p3));
        }
        break;
      }
      case 'h': if (pathStart < 0) pathStart = i; break;
      case 're': {
        if (pathStart < 0) pathStart = i;
        const [x, y, w, h] = a;
        const q4 = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(p => tp(m, p[0], p[1]));
        q4.forEach(add); nsub++; polys.push(q4); cur = null; break;
      }
      case 'W': case 'W*': clip = true; break;
      case 'Do': xobjs.push({ i, name: a[0] && a[0].name, m }); break;
      default:
        if (PAINT_OPS.has(o.op)) {
          if (bb) shapes.push({ idx: i, op: o.op, clip, fill, stroke, lwPt: lw * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])), nsub, npts, bbox: bb, polys, rangeStart: ops[pathStart].s, rangeEnd: o.e, evenOdd: o.op.endsWith('*') });
          reset();
        }
    }
  });
  return { shapes, xobjs };
}

// ---------------------------------------------------------------- text-run detection
const H = s => s.bbox[3] - s.bbox[1];
const W = s => s.bbox[2] - s.bbox[0];

function sameLine(ref, s, line) {
  const h = Math.max(H(ref), H(s)), tol = 0.04 * h;
  const aligned = Math.abs(ref.bbox[1] - s.bbox[1]) < tol || Math.abs(ref.bbox[3] - s.bbox[3]) < tol;
  if (!aligned) return false;
  const r = H(s) / Math.max(H(ref), 1e-6);
  if (!(r > 0.45 && r < 2.2)) return false;
  for (const t of line) {
    const ox = Math.min(t.bbox[2], s.bbox[2]) - Math.max(t.bbox[0], s.bbox[0]);
    // script letters overlap their neighbours; block letters don't. Allow up to 60%.
    if (ox > 0.6 * Math.min(W(t), W(s))) return false;
  }
  const lx0 = Math.min(...line.map(t => t.bbox[0])), lx1 = Math.max(...line.map(t => t.bbox[2]));
  const gap = Math.max(lx0 - s.bbox[2], s.bbox[0] - lx1, 0);
  return gap < 1.5 * h;
}

function findRuns(shapes) {
  const fills = shapes.filter(s => FILL_OPS.has(s.op) && !s.clip);
  const groups = []; let cur = [];
  for (const s of fills) {
    if (cur.length && s.fill === cur[cur.length - 1].fill) cur.push(s);
    else { if (cur.length) groups.push(cur); cur = [s]; }
  }
  if (cur.length) groups.push(cur);
  const runs = [];
  for (let g of groups) {
    // keep plain rectangles: letters like I, l and 1 are often 4-point boxes
    g = g.filter(s => s.npts >= 4);
    if (g.length > 400) continue; // dense artwork (pattern/texture), not lettering
    const used = new Set();
    const lines = [];
    for (let a = 0; a < g.length; a++) {
      if (used.has(a)) continue;
      const line = [a];
      let grew = true;
      while (grew) {
        grew = false;
        for (let b = a + 1; b < g.length; b++) {
          if (used.has(b) || line.includes(b)) continue;
          if (sameLine(g[line[0]], g[b], line.map(k => g[k]))) { line.push(b); grew = true; }
        }
      }
      line.forEach(k => used.add(k));
      lines.push(line.map(k => g[k]));
    }
    runs.push(...mergeWordParts(lines));
  }
  return runs;
}

// Join pieces of one word that the baseline rule split apart: descenders and
// ascenders in script ("g" in Wright), and word halves split by heavy overlap.
function mergeWordParts(lines) {
  const box = l => unionBox(l);
  let changed = true;
  while (changed) {
    changed = false;
    lines.sort((a, b) => b.length - a.length);
    outer: for (let i = 0; i < lines.length; i++) {
      const A = lines[i]; if (A.length < 2) continue;
      const a = box(A), ha = a[3] - a[1];
      for (let j = 0; j < lines.length; j++) {
        if (i === j) continue;
        const B = lines[j], b = box(B), hb = b[3] - b[1];
        if (hb > 2.5 * ha || hb < 0.15 * ha) continue;
        const vov = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        if (vov < 0.5 * Math.min(ha, hb)) continue;           // must share most of the line band
        const gap = Math.max(a[0] - b[2], b[0] - a[2], 0);
        if (gap > 0.5 * ha) continue;                            // and sit right next to / inside it
        // drawn in sequence with the word (vendors draw a word's letters together)
        const ia = A.map(s => s.idx), ib = B.map(s => s.idx);
        const lo = Math.min(...ia), hi = Math.max(...ia);
        if (!ib.every(x => x > lo - 200 && x < hi + 200)) continue;
        lines[i] = [...A, ...B].sort((p, q) => p.idx - q.idx);
        lines.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return lines;
}

function unionBox(list) {
  return [Math.min(...list.map(s => s.bbox[0])), Math.min(...list.map(s => s.bbox[1])),
          Math.max(...list.map(s => s.bbox[2])), Math.max(...list.map(s => s.bbox[3]))];
}

// The outline drawn under the lettering. Two ways vendors draw it:
//  - one stroke path for the whole word/number (subpaths = all the glyphs' subpaths), or
//  - one stroke path per glyph (e.g. the "1" and the "2" of a 12 each outlined on their own).
// Returns a list of stroke shapes (empty when there's no outline).
function findOutlines(run, shapes) {
  const h = Math.max(...run.map(H));
  const first = Math.min(...run.map(s => s.idx)), last = Math.max(...run.map(s => s.idx));
  const totalSub = run.reduce((a, s) => a + s.nsub, 0);
  const ux = unionBox(run);
  let whole = null;
  for (const s of shapes) {
    if (STROKE_OPS.has(s.op) && s.idx < first && first - s.idx < 60) {
      if ([0, 1, 2, 3].every(k => Math.abs(s.bbox[k] - ux[k]) < 0.15 * h) && Math.abs(s.nsub - totalSub) <= 2) whole = s;
    }
  }
  if (whole) return [whole];
  // per glyph: every glyph needs its own matching stroke, near the run in drawing order
  const used = new Set(), per = [];
  for (const g of run) {
    const gh = H(g) || 1;
    let best = null, bestD = Infinity;
    for (const s of shapes) {
      if (!STROKE_OPS.has(s.op) || used.has(s.idx) || s.idx < first - 60 * run.length || s.idx > last + 60) continue;
      if (s.nsub < g.nsub || s.nsub > g.nsub + 2) continue;
      const d = Math.max(...[0, 1, 2, 3].map(k => Math.abs(s.bbox[k] - g.bbox[k])));
      if (d < 0.15 * gh && d < bestD) { best = s; bestD = d; }
    }
    if (!best) return [];
    used.add(best.idx); per.push(best);
  }
  return per;
}

function isolated(run, shapes) {
  const ids = new Set(run.map(s => s.idx));
  const ux = unionBox(run);
  const first = Math.min(...run.map(s => s.idx));
  for (const s of shapes) {
    if (ids.has(s.idx) || s.clip || !FILL_OPS.has(s.op) || s.idx < first) continue;
    const b = s.bbox;
    if (b[2] <= ux[0] || b[0] >= ux[2] || b[3] <= ux[1] || b[1] >= ux[3]) continue;
    if (b[0] <= ux[0] && b[1] <= ux[1] && b[2] >= ux[2] && b[3] >= ux[3]) continue;
    return false;
  }
  return true;
}

function fingerprint(run) {
  const ux = unionBox(run), h = ux[3] - ux[1] || 1;
  const q = v => Math.round(v / h * 200);
  return run.length + ':' + run.map(s => [q(s.bbox[0] - ux[0]), q(s.bbox[1] - ux[1]), q(W(s)), q(H(s)), s.nsub, s.npts].join(',')).join(';');
}

// Turn a paint-state string ("op|colorspace|args") into a spot name or CMYK values.
// The CMYK a spot colour stands for (its full-tint alternate), when the file says so plainly.
function spotAlt(doc, space) {
  try {
    const alt = doc.resolve(space[2]);
    if (!alt || alt.name !== 'DeviceCMYK') return null;
    let fn = doc.resolve(space[3]);
    if (fn && fn.dict) fn = fn.dict;
    if (!fn || typeof fn.get !== 'function' || doc.resolve(fn.get('FunctionType')) !== 2) return null;
    const c1 = doc.resolve(fn.get('C1'));
    if (!Array.isArray(c1) || c1.length !== 4) return null;
    return c1.map(v => Math.round(doc.resolve(v) * 10000) / 100);
  } catch (e) { return null; }
}

function resolveColor(doc, res, str) {
  if (!str) return null;
  const [op, cs, argStr] = str.split('|');
  const args = argStr.split(',');
  const nums = args.map(Number);
  if (op === 'k') return { kind: 'cmyk', v: nums.map(v => Math.round(v * 10000) / 100) };
  if (op === 'g') return { kind: 'cmyk', v: [0, 0, 0, Math.round((1 - nums[0]) * 10000) / 100] };
  if (op === 'rg') return { kind: 'rgb', v: nums };
  if ((op === 'sc' || op === 'scn') && cs && cs !== 'null') {
    const csd = res && doc.resolve(res.get('ColorSpace'));
    let space = csd && doc.resolve(csd.get(cs));
    if (space instanceof Name) space = { name: space.name };
    if (Array.isArray(space)) {
      const fam = doc.resolve(space[0]);
      if (fam && fam.name === 'Separation') {
        const nm = doc.resolve(space[1]);
        const alt = spotAlt(doc, space);
        if (alt && nm) (doc._spots || (doc._spots = {}))[nm.name] = alt;   // the file's own swatch values
        return { kind: 'spot', name: nm && nm.name, tint: nums[0], alt };
      }
      if (fam && fam.name === 'DeviceCMYK') return { kind: 'cmyk', v: nums.map(v => Math.round(v * 10000) / 100) };
      if (fam && fam.name === 'ICCBased') {
        const icc = doc.get(space[1].n);
        const n = icc && doc.resolve(icc.dict.get('N'));
        if (n === 4) return { kind: 'cmyk', v: nums.map(v => Math.round(v * 10000) / 100) };
        if (n === 3) return { kind: 'rgb', v: nums };
      }
    } else if (space && space.name === 'DeviceCMYK') return { kind: 'cmyk', v: nums.map(v => Math.round(v * 10000) / 100) };
  }
  return null;
}

// Analyse a PDF; returns candidates needing OCR. Throws on unsupported structure.
export async function analyzePDF(bytes) {
  const doc = new PDFDoc(bytes);
  const page = doc.firstPage();
  const mb = doc.resolve(page.dict.get('MediaBox')).map(v => doc.resolve(v));
  const streams = new Map(); // objnum -> {obj, decoded}
  const candidates = [];
  const seen = new Set();

  async function visit(streamObjs, res, chain, ctm, isPage) {
    for (const obj of streamObjs) {
      if (seen.has(obj.num)) continue;
      seen.add(obj.num);
      const data = await doc.decoded(obj);
      const ops = tokenizeContent(data);
      const { shapes, xobjs } = extractShapes(ops);
      streams.set(obj.num, { obj, data, ops, shapes, chain });
      const sc = Math.hypot(ctm[0], ctm[1]);
      for (const run0 of findRuns(shapes)) {
        const wordShape = run0.length === 1 && W(run0[0]) / Math.max(H(run0[0]), 1e-6) >= 1.6; // script word drawn as one shape
        const allSimple = run0.every(s => s.nsub <= 4) || (wordShape && run0[0].nsub <= 60);
        if (!allSimple) continue;
        const outlines = findOutlines(run0, shapes);
        const outline = outlines[0] || null;
        const h = Math.max(...run0.map(H));
        const hIn = h * sc / 72;
        const n = run0.length;
        const plausible = n >= 3 || (n >= 2 && h > 20) || outline || (n === 1 && hIn >= 1.0) || (wordShape && hIn >= 0.5);
        if (!plausible) continue;
        if (hIn < 0.2 || hIn > 15) continue; // nothing on a jersey is lettering taller than 15 in
        if (!isolated(run0, shapes)) continue;
        const run = [...run0].sort((a, b) => a.bbox[0] - b.bbox[0]);
        const boxes = [...run, ...outlines].map(s => {
          const p1 = tp(ctm, s.bbox[0], s.bbox[1]), p2 = tp(ctm, s.bbox[2], s.bbox[3]);
          return [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
        });
        candidates.push({
          id: candidates.length, objNum: obj.num, chain, topLevel: chain.split('/').length <= 2, wordShape,
          glyphs: run, outline, outlines, heightIn: +hIn.toFixed(2), n,
          pageBox: [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))],
          marginPt: h * sc * 0.15,
          fp: fingerprint(run),
          // for live-text replacement: visible box = glyph fills + half the outline stroke
          glyphBox: (() => { const gb = boxes.slice(0, run.length); return [Math.min(...gb.map(b => b[0])), Math.min(...gb.map(b => b[1])), Math.max(...gb.map(b => b[2])), Math.max(...gb.map(b => b[3]))]; })(),
          strokeWidthPt: outline ? outline.lwPt * sc : 0,
          fillColor: resolveColor(doc, res, run[0].fill),
          strokeColor: outline ? resolveColor(doc, res, outline.stroke) : null,
        });
      }
      for (const x of xobjs) {
        if (!x.name || !res) continue;
        const xd = doc.resolve(res.get('XObject'));
        if (!xd) continue;
        const ref = xd.get(x.name);
        if (!(ref instanceof Ref)) continue;
        const xo = doc.get(ref.n);
        if (!xo || !xo.stream) continue;
        const st = doc.resolve(xo.dict.get('Subtype'));
        if (!st || st.name !== 'Form') continue;
        let mm = x.m;
        const mat = doc.resolve(xo.dict.get('Matrix'));
        if (mat) mm = mul(mat.map(v => doc.resolve(v)), x.m);
        const xres = doc.resolve(xo.dict.get('Resources')) || res;
        await visit([xo], xres, chain + '/' + x.name, mul(mm, ctm), false);
      }
    }
  }

  let contents = page.dict.get('Contents');
  contents = Array.isArray(doc.resolve(contents)) ? doc.resolve(contents) : [contents];
  const cobjs = contents.map(r => doc.get(r.n));
  // A page with several content streams is treated as one top level
  await visit(cobjs, page.resources, 'page', [1, 0, 0, 1, 0, 0], true);
  return { doc, streams, candidates, mediaBox: mb, spots: doc._spots || {} };
}

// Remove the given candidates (glyph fills + outline strokes). Returns new PDF bytes.
export async function buildCleanPDF(analysis, removeIds) {
  const { doc, streams, candidates } = analysis;
  const byObj = new Map();
  for (const id of removeIds) {
    const c = candidates[id];
    const list = byObj.get(c.objNum) || [];
    for (const s of c.glyphs) list.push([s.rangeStart, s.rangeEnd]);
    for (const o of c.outlines || (c.outline ? [c.outline] : [])) list.push([o.rangeStart, o.rangeEnd]);
    byObj.set(c.objNum, list);
  }
  if (!byObj.size) return doc.bytes;
  const parts = [];
  const entries = [];
  let offset = doc.bytes.length;
  const push = s => { const b = typeof s === 'string' ? enc.encode(s) : s; parts.push(b); offset += b.length; };
  push('\n');
  for (const [num, ranges] of [...byObj].sort((a, b) => a[0] - b[0])) {
    const st = streams.get(num);
    ranges.sort((a, b) => a[0] - b[0]);
    const chunks = []; let p = 0;
    for (const [s, e] of ranges) { if (s < p) continue; chunks.push(st.data.subarray(p, s)); chunks.push(enc.encode('\n')); p = e; }
    chunks.push(st.data.subarray(p));
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const plain = new Uint8Array(total); let k = 0;
    for (const c of chunks) { plain.set(c, k); k += c.length; }
    const z = await deflate(plain);
    const d = new Map(st.obj.dict);
    d.set('Length', z.length);
    d.set('Filter', new Name('FlateDecode'));
    d.delete('DecodeParms');
    entries.push([num, st.obj.gen, offset]);
    push(`${num} ${st.obj.gen} obj\n${serialize(d)}\nstream\n`);
    push(z);
    push('\nendstream\nendobj\n');
  }
  const xrefOff = offset;
  let x = 'xref\n';
  entries.sort((a, b) => a[0] - b[0]);
  for (const [num, gen, off] of entries) x += `${num} 1\n${String(off).padStart(10, '0')} ${String(gen).padStart(5, '0')} n \n`;
  const tr = new Map();
  for (const key of ['Root', 'Info', 'ID', 'Encrypt']) if (doc.trailer.has(key)) tr.set(key, doc.trailer.get(key));
  tr.set('Size', doc.size);
  tr.set('Prev', doc.startxref);
  x += `trailer\n${serialize(tr)}\nstartxref\n${xrefOff}\n%%EOF\n`;
  push(x);
  const out = new Uint8Array(offset);
  out.set(doc.bytes, 0);
  let q = doc.bytes.length;
  for (const b of parts) { out.set(b, q); q += b.length; }
  return out;
}

// ---------------------------------------------------------------- classification
export const PLACEHOLDERS = ['NAME', 'PLAYER', 'PLAYERNAME', '00'];

export function normalizeText(t) {
  let s = (t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // OCR often reads 0 as O in number-only runs
  if (/^[0O]+$/.test(s)) s = s.replace(/O/g, '0');
  return s;
}

export function isPlaceholder(norm, n) {
  if (norm.length !== n) return false;
  // NAME / PLAYER, or a 1–2 digit jersey number (00, 26, 7 …)
  return PLACEHOLDERS.includes(norm) || /^\d{1,2}$/.test(norm);
}

// The vendor's info box and cut labels ("NEW", "SLVB125G-Small", "58" x 21.45"",
// "WEARER'S RIGHT SLEEVE") are never removed and never listed.
export function isVendorLabel(norm) {
  return /^NEW$/.test(norm) || /^SL[A-Z]{2}\d{3}/.test(norm) || /^\d+X\d+/.test(norm) || /SLEEVE$/.test(norm) || /^WEARER/.test(norm);
}
