# Upstream issue and PR audit — qz Teach Mode

**Snapshot date:** 2026-11-05. **Purpose:** avoid known recorder, replay, security and CI defects before adopting implementation ideas.

**Confidence:** high that the linked issues/PRs and claims were published on GitHub at the time of inspection; moderate that every claimed defect reproduces on a future baseline until we execute the corresponding fixture. An **open PR is not an accepted patch**, and an issue report does not prove the current branch remains vulnerable. Each disposition below mandates local/cloud code verification before reuse.

**Sources inspected:** official GitHub issue lists, issue details, maintainers' comments and selected PR descriptions, plus source clones. This is a **targeted, risk-based audit**, not an exhaustive review of all historical issues and PRs across every repository. Source SHAs and license mapping are in [PLAN.md](PLAN.md#1-reuse-decision).

## 1. alibaba/qz-browser-agent — baseline fixes before Teach Mode

| Upstream | Finding | Risk to us | Disposition |
| --- | --- | --- | --- |
| [Issue #7](https://github.com/alibaba/qz-browser-agent/issues/7) | User asks how to teach complex ERP/OA systems. Maintainer suggests asking qz to turn the site into a Skill. | Existing natural-language Skill authoring is not proof of manual demonstration recording. | Preserve existing Skill behavior; Teach Mode fills a distinct capture/replay gap. |
| [Issue #8](https://github.com/alibaba/qz-browser-agent/issues/8) | Reported inability to open generated Markdown/JSON artifacts. | Teach Mode evidence export/Skill review could appear successful yet be inaccessible. | Explicit create→download→open/checksum E2E fixture; do not claim fixed from issue title alone. |
| [Issue #18](https://github.com/alibaba/qz-browser-agent/issues/18) | Provider rejects `max_tokens`; expects `max_completion_tokens` (reported for a custom Azure/OpenAI-compatible model). | Compiler may fail on certain providers. | Provider-adapter mock tests; do not conflate with context-reservation PR #17. |
| [PR #15](https://github.com/alibaba/qz-browser-agent/pull/15) | Reported `build:firefox` failure from a stale reviewed fingerprint; PR updates digest. | False CI green if verification does not run final production Firefox build. | Run actual build at pinned baseline; review patch/test; fix baseline or explicitly gate Firefox out of MVP. |
| [PR #16](https://github.com/alibaba/qz-browser-agent/pull/16) | Firefox reportedly rejects `data:` download URLs; proposes `blob:` where supported. | Skill export and verification downloads fail only in Firefox. | Browser-specific download test; do not transplant Chrome service-worker assumptions. |
| [PR #17](https://github.com/alibaba/qz-browser-agent/pull/17) | Compaction reserve may be less than configured output budget and exceed provider context window. | Long recording-to-workflow compilation fails unpredictably. | Test prompt/output budget and provider 400 failures before large trace compile; audit compaction independently. |

**Baseline decision:** Keep upstream `main` clean and tracked. Teach Mode G0 may target Chrome first, but should never advertise Firefox support while a production build/verification gap remains. None of the open PRs has been merged into our project, and none should be accepted without checking actual diffs and tests.

## 2. Tencent/BrowserSkill — primary recorder source

| Upstream | Reported failure or proposed fix | Mandatory qz test / rule |
| --- | --- | --- |
| [Issue #593](https://github.com/Tencent/BrowserSkill/issues/593) / [PR #602](https://github.com/Tencent/BrowserSkill/pull/602) | Real `input[type=submit|reset|image]` click may be dropped as a fill/decorative action; PR proposes explicit button handling. | Capture fill followed by submit/reset/image and nearby search button; assert trusted event and ordering. |
| [Issue #594](https://github.com/Tencent/BrowserSkill/issues/594) / [PR #603](https://github.com/Tencent/BrowserSkill/pull/603) | `textContent` records `AlphaBeta` instead of `Alpha\nBeta` in contenteditable. | Exact multiline semantics with paste/Enter/Shift+Enter, empty and trailing lines; compare actual control value. |
| [Issue #587](https://github.com/Tencent/BrowserSkill/issues/587) / [PR #606](https://github.com/Tencent/BrowserSkill/pull/606) | Sensitive values in original HTML `<textarea>` / `<select>` can escape a redaction mechanism. | Secret canaries in server-supplied HTML, captures, screenshots, logs, exports and model input. Never assume input-only masking is enough. |
| [PR #604](https://github.com/Tencent/BrowserSkill/pull/604) | Recorded accessible label priority can disagree when `aria-labelledby` and `aria-label` coexist. | Target identity test using both attributes, nesting and repeated names. |
| [Issue #438](https://github.com/Tencent/BrowserSkill/issues/438) | Out-of-process iframe focus/keyboard events may route to **root** CDP session instead of iframe. | Real Chromium OOPIF fixture; verify keystrokes do not reach parent frame or wrong account field. |
| [Issue #527](https://github.com/Tencent/BrowserSkill/issues/527) | Observation can wedge a session queue; action context expires while settling. | Deadline, cancellation, queue liveness and service-worker restart tests; no forever-pending workflow. |
| [Issue #531](https://github.com/Tencent/BrowserSkill/issues/531) | Using `crypto.randomUUID` in an insecure HTTP intranet context broke capture. | Real `http://` synthetic intranet fixture; fallback to secure ID generator outside page context. |
| [Issue #548](https://github.com/Tencent/BrowserSkill/issues/548) | Iframe editor refs missing due to incomplete geometry. | Never treat frame observation as complete without frame-specific evidence; report unsupported controls. |
| [Issue #502](https://github.com/Tencent/BrowserSkill/issues/502) | Export artifacts reportedly created world-readable. | Data file mode, scoped permissions and redacted storage test; no credentials in filesystem exports. |
| [Issue #544](https://github.com/Tencent/BrowserSkill/issues/544) / [PR #563](https://github.com/Tencent/BrowserSkill/pull/563) | CLI values in process arguments can expose secrets. | Secret value never in CLI argv, shell command, URL, transcript or Skill; secret reference or controlled channel only. |
| [Issue #598](https://github.com/Tencent/BrowserSkill/issues/598) | Unobservable child frames can abort cooperation despite an earlier merged fix not yet released. | Record an inaccessible child frame with an accurate partial-evidence warning; do not hang/abort whole tab by default. |
| [Issue #607](https://github.com/Tencent/BrowserSkill/issues/607) | Permission-denied during cooperation observation. | Read-only observation must be scoped and cause-specific; no silent permission escalation. |

**Decision:** This is the highest-value **design and selective-code** source for browser-only Teach Mode. But the listed problems demonstrate why copying its recorder wholesale is unsafe. Reuse its state/action/result model and test ideas. Reimplement or adapt narrowly inside qz's session/ownership model. Keep qz recorder disabled until the high-risk cases pass.

**PR status nuance:** #602, #603 and #606 were open at inspection. Their authors describe extensive browser regression coverage, but our project has **not** independently run those suites. Treat their patches as proposals, inspect full patches and licenses before importing, and compare against the current source baseline.

## 3. OpenAdaptAI/OpenAdapt — workflow compiler and verification source

| Upstream | Why it matters | qz design response |
| --- | --- | --- |
| [Issue #1968](https://github.com/OpenAdaptAI/OpenAdapt/issues/1968) | Nightly main pipeline reportedly red on multiple jobs at surveyed commit. | Do not adopt the Python runtime wholesale or claim CI health from README. Pin version and build our own TS tests. |
| [Issue #1858](https://github.com/OpenAdaptAI/OpenAdapt/issues/1858) / [PR #1954](https://github.com/OpenAdaptAI/OpenAdapt/pull/1954) | Earlier benchmark observed harmful writes *after* verifier success. The reported benchmark predates later late-recheck changes, so it does **not prove** current code fails. | Distinguish provisional/final; explicit async late-write fault fixture; do not retry uncertain commits. |
| [Issue #1472](https://github.com/OpenAdaptAI/OpenAdapt/issues/1472) / [PR #1962](https://github.com/OpenAdaptAI/OpenAdapt/pull/1962) | Non-exact/fuzzy read-back could confirm neighboring values; PR says earlier code already fixed it. | Exact field/record identity; independent check rather than text similarity. Test regardless of upstream status. |
| [Issue #1872](https://github.com/OpenAdaptAI/OpenAdapt/issues/1872) | Optional browser extension requested to capture network, frames and shadow DOM beyond accessibility. | Confirms rich browser evidence as a separable adapter. qz already supplies an extension environment; avoid separate desktop recorder in MVP. |
| [Issue #1890](https://github.com/OpenAdaptAI/OpenAdapt/issues/1890) | Untrusted intake text can steer taught-tool parameters. | Parameter-source mapping, provenance, allowlisted consumer steps, prompt-injection fixtures. |
| [Issue #1903](https://github.com/OpenAdaptAI/OpenAdapt/issues/1903) | Interruption/re-auth/retry and focus-steal recovery is not trivial. | Session epoch, abort, resumption state and no unauthorized re-clicking after uncertain writes. |
| [Issue #1899](https://github.com/OpenAdaptAI/OpenAdapt/issues/1899) | Old encrypted bundles should survive schema upgrades. | Typed version migrations, content digests, forward-compatible readers, no silent behavior rewrite. |
| [Issue #1854](https://github.com/OpenAdaptAI/OpenAdapt/issues/1854) | Verifier should bind to precise version and history changes. | Verify exact ID and revision, and account for possible late/background writes. |
| [Issue #1897](https://github.com/OpenAdaptAI/OpenAdapt/issues/1897) | Locale/date order/keyboard layouts can change meanings. | Declare locale/keyboard preconditions; test non-English inputs including Hebrew. |
| [Issue #1921](https://github.com/OpenAdaptAI/OpenAdapt/issues/1921) | Scaling error can misplace geometry clicks. | Coordinates are last-resort; browser semantic locator preferred; test zoom/DPR. |
| [PR #1904](https://github.com/OpenAdaptAI/OpenAdapt/pull/1904) | Designs independent UI read-back with provisional and final evidence. | Borrow verification contract, not an entire native implementation. |
| [PR #1763](https://github.com/OpenAdaptAI/OpenAdapt/pull/1763) | Browser teach writes tied to explicit authorization. | Bind human approval to requested write operation and exact target. |

**Decision:** Port **ideas**: typed IR, pre/postconditions, qualifications, immutable provenance, independent write verification, stable final receipts, fail-closed ambiguity. Do not treat a sophisticated published claim as proof that the system has solved all false-success cases. Our own G4 must prove them in isolated fixtures.

## 4. microsoft/skill-recorder — optional desktop and Skill authorization

| Upstream | Risk | qz response |
| --- | --- | --- |
| [Issue #8](https://github.com/microsoft/skill-recorder/issues/8) / [PR #40](https://github.com/microsoft/skill-recorder/pull/40) | Generated `allowed-tools` may exceed the human-approved plan; tool patterns complicate naive set-subset checks. | **P0 authorization invariant:** compiler output may only narrow reviewed capability patterns. Test wildcard subsumption and malicious addition. |
| [Issue #17](https://github.com/microsoft/skill-recorder/issues/17) / [PR #33](https://github.com/microsoft/skill-recorder/pull/33) | Re-export path from persisted workflow can escape intended root. | Validate paths within Skill package, normalize and reject traversal/symlinks. |
| [Issue #13](https://github.com/microsoft/skill-recorder/issues/13) | Deleting a recording can race with background post-processing. | Cancellation revokes lease and rejects late writes. Disable delete until durable cleanup. |
| [Issue #12](https://github.com/microsoft/skill-recorder/issues/12) | Edits persisted without payload-shape validation. | Strict schema validation on every edit/import and storage migration. |
| [Issue #10](https://github.com/microsoft/skill-recorder/issues/10) | Large audio file decoded wholly in memory. | If audio added later, stream/chunk, enforce time/byte budgets and disposal. |
| [PR #103](https://github.com/microsoft/skill-recorder/pull/103) | Generic `agent-browser` integration proposal. | Evaluate for future portability; do not couple qz's MVP to its agent runtime. |

**Decision:** No Electron/Copilot dependency in MVP. **Adopt the permission-boundary lesson now**, not in a later desktop phase.

## 5. NousResearch/hermes-labs-plugins — quick recorder prototype source

| Upstream | Risk | qz response |
| --- | --- | --- |
| [Issue #26](https://github.com/NousResearch/hermes-labs-plugins/issues/26) / [PR #30](https://github.com/NousResearch/hermes-labs-plugins/pull/30) | CDP WebSocket endpoint discovery may discard query string. | Preserve exact endpoint identity; test URL parser and parameterized transport. |
| [PR #15](https://github.com/NousResearch/hermes-labs-plugins/pull/15) | `cssPath` fails when attribute values contain quote/backslash. | Escape selectors and prefer semantic targeting; inject adversarial attribute fixtures. |
| [PR #17](https://github.com/NousResearch/hermes-labs-plugins/pull/17) | Raw events are unbounded in memory during long captures. | Bounded chunking and backpressure. Consider explicit truncated/partial marker rather than silently dropping earliest events. |

**Decision:** Useful for the G0 throwaway bridge, not the primary native recorder. Its current lightweight event types do not carry enough target state and verification evidence for a production experience compiler. Do not use unbounded Python event buffers in qz.

## 6. brenoepics/video-to-skill — future import path

| Upstream | Finding | Decision |
| --- | --- | --- |
| [Issue #37](https://github.com/brenoepics/video-to-skill/issues/37) | GUI postconditions need verification through accessibility/VM snapshots. | Existing video alone cannot certify GUI action outcomes; defer to separate adapter. |
| [Issue #38](https://github.com/brenoepics/video-to-skill/issues/38) | Suggests inverse-dynamics action labels for GUI-heavy videos. | Experimental inference must be low-confidence and reviewed. |

**Decision:** Do not rely on extracted frames to determine precise click, focus, frame, or data write effects in core Teach Mode. Import may suggest a draft Skill but must qualify through live structured capture/replay.

## 7. Risk gate register

These are our *project priorities*, not upstream maintainers' severity labels.

| Gate | Priority | Trigger | Evidence to close |
| --- | --- | --- | --- |
| SEC-PERM | **P0** | Generated Skill broadens allowed tools/domains | Wildcard/explicit escalation attack rejected before publication |
| SEC-LEAK | **P0** | Secret remains in captured DOM, form, screenshot, URL, event, request, export, log or model input | Synthetic canary test across all persistence/output boundaries |
| WRITE-ID | **P0** | Replay writes wrong target, retries uncertain commit or counts late harm as success | Exact identity + late-write/timeout/duplicate fault injection |
| FRAME | **P0** | Keyboard action sent to wrong document/OOPIF | Real cross-origin iframe test with parent and child sentinel fields |
| SESS-LEASE | **P0** | Old run mutates after cancel/stop/restart | Revoked epoch and cross-tab concurrency tests |
| CAP-EVENT | **P1** | Missed submit/reset click or multiline edit | Real browser trace matches all observed events/values |
| CAP-BOUNDS | **P1** | Long session exhausts memory or drops data silently | Stream chunk/backpressure test; deterministic incomplete-trace marker |
| TARGET | **P1** | Duplicate selectors, broken escaping or mislabeled element | Unique target resolution or explicit abstain |
| VERIFY | **P1** | Download or write shown as verified without independent evidence | Verified/unverified/failure statuses in receipts |
| CI-BASE | **P1** | Baseline Chrome/Firefox build not reproducible | Pinned clean cloud build and relevant package suite |
| MODEL | **P1** | Provider token parameter or context-budget incompatibility | Provider-mock tests and graceful compiler error |
| UX | **P2** | Missing progress, long stalls, unexpected dialogs | Test observable stop/review/repair workflow |

## 8. Which upstream PRs to consider incorporating?

**Not a blanket merge list.** Our rules are:

1. For qz: evaluate #15–#17 against pinned baseline. Keep baseline remediation commits separate from Teach Mode features and run affected checks. Do not assume #17 resolves Issue #18.
2. For BrowserSkill: inspect #602, #603, #604 and #606; build equivalent unit/browser tests in our own repository **before** porting any code, ensure dependency closure and notices.
3. For Hermes: use #15 and #17 as failing fixtures if the G0 bridge uses its recorder. Discard the bridge after native recording proves itself.
4. For Microsoft: use #40 as an adversarial authorization test even if we never import the Skill Builder.
5. For OpenAdapt: study #1904/#1954 concepts and test them independently; avoid direct runtime cherry-picks into MV3.
6. Re-check upstream state at the start of each implementation task. A PR open on 2026-11-05 may be merged, amended, superseded or rejected later.

## 9. Audit execution status

- [x] Identified account `Code-Glider` and upstream `alibaba/qz-browser-agent`.
- [x] Cloned and inspected source layouts, core recorder/IR implementations and licenses.
- [x] Surveyed open issues and PRs for qz, BrowserSkill, OpenAdapt, Hermes, Microsoft and video-to-skill.
- [x] Inspected details for selected P0/P1 issues and selected PR descriptions.
- [ ] Reproduce each selected failure on isolated cloud Chromium fixture.
- [ ] Inspect code diffs and tests before applying any upstream PR logic.
- [x] Create actual GitHub fork under `Code-Glider` and verify upstream association.
- [x] Commit the audit and plan to the dedicated docs branch while preserving `main`.
- [ ] Prove current qz production Chrome and Firefox baseline in CI; mark Firefox unsupported until green.
- [ ] Complete independent acceptance and security test results; no implementation or test pass is claimed in this audit.

