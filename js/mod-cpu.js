/* Module 1 — CPU Scheduling visualizer */
(function () {
  'use strict';
  const { h, clear, fmt, pcolor, numInput, select, Player, controlBar, toast } = UI;
  const C = OSCore;

  const TRAFFIC = [
    { name: 'Signal Control',       arrival: 0, burst: 5, priority: 2 },
    { name: 'Sensor Aggregation',   arrival: 1, burst: 3, priority: 3 },
    { name: 'Camera Analytics',     arrival: 2, burst: 6, priority: 4 },
    { name: 'Incident Detection',   arrival: 3, burst: 4, priority: 3 },
    { name: 'Emergency Preemption', arrival: 4, burst: 2, priority: 1 },
  ];
  const TEXTBOOK = [
    { name: 'P1', arrival: 0, burst: 8, priority: 3 }, { name: 'P2', arrival: 1, burst: 4, priority: 1 },
    { name: 'P3', arrival: 2, burst: 9, priority: 4 }, { name: 'P4', arrival: 3, burst: 5, priority: 2 },
  ];

  function init(root) {
    let procs = TRAFFIC.map(p => Object.assign({}, p));
    let algo = 'RR', quantum = 2;
    let res = null, k = 0;               // simulation result and animation cursor

    const ids = () => procs.map((_, i) => 'P' + (i + 1));
    const colorOf = (id) => pcolor(parseInt(id.slice(1), 10) - 1);

    /* ----------------------------- config card ----------------------------- */
    const tableBox = h('div', { class: 'tblwrap' });
    const quantumField = h('div', { class: 'field' }, h('label', null, 'Time quantum'), numInput(quantum, 1, 20, v => { quantum = v; invalidate(); }));
    const algoField = select('Algorithm', Object.entries(C.CPU_ALGOS).map(([k2, v]) => [k2, v.label]), algo, v => { algo = v; syncQuantum(); invalidate(); });
    function syncQuantum() { quantumField.style.display = algo === 'RR' ? '' : 'none'; }

    function renderTable() {
      clear(tableBox);
      const rows = procs.map((p, i) => h('tr', null,
        h('td', { class: 'c' }, h('b', { style: { color: colorOf('P' + (i + 1)) } }, 'P' + (i + 1))),
        h('td', { class: 'l' }, h('input', { type: 'text', value: p.name, style: { textAlign: 'left', minWidth: '90px', maxWidth: 'none' }, oninput: e => { p.name = e.target.value; refreshNames(); } })),
        h('td', null, numInput(p.arrival, 0, 60, v => { p.arrival = v; invalidate(); })),
        h('td', null, numInput(p.burst, 1, 30, v => { p.burst = v; invalidate(); })),
        h('td', null, numInput(p.priority, 0, 9, v => { p.priority = v; invalidate(); })),
        h('td', null, h('button', { class: 'btn sm danger', title: 'Remove', disabled: procs.length <= 1, onclick: () => { procs.splice(i, 1); renderTable(); invalidate(); } }, '✕'))));
      tableBox.append(h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'ID'), h('th', { class: 'l' }, 'Task'), h('th', null, 'Arrival'), h('th', null, 'Burst'), h('th', null, 'Priority'), h('th'))),
        h('tbody', null, rows)));
    }
    function refreshNames() { renderResultTable(); }

    const setPreset = (list) => { procs = list.map(p => Object.assign({}, p)); renderTable(); invalidate(); };
    const config = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, 'Configuration', h('span', { class: 'tag' }, 'editable')),
      algoField, quantumField, tableBox,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', onclick: () => { if (procs.length >= 10) return toast('Max 10 tasks'); procs.push({ name: 'Task ' + (procs.length + 1), arrival: 0, burst: 3, priority: 3 }); renderTable(); invalidate(); } }, '+ Add task'),
        h('button', { class: 'btn sm', onclick: () => setPreset(TRAFFIC) }, 'Traffic tasks'),
        h('button', { class: 'btn sm', onclick: () => setPreset(TEXTBOOK) }, 'Textbook set'),
        h('button', { class: 'btn sm', onclick: () => {
          const n = 4 + Math.floor(Math.random() * 3);
          setPreset(Array.from({ length: n }, (_, i) => ({ name: 'Task ' + (i + 1), arrival: Math.floor(Math.random() * 8), burst: 1 + Math.floor(Math.random() * 8), priority: 1 + Math.floor(Math.random() * 5) })));
        } }, '🎲 Random')),
      h('p', { class: 'small muted', style: { marginTop: '12px', marginBottom: 0 } }, 'Lower priority number = more urgent. Preemptive policies: SRTF, Priority (preemptive), Round Robin.'));

    /* ----------------------------- simulation card ----------------------------- */
    const clock = h('b', { class: 'mono' }, 't = 0');
    const runName = h('div', { class: 'big' }, '—');
    const runBar = h('i', { style: { width: '0%' } });
    const cpuCore = h('div', { class: 'cpu-core' }, h('div', { class: 'small muted', style: { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' } }, 'CPU'), runName, h('div', { class: 'bar' }, runBar), h('div', { class: 'small muted', style: { marginTop: '6px' } }, clock));
    const readyBox = h('div', { class: 'queue' });
    const arrivingBox = h('div', { class: 'queue' });
    const gantt = h('div', { class: 'gantt' });
    const axis = h('div', { class: 'axis' });
    const ganttWrap = h('div', { class: 'gantt-wrap' }, gantt, axis);
    const stateMsg = h('div', { class: 'small muted' }, 'Press Play or Step to start.');

    const player = Player(tick, { speed: 4 });
    const bar = controlBar(player, reset);
    const sim = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, 'Simulation', h('span', { class: 'tag', id: 'cpuAlgoTag' }, '')),
      bar,
      h('div', { style: { height: '14px' } }),
      h('div', { class: 'cpu-stage' }, cpuCore,
        h('div', null, h('div', { class: 'lbl' }, 'Ready queue'), readyBox, h('div', { class: 'lbl', style: { marginTop: '10px' } }, 'Not yet arrived'), arrivingBox)),
      h('div', { class: 'lbl', style: { marginBottom: '6px' } }, 'Gantt chart'), ganttWrap, stateMsg);

    /* ----------------------------- result card ----------------------------- */
    const resBox = h('div', { class: 'tblwrap' });
    const kpiBox = h('div', { class: 'kpis', style: { marginTop: '12px' } });
    const resultCard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, 'Results — waiting & turnaround time'), resBox, kpiBox);

    const cmpBox = h('div');
    const cmpCard = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, 'Compare all algorithms on this task set', h('span', { class: 'sp' }), h('button', { class: 'btn sm primary', onclick: compare }, 'Run comparison')),
      cmpBox);

    root.append(h('div', { class: 'grid split' }, config, h('div', { class: 'stack' }, sim, resultCard, cmpCard)));

    /* ------------------------------ logic ------------------------------ */
    function invalidate() { player.pause(); res = null; k = 0; resetView(); renderResultTable(); clear(cmpBox); }
    function reset() { k = 0; resetView(); renderResultTable(); }
    function resetView() {
      clear(gantt); clear(axis); clear(readyBox); clear(arrivingBox);
      runName.textContent = '—'; runName.style.color = ''; runBar.style.width = '0%'; clock.textContent = 't = 0';
      cpuCore.classList.remove('busy');
      document.getElementById('cpuAlgoTag').textContent = C.CPU_ALGOS[algo].label + (algo === 'RR' ? ' · q=' + quantum : '');
      stateMsg.textContent = 'Press Play or Step to start.';
      procs.forEach((p, i) => arrivingBox.append(h('span', { class: 'pchip', style: { background: colorOf('P' + (i + 1)), opacity: .55 } }, 'P' + (i + 1) + ' @' + p.arrival)));
    }
    function ensureRun() {
      if (!res) res = C.simulateCPU(procs.map((p, i) => ({ id: 'P' + (i + 1), name: p.name, arrival: p.arrival, burst: p.burst, priority: p.priority })), algo, quantum);
    }

    function tick() {
      ensureRun();
      if (k >= res.ticks.length) { k = 0; resetView(); }   // finished earlier → restart
      k++;
      draw(k);
      if (k >= res.ticks.length) { finish(); return false; }
      return true;
    }

    function draw(upto) {
      const tk = res.ticks[upto - 1];
      // gantt up to `upto`
      clear(gantt); clear(axis);
      const segs = [];
      for (let i = 0; i < upto; i++) {
        const t = res.ticks[i]; const last = segs[segs.length - 1];
        if (last && last.id === t.run) last.len++; else segs.push({ id: t.run, len: 1, start: i });
      }
      const U = 38;
      segs.forEach((s, i) => {
        const el = h('div', { class: 'gblock' + (s.id ? '' : ' idle'), style: { width: s.len * U + 'px', background: s.id ? colorOf(s.id) : '' }, title: (s.id || 'idle') + ' [' + s.start + '–' + (s.start + s.len) + ']' }, s.id || 'idle');
        if (i < segs.length - 1) el.style.animation = 'none';
        gantt.append(el);
      });
      for (let i = 0; i <= upto; i++) axis.append(h('span', { style: { width: (i === upto ? 20 : U) + 'px' } }, i));
      ganttWrap.scrollLeft = ganttWrap.scrollWidth;

      // cpu core
      const task = tk.run ? procs[parseInt(tk.run.slice(1), 10) - 1] : null;
      cpuCore.classList.toggle('busy', !!tk.run);
      runName.textContent = tk.run ? tk.run : 'idle';
      runName.style.color = tk.run ? colorOf(tk.run) : 'var(--faint)';
      if (tk.run) {
        const used = res.ticks.slice(0, upto).filter(x => x.run === tk.run).length;
        runBar.style.width = Math.min(100, used / task.burst * 100) + '%';
      } else runBar.style.width = '0%';
      clock.textContent = 't = ' + upto;
      // queues
      clear(readyBox);
      if (!tk.ready.length) readyBox.append(h('span', { class: 'small faint' }, 'empty'));
      tk.ready.forEach(id => readyBox.append(h('span', { class: 'pchip', style: { background: colorOf(id) } }, id)));
      clear(arrivingBox);
      procs.forEach((p, i) => { if (p.arrival >= upto) arrivingBox.append(h('span', { class: 'pchip', style: { background: colorOf('P' + (i + 1)), opacity: .5 } }, 'P' + (i + 1) + ' @' + p.arrival)); });
      if (!arrivingBox.firstChild) arrivingBox.append(h('span', { class: 'small faint' }, 'all arrived'));
      stateMsg.textContent = tk.run ? `t=${upto - 1}→${upto}: ${tk.run} (${task.name}) runs` : `t=${upto - 1}→${upto}: CPU idle`;
      renderResultTable(upto);
    }

    function finish() {
      stateMsg.textContent = 'Finished — total time ' + res.total + ' units.';
      renderResultTable(res.ticks.length, true);
    }

    function renderResultTable(upto, done) {
      clear(resBox); clear(kpiBox);
      ensureRun();
      const rows = res.rows.map((r, i) => {
        const fin = upto != null && r.ct <= upto;
        return h('tr', { class: fin ? 'done' : '' },
          h('td', { class: 'c' }, h('b', { style: { color: colorOf(r.id) } }, r.id)),
          h('td', { class: 'l' }, procs[i].name),
          h('td', null, r.arrival), h('td', null, r.burst), h('td', null, r.priority),
          h('td', null, fin ? r.ct : '·'), h('td', null, fin ? r.tat : '·'), h('td', null, fin ? r.wt : '·'), h('td', null, upto != null && upto > r.arrival + r.rt ? r.rt : '·'));
      });
      resBox.append(h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['ID', 'Task', 'AT', 'BT', 'Prio', 'CT', 'TAT', 'WT', 'RT'].map((t, i) => h('th', { class: i === 1 ? 'l' : '' }, t)))),
        h('tbody', null, rows),
        h('tfoot', null, h('tr', null, h('td', { colspan: 6, class: 'l' }, h('b', null, 'Average')), h('td', null, h('b', null, done ? fmt(res.avg.tat) : '·')), h('td', null, h('b', null, done ? fmt(res.avg.wt) : '·')), h('td', null, h('b', null, done ? fmt(res.avg.rt) : '·'))))));
      const kp = (v, l) => h('div', { class: 'kpi' }, h('b', null, v), h('span', null, l));
      kpiBox.append(kp(done ? fmt(res.avg.wt) : '–', 'Avg waiting'), kp(done ? fmt(res.avg.tat) : '–', 'Avg turnaround'), kp(done ? fmt(res.avg.rt) : '–', 'Avg response'),
        kp(done ? Math.round(res.util * 100) + '%' : '–', 'CPU utilization'), kp(done ? fmt(res.throughput, 3) : '–', 'Throughput /unit'), kp(done ? res.switches : '–', 'Context switches'));
    }

    function compare() {
      clear(cmpBox);
      const list = procs.map((p, i) => ({ id: 'P' + (i + 1), name: p.name, arrival: p.arrival, burst: p.burst, priority: p.priority }));
      const out = Object.keys(C.CPU_ALGOS).map(a => ({ a, r: C.simulateCPU(list, a, quantum) }));
      const minWT = Math.min(...out.map(o => o.r.avg.wt)), maxWT = Math.max(...out.map(o => o.r.avg.wt), 0.0001);
      out.forEach(o => cmpBox.append(h('div', { class: 'barrow' + (o.r.avg.wt === minWT ? ' best' : '') },
        h('span', null, C.CPU_ALGOS[o.a].label + (o.a === 'RR' ? ` (q=${quantum})` : '')),
        h('div', { class: 'track' }, h('i', { style: { width: '0%' }, 'data-w': (o.r.avg.wt / maxWT * 100) + '%' })),
        h('b', { class: 'mono' }, fmt(o.r.avg.wt)))));
      cmpBox.append(h('table', { class: 'tbl', style: { marginTop: '12px' } },
        h('thead', null, h('tr', null, ['Algorithm', 'Avg WT', 'Avg TAT', 'Avg RT', 'Switches'].map((t, i) => h('th', { class: i === 0 ? 'l' : '' }, t)))),
        h('tbody', null, out.map(o => h('tr', { class: o.r.avg.wt === minWT ? 'done' : '' }, h('td', { class: 'l' }, C.CPU_ALGOS[o.a].label), h('td', null, fmt(o.r.avg.wt)), h('td', null, fmt(o.r.avg.tat)), h('td', null, fmt(o.r.avg.rt)), h('td', null, o.r.switches))))));
      cmpBox.append(h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Green = lowest average waiting time. Bars animate relative to the worst algorithm.'));
      requestAnimationFrame(() => requestAnimationFrame(() => cmpBox.querySelectorAll('.track i').forEach(i => { i.style.width = i.dataset.w; })));
    }

    renderTable(); syncQuantum(); resetView(); renderResultTable();
    return { onHide() { player.pause(); } };
  }

  UI.modules.cpu = { init };
})();
