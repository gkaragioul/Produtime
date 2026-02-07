// Minimal shared types used by the service
interface DateRange {
  startDate: string;
  endDate: string;
}

declare global {
  interface Window {
    electronAPI: any;
  }
}

describe('DataExportService (renderer) — RED', () => {
  const mockElectronAPI: any = {
    exportData: jest.fn(),
  };

  beforeEach(() => {
    if (!(global as any).window) {
      (global as any).window = {} as any;
    }
    (global as any).window.electronAPI = mockElectronAPI;
    jest.clearAllMocks();
  });

  test('exportCSV calls electronAPI.exportData and returns CSV text', async () => {
    // Arrange
    const csv = 'timestamp,app_name,window_title,duration\n...';
    mockElectronAPI.exportData.mockResolvedValue({
      success: true,
      data: { format: 'csv', content: csv },
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DataExportService } = require('./data-export-service'); // File to be implemented (RED)
    const svc = DataExportService.getInstance();

    // Act
    const res = await svc.export({
      format: 'csv',
      dateRange: { startDate: '2025-01-01', endDate: '2025-01-01' },
    });

    // Assert
    expect(mockElectronAPI.exportData).toHaveBeenCalledWith({
      format: 'csv',
      dateRange: { startDate: '2025-01-01', endDate: '2025-01-01' },
    });
    expect(res.format).toBe('csv');
    expect(res.content).toContain('timestamp');
  });

  test('propagates error when exportData fails', async () => {
    mockElectronAPI.exportData.mockResolvedValue({
      success: false,
      error: 'nope',
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DataExportService } = require('./data-export-service');
    const svc = DataExportService.getInstance();

    await expect(
      svc.export({
        format: 'json',
        dateRange: { startDate: '2025-01-01', endDate: '2025-01-01' },
      })
    ).rejects.toThrow('nope');
  });
});
