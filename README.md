# TrafficOS — OS Algorithm Visualizer

**Problem 3: Smart Traffic Management System**
Operating Systems · Assignment No. 3 & Practical No. 9 (Mini-Project) · 5th Sem, Section B · Subject teacher: Dr. Pallavi Wankhede

| | |
|---|---|
| **Student** | Ishika Burde |
| **UID** | 24003146 |
| **Batch** | B1 |
| **Submission** | Individual |

An interactive, animated simulator that demonstrates **all four required OS concepts** inside one shared scenario — a city intersection controlled by sensors, cameras and analytics tasks.

| # | Concept | Module | What you can do |
|---|---------|--------|-----------------|
| 1 | CPU Scheduling | **CPU Scheduling** tab | FCFS, SJF, SRTF, Priority (NP/P), Round Robin; edit tasks; animated Gantt chart; WT / TAT / RT, utilization, context switches; compare all algorithms |
| 2 | Process Synchronization (Producer–Consumer) | **Producer–Consumer** tab | Bounded buffer with `empty`, `full`, `mutex` semaphores; one instruction per step; blocking & wake-ups; wrong-lock-order switch that really deadlocks |
| 3 | Deadlock Avoidance | **Banker's** tab | Editable Allocation / Max / Available; Need matrix; step-by-step safety algorithm; safe sequence; resource-request test with grant/deny |
| 4 | Memory Management | **Memory** tab | Fixed and variable partitions; First / Best / Worst Fit; click-to-free; compaction; internal & external fragmentation; side-by-side strategy comparison |
| ★ | Integration | **Live City** tab | A running intersection where all four mechanisms drive each other (see below) |

Plus an **Overview** page and a **Theory** tab explaining each topic and how they connect.

## Run it

No build step and no dependencies.

* **Easiest:** double-click `index.html` (works from `file://`).
* Or serve it: `npm start` (or `python3 -m http.server 8080`) and open <http://localhost:8080>.

Light and dark themes: use the sun/moon button (remembers your choice, follows your OS by default).

## Run the tests

```bash
npm test          # or: node tests/core.test.js
```
Pure Node, no packages. 26 tests cover every algorithm (textbook results are asserted, e.g. Banker's safe sequence P1,P3,P4,P0,P2; SRTF average waiting time 6.5) plus 3 000-tick invariant checks on the integrated simulation.

## How the four concepts work together (Live City)

```
sensors / camera ─▶ bounded buffer ─▶ consumer threads ─▶ admission ─▶ CPU scheduler ─▶ signal controller
   (producers)     (semaphores)        (create tasks)    memory fit +     (chosen algo)    (green times,
                                                         Banker's check                    emergency preempt)
```
1. Loop detectors on each approach and a camera **produce** data packets into a bounded buffer. When it is full they **block** (`wait(empty)`).
2. Idle analytics threads **consume** a packet and turn it into an OS task (emergency > sensor > camera priority).
3. The task needs a block of **memory** (First/Best/Worst Fit); if no hole fits it waits.
4. The task declares a maximum claim on *Comm Channel / Camera Decoder / Signal Link* and requests them in two stages; **Banker's algorithm** grants a request only if the system stays in a safe state.
5. Admitted tasks enter the ready queue and the **CPU scheduler** runs one per time unit; on completion they free memory/resources and update the signal controller (adaptive green times, emergency preemption).
6. Cars then move differently, sensors report different counts — a feedback loop. Slow scheduling or blocked sensors visibly increase car waiting time.

Scenario presets (Normal day, Rush hour, Emergency vehicles, Sensor storm, Memory starved) set up situations that stress each mechanism.

## Project layout

```
index.html            page shell, overview and theory content
css/style.css         light/dark design tokens, components, animations
js/core.js            ALL algorithms — pure, DOM-free, unit-tested (browser + Node)
js/common.js          DOM helper, playback controller, widgets
js/mod-cpu.js         CPU scheduling UI
js/mod-pc.js          Producer–Consumer UI
js/mod-bankers.js     Banker's algorithm UI
js/mod-memory.js      Memory management UI
js/mod-live.js        Integrated Live City UI (canvas + panels)
js/app.js             tab routing and theme toggle
tests/core.test.js    unit and invariant tests
docs/USER_GUIDE.md    how to use every screen
docs/ARCHITECTURE.md  design, algorithms and data structures
```

## Documentation

* [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — screen-by-screen usage and suggested experiments
* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — algorithms, pseudocode, data structures, design decisions

## Publishing to GitHub (submission step)

```bash
git init && git add . && git commit -m "TrafficOS: OS Algorithm Visualizer (Smart Traffic Management System)"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```
Optional: enable **Settings → Pages → Deploy from branch → main / root** to get a live link. Copy the repository URL into the Google Form.

## Browser support
Any current Chrome, Edge, Firefox or Safari. Uses plain JavaScript (ES2018), CSS variables and `<canvas>`; no external requests.
