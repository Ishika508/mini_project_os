/* Live City — the integrated simulation: all four OS mechanisms driving one intersection. */
(function () {
  'use strict';
  const { h, clear, fmt, numInput, slider, select, toggle, Player, controlBar, pcolor } = UI;
  const C = OSCore;

  const KIND_COLOR = { emergency: '#ef4444', sensor: '#3b82f6', camera: '#8b5cf6' };
  const RES_SHORT = ['CH', 'CAM', 'SIG'];
  const W = 800, H = 560, CX = 400, CY = 280, ROAD = 56, LANE = 28, STOP = 74, GAP = 28;

  const PRESETS = {
    normal:    { label: 'Normal day',          o: { arrival: 0.3, emergency: 0.04, sensorPeriod: 9, cameraPeriod: 12, bufferSize: 6, consumers: 4, memTotal: 640 } },
    rush:      { label: 'Rush hour',           o: { arrival: 0.55, emergency: 0.04, sensorPeriod: 6, cameraPeriod: 9, bufferSize: 6, consumers: 4, memTotal: 640 } },
    emergency: { label: 'Emergency vehicles',  o: { arrival: 0.35, emergency: 0.22, sensorPeriod: 7, cameraPeriod: 12, bufferSize: 6, consumers: 4, memTotal: 640 } },
    storm:     { label: 'Sensor storm (buffer pressure)', o: { arrival: 0.4, emergency: 0.05, sensorPeriod: 2, cameraPeriod: 3, bufferSize: 4, consumers: 3, memTotal: 640 } },
    memory:    { label: 'Memory starved',      o: { arrival: 0.35, emergency: 0.05, sensorPeriod: 5, cameraPeriod: 7, bufferSize: 6, consumers: 5, memTotal: 384 } },
  };

  function init(root) {
    let sim = new C.TrafficSim({});
    const rr = (ctx, x, y, w, hh, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };

    /* ---------------------------- layout skeleton ---------------------------- */
    const canvas = h('canvas', { id: 'city', width: W, height: H });
    const hud = h('div', { class: 'hud' });
    const kpiBox = h('div', { class: 'kpis', style: { marginTop: '12px' } });
    const player = Player(tick, { speed: 5 });
    const bar = controlBar(player, rebuild);
    const presetSel = select('Scenario preset', Object.entries(PRESETS).map(([k, v]) => [k, v.label]), 'normal', k => { applyPreset(k); });
    presetSel.style.margin = '0'; presetSel.style.minWidth = '200px';
    bar.insertBefore(presetSel, bar.querySelector('.speed'));

    const canvasCard = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, 'Smart intersection', h('span', { class: 'tag' }, 'live')), bar, h('div', { style: { height: '12px' } }),
      h('div', { class: 'canvas-wrap' }, canvas, hud), kpiBox);

    const ctrlBox = h('div', { class: 'grid g3', style: { gap: '4px 18px' } });
    const ctrlCard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, 'Control panel', h('span', { class: 'tag' }, 'change anything while it runs')), ctrlBox);

    const pipeBox = h('div'), cpuBox = h('div'), memBox = h('div'), bankBox = h('div'), logBox = h('div', { class: 'log', style: { maxHeight: '260px' } });
    const panels = h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, '① Producer–Consumer · sensors → buffer → workers'), pipeBox),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, '② CPU scheduling · tasks'), cpuBox),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, '③ Memory management · working buffers'), memBox),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, '④ Banker\'s algorithm · shared resources'), bankBox));
    const logCard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, 'System event log'), logBox);
    root.append(h('div', { class: 'grid live-grid' }, h('div', { class: 'stack' }, canvasCard, ctrlCard, logCard), panels));

    /* ----------------------------- controls ----------------------------- */
    const ctl = {};
    function buildControls() {
      clear(ctrlBox);
      const o = () => sim.o;
      ctl.arrival = slider('Traffic arrival rate', 0.05, 0.8, o().arrival, 0.01, v => { sim.o.arrival = v; }, v => v.toFixed(2) + ' /s');
      ctl.emergency = slider('Emergency vehicle chance', 0, 0.4, o().emergency, 0.01, v => { sim.o.emergency = v; }, v => Math.round(v * 100) + '%');
      ctl.sensorPeriod = slider('Sensor period (lower = more data)', 1, 20, o().sensorPeriod, 1, v => { sim.o.sensorPeriod = v; }, v => 'every ' + v + 's');
      ctl.cameraPeriod = slider('Camera period', 2, 30, o().cameraPeriod, 1, v => { sim.o.cameraPeriod = v; }, v => 'every ' + v + 's');
      ctl.green = slider('Base green time (fixed mode)', 4, 20, o().greenTime, 1, v => { sim.o.greenTime = v; }, v => v + 's');
      ctl.adaptive = h('div', { class: 'field' }, h('label', null, 'Signal control'), toggle('Adaptive (uses analysis results)', o().adaptive, v => { sim.o.adaptive = v; }));
      ctl.algo = select('CPU scheduling algorithm', Object.entries(C.CPU_ALGOS).map(([k, v]) => [k, v.label]), o().algo, v => { sim.setAlgo(v, sim.o.quantum); render(); });
      ctl.quantum = h('div', { class: 'field' }, h('label', null, 'RR quantum'), numInput(o().quantum, 1, 8, v => { sim.setAlgo(sim.o.algo, v); }));
      ctl.fit = select('Memory placement', [['first', 'First Fit'], ['best', 'Best Fit'], ['worst', 'Worst Fit']], o().fit, v => { sim.o.fit = v; });
      ctl.mem = h('div', { class: 'field' }, h('label', null, 'Memory KB (restarts)'), numInput(o().memTotal, 256, 2048, v => { sim.o.memTotal = v; rebuild(); }, { step: 64 }));
      ctl.buf = h('div', { class: 'field' }, h('label', null, 'Buffer slots (restarts)'), numInput(o().bufferSize, 1, 12, v => { sim.o.bufferSize = v; rebuild(); }));
      ctl.cons = h('div', { class: 'field' }, h('label', null, 'Consumer threads (restarts)'), numInput(o().consumers, 1, 8, v => { sim.o.consumers = v; rebuild(); }));
      [ctl.arrival, ctl.emergency, ctl.sensorPeriod, ctl.cameraPeriod, ctl.green, ctl.adaptive, ctl.algo, ctl.quantum, ctl.fit, ctl.mem, ctl.buf, ctl.cons].forEach(e => ctrlBox.append(e));
      ctrlBox.append(h('div', { class: 'field' }, h('label', null, 'Memory'), h('button', { class: 'btn', onclick: () => { sim.mem.compact(); sim._log('memory', 'Compaction performed'); renderPanels(); } }, '🗜 Compact now')));
    }
    function applyPreset(k) {
      const keep = { algo: sim.o.algo, quantum: sim.o.quantum, fit: sim.o.fit, adaptive: sim.o.adaptive, greenTime: sim.o.greenTime, seed: sim.o.seed };
      sim = new C.TrafficSim(Object.assign({}, keep, PRESETS[k].o));
      afterRebuild();
    }
    function rebuild() { player.pause(); sim = new C.TrafficSim(Object.assign({}, sim.o)); afterRebuild(); }
    function afterRebuild() { vis.cars.clear(); vis.parts.length = 0; vis.pulse = {}; buildControls(); render(); }

    /* ----------------------------- stepping ----------------------------- */
    function tick() {
      const ev = sim.step();
      handleEvents(ev);
      render();
      return true;
    }

    /* ----------------------------- canvas visuals ----------------------------- */
    const vis = { cars: new Map(), parts: [], pulse: {}, colors: null, last: performance.now(), running: false, flashT: 0 };
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;

    const carHues = [210, 25, 160, 280, 45, 190, 340];
    function geo(a, d) {
      switch (a) {
        case 'N': return { x: CX - LANE, y: CY - d, ang: Math.PI / 2 };
        case 'S': return { x: CX + LANE, y: CY + d, ang: -Math.PI / 2 };
        case 'W': return { x: CX - d, y: CY + LANE, ang: 0 };
        default:  return { x: CX + d, y: CY - LANE, ang: Math.PI };
      }
    }
    const slotD = (i) => STOP + 16 + i * GAP;
    const spawnD = (a) => (a === 'N' || a === 'S' ? 330 : 450);
    function readColors() {
      const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
      vis.colors = { bg: g('--map-bg'), road: g('--road'), line: g('--road-line'), curb: g('--curb'), bld: g('--building'), bldE: g('--building-edge'), text: g('--text'), muted: g('--muted'), accent: g('--accent'), surface: g('--surface') };
    }

    function handleEvents(evs) {
      const now = performance.now();
      for (const e of evs) {
        if (e.type === 'arrive') {
          const hue = carHues[e.car.id % carHues.length];
          vis.cars.set(e.car.id, { id: e.car.id, a: e.a, d: spawnD(e.a), em: e.car.em, color: `hsl(${hue} 65% 52%)`, leaving: false });
        } else if (e.type === 'depart') {
          const c = vis.cars.get(e.car.id); if (c) c.leaving = true;
        } else if (e.type === 'produce') {
          vis.pulse[e.src] = now;
          const from = sensorPos(e.src);
          vis.parts.push({ x: from.x, y: from.y, t0: now, kind: e.src === 'CAM' ? 'camera' : 'sensor' });
        }
      }
    }
    function sensorPos(src) {
      if (src === 'CAM') return { x: CX - ROAD - 22, y: CY - ROAD - 22 };
      const a = src.slice(2), g = geo(a, STOP + 10);
      return { x: g.x, y: g.y };
    }
    const TCC = { x: 540, y: 28, w: 232, h: 150 };

    function frame(now) {
      if (!vis.running) return;
      const dt = Math.min(0.05, (now - vis.last) / 1000); vis.last = now;
      vis.flashT += dt;
      update(dt); draw(now);
      requestAnimationFrame(frame);
    }
    function update(dt) {
      const k = 1000 / Math.max(35, player.delay);
      const v = Math.min(900, 90 + 38 * k);
      // queue index per approach
      const idx = {};
      for (const a of C.APPROACHES) sim.queues[a].forEach((car, i) => { idx[car.id] = i; });
      for (const [id, c] of vis.cars) {
        if (c.leaving) { c.d -= v * 1.5 * dt; if (c.d < -(c.a === 'N' || c.a === 'S' ? 340 : 460)) vis.cars.delete(id); continue; }
        const i = idx[id];
        if (i == null) { c.d -= v * 1.5 * dt; continue; }      // departed in a skipped frame
        const target = slotD(i);
        if (c.d > target) c.d = Math.max(target, c.d - Math.max(60, Math.min(v, (c.d - target) * 5)) * dt);
      }
    }

    function draw(now) {
      if (!vis.colors) readColors();
      const col = vis.colors;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, H);

      // city blocks
      const blocks = [[14, 14, CX - ROAD - 28, CY - ROAD - 28], [CX + ROAD + 14, 14, W - CX - ROAD - 28, CY - ROAD - 28], [14, CY + ROAD + 14, CX - ROAD - 28, H - CY - ROAD - 28], [CX + ROAD + 14, CY + ROAD + 14, W - CX - ROAD - 28, H - CY - ROAD - 28]];
      blocks.forEach((b, bi) => {
        ctx.fillStyle = col.bld; ctx.strokeStyle = col.bldE; ctx.lineWidth = 1.5; rr(ctx, b[0], b[1], b[2], b[3], 14); ctx.fill(); ctx.stroke();
        if (bi === 1) return;
        ctx.fillStyle = col.bldE;
        for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { rr(ctx, b[0] + 20 + i * ((b[2] - 50) / 4.4), b[1] + 20 + j * ((b[3] - 50) / 2.6), 26, 20, 4); ctx.fill(); }
      });

      // roads
      ctx.fillStyle = col.road;
      ctx.fillRect(CX - ROAD, 0, ROAD * 2, H); ctx.fillRect(0, CY - ROAD, W, ROAD * 2);
      ctx.strokeStyle = col.curb; ctx.lineWidth = 3;
      [[CX - ROAD, 0, CX - ROAD, CY - ROAD], [CX + ROAD, 0, CX + ROAD, CY - ROAD], [CX - ROAD, CY + ROAD, CX - ROAD, H], [CX + ROAD, CY + ROAD, CX + ROAD, H],
       [0, CY - ROAD, CX - ROAD, CY - ROAD], [0, CY + ROAD, CX - ROAD, CY + ROAD], [CX + ROAD, CY - ROAD, W, CY - ROAD], [CX + ROAD, CY + ROAD, W, CY + ROAD]]
        .forEach(l => { ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.stroke(); });
      // centre dashed lines
      ctx.strokeStyle = col.line; ctx.lineWidth = 2; ctx.setLineDash([14, 12]); ctx.globalAlpha = .8;
      [[CX, 0, CX, CY - ROAD], [CX, CY + ROAD, CX, H], [0, CY, CX - ROAD, CY], [CX + ROAD, CY, W, CY]].forEach(l => { ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.stroke(); });
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      // crosswalks + stop lines
      ctx.fillStyle = col.line; ctx.globalAlpha = .85;
      for (let i = -ROAD + 6; i < ROAD - 6; i += 14) {
        ctx.fillRect(CX + i, CY - ROAD - 16, 8, 12); ctx.fillRect(CX + i, CY + ROAD + 4, 8, 12);
        ctx.fillRect(CX - ROAD - 16, CY + i, 12, 8); ctx.fillRect(CX + ROAD + 4, CY + i, 12, 8);
      }
      ctx.globalAlpha = 1; ctx.fillStyle = '#f8fafc';
      ctx.fillRect(CX - ROAD, CY - STOP - 3, ROAD, 4); ctx.fillRect(CX, CY + STOP - 1, ROAD, 4);
      ctx.fillRect(CX - STOP - 3, CY, 4, ROAD); ctx.fillRect(CX + STOP - 1, CY - ROAD, 4, ROAD);

      // loop detectors (sensors)
      for (const a of C.APPROACHES) {
        const g = geo(a, STOP + 12), p = vis.pulse['S-' + a], age = p ? (now - p) / 1000 : 9;
        ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.ang);
        ctx.fillStyle = age < .7 ? '#38bdf8' : '#64748b'; ctx.globalAlpha = age < .7 ? 1 : .8;
        if (age < .7) { ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 16; }
        rr(ctx, -4, -ROAD / 2 + 8, 8, ROAD - 16, 3); ctx.fill(); ctx.restore();
      }

      // cars
      const cars = Array.from(vis.cars.values());
      for (const c of cars) drawCar(c, now);

      // signals + queue badges
      const s = sim.sig;
      for (const a of C.APPROACHES) {
        const ph = C.PHASE_OF[a];
        const st = s.phase === ph ? (s.mode === 'green' ? 'g' : 'y') : 'r';
        const pos = { N: [CX - ROAD - 18, CY - STOP - 44], S: [CX + ROAD + 6, CY + STOP + 8], E: [CX + STOP + 8, CY - ROAD - 44], W: [CX - STOP - 20, CY + ROAD + 8] }[a];
        ctx.fillStyle = '#0b1220'; rr(ctx, pos[0], pos[1], 14, 38, 5); ctx.fill();
        [['r', '#ef4444', 6], ['y', '#fbbf24', 19], ['g', '#22c55e', 32]].forEach(([k2, color, dy]) => {
          const on = st === k2;
          ctx.beginPath(); ctx.arc(pos[0] + 7, pos[1] + dy - 1, 4.2, 0, 7);
          ctx.fillStyle = on ? color : 'rgba(255,255,255,.12)';
          if (on) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
          ctx.fill(); ctx.shadowBlur = 0;
        });
        const qn = sim.queues[a].length;
        const bp = geo(a, STOP + 74 + Math.min(qn, 6) * 0);
        ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const bx = { N: CX + 40, S: CX - 40, W: CX - STOP - 8, E: CX + STOP + 8 }[a], by = { N: CY - STOP - 8, S: CY + STOP + 8, W: CY - 40, E: CY + 40 }[a];
        ctx.fillStyle = 'rgba(15,23,42,.8)'; rr(ctx, bx - 20, by - 10, 40, 20, 10); ctx.fill();
        ctx.fillStyle = qn > 9 ? '#f87171' : '#e2e8f0'; ctx.fillText(a + ' ' + qn, bx, by + .5);
      }

      // camera on pole
      const cp = sensorPos('CAM'), cage = vis.pulse.CAM ? (now - vis.pulse.CAM) / 1000 : 9;
      const sweep = Math.sin(now / 700) * .5;
      ctx.save(); ctx.translate(cp.x, cp.y); ctx.rotate(Math.PI / 4 + sweep);
      ctx.fillStyle = cage < .8 ? 'rgba(167,139,250,.5)' : 'rgba(148,163,184,.18)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(90, -34); ctx.lineTo(90, 34); ctx.closePath(); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#8b5cf6'; rr(ctx, cp.x - 9, cp.y - 6, 18, 12, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cp.x, cp.y, 3, 0, 7); ctx.fill();

      // control centre
      drawTCC(now);

      // data packets
      vis.parts = vis.parts.filter(p => now - p.t0 < 1100);
      for (const p of vis.parts) {
        const u = (now - p.t0) / 1100, e = u * u * (3 - 2 * u);
        const tx = TCC.x + 30, ty = TCC.y + TCC.h - 20;
        const x = p.x + (tx - p.x) * e, y = p.y + (ty - p.y) * e - Math.sin(u * Math.PI) * 40;
        ctx.fillStyle = KIND_COLOR[p.kind]; ctx.shadowColor = KIND_COLOR[p.kind]; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, y, p.kind === 'camera' ? 5 : 3.6, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      }
    }

    function drawCar(c, now) {
      const g = geo(c.a, c.d);
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.ang);
      const L = c.em ? 28 : 24, Wd = c.em ? 15 : 13;
      ctx.fillStyle = 'rgba(0,0,0,.28)'; rr(ctx, -L / 2 + 2, -Wd / 2 + 3, L, Wd, 4); ctx.fill();
      ctx.fillStyle = c.em ? '#f8fafc' : c.color; rr(ctx, -L / 2, -Wd / 2, L, Wd, 4); ctx.fill();
      ctx.fillStyle = c.em ? '#ef4444' : 'rgba(255,255,255,.35)';
      if (c.em) ctx.fillRect(-L / 2 + 3, -Wd / 2, 6, Wd); else rr(ctx, 2, -Wd / 2 + 2, 7, Wd - 4, 2), ctx.fill();
      if (c.em) { ctx.fillStyle = Math.floor(now / 140) % 2 ? '#ef4444' : '#3b82f6'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(0, 0, 3.6, 0, 7); ctx.fill(); }
      ctx.restore();
    }

    function drawTCC(now) {
      const col = vis.colors, T = TCC;
      ctx.fillStyle = col.surface; ctx.strokeStyle = col.accent; ctx.lineWidth = 2; rr(ctx, T.x, T.y, T.w, T.h, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.accent; ctx.font = '800 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('TRAFFIC CONTROL CENTRE', T.x + 12, T.y + 20);
      // buffer
      ctx.fillStyle = col.muted; ctx.font = '600 10.5px system-ui, sans-serif'; ctx.fillText('buffer ' + sim.buffer.length + '/' + sim.o.bufferSize, T.x + 12, T.y + 38);
      const N = sim.o.bufferSize, bw = Math.min(26, (T.w - 24 - (N - 1) * 3) / N);
      for (let i = 0; i < N; i++) {
        const pk = sim.buffer[i];
        ctx.fillStyle = pk ? (Object.values(pk.em).some(Boolean) ? KIND_COLOR.emergency : KIND_COLOR[pk.kind]) : 'rgba(148,163,184,.25)';
        rr(ctx, T.x + 12 + i * (bw + 3), T.y + 44, bw, 16, 3); ctx.fill();
      }
      // cpu
      const run = sim.sch.current || (sim.ganttLog.length ? null : null);
      const lastG = sim.ganttLog[sim.ganttLog.length - 1];
      ctx.fillStyle = col.muted; ctx.fillText('CPU: ' + (lastG && lastG.id ? lastG.id : 'idle'), T.x + 12, T.y + 80);
      const spin = lastG && lastG.id ? now / 220 : 0;
      ctx.strokeStyle = lastG && lastG.id ? KIND_COLOR[lastG.kind] : 'rgba(148,163,184,.4)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(T.x + T.w - 28, T.y + 72, 12, spin, spin + 4.4); ctx.stroke();
      // memory
      const ms = sim.mem.stats();
      ctx.fillStyle = col.muted; ctx.fillText('memory ' + ms.used + '/' + ms.total + ' KB', T.x + 12, T.y + 102);
      let px = T.x + 12; const mw = T.w - 24;
      sim.mem.segs.forEach(sg => {
        const w = sg.size / sim.mem.total * mw;
        ctx.fillStyle = sg.owner ? '#22c55e' : 'rgba(148,163,184,.25)'; ctx.fillRect(px, T.y + 108, Math.max(1, w - 1), 10); px += w;
      });
      // banker
      ctx.fillStyle = col.muted; ctx.fillText("Banker's: " + (sim.safety.safe ? 'SAFE' : 'UNSAFE') + '  avail [' + sim.available.join(',') + ']', T.x + 12, T.y + 138);
      ctx.fillStyle = sim.safety.safe ? '#22c55e' : '#ef4444'; ctx.beginPath(); ctx.arc(T.x + T.w - 16, T.y + 134, 5, 0, 7); ctx.fill();
    }

    /* ----------------------------- panels ----------------------------- */
    const kp = (v, l, cls) => h('div', { class: 'kpi' + (cls ? ' ' + cls : '') }, h('b', null, v), h('span', null, l));
    const vecEl = (a, labels) => h('span', { class: 'vec' }, a.map((v, j) => h('b', { class: v ? '' : 'z', title: labels ? labels[j] : '' }, v)));

    function render() { renderHud(); renderKpis(); renderPanels(); }

    function renderHud() {
      clear(hud);
      const s = sim.sig;
      const color = s.mode === 'yellow' ? '#fbbf24' : '#22c55e';
      hud.append(h('span', { class: 'chip' }, h('i', { class: 'sigdot', style: { background: color, boxShadow: '0 0 8px ' + color } }), (s.phase === 'NS' ? 'North–South' : 'East–West') + ' ' + s.mode + ' · ' + Math.max(0, s.timer) + 's'),
        h('span', { class: 'chip' }, 't = ' + sim.t + 's'),
        h('span', { class: 'chip ' + (sim.o.adaptive ? 'good' : '') }, sim.o.adaptive ? 'adaptive' : 'fixed timing'));
    }

    function renderKpis() {
      const S = sim.stats;
      clear(kpiBox);
      kpiBox.append(
        kp(S.passed ? fmt(S.waitSum / S.passed, 1) + 's' : '–', 'Avg car wait'),
        kp(S.passed, 'Cars passed'),
        kp(S.maxQueue, 'Longest queue'),
        kp(S.emPassed ? fmt(S.emWaitSum / S.emPassed, 1) + 's' : '–', 'Emergency wait'),
        kp(S.done, 'Tasks completed'),
        kp(sim.t ? Math.round(S.busy / sim.t * 100) + '%' : '–', 'CPU utilization'),
        kp(S.blockedTicks, 'Sensor blocked-ticks'),
        kp(S.unsafeDenials, "Banker's denials"));
    }

    function renderPanels() {
      const o = sim.o, S = sim.stats;

      /* ① pipeline */
      clear(pipeBox);
      const prow = h('div', { class: 'row', style: { marginBottom: '10px' } },
        sim.producers.map(p => h('span', { class: 'chip ' + (p.blocked ? 'bad' : (vis.pulse[p.id] && performance.now() - vis.pulse[p.id] < 700 ? 'good' : '')), title: p.blocked ? 'blocked on wait(empty)' : '' }, p.blocked ? '⛔ ' + p.id : p.id)));
      const slots = h('div', { class: 'slots', style: { margin: '6px 0 12px' } },
        Array.from({ length: o.bufferSize }, (_, i) => {
          const pk = sim.buffer[i], em = pk && Object.values(pk.em).some(Boolean);
          return h('div', { class: 'slot' + (pk ? ' full' : ''), style: pk ? { background: em ? KIND_COLOR.emergency : KIND_COLOR[pk.kind] } : {} }, pk ? (pk.kind === 'camera' ? 'CAM' : pk.src.slice(2)) + (em ? '!' : '') : '');
        }));
      const crow = h('div', { class: 'row' }, sim.threads.map(t => h('span', { class: 'chip ' + (t.task ? 'info' : '') }, t.id + ': ' + (t.task ? t.task.name : 'idle'))));
      const sems = h('div', { class: 'sems', style: { marginTop: '12px' } },
        [['empty', o.bufferSize - sim.buffer.length], ['full', sim.buffer.length], ['mutex', 1]].map(([n, v]) => h('div', { class: 'sem' }, h('span', null, n), h('b', null, v), h('small', null, n === 'empty' && v === 0 ? 'producers blocked' : n === 'full' && v === 0 ? 'consumers wait' : ''))));
      pipeBox.append(h('div', { class: 'lbl' }, 'Producers (sensors & camera)'), prow, h('div', { class: 'lbl' }, 'Bounded buffer — blue sensor · violet camera · red emergency'), slots, h('div', { class: 'lbl' }, 'Consumers (threads → tasks)'), crow, sems);

      /* ② CPU */
      clear(cpuBox);
      const cur = sim.sch.current || null, lastG = sim.ganttLog[sim.ganttLog.length - 1];
      const ready = sim.sch.ready.filter(x => x !== cur);
      const chip = (t, extra) => h('span', { class: 'pchip', style: { background: KIND_COLOR[t.kind], opacity: t.blocked ? .55 : 1 }, title: t.name + ' · prio ' + t.priority + ' · burst ' + t.burst }, t.name + (t.blocked ? ' ⛔' : '') + (extra || ''));
      cpuBox.append(
        h('div', { class: 'row' }, h('span', { class: 'tag' }, C.CPU_ALGOS[o.algo].label + (o.algo === 'RR' ? ' · q=' + o.quantum : '')),
          h('span', { class: 'small muted' }, 'Running:'), lastG && lastG.id ? h('span', { class: 'pchip', style: { background: KIND_COLOR[lastG.kind] } }, lastG.id) : h('span', { class: 'small faint' }, 'idle')),
        h('div', { class: 'lbl', style: { marginTop: '10px' } }, 'Ready queue'), h('div', { class: 'queue' }, ready.length ? ready.map(t => chip(t, ' p' + t.priority)) : h('span', { class: 'small faint' }, 'empty')),
        h('div', { class: 'lbl', style: { marginTop: '10px' } }, 'Awaiting admission (memory / safe resources)'), h('div', { class: 'queue' }, sim.admit.length ? sim.admit.map(t => h('span', { class: 'pchip', style: { background: KIND_COLOR[t.kind], opacity: .6 } }, t.name + ' · ' + (t.wait === 'MEM' ? 'no memory' : t.wait === 'unsafe' ? 'unsafe' : t.wait ? 'busy' : 'new'))) : h('span', { class: 'small faint' }, 'none')),
        h('div', { class: 'lbl', style: { marginTop: '10px' } }, 'Last 40 time units'),
        h('div', { class: 'strip' }, Array.from({ length: 40 }, (_, i) => { const g = sim.ganttLog[sim.ganttLog.length - 40 + i]; return h('i', { style: g && g.id ? { background: KIND_COLOR[g.kind] } : {}, title: g ? (g.id || 'idle') : '' }); })),
        h('div', { class: 'row small muted', style: { marginTop: '8px' } }, 'Avg task turnaround: ', h('b', null, S.done ? fmt(S.tatSum / S.done, 1) : '–'), ' · context switches: ', h('b', null, sim.sch.switches)));

      /* ③ memory */
      clear(memBox);
      const ms = sim.mem.stats();
      const mb = h('div', { class: 'membar', style: { height: '56px' } }, sim.mem.segs.map(s => h('div', { class: 'mseg ' + (s.owner ? 'occ' : 'hole'), style: { flex: s.size + ' 1 0', background: s.owner ? KIND_COLOR[(sim.active.find(t => t.id === s.owner) || {}).kind] || '#22c55e' : '', cursor: 'default' }, title: (s.owner || 'free') + ' ' + s.size + ' KB @' + s.start },
        h('div', { class: 'lbl2' }, s.owner ? (sim.active.find(t => t.id === s.owner) || { name: s.owner }).name : '', h('br'), h('small', null, s.size)))));
      memBox.append(h('div', { class: 'row', style: { marginBottom: '8px' } }, h('span', { class: 'tag' }, { first: 'First Fit', best: 'Best Fit', worst: 'Worst Fit' }[o.fit]), h('span', { class: 'small muted' }, 'task memory needs: sensor 64–128 KB · camera 160–288 KB · emergency 64–96 KB')),
        mb,
        h('div', { class: 'kpis', style: { marginTop: '10px' } }, kp(ms.used + '/' + ms.total, 'KB used'), kp(ms.largest, 'Largest hole'), kp(ms.external, 'External frag'), kp(S.memFails, 'Allocation waits')));

      /* ④ banker's */
      clear(bankBox);
      const act = sim.active;
      const need = act.map(t => t.max.map((v, j) => v - t.alloc[j]));
      bankBox.append(
        h('div', { class: 'row', style: { marginBottom: '8px' } }, h('span', { class: 'small muted' }, 'Available'), vecEl(sim.available, C.RES_NAMES), h('span', { class: 'small faint' }, '/ total'), vecEl(o.resTotal, C.RES_NAMES),
          h('span', { class: 'small faint' }, RES_SHORT.map((s, j) => s + '=' + C.RES_NAMES[j]).join(' · '))),
        act.length ? h('div', { class: 'tblwrap' }, h('table', { class: 'tbl matrix' },
          h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Task'), h('th', null, 'Alloc'), h('th', null, 'Max'), h('th', null, 'Need'))),
          h('tbody', null, act.map((t, i) => h('tr', { class: t.blocked ? 'bad' : '' }, h('td', { class: 'l' }, h('span', { class: 'pchip', style: { background: KIND_COLOR[t.kind] } }, t.name), t.blocked ? ' ⛔' : ''), h('td', null, vecEl(t.alloc)), h('td', null, vecEl(t.max)), h('td', null, vecEl(need[i]))))))) : h('div', { class: 'small faint' }, 'No admitted tasks.'),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          sim.safety.safe ? h('span', { class: 'chip good' }, '✔ SAFE' + (act.length ? ' · sequence ' + sim.safety.sequence.map(i => act[i].name).join(' → ') : '')) : h('span', { class: 'chip bad' }, '✘ UNSAFE')),
        h('div', { class: 'kpis', style: { marginTop: '10px' } }, kp(S.grants, 'Grants'), kp(S.unsafeDenials, 'Denied: unsafe'), kp(S.shortDenials, 'Waited: busy')));

      /* log */
      clear(logBox);
      sim.log.slice(-40).reverse().forEach(l => logBox.append(h('div', { class: l.type }, h('span', { class: 't mono' }, l.t + 's'), l.msg)));
      if (!sim.log.length) logBox.append(h('div', null, 'Press Play. Events from all four modules appear here.'));
    }

    /* ----------------------------- lifecycle ----------------------------- */
    buildControls(); render();
    function start() { if (vis.running) return; vis.running = true; vis.last = performance.now(); readColors(); requestAnimationFrame(frame); }
    window.addEventListener('trafficos-theme', () => { vis.colors = null; if (!vis.running) { readColors(); draw(performance.now()); } });
    // draw once so the static scene is visible even before Play
    readColors(); draw(performance.now());
    return { onShow() { start(); }, onHide() { vis.running = false; player.pause(); } };
  }

  UI.modules.live = { init };
})();
