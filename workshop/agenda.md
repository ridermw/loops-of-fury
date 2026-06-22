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

```bash
git clone <your-workshop-repo-url>
cd loop-engineering-copilot-cli-workshop
npm test
```

## Key concept map

```text
Prompt     what you say
Context    what the model sees
Harness    tools, sandbox, state, permissions around one run
Loop       recurring system that triggers, verifies, remembers, decides, stops
```

## Closing takeaway

The goal is not to trust the agent more. The goal is to make the agent's output cheaper to trust.

