// @jest-environment jsdom

import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";

// Mock electron app.getPath before imports
jest.mock("electron", () => {
  const osModule = require("os");
  const tmp = path.join(osModule.tmpdir(), "TimePortReportAccuracy");
  return {
    app: {
      getPath: jest.fn().mockImplementation((which: string) => {
        if (which === "userData") return tmp; // for database path
        if (which === "documents") return tmp; // for reports dir
        return tmp;
      }),
    },
    shell: { openPath: jest.fn().mockResolvedValue("") },
    BrowserWindow: function () {},
  };
});

import { DatabaseManager } from "../../main/database";
import { PDFGenerator } from "../../main/pdf-generator";
import { ReportFormat, ReportType } from "../../shared/types";

const iso = (d: Date) => d.toISOString().replace(/\..+$/, "").replace("T", " ");

function seedDay(
  db: DatabaseManager,
  date: string,
  entries: Array<{ app: string; title: string; seconds: number; hour?: number }>
) {
  let cursor = new Date(date + "T00:00:00");
  for (const e of entries) {
    const ts =
      e.hour != null
        ? new Date(date + `T${String(e.hour).padStart(2, "0")}:00:00`)
        : cursor;
    db.insertActivityLog({
      timestamp: iso(ts),
      app_name: e.app,
      window_title: e.title,
      duration: e.seconds,
    });
    cursor = new Date(ts.getTime() + e.seconds * 1000);
  }
}

describe("Report data accuracy vs SQLite (Daily/Weekly/Custom)", () => {
  let dbm: DatabaseManager;
  let generator: PDFGenerator;

  beforeEach(() => {
    jest.clearAllMocks();
    dbm = new DatabaseManager();
    // Settings: 09:00-17:00, Mon-Fri working, Sat/Sun non-working
    dbm.bulkUpdateSettings({
      work_schedule_start: "09:00",
      work_schedule_end: "17:00",
      work_schedule_weekly: JSON.stringify({
        monday: { start: "09:00", end: "17:00", nonWorking: false },
        tuesday: { start: "09:00", end: "17:00", nonWorking: false },
        wednesday: { start: "09:00", end: "17:00", nonWorking: false },
        thursday: { start: "09:00", end: "17:00", nonWorking: false },
        friday: { start: "09:00", end: "17:00", nonWorking: false },
        saturday: { start: "09:00", end: "17:00", nonWorking: true },
        sunday: { start: "09:00", end: "17:00", nonWorking: true },
      }),
      employee_name: "Integration Test User",
    });
    generator = new PDFGenerator(dbm);
  });

  afterEach(() => {
    dbm?.clearAllData();
    dbm?.close();
  });

  function sqlSums(startDate: string, endDate: string) {
    const sqlite = new Database(dbm.getDbPath());
    const row = sqlite
      .prepare(
        `
      SELECT
        COALESCE(SUM(CASE WHEN app_name='System' AND window_title='Idle' THEN duration ELSE 0 END), 0) AS idle_seconds,
        COALESCE(SUM(CASE WHEN NOT (app_name='System' AND window_title='Idle') THEN duration ELSE 0 END), 0) AS active_seconds,
        COALESCE(SUM(duration), 0) AS total_seconds
      FROM activity_logs
      WHERE date(timestamp, 'localtime') BETWEEN date(?, 'localtime') AND date(?, 'localtime')
    `
      )
      .get(startDate, endDate) as any;
    sqlite.close();
    return row;
  }

  test("Daily report matches SQL (active/idle, scheduled, over/under)", async () => {
    const day = "2024-01-02"; // Tuesday
    // Active 6h, Idle 2h within the day
    seedDay(dbm, day, [
      { app: "VSCode", title: "Coding", seconds: 3 * 3600, hour: 9 },
      { app: "System", title: "Idle", seconds: 2 * 3600, hour: 12 },
      { app: "Chrome", title: "Docs", seconds: 3 * 3600, hour: 14 },
    ]);

    const options = {
      type: ReportType.DAILY,
      format: ReportFormat.PDF,
      dateRange: { startDate: day, endDate: day },
      includeCharts: true,
      includeSummary: true,
      includeDetails: false,
      useEnhancedAnalytics: true,
      title: `Daily Activity Report - ${day}`,
    } as const;

    const report = await generator.getReportData(options as any);

    const sums = sqlSums(day, day);
    const activeH = Math.round((sums.active_seconds / 3600) * 100) / 100;
    const idleH = Math.round((sums.idle_seconds / 3600) * 100) / 100;
    const scheduledH = 8; // 09:00-17:00

    // Work schedule
    expect(report.workSchedule.actualHours).toBeCloseTo(activeH, 2);
    expect(report.workSchedule.scheduledHours).toBeCloseTo(scheduledH, 2);

    // Time distribution
    const overtime = Math.max(0, activeH - scheduledH);
    const undertime = Math.max(0, scheduledH - activeH);
    expect(report.timeDistribution.overtimeHours).toBeCloseTo(overtime, 2);
    expect(report.timeDistribution.undertimeHours).toBeCloseTo(undertime, 2);

    // Productivity (Active/Total)
    const total = sums.active_seconds + sums.idle_seconds;
    const productivity =
      total > 0 ? Math.round((sums.active_seconds / total) * 100) : 0;
    // Derived from inputs; card computes it in HTML; here we assert the formula from data
    expect(productivity).toBe(75); // 6h active / (6+2)h total = 75%
  });

  test("Weekly (Mon-Sun) accumulates scheduled hours and matches SQL active", async () => {
    // Week Mon 2024-01-01 (actually 2024-01-01 is Monday)
    const days = [
      "2024-01-01",
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
    ];
    for (const d of days) {
      seedDay(dbm, d, [
        { app: "VSCode", title: "Coding", seconds: 4 * 3600, hour: 9 },
        { app: "System", title: "Idle", seconds: 1 * 3600, hour: 13 },
        { app: "Chrome", title: "Docs", seconds: 2 * 3600, hour: 14 },
      ]);
    }
    // Weekend non-working
    seedDay(dbm, "2024-01-06", []);
    seedDay(dbm, "2024-01-07", []);

    const options = {
      type: ReportType.WEEKLY,
      format: ReportFormat.PDF,
      dateRange: { startDate: "2024-01-01", endDate: "2024-01-07" },
      includeCharts: true,
      includeSummary: true,
      includeDetails: false,
      useEnhancedAnalytics: true,
      title: `Weekly Activity Report - 2024-01-01..2024-01-07`,
    } as const;

    const report = await generator.getReportData(options as any);

    const sums = sqlSums("2024-01-01", "2024-01-07");
    const activeH = Math.round((sums.active_seconds / 3600) * 100) / 100;
    const scheduledH = 5 * 8; // 5 weekdays

    expect(report.workSchedule.actualHours).toBeCloseTo(activeH, 2);
    expect(report.workSchedule.scheduledHours).toBeCloseTo(scheduledH, 2);

    const overtime = Math.max(0, activeH - scheduledH);
    const undertime = Math.max(0, scheduledH - activeH);
    expect(report.timeDistribution.overtimeHours).toBeCloseTo(overtime, 2);
    expect(report.timeDistribution.undertimeHours).toBeCloseTo(undertime, 2);
  });

  test("Custom 3-day range computes schedule and over/under correctly", async () => {
    // 3-day window Wed..Fri
    const days = ["2024-02-07", "2024-02-08", "2024-02-09"];
    for (const d of days) {
      seedDay(dbm, d, [
        { app: "VSCode", title: "Coding", seconds: 8 * 3600, hour: 9 }, // full active
      ]);
    }

    const options = {
      type: ReportType.CUSTOM,
      format: ReportFormat.PDF,
      dateRange: { startDate: "2024-02-07", endDate: "2024-02-09" },
      includeCharts: false,
      includeSummary: true,
      includeDetails: false,
      useEnhancedAnalytics: true,
      title: `Custom Activity Report - 2024-02-07..2024-02-09`,
    } as const;

    const report = await generator.getReportData(options as any);

    const sums = sqlSums("2024-02-07", "2024-02-09");
    const activeH = Math.round((sums.active_seconds / 3600) * 100) / 100; // 24h
    const scheduledH = 3 * 8; // 24h

    expect(report.workSchedule.actualHours).toBeCloseTo(activeH, 2);
    expect(report.workSchedule.scheduledHours).toBeCloseTo(scheduledH, 2);
    expect(report.timeDistribution.overtimeHours).toBeCloseTo(0, 2);
    expect(report.timeDistribution.undertimeHours).toBeCloseTo(0, 2);
  });
});
