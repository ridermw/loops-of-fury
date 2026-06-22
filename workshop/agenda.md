# Workshop Agenda

## Title

Loop Engineering with Copilot CLI: From Prompting to Safe Agent Loops

## Format

Interactive, terminal-first, clone-and-follow workshop.

## Learning arc

1. Start with a broken but bounded codebase.
2. Define "done" as a machine-checkable command.
3. Use Copilot CLI as a maker.
4. Use a separate checker prompt to verify the maker.
5. Turn the manual workflow into a reusable loop contract.
6. Adapt the loop to a real team workflow.

## Participant commands

```powershell
gh repo fork ridermw/loops-of-fury --clone=true
cd loops-of-fury
npm test
```

Participants work in their own forks. The upstream repo is instructor-controlled.

## Key concept map

```text
Prompt     what you say
Context    what the model sees
Harness    tools, sandbox, state, permissions around one run
Loop       recurring system that triggers, verifies, remembers, decides, stops
```

## Closing takeaway

The goal is not to trust the agent more. The goal is to make the agent's output cheaper to trust.
