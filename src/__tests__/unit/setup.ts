import '@testing-library/jest-dom';

// Mock electron APIs for testing (guard for Node env)
if (typeof (global as any).window !== 'undefined') {
  (global as any).window.electronAPI = {
    getVersion: () => '1.0.0',
    getPlatform: () => 'win32',

    // Activity Logs API
    getActivityLogs: jest.fn().mockResolvedValue({ success: true, data: [] }),
    getActivityLogsByDate: jest
      .fn()
      .mockResolvedValue({ success: true, data: [] }),
    insertActivityLog: jest.fn().mockResolvedValue({ success: true, data: 1 }),
    onActivityChanged: jest.fn().mockReturnValue(() => {}),

    // Settings API
    getSetting: jest
      .fn()
      .mockResolvedValue({ success: true, data: 'test_value' }),
    setSetting: jest.fn().mockResolvedValue({ success: true }),
    getAllSettings: jest.fn().mockResolvedValue({
      success: true,
      data: [
        { key: 'work_schedule_start', value: '09:00' },
        { key: 'work_schedule_end', value: '17:00' },
        { key: 'employee_name', value: 'Test User' },
      ],
    }),
    selectExportFolder: jest
      .fn()
      .mockResolvedValue({ success: true, data: 'C:/Exports' }),

    // Analytics API
    getAnalytics: jest.fn().mockResolvedValue({ success: true, data: [] }),
    insertAnalytics: jest.fn().mockResolvedValue({ success: true, data: 1 }),

    // Database Management API
    clearAllData: jest.fn().mockResolvedValue({ success: true }),
    getDbHealth: jest.fn().mockResolvedValue({ success: true, data: true }),

    // Auto-updater API
    checkForUpdates: jest.fn().mockResolvedValue({ success: true }),
    downloadUpdate: jest.fn().mockResolvedValue({ success: true }),
    installUpdate: jest.fn().mockResolvedValue({ success: true }),
    getUpdateStatus: jest.fn().mockResolvedValue({
      success: true,
      data: { status: 'update-not-available' },
    }),
    onUpdateStatusChanged: jest.fn().mockReturnValue(() => {}),

    // PDF Reports API
    generateReport: jest.fn().mockResolvedValue({
      success: true,
      data: {
        reportId: 'test-report-id',
        filePath: '/test/path/report.pdf',
        fileName: 'test-report.pdf',
        fileSize: 1024,
      },
    }),
    getReportData: jest.fn().mockResolvedValue({
      success: true,
      data: {
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
      },
    }),
    saveReport: jest.fn().mockResolvedValue({ success: true }),
    openReport: jest.fn().mockResolvedValue({ success: true }),

    // System Tray API
    showTrayNotification: jest.fn().mockResolvedValue({ success: true }),
    updateTrayState: jest.fn().mockResolvedValue({ success: true }),
    getTrayState: jest.fn().mockResolvedValue({
      success: true,
      data: {
        isVisible: true,
        isTrackingActive: false,
        unreadNotifications: 0,
      },
    }),
    toggleWindowVisibility: jest.fn().mockResolvedValue({ success: true }),
    quitApplication: jest.fn().mockResolvedValue({ success: true }),
    onTrayNotificationClicked: jest.fn().mockReturnValue(() => {}),
    onTrayActionTriggered: jest.fn().mockReturnValue(() => {}),
  };
}
