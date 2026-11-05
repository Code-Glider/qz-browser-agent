# QZ Teach Mode — cloud-first implementation plan

**Status:** Design and audit committed on `docs/teach-mode-plan`; G0 cloud baseline not yet verified; no implementation merged.
**Prepared:** 2026-11-05
**Intended destination:** `Code-Glider/qz-browser-agent` (verified genuine fork of `alibaba/qz-browser-agent`)
**Base surveyed:** upstream qz `1aaa6ee2d1fb`, branch `main`
**Companion files:** [UPSTREAM_AUDIT.md](UPSTREAM_AUDIT.md) and [BACKLOG.json](BACKLOG.json)

## 0. Decision and constraints

Extend qz rather than build another browser automation stack. Add a native **Teach Mode** that converts one or more demonstrations of an actual browser task into a parameterized, reviewable, validated workflow and a reusable Skill. Preserve qz's browser execution, local-first design, session supervisor, capability framework, Skills, CLI and MCP interface. Reuse external research and selected code behind narrow adapters; do not embed other projects' entire runtimes.

The implementation runs **cloud-first**. GitHub is the canonical source of truth. Use temporary cloud workspaces and GitHub Actions (with Chromium/Playwright fixtures) for builds and verification. Do not require the user's Windows, WSL, macOS or home LAN during design and normal development. Request a local test only after cloud browser-package tests pass and only for a specific environment-dependent behavior that cannot be faithfully tested remotely.

Principles:

1. KISS, SOC, DRY: one authoritative workflow IR and one replay engine.
2. Deterministic-first replay; model calls at compile/repair time, not for each healthy action.
3. Structured, loss-minimizing evidence: retain the redacted raw trace plus derived artifacts and revisions.
4. Every action has an owner, typed preconditions, postconditions, timeouts, and failure semantics.
5. Fail closed for ambiguous targets, incomplete writes, lost permissions, and uncertain side effects.
6. Stable schema versions, provenance, reproducibility, idempotency, and observable execution receipts.
7. Model/provider independence: use qz's current provider interface; no mandatory Copilot/Anthropic/OpenAI dependency.
8. CLI/MCP portability: qz owns the execution engine; exported Skills invoke it through a documented adapter.
9. Respect `AGENTS.md`, especially capability boundaries, background state ownership, write leases, cross-context protocols, and scoped tests.

### Scope

**MVP:** Chrome/Edge tab and navigation flows; clicks, fills, select, keyboard, scroll, downloads; semantic targets; parameters; explicit validation; secure recording; review; deterministic replay; export; synthetic and cloud-browser tests.

**Next:** complex rich-text editors, shadow DOM, cross-origin iframe/OOPIF and popup recovery; multi-demonstration branches; verified website writes with reconciliation; portable CLI integration; responsive UI changes.

**Deferred:** native OS-wide recording, Mac/Windows desktop companion, Citrix/RDP, continuous screen surveillance, extracting desktop workflows from videos, automatic generalization of arbitrary loops from one recording, remote production execution of user credentials, unattended financial transactions. These require their own security and fidelity gates.

### Product example

The user clicks **Teach**, demonstrates filtering Gitea issues and exporting a report, and adds a short spoken or written explanation: “This repository, this label, only open issues.” The recorder saves ordered events and relevant page state. The compiler asks which fields are variable, proposes `repository` and `label`, generates a workflow and tests it with synthetic Gitea fixture data. A successful replay verifies the generated file and saves a versioned Skill. Thereafter the user or a CLI agent invokes the Skill with inputs. A previously unseen dialog stops replay and offers supervised repair.

## 1. Reuse decision

| Source | Pinned research checkout | Reuse | Do not reuse |
| --- | --- | --- | --- |
| qz | `1aaa6ee2d1fb` | SessionSupervisor, capability SDK, tools, Skills, CLI/MCP, Side Panel, existing capture controls | No new second browser agent |
| Tencent/BrowserSkill | `fbea9e8a191e` | Semantic action capture ideas, Trace v3 state/action/result representation, frame-aware target evidence, redaction tests | Its daemon and its tab-control ownership model |
| OpenAdaptAI/OpenAdapt | `9f503bd81157` | Typed IR, contract checks, independent verification, uncertain-write handling, bundles, qualification methodology | Full Python/desktop replay engine in an MV3 extension |
| NousResearch/hermes-labs-plugins | `a6c7854f6fbd` | Simple CDP-to-JSON recorder adapter for a spike, known selector tests | Full Hermes runtime; unbounded or unsanitized event stream |
| microsoft/skill-recorder | `505c97ae47be` | Desktop event schema, intent reconstruction and narration concepts | Electron capture and GitHub Copilot as required dependencies |
| brenoepics/video-to-skill | `7bca75bda527` | Optional future video-import adapter | Video frames as primary source of browser execution evidence |

qz carries Apache-2.0; the other five surveyed codebases carry MIT. Maintain attribution/notice files, verify per-file provenance and dependencies before copying, and preserve upstream copyright and licenses. Prefer implementing adapters from the documented behavior and importing tiny isolated utilities only when their dependency closure is understood. **Do not cherry-pick entire PRs from another repository without tests.**

## 2. Functional requirements

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| F01 | Start, pause, stop, discard recording visibly from qz Side Panel | Stable UI state and a terminal trace; no hidden recording |
| F02 | Record events, tab/frame/document identity, semantic target, before/after page state | Versioned trace fixture reproduces the observed action sequence |
| F03 | Preserve text input including pasted and multiline contenteditable text | No dropped newline, no collapsed empty or trailing line |
| F04 | Record submit, reset, image, ordinary and nested button actions | Click remains in trace after a fill; real submit/reset observed in tests |
| F05 | Redact passwords, OTPs, secrets, tokens, sensitive textarea/select data before persistence and model use | Secret canaries absent from JSON, logs, errors, exports and fixtures |
| F06 | Distinguish navigation, cosmetic interactions and committed writes | Side-effect classification and explicit confirmation gates |
| F07 | Parameterize demonstrated inputs with user approval | Named inputs and typed validation; deterministic substitution |
| F08 | Compile straight-line flows into a typed workflow with pre/postconditions | Schema validation and round-trip serialization |
| F09 | Replay a healthy workflow with zero per-step model calls | Offline replay test verifies `model_calls == 0` |
| F10 | Handle tab changes, frames, shadow DOM and delayed loads without stale targets | Synthetic browser package tests, correct focus and exact target |
| F11 | Verify outputs independently when possible, and report uncertainty honestly | Download hash/read-back or `UNVERIFIED`, never fake success |
| F12 | Recover from cancellation and stale session epochs without late writes | Aborted run cannot commit after lease revocation |
| F13 | Export versioned Skills callable through qz CLI/MCP by different AI clients | Contract test invokes same Skill without client-specific patches |
| F14 | Store provenance, schema versions, redacted traces and execution receipts | Reproducible test from committed synthetic fixture |
| F15 | Human review and correction before activating a new or repaired Skill | Approval scope is immutable/monotonically narrowed |
| F16 | No regression to qz's existing user and external-agent tasks | Focused tests and Chrome package verification |

## 3. Proposed component layout

Follow the repository's capability architecture; a top-level `src/features/teach/` alone would violate its ownership guidance. The actual layout is split by runtime responsibility:

```text
src/
  capabilities/teach/
    index.ts            # Declarative registered contributions
    tools.ts            # manage_teach / run_taught_workflow tool definitions
    ui/                 # Capability-owned Side Panel UI/metadata/style
    skills/             # Bundled Skill authoring/use instructions
  background/teach/
    controller.ts       # Session-bound recording/replay orchestration
    repository.ts       # Versioned storage, migrations, optimistic concurrency
    compiler.ts         # Compiles redacted traces through configured model
    replay.ts           # Deterministic interpreter and retry policy
    verifier.ts         # Contract evaluation, read-back, receipts
  content/teach/
    capture.ts          # Isolated-world event observation, teardown
    locator.ts          # Semantic target and frame-local evidence
  shared/teach/
    protocol.ts         # Cross-runtime messages and errors
    trace.ts            # Demonstration schema and migrations
    workflow.ts         # Workflow schema and invariants
    receipt.ts          # Execution and verification results
tests/
  unit/teach/           # Reducer, compiler-normalizer, schema, permissions
  contracts/teach/      # Cross-context and version migrations
  browser/teach/        # MV3, tabs/frames/shadow/real DOM events
  e2e/teach/            # Record → compile → review → replay → export
  fixtures/teach/       # Synthetic websites, never real user data
```

These are target modules, not an instruction to create every empty file. Introduce each only when its corresponding phase requires it; follow upstream import conventions, registered capability ownership and `#sdk/*` constraints. The background owns persisted state and write authorization; UI only projects and requests actions; content scripts emit sanitized events and hold no durable authority.

### Existing integration points to preserve

- `src/background/session/supervisor.ts`: session, run, epoch, lease, abort and tab ownership.
- `src/capabilities/accessibility/tools.ts`: accessibility snapshots rather than geometric guessing.
- `src/capabilities/script/tools.ts`: `run_script` / `run_skill_script` browser execution; create a narrow interpreter rather than blindly permitting arbitrary generated JS.
- `src/capabilities/skills/workbench.ts`: Skill registry/create/edit/export protocols.
- `src/sidepanel/features/chat/case-recording-feature.ts`: existing screen capture; use as optional evidence, not the semantic event record.
- `services/mcp-bridge/`: existing local CLI/MCP bridge. Do not expose its token to a page.

## 4. Data model and evidence pipeline

### 4.1 Recording lifecycle

`IDLE → RECORDING → PAUSED → RECORDING → FINALIZING → SAVED` or `DISCARDED / FAILED`.

The recording must acquire an explicit **observation** ownership scope without accidentally claiming qz's **write** lease. User-driven page actions may continue; the agent must not race the user's clicks. Starting replay requires a fresh exclusive session/tab ownership check and a new epoch. Shutdown must detach all content listeners and reject late events. A service-worker restart must recover a recorded but interrupted state as **incomplete**, never as finalized.

### 4.2 Raw trace and normalized trace

Keep a bounded, append-only, redacted raw event stream with `event_id`, monotonic time, `session_id`, `tab_id`, `frame_id`, `document_id`, `navigation_id`, capture-source version, action kind, sanitized target evidence, raw observed effect, and confidence. Persist in chunks with explicit size/time limits, not one unbounded in-memory list. Separate screen/video assets by references and retention policies.

Compile this into an immutable `DemonstrationTraceV1` that records `state → action → result.state`, inspired by BrowserSkill Trace v3. Keep raw and reduced records separate: collapsing redirects, debouncing typing and filtering decorative clicks must not erase provenance. Every reducer transformation writes an origin-event mapping. Record after-action state **when stable enough**; otherwise mark the result uncertain and retain timing evidence.

### 4.3 Typed workflow IR (`WorkflowV1`)

```json
{
  "schema_version": 1,
  "workflow_id": "gitea-open-issues-export",
  "revision": 1,
  "input_schema": {
    "repository": { "type": "string", "required": true },
    "label": { "type": "string", "required": true }
  },
  "steps": [
    {
      "id": "s4",
      "operation": "click",
      "target": {
        "role": "button",
        "name": "Export",
        "container": "issues-toolbar"
      },
      "preconditions": ["target_unique", "target_visible", "target_enabled"],
      "postconditions": [{ "kind": "download_created", "mime": "text/csv" }],
      "effects": "download",
      "timeout_ms": 15000,
      "on_mismatch": "stop_and_review"
    }
  ],
  "approval": { "policy": "read_export_only" },
  "provenance": { "demonstration_id": "example-synthetic" }
}
```

This example is a proposed shape, **not** a claim that qz currently understands this schema. The actual schema must be TypeScript-first, parse `unknown` strictly, have versioned migrations, disallow unknown operations by default, and specify stable string error codes. Use the repository's existing validation tooling rather than introducing a second framework unnecessarily.

Locator evidence order: exact accessible role/name within a scoped container → stable `data-testid` or accessible relation → frame-local structural CSS → geometry only as a reviewed, lowest-confidence fallback. Escape attribute selectors, distinguish `aria-labelledby` from `aria-label`, verify uniqueness, and re-resolve after navigation. No best-effort `first()` on an ambiguous write target.

Only recorded behaviors supported by qz's current permissions are executable. An unsupported recorded action becomes a visible `UNSUPPORTED_ACTION` item for review, not a silently skipped step.

### 4.4 Parameter provenance

Typed parameters are explicitly supplied by the operator, a validated connector result, or a recorded constant. Each has `source_kind`, `source_id`, allowed consumer step IDs, sensitivity label, transform and validation rule. Text found in a webpage or document is untrusted data and **cannot become a tool argument merely because a page requests it**. Sensitive parameters reference Infisical or another user-configured secret store by identifier when available; the Skill never stores their values.

For a single demonstration, only infer obvious substitutions and a straight-line procedure. Multiple controlled demonstrations or explicit authoring are required for branches, loops, exception paths and business rules. Proposed alternate paths must be reviewed before activation.

## 5. Replay engine and safety invariants

Replay is an interpreter of typed operations, not generated arbitrary JavaScript. The interpreter runs through qz's existing action/Script bridge under `SessionSupervisor`. Build a stable execution receipt for every step:

`PENDING → PREPARED → EXECUTING → SETTLING → VERIFIED` or `FAILED / UNVERIFIED / CANCELLED`.

1. **Admission:** validate workflow hash/revision, schema, allowed domains, parameter provenance, user permission, session epoch and tab ownership.
2. **Preflight:** resolve the correct document/frame, assert unique target, check expected page identity and any pending irreversible effects.
3. **Actuate:** one action with a bounded deadline/AbortSignal and recorded action key.
4. **Settle:** wait on an observable condition, not a blind `sleep` or fixed delay; handle navigation, popup, overlay and loading changes.
5. **Verify:** evaluate explicit postconditions; for writes, distinguish screen confirmation from independently persisted state.
6. **Commit receipt:** record observed result and evidence references; advance only after contracts pass.

**Irreversible/uncertain operation rule:** a timeout after clicking Save does not justify an automatic retry. Enter `UNCERTAIN_COMMIT`, perform a non-mutating read-back or duplicate check if available, then ask for approval if it cannot be resolved. Idempotency keys are used where the target system supports them; otherwise use exact record identity checks and safe intervention. Resuming a run after a crash must not repeat the last write by assumption.

Do not change a certified workflow in place. On mismatch, optionally run an LLM-assisted repair pass using a *sanitized snapshot* and a bounded repair budget; create a new candidate revision, verify it in the sandbox and seek human approval before promotion. Never let a webpage instruct the agent to expand tools, domains or allowed data scopes.

## 6. Verification model

Three statuses, kept distinct:

- **Verified:** stated postcondition proved using an appropriate observer, such as a content-addressed export, independent read-back of the exact record version, or a deterministic UI assertion for genuinely UI-only changes.
- **Observed but not independently verified:** a confirmation appeared, but persistence/identity/side effects are unproven. Report `UNVERIFIED`; don't silently upgrade confidence.
- **Failed / uncertain:** explicit negative result, stale target, interrupted action, verifier timeout, conflicting read-back or unexpected late write.

For record writes, attach an expected *change set* and protected invariants. Verify the exact target identifier and version, not just display text or a neighboring match. Read the complete relevant history when a paginated API or asynchronous backend makes partial read-back unreliable. Consider provisional verification followed by a late read-back or quiescence window for systems with delayed writes; never claim that a fixed wait mathematically proves absence of future effects.

**Qualification versus certification:** a workflow trained on a synthetic form is *qualified for that fixture*, not automatically certified for an unknown live ERP. Live approval, system-of-record access and environment-specific qualification remain separate gates.

## 7. Skill output and CLI contract

An installed Skill bundle contains:

```text
gitea-issues-export/
  SKILL.md
  workflow.json
  input.schema.json
  manifest.json
  tests/cases.json
  provenance/trace-summary.json
```

`SKILL.md` explains purpose, prerequisites, input variables, allowed domains, side-effect classification, how to invoke qz, verification expectations and troubleshooting. `workflow.json` is the executable source of truth. `manifest.json` includes schema, revision, compiler/model version, source demonstrations, content digests, permitted tool/domain set, and published quality gates; no credentials. The Skills loader must never import `allowed-tools` requested by a model unless **mathematically contained within** human-approved capabilities. An operation that adds permissions requires new approval.

Initial proposed qz tool surface (naming to be reconciled with the capability SDK):

- `manage_teach({ action: start|pause|resume|stop|discard|list|get|compile|review|publish, ... })`
- `run_taught_workflow({ workflow_id, revision, inputs, mode: dry_run|execute, ... })`
- `get_taught_workflow_receipt({ run_id, ... })`

Keep flat schemas where possible, typed results and stable error codes. External agents use these tools through qz's existing local CLI/MCP bridge. A portable Skill in another CLI can describe/invoke the operation but cannot magically execute without qz or a compatible adapter.

## 8. Human review experience

Side Panel flow:

1. **Start teaching:** show owned tab(s), capture scope, redaction mode, recording indicator and consent.
2. **Demonstrate:** live step timeline with target label, browser origin, optional narration and ambiguity markers.
3. **Stop and inspect:** review normalized sequence and explicitly choose variables; scrub/redact mistakes.
4. **Compile:** preview typed workflow and side-effect classification; review permissions before publish.
5. **Practice replay:** run on a test profile/fixture; show step-by-step differences, assertions and evidence.
6. **Approve and save:** create a versioned Skill and record the approved scope; display invocation examples.
7. **Use and maintain:** report actual run outcomes, ask for a corrective demonstration on a new branch when sites change.

Store redacted event traces in local qz repositories by default. On explicit export to a cloud test pipeline, publish *synthetic-only fixtures*; do not upload a real authenticated user's DOM, cookies, tokens, URLs, screenshots or network payloads. No continuous capture in the background.

## 9. Cloud-first development and verification

Canonical development: fork under `Code-Glider`, keep `main` tracking upstream; create independent `feature/teach-*` branches. Prefer PR-quality commits but do **not** open a PR unless requested. Pin baseline and reviewed dependency versions; record which upstream issues/PRs informed each test. Use GitHub Actions as the cloud verification environment, not a personal workstation.

### CI lanes

| Lane | Trigger | Required outcome |
| --- | --- | --- |
| Static | Every feature push | `npm run typecheck`; schema/format/security checks |
| Focused unit | Every feature push | `npm test -- unit --match teach` and changed unit scopes |
| Contracts | Protocol/IR/Skill changes | Version migration, message shape, permission/lease, raw/derived provenance |
| Browser | Capture or replay changes | Chrome for Testing/Playwright MV3 test fixtures, iframe/shadow/popups |
| E2E | End-to-end changes | Teach → compile → practice → verify → Skill → CLI/MCP invocation |
| Packaging | Milestone/release candidate | `npm run build`, `npm run verify:chrome`, artifact inspection |
| Firefox | When Firefox functionality is claimed | Include **production** `npm run build:firefox`, not only verify scripts; test actual package |
| Security | Release candidate | Secret canaries, permission escalation, prompt injection, file path and URL hygiene, duplicate writes |

Respect qz's own tiered test guidance for routine commits; the table is a staged release gate, not a command to run everything after every tiny change. Keep cloud artifacts, failed tests, input fixtures, exact source SHAs and execution receipts. GitHub Actions permissions should be minimal; no publication token in browser tests.

### Mandatory regression fixture matrix

1. A static form with unique labels; a form with duplicate labels in separate containers.
2. HTML `input[type=submit|reset|image]` and a submit button immediately after a search fill.
3. `contenteditable` with Enter, Shift+Enter, empty and trailing newline, paste and IME.
4. iframe, **out-of-process** cross-origin iframe, and shadow DOM slot/open-shadow variations.
5. Dynamic SPA re-render and a navigation that invalidates old targets.
6. Page overlay, modal, hover menu, disabled button, intentionally inaccessible control.
7. Password/OTP/token/sensitive textarea/select/URL query canaries across every export surface.
8. Selectors with quotation marks, backslashes, CSS escapes and Unicode names.
9. Local `http:` synthetic intranet page plus secure `https:` fixture; APIs absent in insecure contexts.
10. Download event and output file hash (including Firefox `blob:` behavior when supported).
11. Session interruption, service-worker restart, action cancellation, stale epoch and concurrent user input.
12. Save succeeded but response timed out; late second write; duplicate record; conflicting/paginated read-back.
13. Untrusted webpage text tries to alter tool name, URL, parameter, permissions or Skill instructions.
14. Recording stream exceeds configured event count/bytes; chunking, backpressure, truncation policy and cleanup.
15. Exported Skill requests a tool/domain outside the human-reviewed authorization: reject.

### Benchmark and go/no-go

Build a replayable set of representative controlled workflows and report **raw counts**, not marketing success claims: number of attempts, passed pre/postconditions, verified output, abstentions, uncertain writes, redaction leaks, unexpected side effects, model calls per healthy replay, runtime and repair revisions. Run the full benchmark at least three times in isolated, resettable fixtures. Do not promote the release while any secret-canary leak, unapproved capability expansion, duplicate write, wrong-record write or stale-epoch mutation remains reproducible. Establish runtime and success-rate targets **after** measuring the baseline; do not invent performance figures.

## 10. Local escalation boundary

No local work is needed for drafting, source inspection, static code changes, unit tests, Chrome package tests or most end-to-end synthetic workflows. Ask the user to involve a local browser **only** if all cloud options are exhausted for one of these cases:

- Confirming interaction with their own authenticated Chrome profile and actual ERP/OA/CRM data.
- An OS-native permission behavior specific to their macOS/Windows desktop.
- A hardware-specific display, secure OS dialog, native file picker or browser-policy limitation that cloud fixtures cannot reproduce.
- Testing a locally hosted service reachable only from their LAN/WSL that cannot safely be mirrored as a synthetic fixture.

When the condition occurs, provide **one concrete test**, exact files/commit, why cloud coverage is insufficient, expected evidence, and how to revert. Prefer disposable Chrome profiles and synthetic accounts. No requirement to clone this project locally before then.

## 11. Delivery phases and gates

### G0 — Fork, audit and cloud baseline

- Create `Code-Glider/qz-browser-agent` as an actual GitHub **fork**, preserve upstream association and default branch. Do not substitute a copy/mirror.
- Add this plan and audit on a dedicated docs branch; avoid editing upstream `main` directly.
- Review qz's current open issues and PRs, especially #15–#17, and pin a known baseline; do **not** merge any without code review/testing.
- Implement a fixture-only read/record/compile/replay spike externally or behind disabled capability flag with no production data.
- **Gate:** cloud build succeeds; one simple demonstrated flow replays deterministically and produces an independently verified output.

### G1 — Native semantic recorder

- Capability registration, UI controls, content-event capture, tab/frame/document identity, semantic evidence, redaction, bounded chunked raw ledger and `TraceV1` reducer.
- Preserve `session_id`, lease safety, abort, worker recovery and all `AGENTS.md` boundaries.
- **Gate:** all recording and secret/selector regression fixtures pass in Chrome.

### G2 — Compiler, parameters and review

- TypeScript schema, strict parser/migrations, parameter provenance, straight-line compiler, user review, side-effect classification, permission constraints, deterministic fixture compilation.
- Distinguish unsupported/low-confidence steps from executable ones.
- **Gate:** trace→workflow round-trip and replay of multiple recordings with zero permission expansion.

### G3 — Interpreter and browser reliability

- Integrate typed interpreter into qz's existing browser execution/Script bridge; target uniqueness, frame targeting, dynamic waits, cancellation, retries limited to demonstrably read-only actions.
- **Gate:** synthetic multi-tab/frame/shadow/cloud browser suites pass; model calls zero for healthy workflow replay.

### G4 — Verification, uncertainty and repair

- Postconditions, file hash, safe read-back, exact record identity, duplicate/late-write checks, receipts, fault injection, guarded model-assisted repair with new revision and user review.
- **Gate:** no false verified result in fault-injection fixtures; all unsafe/ambiguous writes stop or are independently reconciled.

### G5 — Skill export, CLI/MCP and cloud beta

- Package SKILL.md, typed IR, input schema, manifest, tests, provenance and tool policy; provide agent-client adapters and persistent revisions.
- Run Chrome release and Firefox gates when claimed, publish cloud beta artifacts only on explicit release approval.
- **Gate:** cloud CI green and cross-client calls use same qz execution contract; no real-profile/local dependency.

### G6 — Conditional extensions (separate decisions)

- Desktop capture via a companion app (not MV3 privilege escalation); optional video-to-skill import; native file dialogs; advanced branches/loops; continuous drift monitoring; authenticated real-site qualification with explicit local gate.
- **Gate:** new threat model, permission/capability review, independent adapter tests and user authorization.

`BACKLOG.json` contains granular task IDs, dependencies and acceptance tests. A coding agent begins with the first ready item and runs qz's prescribed smallest relevant quality gate before proceeding. Stop on a blocker or unverified core assumption; preserve the failure evidence and open a follow-up task.

## 12. Design questions requiring evidence, not upfront user decisions

1. Can qz's session lease admit a passive recording observer concurrently with a human's tab interactions without violating write authority? Prove with a race test before choosing hooks.
2. Can a Skill host execute the compiled IR under existing tools without `run_script` arbitrary-code exposure? Spike the least-privileged bridge and measure.
3. Which real user instructions/inputs may be retained? Default synthetic cloud fixtures; exact retention policy only after privacy tests.
4. Does normalized trace schema need video/screenshot evidence for every action, or only ambiguous ones? Measure cost and recording usability.
5. Can qz's model provider handle the compiler's structured output across supported providers, including those with differing token parameters? Add provider-mock contract tests.
6. What independent verifier can be configured for a target without exposing secret credentials to the extension or cloud CI? Never fabricate an API read-back.

## 13. Release governance and upstream tracking

- Record upstream commit SHA and source license for each imported fragment. Review future upgrades as dependency changes.
- Treat open PR descriptions as hypotheses until their patch and tests are inspected. Prioritize actual reproducible source defects before cosmetic improvements.
- Keep upstream-facing fixes separate from Teach Mode features when practical.
- Preserve versioned workflow and recording migrations; do not let a schema upgrade silently change runtime semantics.
- Require explicit authorization before creating releases, tags, or uploading distributable browser extensions.
- Provide rollback by disabling Teach Mode and returning to qz's existing Skills without data loss; no destructive migration.

## 14. Immediate next actions and current blocker

1. **GitHub fork verified:** GitHub API confirms `Code-Glider/qz-browser-agent` is writable, `fork=true`, `parent.full_name=alibaba/qz-browser-agent`, default branch `main` at `1aaa6ee2d1fb5a948ff57d57b55de96f72299fb9`.
2. **Documentation committed:** `docs/teach-mode-plan` contains `PLAN.md`, `UPSTREAM_AUDIT.md` and `BACKLOG.json` under `docs/teach-mode/`. The branch was created from pinned `main` without changing `main`.
3. **Next:** start G0 cloud baseline on `feature/teach-mode-g0` with synthetic test fixtures and no production credentials. The current scratch runner has Node.js 24, but `npm ci --offline` cannot complete because the locked `zod-to-json-schema` tarball is not cached; use an authorized cloud runner with npm registry access. This is an environment cache limitation, not evidence of a qz test failure.

