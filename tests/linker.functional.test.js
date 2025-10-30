jest.mock('@actual-app/api', () => ({
  init: jest.fn(),
  downloadBudget: jest.fn(),
  sync: jest.fn(),
  shutdown: jest.fn(),
  getAccounts: jest.fn(),
  getTransactions: jest.fn(),
  getPayees: jest.fn(),
  createPayee: jest.fn(),
  updateTransaction: jest.fn(),
  deleteTransaction: jest.fn(),
  runImport: jest.fn(async (name, fn) => {
    if (typeof fn === 'function') {
      await fn();
    }
  }),
}));

const api = require('@actual-app/api');
const { linkOnce } = require('../src/linker');

describe('linkOnce basic flow', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('links a simple pair when not dry-run', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    // one negative from A, one positive to B, same day
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 't1',
            account: 'A',
            amount: -1000,
            date: '2025-10-10',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          {
            id: 't2',
            account: 'B',
            amount: 1000,
            date: '2025-10-10',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    api.getPayees.mockResolvedValue([]);
    api.createPayee.mockResolvedValue({ id: 'pB' });

    const linked = await linkOnce({
      lookbackDays: 7,
      windowHours: 72,
      minScore: 0,
      dryRun: false,
      deleteDuplicate: true,
      clearedOnly: true,
      skipReconciled: true,
      includeAccounts: [],
      excludeAccounts: [],
    });

    expect(linked).toBe(1);
    expect(api.updateTransaction).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ payee: 'pB' }),
    );
    expect(api.deleteTransaction).toHaveBeenCalledWith('t2');
  });

  test('respects keep=incoming', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          { id: 'o1', account: 'A', amount: -1000, date: '2025-10-10', cleared: true, reconciled: false },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          { id: 'i1', account: 'B', amount: 1000, date: '2025-10-10', cleared: true, reconciled: false },
        ]);
      }
      return Promise.resolve([]);
    });
    api.getPayees.mockResolvedValue([]);
    api.createPayee.mockResolvedValue({ id: 'pB' });
    const linked = await linkOnce({ dryRun: false, minScore: 0, keep: 'incoming' });
    expect(linked).toBe(1);
    // Should update incoming txn id instead of outgoing
    expect(api.updateTransaction).toHaveBeenCalledWith('i1', expect.any(Object));
  });

  test('delete retry on first failure', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          { id: 'o1', account: 'A', amount: -1000, date: '2025-10-10', cleared: true, reconciled: false },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          { id: 'i1', account: 'B', amount: 1000, date: '2025-10-10', cleared: true, reconciled: false },
        ]);
      }
      return Promise.resolve([]);
    });
    api.getPayees.mockResolvedValue([]);
    api.createPayee.mockResolvedValue({ id: 'pB' });
    let first = true;
    api.deleteTransaction.mockImplementation(async () => {
      if (first) {
        first = false;
        throw new Error('temp');
      }
    });
    const linked = await linkOnce({ dryRun: false, minScore: 0 });
    expect(linked).toBe(1);
    expect(api.deleteTransaction).toHaveBeenCalledTimes(2);
  });

  test('skips ambiguous tie (two equal candidates)', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 'o1',
            account: 'A',
            amount: -1000,
            date: '2025-10-10',
            description: 'transfer abc',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          {
            id: 'i1',
            account: 'B',
            amount: 1000,
            date: '2025-10-10',
            description: 'transfer abc',
            cleared: true,
            reconciled: false,
          },
          {
            id: 'i2',
            account: 'B',
            amount: 1000,
            date: '2025-10-10',
            description: 'transfer abc',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    api.getPayees.mockResolvedValue([]);

    const linked = await linkOnce({
      lookbackDays: 7,
      windowHours: 72,
      minScore: 0,
      dryRun: false,
    });
    expect(linked).toBe(0);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  test('respects include/exclude account filters', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
      { id: 'C', name: 'Acct C' },
    ]);
    api.getTransactions.mockResolvedValue([]);
    await linkOnce({
      includeAccounts: ['Acct A', 'B'],
      excludeAccounts: ['C'],
      dryRun: true,
    });
    // Should have been called for A and B only
    const calls = api.getTransactions.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining(['A', 'B']));
    expect(calls).not.toEqual(expect.arrayContaining(['C']));
  });

  test('minScore blocks then allows when set to 0', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 'o1',
            account: 'A',
            amount: -1000,
            date: '2025-10-10',
            description: 'aaa',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          {
            id: 'i1',
            account: 'B',
            amount: 1000,
            date: '2025-10-10',
            description: 'bbb',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    api.getPayees.mockResolvedValue([]);
    api.createPayee.mockResolvedValue({ id: 'pB' });

    let linked = await linkOnce({ minScore: 0.2, dryRun: false });
    expect(linked).toBe(0);
    linked = await linkOnce({ minScore: 0, dryRun: false });
    expect(linked).toBe(1);
  });

  test('preferReconciled keeps reconciled side when allowed', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 'o1',
            account: 'A',
            amount: -1000,
            date: '2025-10-10',
            cleared: true,
            reconciled: true,
          },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          {
            id: 'i1',
            account: 'B',
            amount: 1000,
            date: '2025-10-10',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    api.getPayees.mockResolvedValue([]);
    api.createPayee.mockResolvedValue({ id: 'pB' });
    const linked = await linkOnce({
      dryRun: false,
      minScore: 0,
      skipReconciled: false,
      preferReconciled: true,
    });
    expect(linked).toBe(1);
    expect(api.updateTransaction).toHaveBeenCalledWith(
      'o1',
      expect.any(Object),
    );
  });

  test('skipReconciled filters out reconciled when true', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          { id: 'o1', account: 'A', amount: -1000, date: '2025-10-10', cleared: true, reconciled: true },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          { id: 'i1', account: 'B', amount: 1000, date: '2025-10-10', cleared: true, reconciled: false },
        ]);
      }
      return Promise.resolve([]);
    });
    const linked = await linkOnce({ dryRun: false, minScore: 0, skipReconciled: true });
    expect(linked).toBe(0);
  });
});
