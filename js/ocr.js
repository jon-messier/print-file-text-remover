// OCR confirmation: draws a candidate run by itself and reads it with Tesseract.
// Runs one Tesseract worker per spare CPU core; identical shapes (same design
// in another size) reuse the earlier result.

let scheduler = null;
let workerCount = 0;
let digitWorker = null;
let charWorker = null;
const cache = new Map(); // fingerprint -> Promise<result>

export function coreCount() {
  const hc = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(hc - 1, 12));
}

export async function initOCR(onProgress) {
  if (scheduler) return workerCount;
  const T = window.Tesseract;
  scheduler = T.createScheduler();
  const n = coreCount();
  const base = new URL('./vendor/tesseract/', document.baseURI).href;
  let ready = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    const w = await T.createWorker('eng', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base + 'lang',
      gzip: false,
      workerBlobURL: false,
    });
    await w.setParameters({ tessedit_pageseg_mode: '7' });
    scheduler.addWorker(w);
    ready++;
    onProgress && onProgress(ready, n);
  }));
  // one extra worker that only reads digits, for jersey numbers OCR misreads (26 -> "2B")
  digitWorker = await T.createWorker('eng', 1, {
    workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', gzip: false, workerBlobURL: false,
  });
  await digitWorker.setParameters({ tessedit_pageseg_mode: '8', tessedit_char_whitelist: '0123456789' });
  // and one that reads a single digit at a time (decorative pairs often fail as a whole)
  charWorker = await T.createWorker('eng', 1, {
    workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang', gzip: false, workerBlobURL: false,
  });
  await charWorker.setParameters({ tessedit_pageseg_mode: '10', tessedit_char_whitelist: '0123456789' });
  workerCount = n;
  return n;
}

// Draw glyph polygons black on white. rot=180 flips upside-down text.
export function renderRun(cand, targetH = 120, rot = 0, pad = 40) {
  const pts = [];
  for (const s of cand.glyphs) for (const poly of s.polys) for (const p of poly) pts.push(p);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const sc = targetH / Math.max(y1 - y0, 1e-6);
  const W = Math.round((x1 - x0) * sc) + 2 * pad, H = Math.round((y1 - y0) * sc) + 2 * pad;
  if (W > 6000 || W < 4) return null;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  if (rot === 180) { g.translate(W, H); g.rotate(Math.PI); }
  g.fillStyle = '#000';
  for (const s of cand.glyphs) {
    const path = new Path2D();
    for (const poly of s.polys) {
      if (poly.length < 2) continue;
      poly.forEach(([x, y], i) => {
        const px = (x - x0) * sc + pad, py = (y1 - y) * sc + pad;
        i ? path.lineTo(px, py) : path.moveTo(px, py);
      });
      path.closePath();
    }
    g.fill(path, s.evenOdd ? 'evenodd' : 'nonzero');
  }
  return c;
}

async function readOnce(canvas) {
  const { data } = await scheduler.addJob('recognize', canvas);
  const txt = (data.text || '').replace(/\s+/g, '');
  return { txt, conf: data.confidence || 0 };
}

async function ocrUncached(cand) {
  const n = cand.n;
  let best = { text: '', score: 0, alnum: 0 };
  const variants = [[0, 120], [180, 120], [0, 60], [180, 60]];
  for (const [rot, th] of variants) {
    const cv = renderRun(cand, th, rot);
    if (!cv) continue;
    const { txt, conf } = await readOnce(cv);
    const alnum = (txt.match(/[A-Za-z0-9]/g) || []).length;
    const match = Math.min(alnum, n) / Math.max(alnum, n, 1);
    const score = conf * match;
    if (score > best.score) best = { text: txt, score: Math.round(score), alnum, rot };
    if (best.score >= 90) break; // confident enough, skip the other variants
  }
  // Big 1–2 shape groups that didn't read cleanly are usually a jersey number in a
  // blocky font (26 -> "2B" / "CH"). Re-read with digits only; accept only at >= 90%.
  if (digitWorker && n <= 2 && cand.heightIn >= 1.0 && !/^\d+$/.test(best.text)) {
    let got = null, any = null;
    for (const rot of [0, 180]) {
      for (const h of [120, 200, 70]) {
        const cv = renderRun(cand, h, rot);
        if (!cv) continue;
        const { data } = await digitWorker.recognize(cv);
        const txt = (data.text || '').replace(/\s+/g, '');
        const score = Math.round(data.confidence || 0);
        if (txt.length !== n || !/^\d+$/.test(txt)) continue;
        const r = { text: txt, score, alnum: n, rot, digitsOnly: true };
        if (!any || score > any.score) any = r;
        if (score >= 90 && (!got || score > got.score)) got = r;
      }
      if (got && got.score >= 95) break;
    }
    if (got && got.score >= best.score) best = got;
    // best digits-only reading at any confidence (roles.js weighs it with structure)
    best.digits = any;
  }
  // one digit at a time, for 1–2 glyph groups
  if (charWorker && n <= 2 && cand.heightIn >= 1.0 && cand.glyphs.length === n) {
    const order = [...cand.glyphs].sort((a, b) => a.bbox[0] - b.bbox[0]);
    let bestPG = null;
    for (const rot of [0, 180]) {
      const seq = rot === 180 ? [...order].reverse() : order;
      let txt = '', min = 100, ok = true;
      for (const g of seq) {
        let bestC = null;
        for (const h of [120, 70, 200]) {          // some shapes only read at one size
          const cv = renderRun({ glyphs: [g] }, h, rot, Math.round(h * 0.4));
          if (!cv) continue;
          const { data } = await charWorker.recognize(cv);
          const t = (data.text || '').replace(/\s+/g, '');
          const c = Math.round(data.confidence || 0);
          if (/^\d$/.test(t) && (!bestC || c > bestC.c)) bestC = { t, c };
          if (bestC && bestC.c >= 90) break;
        }
        if (!bestC) { ok = false; break; }
        txt += bestC.t; min = Math.min(min, bestC.c);
      }
      if (ok && (!bestPG || min > bestPG.score)) bestPG = { text: txt, score: min, rot };
    }
    best.perGlyph = bestPG;
  }
  return best;
}

export function ocrCandidate(cand) {
  if (!cache.has(cand.fp)) cache.set(cand.fp, ocrUncached(cand));
  return cache.get(cand.fp);
}

export function thumbnail(cand, rot = 0) {
  const cv = renderRun(cand, 36, rot, 6);
  return cv ? cv.toDataURL('image/png') : '';
}

export function cacheStats() { return cache.size; }
