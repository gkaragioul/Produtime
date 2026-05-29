import * as fs from 'fs';
import * as path from 'path';
import { PDFGenerator } from './pdf-generator';
import type { ReportOptions } from '../shared/types';

// Mock electron app.getPath to use a test directory
jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => './test-data') },
  shell: { openPath: jest.fn() },
}));

describe('PDFGenerator - Story 3 core generation', () => {
  const testDir = './test-data/reports-tests';

  const mockDb: any = {
    getSetting: jest.fn((key: string) => {
      if (key === 'export_folder') return testDir;
      if (key === 'employee_name') return 'Example User';
      return null;
    }),
    getActivityLogsByDateRange: jest.fn((start: string, end: string) => {
      // 3 activities across two apps, with durations in minutes (or seconds depending on DB impl)
      return [
        {
          id: 1,
          timestamp: `${start} 09:00:00`,
          app_name: 'VS Code',
          window_title: 'file.ts',
          duration: 60,
        },
        {
          id: 2,
          timestamp: `${start} 10:30:00`,
          app_name: 'Chrome',
          window_title: 'Docs',
          duration: 30,
        },
        {
          id: 3,
          timestamp: `${end} 14:00:00`,
          app_name: 'VS Code',
          window_title: 'other.ts',
          duration: 90,
        },
      ];
    }),
    getAnalyticsByDateRange: jest.fn(() => []),
  };

  let generator: PDFGenerator;

  beforeAll(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    generator = new PDFGenerator(mockDb);
  });

  afterAll(() => {
    // Cleanup only this test's subdirectory to avoid interfering with other tests
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const baseOptions: ReportOptions = {
    type: 'daily' as any,
    format: 'html' as any,
    dateRange: { startDate: '2024-08-28', endDate: '2024-08-28' },
    includeCharts: true,
    includeSummary: true,
    includeDetails: true,
  };

  test('generates HTML report file including metadata and inline SVG pie chart', async () => {
    const res = await generator.generateReport(baseOptions);
    expect(res.filePath.endsWith('.html')).toBe(true);
    expect(fs.existsSync(res.filePath)).toBe(true);

    const html = fs.readFileSync(res.filePath, 'utf-8');

    // Metadata: title, employee name, date
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Daily Activity Report');
    expect(html).toContain('Employee: Example User');
    expect(html).toContain('Generated on');

    // Activity table headers
    expect(html).toContain('<th>Date</th>');
    expect(html).toContain('<th>Activity</th>');

    // Inline SVG pie chart (look for svg tag and a slice path)
    expect(html).toMatch(/<svg[^>]*class="pie-chart"/);
    expect(html).toMatch(/<path[^>]*class="pie-slice"/);

    // Legend entries
    expect(html).toContain('VS Code');
    expect(html).toContain('Chrome');
  });

  test('getReportData returns chartData when includeCharts is true', async () => {
    const data = await generator.getReportData(baseOptions);
    expect(data.chartData).toBeDefined();
    expect(data.chartData!.activityBreakdown.length).toBeGreaterThan(0);
  });

  test('generates PDF file with .pdf extension when format=PDF', async () => {
    const res = await generator.generateReport({
      ...baseOptions,
      format: 'pdf' as any,
    });
    expect(res.filePath.endsWith('.pdf')).toBe(true);
    expect(fs.existsSync(res.filePath)).toBe(true);

    const contents = fs.readFileSync(res.filePath, 'utf-8');
    expect(contents).toContain('PDF Report Placeholder');
  });
});
