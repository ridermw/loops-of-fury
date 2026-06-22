# 04 - Design the loop

## Goal

Turn the manual maker/checker workflow into a loop contract.

## Scenario

Your team wants a daily loop that notices failing inventory tests and prepares a small PR, but never merges on its own.

## Done-condition

You can fill out every section of the loop contract:

- Objective
- Trigger
- Intake
- Workspace
- Context
- Maker
- Checker
- Done-condition
- Budget
- Persistence
- Escalation

## Suggested prompt

Paste `prompts/copilot-cli/04-loop-contract.md` into Copilot CLI.

## Important distinction

A cron job repeats. A loop discovers, verifies, persists, decides, and stops.

