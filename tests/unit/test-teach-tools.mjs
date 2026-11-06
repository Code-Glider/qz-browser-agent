import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import registerTeachTools from '../../src/capabilities/teach-mode/tools.ts';
import { compileTeachRecording } from '../../src/capabilities/teach-mode/workflow.ts';

const workflow = compileTeachRecording({
  version: 1, recordingId: 'sample', pageScope: 'https://example.test/settings?token=PRIVATE',
  queryDigest: createHash('sha256').update('?token=PRIVATE').digest('hex'), droppedEvents: 0,
  events: [{ action: 'click', selector: '#toggle', tag: 'button', atMs: 0 }],
}).workflow;

class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function createHarness({ existing = false } = {}) {
  let definition;
  const calls = { allowed: 0, saved: [], refreshed: [] };
  registerTeachTools({
    registerTool: tool => { definition = tool; },
    ToolExecutionError: ToolError,
    assertTabAllowed: async () => { calls.allowed++; },
    getToolRuntimeDependencies: () => ({ skills: { refreshRegistry: async () => {} } }),
    publishSkillRegistryChange: async (...args) => { calls.refreshed.push(args); },
    skills: {
      load: async () => existing ? { name: 'teach-contact' } : null,
      save: async (...args) => { calls.saved.push(args); return { name: args[0] }; },
    },
  });
  return { tool: definition, calls };
}

const previousChrome = globalThis.chrome;
const chromeFixture = { tabs: { get: async () => ({ url: 'https://example.test/settings?token=PRIVATE' }) },
  scripting: { executeScript: async () => { throw new Error('Unexpected page injection during Skill save'); } } };

test('install saves an opt-in site Skill through the native qz repository and publishes the registry change', async () => {
  globalThis.chrome = chromeFixture;
  try {
    const { tool, calls } = createHarness();
    const result = await tool.execute({ action: 'install', tabId: 19, skillName: 'teach-contact', workflowJson: JSON.stringify(workflow) },
      new AbortController().signal, { workingTabId: 19, sessionId: 'session-1', runId: 'run-1' });
    assert.equal(result.installed, true);
    assert.equal(calls.allowed, 1);
    assert.equal(calls.saved.length, 1);
    assert.equal(calls.saved[0][0], 'teach-contact');
    assert.equal(calls.saved[0][3].scope, 'site');
    assert.deepEqual(calls.saved[0][3].domains, ['example.test']);
    assert.equal(calls.saved[0][2].includes('PRIVATE'), false);
    assert.equal(calls.refreshed.length, 1);
  } finally { if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome; }
});

test('install rejects duplicate Skill names before any write', async () => {
  globalThis.chrome = chromeFixture;
  try {
    const { tool, calls } = createHarness({ existing: true });
    await assert.rejects(tool.execute({ action: 'install', tabId: 19, skillName: 'teach-contact', workflowJson: JSON.stringify(workflow) },
      new AbortController().signal, { workingTabId: 19, sessionId: 'session-1' }), { code: 'TEACH_SKILL_EXISTS' });
    assert.equal(calls.saved.length, 0);
  } finally { if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome; }
});

test('verified form effects never masquerade as independently verified business outcomes', async () => {
  const fill = compileTeachRecording({
    version: 1, recordingId: 'sample', pageScope: 'https://example.test/settings?token=PRIVATE',
    queryDigest: createHash('sha256').update('?token=PRIVATE').digest('hex'), droppedEvents: 0,
    events: [{ action: 'fill', selector: '#city', tag: 'input', atMs: 0 }],
  }).workflow;
  globalThis.chrome = {
    tabs: chromeFixture.tabs,
    scripting: { executeScript: async input => input.files ? [{}] : [{ result: { ok: true, code: 'OK', verified: true } }] },
  };
  try {
    const { tool } = createHarness();
    const result = await tool.execute({ action: 'execute', tabId: 19, workflowJson: JSON.stringify(fill),
      inputsJson: '{"field_1":"Toronto"}' }, new AbortController().signal, { workingTabId: 19, sessionId: 'session-1' });
    assert.equal(result.ok, true);
    assert.equal(result.stepEffectsVerified, true);
    assert.equal(result.outcomeVerified, false);
  } finally { if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome; }
});
