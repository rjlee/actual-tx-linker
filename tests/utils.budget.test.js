const path = require('path');

const ORIGINAL_ENV = process.env;

describe('utils openBudget/closeBudget', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ACTUAL_SERVER_URL;
    delete process.env.ACTUAL_PASSWORD;
    delete process.env.ACTUAL_SYNC_ID;
    delete process.env.ACTUAL_BUDGET_ENCRYPTION_PASSWORD;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  function setupMocks({ configDir = 'budget/test', downloadImpl } = {}) {
    const fsMock = { mkdirSync: jest.fn() };
    jest.doMock('fs', () => fsMock);
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    jest.doMock('../src/logger', () => logger);
    const apiMock = {
      init: jest.fn().mockResolvedValue(),
      downloadBudget: jest.fn(),
      sync: jest.fn().mockResolvedValue(),
      shutdown: jest.fn().mockResolvedValue(),
    };
    if (downloadImpl) {
      apiMock.downloadBudget.mockImplementation(downloadImpl);
    } else {
      apiMock.downloadBudget.mockResolvedValue();
    }
    jest.doMock('@actual-app/api', () => apiMock);
    jest.doMock('../src/config', () => ({ BUDGET_DIR: configDir }));
    return { fsMock, apiMock, getLogger: () => require('../src/logger') };
  }

  test('requires connection environment variables', async () => {
    const { apiMock } = setupMocks();
    const { openBudget } = require('../src/utils');
    await expect(openBudget()).rejects.toThrow(
      /Please set ACTUAL_SERVER_URL, ACTUAL_PASSWORD, and ACTUAL_SYNC_ID/,
    );
    expect(apiMock.init).not.toHaveBeenCalled();
  });

  test('downloads budget once and skips subsequent attempts', async () => {
    process.env.ACTUAL_SERVER_URL = 'http://example.test';
    process.env.ACTUAL_PASSWORD = 'secret';
    process.env.ACTUAL_SYNC_ID = 'sync-id';
    const { fsMock, apiMock, getLogger } = setupMocks({
      configDir: 'budget/session',
    });
    const logger = getLogger();
    const { openBudget } = require('../src/utils');
    const expectedDir = path.join(process.cwd(), 'budget/session');

    await openBudget();
    await openBudget();

    expect(fsMock.mkdirSync).toHaveBeenCalledWith(expectedDir, {
      recursive: true,
    });
    expect(apiMock.init).toHaveBeenCalledWith({
      dataDir: expectedDir,
      serverURL: 'http://example.test',
      password: 'secret',
    });
    expect(apiMock.downloadBudget).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      'Skipping download; budget already downloaded this session',
    );
    expect(apiMock.sync).toHaveBeenCalledTimes(2);
  });

  test('retries download after failure and logs warning', async () => {
    process.env.ACTUAL_SERVER_URL = 'http://example.test';
    process.env.ACTUAL_PASSWORD = 'secret';
    process.env.ACTUAL_SYNC_ID = 'sync-id';
    const downloadError = new Error('download failed');
    const { apiMock, getLogger } = setupMocks({
      downloadImpl: jest
        .fn()
        .mockRejectedValueOnce(downloadError)
        .mockResolvedValueOnce(undefined),
    });
    const logger = getLogger();
    const { openBudget } = require('../src/utils');

    await openBudget();
    await openBudget();

    expect(apiMock.downloadBudget).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Download budget may have failed or is cached:',
      'download failed',
    );
  });

  test('closeBudget logs shutdown failures', async () => {
    const { apiMock, getLogger } = setupMocks();
    const logger = getLogger();
    const { closeBudget } = require('../src/utils');
    const err = new Error('shutdown boom');
    apiMock.shutdown.mockRejectedValueOnce(err);

    await closeBudget();

    expect(logger.warn).toHaveBeenCalledWith(
      'Shutdown failed:',
      'shutdown boom',
    );
  });
});
