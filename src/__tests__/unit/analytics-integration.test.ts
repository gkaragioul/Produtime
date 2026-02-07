/**
 * Analytics Integration Tests
 *
 * These tests verify that the analytics system works end-to-end:
 * 1. Database operations (insert/retrieve)
 * 2. IPC communication (if applicable)
 * 3. Data integrity
 */

import { DatabaseManager } from "../../main/database";
import * as fs from "fs";
import * as path from "path";
import { clearAllMockData } from "../../__mocks__/better-sqlite3";

// Mock electron app
jest.mock("electron", () => ({
  app: {
    getPath: jest.fn(() => "./test-analytics-data"),
  },
}));

describe("Analytics Integration Tests", () => {
  let db: DatabaseManager;
  const testDbPath = "./test-analytics-data/timeport.db";

  beforeEach(() => {
    // Clear all mock data before each test
    clearAllMockData();

    // Ensure test directory exists
    if (!fs.existsSync("./test-analytics-data")) {
      fs.mkdirSync("./test-analytics-data", { recursive: true });
    }

    // Remove existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    db = new DatabaseManager();
  });

  afterEach(() => {
    // Clean up
    if (db) {
      db.close();
    }

    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe("Analytics Database Operations", () => {
    test("should insert analytics metric successfully", () => {
      const metric = {
        metric_name: "session_count",
        metric_value: 5,
      };

      const id = db.insertAnalytics(metric);

      expect(id).toBeGreaterThan(0);
      expect(typeof id).toBe("number");
    });

    test("should retrieve analytics by metric name", () => {
      // Insert multiple metrics
      db.insertAnalytics({ metric_name: "session_count", metric_value: 5 });
      db.insertAnalytics({ metric_name: "export_count", metric_value: 3 });
      db.insertAnalytics({ metric_name: "session_count", metric_value: 7 });

      // Retrieve specific metric
      const sessionMetrics = db.getAnalytics("session_count");

      expect(sessionMetrics).toHaveLength(2);
      expect(sessionMetrics[0].metric_name).toBe("session_count");
      expect(sessionMetrics[1].metric_name).toBe("session_count");

      // Values should be in descending order by recorded_at (most recent first)
      expect([
        sessionMetrics[0].metric_value,
        sessionMetrics[1].metric_value,
      ]).toContain(5);
      expect([
        sessionMetrics[0].metric_value,
        sessionMetrics[1].metric_value,
      ]).toContain(7);
    });

    test("should retrieve all analytics when no metric name specified", () => {
      db.insertAnalytics({ metric_name: "metric1", metric_value: 1 });
      db.insertAnalytics({ metric_name: "metric2", metric_value: 2 });
      db.insertAnalytics({ metric_name: "metric3", metric_value: 3 });

      const allAnalytics = db.getAnalytics();

      expect(allAnalytics).toHaveLength(3);

      const metricNames = allAnalytics.map((a) => a.metric_name);
      expect(metricNames).toContain("metric1");
      expect(metricNames).toContain("metric2");
      expect(metricNames).toContain("metric3");
    });

    test("should include timestamp when inserting analytics", () => {
      const beforeInsert = new Date();

      db.insertAnalytics({ metric_name: "test_metric", metric_value: 100 });

      const afterInsert = new Date();
      const analytics = db.getAnalytics("test_metric");

      expect(analytics).toHaveLength(1);
      expect(analytics[0].recorded_at).toBeDefined();

      const recordedAt = new Date(analytics[0].recorded_at);
      expect(recordedAt.getTime()).toBeGreaterThanOrEqual(
        beforeInsert.getTime() - 1000
      );
      expect(recordedAt.getTime()).toBeLessThanOrEqual(
        afterInsert.getTime() + 1000
      );
    });

    test("should handle multiple analytics insertions", () => {
      const metrics = [
        { metric_name: "login_count", metric_value: 10 },
        { metric_name: "export_count", metric_value: 5 },
        { metric_name: "session_duration", metric_value: 3600 },
        { metric_name: "failed_login", metric_value: 2 },
      ];

      const ids = metrics.map((m) => db.insertAnalytics(m));

      expect(ids).toHaveLength(4);
      ids.forEach((id) => expect(id).toBeGreaterThan(0));

      const allAnalytics = db.getAnalytics();
      expect(allAnalytics).toHaveLength(4);
    });

    test("should return empty array for non-existent metric", () => {
      db.insertAnalytics({ metric_name: "existing_metric", metric_value: 1 });

      const nonExistent = db.getAnalytics("non_existent_metric");

      expect(nonExistent).toEqual([]);
    });

    test("should handle zero and negative values", () => {
      db.insertAnalytics({ metric_name: "zero_metric", metric_value: 0 });
      db.insertAnalytics({ metric_name: "negative_metric", metric_value: -5 });

      const zeroMetric = db.getAnalytics("zero_metric");
      const negativeMetric = db.getAnalytics("negative_metric");

      expect(zeroMetric).toHaveLength(1);
      expect(zeroMetric[0].metric_value).toBe(0);

      expect(negativeMetric).toHaveLength(1);
      expect(negativeMetric[0].metric_value).toBe(-5);
    });

    test("should handle large metric values", () => {
      const largeValue = 999999999;

      db.insertAnalytics({
        metric_name: "large_metric",
        metric_value: largeValue,
      });

      const analytics = db.getAnalytics("large_metric");

      expect(analytics).toHaveLength(1);
      expect(analytics[0].metric_value).toBe(largeValue);
    });
  });

  describe("Analytics Data Integrity", () => {
    test("should maintain analytics data after multiple operations", () => {
      // Insert analytics
      db.insertAnalytics({ metric_name: "test1", metric_value: 1 });

      // Insert activity logs (different table)
      db.insertActivityLog({
        timestamp: new Date().toISOString(),
        app_name: "Test App",
        window_title: "Test Window",
        duration: 100,
      });

      // Insert more analytics
      db.insertAnalytics({ metric_name: "test2", metric_value: 2 });

      // Verify analytics are intact
      const analytics = db.getAnalytics();
      expect(analytics).toHaveLength(2);
    });

    test("should clear analytics when clearAllData is called", () => {
      db.insertAnalytics({ metric_name: "test_metric", metric_value: 10 });

      let analytics = db.getAnalytics();
      expect(analytics).toHaveLength(1);

      db.clearAllData();

      analytics = db.getAnalytics();
      expect(analytics).toHaveLength(0);
    });

    test("should preserve analytics order by timestamp", () => {
      // Insert metrics with slight delays to ensure different timestamps
      db.insertAnalytics({ metric_name: "ordered", metric_value: 1 });

      // Small delay
      const delay = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      return delay(10)
        .then(() =>
          db.insertAnalytics({ metric_name: "ordered", metric_value: 2 })
        )
        .then(() => delay(10))
        .then(() =>
          db.insertAnalytics({ metric_name: "ordered", metric_value: 3 })
        )
        .then(() => {
          const analytics = db.getAnalytics("ordered");

          expect(analytics).toHaveLength(3);
          // Should be in descending order (most recent first)
          expect(analytics[0].metric_value).toBe(3);
          expect(analytics[1].metric_value).toBe(2);
          expect(analytics[2].metric_value).toBe(1);
        });
    });
  });

  describe("Analytics Schema Validation", () => {
    test("should have all required fields in analytics record", () => {
      db.insertAnalytics({ metric_name: "complete_test", metric_value: 42 });

      const analytics = db.getAnalytics("complete_test");

      expect(analytics).toHaveLength(1);
      const record = analytics[0];

      expect(record).toHaveProperty("id");
      expect(record).toHaveProperty("metric_name");
      expect(record).toHaveProperty("metric_value");
      expect(record).toHaveProperty("recorded_at");

      expect(typeof record.id).toBe("number");
      expect(typeof record.metric_name).toBe("string");
      expect(typeof record.metric_value).toBe("number");
      expect(typeof record.recorded_at).toBe("string");
    });

    test("should auto-increment analytics IDs", () => {
      const id1 = db.insertAnalytics({ metric_name: "test", metric_value: 1 });
      const id2 = db.insertAnalytics({ metric_name: "test", metric_value: 2 });
      const id3 = db.insertAnalytics({ metric_name: "test", metric_value: 3 });

      expect(id2).toBeGreaterThan(id1);
      expect(id3).toBeGreaterThan(id2);
    });
  });

  describe("Analytics Performance", () => {
    test("should handle bulk analytics insertions efficiently", () => {
      const startTime = Date.now();

      // Insert 100 analytics records
      for (let i = 0; i < 100; i++) {
        db.insertAnalytics({
          metric_name: `metric_${i % 10}`,
          metric_value: i,
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (less than 1 second)
      expect(duration).toBeLessThan(1000);

      const analytics = db.getAnalytics();
      expect(analytics).toHaveLength(100);
    });

    test("should retrieve analytics efficiently", () => {
      // Insert test data
      for (let i = 0; i < 50; i++) {
        db.insertAnalytics({ metric_name: "perf_test", metric_value: i });
      }

      const startTime = Date.now();
      const analytics = db.getAnalytics("perf_test");
      const endTime = Date.now();

      const duration = endTime - startTime;

      // Should retrieve quickly (less than 100ms)
      expect(duration).toBeLessThan(100);
      expect(analytics).toHaveLength(50);
    });
  });
});
