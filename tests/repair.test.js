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

const api = require('@actual-app/api');
const { repairOnce } = require('../src/repair');

describe('repairOnce', () => {
  beforeEach(() => {
    jest.resetAllMocks();
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

    const repaired = await repairOnce({ minScore: 0, clearedOnly: true });
    expect(repaired).toBe(1);
    expect(api.createPayee).toHaveBeenCalledWith({ name: '', transfer_acct: 'B' });
    expect(api.updateTransaction).toHaveBeenCalledWith('o-bad', { payee: 'pB', category: null });
    expect(api.deleteTransaction).toHaveBeenCalledWith('i-dupe');
  });

  test('dry-run does not write or create payees', async () => {
    api.getAccounts.mockResolvedValue([
      { id: 'A', name: 'Acct A' },
      { id: 'B', name: 'Acct B' },
    ]);
    api.getPayees.mockResolvedValue([{ id: 'pA', name: '', transfer_acct: 'A' }]);
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
          { id: 'i-dupe', account: 'B', amount: 2500, date: '2025-10-10', cleared: true, reconciled: false },
        ]);
      }
      return Promise.resolve([]);
    });
    const repaired = await repairOnce({ minScore: 0, clearedOnly: true, dryRun: true });
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
    api.getPayees.mockResolvedValue([{ id: 'pB', name: '', transfer_acct: 'B' }]);
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
    const repaired = await repairOnce({ minScore: 0, clearedOnly: true, dryRun: false });
    expect(repaired).toBe(1);
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { category: null });
  });
});
