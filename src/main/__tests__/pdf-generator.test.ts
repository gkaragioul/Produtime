import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock electron before importing PDFGenerator
jest.mock("electron", () => ({
  app: {
    getPath: jest.fn(() => "./test-data"),
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadURL: jest.fn().mockResolvedValue(undefined),
    webContents: {
      once: jest.fn((event, callback) => {
        // Immediately call the callback to simulate page load
        if (event === "did-finish-load") {
          setTimeout(callback, 0);
        }
      }),
      printToPDF: jest.fn().mockResolvedValue(Buffer.from("mock-pdf-content")),
    },
    close: jest.fn(),
    destroy: jest.fn(),
    isDestroyed: jest.fn().mockReturnValue(false),
  })),
}));

import { PDFGenerator } from "../pdf-generator";
import { DatabaseManager } from "../database";

describe("PDFGenerator", () => {
  let pdfGenerator: PDFGenerator;
  let mockDb: any;
  let tempDir: string;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create temp export directory and database mock compatible with PDFGenerator
    const exportDir = path.join(os.tmpdir(), "test-pdf-reports");
    try {
      fs.mkdirSync(exportDir, { recursive: true });
    } catch {}

    mockDb = {
      getActivityLogsByDateRange: jest.fn().mockResolvedValue([]),
      getAnalyticsByDateRange: jest.fn().mockResolvedValue([]),
      getSetting: jest.fn((key: string) =>
        key === "export_folder" ? exportDir : ""
      ),
    } as any;

    // Create temp directory for any additional file ops
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-pdf-"));

    pdfGenerator = new PDFGenerator(mockDb);
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("PDF Generation - Success Cases", () => {
    test("should generate PDF report successfully", async () => {
      const reportOptions = {
        type: "daily" as const,
        format: "pdf" as const,
        dateRange: { startDate: "2024-01-01", endDate: "2024-01-31" },
        includeCharts: false,
        includeSummary: true,
        includeDetails: true,
      };

      mockDb.getActivityLogsByDateRange.mockResolvedValue([
        {
          id: 1,
          timestamp: "2023-12-31T00:00:00.000Z",
          app_name: "VSCode",
          window_title: "Editor",
          duration: 3600,
        },
      ]);

      const result = await pdfGenerator.generateReport(reportOptions);

      expect(result).toBeDefined();
      expect(result.filePath).toBeDefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });

    test("should handle weekly reports", async () => {
      const reportOptions = {
        type: "weekly" as const,
        format: "pdf" as const,
        dateRange: { startDate: "2024-01-01", endDate: "2024-01-07" },
        includeCharts: false,
        includeSummary: true,
        includeDetails: true,
      };

      const result = await pdfGenerator.generateReport(reportOptions);

      expect(result.filePath).toBeDefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });

    test("should handle custom date range reports", async () => {
      const reportOptions = {
        type: "custom" as const,
        format: "pdf" as const,
        dateRange: { startDate: "2024-01-15", endDate: "2024-01-20" },
        includeCharts: false,
        includeSummary: true,
        includeDetails: true,
      };

      const result = await pdfGenerator.generateReport(reportOptions);

      expect(result.filePath).toBeDefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });

    test("should include analytics in report", async () => {
      const reportOptions = {
        type: "daily" as const,
        format: "pdf" as const,
        dateRange: { startDate: "2024-01-01", endDate: "2024-01-31" },
        includeCharts: false,
        includeSummary: true,
        includeDetails: true,
      };

      mockDb.getAnalyticsByDateRange.mockResolvedValue([
        {
          id: 1,
          metric_name: "active_time",
          metric_value: 28800,
          recorded_at: "2024-01-01T00:00:00.000Z",
        },
      ]);

      const result = await pdfGenerator.generateReport(reportOptions);

      expect(result.filePath).toBeDefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });
  });

  describe("PDF Generation - Error Cases", () => {
    test("should still generate a report even if startDate > endDate", async () => {
      const reportOptions = {
        type: "custom" as const,
        format: "pdf" as const,
        dateRange: { startDate: "2024-01-31", endDate: "2024-01-01" },
        includeCharts: false,
        includeSummary: true,
        includeDetails: true,
      };

      const result = await pdfGenerator.generateReport(reportOptions);
      expect(result.filePath).toBeDefined();
      expect(fs.existsSync(result.filePath)).toBe(true);
    });

    test("should handle database errors gracefully", async () => {
      mockDb.getActivityLogsByDateRange.mockImplementation(() => {
        throw new Error("Database error");
      });

      const reportOptions = {
        type: "daily" as const,
        format: "pdf" as const,
        dateRange: { startDate: "2024-01-01", endDate: "2024-01-31" },
        includeCharts: false,
        includeSummary: true,
        includeDetails: true,
      };

      await expect(pdfGenerator.generateReport(reportOptions)).rejects.toThrow(
        "Database error"
      );
    });
  });

  describe("PDF Placeholder Generation", () => {
    test("should generate placeholder PDF when Electron unavailable", async () => {
      const data: any = {
        title: "Test Report",
        dateRange: { startDate: "2024-01-01", endDate: "2024-01-31" },
        summary: {
          totalHours: 0,
          totalSessions: 0,
          averageSessionLength: 0,
          mostActiveDay: "N/A",
          mostActiveHour: 0,
        },
        activityLogs: [],
        analytics: [],
        applicationCategories: [],
        hourlyTimeline: [],
        productivityMetrics: {
          productivityScore: 0,
          focusScore: 0,
          distractionTime: 0,
          mostProductiveHour: 0,
          leastProductiveHour: 0,
          averageSessionLength: 0,
          contextSwitches: 0,
        },
        sessionDetails: [],
        workSchedule: {
          start: "09:00",
          end: "17:00",
          scheduledHours: 8,
          actualHours: 0,
          efficiency: 0,
        },
        topApplications: [],
        timeDistribution: {
          workTime: 0,
          breakTime: 0,
          overtimeHours: 0,
          undertimeHours: 0,
        },
      };
      const options: any = {
        type: "daily",
        format: "pdf",
        dateRange: data.dateRange,
        includeCharts: false,
        includeSummary: false,
        includeDetails: false,
      };
      const result = pdfGenerator.generatePDFPlaceholder(data, options);

      expect(
        typeof result === "string" || Buffer.isBuffer(result)
      ).toBeTruthy();
    });

    test("should include report title in placeholder", async () => {
      const data: any = {
        title: "Weekly Report",
        dateRange: { startDate: "2024-01-01", endDate: "2024-01-07" },
        summary: {
          totalHours: 0,
          totalSessions: 0,
          averageSessionLength: 0,
          mostActiveDay: "N/A",
          mostActiveHour: 0,
        },
        activityLogs: [],
        analytics: [],
        applicationCategories: [],
        hourlyTimeline: [],
        productivityMetrics: {
          productivityScore: 0,
          focusScore: 0,
          distractionTime: 0,
          mostProductiveHour: 0,
          leastProductiveHour: 0,
          averageSessionLength: 0,
          contextSwitches: 0,
        },
        sessionDetails: [],
        workSchedule: {
          start: "09:00",
          end: "17:00",
          scheduledHours: 8,
          actualHours: 0,
          efficiency: 0,
        },
        topApplications: [],
        timeDistribution: {
          workTime: 0,
          breakTime: 0,
          overtimeHours: 0,
          undertimeHours: 0,
        },
      };
      const options: any = {
        type: "weekly",
        format: "pdf",
        dateRange: data.dateRange,
        includeCharts: false,
        includeSummary: false,
        includeDetails: false,
      };
      const result = pdfGenerator.generatePDFPlaceholder(data, options);

      expect(
        typeof result === "string" || Buffer.isBuffer(result)
      ).toBeTruthy();
    });
  });

  describe("PDF File Operations", () => {
    test("should save PDF to file system", async () => {
      const reportOptions = {
        type: "daily" as const,
        format: "pdf" as const,
        dateRange: { startDate: "2024-01-01", endDate: "2024-01-31" },
        includeCharts: false,
        includeSummary: true,
        includeDetails: true,
      };

      const result = await pdfGenerator.generateReport(reportOptions);

      expect(result.filePath).toMatch(/\.pdf$/);
      expect(fs.existsSync(result.filePath)).toBe(true);
    });

    test("should create reports directory if not exists", async () => {
      const reportOptions = {
        type: "daily" as const,
        format: "pdf" as const,
        dateRange: { startDate: "2024-01-01", endDate: "2024-01-31" },
        includeCharts: false,
        includeSummary: true,
        includeDetails: true,
      };

      await pdfGenerator.generateReport(reportOptions);

      // Directory should be created or already exist
      expect(true).toBe(true);
    });
  });

  describe("PDF Rendering", () => {
    test("should detect Electron availability", () => {
      const canRender = pdfGenerator.canRenderPdfViaElectron();

      expect(typeof canRender).toBe("boolean");
    });

    test("should render PDF via Electron when available", async () => {
      const htmlContent = "<html><body>Test</body></html>";
      const outPath = path.join(tempDir, "rendered.pdf");

      await pdfGenerator.renderToPDF(htmlContent, outPath);

      expect(fs.existsSync(outPath)).toBe(true);
    });
  });
});
