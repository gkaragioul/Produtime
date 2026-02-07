// @jest-environment node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Polyfill TextEncoder/TextDecoder for jsPDF dependencies in Node env
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TextEncoder, TextDecoder } = require('util');
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
// Also set on globalThis to satisfy libs referencing globalThis
// @ts-ignore
globalThis.TextEncoder = TextEncoder;
// @ts-ignore
globalThis.TextDecoder = TextDecoder;

// Mock electron APIs used in pdf-generator
jest.mock('electron', () => {
  const tmpDir = path.join(os.tmpdir(), 'ProduTimeTestReports');
  // Ensure temp reports folder exists
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch {}
  return {
    app: {
      getPath: jest
        .fn()
        .mockReturnValue(path.join(os.tmpdir(), 'ProduTimeTestDocuments')),
    },
    shell: {
      openPath: jest.fn().mockResolvedValue(''),
    },
  };
});

// Dynamically require after polyfills to avoid hoisted ESM import issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFGenerator } = require('../pdf-generator');

type ReportOptions = import('../../shared/types').ReportOptions;
enum ReportFormat {
  PDF = 'pdf',
  HTML = 'html',
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
enum ReportType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  CUSTOM = 'custom',
}
// Minimal fake DatabaseManager with required methods
const fakeDb = {
  getActivityLogsByDateRange: jest.fn().mockReturnValue([
    {
      id: 1,
      timestamp: new Date().toISOString(),
      app_name: 'VSCode',
      window_title: 'Editing project',
      duration: 15,
    },
    {
      id: 2,
      timestamp: new Date().toISOString(),
      app_name: 'Chrome',
      window_title: 'Docs',
      duration: 30,
    },
  ]),
  getAnalyticsByDateRange: jest.fn().mockReturnValue([]),
  getSetting: jest.fn().mockImplementation((key: string) => {
    if (key === 'employee_name') return 'Test User';
    if (key === 'export_folder') return '';
    if (key === 'work_schedule_start') return '09:00';
    if (key === 'work_schedule_end') return '17:00';
    return null;
  }),
};

const makeOptions = (
  format: ReportFormat = ReportFormat.PDF
): ReportOptions => ({
  type: ReportType.DAILY,
  format,
  dateRange: {
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  },
  includeCharts: false,
  includeSummary: true,
  includeDetails: true,
  title: 'Daily Activity Report - Test',
});

describe('PDFGenerator - Core PDF generation', () => {
  test('generateReport creates a valid PDF file on disk', async () => {
    const gen = new PDFGenerator(fakeDb as any);
    const options = makeOptions(ReportFormat.PDF);
    const res = await gen.generateReport(options);

    expect(res).toBeDefined();
    expect(res.filePath).toMatch(/\.pdf$/i);
    expect(fs.existsSync(res.filePath)).toBe(true);

    const fd = fs.openSync(res.filePath, 'r');
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    // PDF files should start with %PDF-
    expect(buf.toString()).toBe('%PDF-');
  });

  test('getReportData returns structured data', async () => {
    const gen = new PDFGenerator(fakeDb as any);
    const options = makeOptions(ReportFormat.PDF);
    const data = await gen.getReportData(options);

    expect(data).toHaveProperty('title');
    expect(data).toHaveProperty('summary');
    expect(Array.isArray(data.activityLogs)).toBe(true);
  });
});
