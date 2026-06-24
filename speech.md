# Loops of Fury — Speaker Script

> Full read-aloud script for the talk. Mirrors the embedded reveal.js speaker notes (press **S** during the deck). 31 slides.

---

## Slide 1 — Loops of Fury — Loop Engineering

Welcome. The title is “Loops of Fury,” but the real subject is loop engineering — the discipline of building systems that prompt your agents, instead of you sitting there prompting them by hand all day. If you have spent the last two years typing into a chat box and babysitting the output, this talk is about how that job is changing under your feet.

Look at the six words under the title: discover, delegate, verify, persist, decide, stop. That is not decoration — those six verbs are the spine of everything that follows, and by the end you will be able to hear a colleague describe a workflow and tell them which of the six they are missing. The one-line thesis is right there too: stop hand-cranking agents; build the loop that prompts them, verifies their work, remembers state, and knows when to stop.

Here is the reframe to hold from the first second. For two years the unit of work has been the prompt, and you were the runtime — the thing in the chair, copying output, deciding what to type next. This talk is about moving you up one level: from operating the machine to designing the system the machine runs inside. You do not leave; you move from the inner loop to the outer loop, and you stay accountable there.

Quick roadmap so you know where we are going. First a shared vocabulary and a working definition. Then the four genuinely hard parts — stopping, context rot, tool design, and having something that says no. Then the failure modes and the two ceilings that will actually limit you. Then a real production case study from Stripe, a twelve-field contract you fill in before any unattended run, and finally a hands-on workshop where you build one yourself. Vocabulary, hard parts, contract, proof, practice — in that order.

One promise: nothing today is hypothetical. Every pattern here is something people are running in production this year, and the deck you are looking at was itself built and hardened by one of these loops — I will show you the receipts near the end.

---

## Slide 2 — Why this matters (Boris Cherny)

The quote on the screen is Boris Cherny — creator and head of Claude Code at Anthropic, by most measures the fastest-growing AI coding tool in the world. His background is not what you’d expect: he studied economics, dropped out at eighteen to run a startup, did a stint at a hedge fund, then spent five years as a principal engineer at Meta before joining Anthropic in September 2024. Claude Code literally began as a toy he built to tell him what song he was listening to; he shipped the first internal version a couple of months later, and twenty percent of Anthropic’s engineers were using it on day one.

When and where did he say this? It was the spark for the whole “loop engineering” moment, in mid-2026. Cherny said publicly that he no longer prompts Claude directly, and that — his words — “my job is to write loops.” Within that same week Peter Steinberger told developers to go design the loops that prompt their agents, and that Sunday Google’s Addy Osmani published the post that actually gave the pattern its name. So this one line is the trigger; the term we use all talk was coined right off the back of it.

Why did he say it — what’s the context? He is automating his own job, deliberately. By his own account he had not written a line of code himself in more than six months, and he calls coding, for the work he does, effectively “solved.” And his workflow is concrete loops, not vibes: one he calls “babysit-prs” runs every five minutes to fix failing builds, another called “pr-pruner” runs hourly to close stale PRs, hundreds of agent runs fire overnight, and every fix the agents make is written back into a shared CLAUDE.md that is checked into the repo, so the system gets smarter over time. That is what “I write loops” actually looks like in practice.

Has he walked it back, or doubled down? He doubled down — hard. In a follow-up Platformer interview he predicted the title “software engineer” could start to disappear by the end of the year, dissolving into a broader “builder” role as designers, PMs, and managers begin shipping their own code; he compares the shift to the printing press. One nuance to keep in your back pocket: he is not doom about jobs — he predicts a hundred times more people writing code with agents, just not called “engineers.” So if someone in the room pushes back, that is your answer: he has gone further, not softer, and he thinks the pie gets bigger.

The reason this opens the talk: it relocates the unit of work. For two years the unit was the prompt, and you were the runtime. Cherny’s claim is that the unit is now the loop, and your job moved up a level — from operating the machine to designing the line the machine sits on. Everything else today is how to do that responsibly.

---

## Slide 3 — The shift

Let us make the shift concrete, because it is the whole reason this discipline exists. The “before” column is the life you already know: you prompt, the agent responds, you read it, you decide whether it is good, and you prompt again. Notice who is doing the looping in that picture — you are. You are the scheduler, the memory, and the quality gate all at once. You are the runtime. And that works fine right up until you want more than one of these running, or you want it running while you sleep.

The “after” column moves every one of those jobs into the system. A system discovers the work — it notices the failing build or the stale PR — instead of waiting for you to notice. It delegates the work to an agent. It checks the result against something real. It persists state somewhere durable so the next run knows what the last run did. And it decides what comes next: continue, retry, stop, or call a human. The verbs that used to live in your head now live in the loop.

But here is the part people get wrong, and it is the most important sentence on this slide: you step out of the inner loop, you do not step out of responsibility. You move from the inner loop to the outer loop. Down in the inner loop you were approving each diff; up at the outer loop you are designing the triggers, writing the done-conditions, setting the budgets, and deciding when the thing escalates to you. The accountability does not disappear — it relocates upward, and it gets more leveraged, because one decision you make at the outer loop now governs hundreds of runs.

Keep that image — human out of the inner loop, human accountable at the outer loop — because every hard part, every failure mode, and every security rule later in this talk is really about protecting that outer-loop accountability when you are no longer watching each step.

---

## Slide 4 — The trivial loop

On the screen is the entire agent loop, and I want you to notice how boring it is. While true: call the model with the current context; if it asked to use tools, run them and append the results; otherwise, break. That is it. Four or five lines — a first-year CS student writes this in their sleep.

Why do I keep calling it trivial, and why does that matter? Three reasons. First, it is completely undifferentiated: every serious agent system on earth has this exact inner loop. Claude Code, Codex, LangChain, the raw OpenAI and Anthropic SDKs — open any of them and you find the same model-to-tools-to-context-and-repeat. Nobody has a secret while-statement. The New Stack put it bluntly this month: the loop is twenty lines.

Second, the loop contains no judgment. The while-statement does not know what work to do, what “done” means, when it is safe to act, or when to stop — it just spins. All of the intelligence is rented from the model you are calling, which is a commodity everyone can buy, and all of the value you add lives in what you wrap around the loop, not in the loop itself.

Third — and this is the punchline — because the loop is trivial, the loop is not where the engineering is. If those twenty lines were the hard part, everyone would already be winning, and they are not. The hard, differentiating, career-defining work is everything outside the while: the harness that hands the agent its tools, the verifier that decides whether the output is actually real, the memory that survives a single run, and the brakes that stop it. So the honest question this slide sets up — the one the rest of the talk answers — is simple: if the loop is this trivial, what are we actually engineering?

---

## Slide 5 — So what are we engineering?

So if the loop itself is trivial, what are we actually engineering? This diagram is the answer, and it is basically the whole talk on one slide. Follow the arrows: the model looks at the context, decides whether to call a tool, the tool acts on the real world, the results get appended back to the context, and we repeat — until the model ends its turn. That cycle is the commodity. The model in the middle is rented; everyone can buy the same one.

The engineering is the four things wrapped around that cycle. The harness — what tools the agent can reach, what state it can touch, what permissions it has. The verifier — the thing that looks at the output and decides whether it is actually correct, not just whether the agent stopped talking. The memory — what survives after a single run ends, so the system is not amnesiac. And the brakes — the budgets and stop-conditions that keep it from running forever or burning your money.

Read the small print on the diagram, because it is the trap the rest of the talk keeps returning to: “ending a turn does not equal finishing the task.” The model deciding to stop emitting tool calls is a conversational event. It is not a measurement of success. The harness, the verifier, the memory, and the brakes exist precisely to bridge that gap — to turn “the agent stopped” into “the work is genuinely done.”

So hold this picture in your head like a blueprint. Harness, verifier, memory, brakes. Every remaining slide fills in one of these four boxes — the hard parts, the building blocks, the contract, the failure modes are all just detail on this one diagram. Our job is never the while loop. Our job is everything around it.

---

## Slide 6 — Four floors

Four floors — and the fastest way to make them stick is one concrete example of each, climbing the same bug all the way up.

Ground floor, prompt engineering — what should I tell the model? You turn “fix the bug” into “Fix the failing test test_expired_token in test_auth.py; the token lifetime check is off by one, so it should return 401, not 403.” Same model, same tools — you just worded the single instruction better. That is the whole floor.

Second floor, context engineering — what should the model see, what to retrieve, summarize, or clear out? Now you stop pasting the whole two-hundred-file repo into the window. You feed it just the three relevant files, the failing test output, the API contract, and your CLAUDE.md conventions, and you trim the stale stuff as the run goes. You are curating the field of view, not the sentence.

Third floor, harness engineering — which tools, which actions, what counts as done? You give the agent a run-tests tool, an idempotent open-PR tool so a retry cannot open five duplicate PRs, read-only database credentials so it cannot drop a table, and error messages that say “column user_id is nullable in three rows — backfill first” instead of just “failed.” You are designing the environment of one run.

Top floor, loop engineering — how does it make a run repeat itself, over and over? This is Cherny’s babysit-prs: every five minutes, discover the failing builds, send a maker to fix each one in its own worktree, send a separate checker to verify it against the tests, write what it learned back to memory, and stop when the build is green. Stripe’s Minions loop is the same floor at scale — roughly thirteen hundred pull requests a week. Notice the ladder: say it better, show it better, equip one run, then orchestrate many. Today we live on the top floor — but every floor underneath still has to be solid.

---

## Slide 7 — Working definition

Here is the working definition for the rest of the hour, taken straight from the paper: a single turn of a loop is five moves — discovery, handoff, verification, persistence, and scheduling. In one sentence, the loop finds work worth doing, hands it to an agent, verifies whether the result is right, saves state, then decides the next step. And here is the test that makes it precise: drop any one of those five and, in the paper’s exact words, the loop will not turn, or will turn in place.

Walk them. Discovery is the loop finding its own work — yesterday’s failing tests, the open issues, the red build — and the paper is blunt that discovery sets the ceiling: a loop is only ever as good as the work it notices. Handoff is giving that work to an agent, each finding in its own worktree, so two fixes never collide. Verification is the move the paper calls the hardest — putting a check inside the loop that can say no. A loop without a real check is just an agent nodding at itself.

The last two. Persistence is writing state to disk so the next turn picks up where this one left off — the agent forgets, the repo does not. And scheduling is the move that actually makes it a loop: as Osmani puts it, automations are what make a loop an actual loop and not just one run you did once. That is the load-bearing idea here — a cron job repeats, but a loop decides. It looks at the evidence and chooses: continue, retry, stop, or escalate.

So whenever you are unsure whether the thing you are building is a loop in our sense, run the five moves against it. If it cannot find its own work, cannot hand it off cleanly, has nothing that can say no, forgets everything by morning, or never wakes itself up — then it is missing a move, and it will turn in place. Name the missing move and you have named the bug.

---

## Slide 8 — Loop lifecycle

This is the same six verbs, but drawn as a pipeline so you can see the order and where the danger lives. Left to right: a trigger fires; the system discovers the specific work to do; it delegates that to an agent; the agent acts — it edits files, runs commands, opens a PR; then it verifies; then it persists what happened; then it decides what comes next, which either loops back to the trigger or stops. That is one full turn of the machine.

Notice that the first half of this pipeline — trigger, discover, delegate, act — is the easy, fun, demo-able half. Anyone can wire up “on a schedule, ask an agent to do a thing.” You can build that in an afternoon and it will look magical in a demo. The trouble is that the magical-demo half is also the half that will quietly destroy your codebase if the second half is missing.

Because the load-bearing step — if you forget everything else, remember this — is verify. Verification is what turns motion into progress. Without it, “act” just means the agent confidently did something, and you have no idea whether that something was right. Every cheap step before verification is also a dangerous step before verification: discovery can find the wrong work, delegation can hand off a bad goal, action can break prod — and you will not know, because nothing checked. Verification is the gate that makes all the cheap steps safe.

A useful test when you look at anyone’s agent setup, including your own: put your finger on where verification happens in their pipeline. If you cannot find it — if the agent acts and then immediately persists or loops with nothing in between checking the work — you have found their bug before they have. The load-bearing step is the one most people leave out.

---

## Slide 9 — What makes it a loop?

Let us get even more reductive. Strip away the jargon and a real loop needs exactly three ingredients. A heartbeat, a memory, and a decision. If it has all three, it is a loop. If it is missing any one, it is something less — and naming which one is missing tells you exactly how it will fail.

Heartbeat first. Something has to start each run that is not you remembering to. A schedule — every five minutes, every night at two. An event — a PR opened, a webhook fired. A failing check — CI went red. Or an adaptive cadence that speeds up when there is work and slows down when there is not. The heartbeat is what makes it recurring rather than a thing you kick off by hand. No heartbeat and you are back to being the runtime.

Memory second, and this is the one people skip. Progress has to live outside the conversation — in files, in issues, on a board, in commit history, in traces. Why outside? Because the conversation is going to be compacted, truncated, or thrown away, and a model that only “remembers” inside its context window is an amnesiac. The slogan later in the deck says it perfectly: the agent forgets, the repo does not. If your loop loses everything when a run ends, it has no memory, and it will redo or undo its own work.

Decision third — the one we already crowned as load-bearing. At the end of each pass the system chooses continue, retry, stop, or escalate, and crucially it chooses for an explicit, statable reason. “Stop because the tests are green.” “Escalate because the same error repeated three times.” Not “stop because the agent seemed done.” Put the three together — heartbeat, memory, decision — and you have a loop. Take any one away and, as the slide says, it is just a long prompt wearing a trench coat.

---

## Slide 10 — Six building blocks

Those three ingredients — heartbeat, memory, decision — get assembled out of six concrete building blocks, and these map directly onto features you already have in tools like Copilot CLI, Claude Code, and the GitHub platform. So this is not abstract architecture; it is a parts list you can shop from today.

Automations are the heartbeat — the scheduled task or the event hook that fires a run without you. Worktrees are isolation: a separate working copy per run so two agents fixing two bugs do not stomp on each other, and so a risky change happens in a sandbox you can throw away. If you take only one operational habit from this talk, it is one worktree per run — “cattle, not pets,” which we will see Stripe do at scale.

Skills are the project knowledge the agent should not have to guess — your conventions, your build commands, your gotchas, written down in something like a CLAUDE.md or AGENTS.md and checked into the repo. This is also where the loop gets smarter over time: every time an agent learns something, you write it back into the skill file, and the next run starts from that knowledge. Connectors are the real tools the agent reaches the world through — GitHub, Linear, Slack, CI, databases. The connectors are also, not coincidentally, your security surface; remember that when we hit the lethal trifecta.

Sub-agents let you split roles instead of asking one agent to do everything — a maker that writes, a checker that reviews, an explorer that gathers context, a reviewer that gates. That separation is the single most important pattern in the talk, and it gets its own slide next. And the sixth block is memory, for the reason we just said: the agent forgets, the repo does not. Six blocks — automations, worktrees, skills, connectors, sub-agents, memory — and the whole rest of the deck is just learning how to combine them without hurting yourself.

---

## Slide 11 — Maker vs checker

If you remember exactly one pattern from this entire talk, make it this one: separate the maker from the checker. Two different agents, two different jobs, two different incentives. Almost every reliable loop in production is, at its heart, a maker and a checker pointed at each other — and almost every loop that quietly goes wrong is one agent trying to do both.

The maker has one job: propose the smallest change that could plausibly satisfy the goal. Small on purpose — small diffs are reviewable, reversible, and easy to verify. The maker is optimistic, it is fast, and — this is the key — it is not trusted. Its output is a proposal, not a fact.

The checker has the opposite temperament by design. It defaults to reject. It does not take the maker’s word for anything; it demands evidence — the test actually ran, the build is actually green, the screenshot actually shows the button. And critically, a good checker acts rather than just reads: it runs the code, drives the browser, executes the query, instead of skimming the diff and nodding. Anthropic’s own findings on this are blunt — agents systematically praise their own work, so you want an independent, skeptical evaluator, and ideally the final say goes to a fresh model with no memory of having written the thing.

Here is the failure this prevents, and why I want it tattooed on the wall: the worker does not grade its own homework. The moment the same agent both writes the code and declares it correct, it has every incentive to declare victory — that is reward hacking, and it is the single most common way loops lie to you. Split the roles, give the checker teeth and a separate set of eyes, and you have built the one thing that makes an unattended loop trustworthy.

---

## Slide 12 — Running the loop in Copilot

This is the slide that makes it real on the tool in your hand. Forget abstract primitives — in GitHub Copilot you build the loop out of three concrete surfaces, and all three are things you can switch on today. The first is Autopilot. In autopilot mode Copilot runs a whole turn end-to-end: it plans, edits, runs the tests, and keeps going without stopping to ask you to approve every step. That hands-off run is the body of the loop.

The second surface is Automations. An automation is a saved prompt that wakes up on its own — on a schedule, like seven every morning, or on a trigger like a new issue or a green build. That is the scheduling move from two slides ago made concrete: a single autopilot run is just one run you did once; wrap it in an automation and it becomes an actual loop that comes back tomorrow whether you remember it or not.

The third is the coding agent. You assign a GitHub issue to Copilot, it spins up its own cloud session, does the work in isolation, and opens a pull request for you to review. That is your handoff and your human gate in a single move — the agent does the run, but a person still approves the merge.

Now notice what is not on this slide: there is no magic slash-loop command that does all of this for you. You compose it — Autopilot for the run, an Automation for the schedule, the coding agent for isolation, and a checker that can still say no before anything merges. Copilot hands you powerful pieces; assembling them into a loop that fits your week is the engineering. That is not a limitation. That is the whole job.

---

## Slide 13 — Hard part 1: stopping

First of the four hard parts: stopping. The trap hiding in here is the difference between a turn and a task, so let us be precise about both.

A “turn” is one trip around that trivial loop from earlier: the model thinks, calls some tools, reads the results, and eventually stops emitting tool calls. That “else: break” is the turn ending. But look at what actually happened — the model decided to stop talking. That is a conversational boundary, an inference decision. It is not a measurement of whether the work is correct.

So why does a turn ending not mean the task is done? Because the model can end its turn for at least four reasons that have nothing to do with success: it genuinely finished; or it ran out of ideas; or it bumped into a context limit; or — the dangerous one — it talked itself into believing it was done when it was not. That last one has a name, reward hacking, and it is exactly why “the agent feels finished” is worthless as a stop signal. “Done” has to be defined outside the agent, by something a machine can check: the tests pass, the build is green, the checker agent exits zero. The maker ending its turn is a proposal. The checker confirming the done-condition is the truth.

Then the obvious question: if the turn ends but the task is not actually finished, how does the task ever get finished? This is the heart of the whole talk — the outer loop finishes it, not the turn. When a turn ends, the loop runs the verifier. If the done-condition holds, great, it stops. If it does not, the loop takes the failure, turns it into the next prompt — this is why good error messages matter so much — and kicks off a fresh turn. It retries, re-prompts, or escalates. The task is finished when the verifier confirms the done-condition, however many turns that takes, or when the loop stops for an honest reason: budget spent, stalled, or needs-a-human.

Cherny’s “babysit-prs every five minutes” is exactly this shape: each turn ends, and the loop re-fires until CI is genuinely green. The turn is just a checkpoint; the loop owns completion. Hold onto that distinction — turn versus task — because every failure mode later in this talk is some version of confusing the two.

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

Eight candidates on the screen — but a category is not a loop until you can see its full anatomy: a trigger that starts it, the context it pulls in, the tools it is allowed to touch, the task itself, a machine-checkable exit, and a named human gate. Let me give you three with the whole anatomy spelled out, because the anatomy is the part people skip.

First, the flaky-test hunt. Trigger: CI had to retry a test to get it green. Context: that test’s pass-fail history and the diff that introduced it. Tools: a sandbox where it can run that one test two hundred times, shuffled and in parallel — and nothing else. Task: reproduce the nondeterminism and either fix the root cause or quarantine the test. Exit: two hundred consecutive green runs, or it gives up. Human gate: if it quarantines rather than fixes, a person gets an issue and decides. Notice the exit is a number, not a vibe.

Second, the dependency upgrade. Trigger: the bot opens a version-bump PR. Context: the changelog and the release notes for that bump. Tools: your own test suite and a build. Task: apply the upgrade, fix whatever the new version broke, and prove nothing regressed. Exit: CI is fully green and no public API signature moved. Human gate: a person still approves the merge — the loop does the labor, you keep the decision. This is the boring one that quietly saves a day a week.

Third, alert triage at 3 a.m. Trigger: a known alert fires. Context: the runbook for that alert plus the last deploy’s diff and timing. Tools: read-only access to logs and metrics, and the ability to post to the incident channel. Task: run the runbook, correlate the alert with the recent deploy, and summarize what it sees. Exit: it has posted a hypothesis and tagged the on-call. Human gate — and this is the load-bearing one — it never rolls back prod. That decision stays with a human, always.

Now a rapid bench of five more, so you see the range. Issue triage: a new issue arrives, it labels, dedupes against existing ones, and asks for a repro — never closes anything itself. Screenshot-diff review: a UI PR triggers it, it renders before and after and flags visual drift for a human eye. Reachable-CVE scan: a new advisory drops, it checks whether your code actually calls the vulnerable path — and here you guard the lethal trifecta, so it reads code and posts findings but has no power to exfiltrate. Data-freshness watch: a dataset goes stale past its SLA and it pings the owner. Infra drift: it diffs deployed state against the Terraform and opens a PR to reconcile. Five triggers, five exits, five gates.

And the one I want you to actually feel — the see-yourself example. Your own morning triage. Trigger: seven a.m. on a schedule. Context: your overnight inbox, your calendar, your open PRs. Tools: read everything, and draft replies. Task: sort what is urgent, draft the three responses you send every morning anyway, and surface the two PRs that are blocking other people. Exit: a single digest in your chat. The human gate is the whole point — it drafts, but it cannot send. You wake up to a prepared desk, not a fait accompli.

Pull the thread through all of them and the theme is identical: every good loop has a machine-checkable exit and a named human gate. So here is your walk-out exercise — pick one of these eight before you leave, and on the back of a card write down its six parts. If you can fill in all six, you can build it Monday. If you get stuck on the exit or the gate, that is exactly the part that was going to bite you.

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

