/* =====================================================================
 * TrafficOS core — pure algorithm engines (no DOM).
 * Works in the browser (window.OSCore) and in Node (require) for tests.
 *
 *   1. Scheduler / simulateCPU   – CPU scheduling (FCFS, SJF, SRTF, Priority, RR)
 *   2. PCSim                     – Producer–Consumer with semaphores
 *   3. bankers*                  – Banker's deadlock-avoidance algorithm
 *   4. VarMemory / FixedMemory   – First / Best / Worst Fit memory allocation
 *   5. TrafficSim                – integrates 1-4 into the Smart Traffic scenario
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OSCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------ utilities ------------------------------ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

  /* ============================ 1. CPU SCHEDULING ========================= */
  const CPU_ALGOS = {
    FCFS:    { label: 'FCFS',                       preemptive: false },
    SJF:     { label: 'SJF (non-preemptive)',       preemptive: false },
    SRTF:    { label: 'SRTF (preemptive SJF)',      preemptive: true  },
    PRIO_NP: { label: 'Priority (non-preemptive)',  preemptive: false },
    PRIO_P:  { label: 'Priority (preemptive)',      preemptive: true  },
    RR:      { label: 'Round Robin',                preemptive: true  },
  };

  function cmpKey(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }

  /** Tick-driven scheduler. Caller adds arrivals for time t, then calls tick(t). */
  class Scheduler {
    constructor(algo, quantum) {
      this.algo = CPU_ALGOS[algo] ? algo : 'FCFS';
      this.quantum = Math.max(1, quantum | 0 || 1);
      this.ready = [];      // every admitted, unfinished task (incl. the running one)
      this.current = null;
      this.slice = 0;
      this.requeue = null;  // RR: preempted task moves to the back at the next tick
      this.lastRun = null;
      this.switches = 0;
      this.order = 0;
    }
    get preemptive() { return CPU_ALGOS[this.algo].preemptive; }
    add(task) {
      if (task.remaining == null) task.remaining = task.burst;
      task.start = null; task.finish = null; task.executed = 0;
      task._ord = this.order++;
      this.ready.push(task);
    }
    _key(t) {
      switch (this.algo) {
        case 'SJF':     return [t.burst, t.arrival, t._ord];
        case 'SRTF':    return [t.remaining, t.arrival, t._ord];
        case 'PRIO_NP':
        case 'PRIO_P':  return [t.priority, t.arrival, t._ord];
        default:        return [t.arrival, t._ord];                 // FCFS
      }
    }
    _pick(cur) {
      const elig = this.ready.filter(x => !x.blocked);
      if (!elig.length) return null;
      if (this.algo === 'RR') return elig[0];
      let best = elig[0];
      for (const x of elig) if (cmpKey(this._key(x), this._key(best)) < 0) best = x;
      if (cur && elig.includes(cur) && cmpKey(this._key(cur), this._key(best)) <= 0) return cur;
      return best;
    }
    tick(t) {
      if (this.requeue) {
        const r = this.requeue; this.requeue = null;
        const i = this.ready.indexOf(r);
        if (i >= 0) { this.ready.splice(i, 1); this.ready.push(r); }
      }
      let cur = this.current;
      if (cur && cur.blocked) { cur = null; this.slice = 0; }
      if (!cur || this.preemptive) {
        const p = this._pick(cur);
        if (p !== cur) this.slice = 0;
        cur = p;
      }
      this.current = cur;
      let completed = null;
      if (cur) {
        if (cur.start == null) cur.start = t;
        if (this.lastRun && this.lastRun !== cur) this.switches++;
        this.lastRun = cur;
        cur.remaining--; cur.executed++; this.slice++;
        if (cur.remaining <= 0) {
          cur.finish = t + 1;
          this.ready.splice(this.ready.indexOf(cur), 1);
          completed = cur; this.current = null; this.slice = 0;
        } else if (this.algo === 'RR' && this.slice >= this.quantum) {
          this.requeue = cur; this.current = null; this.slice = 0;
        }
      }
      return { running: cur, completed };
    }
  }

  /** Offline run of a process set. procs: [{id,name,arrival,burst,priority}] */
  function simulateCPU(procs, algo, quantum) {
    const tasks = procs.map((p, i) => ({
      id: p.id != null ? String(p.id) : 'P' + (i + 1),
      name: p.name || p.id || 'P' + (i + 1),
      arrival: Math.max(0, +p.arrival || 0),
      burst: Math.max(1, Math.floor(+p.burst || 1)),
      priority: +p.priority || 0,
      idx: i,
    }));
    tasks.forEach(t => { t.remaining = t.burst; });
    const sch = new Scheduler(algo, quantum);
    const pending = tasks.slice().sort((a, b) => a.arrival - b.arrival || a.idx - b.idx);
    const ticks = [];
    let t = 0, pi = 0, done = 0, guard = 0;
    while (done < tasks.length && guard++ < 100000) {
      while (pi < pending.length && pending[pi].arrival <= t) sch.add(pending[pi++]);
      const r = sch.tick(t);
      ticks.push({
        t, run: r.running ? r.running.id : null,
        ready: sch.ready.filter(x => x !== r.running).map(x => x.id),
      });
      if (r.completed) done++;
      t++;
    }
    // merge ticks into Gantt segments
    const gantt = [];
    for (const k of ticks) {
      const last = gantt[gantt.length - 1];
      if (last && last.id === k.run) last.end = k.t + 1;
      else gantt.push({ id: k.run, start: k.t, end: k.t + 1 });
    }
    const rows = tasks.map(x => {
      const ct = x.finish, tat = ct - x.arrival, wt = tat - x.burst, rt = x.start - x.arrival;
      return { id: x.id, name: x.name, arrival: x.arrival, burst: x.burst, priority: x.priority, ct, tat, wt, rt };
    });
    const n = rows.length || 1;
    const total = ticks.length;
    const busy = ticks.filter(k => k.run).length;
    return {
      ticks, gantt, rows,
      avg: { wt: sum(rows.map(r => r.wt)) / n, tat: sum(rows.map(r => r.tat)) / n, rt: sum(rows.map(r => r.rt)) / n },
      total, util: total ? busy / total : 0, throughput: total ? rows.length / total : 0,
      switches: sch.switches,
    };
  }

  /* ======================= 2. PRODUCER–CONSUMER (semaphores) ============== */
  const PC_OPS = {
    P:  ['produce', 'wait(empty)', 'wait(mutex)', 'insert', 'signal(mutex)', 'signal(full)'],
    C:  ['wait(full)', 'wait(mutex)', 'remove', 'signal(mutex)', 'signal(empty)', 'consume'],
    Pu: ['produce', 'wait(mutex)', 'wait(empty)', 'insert', 'signal(mutex)', 'signal(full)'],  // wrong order
    Cu: ['wait(mutex)', 'wait(full)', 'remove', 'signal(mutex)', 'signal(empty)', 'consume'],  // wrong order
  };

  class PCSim {
    constructor(o) {
      this.o = Object.assign({ bufferSize: 5, producers: 2, consumers: 2, prodSpeed: 5, consSpeed: 5, seed: 7, unsafe: false }, o);
      const O = this.o;
      O.bufferSize = clamp(O.bufferSize | 0, 1, 16);
      this.rng = mulberry32(O.seed);
      const N = O.bufferSize;
      this.sem = { empty: { v: N, q: [] }, full: { v: 0, q: [] }, mutex: { v: 1, q: [] } };
      this.slots = Array(N).fill(null);
      this.in = 0; this.out = 0; this.count = 0;
      this.holder = null; this.deadlock = false; this.lastActor = null;
      this.stats = { produced: 0, consumed: 0, blocks: 0, maxCount: 0, steps: 0 };
      this.actors = [];
      for (let i = 0; i < clamp(O.producers | 0, 1, 6); i++) this.actors.push({ id: 'P' + (i + 1), type: 'P', pc: 0, blocked: null, item: null, n: 0 });
      for (let i = 0; i < clamp(O.consumers | 0, 1, 6); i++) this.actors.push({ id: 'C' + (i + 1), type: 'C', pc: 0, blocked: null, item: null, n: 0 });
    }
    ops(a) { return PC_OPS[a.type + (this.o.unsafe ? 'u' : '')]; }
    _wait(a, name) {
      const s = this.sem[name];
      if (s.v > 0) { s.v--; if (name === 'mutex') this.holder = a.id; a.pc++; return 'acquired'; }
      a.blocked = name; s.q.push(a); this.stats.blocks++;
      return 'blocked';
    }
    _signal(a, name) {
      const s = this.sem[name];
      if (s.q.length) {                       // hand the permit straight to a waiter
        const w = s.q.shift(); w.blocked = null; w.pc++;
        if (name === 'mutex') this.holder = w.id;
      } else { s.v++; if (name === 'mutex') this.holder = null; }
      a.pc++;
    }
    step() {
      const ready = this.actors.filter(a => !a.blocked);
      if (!ready.length) { this.deadlock = true; return { deadlock: true }; }
      const w = ready.map(a => (a.type === 'P' ? this.o.prodSpeed : this.o.consSpeed));
      let r = this.rng() * sum(w), a = ready[0];
      for (let i = 0; i < ready.length; i++) { r -= w[i]; if (r <= 0) { a = ready[i]; break; } }
      const op = this.ops(a)[a.pc];
      let note = '';
      switch (op) {
        case 'produce': a.n++; a.item = a.id + '#' + a.n; a.pc++; note = 'generated ' + a.item; break;
        case 'wait(empty)': case 'wait(mutex)': case 'wait(full)':
          note = this._wait(a, op.slice(5, -1)); break;
        case 'signal(empty)': case 'signal(mutex)': case 'signal(full)':
          this._signal(a, op.slice(7, -1)); break;
        case 'insert':
          this.slots[this.in] = { id: a.item, by: a.id };
          note = a.item + ' → slot ' + this.in;
          this.in = (this.in + 1) % this.slots.length; this.count++; this.stats.produced++;
          this.stats.maxCount = Math.max(this.stats.maxCount, this.count);
          a.item = null; a.pc++; break;
        case 'remove':
          a.item = this.slots[this.out].id;
          note = a.item + ' ← slot ' + this.out;
          this.slots[this.out] = null;
          this.out = (this.out + 1) % this.slots.length; this.count--; a.pc++; break;
        case 'consume': this.stats.consumed++; note = 'processed ' + a.item; a.item = null; a.pc++; break;
      }
      if (a.pc >= this.ops(a).length) a.pc = 0;
      this.stats.steps++;
      this.lastActor = a.id;
      return { actor: a.id, op, note };
    }
  }

  /* ============================ 3. BANKER'S ALGORITHM ===================== */
  function bankersNeed(max, alloc) { return max.map((r, i) => r.map((v, j) => v - alloc[i][j])); }

  function bankersValidate(available, alloc, max) {
    const errs = [];
    alloc.forEach((r, i) => r.forEach((v, j) => {
      if (!(v >= 0)) errs.push(`Allocation[P${i}][R${j}] must be ≥ 0`);
      if (max[i][j] < v) errs.push(`Max[P${i}][R${j}] (${max[i][j]}) < Allocation (${v})`);
    }));
    available.forEach((v, j) => { if (!(v >= 0)) errs.push(`Available[R${j}] must be ≥ 0`); });
    return errs;
  }

  function bankersSafety(available, alloc, max) {
    const n = alloc.length, m = available.length;
    const need = bankersNeed(max, alloc);
    const work = available.slice();
    const finish = Array(n).fill(false);
    const seq = [], steps = [], checks = [];
    let progress = true;
    while (seq.length < n && progress) {
      progress = false;
      for (let i = 0; i < n; i++) {
        if (finish[i]) continue;
        const ok = need[i].every((v, j) => v <= work[j]);
        checks.push({ process: i, ok, need: need[i].slice(), work: work.slice() });
        if (ok) {
          const before = work.slice();
          for (let j = 0; j < m; j++) work[j] += alloc[i][j];
          finish[i] = true; seq.push(i); progress = true;
          steps.push({ process: i, need: need[i].slice(), workBefore: before, workAfter: work.slice() });
        }
      }
    }
    return {
      safe: seq.length === n, sequence: seq, steps, checks, need, work,
      stuck: finish.map((f, i) => (f ? -1 : i)).filter(i => i >= 0),
    };
  }

  function bankersRequest(available, alloc, max, i, req) {
    const need = bankersNeed(max, alloc);
    if (req.some((v, j) => v > need[i][j])) return { granted: false, reason: 'exceeds-need' };
    if (req.some((v, j) => v > available[j])) return { granted: false, reason: 'unavailable' };
    const a2 = available.map((v, j) => v - req[j]);
    const al2 = alloc.map(r => r.slice());
    al2[i] = al2[i].map((v, j) => v + req[j]);
    const safety = bankersSafety(a2, al2, max);
    return { granted: safety.safe, reason: safety.safe ? 'safe' : 'unsafe', safety, newAvailable: a2, newAlloc: al2 };
  }

  /* ============================ 4. MEMORY MANAGEMENT ====================== */
  function pickHole(holes, size, fit) {
    let best = null;
    for (const h of holes) {
      if (h.size < size) continue;
      if (fit === 'first') return h;
      if (!best) best = h;
      else if (fit === 'best' && h.size < best.size) best = h;
      else if (fit === 'worst' && h.size > best.size) best = h;
    }
    return best;
  }

  /** Dynamic (variable) partitioning with hole splitting and coalescing. */
  class VarMemory {
    constructor(total) { this.total = total; this.segs = [{ start: 0, size: total, owner: null }]; }
    alloc(owner, size, fit) {
      if (!(size > 0)) return null;
      const h = pickHole(this.segs.filter(s => s.owner === null), size, fit);
      if (!h) return null;
      const i = this.segs.indexOf(h);
      const seg = { start: h.start, size, owner };
      if (h.size > size) this.segs.splice(i, 1, seg, { start: h.start + size, size: h.size - size, owner: null });
      else this.segs.splice(i, 1, seg);
      return seg;
    }
    free(owner) {
      let any = false;
      for (const s of this.segs) if (s.owner === owner) { s.owner = null; any = true; }
      if (!any) return false;
      for (let i = this.segs.length - 2; i >= 0; i--) {
        const a = this.segs[i], b = this.segs[i + 1];
        if (a.owner === null && b.owner === null) { a.size += b.size; this.segs.splice(i + 1, 1); }
      }
      return true;
    }
    compact() {
      const used = this.segs.filter(s => s.owner !== null);
      let p = 0;
      const out = used.map(s => { const n = { start: p, size: s.size, owner: s.owner }; p += s.size; return n; });
      if (p < this.total) out.push({ start: p, size: this.total - p, owner: null });
      this.segs = out;
    }
    stats() {
      const holes = this.segs.filter(s => s.owner === null);
      const used = sum(this.segs.filter(s => s.owner !== null).map(s => s.size));
      const free = this.total - used;
      const largest = holes.reduce((m, h) => Math.max(m, h.size), 0);
      return {
        total: this.total, used, free, holes: holes.length, largest,
        external: free - largest,                              // free but unusable for a request > largest
        extPct: free ? (1 - largest / free) * 100 : 0,
        internal: 0, util: this.total ? used / this.total : 0,
      };
    }
  }

  /** Fixed partitioning: each block hosts at most one process. */
  class FixedMemory {
    constructor(blocks) {
      let p = 0;
      this.segs = blocks.map(s => { const b = { start: p, size: s, owner: null, used: 0 }; p += s; return b; });
      this.total = p;
    }
    alloc(owner, size, fit) {
      if (!(size > 0)) return null;
      const h = pickHole(this.segs.filter(s => s.owner === null), size, fit);
      if (!h) return null;
      h.owner = owner; h.used = size;
      return h;
    }
    free(owner) {
      let any = false;
      for (const s of this.segs) if (s.owner === owner) { s.owner = null; s.used = 0; any = true; }
      return any;
    }
    compact() {}
    stats() {
      const occ = this.segs.filter(s => s.owner !== null);
      const freeB = this.segs.filter(s => s.owner === null);
      const used = sum(occ.map(s => s.used));
      const internal = sum(occ.map(s => s.size - s.used));
      const freeBlocks = sum(freeB.map(s => s.size));
      return {
        total: this.total, used, free: freeBlocks, holes: freeB.length,
        largest: freeB.reduce((m, h) => Math.max(m, h.size), 0),
        external: freeBlocks, extPct: 0, internal, util: this.total ? used / this.total : 0,
      };
    }
  }

  function makeMemory(mode, cfg) { return mode === 'fixed' ? new FixedMemory(cfg.blocks) : new VarMemory(cfg.total); }

  /** Run one request list through a fresh memory using every fit strategy. */
  function compareFits(mode, cfg, requests) {
    return ['first', 'best', 'worst'].map(fit => {
      const m = makeMemory(mode, cfg);
      const placed = [], failed = [];
      for (const r of requests) (m.alloc(r.name, r.size, fit) ? placed : failed).push(r.name);
      return { fit, placed, failed, stats: m.stats() };
    });
  }

  /* ===================== 5. INTEGRATED SMART-TRAFFIC SIMULATION ============ */
  const APPROACHES = ['N', 'S', 'E', 'W'];
  const PHASE_OF = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' };
  const RES_NAMES = ['Comm Channel', 'Camera Decoder', 'Signal Link'];
  const TASK_KINDS = {
    emergency: { label: 'Emergency preemption', short: 'EMG', burst: [1, 2], prio: 0, mem: [64, 96],   s1: [1, 0, 0], s2: [0, 0, 1] },
    sensor:    { label: 'Sensor analysis',      short: 'SEN', burst: [1, 2], prio: 2, mem: [64, 128],  s1: [1, 0, 0], s2: [1, 0, 1] },
    camera:    { label: 'Camera analytics',     short: 'CAM', burst: [3, 4], prio: 3, mem: [160, 288], s1: [1, 1, 0], s2: [1, 1, 1] },
  };

  class TrafficSim {
    constructor(opts) {
      this.o = Object.assign({
        arrival: 0.3, emergency: 0.04, sensorPeriod: 9, cameraPeriod: 12, bufferSize: 6, consumers: 4,
        algo: 'PRIO_P', quantum: 2, fit: 'first', memTotal: 640, adaptive: true, greenTime: 8, seed: 42,
        resTotal: [4, 2, 2],
      }, opts);
      this.reset();
    }
    reset() {
      const o = this.o;
      this.rng = mulberry32(o.seed);
      this.t = 0; this.carId = 0; this.pktId = 0; this.taskId = 0;
      this.queues = { N: [], S: [], E: [], W: [] };
      this.sig = { phase: 'NS', mode: 'green', timer: o.greenTime, extended: false };
      this.known = { N: 0, S: 0, E: 0, W: 0 };
      this.emReq = null;
      this.buffer = [];
      this.producers = [
        ...APPROACHES.map((a, i) => ({ id: 'S-' + a, kind: 'sensor', a, offset: i, pending: null, blocked: false, produced: 0 })),
        { id: 'CAM', kind: 'camera', a: null, offset: 3, pending: null, blocked: false, produced: 0 },
      ];
      this.threads = [];
      for (let i = 0; i < o.consumers; i++) this.threads.push({ id: 'C' + (i + 1), task: null });
      this.admit = [];             // tasks waiting for memory + safe resources
      this.active = [];            // admitted, unfinished tasks (registered with Banker's)
      this.available = o.resTotal.slice();
      this.mem = new VarMemory(o.memTotal);
      this.sch = new Scheduler(o.algo, o.quantum);
      this.ganttLog = [];          // {t, id, kind}
      this.log = [];
      this.stats = {
        arrived: 0, passed: 0, waitSum: 0, maxQueue: 0, emPassed: 0, emWaitSum: 0,
        packets: 0, consumed: 0, blockedTicks: 0, done: 0, tatSum: 0, busy: 0,
        grants: 0, unsafeDenials: 0, shortDenials: 0, memFails: 0, maxBuffer: 0,
      };
      this.safety = bankersSafety(this.available, [], []);
    }
    setAlgo(algo, quantum) {
      this.o.algo = algo; this.o.quantum = quantum;
      const old = this.sch;
      this.sch = new Scheduler(algo, quantum);
      this.sch.ready = old.ready; this.sch.current = old.current; this.sch.order = old.order;
      this.sch.lastRun = old.lastRun; this.sch.switches = old.switches;
    }
    _log(type, msg) { this.log.push({ t: this.t, type, msg }); if (this.log.length > 300) this.log.shift(); }

    /* ---- Banker's helpers over the dynamic set of active tasks ---- */
    _request(task, vec) {
      const alloc = this.active.map(x => x.alloc), max = this.active.map(x => x.max);
      const i = this.active.indexOf(task);
      const r = bankersRequest(this.available, alloc, max, i, vec);
      if (r.granted) {
        this.available = r.newAvailable;
        task.alloc = task.alloc.map((v, j) => v + vec[j]);
      }
      return r;
    }
    _refreshSafety() {
      this.safety = bankersSafety(this.available, this.active.map(x => x.alloc), this.active.map(x => x.max));
    }

    _greenFor(phase) {
      if (!this.o.adaptive) return this.o.greenTime;
      const d = APPROACHES.filter(a => PHASE_OF[a] === phase).reduce((s, a) => s + this.known[a], 0);
      return clamp(Math.round(3 + 1.5 * d), 4, 16);
    }

    _signal() {
      const s = this.sig;
      if (this.emReq) {
        const ph = PHASE_OF[this.emReq];
        if (s.phase === ph) {
          if (s.mode === 'green' && !s.extended) { s.timer += 4; s.extended = true; this._log('signal', `Emergency on ${this.emReq}: green extended`); }
        } else if (s.mode === 'green') {
          s.mode = 'yellow'; s.timer = 2; this._log('signal', `Emergency on ${this.emReq}: preempting ${s.phase} green`);
        }
        this.emReq = null;
      }
      s.timer--;
      if (s.timer <= 0) {
        if (s.mode === 'green') { s.mode = 'yellow'; s.timer = 2; }
        else {
          s.phase = s.phase === 'NS' ? 'EW' : 'NS'; s.mode = 'green'; s.extended = false;
          s.timer = this._greenFor(s.phase);
        }
      }
    }

    _makePacket(p) {
      const q = this.queues;
      const counts = {}, em = {};
      const list = p.kind === 'camera' ? APPROACHES : [p.a];
      for (const a of list) { counts[a] = q[a].length; em[a] = q[a].some(c => c.em); }
      return { id: ++this.pktId, src: p.id, kind: p.kind, counts, em, t: this.t };
    }

    _makeTask(pkt, thread) {
      const urgent = Object.values(pkt.em).some(Boolean);
      const kind = pkt.kind === 'camera' ? 'camera' : (urgent ? 'emergency' : 'sensor');
      const K = TASK_KINDS[kind];
      const rng = this.rng;
      const task = {
        id: 'T' + (++this.taskId), kind, pkt,
        name: K.short + '#' + this.taskId,
        arrival: this.t, burst: randInt(rng, K.burst[0], K.burst[1]),
        priority: kind === 'camera' && urgent ? 1 : K.prio,
        mem: randInt(rng, K.mem[0], K.mem[1]) , s1: K.s1, s2: K.s2,
        max: K.s1.map((v, j) => v + K.s2[j]), alloc: [0, 0, 0],
        stage: 0, blocked: false, thread: thread.id, wait: null,
      };
      task.remaining = task.burst;
      return task;
    }

    _release(task) {
      this.available = this.available.map((v, j) => v + task.alloc[j]);
      task.alloc = [0, 0, 0];
      this.active.splice(this.active.indexOf(task), 1);
      this.mem.free(task.id);
    }

    step() {
      const o = this.o, t = this.t, ev = [];

      /* 1 ── cars arrive */
      for (const a of APPROACHES) {
        if (this.rng() < o.arrival) {
          const car = { id: ++this.carId, arr: t, em: this.rng() < o.emergency };
          this.queues[a].push(car); this.stats.arrived++;
          ev.push({ type: 'arrive', a, car });
        }
        this.stats.maxQueue = Math.max(this.stats.maxQueue, this.queues[a].length);
      }

      /* 2 ── traffic signal + departures */
      this._signal();
      if (this.sig.mode === 'green') {
        for (const a of APPROACHES) {
          if (PHASE_OF[a] !== this.sig.phase || !this.queues[a].length) continue;
          const car = this.queues[a].shift();
          const w = t - car.arr;
          this.stats.passed++; this.stats.waitSum += w;
          if (car.em) { this.stats.emPassed++; this.stats.emWaitSum += w; }
          ev.push({ type: 'depart', a, car });
        }
      }

      /* 3 ── producers (sensors/camera) put packets in the bounded buffer */
      for (const p of this.producers) {
        let pkt = p.pending;
        if (!pkt) {
          const period = p.kind === 'camera' ? o.cameraPeriod : o.sensorPeriod;
          if ((t + p.offset) % period !== 0) { p.blocked = false; continue; }
          pkt = this._makePacket(p);
        }
        if (this.buffer.length < o.bufferSize) {
          this.buffer.push(pkt); p.pending = null; p.blocked = false; p.produced++;
          this.stats.packets++;
          this.stats.maxBuffer = Math.max(this.stats.maxBuffer, this.buffer.length);
          ev.push({ type: 'produce', src: p.id });
        } else {
          p.pending = pkt; p.blocked = true; this.stats.blockedTicks++;
          if (!p._logged) { this._log('buffer', `${p.id} BLOCKED — buffer full (wait(empty))`); p._logged = true; }
        }
        if (!p.blocked) p._logged = false;
      }

      /* 4 ── idle consumer threads take packets and create tasks */
      for (const th of this.threads) {
        if (th.task || !this.buffer.length) continue;
        const pkt = this.buffer.shift();
        const task = this._makeTask(pkt, th);
        th.task = task; this.admit.push(task); this.stats.consumed++;
        ev.push({ type: 'consume', thread: th.id, task });
        this._log('consume', `${th.id} took packet from ${pkt.src} → ${task.name} (burst ${task.burst}, ${task.mem} KB)`);
      }

      /* 5 ── admission: memory first, then Banker's safe-state check */
      this.admit.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival);
      for (const task of this.admit.slice()) {
        const seg = this.mem.alloc(task.id, task.mem, o.fit);
        if (!seg) {
          if (task.wait !== 'MEM') { this.stats.memFails++; this._log('memory', `${task.name}: no ${o.fit}-fit hole for ${task.mem} KB — waits`); }
          task.wait = 'MEM'; continue;
        }
        this.active.push(task);
        const r = this._request(task, task.s1);
        if (!r.granted) {
          this.active.pop(); this.mem.free(task.id);
          if (task.wait !== r.reason) { if (r.reason === 'unsafe') this.stats.unsafeDenials++; else this.stats.shortDenials++; }
          if (task.wait !== r.reason) this._log('banker', `${task.name}: request [${task.s1}] ${r.reason === 'unsafe' ? 'DENIED — would leave an UNSAFE state' : 'waits — resources busy'}`);
          task.wait = r.reason; continue;
        }
        this.stats.grants++;
        task.stage = 1; task.wait = null;
        this.admit.splice(this.admit.indexOf(task), 1);
        this.sch.add(task);
        this._log('admit', `${task.name} admitted: ${task.mem} KB @${seg.start}, holds [${task.alloc}]`);
      }

      /* 6 ── blocked tasks retry their second-stage request */
      for (const task of this.active) {
        if (!task.blocked) continue;
        const r = this._request(task, task.s2);
        if (r.granted) { task.blocked = false; task.stage = 2; this.stats.grants++; this._log('banker', `${task.name}: stage-2 [${task.s2}] granted — resumes`); }
      }

      /* 7 ── CPU runs one tick */
      const res = this.sch.tick(t);
      const run = res.running;
      this.ganttLog.push({ t, id: run ? run.name : null, kind: run ? run.kind : null });
      if (this.ganttLog.length > 400) this.ganttLog.shift();
      if (run) this.stats.busy++;
      if (run && !res.completed && run.stage === 1 && run.s2.some(v => v) && run.executed >= Math.ceil(run.burst / 2)) {
        const r = this._request(run, run.s2);
        if (r.granted) { run.stage = 2; this.stats.grants++; }
        else {
          run.blocked = true;
          if (r.reason === 'unsafe') this.stats.unsafeDenials++; else this.stats.shortDenials++;
          this._log('banker', `${run.name}: stage-2 [${run.s2}] ${r.reason === 'unsafe' ? 'DENIED (unsafe)' : 'waits (busy)'} — blocked`);
        }
      }
      if (res.completed) this._complete(res.completed);

      this._refreshSafety();
      this.t++;
      return ev;
    }

    _complete(task) {
      this._release(task);
      const th = this.threads.find(x => x.id === task.thread);
      if (th) th.task = null;
      this.stats.done++; this.stats.tatSum += (this.t + 1) - task.arrival;
      const p = task.pkt;
      for (const a of Object.keys(p.counts)) {
        this.known[a] = p.counts[a];
        if (p.em[a] && !this.emReq) this.emReq = a;
      }
      this._log('done', `${task.name} finished → signal controller updated${this.emReq ? ' (emergency on ' + this.emReq + ')' : ''}`);
    }
  }

  return {
    mulberry32, CPU_ALGOS, Scheduler, simulateCPU,
    PC_OPS, PCSim,
    bankersNeed, bankersValidate, bankersSafety, bankersRequest,
    VarMemory, FixedMemory, makeMemory, compareFits,
    APPROACHES, PHASE_OF, RES_NAMES, TASK_KINDS, TrafficSim,
  };
});
