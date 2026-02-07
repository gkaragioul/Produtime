// @jest-environment node

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AutoExportScheduler } from '../services/auto-export-scheduler';
import { ReportFormat, ReportType } from '../../shared/types';

jest.mock('electron', () => ({
  app: {
    getPath: jest
      .fn()
      .mockReturnValue(path.join(os.tmpdir(), 'TimePortTestDocuments')),
  },
  shell: { openPath: jest.fn().mockResolvedValue('') },
}));

const makeDb = (initial: Record<string, string> = {}) => {
  const store: Record<string, string> = { ...initial };
  return {
    getSetting: jest.fn((k: string) => store[k] ?? null),
    setSetting: jest.fn((k: string, v: string) => {
      store[k] = v;
    }),
    getAllSettings: jest.fn(() =>
      Object.entries(store).map(([key, value]) => ({ key, value }))
    ),
  } as any;
};

const makePdf = () =>
  ({
    generateReport: jest.fn(async (options: any) => {
      const tmp = path.join(os.tmpdir(), `test_${Date.now()}.pdf`);
      fs.writeFileSync(tmp, Buffer.from('%PDF-1.4\n%EOF'));
      return {
        reportId: 'r',
        filePath: tmp,
        fileName: path.basename(tmp),
        fileSize: fs.statSync(tmp).size,
      };
    }),
  }) as any;

const fixedNow = (iso: string) => () => new Date(iso);

describe('AutoExportScheduler', () => {
  test('exports once when enabled and after schedule end', async () => {
    const db = makeDb({
      auto_export_enabled: 'true',
      export_folder: path.join(os.tmpdir(), 'TimePortExports'),
      work_schedule_end: '00:00',
      report_include_charts: 'true',
      report_include_summary: 'true',
      report_include_details: 'true',
    });
    const pdf = makePdf();

    const scheduler = new AutoExportScheduler(db, pdf, {
      checkIntervalMs: 5,
      now: fixedNow('2024-04-01T18:00:00.000Z'),
      logger: console.log,
    });
    await (scheduler as any).runOnce();

    // Validate that scheduler marked the day as exported
    expect(db.getSetting('last_auto_export_date')).toBe('2024-04-01');
  });

  test('does not export twice on same day', async () => {
    const db = makeDb({
      auto_export_enabled: 'true',
      export_folder: path.join(os.tmpdir(), 'TimePortExports'),
      work_schedule_end: '17:00',
      last_auto_export_date: '2024-04-01',
    });
    const pdf = makePdf();

    const scheduler = new AutoExportScheduler(db, pdf, {
      checkIntervalMs: 5,
      now: fixedNow('2024-04-01T18:00:00.000Z'),
      logger: () => {},
    });
    scheduler.start();
    await new Promise((r) => setTimeout(r, 30));
    scheduler.stop();

    expect(pdf.generateReport).not.toHaveBeenCalled();
  });

  test('skips if export_folder not set', async () => {
    const db = makeDb({
      auto_export_enabled: 'true',
      work_schedule_end: '17:00',
    });
    const pdf = makePdf();

    const scheduler = new AutoExportScheduler(db, pdf, {
      checkIntervalMs: 5,
      now: fixedNow('2024-04-01T18:00:00.000Z'),
      logger: () => {},
    });
    scheduler.start();
    await new Promise((r) => setTimeout(r, 30));
    scheduler.stop();

    expect(pdf.generateReport).not.toHaveBeenCalled();
  });
});

test('schedule precedence: auto_export_time > weekly > flat > default', async () => {
  const monday = '2024-04-01T'; // Monday
  const storeDb = makeDb({
    auto_export_enabled: 'true',
    export_folder: path.join(os.tmpdir(), 'TimePortExports'),
    // Weekly schedule: Monday end is 20:00
    work_schedule_weekly: JSON.stringify({
      monday: { start: '09:00', end: '20:00' },
    }),
    work_schedule_end: '21:00',
    auto_export_time: '16:00',
    report_include_charts: 'true',
    report_include_summary: 'true',
    report_include_details: 'true',
  });
  const pdf = makePdf();

  // Before auto_export_time → should NOT export
  let scheduler = new AutoExportScheduler(storeDb, pdf, {
    checkIntervalMs: 5,
    now: fixedNow(monday + '15:30:00.000'),
    logger: () => {},
  });
  await (scheduler as any).runOnce();
  expect(storeDb.getSetting('last_auto_export_date')).toBeNull();

  // After auto_export_time → should export, ignoring weekly/flat
  scheduler = new AutoExportScheduler(storeDb, pdf, {
    checkIntervalMs: 5,
    now: fixedNow(monday + '16:05:00.000'),
    logger: () => {},
  });
  await (scheduler as any).runOnce();
  expect(storeDb.getSetting('last_auto_export_date')).toBe('2024-04-01');
});

test('falls back to weekly end when auto_export_time is blank', async () => {
  const monday = '2024-04-01T';
  const db = makeDb({
    auto_export_enabled: 'true',
    export_folder: path.join(os.tmpdir(), 'TimePortExports'),
    work_schedule_weekly: JSON.stringify({
      monday: { start: '08:00', end: '14:00' },
    }),
    work_schedule_end: '17:00',
    auto_export_time: '', // blank
    report_include_charts: 'true',
    report_include_summary: 'true',
    report_include_details: 'true',
  });
  const pdf = makePdf();

  // Before 14:00 → no export
  let scheduler = new AutoExportScheduler(db, pdf, {
    checkIntervalMs: 5,
    now: fixedNow(monday + '13:30:00.000'),
    logger: () => {},
  });
  await (scheduler as any).runOnce();
  expect(db.getSetting('last_auto_export_date')).toBeNull();

  // After 14:00 → should export
  scheduler = new AutoExportScheduler(db, pdf, {
    checkIntervalMs: 5,
    now: fixedNow(monday + '14:15:00.000'),
    logger: () => {},
  });
  await (scheduler as any).runOnce();
  expect(db.getSetting('last_auto_export_date')).toBe('2024-04-01');
});

test('falls back to flat end when weekly day is non-working', async () => {
  const monday = '2024-04-01T';
  const db = makeDb({
    auto_export_enabled: 'true',
    export_folder: path.join(os.tmpdir(), 'TimePortExports'),
    work_schedule_weekly: JSON.stringify({
      monday: { start: '09:00', end: '17:00', nonWorking: true },
    }),
    work_schedule_end: '17:00',
    auto_export_time: '',
    report_include_charts: 'true',
    report_include_summary: 'true',
    report_include_details: 'true',
  });
  const pdf = makePdf();

  // Before 17:00 → no export
  let scheduler = new AutoExportScheduler(db, pdf, {
    checkIntervalMs: 5,
    now: fixedNow(monday + '16:30:00.000'),
    logger: () => {},
  });
  await (scheduler as any).runOnce();
  expect(db.getSetting('last_auto_export_date')).toBeNull();

  // After 17:00 → export
  scheduler = new AutoExportScheduler(db, pdf, {
    checkIntervalMs: 5,
    now: fixedNow(monday + '17:05:00.000'),
    logger: () => {},
  });
  await (scheduler as any).runOnce();
  expect(db.getSetting('last_auto_export_date')).toBe('2024-04-01');
});

test('persists last_auto_export_status on validation failure and success', async () => {
  const monday = '2024-04-01T';
  // Intentionally invalid path outside allowed base dirs (home/temp)
  const root = path.parse(os.homedir()).root;
  const missingDir = path.join(root, 'OUTSIDE_ALLOWED_' + Date.now());
  const db = makeDb({
    auto_export_enabled: 'true',
    export_folder: missingDir, // invalid
    work_schedule_end: '00:00',
    auto_export_time: '00:00', // immediate
  });
  const pdf = makePdf();

  // Failure case → invalid folder
  let scheduler = new AutoExportScheduler(db, pdf, {
    checkIntervalMs: 5,
    now: fixedNow(monday + '00:01:00.000'),
    logger: () => {},
  });
  await (scheduler as any).runOnce();
  const statusFailRaw = db.getSetting('last_auto_export_status');
  expect(statusFailRaw).toBeTruthy();
  const statusFail = JSON.parse(statusFailRaw!);
  expect(statusFail.success).toBe(false);
  expect(statusFail.mode).toBe('auto');

  // Success case → create a valid folder and run again
  const goodDir = fs.mkdtempSync(path.join(os.tmpdir(), 'TimePortOK_'));
  db.setSetting('export_folder', goodDir);
  // Reset last date so it can export on the same day again
  db.setSetting('last_auto_export_date', '');

  scheduler = new AutoExportScheduler(db, pdf, {
    checkIntervalMs: 5,
    now: fixedNow(monday + '00:02:00.000'),
    logger: () => {},
  });
  await (scheduler as any).runOnce();
  const statusOkRaw = db.getSetting('last_auto_export_status');
  const statusOk = JSON.parse(statusOkRaw!);
  expect(statusOk.success).toBe(true);
  expect(statusOk.filePath).toBeTruthy();
});
