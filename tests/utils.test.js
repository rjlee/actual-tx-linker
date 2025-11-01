const { sleep, sleepAbortable } = require('../src/utils');

describe('utils', () => {
  test('sleep resolves after delay', async () => {
    const start = Date.now();
    await sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });

  test('sleepAbortable resolves early on abort', async () => {
    const ctrl = new AbortController();
    const p = sleepAbortable(50, ctrl.signal);
    setTimeout(() => ctrl.abort(), 5);
    const start = Date.now();
    await p;
    expect(Date.now() - start).toBeLessThan(50);
  });

  test('sleepAbortable without signal behaves like sleep', async () => {
    const start = Date.now();
    await sleepAbortable(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });
});
