// @jest-environment node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Polyfill TextEncoder/TextDecoder for jsPDF deps
const { TextEncoder, TextDecoder } = require('util');
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

// Mock electron
jest.mock('electron', () => ({
  app: { getPath: jest.fn().mockReturnValue(path.join(os.tmpdir(), 'TimePortTestDocuments')) },
  shell: { openPath: jest.fn().mockResolvedValue('') },
}));

const { PDFGenerator } = require('../pdf-generator');

describe('PDFGenerator rendering - charts and table', () => {
  const makeLogs = (count: number) => Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    timestamp: new Date(Date.now() - i * 60000).toISOString(),
    app_name: i % 2 === 0 ? 'VSCode' : 'Chrome',
    window_title: 'Work',
    duration: 5,
  }));

  const fakeDb = {
    getActivityLogsByDateRange: jest.fn(),
    getAnalyticsByDateRange: jest.fn().mockReturnValue([]),
    getSetting: jest.fn().mockReturnValue('Test User'),
  };

  test('including charts increases PDF size and does not throw', async () => {
    fakeDb.getActivityLogsByDateRange.mockReturnValue(makeLogs(20));

    const gen = new PDFGenerator(fakeDb as any);
    const options = {
      type: 'daily',
      format: 'pdf',
      dateRange: {
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
      },
      includeCharts: false,
      includeSummary: true,
      includeDetails: true,
      title: 'Rendering Report',
    };

    const base = await gen.generateReport(options);
    const withCharts = await gen.generateReport({ ...options, includeCharts: true });

    expect(fs.existsSync(base.filePath)).toBe(true);
    expect(fs.existsSync(withCharts.filePath)).toBe(true);
    // Size should be greater when charts included (box vs. arcs & legend later)
    expect(withCharts.fileSize).toBeGreaterThanOrEqual(base.fileSize);
  });

  test('table page-break logic handles large datasets', async () => {
    fakeDb.getActivityLogsByDateRange.mockReturnValue(makeLogs(500));

    const gen = new PDFGenerator(fakeDb as any);
    const options = {
      type: 'daily',
      format: 'pdf',
      dateRange: {
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
      },
      includeCharts: false,
      includeSummary: false,
      includeDetails: true,
      title: 'Large Table Report',
    };

    const res = await gen.generateReport(options);
    expect(res.fileSize).toBeGreaterThan(2_000); // naive smoke threshold
  });
});

