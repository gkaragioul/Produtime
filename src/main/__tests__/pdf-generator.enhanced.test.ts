// @jest-environment node

import * as path from 'path';

// Polyfill TextEncoder/TextDecoder for jsPDF dependencies in Node env
const { TextEncoder, TextDecoder } = require('util');
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

// Mock electron APIs before any imports
jest.mock('electron', () => {
  const pathModule = require('path');
  const osModule = require('os');
  return {
    app: {
      getPath: jest
        .fn()
        .mockReturnValue(
          pathModule.join(osModule.tmpdir(), 'TimePortTestDocuments')
        ),
    },
    shell: {
      openPath: jest.fn().mockResolvedValue(''),
    },
  };
});

// Mock os module for system info tests
jest.mock('os', () => {
  const actualOs = jest.requireActual('os');
  return {
    ...actualOs,
    hostname: jest.fn(),
    networkInterfaces: jest.fn(),
  };
});

// Import after mocks
const os = require('os');
const { PDFGenerator } = require('../pdf-generator');

// Minimal fake DatabaseManager
const createMockDb = (settings: Record<string, string> = {}) => ({
  getActivityLogsByDateRange: jest.fn().mockReturnValue([]),
  getAnalyticsByDateRange: jest.fn().mockReturnValue([]),
  getSetting: jest.fn().mockImplementation((key: string) => {
    const defaults: Record<string, string> = {
      employee_name: 'John Doe',
      export_folder: '',
      work_schedule_start: '09:00',
      work_schedule_end: '17:00',
      idle_threshold: '300',
      ...settings,
    };
    return defaults[key] ?? null;
  }),
});

describe('PDFGenerator - Enhanced Analytics', () => {
  describe('System Information Collection', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('getSystemInfo should collect hostname', () => {
      // Arrange
      os.hostname.mockReturnValue('TEST-COMPUTER');
      os.networkInterfaces.mockReturnValue({});
      const db = createMockDb({ employee_name: 'Alice Smith' });
      const generator = new PDFGenerator(db as any);

      // Act
      const systemInfo = (generator as any).getSystemInfo();

      // Assert
      expect(systemInfo).toBeDefined();
      expect(systemInfo.computerName).toBe('TEST-COMPUTER');
      expect(os.hostname).toHaveBeenCalled();
    });

    test('getSystemInfo should collect employee name from database', () => {
      // Arrange
      os.hostname.mockReturnValue('TEST-PC');
      os.networkInterfaces.mockReturnValue({});
      const db = createMockDb({ employee_name: 'Bob Johnson' });
      const generator = new PDFGenerator(db as any);

      // Act
      const systemInfo = (generator as any).getSystemInfo();

      // Assert
      expect(systemInfo.employeeName).toBe('Bob Johnson');
      expect(db.getSetting).toHaveBeenCalledWith('employee_name');
    });

    test('getSystemInfo should use "Unknown" for missing employee name', () => {
      // Arrange
      os.hostname.mockReturnValue('TEST-PC');
      os.networkInterfaces.mockReturnValue({});
      const db = createMockDb({ employee_name: '' });
      const generator = new PDFGenerator(db as any);

      // Act
      const systemInfo = (generator as any).getSystemInfo();

      // Assert
      expect(systemInfo.employeeName).toBe('Unknown');
    });

    test('getSystemInfo should collect IPv4 address from network interfaces', () => {
      // Arrange
      os.hostname.mockReturnValue('TEST-PC');
      os.networkInterfaces.mockReturnValue({
        eth0: [
          {
            address: '127.0.0.1',
            netmask: '255.0.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '127.0.0.1/8',
          },
          {
            address: '192.168.1.100',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:01',
            internal: false,
            cidr: '192.168.1.100/24',
          },
        ],
      });
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);

      // Act
      const systemInfo = (generator as any).getSystemInfo();

      // Assert
      expect(systemInfo.ipAddress).toBe('192.168.1.100');
    });

    test('getSystemInfo should skip internal IP addresses', () => {
      // Arrange
      os.hostname.mockReturnValue('TEST-PC');
      os.networkInterfaces.mockReturnValue({
        lo: [
          {
            address: '127.0.0.1',
            netmask: '255.0.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '127.0.0.1/8',
          },
        ],
        eth0: [
          {
            address: '10.0.0.50',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:01',
            internal: false,
            cidr: '10.0.0.50/24',
          },
        ],
      });
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);

      // Act
      const systemInfo = (generator as any).getSystemInfo();

      // Assert
      expect(systemInfo.ipAddress).toBe('10.0.0.50');
      expect(systemInfo.ipAddress).not.toBe('127.0.0.1');
    });

    test('getSystemInfo should use "Unknown" when no external IPv4 found', () => {
      // Arrange
      os.hostname.mockReturnValue('TEST-PC');
      os.networkInterfaces.mockReturnValue({
        lo: [
          {
            address: '127.0.0.1',
            netmask: '255.0.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '127.0.0.1/8',
          },
        ],
      });
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);

      // Act
      const systemInfo = (generator as any).getSystemInfo();

      // Assert
      expect(systemInfo.ipAddress).toBe('Unknown');
    });

    test('getSystemInfo should include report generation timestamp', () => {
      // Arrange
      os.hostname.mockReturnValue('TEST-PC');
      os.networkInterfaces.mockReturnValue({});
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const beforeTime = new Date().toISOString();

      // Act
      const systemInfo = (generator as any).getSystemInfo();
      const afterTime = new Date().toISOString();

      // Assert
      expect(systemInfo.reportGeneratedAt).toBeDefined();
      expect(systemInfo.reportGeneratedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
      expect(systemInfo.reportGeneratedAt >= beforeTime).toBe(true);
      expect(systemInfo.reportGeneratedAt <= afterTime).toBe(true);
    });

    test('getSystemInfo should return all required fields', () => {
      // Arrange
      os.hostname.mockReturnValue('WORK-LAPTOP');
      os.networkInterfaces.mockReturnValue({
        wlan0: [
          {
            address: '192.168.0.105',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: 'aa:bb:cc:dd:ee:ff',
            internal: false,
            cidr: '192.168.0.105/24',
          },
        ],
      });
      const db = createMockDb({ employee_name: 'Jane Developer' });
      const generator = new PDFGenerator(db as any);

      // Act
      const systemInfo = (generator as any).getSystemInfo();

      // Assert
      expect(systemInfo).toEqual({
        employeeName: 'Jane Developer',
        computerName: 'WORK-LAPTOP',
        ipAddress: '192.168.0.105',
        reportGeneratedAt: expect.any(String),
      });
    });
  });

  describe('Schedule Analysis', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('calculateScheduleAnalysis should calculate scheduled hours for standard workweek', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_weekly: JSON.stringify({
          monday: { start: '09:00', end: '17:00', nonWorking: false },
          tuesday: { start: '09:00', end: '17:00', nonWorking: false },
          wednesday: { start: '09:00', end: '17:00', nonWorking: false },
          thursday: { start: '09:00', end: '17:00', nonWorking: false },
          friday: { start: '09:00', end: '17:00', nonWorking: false },
          saturday: { start: '09:00', end: '17:00', nonWorking: true },
          sunday: { start: '09:00', end: '17:00', nonWorking: true },
        }),
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01', // Monday
        endDate: '2024-01-05', // Friday
      };
      const activityLogs: any[] = [];

      // Act
      const analysis = (generator as any).calculateScheduleAnalysis(
        dateRange,
        activityLogs
      );

      // Assert
      expect(analysis).toBeDefined();
      expect(analysis.scheduledHours).toBe(40); // 5 days * 8 hours
      expect(analysis.nonWorkingDays).toEqual([]);
    });

    test('calculateScheduleAnalysis should identify non-working days', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_weekly: JSON.stringify({
          monday: { start: '09:00', end: '17:00', nonWorking: false },
          tuesday: { start: '09:00', end: '17:00', nonWorking: false },
          wednesday: { start: '09:00', end: '17:00', nonWorking: false },
          thursday: { start: '09:00', end: '17:00', nonWorking: false },
          friday: { start: '09:00', end: '17:00', nonWorking: false },
          saturday: { start: '09:00', end: '17:00', nonWorking: true },
          sunday: { start: '09:00', end: '17:00', nonWorking: true },
        }),
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01', // Monday
        endDate: '2024-01-07', // Sunday
      };
      const activityLogs: any[] = [];

      // Act
      const analysis = (generator as any).calculateScheduleAnalysis(
        dateRange,
        activityLogs
      );

      // Assert
      expect(analysis.scheduledHours).toBe(40); // 5 working days * 8 hours
      expect(analysis.nonWorkingDays).toEqual(['2024-01-06', '2024-01-07']); // Saturday, Sunday
    });

    test('calculateScheduleAnalysis should calculate actual active and idle hours', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 3600, // 1 hour in seconds
        },
        {
          timestamp: '2024-01-01T11:00:00Z',
          app_name: 'System',
          window_title: 'Idle',
          duration: 1800, // 30 minutes in seconds
        },
        {
          timestamp: '2024-01-01T12:00:00Z',
          app_name: 'Chrome',
          window_title: 'Research',
          duration: 7200, // 2 hours in seconds
        },
      ];

      // Act
      const analysis = (generator as any).calculateScheduleAnalysis(
        dateRange,
        activityLogs
      );

      // Assert
      expect(analysis.actualActiveHours).toBeCloseTo(3, 1); // 3 hours active (VSCode + Chrome)
      expect(analysis.actualIdleHours).toBeCloseTo(0.5, 1); // 0.5 hours idle
    });

    test('calculateScheduleAnalysis should calculate productivity percentage', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 28800, // 8 hours in seconds
        },
      ];

      // Act
      const analysis = (generator as any).calculateScheduleAnalysis(
        dateRange,
        activityLogs
      );

      // Assert
      expect(analysis.scheduledHours).toBe(8);
      expect(analysis.actualActiveHours).toBe(8);
      expect(analysis.productivePercentage).toBe(100); // 8/8 * 100
    });

    test('calculateScheduleAnalysis should calculate overtime hours', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 36000, // 10 hours in seconds
        },
      ];

      // Act
      const analysis = (generator as any).calculateScheduleAnalysis(
        dateRange,
        activityLogs
      );

      // Assert
      expect(analysis.scheduledHours).toBe(8);
      expect(analysis.actualActiveHours).toBe(10);
      expect(analysis.overtimeHours).toBe(2);
      expect(analysis.undertimeHours).toBe(0);
    });

    test('calculateScheduleAnalysis should calculate undertime hours', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 18000, // 5 hours in seconds
        },
      ];

      // Act
      const analysis = (generator as any).calculateScheduleAnalysis(
        dateRange,
        activityLogs
      );

      // Assert
      expect(analysis.scheduledHours).toBe(8);
      expect(analysis.actualActiveHours).toBe(5);
      expect(analysis.overtimeHours).toBe(0);
      expect(analysis.undertimeHours).toBe(3);
    });

    test('calculateScheduleAnalysis should handle flexible schedule with early Friday', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_weekly: JSON.stringify({
          monday: { start: '09:00', end: '17:00', nonWorking: false },
          tuesday: { start: '09:00', end: '17:00', nonWorking: false },
          wednesday: { start: '09:00', end: '17:00', nonWorking: false },
          thursday: { start: '09:00', end: '17:00', nonWorking: false },
          friday: { start: '09:00', end: '14:00', nonWorking: false }, // Early Friday
          saturday: { start: '09:00', end: '17:00', nonWorking: true },
          sunday: { start: '09:00', end: '17:00', nonWorking: true },
        }),
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01', // Monday
        endDate: '2024-01-05', // Friday
      };
      const activityLogs: any[] = [];

      // Act
      const analysis = (generator as any).calculateScheduleAnalysis(
        dateRange,
        activityLogs
      );

      // Assert
      expect(analysis.scheduledHours).toBe(37); // 4 days * 8 hours + 1 day * 5 hours
    });
  });

  describe('Application Breakdown', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('calculateApplicationBreakdown should return top 10 applications', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const activityLogs = Array.from({ length: 15 }, (_, i) => ({
        timestamp: '2024-01-01T10:00:00Z',
        app_name: `App${i + 1}`,
        window_title: 'Window',
        duration: (15 - i) * 600, // Descending durations
      }));

      // Act
      const breakdown = (generator as any).calculateApplicationBreakdown(
        activityLogs
      );

      // Assert
      expect(breakdown).toBeDefined();
      expect(breakdown.length).toBeLessThanOrEqual(10);
      expect(breakdown[0].appName).toBe('App1'); // Highest duration
    });

    test('calculateApplicationBreakdown should calculate correct percentages', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 3600, // 1 hour = 50%
        },
        {
          timestamp: '2024-01-01T11:00:00Z',
          app_name: 'Chrome',
          window_title: 'Research',
          duration: 1800, // 30 minutes = 25%
        },
        {
          timestamp: '2024-01-01T12:00:00Z',
          app_name: 'Slack',
          window_title: 'Messages',
          duration: 1800, // 30 minutes = 25%
        },
      ];

      // Act
      const breakdown = (generator as any).calculateApplicationBreakdown(
        activityLogs
      );

      // Assert
      expect(breakdown.length).toBe(3);
      expect(breakdown[0].appName).toBe('VSCode');
      expect(breakdown[0].percentage).toBe(50);
      expect(breakdown[1].percentage).toBe(25);
      expect(breakdown[2].percentage).toBe(25);
    });

    test('calculateApplicationBreakdown should exclude System/Idle entries', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 3600,
        },
        {
          timestamp: '2024-01-01T11:00:00Z',
          app_name: 'System',
          window_title: 'Idle',
          duration: 1800,
        },
        {
          timestamp: '2024-01-01T12:00:00Z',
          app_name: 'Chrome',
          window_title: 'Research',
          duration: 1800,
        },
      ];

      // Act
      const breakdown = (generator as any).calculateApplicationBreakdown(
        activityLogs
      );

      // Assert
      expect(breakdown.length).toBe(2);
      expect(
        breakdown.find((app: any) => app.appName === 'System')
      ).toBeUndefined();
    });

    test('calculateApplicationBreakdown should assign categories to applications', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          app_name: 'Visual Studio Code',
          window_title: 'Coding',
          duration: 3600,
        },
        {
          timestamp: '2024-01-01T11:00:00Z',
          app_name: 'Google Chrome',
          window_title: 'Research',
          duration: 1800,
        },
      ];

      // Act
      const breakdown = (generator as any).calculateApplicationBreakdown(
        activityLogs
      );

      // Assert
      expect(breakdown[0].category).toBe('Development Tools');
      expect(breakdown[1].category).toBe('Web Browsers');
    });

    test('calculateApplicationBreakdown should sort by duration descending', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          app_name: 'App1',
          window_title: 'Window',
          duration: 1000,
        },
        {
          timestamp: '2024-01-01T11:00:00Z',
          app_name: 'App2',
          window_title: 'Window',
          duration: 5000,
        },
        {
          timestamp: '2024-01-01T12:00:00Z',
          app_name: 'App3',
          window_title: 'Window',
          duration: 3000,
        },
      ];

      // Act
      const breakdown = (generator as any).calculateApplicationBreakdown(
        activityLogs
      );

      // Assert
      expect(breakdown[0].appName).toBe('App2');
      expect(breakdown[1].appName).toBe('App3');
      expect(breakdown[2].appName).toBe('App1');
    });

    test('calculateApplicationBreakdown should handle empty activity logs', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const activityLogs: any[] = [];

      // Act
      const breakdown = (generator as any).calculateApplicationBreakdown(
        activityLogs
      );

      // Assert
      expect(breakdown).toBeDefined();
      expect(breakdown.length).toBe(0);
    });

    test('calculateApplicationBreakdown should handle single application', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 3600,
        },
      ];

      // Act
      const breakdown = (generator as any).calculateApplicationBreakdown(
        activityLogs
      );

      // Assert
      expect(breakdown.length).toBe(1);
      expect(breakdown[0].appName).toBe('VSCode');
      expect(breakdown[0].percentage).toBe(100);
    });
  });

  describe('Hourly Breakdown', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('calculateHourlyBreakdown should create 24-hour array', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };
      const activityLogs: any[] = [];

      // Act
      const breakdown = (generator as any).calculateHourlyBreakdown(
        dateRange,
        activityLogs
      );

      // Assert
      expect(breakdown).toBeDefined();
      expect(breakdown.length).toBe(24);
      expect(breakdown[0].hour).toBe(0);
      expect(breakdown[23].hour).toBe(23);
    });

    test('calculateHourlyBreakdown should calculate scheduled minutes per hour', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };
      const activityLogs: any[] = [];

      // Act
      const breakdown = (generator as any).calculateHourlyBreakdown(
        dateRange,
        activityLogs
      );

      // Assert
      // Hours 9-16 should have 60 scheduled minutes each (9:00-17:00 = 8 hours)
      expect(breakdown[9].scheduledMinutes).toBe(60);
      expect(breakdown[10].scheduledMinutes).toBe(60);
      expect(breakdown[16].scheduledMinutes).toBe(60);
      // Hours outside schedule should have 0
      expect(breakdown[8].scheduledMinutes).toBe(0);
      expect(breakdown[17].scheduledMinutes).toBe(0);
    });

    test('calculateHourlyBreakdown should calculate active minutes from logs', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 1800, // 30 minutes
        },
        {
          timestamp: '2024-01-01T10:30:00',
          app_name: 'Chrome',
          window_title: 'Research',
          duration: 1800, // 30 minutes
        },
      ];

      // Act
      const breakdown = (generator as any).calculateHourlyBreakdown(
        dateRange,
        activityLogs
      );

      // Assert
      expect(breakdown[10].activeMinutes).toBe(60); // 30 + 30 minutes
    });

    test('calculateHourlyBreakdown should calculate idle minutes from logs', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };
      const activityLogs = [
        {
          timestamp: '2024-01-01T11:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 1800, // 30 minutes active
        },
        {
          timestamp: '2024-01-01T11:30:00',
          app_name: 'System',
          window_title: 'Idle',
          duration: 900, // 15 minutes idle
        },
      ];

      // Act
      const breakdown = (generator as any).calculateHourlyBreakdown(
        dateRange,
        activityLogs
      );

      // Assert
      expect(breakdown[11].activeMinutes).toBe(30);
      expect(breakdown[11].idleMinutes).toBe(15);
    });

    test('calculateHourlyBreakdown should identify top 3 apps per hour', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-01',
      };
      const activityLogs = [
        {
          timestamp: '2024-01-01T14:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 1800, // 30 minutes
        },
        {
          timestamp: '2024-01-01T14:30:00',
          app_name: 'Chrome',
          window_title: 'Research',
          duration: 1200, // 20 minutes
        },
        {
          timestamp: '2024-01-01T14:50:00',
          app_name: 'Slack',
          window_title: 'Messages',
          duration: 600, // 10 minutes
        },
      ];

      // Act
      const breakdown = (generator as any).calculateHourlyBreakdown(
        dateRange,
        activityLogs
      );

      // Assert
      expect(breakdown[14].topApps).toBeDefined();
      expect(breakdown[14].topApps.length).toBe(3);
      expect(breakdown[14].topApps[0].name).toBe('VSCode');
      expect(breakdown[14].topApps[0].minutes).toBe(30);
      expect(breakdown[14].topApps[1].name).toBe('Chrome');
      expect(breakdown[14].topApps[2].name).toBe('Slack');
    });

    test('calculateHourlyBreakdown should handle weekly schedule', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_weekly: JSON.stringify({
          monday: { start: '09:00', end: '17:00', nonWorking: false },
          tuesday: { start: '09:00', end: '17:00', nonWorking: false },
          wednesday: { start: '09:00', end: '17:00', nonWorking: false },
          thursday: { start: '09:00', end: '17:00', nonWorking: false },
          friday: { start: '09:00', end: '14:00', nonWorking: false }, // Early Friday
          saturday: { start: '09:00', end: '17:00', nonWorking: true },
          sunday: { start: '09:00', end: '17:00', nonWorking: true },
        }),
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-05', // Friday
        endDate: '2024-01-05',
      };
      const activityLogs: any[] = [];

      // Act
      const breakdown = (generator as any).calculateHourlyBreakdown(
        dateRange,
        activityLogs
      );

      // Assert
      // Friday schedule is 09:00-14:00
      expect(breakdown[9].scheduledMinutes).toBe(60);
      expect(breakdown[13].scheduledMinutes).toBe(60);
      expect(breakdown[14].scheduledMinutes).toBe(0); // After 14:00
    });

    test('calculateHourlyBreakdown should aggregate across multiple days', () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const dateRange = {
        startDate: '2024-01-01',
        endDate: '2024-01-02',
      };
      const activityLogs = [
        {
          timestamp: '2024-01-01T10:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 1800, // Day 1: 30 minutes at hour 10
        },
        {
          timestamp: '2024-01-02T10:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 1800, // Day 2: 30 minutes at hour 10
        },
      ];

      // Act
      const breakdown = (generator as any).calculateHourlyBreakdown(
        dateRange,
        activityLogs
      );

      // Assert
      expect(breakdown[10].activeMinutes).toBe(60); // 30 + 30 from both days
      expect(breakdown[10].scheduledMinutes).toBe(120); // 60 * 2 days
    });
  });

  describe('Enhanced HTML Report Generation', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('generateEnhancedHTMLReport should include user information header', () => {
      // Arrange
      const db = createMockDb({
        employee_name: 'John Doe',
      });
      os.hostname.mockReturnValue('WORK-PC');
      os.networkInterfaces.mockReturnValue({
        eth0: [
          {
            address: '192.168.1.100',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:01',
            internal: false,
            cidr: '192.168.1.100/24',
          },
        ],
      });
      const generator = new PDFGenerator(db as any);
      const enhancedData = {
        userInfo: {
          employeeName: 'John Doe',
          computerName: 'WORK-PC',
          ipAddress: '192.168.1.100',
          reportGeneratedAt: '2024-01-01T12:00:00Z',
        },
        scheduleAnalysis: {
          scheduledHours: 40,
          actualActiveHours: 35,
          actualIdleHours: 2,
          productivePercentage: 88,
          idlePercentage: 5,
          overtimeHours: 0,
          undertimeHours: 5,
          nonWorkingDays: [],
        },
        applicationBreakdown: [],
        hourlyBreakdown: [],
      };

      // Act
      const html = (generator as any).generateEnhancedHTMLReport(enhancedData);

      // Assert
      expect(html).toContain('John Doe');
      expect(html).toContain('WORK-PC');
      expect(html).toContain('192.168.1.100');
    });

    test('generateEnhancedHTMLReport should include key metrics cards', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const enhancedData = {
        userInfo: {
          employeeName: 'Test User',
          computerName: 'TEST-PC',
          ipAddress: '10.0.0.1',
          reportGeneratedAt: '2024-01-01T12:00:00Z',
        },
        scheduleAnalysis: {
          scheduledHours: 40,
          actualActiveHours: 38,
          actualIdleHours: 1,
          productivePercentage: 95,
          idlePercentage: 3,
          overtimeHours: 0,
          undertimeHours: 2,
          nonWorkingDays: [],
        },
        applicationBreakdown: [],
        hourlyBreakdown: [],
      };

      // Act
      const html = (generator as any).generateEnhancedHTMLReport(enhancedData);

      // Assert
      expect(html).toContain('40'); // Scheduled hours
      expect(html).toContain('38'); // Actual hours
      expect(html).toContain('95'); // Productivity percentage
    });

    test('generateEnhancedHTMLReport should embed SVG charts', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const enhancedData = {
        userInfo: {
          employeeName: 'Test User',
          computerName: 'TEST-PC',
          ipAddress: '10.0.0.1',
          reportGeneratedAt: '2024-01-01T12:00:00Z',
        },
        scheduleAnalysis: {
          scheduledHours: 8,
          actualActiveHours: 7,
          actualIdleHours: 0.5,
          productivePercentage: 88,
          idlePercentage: 6,
          overtimeHours: 0,
          undertimeHours: 1,
          nonWorkingDays: [],
        },
        applicationBreakdown: [
          {
            appName: 'VSCode',
            totalSeconds: 14400,
            percentage: 50,
            category: 'Development',
          },
          {
            appName: 'Chrome',
            totalSeconds: 7200,
            percentage: 25,
            category: 'Browser',
          },
        ],
        hourlyBreakdown: Array.from({ length: 24 }, (_, i) => ({
          hour: i,
          scheduledMinutes: i >= 9 && i < 17 ? 60 : 0,
          activeMinutes: i >= 9 && i < 17 ? 50 : 0,
          idleMinutes: 0,
          topApps: [],
        })),
      };

      // Act
      const html = (generator as any).generateEnhancedHTMLReport(enhancedData);

      // Assert
      expect(html).toContain('<svg'); // Should contain SVG charts
      expect(html).toContain('</svg>');
    });

    test('generateEnhancedHTMLReport should include professional CSS', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const enhancedData = {
        userInfo: {
          employeeName: 'Test User',
          computerName: 'TEST-PC',
          ipAddress: '10.0.0.1',
          reportGeneratedAt: '2024-01-01T12:00:00Z',
        },
        scheduleAnalysis: {
          scheduledHours: 40,
          actualActiveHours: 35,
          actualIdleHours: 2,
          productivePercentage: 88,
          idlePercentage: 5,
          overtimeHours: 0,
          undertimeHours: 5,
          nonWorkingDays: [],
        },
        applicationBreakdown: [],
        hourlyBreakdown: [],
      };

      // Act
      const html = (generator as any).generateEnhancedHTMLReport(enhancedData);

      // Assert
      expect(html).toContain('<style>');
      expect(html).toContain('</style>');
      expect(html).toContain('@media print');
    });

    test('generateEnhancedHTMLReport should display application breakdown', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const enhancedData = {
        userInfo: {
          employeeName: 'Test User',
          computerName: 'TEST-PC',
          ipAddress: '10.0.0.1',
          reportGeneratedAt: '2024-01-01T12:00:00Z',
        },
        scheduleAnalysis: {
          scheduledHours: 8,
          actualActiveHours: 8,
          actualIdleHours: 0,
          productivePercentage: 100,
          idlePercentage: 0,
          overtimeHours: 0,
          undertimeHours: 0,
          nonWorkingDays: [],
        },
        applicationBreakdown: [
          {
            appName: 'Visual Studio Code',
            totalSeconds: 14400,
            percentage: 50,
            category: 'Development',
          },
          {
            appName: 'Google Chrome',
            totalSeconds: 7200,
            percentage: 25,
            category: 'Browser',
          },
          {
            appName: 'Slack',
            totalSeconds: 7200,
            percentage: 25,
            category: 'Communication',
          },
        ],
        hourlyBreakdown: [],
      };

      // Act
      const html = (generator as any).generateEnhancedHTMLReport(enhancedData);

      // Assert
      // App names may be truncated in charts, so check for partial matches
      expect(html).toContain('Visual Studi'); // Truncated in chart
      expect(html).toContain('Google Chrome');
      expect(html).toContain('Slack');
      expect(html).toContain('4.0'); // Hours for VSCode (14400 seconds = 4 hours)
    });

    test('generateEnhancedHTMLReport should be valid HTML', () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const enhancedData = {
        userInfo: {
          employeeName: 'Test User',
          computerName: 'TEST-PC',
          ipAddress: '10.0.0.1',
          reportGeneratedAt: '2024-01-01T12:00:00Z',
        },
        scheduleAnalysis: {
          scheduledHours: 40,
          actualActiveHours: 35,
          actualIdleHours: 2,
          productivePercentage: 88,
          idlePercentage: 5,
          overtimeHours: 0,
          undertimeHours: 5,
          nonWorkingDays: [],
        },
        applicationBreakdown: [],
        hourlyBreakdown: [],
      };

      // Act
      const html = (generator as any).generateEnhancedHTMLReport(enhancedData);

      // Assert
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
      expect(html).toContain('<head>');
      expect(html).toContain('</head>');
      expect(html).toContain('<body>');
      expect(html).toContain('</body>');
    });
  });

  describe('Integration Tests', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('getReportData should include enhanced analytics', async () => {
      // Arrange
      const db = createMockDb({
        employee_name: 'Integration Test User',
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      os.hostname.mockReturnValue('TEST-INTEGRATION-PC');
      os.networkInterfaces.mockReturnValue({
        eth0: [
          {
            address: '192.168.100.50',
            netmask: '255.255.255.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:01',
            internal: false,
            cidr: '192.168.100.50/24',
          },
        ],
      });

      const generator = new PDFGenerator(db as any);
      const options = {
        type: 'comprehensive' as any,
        format: 'pdf' as any,
        dateRange: {
          startDate: '2024-01-01',
          endDate: '2024-01-05',
        },
        includeCharts: true,
        includeSummary: true,
        includeDetails: true,
      };

      // Act
      const reportData = await generator.getReportData(options);

      // Assert
      expect(reportData.enhancedAnalytics).toBeDefined();
      expect(reportData.enhancedAnalytics?.userInfo).toBeDefined();
      expect(reportData.enhancedAnalytics?.userInfo.employeeName).toBe(
        'Integration Test User'
      );
      expect(reportData.enhancedAnalytics?.userInfo.computerName).toBe(
        'TEST-INTEGRATION-PC'
      );
      expect(reportData.enhancedAnalytics?.userInfo.ipAddress).toBe(
        '192.168.100.50'
      );
      expect(reportData.enhancedAnalytics?.scheduleAnalysis).toBeDefined();
      expect(reportData.enhancedAnalytics?.applicationBreakdown).toBeDefined();
      expect(reportData.enhancedAnalytics?.hourlyBreakdown).toBeDefined();
      expect(reportData.enhancedAnalytics?.hourlyBreakdown.length).toBe(24);
    });

    test('enhanced analytics should calculate correct metrics for multi-day range', async () => {
      // Arrange
      const db = createMockDb({
        work_schedule_start: '09:00',
        work_schedule_end: '17:00',
      });
      const generator = new PDFGenerator(db as any);
      const options = {
        type: 'comprehensive' as any,
        format: 'pdf' as any,
        dateRange: {
          startDate: '2024-01-01', // Monday
          endDate: '2024-01-05', // Friday
        },
        includeCharts: true,
        includeSummary: true,
        includeDetails: true,
      };

      // Act
      const reportData = await generator.getReportData(options);

      // Assert
      expect(
        reportData.enhancedAnalytics?.scheduleAnalysis.scheduledHours
      ).toBe(40); // 5 days * 8 hours
      expect(
        reportData.enhancedAnalytics?.scheduleAnalysis.nonWorkingDays
      ).toEqual([]);
    });

    test('enhanced analytics should handle weekend in date range', async () => {
      // Arrange
      const db = createMockDb({
        work_schedule_weekly: JSON.stringify({
          monday: { start: '09:00', end: '17:00', nonWorking: false },
          tuesday: { start: '09:00', end: '17:00', nonWorking: false },
          wednesday: { start: '09:00', end: '17:00', nonWorking: false },
          thursday: { start: '09:00', end: '17:00', nonWorking: false },
          friday: { start: '09:00', end: '17:00', nonWorking: false },
          saturday: { start: '09:00', end: '17:00', nonWorking: true },
          sunday: { start: '09:00', end: '17:00', nonWorking: true },
        }),
      });
      const generator = new PDFGenerator(db as any);
      const options = {
        type: 'comprehensive' as any,
        format: 'pdf' as any,
        dateRange: {
          startDate: '2024-01-01', // Monday
          endDate: '2024-01-07', // Sunday
        },
        includeCharts: true,
        includeSummary: true,
        includeDetails: true,
      };

      // Act
      const reportData = await generator.getReportData(options);

      // Assert
      expect(
        reportData.enhancedAnalytics?.scheduleAnalysis.scheduledHours
      ).toBe(40); // 5 working days
      expect(
        reportData.enhancedAnalytics?.scheduleAnalysis.nonWorkingDays
      ).toEqual(['2024-01-06', '2024-01-07']); // Saturday, Sunday
    });

    test('calculateProductivityMetrics should use sessions and switch rate', () => {
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);

      const logs = [
        {
          timestamp: '2024-01-01T09:00:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 1800,
        },
        {
          timestamp: '2024-01-01T09:30:00',
          app_name: 'Chrome',
          window_title: 'Docs',
          duration: 1800,
        },
        {
          timestamp: '2024-01-01T10:00:00',
          app_name: 'System',
          window_title: 'Idle',
          duration: 1200,
        },
        {
          timestamp: '2024-01-01T10:20:00',
          app_name: 'VSCode',
          window_title: 'Coding',
          duration: 1800,
        },
      ];

      const metrics = (generator as any).calculateProductivityMetrics(logs);

      expect(metrics.productivityScore).toBe(67);
      expect(metrics.focusScore).toBe(45);
      expect(metrics.averageSessionLength).toBe(2700);
      expect(metrics.contextSwitches).toBe(1);
      expect(metrics.distractionTime).toBe(0);
    });

    test('enhanced analytics should aggregate application usage correctly', async () => {
      // Arrange
      const db = createMockDb();
      const generator = new PDFGenerator(db as any);
      const options = {
        type: 'comprehensive' as any,
        format: 'pdf' as any,
        dateRange: {
          startDate: '2024-01-01',
          endDate: '2024-01-01',
        },
        includeCharts: true,
        includeSummary: true,
        includeDetails: true,
      };

      // Act
      const reportData = await generator.getReportData(options);

      // Assert
      expect(reportData.enhancedAnalytics?.applicationBreakdown).toBeDefined();
      expect(
        Array.isArray(reportData.enhancedAnalytics?.applicationBreakdown)
      ).toBe(true);
      // Should be sorted by duration descending
      const breakdown =
        reportData.enhancedAnalytics?.applicationBreakdown || [];
      for (let i = 0; i < breakdown.length - 1; i++) {
        expect(breakdown[i].totalSeconds).toBeGreaterThanOrEqual(
          breakdown[i + 1].totalSeconds
        );
      }
    });
  });
});
