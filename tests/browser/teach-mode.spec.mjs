import { expect, test } from './fixtures.mjs';

test('real human-like form interaction creates a redacted workflow and stops listeners', async ({ page }) => {
  await page.goto('/__test_health');
  await page.setContent('<input id="name" type="text" /><button id="toggle" type="button">Toggle</button>');
  const start = await page.evaluate(async () => {
    const { startTeachCapture } = await import('/extension/capabilities/teach-mode/page-runtime.js');
    return startTeachCapture('demo-1', 120);
  });
  expect(start.ok).toBe(true);

  await page.locator('#name').fill('Private typed value');
  await page.locator('#toggle').click();

  const stopped = await page.evaluate(async () => {
    const { stopTeachCapture } = await import('/extension/capabilities/teach-mode/page-runtime.js');
    return stopTeachCapture('demo-1');
  });
  expect(stopped.ok).toBe(true);
  expect(stopped.recording.events.map(e => e.action)).toEqual(['fill', 'click']);
  expect(JSON.stringify(stopped)).not.toContain('Private typed value');

  const compiled = await page.evaluate(async recording => {
    const { compileTeachRecording } = await import('/extension/capabilities/teach-mode/workflow.js');
    return compileTeachRecording(recording);
  }, stopped.recording);
  expect(compiled.workflow.steps[0].parameter).toBe('field_1');

  await page.locator('#toggle').click();
  const stoppedAgain = await page.evaluate(async () => {
    const { stopTeachCapture } = await import('/extension/capabilities/teach-mode/page-runtime.js');
    return stopTeachCapture('demo-1');
  });
  expect(stoppedAgain.code).toBe('RECORDING_NOT_FOUND');
});

test('replay validates fields and blocks submit buttons and wrong pages', async ({ page }) => {
  await page.goto('/__test_health');
  await page.setContent('<input id="city" type="text" /><button id="submit" type="submit">Submit</button>');
  const cases = await page.evaluate(async () => {
    const { operateTeachStep } = await import('/extension/capabilities/teach-mode/page-runtime.js');
    const pageScope = `${location.origin}${location.pathname}`;
    const fill = { id: 'step_001', action: 'fill', selector: '#city', tag: 'input', parameter: 'field_1', verification: 'value_equals' };
    const submit = { id: 'step_002', action: 'click', selector: '#submit', tag: 'button', verification: 'dispatch_only' };
    return {
      preview: operateTeachStep({ pageScope, step: fill, execute: false }),
      fill: operateTeachStep({ pageScope, step: fill, value: 'Toronto', execute: true }),
      submit: operateTeachStep({ pageScope, step: submit, execute: true }),
      stale: operateTeachStep({ pageScope: 'https://other.invalid/', step: fill, value: 'Secret', execute: true }),
      final: document.querySelector('#city').value,
    };
  });
  expect(cases.preview).toMatchObject({ ok: true, verified: false });
  expect(cases.fill).toMatchObject({ ok: true, verified: true });
  expect(cases.submit).toMatchObject({ ok: false, code: 'CLICK_REQUIRES_REVIEW' });
  expect(cases.stale).toMatchObject({ ok: false, code: 'PAGE_SCOPE_CHANGED' });
  expect(cases.final).toBe('Toronto');
});

test('password-like input never becomes a reusable workflow', async ({ page }) => {
  await page.goto('/__test_health');
  await page.setContent('<input id="api_key" type="text" /><input id="password" type="password"/>');
  await page.evaluate(async () => {
    const { startTeachCapture } = await import('/extension/capabilities/teach-mode/page-runtime.js');
    return startTeachCapture('sensitive-1', 120);
  });
  await page.locator('#api_key').fill('do-not-record');
  await page.locator('#password').fill('also-do-not-record');
  const result = await page.evaluate(async () => {
    const [{ stopTeachCapture }, { compileTeachRecording }] = await Promise.all([
      import('/extension/capabilities/teach-mode/page-runtime.js'),
      import('/extension/capabilities/teach-mode/workflow.js'),
    ]);
    const stopped = stopTeachCapture('sensitive-1');
    let rejected = false;
    try { compileTeachRecording(stopped.recording); } catch { rejected = true; }
    return { stopped, rejected };
  });
  expect(result.stopped.recording.droppedEvents).toBeGreaterThan(0);
  expect(result.rejected).toBe(true);
  expect(JSON.stringify(result)).not.toContain('do-not-record');
  expect(JSON.stringify(result)).not.toContain('also-do-not-record');
});
