# Getting Started: Build Your First Loop Today

> A rewrite of **§XII "Build Your First Loop Today"** from
> [`references/Loop-Engineering-IEEE.pdf`](references/Loop-Engineering-IEEE.pdf),
> adapted to run on **GitHub Copilot CLI**. Every command below is real `copilot`
> or `gh` — and where it helps, it points at the working loop already in this repo.

A Stripe-grade pipeline is the *endpoint*, not the starting point. A first loop should
be so small it barely looks like a system — a little thing that checks something on a
timer. You earn the right to run more agents by first proving you can stop a single bad
one.

This guide builds that tiny loop in five steps, then shows one minimal-but-complete loop
that installs all six elements a real loop needs.

## What you need

- **GitHub Copilot CLI**, authenticated — run `copilot` once interactively to sign in.
- **`gh` CLI**, authenticated (`gh auth login`) — the loop reads CI/issues and opens PRs through it.
- **Node.js 20+** and **git**.
- A spending ceiling and a kill switch you know how to reach (see *Before you let it run unattended*).

## First, the translation from the paper

The working note was written for another agent CLI, so three of its verbs don't exist in
Copilot CLI. Here's the honest mapping — the *idea* survives; the *mechanism* changes.

| Paper (Claude Code) | What it did | Copilot CLI equivalent |
|---|---|---|
| `/loop 5m …` | rerun a task on a session timer | **no built-in timer** — wrap one `copilot -p` call in the OS scheduler or a CI cron |
| `/goal … tests pass` | run until a model-judged condition holds | a **deterministic command** that exits non-zero (`npm test`) **plus** a second `copilot` reviewer pass |
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

That is not a loop yet — a loop *reruns* on a trigger. Copilot CLI has no `/loop`, so
"on a timer" means the OS scheduler or CI cron wrapping that call. Pick one:

```powershell
# Local, unattended on a Windows devbox (this repo ships it):
pwsh -File devbox\register-task.ps1            # Task Scheduler runs npm run loop:run on a cadence
```

```yaml
# Cloud, in CI:
on:
  schedule:
    - cron: "*/5 * * * *"   # every 5 minutes
```

Turn the machine — or the schedule — off and the loop stops. In this repo the timer runs
`npm run loop:run`, which wraps exactly the `copilot` call above as its **maker**.

## Step two — read CI and issues; triage first *(Discovery)*

Rerunning one line is not a loop. Give the agent a prompt to look at a few things and
**list what is worth handling**. Scheduling plus auto-discovery is loop entry level — and
the discovery logic should live in a reusable prompt (or a custom `--agent`), *not* baked
into the schedule.

```text
# prompts/morning-triage.md
You are the morning-triage step of an automated loop.

READ:
- CI runs that failed since yesterday      (gh run list --status failure)
- issues opened in the last 24h            (gh issue list --search "created:>YESTERDAY")
- commits merged since the last run

JUDGE each item: is it worth acting on? Skip noise; keep only actionable findings.

OUTPUT: write findings + status to ./state/triage.md, one row per finding.
```

Run the prompt non-interactively:

```powershell
copilot -p (Get-Content prompts\morning-triage.md -Raw) --allow-all-tools
```

> In this repo, discovery is already wired: a maintainer labels a GitHub issue
> **`loop-task`**, and the engine drains that queue oldest-first (`.loop/intake.mjs`).
> The issue list *is* the triage board.

## Step three — add a state file *(Persistence)*

Do not leave results in the chat window. Write every finding — and how far it has been
handled — into a file the repo keeps. The agent forgets; the repo does not.

```text
# ./state/triage.md — the loop's memory
| finding         | source   | status  |
|-----------------|----------|---------|
| auth test flaky | CI #4821 | fixing  |
| null deref      | issue 92 | PR open |
| stale dep       | commit a3| inbox   |
```

> This repo persists in three durable places: `.loop/scoreboard.json` (machine state),
> the single open **`loop-run`** GitHub issue (a human-readable run log), and a live
> ledger rendered into the decks.

## Step four — add an evaluator *(Verification)*

The most critical step, and the easiest to skip. An evaluator that cannot say **"no"** is
not an evaluator. Copilot CLI has no `/goal`, so you build the stop-check two ways — and
you want **both**:

```powershell
# 1. A machine-checkable done-condition: a real command that exits non-zero on failure.
npm test
npm run lint

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

Minimal but complete: every organ a real loop needs, only scaled down. Read top to bottom —
the six numbered comments are the six elements above, each realized in two or three lines.

```yaml
# .github/workflows/triage.yml

# 1. SCHEDULING — a real trigger
on:
  schedule:
    - cron: "0 6 * * *"      # 06:00 UTC daily, in the cloud
  workflow_dispatch: {}       # and an on-demand button

jobs:
  loop:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # 2. DISCOVERY — a reusable prompt, not a wall of text
      - name: Triage
        run: copilot -p "$(cat prompts/morning-triage.md)" --allow-all-tools
        #    the prompt writes ./state/triage.md  (element 3)

      # 3. PERSISTENCE — commit the state back to the repo
      - name: Persist
        run: |
          git add state/triage.md
          git commit -m "loop: triage $(date -u +%F)" || echo "nothing new"
          git push

      # 4. HANDOFF — one isolated worktree per finding
      - name: Fan out
        run: |
          while IFS= read -r finding; do
            git worktree add "../wt-$finding" -b "fix/$finding"
            copilot -C "../wt-$finding" \
              -p "Draft a fix for: $finding. Done when npm test passes and lint is clean." \
              --allow-all-tools
          done < state/findings.txt

      # 5. VERIFICATION — deterministic gates + a fresh reviewer model judge
      - name: Gate
        run: |
          npm test && npm run lint
          copilot -p "$(cat prompts/checker-review.md)" --model auto

      # 6. HUMAN REVIEW — the open door
      - name: Open PRs, never merge
        run: gh pr create --draft --title "loop: $finding" --body "Auto-drafted. Needs a human."
        #    nothing auto-merges; anything uncertain is left for a person
```

The cron line is **scheduling**; the prompt invocation is **discovery**; the committed
`state/triage.md` is **persistence**; the per-finding worktree is **handoff**;
`npm test && npm run lint` plus the reviewer pass is **verification**; and
"open draft PRs, never auto-merge" is the **human-review** door. A loop with all six —
even a tiny one — is a real loop. A loop missing any one of them is a classic loop failure
wearing a disguise.

> **This repo is that complete loop, already wired** — for Copilot CLI, on Windows, without
> WSL. Scheduling: `devbox\register-task.ps1` (Task Scheduler) or a cron. Discovery: the
> `loop-task` issue queue. Persistence: `.loop/scoreboard.json` + the `loop-run` issue.
> Verification: `npm run loop:preflight` + the gates. Human review: the `loop-needs-review`
> label — a gate-blocked task is left **open** for a person, never force-landed. See
> [`devbox/README.md`](devbox/README.md) to run it unattended.

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

- **Set a token/credit ceiling.** A single maker call here costs ~35 AI credits and ~90s;
  multiply by your cadence before you walk away.
- **Know your kill switch.** Disable the schedule. On a devbox, disable **both** the run
  task and the poller: `Disable-ScheduledTask -TaskName 'LoopsOfFury-Run','LoopsOfFury-Poll'`.
- **Scope the tools.** Start with `--allow-all-tools` to get it working, then narrow to the
  least grant the job needs (this repo's editing maker runs with only `--allow-tool=view,write`).
- **Never auto-merge.** PRs are opened, not merged; anything uncertain lands in front of a human.

---

The rest isn't in this guide; it's in the terminal. Set a ceiling, register the schedule,
and watch the first finding land in `state/`.
