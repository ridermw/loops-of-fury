# Loops of Fury — Speaker Script

> Full read-aloud script for the talk. Mirrors the embedded reveal.js speaker notes (press **S** during the deck). 31 slides.

---

## Slide 1 — Loops of Fury — Loop Engineering

Welcome. This is a research briefing on loop engineering — the discipline of building systems that prompt your agents instead of you prompting them by hand.

The one-line thesis is on the screen: stop hand-cranking agents. Build the loop that prompts them, verifies their work, remembers state, and knows when to stop.

By the end you will have a shared vocabulary, the hard parts to watch for, and a concrete contract you can fill in before you ever run one unattended.

---

## Slide 2 — Why this matters (Boris Cherny)

Boris Cherny, who leads Claude Code at Anthropic, put it bluntly: I do not prompt Claude anymore. I have loops that are running. My job is to write loops.

That is the whole shift in one sentence. The unit of work is moving from the prompt to the loop. Hold onto that quote — everything else today is how to do it responsibly.

---

## Slide 3 — The shift

Before, you lived inside the inner loop. You prompt, the agent responds, you inspect, you prompt again. You were the runtime.

Now a system discovers the work, delegates it, checks it, persists state, and decides what comes next.

You step out of the inner loop — but you stay accountable at the outer loop. That accountability never leaves you, and that is a theme we will return to.

---

## Slide 4 — The trivial loop

Here is the agent loop everyone already has. The model produces tool calls, you run the tools, append the results to context, and repeat until it stops.

Nobody is competing on this while statement. The loop itself is trivial — a first-year could write it.

So if the loop is trivial, the obvious question is: what are we actually engineering?

---

## Slide 5 — So what are we engineering?

Not the while loop. The interesting work is everything wrapped around it.

The harness that hands the agent its tools. The verifier that checks the output. The memory that survives a single run. And the brakes that stop it.

That diagram is basically the whole talk. Hold the picture; we will fill in each piece.

---

## Slide 6 — Four floors

Picture four floors. Prompt engineering asks: what should I say. Context engineering asks: what should the model see.

Harness engineering asks: what tools, state, errors, and permissions surround one single run.

Loop engineering sits on top and asks: what recurring system drives work toward a goal across many runs. Today we are living on the top floor.

---

## Slide 7 — Working definition

So here is our working definition. Loop engineering is designing a recurring agent system that discovers, delegates, verifies, persists, decides, and stops.

The load-bearing word is decides. A cron job repeats on a clock. A loop looks at evidence and decides. That difference is the entire discipline.

---

## Slide 8 — Loop lifecycle

The lifecycle, left to right: a trigger fires, the system discovers work, delegates it, acts, verifies, persists, and decides what to do next.

If you remember only one step, remember verification. It is the load-bearing step — every other step is cheap and dangerous without it.

---

## Slide 9 — What makes it a loop?

Three ingredients turn a one-shot agent into a real loop. A heartbeat — a schedule, an event, a webhook, a failing check, or an adaptive cadence.

Memory — progress lives outside the conversation, in files, issues, boards, and traces.

And a decision — continue, retry, stop, or escalate, always for an explicit reason. No heartbeat, no memory, no decision: it is just a long prompt.

---

## Slide 10 — Six building blocks

Six building blocks you will assemble. Automations are the heartbeat that starts runs. Worktrees give isolation for parallel or risky changes.

Skills are the project knowledge the agent should not have to guess. Connectors are the real tools — GitHub, Linear, Slack, CI, databases.

Sub-agents play roles: maker, checker, explorer, reviewer. And memory, because the agent forgets but the repo does not.

---

## Slide 11 — Maker vs checker

This is the most important pattern in the talk: separate the maker from the checker.

The maker proposes the smallest change that could satisfy the goal. The checker defaults to reject, verifies with evidence, and decides whether done is actually real.

The rule to tattoo on the wall: the worker does not grade its own homework.

---

## Slide 12 — Loop vs. goal

Two primitives. A loop repeats on a cadence — its risk is that it can repeat forever without ever proving success.

A goal runs until a condition is verified — and it is only ever as good as the done-condition you wrote.

One clarification so nobody gets tripped up: these are patterns, not literal commands. Copilot CLI runs copilot dash p with a prompt; the slash-commands you may have seen belong to other tools.

So on Copilot CLI there is no native goal or loop command — which means you write the while-loop yourself around copilot dash p. That is not a limitation. That is the whole job description.

---

## Slide 13 — Hard part 1: stopping

Now the four hard parts. The first is stopping.

An agent ending its turn is not the same as completing the task. Done has to mean the tests pass — not that the agent feels good about its work.

---

## Slide 14 — Honest stop conditions

Four honest reasons to stop. Goal met — the verifier confirms the done-condition. Budget spent — iterations, time, tokens, or dollars hit the cap.

Stalled — the same failure repeats with no new evidence. Or needs-human — the work is risky, ambiguous, taste-driven, or regulated.

If a loop stops for any reason that is not on this list, it did not finish — it quit.

---

## Slide 15 — Hard part 2: context rot

The second hard part: context rot. Long loops accumulate stale tool output, dead ends, and obsolete reasoning.

And it compounds viciously. A rotted context makes worse decisions, which add more noise, which rot the context further. Left alone, the loop gets dumber over time.

---

## Slide 16 — Context hygiene

Four moves to fight rot. Compact long runs into a clean handoff. Offload huge outputs to files and feed back only the relevant slices.

Distill messy subtasks through sub-agents that return just the result. And govern durable memory like you govern code — with review.

Carry a small handoff capsule every time: goal, state, evidence, next move. Context is a budget, not a bucket.

---

## Slide 17 — Hard part 3: tool design

Third hard part: tool design. Keep tools few and focused — if a human cannot tell which tool to use, the agent has no chance.

Make writes idempotent, so retries never create duplicate customers, tickets, commits, or charges. Make errors agent-readable, so they name the next move.

And least privilege — scope each tool by what the loop can break, not by what you are hoping it does.

---

## Slide 18 — Good error messages become prompts

This is the highest-leverage slide in the deck. Good error messages become prompts.

Bad: Migration failed. That is a dead end. Good: Migration failed because column user underscore id is nullable in three rows. Next step: backfill those rows, or add a nullable migration first.

The good one tells the agent exactly what to do next. Write your errors for the dumbest future reader — which, in a loop, is the agent.

---

## Slide 19 — Hard part 4: something says no

The fourth hard part: something has to say no. A loop with no critic is just an agent nodding along to its own work.

Give it a real adversary — tests, typechecks, linters, rubrics, reviewers, and human gates. The critic is what makes the loop trustworthy.

---

## Slide 20 — LangChain's stacked loops

LangChain frames maturity as stacked loops. Level one automates a task; level two wraps it in a verification loop for correctness.

Level three is event-driven, on real triggers. Level four is hill-climbing — it improves the harness from its own traces. You climb one rung at a time.

---

## Slide 21 — What loops are good for

Eight candidates on the screen — but a category is not a loop until you can see its five parts. Let me make three real.

Flaky-test hunt: the trigger is a test CI had to retry to pass; the loop reads its history, runs it two hundred times shuffled, and either fixes the nondeterminism or quarantines it. The exit is binary — two hundred green, or a human gets an issue.

Dependency upgrade: the bump PR from the bot is the trigger, the changelog is the context, your own test suite is the tool — and it stops only when CI is green and no public signature moved.

Alert triage: a known alert fires, the loop runs the runbook, correlates with the last deploy, and posts what it sees — but it never rolls back prod. That decision stays yours.

Same shape every time: a machine-checkable exit, and a named human gate.

---

## Slide 22 — Case study: Stripe’s Minions

Here is the flagship real-world example, and it is the newest material in this deck: Stripe’s Minions.

One production loop ships roughly 1,300 pull requests a week. It is a fork of Goose run at scale, and deterministic gates decide what actually merges.

Every run gets an ephemeral Devbox on EC2 — cattle, not pets. Humans set the direction; the loop does the toil.

Credit to Steve Kaliski at Stripe. This is not a demo — it is loop engineering in production, today.

---

## Slide 23 — When not to loop

The honest flip side — when not to loop. When there is no machine-checkable done-condition. When it is a one-off that will not amortize the design cost.

When it is taste, strategy, architecture, or product judgment. When it is high intent-debt legacy work. Or when it is safety-critical or regulated output with no human gate.

Knowing when not to build a loop is just as much a part of the skill as building one.

---

## Slide 24 — Security: the lethal trifecta

Security. Simon Willison’s lethal trifecta. Three ingredients. Private data — your repos, secrets, tickets, and customer records.

Untrusted input — issues, PRs, web pages, logs, even dependency text. And an outbound channel — PRs, Slack, email, web requests, artifacts.

Any one of these alone is fine. All three together, running unattended, is exactly how data gets exfiltrated. Break one leg before you go unattended.

---

## Slide 25 — Failure modes

Four failure modes to name so you can spot them. The doom loop — it repeats forever. Silent death — it looks alive but makes no real progress.

Reward hacking — it passes the checker without actually solving the problem. And the handoff gap — undefined outputs quietly become someone’s downstream assumption.

---

## Slide 26 — The two ceilings

Two ceilings will limit you. Money — multi-turn loops re-bill the entire history on every turn, so bound tokens, time, turns, and dollars explicitly.

And you. You can only merge as many diffs as you can genuinely understand. Scale the fleet to your review rate, not to your ambition.

---

## Slide 27 — The debt trilogy

Three kinds of debt. Technical debt lives in the code — agents can often pay it down.

Comprehension debt lives in people — recoverable, but only with active review. Intent debt is the why, and agents cannot pay it. Humans must write it down.

---

## Slide 28 — The loop contract

So before your first unattended run, write the loop contract. Twelve fields.

Objective, trigger, intake, workspace, context, maker, checker, done-condition, budget, state, escalation, exit.

If you cannot fill these in, you are not ready to run unattended. Treat this slide as your pre-flight checklist.

And here is how you know the contract is real and not theater. You are thinking in loops when you can write the done-condition as a command that exits zero or one before you write the maker; when the trigger is a clock or an event, not you remembering; and when the checker is a different agent than the maker.

You are not there yet when the goal is fix everything with no boundary a machine can see, when the done-condition is a vibe like make it nicer, or when the loop has never once said no.

The tell: if you reach for a loop to avoid judgment, wrong smell. To spend your time on judgment, right smell.

---

## Slide 29 — The improvement ledger

Proof this actually works. This very deck was built and hardened by a loop.

109 verified improvements landed. The trigger rested when there was nothing to do, the verifier stayed green, every axis got stronger, and there were zero broken states.

Render up 28, hygiene up 27, freshness up 27, delight up 27. The loop graded itself honestly and climbed. That is the whole thesis, demonstrated.

---

## Slide 30 — The workshop

Now we build one together. In the workshop we will fork a repo, use Copilot CLI as the maker, use a separate checker prompt, and then write the loop contract.

One rule: fork first, work in your own account, and keep upstream clean. Open the workshop deck and let us get hands-on.

---

## Slide 31 — References & close

These are your sources — they are on the screen; read them later, I will not recite a bibliography at you. The term was surfaced in one week by Steinberger, Cherny, and Osmani, and named in writing by Osmani.

Here is what to leave with instead. The how is solved. The loop is twenty lines: copilot dash p, a checker that exits zero or one, a while-loop, a budget cap. Nobody is going to hand you the part that matters — which recurring pain in your week is worth wrapping, and why it is worth your judgment to gate it.

Two people build the same loop from the same parts and get opposite outcomes six months later; the difference is one or two checkpoints, placed by taste. The how is a commodity. The what and the why are yours. Now let us go build some loops.

---

