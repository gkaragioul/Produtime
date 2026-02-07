// @jest-environment node

interface ActivityLog {
  id: number;
  timestamp: string;
  app_name: string;
  window_title: string;
  duration: number;
}

type FakeDb = {
  getActivityLogsByDateRange: (start: string, end: string) => ActivityLog[];
};

describe('DataExporter core (RED)', () => {
  const makeDb = (logs: ActivityLog[]): FakeDb => ({
    getActivityLogsByDateRange: jest.fn(() => logs),
  });

  test('exportCSV returns header and rows; escapes quotes/commas; orders by timestamp desc', async () => {
    // Arrange
    const logs: ActivityLog[] = [
      { id: 1, timestamp: '2025-01-01T10:00:00.000Z', app_name: 'VSCode', window_title: 'main.ts', duration: 120 },
      { id: 2, timestamp: '2025-01-01T11:00:00.000Z', app_name: 'Chrome', window_title: 'Docs, "Spec" page', duration: 60 },
    ];
    const db = makeDb(logs);

    // Act
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DataExporter } = require('../data-exporter'); // File to be implemented (RED)
    const exporter = new DataExporter(db as any);
    const csv = await exporter.exportCSV({
      dateRange: { startDate: '2025-01-01', endDate: '2025-01-01' },
    });

    // Assert
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('timestamp,app_name,window_title,duration');
    expect(lines.length).toBe(1 + logs.length);

    // Ensure second line corresponds to the later timestamp first (desc)
    expect(lines[1]).toContain('2025-01-01T11:00:00.000Z');

    // Ensure quotes/commas are escaped properly in CSV
    expect(lines[1]).toMatch(/Chrome/);
    expect(lines[1]).toMatch(/"Docs, ""Spec"" page"/);
  });

  test('exportJSON returns array of objects with required fields', async () => {
    const logs: ActivityLog[] = [
      { id: 1, timestamp: '2025-02-01T09:00:00.000Z', app_name: 'Slack', window_title: 'Standup', duration: 300 },
    ];
    const db = makeDb(logs);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DataExporter } = require('../data-exporter');
    const exporter = new DataExporter(db as any);
    const json = await exporter.exportJSON({
      dateRange: { startDate: '2025-02-01', endDate: '2025-02-01' },
    });

    const arr = JSON.parse(json);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0]).toMatchObject({
      timestamp: '2025-02-01T09:00:00.000Z',
      app_name: 'Slack',
      window_title: 'Standup',
      duration: 300,
    });
  });
});

