// How-to guide: open/close, jump links, search.
(function () {
  const dlg = document.getElementById('help');
  const content = document.getElementById('help-content');
  const search = document.getElementById('help-search');
  const links = [...dlg.querySelectorAll('.help-toc a')];
  const sections = [...content.querySelectorAll('section')];

  document.getElementById('btn-help').addEventListener('click', () => { dlg.showModal(); content.scrollTop = 0; mark(); search.focus(); });
  document.getElementById('help-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // click outside the panel

  // jump links scroll inside the guide (not the page)
  links.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const t = content.querySelector(a.getAttribute('href'));
    if (t) { t.hidden = false; content.scrollTo({ top: t.offsetTop - content.offsetTop - 8, behavior: 'smooth' }); }
  }));

  // highlight the section being read
  const mark = () => {
    let cur = sections[0];
    for (const s of sections) if (!s.hidden && s.offsetTop - content.offsetTop <= content.scrollTop + 40) cur = s;
    links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + cur.id));
  };
  content.addEventListener('scroll', mark);
  dlg.addEventListener('close', () => { search.value = ''; filter(); });

  // search: show only sections that mention every word
  const filter = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const s of sections) {
      const hit = words.every(w => s.textContent.toLowerCase().includes(w));
      s.hidden = !hit; if (hit) shown++;
      const a = links.find(l => l.getAttribute('href') === '#' + s.id);
      if (a) a.classList.toggle('dim', !hit);
    }
    document.getElementById('help-empty').hidden = shown > 0;
    content.scrollTop = 0; mark();
  };
  search.addEventListener('input', filter);
  mark();
})();
