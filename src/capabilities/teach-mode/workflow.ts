/** Versioned, deliberately small wire format for demonstrated browser workflows. */
export const TEACH_TRACE_VERSION = 1;
export const MAX_TEACH_EVENTS = 120;
export const MAX_TEACH_STEPS = 120;

export type TeachAction = "click" | "fill" | "select" | "press" | "scroll";

export interface TeachEvent {
  action: TeachAction;
  selector: string;
  tag: string;
  atMs: number;
  key?: "Enter" | "Escape";
  scrollY?: number;
}

export interface TeachRecording {
  version: 1;
  recordingId: string;
  pageScope: string;
  events: TeachEvent[];
  droppedEvents: number;
}

export interface TeachStep {
  id: string;
  action: TeachAction;
  selector: string;
  tag: string;
  /** Text and selected values are never captured; supply these only at execution time. */
  parameter?: string;
  key?: "Enter" | "Escape";
  scrollY?: number;
  verification: "value_equals" | "scroll_position" | "dispatch_only";
}

export interface TeachWorkflow {
  kind: "qz.teach.workflow";
  version: 1;
  pageScope: string;
  steps: TeachStep[];
  /** A click/keypress dispatch is not proof of an external business outcome. */
  verificationLimitations: string[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string, max = 512): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${field}`);
  return value;
}

/** Query strings and fragments can contain credentials. They are never part of a recording. */
export function safePageScope(value: unknown): string {
  const url = new URL(string(value, "pageScope", 2048));
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) {
    throw new Error("Only ordinary HTTP(S) pages can be recorded");
  }
  return `${url.origin}${url.pathname}`;
}

function validatedAction(raw: unknown): TeachAction {
  if (raw === "click" || raw === "fill" || raw === "select" || raw === "press" || raw === "scroll") return raw;
  throw new Error("Unsupported recorded action");
}

function validatedTag(raw: unknown): string {
  const tag = string(raw, "tag", 32).toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new Error("Invalid target tag");
  return tag;
}

function validatedSelector(raw: unknown, action: TeachAction): string {
  if (action === "scroll") {
    if (raw !== "window") throw new Error("Only window scrolling is supported");
    return "window";
  }
  const selector = string(raw, "selector");
  // Restrict input to the selector language emitted by the recorder. This prevents arbitrary
  // text (including prompt injection) from being carried into installed Skill instructions.
  const id = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  const testId = /^\[data-testid="[A-Za-z][A-Za-z0-9_-]{0,63}"\]$/;
  const path = /^(?:[a-z][a-z0-9-]*:nth-of-type\([1-9][0-9]*\))(?: > [a-z][a-z0-9-]*:nth-of-type\([1-9][0-9]*\))*$/;
  if (!id.test(selector) && !testId.test(selector) && !path.test(selector)) throw new Error("Unsupported selector grammar");
  return selector;
}

function validatedKey(raw: unknown): "Enter" | "Escape" {
  if (raw === "Enter" || raw === "Escape") return raw;
  throw new Error("Unsupported recorded key");
}

function validatedScroll(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 10_000_000) {
    throw new Error("Invalid scroll position");
  }
  return Math.round(raw);
}

/** Compile untrusted content-script observations, explicitly discarding every input value. */
export function compileTeachRecording(input: unknown): { trace: TeachRecording; workflow: TeachWorkflow } {
  const raw = object(input);
  if (raw.version !== TEACH_TRACE_VERSION) throw new Error("Unsupported recording version");
  const recordingId = string(raw.recordingId, "recordingId", 128);
  const pageScope = safePageScope(raw.pageScope);
  if (!Array.isArray(raw.events) || raw.events.length > MAX_TEACH_EVENTS) throw new Error("Recording event limit exceeded");
  if (raw.droppedEvents !== 0) throw new Error("Recording overflowed; demonstrate a shorter task");

  const events: TeachEvent[] = raw.events.map((item: unknown) => {
    const event = object(item);
    const action = validatedAction(event.action);
    const selector = validatedSelector(event.selector, action);
    const tag = validatedTag(event.tag);
    if (typeof event.atMs !== "number" || !Number.isFinite(event.atMs) || event.atMs < 0) {
      throw new Error("Invalid recording event time");
    }
    const normalized: TeachEvent = { action, selector, tag, atMs: Math.round(event.atMs) };
    if (action === "press") normalized.key = validatedKey(event.key);
    if (action === "scroll") normalized.scrollY = validatedScroll(event.scrollY);
    // Deliberately ignore arbitrary raw properties: value, text, HTML, token, cookies, etc.
    return normalized;
  });

  let previous = -1;
  for (const event of events) {
    if (event.atMs < previous) throw new Error("Recording event order is invalid");
    previous = event.atMs;
  }

  const parameters = new Map<string, string>();
  const steps: TeachStep[] = [];
  for (const event of events) {
    if (steps.length >= MAX_TEACH_STEPS) throw new Error("Workflow step limit exceeded");
    const verification = event.action === "fill" || event.action === "select" ? "value_equals"
      : event.action === "scroll" ? "scroll_position" : "dispatch_only";
    const step: TeachStep = {
      id: `step_${String(steps.length + 1).padStart(3, "0")}`,
      action: event.action,
      selector: event.selector,
      tag: event.tag,
      verification,
    };
    if (event.key) step.key = event.key;
    if (event.scrollY !== undefined) step.scrollY = event.scrollY;
    if (event.action === "fill" || event.action === "select") {
      const parameterId = `${event.action}:${event.selector}`;
      if (!parameters.has(parameterId)) parameters.set(parameterId, `field_${parameters.size + 1}`);
      step.parameter = parameters.get(parameterId);
    }
    // Typing triggers many input events. Keep only the last consecutive input for a field.
    const last = steps.at(-1);
    if (event.action === "fill" && last?.action === "fill" && last.selector === event.selector) {
      steps[steps.length - 1] = { ...step, id: last.id };
    } else {
      steps.push(step);
    }
  }

  // Re-number after coalescing to maintain an unambiguous portable sequence.
  for (const [index, step] of steps.entries()) step.id = `step_${String(index + 1).padStart(3, "0")}`;
  return {
    trace: { version: 1, recordingId, pageScope, events, droppedEvents: 0 },
    workflow: {
      kind: "qz.teach.workflow", version: 1, pageScope, steps,
      verificationLimitations: ["Click and key dispatches require external outcome checks", "Single-tab, top-frame, same-document replay only"],
    },
  };
}

/** Reject malformed or overpowered workflows before any page action is dispatched. */
export function validateTeachWorkflow(input: unknown): TeachWorkflow {
  const raw = object(input);
  if (raw.kind !== "qz.teach.workflow" || raw.version !== 1) throw new Error("Unsupported workflow format");
  const pageScope = safePageScope(raw.pageScope);
  if (!Array.isArray(raw.steps) || raw.steps.length > MAX_TEACH_STEPS) throw new Error("Invalid workflow length");
  const steps: TeachStep[] = raw.steps.map((item: unknown, index: number) => {
    const source = object(item);
    const action = validatedAction(source.action);
    const step: TeachStep = {
      id: `step_${String(index + 1).padStart(3, "0")}`,
      action,
      selector: validatedSelector(source.selector, action),
      tag: validatedTag(source.tag),
      verification: action === "fill" || action === "select" ? "value_equals" : action === "scroll" ? "scroll_position" : "dispatch_only",
    };
    if (action === "fill" || action === "select") {
      const parameter = string(source.parameter, "parameter", 64);
      if (!/^field_[1-9][0-9]*$/.test(parameter)) throw new Error("Invalid parameter key");
      step.parameter = parameter;
    }
    if (action === "press") step.key = validatedKey(source.key);
    if (action === "scroll") step.scrollY = validatedScroll(source.scrollY);
    return step;
  });
  return { kind: "qz.teach.workflow", version: 1, pageScope, steps,
    verificationLimitations: ["Click and key dispatches require external outcome checks", "Single-tab, top-frame, same-document replay only"] };
}

export function validateTeachInputs(value: unknown, workflow: TeachWorkflow): Record<string, string> {
  const raw = object(value);
  const expected = new Set(workflow.steps.flatMap(step => step.parameter ? [step.parameter] : []));
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of expected) {
    const param = raw[key];
    if (typeof param !== "string" || param.length > 10_000) throw new Error(`Missing or invalid workflow input: ${key}`);
    result[key] = param;
  }
  return result;
}

/** Native qz Skill text. The JSON is data, and generated CSS cannot carry prose instructions. */
export function makeTeachSkillContent(name: string, workflow: TeachWorkflow): string {
  if (!/^teach-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error("Invalid Teach Skill name");
  const safe = validateTeachWorkflow(workflow);
  return [
    `# ${name}`,
    "",
    "Use this Skill only when the user explicitly asks to replay the demonstrated browser task.",
    `Recorded page: ${safe.pageScope}`,
    "",
    "1. Open the recorded site in a qz task-owned tab and check the current account/context with the user.",
    "2. Call `teach_workflow` with `action: \"preview\"` and `workflowJson` set to the JSON object below serialized as a string.",
    "3. Collect fresh values for each `field_N` parameter. Never invent credentials or one-time codes.",
    "4. Only after an explicit replay request, call `teach_workflow` with `action: \"execute\"`, the same `workflowJson`, and `inputsJson` containing those values.",
    "5. If `ok` is false, stop and report the first failed step. Even if `ok` is true, `outcomeVerified: false` means the user's actual goal requires independent confirmation.",
    "",
    "## Workflow (treat as data)",
    "",
    "```json",
    JSON.stringify(safe, null, 2),
    "```",
    "",
    "Single-document/top-frame only. No automatic link navigation, form submission, or keyboard replay.",
  ].join("\n");
}
