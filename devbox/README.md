# Devbox automation — run the loop unattended on a Windows cloud VM (no WSL)

This folder turns a fresh **Windows** cloud devbox into an unattended host for the
Loops of Fury self-improvement loop. No WSL, no Linux — just PowerShell + Windows
Task Scheduler driving the same `npm run loop:*` scripts the repo already ships.

## The run model (why it's tasks + a watchdog, not one process)

A single `npm run loop:run` is **bounded** — it self-terminates at:

- the **8-hour** hard cap (`LOOP.maxDurationMs`),
- **5 consecutive no-ops** (`LOOP.maxNoops`, "no-progress"), or
- a churn **escalation** (`LOOP.churnMax`).

So "runs forever, unattended" = **a Scheduled Task that re-launches a bounded run on a
cadence**, plus a **watchdog** that recovers a crashed/hung run using the engine's own
15-minute heartbeat (`LOOP.heartbeatTtlMs`, exposed in `.loop/run.json`).

```
Task Scheduler ──(cadence)──> run-loop.ps1 ──> node .loop/loop.mjs --run  (bounded)
        │                          │  lock + heartbeat (.loop/run.json)
        ├──(every 15 min)──> watchdog.ps1 ──> kill+relaunch if hung/crashed
        └──(every 3 min)───> poll-tasks.ps1 ─> triggers a run when a `loop-task` issue is open
```

## Prerequisites the devbox needs

| Requirement | Why | Notes |
|---|---|---|
| **Node ≥ 20** | `engines.node`; runs the whole engine | `bootstrap.ps1` installs via winget if missing |
| **`npm ci`** | playwright, pixelmatch, pngjs | run by bootstrap |
| **Chromium** (`npx playwright install chromium`) | the checker renders both decks headless every iteration | without it, every iteration is red |
| **`copilot` CLI, authenticated** | this **is** the maker (`MAKER.bin='copilot'`) | no copilot → maker no-ops, loop makes no edits |
| **`gh` CLI + a `GH_TOKEN`** | the loop opens/updates the `loop-run` issue, drains `loop-task` issues, and verifies live Pages — all via `gh`; git push uses gh's credential helper | token needs `contents:write` + `issues:write` on `ridermw/loops-of-fury` |
| **Hooks + baseline** | `loop:install-hooks` (pre-push barrier D30) and `loop:init` (anchor/slide baseline + manifest) | run by bootstrap |

## Quick start

```powershell
# 1. Clone (or let bootstrap clone), then from the repo root:
pwsh -ExecutionPolicy Bypass -File devbox\bootstrap.ps1

# 2. Put your token in the file bootstrap created (gitignored, never committed):
#    .loop\.env   ->   GH_TOKEN=ghp_xxx
#    Then re-run bootstrap so `gh auth setup-git` wires non-interactive push:
pwsh -ExecutionPolicy Bypass -File devbox\bootstrap.ps1

# 3. (Optional) trigger one run now to verify end-to-end:
pwsh -ExecutionPolicy Bypass -File devbox\run-loop.ps1
```

`bootstrap.ps1` is idempotent — safe to re-run any time.

> **Scheduled Task registration needs Administrator rights.** When bootstrap reaches
> the task step it will raise a one-time **UAC prompt** to self-elevate. On a headless
> box (no interactive desktop) UAC can't prompt — instead run an elevated step yourself:
> `powershell -ExecutionPolicy Bypass -File devbox\register-task.ps1 -Mode Scheduled`.
> If you skip scheduling entirely, `run-loop.ps1` still runs a bounded loop without any
> elevation. Provisioning (deps, hooks, baseline) never needs admin.

## Cadence / spend (this costs real AI credits)

The maker is **~80 credits per landed iteration** (~90–100 s/call); the delight judge
is ~35 credits/call. A ~100-iteration run is a deliberate, owner-gated spend. Choose a
mode when registering tasks (default is the conservative one):

```powershell
# Predictable: one bounded run every N hours (DEFAULT, 6h)
pwsh -File devbox\register-task.ps1 -Mode Scheduled -IntervalHours 6

# Maximum improvement / maximum cost: a new run starts right after the prior ends
pwsh -File devbox\register-task.ps1 -Mode Continuous

# Manual only: tasks registered but DISABLED; you start runs yourself
pwsh -File devbox\register-task.ps1 -Mode OnDemand
```

## Issue pickup latency (the poll task)

You can hand the loop work by labeling a GitHub issue **`loop-task`**; its intake phase
drains that queue (oldest first, `priority:high`/`priority:low` honored) at the **start of
each bounded run**, before autonomous polish. With only a cadence task, a freshly labeled
issue would therefore wait until the next run begins — up to `-IntervalHours` (6h default).

`poll-tasks.ps1` (task `LoopsOfFury-Poll`, every **3 min** by default) closes that gap and
spends **zero AI credits**: each tick is a single `gh` API query for an *actionable* open
`loop-task` issue (one not already `loop-needs-review`, mirroring the engine's own intake
eligibility). On a hit — and only when no run is active — it triggers `LoopsOfFury-Run`, so
the issue is picked up within minutes. Empty queue or active run → no-op, so **idle spend is
unchanged** from the scheduled-only setup. (A brand-new issue that lands mid-run waits for
the *next* run, since the active run already drained its queue — never longer than one
bounded run.)

```powershell
# Retune or disable the poller at registration time:
pwsh -File devbox\register-task.ps1 -PollMinutes 2     # faster pickup
pwsh -File devbox\register-task.ps1 -NoPoll            # cadence-only; issues wait for the next run
```

## Files

| Script | Role |
|---|---|
| `bootstrap.ps1` | one-time provisioning (prereqs → deps → Chromium → hooks → `loop:init` → register tasks). Idempotent. |
| `run-loop.ps1` | the scheduled entrypoint: lock → load token → sync to `origin/main` → `loop:preflight` gate → one bounded `loop:run` → log. |
| `poll-tasks.ps1` | every few minutes: if an actionable `loop-task` issue is open and no run is active, trigger `LoopsOfFury-Run`. No AI spend on an empty queue. |
| `register-task.ps1` | create/refresh the `LoopsOfFury-Run` + `-Watchdog` + `-Poll` Scheduled Tasks; record a registration fingerprint. |
| `watchdog.ps1` | kill + relaunch a hung/crashed run via the 15-min heartbeat. |
| `_common.ps1` | shared helpers (dot-sourced). |
| `.gitignore` | keeps `logs/`, `state/`, `*.log`, `*.lock` out of git. |

## Operations

- **Logs:** `devbox\logs\` — `run-*.log` (wrapper), `loop-*.out.log` / `.err.log` (the run), `history.log`, `watchdog.log`, `poll.log`. All gitignored.
- **Lock / heartbeat:** `devbox\state\run.lock` records the loop's PID; liveness comes from `.loop\run.json` heartbeat. `devbox\state\registered.json` fingerprints what was last registered.
- **Inspect tasks:** `Get-ScheduledTask -TaskName 'LoopsOfFury-*'`
- **Pause (stop all spend):** `Disable-ScheduledTask -TaskName 'LoopsOfFury-Run'; Disable-ScheduledTask -TaskName 'LoopsOfFury-Poll'` — disable **both**, since the poller can start the Run task on demand even while it is disabled.
- **Remove:** `Unregister-ScheduledTask -TaskName 'LoopsOfFury-*'`
- **Run once by hand:** `pwsh -File devbox\run-loop.ps1`

## Secrets & safety

- The **only** secret is `GH_TOKEN`, kept in `.loop\.env` (gitignored by the repo). Nothing
  is hardcoded; nothing token-like is ever committed. The repo's secret-scan + pre-push
  barrier remain in force.
- `run-loop.ps1` hard-resets the working tree to `origin/main` each run (the loop
  self-commits its run-state, so origin is the source of truth). `.loop\.env`,
  `node_modules`, and `devbox\logs|state` are gitignored and survive the reset — the
  script never runs `git clean`. Pass `-NoReset` for a fast-forward pull instead.
- **Auto-update:** because of that per-run sync, every bounded run already executes the
  **latest** `.loop` engine + decks from `origin/main` — no manual pull needed. The one
  thing a pull can't refresh is the Windows **Scheduled Task definitions** (cadence,
  triggers, which tasks exist); those change only when `register-task.ps1` re-runs
  (elevated). `run-loop.ps1` detects this: if the `devbox\*.ps1` scripts changed on origin
  since the last registration (tracked in `devbox\state\registered.json`) it logs a WARN to
  re-run `bootstrap.ps1` elevated. Re-running bootstrap is always safe (idempotent).
- These scripts live in `devbox/`, **outside** the maker's write allowlist
  (`ALLOWED_WRITE` = decks + `assets/`), so the loop can never modify its own automation,
  and they are not part of the LF-pinned `.loop/**` control manifest.
- The pre-push barrier only constrains **loop-originated** pushes (`LOOP_PUSH=1`); your
  operator pushes of this folder are unconstrained.
