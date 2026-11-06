/** This module runs only in the DOM isolated world, never in qz's background worker. */
interface TeachStep {
  id: string;
  action: "click" | "fill" | "select" | "press" | "scroll";
  selector: string;
  tag: string;
  parameter?: string;
  key?: "Enter" | "Escape";
  scrollY?: number;
  verification: "value_equals" | "scroll_position" | "dispatch_only";
}

interface ActiveTeachCapture {
  recordingId: string;
  pageScope: string;
  queryDigest: string;
  events: Array<Record<string, unknown>>;
  droppedEvents: number;
  dispose(): void;
}

/**
 * Chrome serializes this function into the isolated world. Keep all runtime helpers inside it;
 * imports, module variables, and privileged browser APIs are intentionally unavailable there.
 */
function startTeachCapture(recordingId: string, maxEvents: number, queryDigest: string) {
  const container = globalThis as typeof globalThis & { __qzTeachCaptureV1?: ActiveTeachCapture };
  container.__qzTeachCaptureV1?.dispose();
  if (window.top !== window) return { ok: false, code: "TOP_FRAME_REQUIRED" };
  if (!/^https?:$/.test(location.protocol)) return { ok: false, code: "UNSUPPORTED_PAGE" };
  if (!/^[a-f0-9]{64}$/.test(queryDigest)) return { ok: false, code: "INVALID_QUERY_FINGERPRINT" };

  const state: ActiveTeachCapture = {
    recordingId, pageScope: `${location.origin}${location.pathname}`, queryDigest, events: [], droppedEvents: 0,
    dispose() { /* assigned after listeners are constructed */ },
  };
  const start = performance.now();

  function selectorFor(element: Element): string | null {
    // Stable names only. Never encode input text, aria labels, user-selected options, or page HTML.
    const safeAttribute = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
    const id = element.getAttribute("id");
    if (id && safeAttribute.test(id)) {
      const selector = `#${CSS.escape(id)}`;
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const testId = element.getAttribute("data-testid");
    if (testId && safeAttribute.test(testId)) {
      const selector = `[data-testid="${testId}"]`;
      if (document.querySelectorAll(selector).length === 1) return selector;
    }

    const parts: string[] = [];
    let cursor: Element | null = element;
    for (let depth = 0; cursor && depth < 16; depth++) {
      const tag = cursor.tagName.toLowerCase();
      const parent: Element | null = cursor.parentElement;
      const siblings = parent ? Array.from(parent.children).filter(child => child.tagName === cursor?.tagName) : [];
      const index = siblings.indexOf(cursor) + 1;
      parts.unshift(`${tag}:nth-of-type(${Math.max(index, 1)})`);
      const selector = parts.join(" > ");
      if (selector.length > 512) return null;
      if (document.querySelectorAll(selector).length === 1) return selector;
      cursor = parent;
    }
    return null;
  }

  function append(action: string, element: Element | null, extra: Record<string, unknown> = {}) {
    const selector = action === "scroll" ? "window" : element ? selectorFor(element) : null;
    if (!selector) { state.droppedEvents++; return; }
    const tag = action === "scroll" ? "html" : element!.tagName.toLowerCase();
    const item = { action, selector, tag, atMs: Math.round(performance.now() - start), ...extra };
    const previous = state.events.at(-1);
    if (previous && previous.action === action && previous.selector === selector
      && (action === "fill" || action === "scroll")) {
      state.events[state.events.length - 1] = item;
      return;
    }
    if (state.events.length >= maxEvents) { state.droppedEvents++; return; }
    state.events.push(item);
  }

  function sensitiveField(element: Element): boolean {
    const input = element as HTMLInputElement;
    if (input.type === "password" || input.type === "file" || input.type === "hidden") return true;
    const hint = `${element.getAttribute("name") || ""} ${element.getAttribute("id") || ""} ${element.getAttribute("autocomplete") || ""}`;
    return /password|secret|token|api.?key|credit.?card|one.?time|otp|auth.?code|cc-number|cc-csc/i.test(hint);
  }

  function onClick(event: MouseEvent) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const target = event.target.closest("button, a, [role='button'], [role='menuitem'], [role='tab'], input[type='submit'], input[type='button']");
    if (target) append("click", target);
  }

  function onInput(event: Event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const target = event.target;
    if (!target.matches("input, textarea, [contenteditable='true']")) return;
    if (sensitiveField(target)) { state.droppedEvents++; return; }
    const inputType = (target as HTMLInputElement).type;
    // Toggle state is not supported by the first executor. Reject the complete demonstration
    // instead of silently omitting a meaningful user action.
    if (inputType === "checkbox" || inputType === "radio") { state.droppedEvents++; return; }
    append("fill", target);
  }

  function onChange(event: Event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    if (event.target.matches("select")) {
      if (sensitiveField(event.target)) { state.droppedEvents++; return; }
      append("select", event.target);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    if (event.key === "Enter" || event.key === "Escape") append("press", event.target, { key: event.key });
  }

  function onScroll(event: Event) {
    if (event.target === document || event.target === window) append("scroll", null, { scrollY: Math.max(0, window.scrollY) });
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("keydown", onKeydown, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  state.dispose = () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("scroll", onScroll);
  };
  container.__qzTeachCaptureV1 = state;
  return { ok: true, recordingId, pageScope: state.pageScope, limit: maxEvents };
}

/** Stop and remove the listeners in the same isolated document in which they were installed. */
function stopTeachCapture(recordingId: string) {
  const container = globalThis as typeof globalThis & { __qzTeachCaptureV1?: ActiveTeachCapture };
  const state = container.__qzTeachCaptureV1;
  if (!state || state.recordingId !== recordingId) return { ok: false, code: "RECORDING_NOT_FOUND" };
  state.dispose();
  delete container.__qzTeachCaptureV1;
  return {
    ok: true, recording: {
      version: 1, recordingId: state.recordingId, pageScope: state.pageScope, queryDigest: state.queryDigest,
      events: state.events, droppedEvents: state.droppedEvents,
    },
  };
}

/** One bounded replay operation. The caller validates the workflow and checks cancellation after each step. */
function operateTeachStep(input: { pageScope: string; step: TeachStep; value?: string; execute: boolean }) {
  const { pageScope, step, value, execute } = input;
  if (`${location.origin}${location.pathname}` !== pageScope) {
    return { ok: false, code: "PAGE_SCOPE_CHANGED", verified: false };
  }
  if (step.action === "scroll") {
    if (execute) window.scrollTo({ top: step.scrollY || 0, behavior: "instant" });
    const verified = execute && Math.abs(window.scrollY - (step.scrollY || 0)) <= 2;
    return { ok: !execute || verified, code: execute && !verified ? "SCROLL_NOT_VERIFIED" : "OK", verified };
  }
  let element: Element | null;
  try { element = document.querySelector(step.selector); }
  catch { return { ok: false, code: "INVALID_SELECTOR", verified: false }; }
  if (!element || element.tagName.toLowerCase() !== step.tag) {
    return { ok: false, code: "TARGET_MISMATCH", verified: false };
  }
  if (!(element as HTMLElement).getClientRects().length) {
    return { ok: false, code: "TARGET_NOT_VISIBLE", verified: false };
  }
  if (!execute) return { ok: true, code: "PREVIEW_ONLY", verified: false };

  const credentialHint = `${element.getAttribute("name") || ""} ${element.getAttribute("id") || ""} ${element.getAttribute("autocomplete") || ""}`;
  if ((element instanceof HTMLInputElement && /^(password|hidden|file)$/.test(element.type))
    || /password|secret|token|api.?key|credit.?card|one.?time|otp|auth.?code|cc-number|cc-csc/i.test(credentialHint)) {
    return { ok: false, code: "SENSITIVE_FIELD_REQUIRES_SECRET_BINDING", verified: false };
  }

  if (step.action === "fill") {
    if (typeof value !== "string") return { ok: false, code: "MISSING_PARAMETER", verified: false };
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.disabled || element.readOnly || element.type === "file") return { ok: false, code: "FIELD_NOT_EDITABLE", verified: false };
      // Native setters notify frameworks which instrument value changes (e.g. React).
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) return { ok: false, code: "VALUE_SETTER_UNAVAILABLE", verified: false };
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      const verified = element.value === value;
      return { ok: verified, code: verified ? "OK" : "VALUE_MISMATCH", verified };
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      if (value.includes("\n")) return { ok: false, code: "MULTILINE_CONTENTEDITABLE_UNSUPPORTED", verified: false };
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      const verified = element.textContent === value;
      return { ok: verified, code: verified ? "OK" : "VALUE_MISMATCH", verified };
    }
    return { ok: false, code: "UNSUPPORTED_FIELD", verified: false };
  }
  if (step.action === "select") {
    if (!(element instanceof HTMLSelectElement) || typeof value !== "string" || element.disabled) {
      return { ok: false, code: "SELECT_NOT_EDITABLE", verified: false };
    }
    if (!Array.from(element.options).some(option => option.value === value)) {
      return { ok: false, code: "OPTION_NOT_FOUND", verified: false };
    }
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    const verified = element.value === value;
    return { ok: verified, code: verified ? "OK" : "VALUE_MISMATCH", verified };
  }
  if (step.action === "click") {
    // Restrict the initial executor to explicit non-submit buttons. Link navigation and form
    // submission need the full qz navigation/safety runtime and independent outcome checks.
    if (!(element instanceof HTMLElement) || (element instanceof HTMLButtonElement && element.type !== "button")
      || element.closest("a, form") || (element instanceof HTMLInputElement && element.type !== "button")) {
      return { ok: false, code: "CLICK_REQUIRES_REVIEW", verified: false };
    }
    element.click();
    return { ok: true, code: "DISPATCHED_UNVERIFIED", verified: false };
  }
  // Synthetic KeyboardEvents cannot reliably reproduce trusted keyboard input.
  return { ok: false, code: "KEYBOARD_REPLAY_NOT_SUPPORTED", verified: false };
}

// The build emits this as a classic content asset. A background capability injects the asset,
// then calls these bounded functions through a second isolated-world injection.
const teachRuntimeGlobal = globalThis as typeof globalThis & {
  __qzTeachRuntimeV1?: {
    start: typeof startTeachCapture;
    stop: typeof stopTeachCapture;
    step: typeof operateTeachStep;
  };
};
teachRuntimeGlobal.__qzTeachRuntimeV1 = {
  start: startTeachCapture,
  stop: stopTeachCapture,
  step: operateTeachStep,
};
