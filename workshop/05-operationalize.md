# 05 - Operationalize

## Goal

Adapt the workshop loop to a real team workflow.

## Pick one workflow

- CI repair
- Dependency upgrades
- Flaky-test hunt
- Doc drift repair
- PR babysitting
- Issue triage

## Design checklist

- What event or cadence triggers it?
- What exact command or rubric proves done?
- What paths can it edit?
- What credentials are unavailable to it?
- Where does it write progress?
- What is the maximum budget?
- What causes escalation?
- Who reviews the output?

## Anti-patterns

- No done-condition.
- Maker grades itself.
- No budget cap.
- No persistent state.
- Production credentials in the sandbox.
- Untrusted input plus private data plus outbound communication.
- Output volume greater than human review capacity.

