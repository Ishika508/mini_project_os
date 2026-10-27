/* Shared UI helpers: DOM builder, playback controller, colour palette, small widgets. */
(function () {
  'use strict';

  /** Tiny hyperscript: h('div', {class:'x', onclick:fn}, child, child…) */
  function h(tag, props) {
    const el = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(x => append(el, x));
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const fmt = (v, d = 2) => (Number.isFinite(v) ? (Math.round(v * 10 ** d) / 10 ** d).toString() : '–');

  /** Distinct, theme-friendly colour for index i. */
  const pcolor = (i) => `hsl(${Math.round((i * 137.508 + 232) % 360)} 62% 50%)`;

  function toast(msg) {
    const t = h('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  /** Number input that calls onChange(value) with clamping. */
  function numInput(value, min, max, onChange, attrs) {
    const el = h('input', Object.assign({ type: 'number', value, min, max, step: 1 }, attrs || {}));
    el.addEventListener('change', () => {
      let v = parseFloat(el.value);
      if (!Number.isFinite(v)) v = min;
      v = Math.max(min, Math.min(max, v));
      el.value = v; onChange(v);
    });
    return el;
  }

  /** labelled range slider with live output */
  function slider(label, min, max, value, step, onInput, fmtFn) {
    const out = h('output', null, fmtFn ? fmtFn(value) : value);
    const inp = h('input', { type: 'range', min, max, step, value });
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmtFn ? fmtFn(v) : v; onInput(v); });
    const wrap = h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'rangeline' }, inp, out));
    wrap.set = (v) => { inp.value = v; out.textContent = fmtFn ? fmtFn(v) : v; };
    return wrap;
  }

  function select(label, options, value, onChange) {
    const sel = h('select', null, options.map(o => h('option', { value: o[0], selected: o[0] === value }, o[1])));
    sel.addEventListener('change', () => onChange(sel.value));
    const wrap = h('div', { class: 'field' }, h('label', null, label), sel);
    wrap.sel = sel;
    return wrap;
  }

  function toggle(label, checked, onChange) {
    const inp = h('input', { type: 'checkbox', checked });
    inp.addEventListener('change', () => onChange(inp.checked));
    const w = h('label', { class: 'switch' }, inp, h('i'), label);
    w.inp = inp;
    return w;
  }

  /* ------------------------- playback controller ------------------------- */
  const DELAYS = [1100, 800, 600, 450, 330, 240, 170, 110, 70, 35];
  /**
   * tick() performs one step and returns false when the run is finished.
   * Visibility is respected: nothing runs while the document is hidden.
   */
  function Player(tick, opt) {
    opt = opt || {};
    let speed = opt.speed || 5, timer = null;
    const me = {
      running: false, onState: null,
      get delay() { return DELAYS[speed - 1]; },
      setSpeed(v) { speed = v; if (me.running) { clearTimeout(timer); loop(); } },
      play() { if (me.running) return; me.running = true; me.onState && me.onState(true); loop(); },
      pause() { me.running = false; clearTimeout(timer); me.onState && me.onState(false); },
      toggle() { me.running ? me.pause() : me.play(); },
      step() { me.pause(); return tick(); },
    };
    function loop() {
      timer = setTimeout(() => {
        if (!me.running) return;
        const more = tick();
        if (more === false) me.pause(); else loop();
      }, me.delay);
    }
    return me;
  }

  /** Play / step / reset / speed bar bound to a Player. Returns element with .sync(). */
  function controlBar(player, onReset, extra) {
    const play = h('button', { class: 'btn primary', onclick: () => player.toggle() }, '▶ Play');
    const step = h('button', { class: 'btn', onclick: () => player.step() }, 'Step ⏭');
    const reset = h('button', { class: 'btn', onclick: () => { player.pause(); onReset(); } }, '↺ Reset');
    const sp = h('input', { type: 'range', min: 1, max: 10, step: 1, value: 5 });
    sp.addEventListener('input', () => player.setSpeed(+sp.value));
    const bar = h('div', { class: 'ctrlbar' }, play, step, reset, extra, h('div', { class: 'speed' }, 'Speed', sp));
    player.onState = (on) => { play.textContent = on ? '⏸ Pause' : '▶ Play'; };
    bar.setSpeed = (v) => { sp.value = v; player.setSpeed(v); };
    return bar;
  }

  /** Legend dot helper */
  const dot = (color) => h('span', { class: 'dot', style: { background: color, display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%' } });

  window.UI = { h, $, $$, clear, fmt, pcolor, toast, numInput, slider, select, toggle, Player, controlBar, dot, modules: {} };
})();
