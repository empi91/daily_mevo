# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## No unplanned workarounds without explicit approval

- **Context**: All implementation phases — any time code is being written or modified during /10x-implement
- **Problem**: User loses confidence in the agent because changes appear without explanation, making code review harder and eroding trust. The agent silently adds workarounds, extra dependencies, or unplanned code that the user discovers only when reviewing the diff.
- **Rule**: Never add workarounds, dependency changes, or code modifications outside the plan scope without first explaining the issue and getting explicit user approval.
- **Applies to**: implement, impl-review

## Never mark unverified items as done

- **Context**: Any skill that has success criteria or verification steps
- **Problem**: If the agent marks unverified items as done, the progress tracking and success criteria system loses all value — user can't trust any checkmark. The entire verification contract becomes meaningless.
- **Rule**: Never mark a verification item as done unless it has been actually executed and passed. If a check cannot be performed (missing DB, missing token, environment limitation), explicitly report it as NOT VERIFIED — never mark it as passed.
- **Applies to**: all
