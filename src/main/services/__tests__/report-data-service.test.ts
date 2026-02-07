import { ReportDataService } from '../report-data-service';
import { DatabaseManager } from '../../database';
import { ActivityLog, ReportOptions, ReportType, ReportFormat } from '../../../shared/types';

// Mock DatabaseManager
const mockDatabase = {
    getSetting: jest.fn(),
    getActivityLogsByDateRange: jest.fn(),
    getAnalyticsByDateRange: jest.fn(),
} as unknown as DatabaseManager;

describe('ReportDataService', () => {
    let service: ReportDataService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new ReportDataService(mockDatabase);
        (global as any).activityTracker = { snapshotNow: jest.fn() };
    });

    describe('getReportData', () => {
        it('should fetch data and calculate metrics', async () => {
            const dateRange = { startDate: '2023-01-01', endDate: '2023-01-01' };
            const options: ReportOptions = {
                type: ReportType.DAILY,
                format: ReportFormat.PDF,
                dateRange,
                includeCharts: false,
                includeSummary: true,
                includeDetails: true
            };

            const mockLogs: ActivityLog[] = [
                {
                    timestamp: '2023-01-01T10:00:00.000Z',
                    app_name: 'Visual Studio Code',
                    window_title: 'project.ts',
                    duration: 3600
                },
                {
                    timestamp: '2023-01-01T11:00:00.000Z',
                    app_name: 'Slack',
                    window_title: 'General',
                    duration: 1800
                },
                {
                    timestamp: '2023-01-01T11:30:00.000Z',
                    app_name: 'System',
                    window_title: 'Idle',
                    duration: 1800
                }
            ];

            (mockDatabase.getActivityLogsByDateRange as jest.Mock).mockResolvedValue(mockLogs);
            (mockDatabase.getAnalyticsByDateRange as jest.Mock).mockResolvedValue([]);
            (mockDatabase.getSetting as jest.Mock).mockReturnValue(undefined); // Default settings

            const result = await service.getReportData(options);

            expect(mockDatabase.getActivityLogsByDateRange).toHaveBeenCalledWith(
                dateRange.startDate,
                dateRange.endDate,
                undefined
            );

            // Verify Summary
            // Active: VSCode (1h) + Slack (0.5h) = 1.5h
            expect(result.summary.totalHours).toBe(1.5);
            expect(result.summary.totalSessions).toBe(2);

            // Verify Top Apps
            expect(result.topApplications).toHaveLength(2);
            expect(result.topApplications[0].name).toBe('Visual Studio Code');
            expect(result.topApplications[0].time).toBe(3600);
            expect(result.topApplications[0].percentage).toBe(67); // 3600 / 5400
            expect(result.topApplications[1].name).toBe('Slack');

            // Verify Categories
            const devCategory = result.applicationCategories.find(c => c.name === 'Development Tools');
            expect(devCategory).toBeDefined();
            expect(devCategory?.totalTime).toBe(3600);

            const commCategory = result.applicationCategories.find(c => c.name === 'Communication');
            expect(commCategory).toBeDefined();
            expect(commCategory?.totalTime).toBe(1800);
        });

        it('should sanitize activity logs when privacy mode is enabled', async () => {
            const dateRange = { startDate: '2023-01-01', endDate: '2023-01-01' };
            const options: ReportOptions = {
                type: ReportType.DAILY,
                format: ReportFormat.PDF,
                dateRange,
                includeCharts: false,
                includeSummary: true,
                includeDetails: true
            };

            const mockLogs: ActivityLog[] = [
                {
                    timestamp: '2023-01-01T10:00:00.000Z',
                    app_name: 'Slack',
                    window_title: 'Secret Channel',
                    duration: 3600
                }
            ];

            (mockDatabase.getActivityLogsByDateRange as jest.Mock).mockResolvedValue(mockLogs);
            (mockDatabase.getAnalyticsByDateRange as jest.Mock).mockResolvedValue([]);

            // Mock Privacy Settings
            (mockDatabase.getSetting as jest.Mock).mockImplementation((key) => {
                if (key === 'privacy_mode_enabled') return 'true';
                if (key === 'privacy_apps') return JSON.stringify(['Slack']);
                return undefined;
            });

            const result = await service.getReportData(options);

            expect(result.activityLogs[0].window_title).toBe('Slack');
            // Should be replaced by app name
        });
    });
});
