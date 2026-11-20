// Assemble tools/LiveTextBatch.jsx from template.jsx + code copied verbatim from LiveTextBuilder_v13.jsx.
// Usage (from the repo root):  node source/build-batch.cjs source/LiveTextBuilder_v13.jsx source/template.jsx tools/LiveTextBatch.jsx
// The line ranges below are the v12 line numbers; v13 has 39 extra preset lines above all of them.
// If you add or remove lines ABOVE line 391 of v13, update V13_SHIFT (and check the output).
const fs = require('fs');
const V13_SHIFT = 39;
const v13 = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const r = (a, b, indent = '') => v13.slice(a - 1 + V13_SHIFT, b + V13_SHIFT).map(l => l ? indent + l : l).join('\n');
const parts = {
  HELPERS: r(395, 398),
  LIBRARY: r(352, 386),
  COLORS: r(452, 486, '    '),
  BUILD: r(1185, 1282, '    '),
  CMYK: r(1286, 1300, '    '),
  PLACE: r(1309, 1329, '    '),
  BACK: r(1333, 1383, '    '),
  FRONT: r(1387, 1409, '    '),
};
let t = fs.readFileSync(process.argv[3], 'utf8');
for (const [k, v] of Object.entries(parts)) {
  if (!t.includes(`//@@${k}@@`)) { if (k === 'CMYK') continue; throw new Error('missing slot ' + k); }
  t = t.replace(`//@@${k}@@`, () => v);
}
fs.writeFileSync(process.argv[4], t);
console.log('wrote', process.argv[4], t.split('\n').length, 'lines');
