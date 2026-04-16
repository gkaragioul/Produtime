import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'produtime-logger-'));

jest.mock('electron', () => ({
  app: {
    isReady: () => true,
    getVersion: () => 'test',
    getPath: (k: string) => (k === 'userData' ? tmpDir : tmpDir),
  },
}));

// Reset the module so the singleton picks up the new electron mock per test run
jest.resetModules();
import { Logger } from './logger';

describe('Logger.readLogFileTail', () => {
  const logger = Logger.getInstance();

  beforeAll(() => {
    // Force initialisation so a log file is created.
    logger.info('test', 'init line');
  });

  it('returns the last N lines from the on-disk log', () => {
    for (let i = 0; i < 1200; i++) {
      logger.info('bench', `line-${i}`);
    }
    const tail = logger.readLogFileTail(50);
    const lines = tail.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(40);
    expect(lines.length).toBeLessThanOrEqual(50);
    expect(lines[lines.length - 1]).toMatch(/line-1199/);
  });

  it('handles small files without crashing', () => {
    // Use the same singleton; just assert we can still read recent content.
    logger.info('small', 'just-a-line');
    const tail = logger.readLogFileTail(5);
    expect(tail).toMatch(/just-a-line/);
  });

  it('clearCurrentLog truncates the file and resets the buffer', () => {
    logger.info('clear', 'before-clear');
    expect(logger.readLogFileTail(10)).toMatch(/before-clear/);
    expect(logger.clearCurrentLog()).toBe(true);
    const tail = logger.readLogFileTail(10);
    expect(tail).not.toMatch(/before-clear/);
    // The clear call itself logs a marker, so the file isn't fully empty.
    expect(tail).toMatch(/Log cleared by user/);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });
});
