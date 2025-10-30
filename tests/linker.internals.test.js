const { __internals } = require('../src/linker');

describe('internals', () => {
  test('formatYMD produces YYYY-MM-DD', () => {
    const d = new Date(Date.UTC(2025, 9, 30, 12, 34, 56));
    expect(__internals.formatYMD(d)).toBe('2025-10-30');
  });

  test('withinWindow checks hour difference', () => {
    const a = '2025-10-01T00:00:00Z';
    const b = '2025-10-02T23:00:00Z';
    expect(__internals.withinWindow(a, b, 48)).toBe(true);
    expect(__internals.withinWindow(a, b, 24)).toBe(false);
  });

  test('chooseKeepAndDrop prefers reconciled when enabled', () => {
    const outTx = { id: 'o1', reconciled: false };
    const inTx = { id: 'i1', reconciled: true };
    const { keep, drop } = __internals.chooseKeepAndDrop(
      outTx,
      inTx,
      'outgoing',
      true,
    );
    expect(keep).toBe(inTx);
    expect(drop).toBe(outTx);
  });
});
