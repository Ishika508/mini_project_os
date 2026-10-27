# User Guide

Open `index.html`. The top bar switches between modules; the sun/moon button toggles light and dark themes.
Every module has the same control bar: **Play/Pause**, **Step** (advance one unit), **Reset**, and a **Speed** slider.

## Overview
Problem statement, the pipeline diagram and shortcuts to each module.

## Live City (integrated simulation)
* **Canvas** – cars queue at the stop lines (badge shows queue length), signals change, loop detectors flash when they produce a packet, and packets fly to the Traffic Control Centre. Red/blue flashing cars are emergency vehicles.
* **KPI strip** – average car wait, cars passed, longest queue, emergency wait, tasks completed, CPU utilization, sensor blocked-ticks, Banker's denials.
* **Right-hand panels** – ① buffer / semaphores / producers / consumers, ② ready queue, admission queue and CPU Gantt strip, ③ memory map and fragmentation, ④ Banker's matrices, safe sequence, grants and denials.
* **Control panel** – all sliders act immediately. Items marked *(restarts)* rebuild the simulation: memory size, buffer slots, consumer threads.
* **Scenario presets** – Normal day · Rush hour · Emergency vehicles · Sensor storm · Memory starved.

Suggested experiments
1. *Scheduling matters:* choose **Emergency vehicles**, run 60 s with **Priority (preemptive)**, note "Emergency wait"; switch to **FCFS** and compare.
2. *Back-pressure:* choose **Sensor storm** — producers turn red/blocked when `empty = 0`.
3. *Memory:* choose **Memory starved**, compare First vs Best vs Worst fit (log shows "no hole" events), then press **Compact now**.
4. *Banker's:* raise consumer threads to 6 — see "Denied: unsafe" events as camera tasks compete for the two decoders.
5. *Adaptive vs fixed:* toggle adaptive signals with heavy one-sided traffic.

## CPU Scheduling
Edit the task table (arrival, burst, priority; lower number = higher priority), choose an algorithm (and quantum for Round Robin) and press Play. The Gantt chart grows tick by tick, the ready queue updates, and the result table fills as tasks finish. **Run comparison** executes all algorithms on the same tasks and highlights the lowest average waiting time.
Definitions: CT = completion, TAT = CT − AT, WT = TAT − BT, RT = first run − AT.

## Producer–Consumer
Choose buffer size, number of producers/consumers and relative speeds. Each step runs **one instruction** of one random runnable thread. Watch the semaphore counters, the `in`/`out` pointers, blocked threads and the highlighted source line.
Switch on **Wrong lock order** to take `mutex` before `empty/full`; the simulation reaches a genuine deadlock and shows the banner.

## Banker's Algorithm
Edit Allocation, Max and Available (or load an example). Need is computed live. Press Play/Step to watch the safety algorithm test each process, update the Work vector and build the safe sequence, or **Instant result**. Use **Resource request** to test a request: it checks Request ≤ Need, Request ≤ Available, pretends to allocate, and grants only if the state is safe. A granted request can be applied to the matrices.

## Memory
Pick **Variable** or **Fixed** partitions and **First / Best / Worst Fit**. Edit memory size or partition sizes and the request list; Step/Play allocates requests in order. Click an allocated block to free it; **Compact** merges holes (variable); **Retry failed** re-queues failed requests. **Run comparison** evaluates all three strategies on the same inputs.
Classic check: partitions 100/500/200/300/600 with requests 212/417/112/426 — First Fit cannot place 426 KB, Best Fit places all four.
