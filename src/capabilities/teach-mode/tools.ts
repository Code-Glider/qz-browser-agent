import type { ToolContext, ToolExtensionAPI } from "#sdk/background";
import { MAX_TEACH_EVENTS, compileTeachRecording, safePageScope, validateTeachInputs, validateTeachWorkflow } from "./workflow.js";
import { operateTeachStep, startTeachCapture, stopTeachCapture } from "./page-runtime.js";

/** The first slice of Teach Mode: single-document capture, portable workflow, guarded replay. */
export default function registerTeachTools(qz: ToolExtensionAPI): void {
  const { ToolExecutionError } = qz;

  function targetTab(context: ToolContext, explicit?: number): number {
    const tabId = explicit ?? context.workingTabId;
    if (typeof tabId !== "number" || !Number.isSafeInteger(tabId) || tabId <= 0) {
      throw new ToolExecutionError("SESSION_TAB_TARGET_REQUIRED", "Teach Mode requires a task-owned working tab.");
    }
    return tabId;
  }

  function assertActive(signal: AbortSignal | undefined) {
    if (signal?.aborted) throw new ToolExecutionError("OPERATION_ABORTED", "Teach Mode was cancelled.");
  }

  async function inject<Args extends unknown[], Return>(tabId: number, func: (...args: Args) => Return, args: Args, signal?: AbortSignal): Promise<Awaited<Return>> {
    assertActive(signal);
    const result = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false }, world: "ISOLATED",
      func, args,
    });
    assertActive(signal);
    if (result.length !== 1 || result[0]?.result === undefined) {
      throw new ToolExecutionError("TEACH_PAGE_UNAVAILABLE", "The page did not return a Teach Mode response.");
    }
    return result[0].result as Awaited<Return>;
  }

  function parseJson(input: string | undefined, label: string, optional = false): unknown {
    if (optional && !input) return {};
    if (!input || input.length > 65_536) {
      throw new ToolExecutionError("TEACH_INVALID_ARGUMENT", `${label} must be JSON under 64 KiB.`);
    }
    try { return JSON.parse(input) as unknown; }
    catch { throw new ToolExecutionError("TEACH_INVALID_JSON", `${label} is not valid JSON.`); }
  }

  qz.registerTool({
    name: "teach_workflow",
    description: `Teach Mode for an explicitly task-owned browser tab. Actions:
start: listen for the user's real clicks, non-secret form edits, and scrolls on the current document;
stop: stop recording using the returned recordingId, then return a redacted versioned trace and reusable workflow;
preview: check selectors and page scope without making page changes;
execute: replay a previously reviewed workflow with explicit input parameters and stop on the first failed check.
The initial recorder is limited to the top frame and a single document. It NEVER stores typed values. Password/OTP and other sensitive fields mark the recording incomplete. Link navigation, form submission, and trusted keyboard replay are unsupported and never counted as success. Do not execute a workflow without the user's explicit request to replay it.`,
    get parameters() { return {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "stop", "preview", "execute"], description: "Which Teach Mode operation to perform." },
        tabId: { type: "number", description: "Optional task-owned browser tab ID; defaults to the current session's working tab." },
        recordingId: { type: "string", description: "Recording ID returned by start; required to stop that same recording." },
        workflowJson: { type: "string", description: "The versioned workflow object serialized as JSON, for preview and execute." },
        inputsJson: { type: "string", description: "A JSON object mapping field_1, field_2, etc. to user-provided values. Required for form replay." },
      },
      required: ["action"],
    } as const; },
    page: "owned",
    timeout: { defaultMs: 60_000, maxMs: 180_000 },
    execute: async ({ action, tabId, recordingId, workflowJson, inputsJson }, signal, context = {}) => {
      const target = targetTab(context, tabId);
      assertActive(signal);
      await qz.assertTabAllowed(target, { sessionId: context.sessionId, runId: context.runId, operation: "teach_workflow" });
      assertActive(signal);
      const tab = await chrome.tabs.get(target);
      const scope = safePageScope(tab.url);

      if (action === "start") {
        const id = crypto.randomUUID();
        let result: Awaited<ReturnType<typeof startTeachCapture>>;
        try { result = await inject(target, startTeachCapture, [id, MAX_TEACH_EVENTS], signal); }
        catch (error) {
          // A cancelled injection may already have installed listeners. Revoke them explicitly.
          await chrome.scripting.executeScript({ target: { tabId: target, allFrames: false },
            world: "ISOLATED", func: stopTeachCapture, args: [id] }).catch(() => undefined);
          throw error;
        }
        if (!result.ok) throw new ToolExecutionError(result.code || "TEACH_START_FAILED", "Cannot record this page.");
        if (result.pageScope !== scope) {
          await chrome.scripting.executeScript({ target: { tabId: target, allFrames: false },
            world: "ISOLATED", func: stopTeachCapture, args: [id] }).catch(() => undefined);
          throw new ToolExecutionError("TEACH_PAGE_SCOPE_CHANGED", "The page navigated while recording was starting.");
        }
        return { ok: true, action, recordingId: id, pageScope: scope, eventLimit: MAX_TEACH_EVENTS,
          note: "Demonstrate the task manually in this tab, then call stop with this recordingId." };
      }

      if (action === "stop") {
        if (!recordingId || recordingId.length > 128) throw new ToolExecutionError("TEACH_RECORDING_ID_REQUIRED", "Stop needs the recordingId returned by start.");
        const result = await inject(target, stopTeachCapture, [recordingId], signal);
        if (!result.ok || !result.recording) throw new ToolExecutionError("TEACH_RECORDING_NOT_FOUND", "Recording expired or the page navigated. Start again.");
        try {
          const compiled = compileTeachRecording(result.recording);
          if (compiled.trace.pageScope !== scope) throw new Error("The page changed while recording");
          return { ok: true, action, recordingId, ...compiled,
            note: "Review and save the workflow object. Supply field_N inputs explicitly for replay." };
        } catch (error) {
          throw new ToolExecutionError("TEACH_INCOMPLETE_RECORDING", error instanceof Error ? error.message : "Recording could not be compiled.");
        }
      }

      let workflow: ReturnType<typeof validateTeachWorkflow>;
      try { workflow = validateTeachWorkflow(parseJson(workflowJson, "workflowJson")); }
      catch (error) {
        if (error instanceof ToolExecutionError) throw error;
        throw new ToolExecutionError("TEACH_INVALID_WORKFLOW", error instanceof Error ? error.message : "Invalid workflow.");
      }
      if (workflow.pageScope !== scope) {
        throw new ToolExecutionError("TEACH_PAGE_SCOPE_MISMATCH", "The current page does not match the recorded URL origin and path.");
      }

      let inputs: Record<string, string> = {};
      if (action === "execute") {
        try { inputs = validateTeachInputs(parseJson(inputsJson, "inputsJson", true), workflow); }
        catch (error) {
          if (error instanceof ToolExecutionError) throw error;
          throw new ToolExecutionError("TEACH_INVALID_INPUTS", error instanceof Error ? error.message : "Invalid inputs.");
        }
      }

      const results: Array<{ stepId: string; action: string; code: string; verified: boolean }> = [];
      for (const step of workflow.steps) {
        assertActive(signal);
        const operation = await inject(target, operateTeachStep,
          [{ pageScope: workflow.pageScope, step, value: step.parameter ? inputs[step.parameter] : undefined, execute: action === "execute" }], signal);
        results.push({ stepId: step.id, action: step.action, code: operation.code, verified: operation.verified });
        if (!operation.ok) return { ok: false, action, stoppedAt: step.id, code: operation.code, results,
          completed: results.length - 1, total: workflow.steps.length, outcomeVerified: false };
      }
      const outcomeVerified = action === "execute" && results.length > 0 && results.every(result => result.verified);
      return { ok: true, action, total: workflow.steps.length, results, outcomeVerified,
        note: outcomeVerified ? "Field/scroll checks passed; verify the end-to-end task outcome separately."
          : "Selector checks or event dispatch completed. End-to-end task outcome is NOT verified." };
    },
  });
}
