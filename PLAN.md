- ADD OBSERVABILITYYYY!!!

- Get the approved exemplars.csv (BG-04)

- merge fp04 to main
- merge features/bg to main

- Seed them replacing dev placeholders.

- continue work on fp04 and features/bg.

After the work is done in an OpenCode worktree, the flow is essentially the normal git flow plus cleanup:

1. **Review & verify in the worktree**
   - `git status` / `git diff` to confirm the scope.
   - Run your gates: typecheck, lint, tests, build.

2. **Commit** the work on the worktree's branch (the worktree has its own branch checked out).

3. **Get it merged**
   - Push the branch and open a PR, or merge it into the main branch locally (`git checkout main && git merge <branch>`), depending on your workflow.
   - Keep the worktree around until the merge is confirmed, so you don't lose a contested branch.

4. **Remove the worktree** once merged
   - Use `tools.opencode.worktree_remove` with the worktree's absolute directory.
   - If it has uncommitted/untracked leftovers, removal needs `force` — only do that after you've confirmed nothing valuable is unsaved.

5. **Session housekeeping**
   - If your OpenCode session is pinned to the worktree directory, you can send it back to the main repo with `tools.opencode.session_move` (omit the session ID to move the current session).
   - You can confirm what exists with `tools.opencode.worktree_list`.

Key caveats:

- Don't force-remove a worktree until its branch is merged or pushed — removing it discards the working directory.
- A git worktree still shares the same object store/remote, so commits made there are reachable from the main repo once the branch is merged or pushed.

For your current chore specifically: the changes are committed nowhere yet — so the order here would be review → commit → merge/PR → `worktree_remove`.
