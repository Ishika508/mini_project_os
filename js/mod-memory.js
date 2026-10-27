/* Module 4 — Memory Management (fixed / variable partitioning, First / Best / Worst Fit) */
(function () {
  'use strict';
  const { h, clear, fmt, pcolor, numInput, Player, controlBar, toast } = UI;
  const C = OSCore;

  const DEFAULT_REQS = [
    { name: 'Sensor buffer', size: 212 }, { name: 'Camera frame cache', size: 417 },
    { name: 'Signal plan table', size: 112 }, { name: 'Incident model', size: 426 },
  ];

  function init(root) {
    let mode = 'variable', fit = 'first';
    let total = 1000, blocks = [100, 500, 200, 300, 600];
    let reqs = DEFAULT_REQS.map((r, i) => Object.assign({ id: i, status: 'pending' }, r));
    let nextId = reqs.length;
    let mem = null, flash = null;
    const logLines = [];

    const colorOf = (id) => pcolor(id + 3);
    const cfgObj = () => ({ total, blocks });
    function resetMem() { mem = C.makeMemory(mode, cfgObj()); reqs.forEach(r => { r.status = 'pending'; }); logLines.length = 0; flash = null; }
    resetMem();

    /* -------------------------- config card -------------------------- */
    const modeSeg = segCtl([['variable', 'Variable partitions'], ['fixed', 'Fixed partitions']], mode, v => { mode = v; resetMem(); renderConfig(); render(); });
    const fitSeg = segCtl([['first', 'First Fit'], ['best', 'Best Fit'], ['worst', 'Worst Fit']], fit, v => { fit = v; resetMem(); renderReqs(); render(); });
    const sizeBox = h('div'), reqBox = h('div', { class: 'tblwrap' });
    function segCtl(opts, val, on) {
      const el = h('div', { class: 'seg' });
      opts.forEach(([k, t]) => el.append(h('button', { class: k === val ? 'on' : '', onclick: () => { el.querySelectorAll('button').forEach(b => b.classList.remove('on')); el.querySelector(`[data-k="${k}"]`).classList.add('on'); on(k); }, 'data-k': k }, t)));
      return el;
    }
    function renderConfig() {
      clear(sizeBox);
      if (mode === 'variable') sizeBox.append(h('div', { class: 'field' }, h('label', null, 'Total memory (KB)'), numInput(total, 100, 4096, v => { total = v; resetMem(); renderReqs(); render(); })));
      else {
        sizeBox.append(h('div', { class: 'lbl', style: { marginBottom: '6px' } }, 'Partition sizes (KB)'),
          h('div', { class: 'row', style: { marginBottom: '12px' } },
            blocks.map((b, i) => h('div', { class: 'row', style: { gap: '2px', flexWrap: 'nowrap' } },
              numInput(b, 10, 2000, v => { blocks[i] = v; resetMem(); renderReqs(); render(); }, { style: 'width:78px' }),
              h('button', { class: 'btn sm danger', disabled: blocks.length <= 1, onclick: () => { blocks.splice(i, 1); resetMem(); renderConfig(); render(); } }, '✕'))),
            h('button', { class: 'btn sm', onclick: () => { if (blocks.length >= 10) return toast('Max 10 partitions'); blocks.push(200); resetMem(); renderConfig(); render(); } }, '+ block')));
      }
      renderReqs();
    }
    function renderReqs() {
      clear(reqBox);
      reqBox.append(h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'l' }, 'Request'), h('th', null, 'KB'), h('th', null, 'Status'), h('th'))),
        h('tbody', null, reqs.map((r, i) => h('tr', null,
          h('td', null, h('span', { class: 'dot', style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: colorOf(r.id) } })),
          h('td', { class: 'l' }, h('input', { type: 'text', value: r.name, style: { textAlign: 'left', minWidth: '120px' }, oninput: e => { r.name = e.target.value; } })),
          h('td', null, numInput(r.size, 1, 4000, v => { r.size = v; resetMem(); renderReqs(); render(); })),
          h('td', null, h('span', { class: 'chip ' + ({ pending: '', allocated: 'good', failed: 'bad', freed: 'warn' }[r.status]) }, r.status)),
          h('td', null, h('button', { class: 'btn sm danger', onclick: () => { mem.free(r.name); reqs.splice(i, 1); resetMem(); renderReqs(); render(); } }, '✕')))))));
    }

    const config = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, 'Configuration', h('span', { class: 'tag' }, 'editable')),
      h('div', { class: 'lbl', style: { marginBottom: '6px' } }, 'Partitioning scheme'), modeSeg,
      h('div', { class: 'lbl', style: { margin: '14px 0 6px' } }, 'Placement strategy'), fitSeg,
      h('div', { style: { height: '14px' } }), sizeBox, reqBox,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', onclick: () => { reqs.push({ id: nextId++, name: 'Task ' + nextId, size: 150, status: 'pending' }); renderReqs(); } }, '+ Add request'),
        h('button', { class: 'btn sm', onclick: () => { reqs = DEFAULT_REQS.map((r, i) => Object.assign({ id: i, status: 'pending' }, r)); nextId = reqs.length; resetMem(); renderReqs(); render(); } }, 'Traffic defaults')),
      h('p', { class: 'small muted', style: { marginTop: '12px', marginBottom: 0 } }, 'Click an allocated block in the memory map to free it. Defaults reproduce the classic 212 / 417 / 112 / 426 KB example.'));

    /* -------------------------- simulation card -------------------------- */
    const mapBox = h('div'), statsBox = h('div', { class: 'kpis' }), noteBox = h('div'), cmpBox = h('div');
    const player = Player(tick, { speed: 4 });
    const bar = controlBar(player, () => { resetMem(); renderReqs(); render(); },
      h('button', { class: 'btn', onclick: () => { if (mode === 'variable') { mem.compact(); logLines.unshift('Compaction: all holes merged'); flash = 'compact'; render(); } else toast('Compaction applies to variable partitions'); } }, '🗜 Compact'));
    const retry = h('button', { class: 'btn', onclick: () => { reqs.forEach(r => { if (r.status === 'failed') r.status = 'pending'; }); renderReqs(); render(); } }, '↻ Retry failed');
    bar.insertBefore(retry, bar.querySelector('.speed'));

    const sim = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, 'Memory map', h('span', { class: 'tag', id: 'memTag' }, '')),
      bar, h('div', { style: { height: '14px' } }), mapBox,
      h('div', { class: 'legend' }, h('span', null, h('i', { class: 'hatch', style: { background: 'repeating-linear-gradient(135deg,var(--surface-3),var(--surface-3) 4px,var(--surface-2) 4px,var(--surface-2) 8px)' } }), 'free hole'), h('span', null, h('i', { class: 'hatch' }), 'internal fragmentation (wasted inside a partition)'), h('span', null, '👆 click an allocated block to free it')),
      h('div', { style: { height: '14px' } }), statsBox, h('div', { style: { height: '10px' } }), noteBox);
    const cmpCard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, 'First vs Best vs Worst Fit — same requests, fresh memory', h('span', { class: 'sp' }), h('button', { class: 'btn sm primary', onclick: compare }, 'Run comparison')), cmpBox);
    const logCard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, 'Allocation log'), h('div', { class: 'log', id: 'memLog' }));

    root.append(h('div', { class: 'grid split' }, config, h('div', { class: 'stack' }, sim, cmpCard, logCard)));

    /* -------------------------- logic -------------------------- */
    function tick() {
      const r = reqs.find(x => x.status === 'pending');
      if (!r) return false;
      const seg = mem.alloc(r.name, r.size, fit);
      if (seg) {
        r.status = 'allocated'; flash = r.name;
        const extra = mode === 'fixed' ? ` (partition ${seg.size} KB, wasting ${seg.size - r.size})` : '';
        logLines.unshift(`✓ ${r.name} (${r.size} KB) → address ${seg.start}${extra}`);
      } else {
        r.status = 'failed'; flash = null;
        const s = mem.stats();
        let why = `no ${fit}-fit ${mode === 'fixed' ? 'partition' : 'hole'} ≥ ${r.size} KB`;
        if (mode === 'variable' && s.free >= r.size) why += ` — ${s.free} KB free in ${s.holes} hole(s) but largest is ${s.largest} KB (external fragmentation)`;
        logLines.unshift(`✗ ${r.name} (${r.size} KB) cannot be placed: ${why}`);
      }
      renderReqs(); render();
      return reqs.some(x => x.status === 'pending');
    }

    function freeOwner(name) {
      const r = reqs.find(x => x.name === name);
      if (mem.free(name)) { if (r) r.status = 'freed'; logLines.unshift(`↩ ${name} freed`); flash = null; renderReqs(); render(); }
    }

    function render() {
      document.getElementById('memTag').textContent = (fit === 'first' ? 'First' : fit === 'best' ? 'Best' : 'Worst') + ' Fit · ' + (mode === 'fixed' ? 'fixed' : 'variable');
      clear(mapBox);
      const idOf = (name) => { const r = reqs.find(x => x.name === name); return r ? r.id : 0; };
      const bar2 = h('div', { class: 'membar' });
      mem.segs.forEach(s => {
        const occ = s.owner !== null;
        const el = h('div', { class: 'mseg ' + (occ ? 'occ' : 'hole'), title: occ ? `${s.owner}: ${mode === 'fixed' ? s.used + ' KB in a ' + s.size + ' KB partition' : s.size + ' KB'} @ ${s.start} — click to free` : `free ${s.size} KB @ ${s.start}`, style: { flex: s.size + ' 1 0', background: occ ? colorOf(idOf(s.owner)) : '' }, onclick: occ ? () => freeOwner(s.owner) : null },
          h('div', { class: 'lbl2' }, occ ? s.owner : 'free', h('br'), h('small', null, occ && mode === 'fixed' ? `${s.used}/${s.size} KB` : s.size + ' KB')));
        if (occ && mode === 'fixed' && s.size > s.used) el.append(h('div', { class: 'internal', style: { width: ((s.size - s.used) / s.size * 100) + '%' } }));
        if (occ && s.owner === flash) el.style.animation = 'dropin .6s cubic-bezier(.2,1.4,.4,1)';
        bar2.append(el);
      });
      mapBox.append(bar2);
      const ruler = h('div', { class: 'ruler' });
      mem.segs.forEach(s => ruler.append(h('span', { style: { flex: s.size + ' 1 0', overflow: 'hidden' } }, s.start)));
      ruler.append(h('span', { style: { flex: '0 0 auto', paddingLeft: '4px' } }, mem.total));
      mapBox.append(ruler);

      const s = mem.stats();
      clear(statsBox);
      const kp = (v, l) => h('div', { class: 'kpi' }, h('b', null, v), h('span', null, l));
      statsBox.append(kp(s.total + ' KB', 'Total'), kp(s.used + ' KB', 'Allocated'), kp(s.free + ' KB', mode === 'fixed' ? 'Free partitions' : 'Free'), kp(s.largest + ' KB', 'Largest hole'),
        mode === 'fixed' ? kp(s.internal + ' KB', 'Internal fragmentation') : kp(s.external + ' KB', 'External fragmentation'),
        kp(Math.round(s.util * 100) + '%', 'Utilization'));
      clear(noteBox);
      const failed = reqs.filter(r => r.status === 'failed');
      if (failed.length) {
        const f = failed[0];
        if (mode === 'variable' && s.free >= f.size) noteBox.append(h('div', { class: 'banner bad' }, `External fragmentation: ${f.name} needs ${f.size} KB, ${s.free} KB is free but split into ${s.holes} holes (largest ${s.largest} KB). Try Compact.`));
        else noteBox.append(h('div', { class: 'banner bad' }, `Out of memory for: ${failed.map(x => x.name).join(', ')}.` + (mode === 'fixed' ? ' Try Best Fit or different partition sizes.' : '')));
      } else if (reqs.every(r => r.status === 'allocated') && reqs.length) noteBox.append(h('div', { class: 'banner good' }, 'All requests allocated.'));
      else noteBox.append(h('div', { class: 'banner info' }, 'Press Play / Step to allocate requests in order.'));
      const lg = document.getElementById('memLog'); clear(lg);
      if (!logLines.length) lg.append(h('div', null, 'No allocations yet.'));
      logLines.slice(0, 30).forEach(l => lg.append(h('div', { class: l[0] === '✗' ? 'buffer' : 'admit' }, l)));
    }

    function compare() {
      clear(cmpBox);
      const list = reqs.map(r => ({ name: r.name, size: r.size }));
      const out = C.compareFits(mode, cfgObj(), list);
      const score = (o) => o.placed.length * 1e6 - (mode === 'fixed' ? o.stats.internal : o.stats.external);
      const best = Math.max(...out.map(score));
      cmpBox.append(h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Strategy', 'Placed', 'Not placed', 'Free KB', 'Largest hole', mode === 'fixed' ? 'Internal frag' : 'External frag', 'Utilization'].map((t, i) => h('th', { class: i < 1 ? 'l' : '' }, t)))),
        h('tbody', null, out.map(o => h('tr', { class: score(o) === best ? 'done' : '' },
          h('td', { class: 'l' }, h('b', null, { first: 'First Fit', best: 'Best Fit', worst: 'Worst Fit' }[o.fit])),
          h('td', null, o.placed.length + '/' + list.length), h('td', null, o.failed.join(', ') || '—'), h('td', null, o.stats.free), h('td', null, o.stats.largest),
          h('td', null, mode === 'fixed' ? o.stats.internal : o.stats.external), h('td', null, Math.round(o.stats.util * 100) + '%')))))));
      cmpBox.append(h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Green row = most requests placed, then least fragmentation. Results depend on request order and hole layout — change the inputs and compare again.'));
    }

    renderConfig(); render();
    return { onHide() { player.pause(); } };
  }

  UI.modules.memory = { init };
})();
