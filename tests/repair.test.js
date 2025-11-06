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
}));

jest.mock('../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const api = require('@actual-app/api');
const logger = require('../src/logger');
const { repairOnce } = require('../src/repair');

describe('repairOnce', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    api.sync.mockResolvedValue();
    api.getAccounts.mockResolvedValue([]);
    api.getPayees.mockResolvedValue([]);
    api.getTransactions.mockResolvedValue([]);
    api.createPayee.mockResolvedValue({});
    api.updateTransaction.mockResolvedValue();
    api.deleteTransaction.mockResolvedValue();
  });

  test('repairs a self-transfer by pointing to the opposite account and deleting duplicate', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    // Payees: one incorrect self-transfer payee for A (used on A), and we will create transfer payee for B
    api.getPayees.mockResolvedValue([
      { id: 'pA', name: '', transfer_acct: 'A' },
    ]);
    api.createPayee.mockResolvedValue({ id: 'pB' });

    // Transactions: bad self-transfer on A (negative, uses pA), and incoming duplicate on B
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 'o-bad',
            account: 'A',
            amount: -2500,
            date: '2025-10-10',
            cleared: true,
            reconciled: false,
            payee: 'pA', // self-transfer
            category: 'cat-foo',
          },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          {
            id: 'i-dupe',
            account: 'B',
            amount: 2500,
            date: '2025-10-10',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const repaired = await repairOnce({
      minScore: 0,
      clearedOnly: true,
      dryRun: false,
    });
    expect(repaired).toBe(1);
    expect(api.createPayee).toHaveBeenCalledWith({
      name: '',
      transfer_acct: 'B',
    });
    expect(api.updateTransaction).toHaveBeenCalledWith('o-bad', {
      payee: 'pB',
      category: null,
    });
    expect(api.deleteTransaction).toHaveBeenCalledWith('i-dupe');
  });

  test('dry-run does not write or create payees', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getPayees.mockResolvedValue([
      { id: 'pA', name: '', transfer_acct: 'A' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 'o-bad',
            account: 'A',
            amount: -2500,
            date: '2025-10-10',
            cleared: true,
            reconciled: false,
            payee: 'pA',
          },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          {
            id: 'i-dupe',
            account: 'B',
            amount: 2500,
            date: '2025-10-10',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const repaired = await repairOnce({
      minScore: 0,
      clearedOnly: true,
      dryRun: true,
    });
    expect(repaired).toBe(0);
    expect(api.createPayee).not.toHaveBeenCalled();
    expect(api.updateTransaction).not.toHaveBeenCalled();
    expect(api.deleteTransaction).not.toHaveBeenCalled();
  });

  test('clears category on transfer with category', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getPayees.mockResolvedValue([
      { id: 'pB', name: '', transfer_acct: 'B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 't1',
            account: 'A',
            amount: -5000,
            date: '2025-10-10',
            cleared: true,
            reconciled: false,
            payee: 'pB', // correct transfer payee
            category: 'cat-foo', // should be cleared
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const repaired = await repairOnce({
      minScore: 0,
      clearedOnly: true,
      dryRun: false,
    });
    expect(repaired).toBe(1);
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', {
      category: null,
    });
  });

  test('reuses existing transfer payee and warns when delete keeps failing', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getPayees.mockResolvedValue([
      { id: 'pA', name: '', transfer_acct: 'A' },
      { id: 'pB', name: '', transfer_acct: 'B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 'out-1',
            account: 'A',
            amount: -2500,
            date: '2025-10-10',
            description: 'Transfer to savings',
            cleared: true,
            reconciled: false,
            payee: 'pA',
            category: 'cat-x',
          },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          {
            id: 'in-1',
            account: 'B',
            amount: 2500,
            date: '2025-10-10',
            description: 'Transfer to savings',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const deleteErr = new Error('no delete');
    api.deleteTransaction.mockRejectedValueOnce(deleteErr);
    api.deleteTransaction.mockRejectedValueOnce(deleteErr);

    const repaired = await repairOnce({
      minScore: 0,
      clearedOnly: true,
      dryRun: false,
    });
    expect(repaired).toBe(1);
    expect(api.createPayee).not.toHaveBeenCalled();
    expect(api.deleteTransaction).toHaveBeenCalledTimes(2);
    expect(api.updateTransaction).toHaveBeenCalledWith('out-1', {
      payee: 'pB',
      category: null,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Repair: delete failed for drop txn',
      'no delete',
    );
  });

  test('aligns transfer payee when linked counterpart exists', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getPayees.mockResolvedValue([
      { id: 'pA', name: 'Transfer A', transfer_acct: 'A' },
      { id: 'pUnknown', name: 'Unknown', transfer_acct: null },
      { id: 'pB', name: 'Transfer B', transfer_acct: 'B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 'tx-out',
            account: 'A',
            amount: -1000,
            date: '2025-01-02',
            transfer_id: 'tx-in',
            payee: 'pUnknown',
            category: 'cat-transfer',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      if (acctId === 'B') {
        return Promise.resolve([
          {
            id: 'tx-in',
            account: 'B',
            amount: 1000,
            date: '2025-01-02',
            transfer_id: 'tx-out',
            payee: null,
            category: 'cat-transfer',
            cleared: true,
            reconciled: false,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const repaired = await repairOnce({ dryRun: false });
    expect(repaired).toBe(2);
    expect(api.createPayee).not.toHaveBeenCalled();
    expect(api.updateTransaction).toHaveBeenNthCalledWith(1, 'tx-out', {
      payee: 'pB',
      category: null,
    });
    expect(api.updateTransaction).toHaveBeenNthCalledWith(2, 'tx-in', {
      payee: 'pA',
      category: null,
    });
  });

  test('relinks orphaned transfer when counterpart missing', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getPayees.mockResolvedValue([
      { id: 'pB', name: '', transfer_acct: 'B' },
    ]);
    api.getTransactions.mockImplementation((acctId) => {
      if (acctId === 'A') {
        return Promise.resolve([
          {
            id: 'orphan',
            account: 'A',
            amount: -1234,
            date: '2025-03-15',
            transfer_id: 'missing',
            payee: 'pB',
            category: 'cat-transfer',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const repaired = await repairOnce({ dryRun: false });
    expect(repaired).toBe(1);
    expect(api.updateTransaction).toHaveBeenCalledWith('orphan', {
      payee: 'pB',
      category: null,
    });
    expect(api.deleteTransaction).not.toHaveBeenCalled();
  });

  test('logs sync failure but still resolves repair count', async () => {
    api.sync.mockRejectedValueOnce(new Error('sync failed'));
    const repaired = await repairOnce({ dryRun: false });
    expect(repaired).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'Repair: sync failed',
      'sync failed',
    );
  });
});
