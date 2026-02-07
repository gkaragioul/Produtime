/**
 * Auto Export Scheduler Tests
 * Tests for Phase 2: Validation Fixes
 * Tests for Phase 3: Error Handling Improvements
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AutoExportScheduler } from '../auto-export-scheduler';

describe('AutoExportScheduler - Validation Tests', () => {
  let tempDir: string;
  let scheduler: AutoExportScheduler;
  const logs: string[] = [];

  beforeEach(() => {
    // Create temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-export-'));

    // Create mock database
    const mockDb = {
      getActivityLogs: jest.fn().mockReturnValue([]),
      getSetting: jest.fn().mockReturnValue(tempDir),
    } as any;

    // Create mock PDF generator
    const mockPdf = {
      generateReport: jest.fn().mockResolvedValue({}),
    } as any;

    // Create scheduler with mocks
    scheduler = new AutoExportScheduler(mockDb, mockPdf, {
      logger: (msg: string) => logs.push(msg),
    });
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
    logs.length = 0;
  });

  describe('Export Folder Validation', () => {
    it('should validate existing writable folder', () => {
      const result = scheduler.validateExportFolder(tempDir);
      expect(result).toBe(true);
    });

    it('should create non-existent folder', () => {
      const newDir = path.join(tempDir, 'new-folder');
      expect(fs.existsSync(newDir)).toBe(false);

      const result = scheduler.validateExportFolder(newDir);
      expect(result).toBe(true);
      expect(fs.existsSync(newDir)).toBe(true);
    });

    it('should create nested non-existent folders', () => {
      const nestedDir = path.join(tempDir, 'level1', 'level2', 'level3');
      expect(fs.existsSync(nestedDir)).toBe(false);

      const result = scheduler.validateExportFolder(nestedDir);
      expect(result).toBe(true);
      expect(fs.existsSync(nestedDir)).toBe(true);
    });

    it('should fail for read-only folder', () => {
      const readOnlyDir = path.join(tempDir, 'readonly');
      fs.mkdirSync(readOnlyDir);
      fs.chmodSync(readOnlyDir, 0o444);

      const result = scheduler.validateExportFolder(readOnlyDir);
      expect(result).toBe(false);

      // Restore permissions for cleanup
      fs.chmodSync(readOnlyDir, 0o755);
    });

    it('should fail for empty path', () => {
      const result = scheduler.validateExportFolder('');
      expect(result).toBe(false);
    });

    it('should fail for whitespace-only path', () => {
      const result = scheduler.validateExportFolder('   ');
      expect(result).toBe(false);
    });

    it('should fail for null path', () => {
      const result = scheduler.validateExportFolder(null as any);
      expect(result).toBe(false);
    });

    it('should fail for undefined path', () => {
      const result = scheduler.validateExportFolder(undefined as any);
      expect(result).toBe(false);
    });

    it('should log success message for valid folder', () => {
      logs.length = 0;
      scheduler.validateExportFolder(tempDir);

      const successLog = logs.find((l) => l.includes('✅'));
      expect(successLog).toBeDefined();
      expect(successLog).toContain('writable');
    });

    it('should log error message for invalid folder', () => {
      logs.length = 0;
      scheduler.validateExportFolder('');

      const errorLog = logs.find((l) => l.includes('❌'));
      expect(errorLog).toBeDefined();
    });
  });

  describe('Error Handling - Activity Logs', () => {
    it('should handle missing activity logs gracefully', () => {
      const mockDb = {
        getActivityLogs: jest.fn().mockReturnValue([]),
      };

      scheduler.db = mockDb as any;
      logs.length = 0;

      const snapshot = scheduler.buildSessionSnapshot();

      const warningLog = logs.find((l) => l.includes('⚠️'));
      expect(warningLog).toBeDefined();
      expect(warningLog).toContain('No activity logs found');
    });

    it('should handle activity log retrieval errors', () => {
      const mockDb = {
        getActivityLogs: jest.fn().mockImplementation(() => {
          throw new Error('Database error');
        }),
      };

      scheduler.db = mockDb as any;
      logs.length = 0;

      const snapshot = scheduler.buildSessionSnapshot();

      const errorLog = logs.find((l) => l.includes('❌'));
      expect(errorLog).toBeDefined();
      expect(errorLog).toContain('Failed to retrieve activity logs');
    });

    it('should log number of activity logs retrieved', () => {
      const mockLogs = [
        { id: 1, activity: 'test1' },
        { id: 2, activity: 'test2' },
        { id: 3, activity: 'test3' },
      ];

      const mockDb = {
        getActivityLogs: jest.fn().mockReturnValue(mockLogs),
      };

      scheduler.db = mockDb as any;
      logs.length = 0;

      const snapshot = scheduler.buildSessionSnapshot();

      const infoLog = logs.find((l) => l.includes('Retrieved'));
      expect(infoLog).toBeDefined();
      expect(infoLog).toContain('3');
    });

    it('should handle activity tracker unavailability', () => {
      const mockDb = {
        getActivityLogs: jest.fn().mockImplementation(() => {
          throw new Error('Activity tracker not available');
        }),
      };

      scheduler.db = mockDb as any;
      logs.length = 0;

      const snapshot = scheduler.buildSessionSnapshot();

      const errorLog = logs.find((l) => l.includes('Activity tracker'));
      expect(errorLog).toBeDefined();
    });
  });

  describe('Validation Integration', () => {
    it('should validate folder before scheduling export', () => {
      logs.length = 0;
      const result = scheduler.validateExportFolder(tempDir);

      expect(result).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should prevent export to invalid folder', () => {
      const invalidDir = '/invalid/path/that/does/not/exist';
      const result = scheduler.validateExportFolder(invalidDir);

      expect(result).toBe(false);
    });

    it('should handle permission errors gracefully', () => {
      // Skip on Windows as chmod doesn't work the same way
      if (process.platform === 'win32') {
        expect(true).toBe(true);
        return;
      }

      const restrictedDir = path.join(tempDir, 'restricted');
      fs.mkdirSync(restrictedDir);
      fs.chmodSync(restrictedDir, 0o000);

      logs.length = 0;
      const result = scheduler.validateExportFolder(restrictedDir);

      expect(result).toBe(false);
      const errorLog = logs.find((l) => l.includes('❌'));
      expect(errorLog).toBeDefined();

      // Restore permissions for cleanup
      fs.chmodSync(restrictedDir, 0o755);
    });
  });

  describe('Logging Format', () => {
    it('should use consistent logging format', () => {
      logs.length = 0;
      scheduler.validateExportFolder(tempDir);

      const allLogs = logs.join('\n');
      const hasPrefix = allLogs.includes('[AutoExport]');
      expect(hasPrefix).toBe(true);
    });

    it('should use visual indicators in logs', () => {
      logs.length = 0;
      scheduler.validateExportFolder(tempDir);

      const allLogs = logs.join('\n');
      const hasIndicators =
        allLogs.includes('✅') ||
        allLogs.includes('⚠️') ||
        allLogs.includes('❌');
      expect(hasIndicators).toBe(true);
    });

    it('should include context in error messages', () => {
      logs.length = 0;
      scheduler.validateExportFolder('');

      const errorLog = logs.find((l) => l.includes('❌'));
      expect(errorLog).toBeDefined();
      expect(errorLog?.length).toBeGreaterThan(20);
    });
  });
});
