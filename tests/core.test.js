/* Run with:  node tests/core.test.js   (no dependencies) */
'use strict';
const assert = require('assert');
const C = require('../js/core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}
const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

console.log('CPU scheduling');
// Classic textbook set: P1(0,8) P2(1,4) P3(2,9) P4(3,5)
const classic = [
  { id: 'P1', arrival: 0, burst: 8, priority: 3 },
  { id: 'P2', arrival: 1, burst: 4, priority: 1 },
  { id: 'P3', arrival: 2, burst: 9, priority: 4 },
  { id: 'P4', arrival: 3, burst: 5, priority: 2 },
];
test('FCFS avg waiting time = 8.75', () => approx(C.simulateCPU(classic, 'FCFS').avg.wt, 8.75));
test('SJF avg waiting time = 7.75', () => approx(C.simulateCPU(classic, 'SJF').avg.wt, 7.75));
test('SRTF avg waiting time = 6.5', () => approx(C.simulateCPU(classic, 'SRTF').avg.wt, 6.5));
test('Round Robin q=3 completes all, total busy = sum of bursts', () => {
  const r = C.simulateCPU(classic, 'RR', 3);
  assert.strictEqual(r.ticks.filter(k => k.run).length, 26);
  r.rows.forEach(x => assert.strictEqual(x.tat - x.wt, x.burst));
});
test('Priority (non-preemptive) picks lowest number after P1', () => {
  const r = C.simulateCPU(classic, 'PRIO_NP');
  assert.deepStrictEqual(r.gantt.map(g => g.id), ['P1', 'P2', 'P4', 'P3']);
});
test('Idle gap is handled', () => {
  const r = C.simulateCPU([{ id: 'A', arrival: 3, burst: 2 }], 'FCFS');
  assert.deepStrictEqual(r.gantt.map(g => g.id), [null, 'A']);
  approx(r.util, 2 / 5);
});
test('TAT = CT - AT and WT = TAT - BT for every algorithm', () => {
  for (const a of Object.keys(C.CPU_ALGOS)) {
    const r = C.simulateCPU(classic, a, 2);
    r.rows.forEach(x => { assert.strictEqual(x.tat, x.ct - x.arrival); assert.strictEqual(x.wt, x.tat - x.burst); assert.ok(x.wt >= 0); });
  }
});

console.log("Banker's algorithm");
const alloc = [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]];
const max = [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]];
const avail = [3, 3, 2];
test('Need matrix', () => assert.deepStrictEqual(C.bankersNeed(max, alloc), [[7, 4, 3], [1, 2, 2], [6, 0, 0], [0, 1, 1], [4, 3, 1]]));
test('Safe sequence P1,P3,P4,P0,P2', () => {
  const s = C.bankersSafety(avail, alloc, max);
  assert.ok(s.safe); assert.deepStrictEqual(s.sequence, [1, 3, 4, 0, 2]);
});
test('Request P1 (1,0,2) is granted', () => assert.ok(C.bankersRequest(avail, alloc, max, 1, [1, 0, 2]).granted));
// state after P1's request (1,0,2) was granted
const a1 = [2, 3, 0], al1 = alloc.map(r => r.slice()); al1[1] = [3, 0, 2];
test('Request P0 (0,2,0) is denied as unsafe', () => assert.strictEqual(C.bankersRequest(a1, al1, max, 0, [0, 2, 0]).reason, 'unsafe'));
test('Request above Need is rejected', () => assert.strictEqual(C.bankersRequest(avail, alloc, max, 1, [2, 0, 0]).reason, 'exceeds-need'));
test('Request above Available waits', () => assert.strictEqual(C.bankersRequest(a1, al1, max, 4, [3, 3, 0]).reason, 'unavailable'));
test('Unsafe state detected', () => {
  const s = C.bankersSafety([0, 0], [[1, 0], [0, 1]], [[2, 1], [1, 2]]);
  assert.ok(!s.safe); assert.deepStrictEqual(s.stuck, [0, 1]);
});

console.log('Memory management');
const reqs = [{ name: 'A', size: 212 }, { name: 'B', size: 417 }, { name: 'C', size: 112 }, { name: 'D', size: 426 }];
test('Fixed partitions 100,500,200,300,600 — First Fit leaves D unplaced', () => {
  const r = C.compareFits('fixed', { blocks: [100, 500, 200, 300, 600] }, reqs)[0];
  assert.deepStrictEqual(r.failed, ['D']);
});
test('Fixed partitions — Best Fit places all four', () => {
  const r = C.compareFits('fixed', { blocks: [100, 500, 200, 300, 600] }, reqs)[1];
  assert.deepStrictEqual(r.failed, []);
  assert.strictEqual(r.stats.internal, 88 + 83 + 88 + 174);
});
test('Variable: split, free, coalesce', () => {
  const m = new C.VarMemory(1000);
  m.alloc('A', 300, 'first'); m.alloc('B', 200, 'first'); m.alloc('C', 100, 'first');
  m.free('A'); m.free('C');
  assert.deepStrictEqual(m.segs.map(s => [s.start, s.size, s.owner]), [[0, 300, null], [300, 200, 'B'], [500, 500, null]]);
  m.free('B');
  assert.deepStrictEqual(m.segs.map(s => [s.start, s.size, s.owner]), [[0, 1000, null]]);
});
test('Variable: external fragmentation and compaction', () => {
  const m = new C.VarMemory(1000);
  ['A', 'B', 'C', 'D'].forEach(n => m.alloc(n, 200, 'first'));
  m.free('A'); m.free('C');
  const s = m.stats();
  assert.strictEqual(s.free, 600); assert.strictEqual(s.largest, 200); assert.strictEqual(s.external, 400);
  m.compact(); assert.strictEqual(m.stats().external, 0); assert.strictEqual(m.stats().largest, 600);
});
test('Variable: best fit chooses smallest hole, worst fit largest', () => {
  const mk = () => { const m = new C.VarMemory(1000); ['A', 'B', 'C', 'D', 'E'].forEach((n, i) => m.alloc(n, [100, 200, 50, 300, 100][i], 'first')); m.free('A'); m.free('C'); return m; };
  const b = mk(); assert.strictEqual(b.alloc('X', 40, 'best').start, 300);
  const w = mk(); assert.strictEqual(w.alloc('X', 40, 'worst').start, 750);
  const f = mk(); assert.strictEqual(f.alloc('X', 40, 'first').start, 0);
});
test('Compaction merges all holes', () => {
  const m = new C.VarMemory(500);
  ['A', 'B', 'C'].forEach(n => m.alloc(n, 100, 'first')); m.free('B'); m.compact();
  assert.strictEqual(m.stats().largest, 300); assert.strictEqual(m.stats().external, 0);
});

console.log('Producer–Consumer');
test('Correct order: invariants hold for 5000 steps, never deadlocks', () => {
  const s = new C.PCSim({ bufferSize: 4, producers: 3, consumers: 2, seed: 3 });
  for (let i = 0; i < 5000; i++) {
    const r = s.step(); assert.ok(!r.deadlock);
    assert.ok(s.count >= 0 && s.count <= 4);
    assert.strictEqual(s.stats.produced - s.stats.consumed - (s.actors.filter(a => a.type === 'C' && a.item).length), s.count);
    assert.strictEqual(s.sem.empty.v + s.count - s.sem.empty.q.length * 0, s.sem.empty.v + s.count);
  }
  assert.ok(s.stats.produced > 100 && s.stats.consumed > 100);
});
test('Wrong lock order deadlocks (demo)', () => {
  let dead = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = new C.PCSim({ bufferSize: 2, producers: 2, consumers: 2, seed, unsafe: true });
    for (let i = 0; i < 2000 && !s.deadlock; i++) s.step();
    if (s.deadlock) dead++;
  }
  assert.ok(dead >= 15, 'deadlocked only ' + dead + '/20');
});
test('Items consumed in FIFO order', () => {
  const s = new C.PCSim({ bufferSize: 3, producers: 1, consumers: 1, seed: 1 });
  const got = [];
  for (let i = 0; i < 400; i++) { const r = s.step(); if (r.op === 'consume') got.push(+r.note.split('#')[1]); }
  got.forEach((v, i) => assert.strictEqual(v, i + 1));
});

console.log('Integrated TrafficSim');
test('All invariants hold over 3000 ticks, every algorithm / fit', () => {
  for (const algo of Object.keys(C.CPU_ALGOS)) for (const fit of ['first', 'best', 'worst']) {
    const s = new C.TrafficSim({ algo, fit, arrival: 0.45, seed: 11, memTotal: 512 });
    for (let i = 0; i < 3000; i++) {
      s.step();
      assert.ok(s.buffer.length <= s.o.bufferSize, 'buffer overflow');
      const st = s.mem.stats(); assert.ok(st.used <= st.total);
      assert.ok(s.safety.safe, `unsafe state at t=${s.t} (${algo}/${fit})`);
      const tot = s.o.resTotal.map((v, j) => s.available[j] + s.active.reduce((a, x) => a + x.alloc[j], 0));
      assert.deepStrictEqual(tot, s.o.resTotal);
      assert.ok(s.available.every(v => v >= 0));
    }
    assert.ok(s.stats.done > 50, `${algo}/${fit} only completed ${s.stats.done}`);
  }
});
test('Banker\'s actually denies unsafe requests under load', () => {
  const s = new C.TrafficSim({ arrival: 0.5, seed: 5 });
  for (let i = 0; i < 2000; i++) s.step();
  assert.ok(s.stats.unsafeDenials > 0, 'no unsafe denials seen');
});
test('Deterministic for a given seed', () => {
  const a = new C.TrafficSim({ seed: 9 }), b = new C.TrafficSim({ seed: 9 });
  for (let i = 0; i < 500; i++) { a.step(); b.step(); }
  assert.strictEqual(JSON.stringify(a.stats), JSON.stringify(b.stats));
});

console.log(`\n${passed} tests passed` + (process.exitCode ? ' — FAILURES above' : ''));
