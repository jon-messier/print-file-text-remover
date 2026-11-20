// Role-based detection: decide which lettering is the player name, the back number
// and the front number, whatever it actually says, then make every size of a design
// agree (the vendor's personalization layer is identical across sizes).

const W = b => b[2] - b[0], Hh = b => b[3] - b[1];
const cx = b => (b[0] + b[2]) / 2;

// Same lettering, any size: glyph count + each glyph's outline structure, in draw order.
export function signature(c) {
  return c.n + '|' + [...c.glyphs].sort((a, b) => a.idx - b.idx).map(s => s.nsub + '.' + s.npts).join(',');
}

const isDigits = t => /^\d{1,2}$/.test(t);
const PLACEHOLDER_NAMES = ['NAME', 'PLAYER', 'PLAYERNAME'];

// x: { c: candidate, ocr: {text, score, rot}, norm }
export function assignRoles(cands) {
  for (const x of cands) { x.role = null; x.strength = 0; x.why = ''; x.numEv = 0; x.numText = ''; x.sig = signature(x.c); }
  const live = cands.filter(x => !x.label);

  // ---- numbers: 1–2 glyphs (or one connected script shape), at least an inch tall.
  // Evidence: whole-word read, digits-only read, digit-by-digit read, and structure:
  // the same lettering appearing twice at two sizes (front + back number pair).
  const sigs = new Map();
  for (const x of live) { if (!sigs.has(x.sig)) sigs.set(x.sig, []); sigs.get(x.sig).push(x); }
  const numberish = x => x.c.n <= 2 && x.c.heightIn >= 1.0 && !x.label;
  const hasWordNext = x => live.some(y => {
    if (y === x || !(y.c.n >= 2 || y.c.wordShape) || y.c.n > 20) return false;
    const L = y.c.glyphBox, B = x.c.glyphBox, r = Hh(L) / Hh(B);
    if (r < 0.1 || r > 0.75 || Math.abs(cx(L) - cx(B)) > 0.35 * Math.max(W(L), W(B))) return false;
    const gap = Math.max(L[1] - B[3], B[1] - L[3]);
    return gap > -0.1 * Hh(B) && gap < 1.2 * Hh(B);
  });
  // a front/back number pair: identical lettering at two real number sizes (big one >= 3 in, small >= 1.5 in)
  const pairOf = x => (sigs.get(x.sig) || []).some(y => {
    if (y === x || Math.abs(y.c.heightIn - x.c.heightIn) <= 0.2 * x.c.heightIn) return false;
    const big = Math.max(x.c.heightIn, y.c.heightIn), small = Math.min(x.c.heightIn, y.c.heightIn);
    return big >= 3 && small >= 1.5;
  });
  for (const x of live) {
    if (!numberish(x)) continue;
    const reads = [];
    if (isDigits(x.norm)) reads.push({ text: x.norm, score: x.ocr.score });
    if (x.ocr.digits && isDigits(x.ocr.digits.text)) reads.push(x.ocr.digits);
    if (x.ocr.perGlyph && isDigits(x.ocr.perGlyph.text)) reads.push(x.ocr.perGlyph);
    const best = reads.sort((a, b) => b.score - a.score)[0];
    const letters = /[A-Z]{2,}/.test(x.norm) && x.ocr.score >= 85 && !x.ocr.digitsOnly; // confidently reads as a word
    const pair = pairOf(x);
    let ev = 0, text = best ? best.text : '';
    if (best && best.score >= 80) ev = best.score >= 90 ? 2 : 1;
    else if (best && best.score >= 40 && pair) ev = 2;
    else if (best && best.score >= 55 && x.c.heightIn >= 2.5) ev = 1;
    else if (!letters && pair && x.c.heightIn >= 2.5 && x.c.n <= 2) ev = 1;
    // a confident word reading vetoes the number, unless it's a front/back pair that also reads as digits
    if (letters && !(best && best.score >= 90) && !(pair && best && best.score >= 50)) ev = 0;
    // Number layout: a front/back pair with a word centred right above/below the big one.
    // Trust the layout over OCR, but ask for a check when OCR saw letters.
    if (!ev && pair && x.c.heightIn >= 3 && hasWordNext(x) && (best ? best.score >= 25 : !letters)) { ev = letters ? 1 : 2; x.layoutOnly = true; }
    if (ev) { x.numEv = ev; x.numText = text; if (text) x.norm = text; }
  }
  // the smaller member of a pair follows the big one
  for (const x of live) if (!x.numEv && numberish(x)) {
    const big = (sigs.get(x.sig) || []).find(y => y !== x && y.numEv && y.c.heightIn > x.c.heightIn && x.c.heightIn >= 1.5);
    if (big) { x.numEv = big.numEv; x.numText = big.numText; x.layoutOnly = big.layoutOnly; if (big.numText) x.norm = big.numText; }
  }
  const nums = live.filter(x => x.numEv);
  nums.sort((a, b) => b.c.heightIn - a.c.heightIn);
  // Back number: big (>= 3 in). Strongest evidence wins, then size, so a tall stray shape
  // that only vaguely reads as "1" (a claw-mark stripe) can't beat a clear 12.
  const back = nums.filter(x => x.c.heightIn >= 3)
    .sort((a, b) => (b.numEv - a.numEv) || (b.c.heightIn - a.c.heightIn))[0] || null;
  const numWhy = x => x.layoutOnly ? `number layout (front/back pair next to a name)${x.numText ? `; best reading "${x.numText}"` : ''}`
    : x.numText ? `reads "${x.numText}"` + (pairOf(x) ? ', front/back pair' : '') : 'number-shaped pair on front and back';
  if (back) { back.role = 'back'; back.strength = back.numEv; back.why = numWhy(back); }
  // Front number: the same number as the back (same lettering, or the same reading).
  // A different number nearby is something else (e.g. the S of a logo read as "5").
  const fronts = nums.filter(x => x !== back && x.c.heightIn >= 1.5 && x.c.heightIn < (back ? back.c.heightIn * 0.95 : Infinity));
  let front = null;
  if (back) {
    front = fronts.find(x => x.sig === back.sig)
      || fronts.find(x => x.numText && back.numText && x.numText === back.numText && x.numEv >= 2) || null;
  } else {
    front = fronts.filter(x => x.numEv >= 2 && !x.layoutOnly).sort((a, b) => b.c.heightIn - a.c.heightIn)[0] || null;
  }
  if (front) { front.role = 'front'; front.strength = front.numEv; front.why = numWhy(front); }

  // ---- team text: the same lettering appears more than once in the file
  const sigCount = new Map(), textCount = new Map();
  for (const x of live) {
    sigCount.set(x.sig, (sigCount.get(x.sig) || 0) + 1);
    if (x.norm.length >= 3 && x.ocr.score >= 85) textCount.set(x.norm, (textCount.get(x.norm) || 0) + 1);
  }
  const repeated = x => sigCount.get(x.sig) > 1 || (x.norm.length >= 3 && textCount.get(x.norm) > 1);

  // ---- player name
  const wordLike = x => !x.role && !x.numEv && (x.c.n >= 2 || x.c.wordShape) && x.c.heightIn >= 0.6 && x.c.heightIn <= 5 && !isDigits(x.norm);
  const exact = live.filter(x => wordLike(x) && PLACEHOLDER_NAMES.includes(x.norm) && x.ocr.score >= 80);
  let name = null;
  if (exact.length) {
    name = exact.sort((a, b) => b.c.heightIn - a.c.heightIn)[0];
    name.why = `reads "${name.norm}"`; name.strength = 2;
  } else if (back) {
    const B = back.c.glyphBox, hB = Hh(B);
    const near = live.filter(x => {
      if (!wordLike(x) || repeated(x)) return false;
      const L = x.c.glyphBox;
      const ratio = Hh(L) / hB;
      if (ratio < 0.1 || ratio > 0.75) return false;
      if (Math.abs(cx(L) - cx(B)) > 0.35 * Math.max(W(L), W(B))) return false;
      const gap = Math.max(L[1] - B[3], B[1] - L[3]);         // vertical gap (negative = overlap)
      return gap > -0.1 * hB && gap < 1.2 * hB;
    });
    near.sort((a, b) => {
      const ga = Math.max(a.c.glyphBox[1] - B[3], B[1] - a.c.glyphBox[3]);
      const gb = Math.max(b.c.glyphBox[1] - B[3], B[1] - b.c.glyphBox[3]);
      return ga - gb;
    });
    if (near.length) {
      name = near[0];
      const readsAsWord = /^[A-Z]{2,}$/.test(name.norm) && name.ocr.score >= 70;
      name.strength = readsAsWord || name.c.wordShape ? 2 : 1;
      name.why = readsAsWord ? `word next to the back number ("${name.norm}")` : 'word shape next to the back number';
      if (near.length > 1) { name.strength = 1; name.why += '; another word is also close'; }
    }
  }
  if (name) name.role = 'name';
  return cands;
}

// Make every size of a design agree. files: [{ cands: [...] }]
export function propagate(files) {
  const notes = new Map(); // file -> [messages]
  const say = (f, m) => { if (!notes.has(f)) notes.set(f, []); notes.get(f).push(m); };
  for (const role of ['name', 'back', 'front']) {
    const votes = new Map();
    for (const f of files) for (const x of f.cands) if (x.role === role) votes.set(x.sig, (votes.get(x.sig) || 0) + x.strength);
    if (!votes.size) continue;
    const [bestSig, bestVotes] = [...votes].sort((a, b) => b[1] - a[1])[0];
    for (const f of files) {
      const mine = f.cands.filter(x => x.role === role);
      if (mine.some(x => x.sig === bestSig)) {
        for (const x of mine) if (x.sig === bestSig && files.length > 1) x.strength = Math.max(x.strength, 2);
        continue;
      }
      const match = f.cands.find(x => x.sig === bestSig && (!x.role || x.role === role));
      const strongMine = mine.some(x => x.strength >= 2 && role !== 'front');
      if (match && !strongMine) {
        if (role !== 'front') for (const x of mine) x.role = null;
        match.role = role; match.strength = 2; match.why = 'same lettering as the other sizes'; match.propagated = true;
      } else if (match && strongMine) {
        say(f, `The ${ROLE_LABEL[role].toLowerCase()} here doesn't match the other sizes. Check it.`);
      } else if (mine.length) {
        say(f, `The ${ROLE_LABEL[role].toLowerCase()} here doesn't match the other sizes. Check it.`);
      } else if (bestVotes >= 2) {
        say(f, `No ${ROLE_LABEL[role].toLowerCase()} found here, but other sizes of this design have one.`);
      }
    }
  }
  return notes;
}

export const ROLE_LABEL = { name: 'Player name', back: 'Back number', front: 'Front number' };
