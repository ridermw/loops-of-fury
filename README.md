# Loops of Fury: Loop Engineering with Copilot CLI

**Live presentation:** https://ridermw.github.io/loops-of-fury/

A hands-on workshop for practicing loop engineering with GitHub Copilot CLI.

Participants clone this repo, run a small failing test suite, use Copilot CLI to fix the app, then design a bounded maker/checker loop around the same workflow.

## Who this is for

- Engineers who already use coding agents and want to stop hand-cranking repeated prompts.
- Teams evaluating safe agent automation for CI repair, issue triage, PR review, or doc maintenance.
- Facilitators who want a concrete 60-90 minute lab with a cloneable repo.

## What participants learn

By the end, participants can:

1. Explain the difference between prompting, harness engineering, and loop engineering.
2. Use Copilot CLI to inspect a codebase and fix a failing test suite.
3. Write a machine-checkable done-condition before asking an agent to work.
4. Separate a maker prompt from a checker prompt.
5. Draft a loop contract with triggers, budgets, state, stop conditions, and escalation.

## Prerequisites

- Git
- GitHub CLI authenticated with `gh auth login`
- Node.js 20+
- GitHub Copilot CLI access
- A terminal where `npm test` can run

## Quick start

Participants should fork the workshop into their own GitHub account, then clone their fork:

```bash
gh repo fork ridermw/loops-of-fury --clone=true
cd loops-of-fury
npm test
```

Do not clone and push directly to `ridermw/loops-of-fury`. Treat that repo as the instructor-owned upstream.

## Workshop participation model

`ridermw/loops-of-fury` is the source workshop repo. Participants work in their own forks:

```text
ridermw/loops-of-fury        instructor upstream
your-user/loops-of-fury      your fork for workshop work
```

Please do not open pull requests back to the upstream repo during the workshop. The point is to practice loops safely in your own fork, not to contribute fixes upstream. Upstream PRs are automatically closed with a reminder to continue in your fork.

See `CONTRIBUTORS.md` for the upstream maintainer and contribution policy.

The starter app is intentionally broken. The first lab is to use Copilot CLI to make the tests pass without weakening or deleting tests.

## Workshop flow

| Segment | File | Outcome |
|---|---|---|
| Setup | `workshop/00-setup.md` | Everyone can run the failing tests. |
| Lab 1: Orient | `workshop/01-orient.md` | Copilot CLI summarizes the app and failure. |
| Lab 2: Maker | `workshop/02-fix-with-maker.md` | Copilot CLI fixes only the root cause. |
| Lab 3: Checker | `workshop/03-check-with-verifier.md` | A separate checker reviews the diff and evidence. |
| Lab 4: Loop contract | `workshop/04-design-the-loop.md` | Participants design a safe recurring loop. |
| Lab 5: Runbook | `workshop/05-operationalize.md` | Teams adapt the loop to CI, issues, or docs. |

## The sample app

The app models a tiny inventory reservation service. The tests cover:

- SKU normalization
- Stock reservation
- Backorder reporting
- Idempotent reservations

The initial implementation has realistic bugs that are small enough for a workshop and concrete enough for machine verification.

## Core commands

```bash
npm test
npm run check
./scripts/run-checks.sh
```

## Recommended Copilot CLI workflow

Use the prompts in `prompts/copilot-cli/`:

1. Paste `01-orient.md` to understand the repo.
2. Paste `02-maker-fix-tests.md` to fix the failing tests.
3. Paste `03-checker-review.md` in a fresh session or with a separate reviewer.
4. Paste `04-loop-contract.md` to design the reusable loop.

## Facilitator note

Do not let participants start by saying "fix everything." The point is to practice the loop discipline:

- Define done first.
- Keep the maker narrow.
- Verify independently.
- Persist state.
- Stop honestly.

## Reset

If a participant wants to start over:

```bash
git restore src test
rm -f LOOP_PROGRESS.md
```

If you have not initialized git after downloading this folder, re-clone the repo or copy `solutions/inventory.solution.js` as a reference.
