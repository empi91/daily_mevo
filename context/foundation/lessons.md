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

## Never guess facts, numbers, or claims

- **Context**: All phases, all conversations — universally, any time Claude produces output, analysis, or reasoning.
- **Problem**: Guessed numbers/facts presented as truth erode trust and can lead to wrong decisions. Example: claimed "~600 stations" with no source, presenting a fabrication as knowledge.
- **Rule**: NEVER guess or fabricate facts, numbers, or claims. Always either verify (check the source), ask the user, or explicitly state uncertainty. No other options.
- **Applies to**: all

## Never stage or commit gitignored files

- **Context**: All git operations — any time files are staged or committed
- **Problem**: Gitignored files (secrets, local context, caches) leak into the repo, requiring cleanup commits and potentially exposing sensitive data.
- **Rule**: Never stage or commit gitignored files. Files in .gitignore must stay untracked unless the user explicitly asks and confirms.
- **Applies to**: all

## Never finish a phase with NOT VERIFIED items

- **Context**: Any /10x-implement phase with verification steps
- **Problem**: Agent marks phase complete with NOT VERIFIED items, user believes everything works when it doesn't. User discovers broken/unconfigured infrastructure only later, eroding trust in the agent's verification claims.
- **Rule**: Never finish an implementation phase when verification items are NOT VERIFIED. Stop, explain what cannot be verified and why, discuss with the user, and either resolve the blockers together or get explicit user acknowledgment before proceeding.
- **Applies to**: implement, impl-review

## Always update external trackers when closing a change

- **Context**: Any phase that closes a change — when change.md status is set to complete and the work is reported as done.
- **Problem**: Roadmap, test-plan, and GitHub issues show stale status; the user has to remind the agent to update them. Happened twice across separate sessions on the auth-session-fix change.
- **Rule**: When marking change.md as complete, always update roadmap.md (summary table, detail section, dependency table), test-plan.md (any status references), and GitHub issues (close with root cause summary) before reporting done.
- **Applies to**: implement, impl-review
