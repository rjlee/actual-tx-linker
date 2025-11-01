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
const { linkOnce } = require('../src/linker');

describe('pair multiples option', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  function setupTwoByTwoSameDay() {
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
          {
            id: 'o2',
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
    api.createPayee.mockResolvedValue({ id: 'pB' });
  }

  test('skips without pairMultiples', async () => {
    setupTwoByTwoSameDay();
    const linked = await linkOnce({
      dryRun: false,
      minScore: 0,
      pairMultiples: false,
    });
    expect(linked).toBe(0);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  test('pairs two-by-two when pairMultiples enabled', async () => {
    setupTwoByTwoSameDay();
    const linked = await linkOnce({
      dryRun: false,
      minScore: 0,
      pairMultiples: true,
    });
    expect(linked).toBe(2);
    expect(api.updateTransaction).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ payee: 'pB' }),
    );
    expect(api.updateTransaction).toHaveBeenCalledWith(
      'o2',
      expect.objectContaining({ payee: 'pB' }),
    );
    expect(api.deleteTransaction).toHaveBeenCalledWith('i1');
    expect(api.deleteTransaction).toHaveBeenCalledWith('i2');
  });
});
