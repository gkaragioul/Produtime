import { DatabaseManager } from './database';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Mock electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => './test-data'),
  },
}));

describe('DatabaseManager', () => {
  let db: DatabaseManager;
  const testDbPath = './test-data/timeport.db';

  beforeEach(() => {
    // Ensure test directory exists
    if (!fs.existsSync('./test-data')) {
      fs.mkdirSync('./test-data', { recursive: true });
    }
    
    // Remove existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    db = new DatabaseManager();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterAll(() => {
    // Clean up test directory
    if (fs.existsSync('./test-data')) {
      fs.rmSync('./test-data', { recursive: true, force: true });
    }
  });

  describe('Database Initialization', () => {
    test('should initialize database successfully', () => {
      expect(db).toBeDefined();
      expect(db.isHealthy()).toBe(true);
    });

    test('should create database file', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    test('should run migrations and create tables', () => {
      // Test that we can query the tables (they exist)
      expect(() => db.getActivityLogs(1)).not.toThrow();
      expect(() => db.getAllSettings()).not.toThrow();
      expect(() => db.getAnalytics()).not.toThrow();
    });

    test('should insert default settings', () => {
      const settings = db.getAllSettings();
      expect(settings.length).toBeGreaterThan(0);
      
      const workStart = db.getSetting('work_schedule_start');
      expect(workStart).toBe('09:00');
      
      const workEnd = db.getSetting('work_schedule_end');
      expect(workEnd).toBe('17:00');
    });
  });

  describe('Activity Logs', () => {
    test('should insert and retrieve activity log', () => {
      const log = {
        timestamp: '2024-08-28 10:00:00',
        app_name: 'Test App',
        window_title: 'Test Window',
        duration: 300,
      };

      const id = db.insertActivityLog(log);
      expect(id).toBeGreaterThan(0);

      const logs = db.getActivityLogs(1);
      expect(logs).toHaveLength(1);
      expect(logs[0].app_name).toBe('Test App');
      expect(logs[0].window_title).toBe('Test Window');
      expect(logs[0].duration).toBe(300);
    });

    test('should retrieve logs by date range', () => {
      const log1 = {
        timestamp: '2024-08-28 10:00:00',
        app_name: 'App 1',
        window_title: 'Window 1',
        duration: 300,
      };

      const log2 = {
        timestamp: '2024-08-29 10:00:00',
        app_name: 'App 2',
        window_title: 'Window 2',
        duration: 400,
      };

      db.insertActivityLog(log1);
      db.insertActivityLog(log2);

      const logs = db.getActivityLogsByDateRange('2024-08-28 00:00:00', '2024-08-28 23:59:59');
      expect(logs).toHaveLength(1);
      expect(logs[0].app_name).toBe('App 1');
    });

    test('should handle pagination', () => {
      // Insert multiple logs
      for (let i = 0; i < 5; i++) {
        db.insertActivityLog({
          timestamp: `2024-08-28 10:0${i}:00`,
          app_name: `App ${i}`,
          window_title: `Window ${i}`,
          duration: 300 + i,
        });
      }

      const firstPage = db.getActivityLogs(2, 0);
      expect(firstPage).toHaveLength(2);

      const secondPage = db.getActivityLogs(2, 2);
      expect(secondPage).toHaveLength(2);
    });
  });

  describe('Settings', () => {
    test('should get and set settings', () => {
      db.setSetting('test_key', 'test_value');
      const value = db.getSetting('test_key');
      expect(value).toBe('test_value');
    });

    test('should return null for non-existent setting', () => {
      const value = db.getSetting('non_existent_key');
      expect(value).toBeNull();
    });

    test('should update existing setting', () => {
      db.setSetting('update_test', 'initial_value');
      db.setSetting('update_test', 'updated_value');
      
      const value = db.getSetting('update_test');
      expect(value).toBe('updated_value');
    });
  });

  describe('Analytics', () => {
    test('should insert and retrieve analytics', () => {
      const metric = {
        metric_name: 'session_count',
        metric_value: 5,
      };

      const id = db.insertAnalytics(metric);
      expect(id).toBeGreaterThan(0);

      const analytics = db.getAnalytics('session_count');
      expect(analytics).toHaveLength(1);
      expect(analytics[0].metric_name).toBe('session_count');
      expect(analytics[0].metric_value).toBe(5);
    });

    test('should retrieve all analytics when no metric name specified', () => {
      db.insertAnalytics({ metric_name: 'metric1', metric_value: 1 });
      db.insertAnalytics({ metric_name: 'metric2', metric_value: 2 });

      const allAnalytics = db.getAnalytics();
      expect(allAnalytics).toHaveLength(2);
    });
  });

  describe('Data Management', () => {
    test('should clear all data except settings', () => {
      // Insert test data
      db.insertActivityLog({
        timestamp: '2024-08-28 10:00:00',
        app_name: 'Test App',
        window_title: 'Test Window',
        duration: 300,
      });
      
      db.insertAnalytics({
        metric_name: 'test_metric',
        metric_value: 10,
      });

      // Clear data
      db.clearAllData();

      // Check that data is cleared
      const logs = db.getActivityLogs();
      const analytics = db.getAnalytics();
      const settings = db.getAllSettings();

      expect(logs).toHaveLength(0);
      expect(analytics).toHaveLength(0);
      expect(settings.length).toBeGreaterThan(0); // Settings should remain
    });
  });

  describe('Error Handling', () => {
    test('should handle database health check', () => {
      expect(db.isHealthy()).toBe(true);
      
      db.close();
      expect(db.isHealthy()).toBe(false);
    });
  });
});
