// Generate js/livetext-data.js from a LiveTextBuilder .jsx (finds the tables by name).
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
function grab(name, open, close) {
  const start = src.indexOf(`var ${name} = ${open}`);
  if (start < 0) throw new Error('missing ' + name);
  let depth = 0, i = src.indexOf(open, start);
  for (; i < src.length; i++) { if (src[i] === open) depth++; else if (src[i] === close && --depth === 0) break; }
  return `var ${name} = ` + src.slice(src.indexOf(open, start), i + 1) + ';';
}
const code = ['PRESETS', 'BASE_ALIAS', 'FULL_ALIAS'].map(n => grab(n, '{', '}')).concat(['SIZE_ORDER', 'LIBRARY'].map(n => grab(n, '[', ']'))).join('\n')
  + '\nmodule.exports={PRESETS,BASE_ALIAS,FULL_ALIAS,SIZE_ORDER,LIBRARY};';
const m = {}; new Function('module', code)(m);
const d = m.exports;
const out = `// Generated from ${require('path').basename(process.argv[2])} — do not edit by hand.\n` +
  Object.entries(d).map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`).join('\n') + '\n';
fs.writeFileSync(process.argv[3], out);
console.log(Object.keys(d.PRESETS).length, 'SKUs;', Object.values(d.PRESETS).reduce((a, s) => a + Object.keys(s).length, 0), 'sku/size presets; aliases', JSON.stringify(d.BASE_ALIAS));
