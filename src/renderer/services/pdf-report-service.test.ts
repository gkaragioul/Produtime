// Mock the shared types module
jest.mock('../../shared/types', () => ({
  ReportType: {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    CUSTOM: 'custom',
  },
  ReportFormat: {
    PDF: 'pdf',
    HTML: 'html',
  },
}));

import { PDFReportService } from './pdf-report-service';
import { ReportType, ReportFormat } from '../../shared/types';

// Mock the global window.electronAPI
const mockElectronAPI = {
  getVersion: jest.fn(),
  getPlatform: jest.fn(),
  getActivityLogs: jest.fn(),
  getActivityLogsByDate: jest.fn(),
  insertActivityLog: jest.fn(),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  getAllSettings: jest.fn(),
  getAnalytics: jest.fn(),
  insertAnalytics: jest.fn(),
  clearAllData: jest.fn(),
  getDbHealth: jest.fn(),
  checkForUpdates: jest.fn(),
  downloadUpdate: jest.fn(),
  installUpdate: jest.fn(),
  getUpdateStatus: jest.fn(),
  onUpdateStatusChanged: jest.fn(),
  generateReport: jest.fn(),
  getReportData: jest.fn(),
  saveReport: jest.fn(),
  openReport: jest.fn(),
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('PDFReportService', () => {
  let pdfReportService: PDFReportService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset singleton instance
    (PDFReportService as any).instance = undefined;

    pdfReportService = PDFReportService.getInstance();
  });

  describe('Singleton Pattern', () => {
    test('should return the same instance', () => {
      const instance1 = PDFReportService.getInstance();
      const instance2 = PDFReportService.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('should throw error if electronAPI is not available', () => {
      // Temporarily remove electronAPI
      const originalAPI = window.electronAPI;
      delete (window as any).electronAPI;

      expect(() => {
        (PDFReportService as any).instance = undefined;
        PDFReportService.getInstance();
      }).toThrow('Electron API not available');

      // Restore electronAPI
      window.electronAPI = originalAPI;
    });
  });

  describe('Report Generation', () => {
    test('should generate report successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          reportId: 'test-report-123',
          filePath: '/path/to/report.pdf',
          fileName: 'test-report.pdf',
          fileSize: 2048,
        },
      };

      mockElectronAPI.generateReport.mockResolvedValue(mockResponse);

      const options = pdfReportService.createDailyReportOptions('2024-08-28');
      const result = await pdfReportService.generateReport(options);

      expect(mockElectronAPI.generateReport).toHaveBeenCalledWith({ options });
      expect(result).toEqual(mockResponse.data);
    });

    test('should handle generate report error', async () => {
      mockElectronAPI.generateReport.mockResolvedValue({
        success: false,
        error: 'Generation failed',
      });

      const options = pdfReportService.createDailyReportOptions('2024-08-28');

      await expect(pdfReportService.generateReport(options)).rejects.toThrow(
        'Generation failed'
      );
    });

    test('should get report data successfully', async () => {
      const mockReportData = {
        title: 'Test Report',
        dateRange: { startDate: '2024-08-28', endDate: '2024-08-28' },
        summary: {
          totalHours: 8,
          totalSessions: 5,
          averageSessionLength: 96,
          mostActiveDay: 'Today',
          mostActiveHour: 14,
        },
        activityLogs: [],
        analytics: [],
      };

      mockElectronAPI.getReportData.mockResolvedValue({
        success: true,
        data: mockReportData,
      });

      const options = pdfReportService.createDailyReportOptions('2024-08-28');
      const result = await pdfReportService.getReportData(options);

      expect(mockElectronAPI.getReportData).toHaveBeenCalledWith(options);
      expect(result).toEqual(mockReportData);
    });

    test('should save report successfully', async () => {
      mockElectronAPI.saveReport.mockResolvedValue({ success: true });

      await pdfReportService.saveReport(
        'test-report-123',
        '/save/path/report.pdf'
      );

      expect(mockElectronAPI.saveReport).toHaveBeenCalledWith(
        'test-report-123',
        '/save/path/report.pdf'
      );
    });

    test('should open report successfully', async () => {
      mockElectronAPI.openReport.mockResolvedValue({ success: true });

      await pdfReportService.openReport('/path/to/report.pdf');

      expect(mockElectronAPI.openReport).toHaveBeenCalledWith(
        '/path/to/report.pdf'
      );
    });
  });

  describe('Report Options Creation', () => {
    test('should create daily report options', () => {
      const options = pdfReportService.createDailyReportOptions(
        '2024-08-28',
        false
      );

      expect(options).toEqual({
        type: ReportType.DAILY,
        format: ReportFormat.PDF,
        dateRange: {
          startDate: '2024-08-28',
          endDate: '2024-08-28',
        },
        includeCharts: false,
        includeSummary: true,
        includeDetails: true,
        title: expect.stringContaining('Daily Activity Report'),
      });
    });

    test('should create weekly report options', () => {
      const options = pdfReportService.createWeeklyReportOptions(
        '2024-08-26',
        '2024-09-01'
      );

      expect(options).toEqual({
        type: ReportType.WEEKLY,
        format: ReportFormat.PDF,
        dateRange: {
          startDate: '2024-08-26',
          endDate: '2024-09-01',
        },
        includeCharts: true,
        includeSummary: true,
        includeDetails: true,
        title: expect.stringContaining('Weekly Activity Report'),
      });
    });

    test('should create monthly report options', () => {
      const options = pdfReportService.createMonthlyReportOptions(2024, 8);

      expect(options.type).toBe(ReportType.MONTHLY);
      expect(options.format).toBe(ReportFormat.PDF);
      expect(options.dateRange.startDate).toBe('2024-08-01'); // August 1st (month parameter is 1-indexed)
      expect(options.dateRange.endDate).toBe('2024-08-31'); // August 31st
      expect(options.title).toContain('Monthly Activity Report');
    });

    test('should create custom report options', () => {
      const customOptions = {
        includeCharts: false,
        title: 'My Custom Report',
      };

      const options = pdfReportService.createCustomReportOptions(
        '2024-08-01',
        '2024-08-31',
        customOptions
      );

      expect(options.type).toBe(ReportType.CUSTOM);
      expect(options.includeCharts).toBe(false);
      expect(options.title).toBe('My Custom Report');
    });
  });

  describe('Date Utilities', () => {
    test('should get today date', () => {
      const today = pdfReportService.getToday();
      const expectedToday = new Date().toISOString().split('T')[0];
      expect(today).toBe(expectedToday);
    });

    test('should get yesterday date', () => {
      const yesterday = pdfReportService.getYesterday();
      const expectedYesterday = new Date();
      expectedYesterday.setDate(expectedYesterday.getDate() - 1);
      expect(yesterday).toBe(expectedYesterday.toISOString().split('T')[0]);
    });

    test('should get this week date range', () => {
      const thisWeek = pdfReportService.getThisWeek();
      expect(thisWeek).toHaveProperty('startDate');
      expect(thisWeek).toHaveProperty('endDate');
      expect(new Date(thisWeek.startDate).getTime()).toBeLessThanOrEqual(
        new Date(thisWeek.endDate).getTime()
      );
    });

    test('should get this month date range', () => {
      const thisMonth = pdfReportService.getThisMonth();
      const today = new Date();
      const expectedStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const expectedEnd = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0
      );

      expect(thisMonth.startDate).toBe(
        expectedStart.toISOString().split('T')[0]
      );
      expect(thisMonth.endDate).toBe(expectedEnd.toISOString().split('T')[0]);
    });
  });

  describe('Validation', () => {
    test('should validate date range correctly', () => {
      expect(
        pdfReportService.validateDateRange('2024-08-01', '2024-08-31')
      ).toBe(true);
      expect(
        pdfReportService.validateDateRange('2024-08-31', '2024-08-01')
      ).toBe(false);

      // Future dates should be invalid
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];
      expect(
        pdfReportService.validateDateRange(futureDateStr, futureDateStr)
      ).toBe(false);
    });

    test('should validate report options', () => {
      const validOptions =
        pdfReportService.createDailyReportOptions('2024-08-28');
      expect(pdfReportService.validateReportOptions(validOptions)).toEqual([]);

      const invalidOptions = {
        ...validOptions,
        dateRange: { startDate: '', endDate: '2024-08-28' },
      };
      const errors = pdfReportService.validateReportOptions(invalidOptions);
      expect(errors).toContain('Start date is required');
    });
  });

  describe('Utility Methods', () => {
    test('should format file size correctly', () => {
      expect(pdfReportService.formatFileSize(0)).toBe('0 Bytes');
      expect(pdfReportService.formatFileSize(1024)).toBe('1 KB');
      expect(pdfReportService.formatFileSize(1048576)).toBe('1 MB');
      expect(pdfReportService.formatFileSize(1073741824)).toBe('1 GB');
    });

    test('should get report type display names', () => {
      expect(pdfReportService.getReportTypeDisplayName(ReportType.DAILY)).toBe(
        'Daily Report'
      );
      expect(pdfReportService.getReportTypeDisplayName(ReportType.WEEKLY)).toBe(
        'Weekly Report'
      );
      expect(
        pdfReportService.getReportTypeDisplayName(ReportType.MONTHLY)
      ).toBe('Monthly Report');
      expect(pdfReportService.getReportTypeDisplayName(ReportType.CUSTOM)).toBe(
        'Custom Report'
      );
    });
  });
});

describe('Export Folder Selection', () => {
  let service: PDFReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    (PDFReportService as any).instance = undefined;
    service = PDFReportService.getInstance();
  });

  test('should prompt for export folder and save setting on success', async () => {
    (mockElectronAPI as any).selectExportFolder = jest
      .fn()
      .mockResolvedValue({ success: true, data: 'C:/Exports' });
    mockElectronAPI.setSetting.mockResolvedValue({ success: true });

    const result = await (service as any).selectExportFolderAndSave();

    expect((mockElectronAPI as any).selectExportFolder).toHaveBeenCalled();
    expect(mockElectronAPI.setSetting).toHaveBeenCalledWith({
      key: 'export_folder',
      value: 'C:/Exports',
    });
    expect(result).toBe('C:/Exports');
  });

  test('should handle cancel (no folder selected) gracefully', async () => {
    (mockElectronAPI as any).selectExportFolder = jest
      .fn()
      .mockResolvedValue({ success: true, data: null });

    const result = await (service as any).selectExportFolderAndSave();

    expect((mockElectronAPI as any).selectExportFolder).toHaveBeenCalled();
    expect(mockElectronAPI.setSetting).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  test('should throw on selection error', async () => {
    (mockElectronAPI as any).selectExportFolder = jest
      .fn()
      .mockResolvedValue({ success: false, error: 'Dialog failed' });

    await expect((service as any).selectExportFolderAndSave()).rejects.toThrow(
      'Dialog failed'
    );
  });
});
