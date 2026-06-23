# Fault-tolerant exchange + agent evaluation harness — design spec

A single-symbol limit-order-book exchange built in layers, where each layer is independently
resume-complete and each demonstrates a distinct competency: low-latency C++ (the matching
engine), systems networking (the feed handler), and one of either distributed systems (Raft
replication) or AI/agent evaluation (the agent harness). The layers compose into one coherent
system rather than a scattered portfolio.

The load-bearing principle throughout is **determinism**: a single-writer matching thread that
takes a logical sequence of orders and produces an identical event stream every time. That one
choice buys low latency, replayable benchmarks, a replicated state machine, and a seeded
evaluation environment — the same property pays off four times.

---

## 1. Goals and non-goals

### Goals
- A correct, deterministic price-time-priority matching engine in modern C++.
- Latency and throughput measured rigorously enough to survive a quant interviewer reading the
  benchmark code.
- A production-shaped feed handler that parses real NASDAQ ITCH data and a documented binary
  order-entry protocol.
- A top layer (chosen per target track) that turns a generic matching engine into something
  differentiated.
- A repository that survives a code read, not just a skim.

### Non-goals (explicit scope boundaries)
- Not a production exchange: no FIX certification, no real venue connectivity, no regulatory
  compliance, no durability guarantees beyond what the replication layer demonstrates.
- Not a trading strategy or alpha source. The agent harness evaluates *behavior*, it does not
  claim profitability.
- Single symbol first. Multi-symbol is a clean extension, not part of the core milestones.
- Bounded, discrete price range assumed (see §3.1). A sparse/unbounded price space is a noted
  fallback, not the default.

---

## 2. Architecture overview

```
  Market data in (UDP multicast, ITCH)         Order entry in (TCP, binary protocol)
              │                                              │
              ▼                                              ▼
   ┌─────────────────────┐                       ┌─────────────────────┐
   │  Feed handler (C++)  │                       │  Gateway / IO threads │
   │  ITCH parse, gap     │                       │  parse, validate      │
   │  recovery, io_uring  │                       └──────────┬──────────┘
   └──────────┬──────────┘                                   │
              │   (replay drive / load)                      │
              └───────────────┬──────────────────────────────┘
                              ▼
                   lock-free MPSC ring buffer
                              ▼
              ┌──────────────────────────────┐
              │  Matching engine (C++)        │
              │  single-writer, price-time    │
              │  priority, deterministic       │
              └──────────────┬───────────────┘
                             ▼
                  lock-free ring (outbound)
                             ▼
              ┌──────────────────────────────┐
              │  Publisher threads            │
              │  fills, acks, market data out │
              └──────────────────────────────┘

  Top layer (choose one):
   • Raft replication (Go)  — wraps the engine as a replicated state machine
   • Agent harness (Python) — Gym + MCP adapters over the same observe/act/reward interface
```

Threads communicate only through lock-free ring buffers. The matching thread never blocks,
never allocates on the hot path, and never reads a wall clock for matching logic — it advances
on logical sequence numbers.

---

## 3. Layer 1 — matching engine (C++)

The quant-facing core. This is the milestone that, on its own, trips the C++-gated quant filter.

### 3.1 Order book data structure

Price space is discrete (ticks) and, for a single liquid symbol, effectively bounded around the
current price. Exploit that:

- **Two arrays of price levels**, one for bids and one for asks, indexed by tick offset from a
  base price. Array indexing gives O(1) access to any price level and strong cache locality —
  preferred over a balanced BST, which costs O(log n) and pointer-chases across cache lines.
- **Each price level is an intrusive doubly-linked FIFO** of resting orders, preserving
  time priority within a price.
- **Best-bid / best-ask tracked incrementally** (cached index updated on insert/remove), so
  top-of-book is O(1), not a scan.
- **`order_id → Order*` hash map** for O(1) cancel and modify — the map points directly at the
  intrusive node so removal is pointer surgery, no search.

```cpp
struct Order {
    uint64_t id;
    uint64_t seq;          // logical arrival sequence (determinism, time priority)
    uint32_t price_ticks;
    uint32_t qty;
    uint16_t agent_id;
    Side     side;
    OrderType type;
    Order*   prev;         // intrusive list within a price level
    Order*   next;
};

struct PriceLevel {
    uint32_t total_qty;    // cached for fast L2 snapshots
    Order*   head;         // FIFO front (oldest, highest time priority)
    Order*   tail;
};
```

**Fallback for unbounded ranges:** if the price range can't be bounded, replace the flat array
with a hash map of active price levels plus a separate sorted structure (or a radix/van-Emde-Boas
layout) over occupied prices only. Note the tradeoff in `DESIGN.md`; don't pretend the flat array
is universal — interviewers will probe this.

### 3.2 Matching semantics

On an aggressive order, walk the opposite book from the best price inward, filling against each
level's FIFO until the order is exhausted or the price no longer crosses. Emit a fill event per
match. Handle remainder per order type.

Order types for the core milestone: **limit, market, IOC (immediate-or-cancel), FOK
(fill-or-kill)**. Post-only and self-trade prevention are optional extensions worth a sentence
each in the design doc.

### 3.3 Threading and concurrency

- **Single matching thread**, single writer. All order mutation happens here; this is what makes
  the engine deterministic and removes lock contention from the hot path.
- **Lock-free ring buffer** between IO and matching: bounded, power-of-two capacity, head and
  tail on separate cache lines (padding to avoid false sharing), acquire/release memory ordering.
  An MPSC ring for inbound (many gateway threads, one consumer), SPSC rings for outbound. Cite
  the design lineage (Vyukov MPSC / LMAX Disruptor) in comments — and be ready to defend the
  memory-ordering choices, because that's a likely interview drill-down.
- **No hot-path allocation.** Pre-allocate order pools; recycle freed nodes. The hot path should
  not call `new`/`malloc`.

### 3.4 Determinism contract

Same input sequence → byte-identical output event stream. No wall-clock reads, no nondeterministic
iteration order, no data races. This is testable (§7) and is the foundation the replication and
harness layers depend on. Treat any nondeterminism as a correctness bug, not a performance footnote.

---

## 4. Layer 2 — feed handler (C++, networking)

The systems-networking signal, and the realistic-load source for benchmarks.

### 4.1 ITCH parsing

Parse **NASDAQ TotalView-ITCH 5.0** (public binary spec). Messages are big-endian, type-tagged
(Add Order, Order Executed, Order Cancel, Order Delete, Order Replace, Trade, etc.), framed in
MoldUDP64, which carries sequence numbers.

Two ways the feed connects to the engine, both worth supporting:
- **Replay drive (primary):** translate historical ITCH order flow into the engine's internal
  order format and feed it in. This stress-tests the engine under *realistic* load — bursty,
  heavy-tailed message rates — rather than a synthetic uniform stream, and it makes the benchmark
  numbers credible.
- **Reconstruction check (secondary):** rebuild the book independently from the ITCH stream and
  assert it matches, exercising the full parse path.

### 4.2 Transport and gap recovery

- **UDP multicast** ingest with MoldUDP64 framing; detect gaps via sequence numbers; implement
  the gap-recovery state machine (request/backfill). In a real venue this hits a rewind server;
  for the project, drive it from a recorded feed and inject synthetic gaps to exercise recovery.
- **io_uring** for socket reads — batched submission/completion, minimal syscall overhead. A
  `recvmmsg`-based path is an acceptable simpler first cut; io_uring is the version that signals
  OS-level networking depth (the Andromeda-adjacent signal).

### 4.3 Order-entry wire protocol

A documented binary protocol (`PROTOCOL.md`), loosely modeled on NASDAQ **OUCH** (the order-entry
counterpart to ITCH's market data — naming the ITCH/OUCH split in the docs signals domain
fluency). Framed, fixed-layout messages: new order, cancel, replace inbound; accept, reject, fill,
and market-data updates outbound. Keep it simple and fully specified.

---

## 5. Layer 3 — choose one top layer

These are largely substitutable as "the impressive cap," and the choice signals which track
you're optimizing for. Build one well; do not gate earlier milestones on it.

### 5.A Agent evaluation harness (Python) — recommended for AI-lab targets

Turns the exchange into a reproducible multi-agent environment. This is the differentiator for
Anthropic / OpenAI / xAI and sits directly in the RL-environment + eval lineage.

**Core interface** (over the same observe/act/reward the engine already exposes):
- `reset(seed) → observation`
- `step(action) → (observation, reward, done, info)`
- Observation: L2 book snapshot, the agent's open orders, position, cash/PnL, logical clock.
- Action: `place(side, price, qty, type)`, `cancel(order_id)`, or no-op.
- Reward: configurable — realized + unrealized PnL delta by default, or fill-quality metrics.

**Two adapters over the core interface:**
- **Gym/Gymnasium adapter** for RL agents (diffusion-policy, PPO, whatever) — your Mercor lane.
- **MCP server adapter** exposing place/cancel/observe as tools, so any LLM agent connects over
  the standard protocol and trades by calling tools.

**Multi-agent market:** N agents connect simultaneously and match against each other —
market-maker bots, scripted adversaries, and the agent-under-test. This is where it becomes
research-interesting: adverse selection, manipulability, how an LLM agent handles an adversarial
counterparty, how behavior scales across episodes.

**Why determinism matters here:** seeded, replayable, reproducible episodes are the whole point
of an eval harness. The single-writer engine gives you that for free.

**Framing discipline:** this is an *evaluation environment* measuring agent behavior, not a
profitable AI trader. The research framing is both more honest and more impressive to the people
you're aiming at — and it sidesteps the skepticism a "profitable agent" claim invites.

### 5.B Raft replication (Go) — alternative for Google-systems / infra targets

Wraps the engine as a replicated state machine. The ordered sequence of accepted orders is the
Raft log; each replica applies it deterministically, so all replicas hold identical book state
(this only works because of §3.4).

- Leader handles order entry and replicates log entries; followers apply.
- Leader election, log replication, persistence, and **snapshotting** (periodic book-state
  snapshots to bound log growth).
- Failover: client reconnects to the new leader; measure and report failover time.
- Verify linearizability with **Porcupine**.
- **MIT 6.5840** labs are essentially this layer and are recognized signal in themselves; use
  them as scaffold. Writing this in Go also adds the Go language line the k8s/infra track screens
  for.

---

## 6. Benchmark methodology — the credibility layer

A latency number nobody can reproduce is a liability. The benchmark harness is as important as
the engine, because it's what an interviewer reads to decide whether to trust the headline.

- **Measure tick-to-trade**: timestamp at ingest, timestamp at fill emission, record the delta in
  an **HdrHistogram**. Report **p50 / p99 / p99.9 / p99.99 and max** — never the mean. The mean
  hides the tail, and the tail is the entire game.
- **Separate engine latency from wire latency.** Report ring-in-to-ring-out (the engine) and full
  network round-trip (the system) distinctly, and label which is which.
- **Latency under load**, not unloaded. Quote the distribution at a stated sustained throughput,
  not the latency of a single lonely order.
- **Pin threads to cores** (`pthread_setaffinity_np` / `taskset`); ideally isolate cores
  (`isolcpus`). Disable frequency scaling / turbo for stable numbers, or report the config if you
  don't.
- **Calibrate the clock.** If using `rdtsc`, confirm invariant TSC and convert to ns; account for
  measurement overhead so you're timing the engine, not the timer. `clock_gettime(CLOCK_MONOTONIC)`
  is the simpler, honest default — note its overhead.
- **Warm up**, then measure steady state.
- **Report the environment**: CPU, kernel, compiler and flags, NIC, whether kernel-bypass was used.
- Drive the benchmark with the ITCH replay (§4.1) for realistic, bursty load.

**Target order-of-magnitude** (to validate by measurement, not to promise): single-symbol,
in-process engine latency in the low microseconds at p50 with a single-digit-microsecond p99, and
throughput in the millions of orders/sec. State these as goals you measured against, and let the
honest measured numbers stand — a defensible p99 beats an indefensible vanity figure every time.

---

## 7. Correctness and testing

The code gets read and the engine gets questioned, so tests are part of the deliverable.

**Matching-engine unit tests:**
- Price-time priority ordering (older order at a price fills first).
- Partial fills and multi-level sweeps.
- Cancel resting order; cancel non-existent (clean reject).
- IOC and FOK semantics.
- Self-trade prevention (if implemented).

**Determinism / replay test:** feed a recorded order sequence twice (and across replicas, for
5.B); assert byte-identical event streams. This is the keystone test — it underpins both top
layers.

**Property-based / fuzz tests:** random order streams with invariants asserted after every event:
no crossed book, conserved quantity, no negative quantities, best-bid < best-ask. This catches the
edge cases hand-written tests miss and reads as rigor.

---

## 8. Repository layout

The repo *is* the artifact — no separate website or demo deployment. The README earns the click;
the code survives the read.

```
exchange-engine/
├── README.md            # headline numbers + architecture diagram + one-command run
├── DESIGN.md            # design decisions: why array vs tree, single writer, ring buffer
├── PROTOCOL.md          # binary order-entry protocol spec
├── CMakeLists.txt
├── Makefile             # `make`, `make test`, `make bench` — each one command
├── engine/              # C++ order book, matching, lock-free rings, order pool
├── feed/                # C++ ITCH parser, UDP/io_uring ingest, gap recovery
├── protocol/            # wire protocol definitions
├── bench/               # HdrHistogram harness, methodology notes, result charts (PNG)
├── tests/               # unit, determinism/replay, property/fuzz
├── harness/             # Python: Gym adapter + MCP server      (if 5.A)
│   └── replication/     # Go: Raft replicated state machine     (if 5.B, instead)
└── docs/                # diagrams, the three-layer figure
```

**README order:** one-line description → headline result as an inline PNG (latency histogram with
p50/p99/p99.9 marked + throughput) → architecture diagram → one-command run → design-decisions
section. A reader who sees a real tail-latency distribution in the first screen knows you measured
the right thing before they read a line of code.

---

## 9. Milestones — each independently shippable

| Milestone | Contents | Resume-complete? |
|---|---|---|
| M0 | Build system, CI, repo skeleton, order/event types | scaffolding |
| **M1 (Stop 1)** | Matching engine + correctness/determinism/fuzz tests + benchmark harness with honest p99 numbers, single process | **Yes — trips the C++ quant filter on its own** |
| M2 (Stop 2) | Binary order-entry protocol + TCP gateway + ITCH feed handler + replay-driven benchmarks | Yes — adds networking signal |
| M3 (Stop 3) | Agent harness (5.A) *or* Raft replication (5.B) | Yes — the differentiating cap |

**M1 is the binding constraint.** It's a one-to-two-week build at your level and moves the needle
more than any later layer. Ship it clean before touching M2. A half-built later layer is worse
than a missing one, because the code gets read — depth over breadth.

---

## 10. Interview narrative — how to talk about it

The packaging is only as good as the conversation it sets up. The talking points that signal depth:

- **Why array-of-price-levels over a BST** → cache locality and O(1) level access on a bounded
  tick space; know the fallback for unbounded ranges.
- **Why a single writer** → determinism and zero lock contention on the hot path.
- **Why a lock-free ring and how the memory ordering works** → the acquire/release reasoning,
  false-sharing avoidance via cache-line padding.
- **How you measured** → tick-to-trade, percentiles not means, latency under load, clock
  calibration, core pinning. The methodology is the flex.
- **The determinism throughline** → one property enabling latency, replay, replication, and
  reproducible evals. This is the line that ties the whole system together and shows you designed
  it, rather than accreted it.

Lead the resume line with the result, not the activity: *"Matching engine in C++ — N k orders/sec,
p99 tick-to-trade X µs"* with the repo link. The number plus the link is the entire pitch.