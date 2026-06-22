# Loop Contract Template

Use this template when adapting the workshop into a real team loop.

## 1. Objective

What should become true?

## 2. Trigger

What starts the loop?

- Schedule:
- Event:
- Manual command:

## 3. Discover / intake

What data does the loop read to choose work?

## 4. Workspace and blast radius

Where can the loop act?

- Allowed paths:
- Forbidden paths:
- Allowed branches:
- Forbidden actions:
- Sandbox:

## 5. Context

What files, docs, skills, or state must the loop read first?

## 6. Maker

What agent role does the work?

Maker prompt summary:

```text

```

## 7. Checker

What independent verifier decides whether the work is done?

Checker prompt or command:

```text

```

## 8. Done-condition

What exact command, test, rubric, or exit code proves success?

```bash

```

## 9. Budget

- Max attempts:
- Max runtime:
- Max token or dollar budget:
- Max files changed:

## 10. Persistent state

Where does the loop write progress so a fresh run can resume?

## 11. Stop conditions

- Goal met:
- Budget spent:
- Stalled:
- Needs human:

## 12. Escalation path

Where does the loop send ambiguous, risky, or failed work?

## 13. Security controls

- Secrets unavailable to loop:
- Untrusted input handling:
- Outbound communication restrictions:
- Human approval gates:

## 14. Review policy

Who reviews the output before it merges, ships, or sends?

