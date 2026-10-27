/* Module 3 — Banker's algorithm (safety + resource-request) */
(function () {
  'use strict';
  const { h, clear, numInput, Player, controlBar, toast, select } = UI;
  const C = OSCore;

  const PRESETS = {
    traffic: {
      label: 'Traffic centre (safe)',
      pn: ['Signal Control', 'Sensor Agg.', 'Camera Analytics', 'Incident Detect', 'Reporting'],
      rn: ['Comm Channel', 'Camera Decoder', 'Signal Link'],
      alloc: [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
      max: [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]],
      avail: [3, 3, 2],
    },
    unsafe: {
      label: 'Unsafe state',
      pn: ['Signal Control', 'Sensor Agg.', 'Camera Analytics'],
      rn: ['Comm Channel', 'Camera Decoder'],
      alloc: [[1, 0], [0, 1], [1, 1]],
      max: [[2, 1], [1, 2], [3, 2]],
      avail: [0, 0],
    },
    small: {
      label: 'Two-camera deadlock risk',
      pn: ['Camera task 1', 'Camera task 2', 'Sensor task'],
      rn: ['Comm Channel', 'Camera Decoder', 'Signal Link'],
      alloc: [[1, 1, 0], [0, 0, 0], [1, 0, 0]],
      max: [[2, 2, 1], [2, 2, 1], [2, 0, 1]],
      avail: [2, 1, 2],
    },
  };

  function init(root) {
    let st = clone(PRESETS.traffic);
    let trace = null, ti = 0, reqResult = null;

    function clone(p) { return { pn: p.pn.slice(), rn: p.rn.slice(), alloc: p.alloc.map(r => r.slice()), max: p.max.map(r => r.slice()), avail: p.avail.slice() }; }
    const n = () => st.alloc.length, m = () => st.avail.length;
    const rl = (j) => String.fromCharCode(65 + j);

    function resize(newN, newM) {
      const grow = (arr, len, fill) => { const a = arr.slice(0, len); while (a.length < len) a.push(fill(a.length)); return a; };
      st.pn = grow(st.pn, newN, i => 'P' + i);
      st.rn = grow(st.rn, newM, j => 'Resource ' + rl(j));
      st.alloc = grow(st.alloc, newN, () => []).map(r => grow(r, newM, () => 0));
      st.max = grow(st.max, newN, () => []).map(r => grow(r, newM, () => 0));
      st.avail = grow(st.avail, newM, () => 0);
      invalidate(); renderAll();
    }

    /* ---------------- panels ---------------- */
    const matBox = h('div'), needBox = h('div'), verdict = h('div'), stepsBox = h('div', { class: 'log', style: { maxHeight: '260px' } });
    const workBox = h('div', { class: 'row' }), seqBox = h('div', { class: 'queue' });
    const reqBox = h('div');
    let hlRow = -1, doneSet = new Set(), failSet = new Set();

    const presetSel = select('Load example', Object.entries(PRESETS).map(([k, v]) => [k, v.label]), 'traffic', v => { st = clone(PRESETS[v]); invalidate(); renderAll(); });
    const nIn = numInput(n(), 1, 8, v => resize(v, m()));
    const mIn = numInput(m(), 1, 5, v => resize(n(), v));
    const config = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, 'Configuration', h('span', { class: 'tag' }, 'editable')),
      presetSel,
      h('div', { class: 'grid g2', style: { gap: '10px' } },
        h('div', { class: 'field' }, h('label', null, 'Processes (n)'), nIn),
        h('div', { class: 'field' }, h('label', null, 'Resource types (m)'), mIn)),
      h('p', { class: 'small muted' }, 'Edit Allocation, Max and Available directly in the tables. Need = Max − Allocation is computed live; invalid rows (Max < Allocation) are flagged red.'),
      h('div', { class: 'card-h', style: { marginTop: '14px' } }, 'Resource request'), reqBox);

    const player = Player(tick, { speed: 4 });
    const bar = controlBar(player, () => { invalidate(); renderAll(); }, h('button', { class: 'btn good', onclick: () => { runAll(); } }, '⚡ Instant result'));
    const main = h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, 'Matrices', h('span', { class: 'tag' }, 'Allocation · Max · Need')), matBox, h('div', { style: { height: '8px' } }), h('div', { class: 'lbl' }, 'Available vector'), h('div', { id: 'availBox' })),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, 'Safety algorithm', h('span', { class: 'tag' }, 'step-by-step')), bar, h('div', { style: { height: '12px' } }),
        h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { style: { flex: '1 1 220px' } }, h('div', { class: 'lbl' }, 'Work (available) vector'), workBox, h('div', { class: 'lbl', style: { marginTop: '10px' } }, 'Safe sequence so far'), seqBox),
          h('div', { style: { flex: '2 1 280px' } }, h('div', { class: 'lbl' }, 'Checks'), stepsBox)),
        h('div', { style: { height: '10px' } }), verdict));
    root.append(h('div', { class: 'grid split' }, config, main));

    /* ---------------- rendering ---------------- */
    function invalidate() { player.pause(); trace = null; ti = 0; hlRow = -1; doneSet = new Set(); failSet = new Set(); reqResult = null; }

    function cellIn(arr, i, j) {
      return numInput(arr[i][j], 0, 99, v => { arr[i][j] = v; invalidate(); renderDynamic(); });
    }

    function renderAll() {
      nIn.value = n(); mIn.value = m();
      clear(matBox);
      const need = C.bankersNeed(st.max, st.alloc);
      const head = (t, cols) => h('tr', null, h('th', { class: 'l' }, t), cols.map(c => h('th', null, c)));
      const rcols = Array.from({ length: m() }, (_, j) => rl(j));
      const table = h('table', { class: 'tbl matrix' },
        h('thead', null,
          h('tr', null, h('th', { rowspan: 2, class: 'l' }, 'Process'), h('th', { colspan: m() }, 'Allocation'), h('th', { colspan: m() }, 'Max'), h('th', { colspan: m() }, 'Need = Max − Alloc')),
          h('tr', null, [0, 1, 2].map(() => rcols.map(c => h('th', null, c))))),
        h('tbody', null, st.alloc.map((_, i) => {
          const bad = st.max[i].some((v, j) => v < st.alloc[i][j]);
          return h('tr', { 'data-row': i, class: bad ? 'bad' : '' },
            h('td', { class: 'l' }, h('input', { type: 'text', value: st.pn[i], style: { textAlign: 'left', minWidth: '110px' }, oninput: e => { st.pn[i] = e.target.value; } })),
            st.alloc[i].map((_, j) => h('td', null, cellIn(st.alloc, i, j))),
            st.max[i].map((_, j) => h('td', null, cellIn(st.max, i, j))),
            need[i].map((v, j) => h('td', { class: 'need' + (v < 0 ? ' cell-bad' : '') }, v)));
        })));
      matBox.append(h('div', { class: 'tblwrap' }, table));
      // resource names + available
      const av = document.getElementById('availBox'); clear(av);
      av.append(h('div', { class: 'row' }, st.avail.map((v, j) => h('div', { class: 'field', style: { marginBottom: 0, minWidth: '110px', flex: '1' } },
        h('label', null, rl(j) + ' · ' + st.rn[j]), numInput(v, 0, 99, x => { st.avail[j] = x; invalidate(); renderDynamic(); })))));
      av.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'small muted' }, 'Rename resources:'), st.rn.map((r, j) => h('input', { type: 'text', value: r, style: { width: '130px' }, oninput: e => { st.rn[j] = e.target.value; } }))));
      renderDynamic(); renderRequest();
    }

    function renderDynamic() {
      // need column + validity refresh without rebuilding inputs
      const need = C.bankersNeed(st.max, st.alloc);
      matBox.querySelectorAll('tbody tr').forEach((tr, i) => {
        const tds = tr.querySelectorAll('td.need');
        tds.forEach((td, j) => { td.textContent = need[i][j]; td.classList.toggle('cell-bad', need[i][j] < 0); });
        tr.classList.toggle('bad', st.max[i].some((v, j) => v < st.alloc[i][j]));
        tr.classList.toggle('hl', i === hlRow);
        tr.classList.toggle('done', doneSet.has(i));
        tr.classList.toggle('bad', failSet.has(i) || st.max[i].some((v, j) => v < st.alloc[i][j]));
      });
      // totals line
      clear(workBox);
      const w = trace && ti > 0 ? trace.checks[ti - 1] : null;
      let cur = trace && ti > 0 ? currentWork() : st.avail;
      cur.forEach((v, j) => workBox.append(h('div', { class: 'kpi', style: { minWidth: '74px', textAlign: 'center' } }, h('b', null, v), h('span', null, rl(j)))));
      clear(seqBox);
      const seq = trace ? trace.sequence.filter(i => doneSet.has(i)) : [];
      if (!seq.length) seqBox.append(h('span', { class: 'small faint' }, 'none yet'));
      seq.forEach(i => seqBox.append(h('span', { class: 'pchip', style: { background: UI.pcolor(i) } }, st.pn[i])));
    }

    function currentWork() {
      let work = st.avail.slice();
      for (let q = 0; q < ti; q++) { const c = trace.checks[q]; if (c.ok) work = work.map((v, j) => v + st.alloc[c.process][j]); }
      return work;
    }

    /* ---------------- safety animation ---------------- */
    function validate() {
      const errs = C.bankersValidate(st.avail, st.alloc, st.max);
      if (errs.length) { clear(verdict); verdict.append(h('div', { class: 'banner bad' }, '⚠ ' + errs[0] + (errs.length > 1 ? ` (+${errs.length - 1} more)` : ''))); return false; }
      return true;
    }
    function begin() {
      if (!validate()) return false;
      trace = C.bankersSafety(st.avail, st.alloc, st.max); ti = 0; hlRow = -1; doneSet = new Set(); failSet = new Set();
      clear(stepsBox); clear(verdict);
      return true;
    }
    function tick() {
      if (!trace || ti >= trace.checks.length) { if (!begin()) return false; }
      const c = trace.checks[ti];
      ti++;
      hlRow = c.process;
      const nm = st.pn[c.process];
      const v = (a) => '(' + a.join(', ') + ')';
      if (c.ok) {
        doneSet.add(c.process); failSet.delete(c.process);
        const after = currentWork();
        stepsBox.prepend(h('div', { class: 'admit' }, h('b', null, nm), ` Need ${v(c.need)} ≤ Work ${v(c.work)} ✓ → runs to completion, releases Alloc → Work = ${v(after)}`));
      } else {
        stepsBox.prepend(h('div', { class: 'buffer' }, h('b', null, nm), ` Need ${v(c.need)} ≤ Work ${v(c.work)} ✗ → must wait`));
      }
      if (ti >= trace.checks.length) {
        hlRow = -1;
        clear(verdict);
        if (trace.safe) verdict.append(h('div', { class: 'banner good' }, '✔ SAFE STATE — safe sequence: ' + trace.sequence.map(i => st.pn[i]).join(' → ')));
        else { trace.stuck.forEach(i => failSet.add(i)); verdict.append(h('div', { class: 'banner bad' }, '✘ UNSAFE STATE — no process in {' + trace.stuck.map(i => st.pn[i]).join(', ') + '} can be guaranteed to finish (possible deadlock).')); }
        renderDynamic();
        return false;
      }
      renderDynamic();
      return true;
    }
    function runAll() {
      player.pause();
      if (!begin()) return;
      while (tick() !== false) { /* run to end */ }
    }

    /* ---------------- resource request ---------------- */
    function renderRequest() {
      clear(reqBox);
      const sel = h('select', null, st.pn.map((p, i) => h('option', { value: i }, p)));
      const inputs = st.avail.map((_, j) => h('div', { class: 'field', style: { marginBottom: 0 } }, h('label', null, rl(j)), h('input', { type: 'number', min: 0, value: 0, 'data-j': j })));
      const out = h('div', { style: { marginTop: '10px' } });
      const read = () => inputs.map(f => Math.max(0, parseInt(f.querySelector('input').value, 10) || 0));
      reqBox.append(h('div', { class: 'field' }, h('label', null, 'Process'), sel),
        h('div', { class: 'row', style: { alignItems: 'flex-end', flexWrap: 'nowrap' } }, inputs),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn primary', onclick: () => {
            if (!validate()) return;
            const i = +sel.value, req = read();
            const r = C.bankersRequest(st.avail, st.alloc, st.max, i, req);
            reqResult = { i, req, r };
            clear(out);
            const need = C.bankersNeed(st.max, st.alloc)[i];
            const v = a => '(' + a.join(', ') + ')';
            const line = (ok, txt) => h('div', { class: 'small', style: { color: ok ? 'var(--good)' : 'var(--bad)', fontWeight: 700 } }, (ok ? '✓ ' : '✗ ') + txt);
            out.append(line(r.reason !== 'exceeds-need', `Request ${v(req)} ≤ Need ${v(need)}`));
            if (r.reason !== 'exceeds-need') out.append(line(r.reason !== 'unavailable', `Request ≤ Available ${v(st.avail)}`));
            if (r.reason === 'safe' || r.reason === 'unsafe') {
              out.append(line(r.safety.safe, 'Pretend-allocate → safety algorithm says ' + (r.safety.safe ? 'SAFE: ' + r.safety.sequence.map(k => st.pn[k]).join(' → ') : 'UNSAFE')));
            }
            const msg = { safe: ['good', '✔ GRANTED — state remains safe.'], unsafe: ['bad', '✘ DENIED — granting would leave an unsafe state; process must wait.'], unavailable: ['warn', '⏳ Must wait — resources not currently available.'], 'exceeds-need': ['bad', '✘ ERROR — process exceeded its declared maximum claim.'] }[r.reason];
            out.append(h('div', { class: 'banner ' + (msg[0] === 'warn' ? 'info' : msg[0]), style: { marginTop: '8px' } }, msg[1]));
            if (r.granted) out.append(h('button', { class: 'btn good', style: { marginTop: '8px' }, onclick: () => { st.alloc = r.newAlloc; st.avail = r.newAvailable; invalidate(); renderAll(); toast('Request applied to the matrices'); } }, 'Apply grant to matrices'));
          } }, 'Test request')),
        out);
    }

    renderAll();
    return { onHide() { player.pause(); } };
  }

  UI.modules.bankers = { init };
})();
