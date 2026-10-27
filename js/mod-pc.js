/* Module 2 — Producer–Consumer synchronization (bounded buffer + semaphores) */
(function () {
  'use strict';
  const { h, clear, pcolor, numInput, slider, toggle, Player, controlBar } = UI;
  const C = OSCore;

  const PNAMES = ['Loop sensor N', 'Loop sensor S', 'Loop sensor E', 'Loop sensor W', 'Camera 1', 'Camera 2'];
  const CNAMES = ['Analytics A', 'Analytics B', 'Analytics C', 'Analytics D', 'Analytics E', 'Analytics F'];

  const CODE = {
    P: ['do {', '  item = produce();', '  wait(empty);', '  wait(mutex);', '  buffer[in] = item;  in = (in+1)%N;', '  signal(mutex);', '  signal(full);', '} while (true);'],
    Pu: ['do {', '  item = produce();', '  wait(mutex);        // ✗ lock first', '  wait(empty);        // may sleep holding mutex', '  buffer[in] = item;  in = (in+1)%N;', '  signal(mutex);', '  signal(full);', '} while (true);'],
    C: ['do {', '  wait(full);', '  wait(mutex);', '  item = buffer[out];  out = (out+1)%N;', '  signal(mutex);', '  signal(empty);', '  consume(item);', '} while (true);'],
    Cu: ['do {', '  wait(mutex);        // ✗ lock first', '  wait(full);         // may sleep holding mutex', '  item = buffer[out];  out = (out+1)%N;', '  signal(mutex);', '  signal(empty);', '  consume(item);', '} while (true);'],
  };
  // op index → code-line index
  const LINE = {
    P:  { 'produce': 1, 'wait(empty)': 2, 'wait(mutex)': 3, 'insert': 4, 'signal(mutex)': 5, 'signal(full)': 6 },
    Pu: { 'produce': 1, 'wait(mutex)': 2, 'wait(empty)': 3, 'insert': 4, 'signal(mutex)': 5, 'signal(full)': 6 },
    C:  { 'wait(full)': 1, 'wait(mutex)': 2, 'remove': 3, 'signal(mutex)': 4, 'signal(empty)': 5, 'consume': 6 },
    Cu: { 'wait(mutex)': 1, 'wait(full)': 2, 'remove': 3, 'signal(mutex)': 4, 'signal(empty)': 5, 'consume': 6 },
  };

  function init(root) {
    const cfg = { bufferSize: 6, producers: 3, consumers: 2, prodSpeed: 6, consSpeed: 5, seed: 7, unsafe: false };
    let sim = new C.PCSim(cfg);
    let last = { P: null, C: null }, lastEvt = null, newSlot = -1, takenSlot = -1, prevSem = { empty: 0, full: 0, mutex: 1 };
    const logLines = [];

    /* ---------------- config ---------------- */
    const rebuild = () => { player.pause(); sim = new C.PCSim(cfg); last = { P: null, C: null }; lastEvt = null; logLines.length = 0; newSlot = takenSlot = -1; render(); };
    const field = (label, el) => h('div', { class: 'field' }, h('label', null, label), el);
    const unsafeSw = toggle('Wrong lock order (deadlock demo)', false, v => { cfg.unsafe = v; rebuild(); });
    const config = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, 'Configuration', h('span', { class: 'tag' }, 'editable')),
      field('Buffer size N (slots)', numInput(cfg.bufferSize, 1, 12, v => { cfg.bufferSize = v; rebuild(); })),
      h('div', { class: 'grid g2', style: { gap: '10px' } },
        field('Producers (sensors)', numInput(cfg.producers, 1, 6, v => { cfg.producers = v; rebuild(); })),
        field('Consumers (workers)', numInput(cfg.consumers, 1, 6, v => { cfg.consumers = v; rebuild(); }))),
      slider('Producer speed', 1, 10, cfg.prodSpeed, 1, v => { cfg.prodSpeed = v; sim.o.prodSpeed = v; }),
      slider('Consumer speed', 1, 10, cfg.consSpeed, 1, v => { cfg.consSpeed = v; sim.o.consSpeed = v; }),
      field('Random seed', numInput(cfg.seed, 1, 9999, v => { cfg.seed = v; rebuild(); })),
      unsafeSw,
      h('p', { class: 'small muted', style: { marginTop: '12px', marginBottom: 0 } },
        'Each Step executes ONE instruction of ONE randomly chosen runnable thread — exactly how a real scheduler interleaves them. Speed sliders bias which side gets the CPU: make producers faster to fill the buffer, consumers faster to drain it.'),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn sm', onclick: () => { cfg.prodSpeed = 9; cfg.consSpeed = 2; syncSliders(); } }, 'Fast producers'),
        h('button', { class: 'btn sm', onclick: () => { cfg.prodSpeed = 2; cfg.consSpeed = 9; syncSliders(); } }, 'Fast consumers'),
        h('button', { class: 'btn sm', onclick: () => { cfg.prodSpeed = 5; cfg.consSpeed = 5; syncSliders(); } }, 'Balanced')));
    const sl = config.querySelectorAll('input[type=range]');
    function syncSliders() { sl[0].value = cfg.prodSpeed; sl[1].value = cfg.consSpeed; sl[0].dispatchEvent(new Event('input')); sl[1].dispatchEvent(new Event('input')); }

    /* ---------------- view ---------------- */
    const prodBox = h('div'), consBox = h('div'), slotsBox = h('div', { class: 'slots' }), semBox = h('div', { class: 'sems' });
    const bannerBox = h('div'), statsBox = h('div', { class: 'kpis' }), logBox = h('div', { class: 'log' });
    const codeP = h('pre', { class: 'code' }), codeC = h('pre', { class: 'code' });

    const player = Player(tick, { speed: 5 });
    const bar = controlBar(player, rebuild, h('button', { class: 'btn', onclick: () => { player.pause(); for (let i = 0; i < 25; i++) tick(); } }, '⏩ +25'));

    const stage = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, 'Bounded buffer — Smart Traffic data pipeline', h('span', { class: 'tag' }, 'live')),
      bar, h('div', { style: { height: '12px' } }), bannerBox,
      h('div', { class: 'pc-stage' },
        h('div', null, h('div', { class: 'lbl', style: { marginBottom: '8px' } }, 'Producers · sensors'), prodBox),
        h('div', null, h('div', { class: 'lbl' }, 'Shared buffer (circular, N slots)'), slotsBox, h('div', { class: 'lbl', style: { margin: '6px 0' } }, 'Semaphores'), semBox),
        h('div', null, h('div', { class: 'lbl', style: { marginBottom: '8px' } }, 'Consumers · analytics'), consBox)));
    const bottom = h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, 'Code being executed'), h('div', { class: 'grid g2', style: { gap: '10px' } }, h('div', null, h('div', { class: 'lbl' }, 'Producer'), codeP), h('div', null, h('div', { class: 'lbl' }, 'Consumer'), codeC))),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, 'Statistics & event log'), statsBox, h('div', { style: { height: '10px' } }), logBox));
    root.append(h('div', { class: 'grid split' }, config, h('div', { class: 'stack' }, stage, bottom)));

    function tick() {
      const r = sim.step();
      if (r.deadlock) { render(); return false; }
      lastEvt = r;
      const a = sim.actors.find(x => x.id === r.actor);
      last[a.type] = { op: r.op, who: r.actor };
      newSlot = r.op === 'insert' ? (sim.in + sim.slots.length - 1) % sim.slots.length : -1;
      takenSlot = r.op === 'remove' ? (sim.out + sim.slots.length - 1) % sim.slots.length : -1;
      if (r.op === 'insert' || r.op === 'remove' || r.op === 'consume' || r.op.startsWith('wait') || r.op.startsWith('signal') || r.op === 'produce') {
        logLines.unshift({ n: sim.stats.steps, who: r.actor, op: r.op, note: r.note, blocked: a.blocked });
        if (logLines.length > 60) logLines.pop();
      }
      render();
      return !sim.deadlock;
    }

    function render() {
      const u = cfg.unsafe;
      // threads
      clear(prodBox); clear(consBox);
      sim.actors.forEach((a, i) => {
        const isP = a.type === 'P', idx = parseInt(a.id.slice(1), 10) - 1;
        const op = sim.ops(a)[a.pc];
        const el = h('div', { class: 'thread' + (lastEvt && lastEvt.actor === a.id ? ' act' : '') + (a.blocked ? ' blk' : '') },
          h('div', { class: 'nm' }, h('span', { class: 'pchip', style: { background: isP ? pcolor(idx) : 'var(--accent)' } }, a.id), isP ? PNAMES[idx] : CNAMES[idx]),
          h('div', { class: 'op' }, a.blocked ? '⛔ blocked on ' + a.blocked + ' (sleeping)' : 'next: ' + op + (a.item ? '  · holds ' + a.item : '')));
        (isP ? prodBox : consBox).append(el);
      });
      // slots
      clear(slotsBox);
      sim.slots.forEach((s, i) => {
        const el = h('div', { class: 'slot' + (s ? ' full' : '') + (i === newSlot ? ' new' : '') + (i === takenSlot ? ' taken' : ''), style: s ? { background: pcolor(parseInt(s.by.slice(1), 10) - 1) } : {} },
          h('span', { class: 'idx' }, i), s ? s.id : '');
        if (i === sim.in) el.append(h('span', { class: 'ptr in' }, '▲ in'));
        if (i === sim.out) el.append(h('span', { class: 'ptr out', style: i === sim.in ? { left: '70%' } : {} }, '▲ out'));
        slotsBox.append(el);
      });
      // semaphores
      clear(semBox);
      for (const nm of ['empty', 'full', 'mutex']) {
        const s = sim.sem[nm];
        semBox.append(h('div', { class: 'sem' + (prevSem[nm] !== s.v ? ' chg' : '') }, h('span', null, nm), h('b', null, s.v),
          h('small', null, s.q.length ? 'waiting: ' + s.q.map(x => x.id).join(', ') : (nm === 'mutex' && sim.holder ? 'held by ' + sim.holder : ''))));
        prevSem[nm] = s.v;
      }
      // banner
      clear(bannerBox);
      if (sim.deadlock) bannerBox.append(h('div', { class: 'banner bad', style: { marginBottom: '12px' } }, '☠ DEADLOCK — every thread is blocked. ' + (cfg.unsafe ? 'Mutex was taken before empty/full, so the sleeper holds the lock the others need.' : '')));
      else if (cfg.unsafe) bannerBox.append(h('div', { class: 'banner info', style: { marginBottom: '12px' } }, 'Wrong lock order is ON — run until it deadlocks.'));
      else if (sim.count === sim.slots.length) bannerBox.append(h('div', { class: 'banner info', style: { marginBottom: '12px' } }, 'Buffer FULL — producers block on wait(empty).'));
      else if (sim.count === 0 && sim.stats.steps > 0) bannerBox.append(h('div', { class: 'banner info', style: { marginBottom: '12px' } }, 'Buffer EMPTY — consumers block on wait(full).'));
      // code
      for (const [box, key, ty] of [[codeP, u ? 'Pu' : 'P', 'P'], [codeC, u ? 'Cu' : 'C', 'C']]) {
        clear(box);
        const hl = last[ty] ? LINE[key][last[ty].op] : -1;
        CODE[key].forEach((ln, i) => box.append(h('span', { class: 'ln' + (i === hl ? (sim.deadlock && u ? ' err' : ' on') : '') }, ln)));
      }
      // stats
      clear(statsBox);
      const kp = (v, l) => h('div', { class: 'kpi' }, h('b', null, v), h('span', null, l));
      statsBox.append(kp(sim.stats.produced, 'Produced'), kp(sim.stats.consumed, 'Consumed'), kp(sim.count + ' / ' + sim.slots.length, 'Occupancy'), kp(sim.stats.maxCount, 'Max occupancy'), kp(sim.stats.blocks, 'Times blocked'), kp(sim.stats.steps, 'Instructions'));
      clear(logBox);
      logLines.slice(0, 14).forEach(l => logBox.append(h('div', { class: l.blocked ? 'banker' : '' }, h('span', { class: 't mono' }, '#' + l.n), h('b', null, l.who), ' ' + l.op + (l.blocked ? ' → BLOCKED' : '') + (l.note && l.note !== 'acquired' && l.note !== 'blocked' ? ' — ' + l.note : ''))));
      if (!logLines.length) logBox.append(h('div', null, 'Press Play or Step.'));
    }

    render();
    return { onHide() { player.pause(); } };
  }

  UI.modules.pc = { init };
})();
