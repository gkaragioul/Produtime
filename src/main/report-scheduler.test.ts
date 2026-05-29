const generateReportMock = jest.fn().mockResolvedValue({
  reportId: 'r1',
  filePath: 'C:/Exports/TimePort_daily_Report_2024-08-28_r1.pdf',
  fileName: 'TimePort_daily_Report_2024-08-28_r1.pdf',
  fileSize: 1234,
});

jest.mock('./pdf-generator', () => ({
  PDFGenerator: jest.fn().mockImplementation(() => ({
    generateReport: generateReportMock,
  })),
}));

// Mock EmailService singleton
jest.mock('./services/email-service', () => {
  const instance = {
    configure: jest.fn(),
    sendReportFailure: jest.fn().mockResolvedValue(true),
  };
  return {
    __esModule: true,
    default: {
      getInstance: jest.fn(() => instance),
      __instance: instance, // expose for tests
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ReportScheduler } = require('./report-scheduler');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFGenerator } = require('./pdf-generator');

// Create a simple mock database with just getSetting
const mockDb: any = {
  getSetting: jest.fn((key: string) => {
    if (key === 'export_folder') return 'C:/Exports';
    if (key === 'employee_name') return 'Example User';
    if (key === 'auto_export_enabled') return 'true';
    if (key === 'auto_export_time') return '18:00';
    return null;
  }),
  getActivityLogsByDateRange: jest.fn(() => []),
  getAnalyticsByDateRange: jest.fn(() => []),
};

describe('ReportScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-08-28T10:15:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('computes next run at 18:00 local time by default', () => {
    const scheduler = new ReportScheduler(mockDb as any);
    const now = new Date('2024-08-28T10:15:00');
    const next = scheduler.computeNextRun(now);

    expect(next.scheduledAt.getHours()).toBe(18);
    expect(next.scheduledAt.getMinutes()).toBe(0);
    expect(next.scheduledAt.getDate()).toBe(now.getDate());
    expect(next.delayMs).toBe(next.scheduledAt.getTime() - now.getTime());
  });

  test('if now is after scheduled time, schedules for next day at configured time', () => {
    const scheduler = new ReportScheduler(mockDb as any);
    const now = new Date('2024-08-28T19:30:00');
    const next = scheduler.computeNextRun(now);

    // Should move to next day but still 18:00 local hour
    expect(next.scheduledAt.getDate()).toBe(now.getDate() + 1);
    expect(next.scheduledAt.getHours()).toBe(18);
  });

  test('respects auto_export_time setting', () => {
    mockDb.getSetting.mockImplementation((key: string) => {
      if (key === 'auto_export_time') return '07:45';
      if (key === 'auto_export_enabled') return 'true';
      if (key === 'export_folder') return 'C:/Exports';
      if (key === 'employee_name') return 'Example User';
      return null;
    });
    const scheduler = new ReportScheduler(mockDb as any);
    const now = new Date('2024-08-28T06:00:00');
    const next = scheduler.computeNextRun(now);

    expect(next.scheduledAt.getHours()).toBe(7);
    expect(next.scheduledAt.getMinutes()).toBe(45);
  });

  test('start() sets a timeout for next run when enabled', () => {
    const scheduler = new ReportScheduler(mockDb as any);
    const spy = jest.spyOn(global, 'setTimeout');

    scheduler.start();

    expect(spy).toHaveBeenCalled();
    const delay = (spy.mock.calls[0] as any)[1];
    expect(typeof delay).toBe('number');
    expect(delay).toBeGreaterThan(0);
  });

  test('start() does not set a timeout when disabled', () => {
    mockDb.getSetting.mockImplementation((key: string) => {
      if (key === 'auto_export_enabled') return 'false';
      if (key === 'auto_export_time') return '18:00';
      return null;
    });
    const scheduler = new ReportScheduler(mockDb as any);
    const spy = jest.spyOn(global, 'setTimeout');

    scheduler.start();

    expect(spy).not.toHaveBeenCalled();
  });

  test('runNow retries with exponential backoff on failure and eventually succeeds', async () => {
    // Use real timers for this test to avoid complexities with fake timers
    jest.useRealTimers();
    const scheduler = new ReportScheduler(mockDb as any);

    // Fail twice, succeed third
    generateReportMock
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValueOnce({ ok: true });

    await scheduler.runNow({ maxRetries: 3, baseDelayMs: 10 });

    expect(generateReportMock).toHaveBeenCalledTimes(3);
  });

  test('runNow logs error after exhausting retries', async () => {
    // Use real timers for this test as well
    jest.useRealTimers();
    const scheduler = new ReportScheduler(mockDb as any);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    generateReportMock.mockRejectedValue(new Error('boom'));

    await expect(
      scheduler.runNow({ maxRetries: 2, baseDelayMs: 10 })
    ).rejects.toThrow('boom');
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  test('runNow generates a daily PDF report for today (happy path)', async () => {
    const scheduler = new ReportScheduler(mockDb as any);

    generateReportMock.mockReset();
    generateReportMock.mockResolvedValue({ ok: true });
    await scheduler.runNow();

    expect(PDFGenerator).toHaveBeenCalled();
    expect(generateReportMock).toHaveBeenCalled();
    const callArg = (generateReportMock.mock.calls[0] as any)[0];
    expect(callArg.type).toBe('daily');
    expect(callArg.format).toBe('pdf');
    expect(callArg.includeCharts).toBe(true);
    expect(callArg.dateRange.startDate).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(callArg.dateRange.endDate).toBe(callArg.dateRange.startDate);
  });

  test('sends admin email on persistent failure after retries', async () => {
    jest.useRealTimers();
    const EmailServiceMock = require('./services/email-service').default;

    // Admin email configured and no recent notification
    mockDb.getSetting.mockImplementation((key: string) => {
      if (key === 'admin_alert_email') return 'admin@example.com';
      if (key === 'auto_export_failure_last_sent_at') return null;
      if (key === 'auto_export_enabled') return 'true';
      if (key === 'auto_export_time') return '18:00';
      if (key === 'export_folder') return 'C:/Exports';
      if (key === 'employee_name') return 'Example User';
      return null;
    });
    mockDb.setSetting = jest.fn();

    const scheduler = new ReportScheduler(mockDb as any);
    generateReportMock.mockRejectedValue(new Error('hard fail'));

    await expect(
      scheduler.runNow({ maxRetries: 2, baseDelayMs: 5 })
    ).rejects.toThrow('hard fail');

    // getInstance called and email attempted once
    expect(EmailServiceMock.getInstance).toHaveBeenCalled();
    const instance = (EmailServiceMock.getInstance as jest.Mock).mock.results[0]
      .value;
    expect(instance.configure).toHaveBeenCalled();
    expect(instance.sendReportFailure).toHaveBeenCalledTimes(1);

    // rate limit timestamp stored
    expect(mockDb.setSetting).toHaveBeenCalledWith(
      'auto_export_failure_last_sent_at',
      expect.any(String)
    );
  });

  test('rate-limits admin email if already sent within 24 hours', async () => {
    jest.useRealTimers();
    const EmailServiceMock = require('./services/email-service').default;

    const nowIso = new Date().toISOString();
    mockDb.getSetting.mockImplementation((key: string) => {
      if (key === 'admin_alert_email') return 'admin@example.com';
      if (key === 'auto_export_failure_last_sent_at') return nowIso; // sent recently
      if (key === 'auto_export_enabled') return 'true';
      if (key === 'auto_export_time') return '18:00';
      if (key === 'export_folder') return 'C:/Exports';
      if (key === 'employee_name') return 'Example User';
      return null;
    });
    mockDb.setSetting = jest.fn();

    const scheduler = new ReportScheduler(mockDb as any);
    generateReportMock.mockRejectedValue(new Error('still failing'));

    await expect(
      scheduler.runNow({ maxRetries: 1, baseDelayMs: 5 })
    ).rejects.toThrow('still failing');

    // getInstance should not be called due to rate limiting
    expect(EmailServiceMock.getInstance).not.toHaveBeenCalled();
    expect(mockDb.setSetting).not.toHaveBeenCalledWith(
      'auto_export_failure_last_sent_at',
      expect.any(String)
    );
  });
});
