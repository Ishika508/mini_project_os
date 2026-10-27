/* App shell: tab routing, theme toggle, lazy module initialisation. */
(function () {
  'use strict';
  const { $, $$ } = UI;
  const inst = {};
  let current = 'home';

  function show(name) {
    if (!$('#tab-' + name)) name = 'home';
    if (inst[current] && inst[current].onHide) inst[current].onHide();
    current = name;
    $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    $$('.tabbtn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    if (UI.modules[name] && !inst[name]) inst[name] = UI.modules[name].init($('#tab-' + name)) || {};
    if (inst[name] && inst[name].onShow) inst[name].onShow();
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* file:// may refuse */ }
    window.scrollTo({ top: 0 });
  }

  $$('.tabbtn').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) show(g.dataset.go);
  });

  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('trafficos-theme', next); } catch (e) { /* ignore */ }
    window.dispatchEvent(new Event('trafficos-theme'));
  });

  const start = (location.hash || '').replace('#', '');
  show(UI.modules[start] || start === 'theory' ? start : 'home');
})();
