# Teach Mode — G0 browser demonstration (experimental)

Teach Mode captures a short human demonstration in a task-owned Chromium tab and converts it into
a portable, typed workflow. Replay is **opt-in**, checks the recorded page scope, and returns
step-level verification results. This is the first implementation slice, not a general-purpose
desktop recorder or a production-grade autonomous web transaction engine.

## Use it in qz

1. Open the page inside the task's working tab.
2. Ask the qz agent to call `teach_workflow` with `{ "action": "start" }`.
3. Perform the browser task yourself **without navigating away**. Do not include passwords,
   one-time codes, or API-key input fields in this demonstration.
4. Ask the agent to call `teach_workflow` with `{ "action": "stop", "recordingId": "..." }`,
   using the exact ID returned by `start`.
5. Review the returned `workflow` object. To persist it in qz's existing Skill repository, call
   `teach_workflow` with `action: "install"`, `workflowJson` (serialized workflow), and a unique
   `skillName` such as `teach-update-contact`. This explicit action creates a site-scoped Skill
   without overwriting existing names. You can also save the workflow JSON independently.
6. On the same page, call `teach_workflow` with `action: "preview"` and `workflowJson` equal to the
   serialized workflow object; inspect selector matches before replay. An installed Skill contains
   its own serialized workflow and replay instructions.
7. When explicitly requested by the user, call `teach_workflow` with `action: "execute"`,
   `workflowJson`, and `inputsJson` such as `{ "field_1": "Example", "field_2": "option_id" }`.

Workflow fields are parameters by design. **No typed, pasted, or selected values are recorded**;
they must be supplied for execution. Page URLs exclude query strings and fragments. Selectors may
contain stable element IDs and `data-testid` values. Review traces before sharing.

## Boundaries and failure behavior

- The recorder is scoped to one top-level document. Navigation, cross-origin iframe actions,
  arbitrary desktop apps, Shadow DOM, and background browser tabs are not yet supported.
- Only meaningful clicks, form edits, select changes, Enter/Escape, and page scrolling are collected.
  Unsupported sensitive fields and toggles make the demonstration incomplete; it cannot compile.
- The maximum recording is 120 actions. Exceeding it makes compilation fail rather than quietly
  truncating a workflow. Consecutive keystroke input events are coalesced by target.
- Replay rejects mismatched URLs, invalid targets, absent required input values, submit buttons,
  links, and synthetic keyboard actions. It stops at the first error.
- A successful `.click()` merely means the browser dispatched an event. It does not prove that an
  external action succeeded. `outcomeVerified` is false whenever click actions are involved.
- Use qz's existing page/Session safety checks. Avoid credentials in `inputsJson` until a separate
  secret-reference binding and human approval mechanism exist.

## Cloud verification

The branch workflow `.github/workflows/teach-mode-g0.yml` runs on feature branch pushes, using
Node 24, locked dependencies, TypeScript checks, focused unit tests, and Chromium Playwright tests.
For a dependency-free local smoke test in a cloud container:

```sh
node --test tests/unit/test-teach-workflow.mjs
```

For the complete focused run on a runner with npm dependencies and Chromium:

```sh
npm ci
npm run typecheck
npm test -- unit --match teach
npm run build
npm test -- playwright teach-mode.spec.mjs --workers 1
```

The detailed rollout plan and external project risk audit live in
`docs/teach-mode/PLAN.md` and `docs/teach-mode/UPSTREAM_AUDIT.md` on the planning base branch.
