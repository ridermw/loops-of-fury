# Getting Started: Build Your First Loop Today

> A rewrite of **§XII "Build Your First Loop Today"** from
> [`references/Loop-Engineering-IEEE.pdf`](references/Loop-Engineering-IEEE.pdf),
> adapted to run on **GitHub Copilot CLI** on **Windows — no WSL, no Linux**. Every
> command below is real `copilot`, `gh`, or native PowerShell, and where it helps it
> points at the working loop already running in this repo's [`devbox/`](devbox/README.md).

A Stripe-grade pipeline is the *endpoint*, not the starting point. A first loop should
be so small it barely looks like a system — a little thing that checks something on a
timer. You earn the right to run more agents by first proving you can stop a single bad
one.

This guide builds that tiny loop in five steps, then shows one minimal-but-complete loop —
a single `loop.ps1` driven by **Windows Task Scheduler** — that installs all six elements
a real loop needs.

## What you need

- **Windows 10/11** with **PowerShell 7** (`pwsh`). No WSL — everything here is native
  PowerShell and Windows Task Scheduler.
- **GitHub Copilot CLI**, authenticated — run `copilot` once interactively to sign in.
- **`gh` CLI**, authenticated (`gh auth login`) — the loop reads CI/issues and opens PRs through it.
- **Node.js 20+** and **git**.
- A spending ceiling and a kill switch you know how to reach (see *Before you let it run unattended*).

## First, the translation from the paper

The working note was written for another agent CLI, so three of its verbs don't exist in
Copilot CLI. Here's the honest mapping — the *idea* survives; the *mechanism* changes, and
on Windows the timer is **Task Scheduler**, not a Unix cron.

| Paper (Claude Code) | What it did | Copilot CLI on Windows |
|---|---|---|
| `/loop 5m …` | rerun a task on a session timer | **no built-in timer** — wrap one `copilot -p` call in a **Scheduled Task** (`Register-ScheduledTask`) |
| `/goal … tests pass` | run until a model-judged condition holds | a **deterministic command** that exits non-zero (`npm test`, `npm run loop:preflight`) **plus** a second `copilot` reviewer pass |
| `claude --worktree fix/x` | isolate each parallel agent | `git worktree add …` then `copilot -C <dir>` (there is no `--worktree` flag) |

Real Copilot CLI flags you'll use below: `-p/--prompt` (non-interactive), `-C <dir>`
(working directory), `--add-dir`, `--allow-tool` / `--allow-all-tools`
(`--allow-all-tools` is required for non-interactive runs unless you pre-scope tools),
`--agent <name>`, `--model`.

---

## Step one — run it on a timer *(Scheduling)*

The smallest seed of any loop is one non-interactive turn:

```powershell
# one turn, no human in the chat window
copilot -p "Check the latest deploy and report its status." --allow-all-tools
```

That is not a loop yet — a loop *reruns* on a trigger. Copilot CLI has no `/loop`, so on
Windows "on a timer" means a **Scheduled Task** that re-launches that call on a cadence:

```powershell
# Register a task that reruns a script every 6 hours (native — no WSL, no cron)
$action  = New-ScheduledTaskAction -Execute 'pwsh' -Argument "-NoProfile -File `"$PWD\loop.ps1`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 6)
Register-ScheduledTask -TaskName 'FirstLoop' -Action $action -Trigger $trigger
```

Disable the task and the loop stops (`Disable-ScheduledTask -TaskName 'FirstLoop'`). In
this repo the production version of exactly that registration is
[`devbox\register-task.ps1`](devbox/register-task.ps1), which registers the run task to
fire **whether or not you are logged on** (an S4U principal) and wraps `npm run loop:run`:

```powershell
# This repo ships the unattended, no-WSL version (Task Scheduler, runs logged-off):
pwsh -File devbox\register-task.ps1 -Mode Scheduled -IntervalHours 6
```

## Step two — read CI and issues; triage first *(Discovery)*

Rerunning one line is not a loop. Give the agent a prompt to look at a few things and
**list what is worth handling**. Scheduling plus auto-discovery is loop entry level — and
the discovery logic should live in a reusable prompt file (or a custom `--agent`), *not*
baked into the schedule.

```text
# prompts\morning-triage.md
You are the morning-triage step of an automated loop.

READ:
- CI runs that failed since yesterday      (gh run list --status failure)
- issues opened in the last 24h            (gh issue list --search "created:>YESTERDAY")
- commits merged since the last run

JUDGE each item: is it worth acting on? Skip noise; keep only actionable findings.

OUTPUT: write findings + status to .\state\triage.md, one row per finding.
```

Run the prompt non-interactively — PowerShell reads the file and hands it to `copilot`:

```powershell
copilot -p (Get-Content prompts\morning-triage.md -Raw) --allow-all-tools
```

> In this repo, discovery is already wired: a maintainer labels a GitHub issue
> **`loop-task`**, and the engine drains that queue oldest-first (`.loop\intake.mjs`).
> The issue list *is* the triage board. The poller
> [`devbox\poll-tasks.ps1`](devbox/poll-tasks.ps1) checks that queue every few minutes for
> **zero AI credits** and wakes a run when something actionable is waiting.

## Step three — add a state file *(Persistence)*

Do not leave results in the chat window. Write every finding — and how far it has been
handled — into a file the repo keeps. The agent forgets; the repo does not.

```text
# .\state\triage.md — the loop's memory
| finding         | source   | status  |
|-----------------|----------|---------|
| auth test flaky | CI #4821 | fixing  |
| null deref      | issue 92 | PR open |
| stale dep       | commit a3| inbox   |
```

> This repo persists in three durable places: `.loop\scoreboard.json` (machine state),
> the single open **`loop-run`** GitHub issue (a human-readable run log), and a live
> ledger rendered into the decks.

## Step four — add an evaluator *(Verification)*

The most critical step, and the easiest to skip. An evaluator that cannot say **"no"** is
not an evaluator. Copilot CLI has no `/goal`, so you build the stop-check two ways — and
you want **both**:

```powershell
# 1. A machine-checkable done-condition: a real command that exits non-zero on failure.
npm test
if ($LASTEXITCODE -ne 0) { throw "tests failed — the loop does not get to proceed" }

# 2. A fresh-context reviewer pass that judges the diff a different way.
copilot -p (Get-Content prompts\checker-review.md -Raw) --model auto
```

> In this repo the evaluator is `npm run loop:preflight` **plus** a diff-gate, a
> push-gate, a headless-Chromium render of both decks, and a live Pages re-fetch —
> deterministic checks the maker cannot talk its way past. The maker itself is granted
> only read+edit tools (`--allow-tool=view,write`), so the gates — not the agent's
> goodwill — are the real boundary.

## Step five — add worktrees for parallelism *(Isolation)*

Use `git worktree` so each background agent gets its own working directory and they don't
step on each other. There is no `--worktree` flag — you point `copilot` at the directory
with `-C`:

```powershell
git worktree add ..\wt-auth-test  -b fix/auth-test
copilot -C ..\wt-auth-test  -p "Draft the fix for the flaky auth test." --allow-all-tools

git worktree add ..\wt-null-deref -b fix/null-deref
copilot -C ..\wt-null-deref -p "Draft the fix for the null deref in issue 92." --allow-all-tools
```

Add this **last** — see *Growing the loop safely*.

---

## The six-element readiness checklist

Before you let a loop run on its own, answer all six. The first two decide whether it can
run; the last four decide whether it gets into trouble once it does.

| Element | The question it answers |
|---|---|
| **Discovery** | What does it read on a timer? (CI / issues / commits / inbox) |
| **State file** | Which disk file holds the cross-round memory? |
| **Evaluator** | Is there an independent check that can say "no"? |
| **Isolation** | Does each parallel agent get its own worktree? |
| **Token cap** | Did you set a spending ceiling? Who stops it if it runs off? |
| **Human review** | Which step pauses for a human, instead of auto-ing all the way through? |

Beginners most often ship with only the first two built — and the result is a loop nobody
watches and nobody can stop, nodding at itself. A first loop is better small, but with the
**"no"-saying check** and the **human-review door** fully installed.

## A complete first loop, annotated

Minimal but complete: every organ a real loop needs, only scaled down — and **100% native
Windows**, no WSL. It's one PowerShell script plus one Scheduled Task. Read top to bottom;
the six numbered comments are the six elements above, each realized in a few lines.

```powershell
# loop.ps1 — a complete first loop, six elements, native Windows (no WSL)
$ErrorActionPreference = 'Stop'
$state = Join-Path $PSScriptRoot 'state'
New-Item -ItemType Directory -Force -Path $state | Out-Null
$findings = Join-Path $state 'findings.txt'

# 2. DISCOVERY — let the agent read CI + issues and list what's worth doing.
#    The prompt writes one finding per line into state\findings.txt  (that file is
#    element 3, PERSISTENCE — the loop's cross-round memory on disk).
copilot -p (Get-Content prompts\morning-triage.md -Raw) --allow-all-tools
if (-not (Test-Path $findings)) { return }   # nothing actionable this round

foreach ($finding in Get-Content $findings) {
    $slug = ($finding -replace '[^\w.-]', '-').Trim('-')

    # 4. ISOLATION — one git worktree per finding (there is no --worktree flag).
    $wt = "..\wt-$slug"
    git worktree add $wt -b "fix/$slug"
    copilot -C $wt -p "Draft a fix for: $finding. Done when 'npm test' passes." --allow-all-tools

    # 5. VERIFICATION — a deterministic gate that can say NO, then a fresh reviewer model.
    Push-Location $wt
    npm test
    $passed = ($LASTEXITCODE -eq 0)
    if ($passed) { copilot -p (Get-Content ..\loops-of-fury\prompts\checker-review.md -Raw) --model auto }
    Pop-Location

    # 6. HUMAN REVIEW — open a DRAFT PR, never merge. Anything uncertain waits for a person.
    if ($passed) {
        git -C $wt push -u origin "fix/$slug"
        gh pr create --draft --head "fix/$slug" --title "loop: $finding" --body "Auto-drafted. Needs a human."
    }

    # 3. PERSISTENCE — append the outcome so the next round remembers what happened.
    $status = if ($passed) { 'pr-open' } else { 'failed-gate' }
    Add-Content (Join-Path $state 'log.csv') ("{0},{1},{2}" -f (Get-Date -Format o), $slug, $status)
}
```

```powershell
# 1. SCHEDULING — the outer trigger. Rerun loop.ps1 every 6 hours via Task Scheduler.
$action  = New-ScheduledTaskAction -Execute 'pwsh' -Argument "-NoProfile -File `"$PWD\loop.ps1`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 6)
Register-ScheduledTask -TaskName 'FirstLoop' -Action $action -Trigger $trigger
```

The Scheduled Task is **scheduling**; the `copilot -p` triage call is **discovery**; the
committed `state\` files are **persistence**; the per-finding worktree is **isolation**;
`npm test` plus the reviewer pass is **verification**; and "open draft PRs, never auto-merge"
is the **human-review** door. A loop with all six — even a tiny one — is a real loop. A loop
missing any one of them is a classic loop failure wearing a disguise.

> **This repo is that complete loop, already wired** — for Copilot CLI, on Windows, without
> WSL. Scheduling: [`devbox\register-task.ps1`](devbox/register-task.ps1) (Task Scheduler:
> `LoopsOfFury-Run` on a cadence, `-Watchdog` for crash recovery, `-Poll` for low-latency
> issue pickup). Discovery: the `loop-task` issue queue. Persistence: `.loop\scoreboard.json`
> + the `loop-run` issue. Verification: `npm run loop:preflight` + the diff/push/render/Pages
> gates. Isolation: each bounded run is its own process under a lock. Human review: the
> `loop-needs-review` label — a gate-blocked task is left **open** for a person, never
> force-landed. See [`devbox/README.md`](devbox/README.md) to run it unattended.

## Growing the loop safely

Once the minimal loop runs, the temptation is to scale it — more findings, more parallel
agents, shorter intervals. The safe order of growth is to **add parallelism last**, after
the checks are proven:

1. Increase what the loop **discovers** before increasing how much it **does** in parallel.
2. Prove the **evaluator** catches real mistakes before trusting it to gate many agents at once.
3. Only then fan out across worktrees.

The Stripe-grade pipeline is the *endpoint* of this path, not the entry: its reliability
comes from years of hardening the deterministic gates, not from starting large. A loop
earns the right to run more agents by first demonstrating it can stop a single bad one.

## Before you let it run unattended

- **Set a token/credit ceiling.** In this repo a landed maker iteration costs ~80 AI
  credits (~90–100 s/call) and the delight judge ~35 credits/call; multiply by your cadence
  before you walk away. A bounded run also self-terminates — at the 8-hour cap, after 5
  consecutive no-ops, or on a churn escalation — so it can't spend forever in one go.
- **Know your kill switch.** Disable the schedule. On the devbox, disable **both** the run
  task and the poller, since the poller can start a run even while the run task is disabled:
  ```powershell
  Disable-ScheduledTask -TaskName 'LoopsOfFury-Run'
  Disable-ScheduledTask -TaskName 'LoopsOfFury-Poll'
  ```
- **Scope the tools.** Start with `--allow-all-tools` to get it working, then narrow to the
  least grant the job needs (this repo's editing maker runs with only `--allow-tool=view,write`).
- **Never auto-merge.** PRs are opened, not merged; anything uncertain lands in front of a human.

---

The rest isn't in this guide; it's in the terminal. Set a ceiling, register the Scheduled
Task, and watch the first finding land in `state\`.
