______________________________________________________________________

## description: Wrap up current work

Wrap up the current work by following the checklist below.

**NOTE: If you are low on context and/or if any of the wrap tasks are easily
delegated, feel free to leverage subagents to complete the task(s) to stretch
your remaining context.

**Checklist:**

For all changes/additions made, please:

- Lint the code. It should pass pre-commit checks.
- Check to see if there are any related tests. If there are, update them to
  ensure they reflect the changes/additions made.
- Check to see if there are any related docs. If there are, modify them as
  necessary to account for the changed/added code.
- Check if any skills need updates (NOTE: all skill/resource docs should be \<=
  500 LOC):
  - Activate the "skill-developer" skill to assist with skill maintenance.
- Check that proper code reuse was employed, no DRY violations were introduced,
  and existing codebase patterns were followed. Be wary of magic strings/numbers
  and use constants/enums where appropriate.
- If there are ANY actionable next steps or current problems/failures, detail
  them in the form of an actionable summary for the next session.
- If there is an associated wip/ task, please update it to reflect the current
  status.

When finished, provide a commit message (without any single quotes) summarizing
the changes made.
