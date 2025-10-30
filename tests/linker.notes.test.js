const { __internals } = require('../src/linker');

describe('buildMergedNotes', () => {
  test('appends summary when base is empty', () => {
    const keep = { notes: '' };
    const drop = { description: 'Ref ABC', date: '2025-10-10', account: 'B' };
    const merged = __internals.buildMergedNotes(keep, drop, 'Acct A', 'Acct B');
    expect(merged).toMatch(/Transfer matched with Acct B on 2025-10-10/);
    expect(merged).toMatch(/Ref ABC/);
  });

  test('does not duplicate existing summary', () => {
    const keep = {
      notes: 'Transfer matched with Acct B on 2025-10-10 (ref: XYZ)',
    };
    const drop = { description: 'XYZ', date: '2025-10-10', account: 'B' };
    const merged = __internals.buildMergedNotes(keep, drop, 'Acct A', 'Acct B');
    expect(merged).toBe(keep.notes);
  });
});
