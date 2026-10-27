# Architecture & Algorithms

## Design principles
* **Algorithms are separate from the UI.** `js/core.js` has no DOM access; it runs in the browser and in Node, so the same code that animates the screen is unit-tested.
* **Deterministic.** Random choices come from a seeded PRNG (mulberry32), so any run can be reproduced.
* **One engine, many views.** The standalone CPU module and the integrated Live City both use the same `Scheduler`; the standalone and integrated memory/Banker's code use the same `VarMemory` and `bankers*` functions.
* **No dependencies, no build.** Plain scripts, CSS variables for theming, `<canvas>` for the intersection.

## 1. CPU scheduling — `Scheduler`, `simulateCPU`
Tick-driven (1 time unit). Each tick: arrivals are added to `ready`; the policy picks a task; it runs one unit.

| Policy | Selection key (min wins) | Preemptive |
|---|---|---|
| FCFS | (arrival, order) | no |
| SJF | (burst, arrival, order) | no |
| SRTF | (remaining, arrival, order); current kept on ties | yes |
| Priority | (priority, arrival, order) | NP / P |
| Round Robin | first eligible in queue; after `q` units the task moves to the back **after** new arrivals | yes |

Metrics: `CT`, `TAT = CT − AT`, `WT = TAT − BT`, `RT = start − AT`, utilization = busy ticks / total, throughput = n / total, context switches = changes of running task.
Tasks flagged `blocked` (waiting for a Banker's grant) are ignored by the picker — used by the Live City.

## 2. Producer–Consumer — `PCSim`
Semaphores `empty = N`, `full = 0`, `mutex = 1`, each with a FIFO wait queue. A signal on a semaphore with waiters hands the permit directly to the first waiter. Threads are small state machines (program counter over six operations). One `step()` executes one operation of one runnable thread chosen by a weighted seeded random draw. If no thread is runnable the simulator reports **deadlock**. With *wrong lock order* the operations become `wait(mutex)` before `wait(empty|full)`.

Invariants tested: `0 ≤ count ≤ N`, `produced − consumed − in-flight = count`, FIFO delivery.

## 3. Banker's algorithm — `bankersSafety`, `bankersRequest`
```
Need = Max − Allocation
Work = Available;  Finish[i] = false
repeat: find i with !Finish[i] and Need[i] ≤ Work
           Work += Allocation[i];  Finish[i] = true;  append i to sequence
until no such i
safe  ⇔  all Finish[i]
```
`bankersRequest(i, Req)`: reject if `Req > Need[i]`; wait if `Req > Available`; otherwise allocate tentatively and grant only if `bankersSafety` is safe. `safety.checks` records every test for the step-by-step animation.

## 4. Memory — `VarMemory`, `FixedMemory`
* `VarMemory`: ordered list of segments `{start,size,owner|null}`; allocation splits a hole, free coalesces neighbours, `compact()` slides allocations to address 0. External fragmentation = free − largest hole.
* `FixedMemory`: fixed blocks; one process per block; internal fragmentation = block size − process size.
* Placement: `pickHole` implements First (first fit), Best (smallest sufficient), Worst (largest).

## 5. Integration — `TrafficSim.step()` (1 simulated second)
1. Cars arrive (per-approach probability; some are emergency vehicles).
2. Signal controller advances (fixed or adaptive green time from *analysed* counts; emergency preemption / extension).
3. Departures on green.
4. **Producers** (4 loop detectors + camera) create packets; insert if buffer not full, else block holding the packet.
5. **Consumers**: each idle thread removes a packet and creates a task (kind, burst, priority, memory need and a two-stage resource claim depend on the packet).
6. **Admission** (priority order): memory allocation by the chosen fit, then Banker's request for stage-1 resources; failure releases the memory and the task waits.
7. Blocked tasks retry their stage-2 request.
8. **CPU** runs one tick; after half its burst a task requests stage-2 resources — if denied it blocks (hold-and-wait, but never deadlock).
9. Completion releases memory/resources and updates the controller's knowledge; `safety` is recomputed.

Tested invariants over 3 000 ticks × 6 algorithms × 3 fits: buffer never overflows, memory never over-allocated, `available + Σ allocation = total`, and the Banker's state is **always safe**.

## Files
See the layout table in `README.md`.
