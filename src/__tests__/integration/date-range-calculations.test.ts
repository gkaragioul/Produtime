/**
 * Test suite for date range report calculations
 * Tests the date calculation logic used in weekly, monthly, and custom reports
 * @jest-environment jsdom
 */

import { describe, it, expect } from "@jest/globals";

describe("Report Date Range Calculations", () => {
  describe("Weekly Report - Monday Calculation", () => {
    it("should calculate Monday from Wednesday Oct 8, 2025", () => {
      const wednesday = new Date("2025-10-08");
      const dayOfWeek = wednesday.getDay(); // 3
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // -2
      const monday = new Date(wednesday);
      monday.setDate(wednesday.getDate() + mondayOffset);

      const result = monday.toISOString().split("T")[0];
      expect(result).toBe("2025-10-06");
    });

    it("should calculate Monday from Sunday Oct 12, 2025", () => {
      const sunday = new Date("2025-10-12");
      const dayOfWeek = sunday.getDay(); // 0
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(sunday);
      monday.setDate(sunday.getDate() + mondayOffset);

      const result = monday.toISOString().split("T")[0];
      expect(result).toBe("2025-10-06");
    });

    it("should return same date when today is Monday", () => {
      const monday = new Date("2025-10-06");
      const dayOfWeek = monday.getDay(); // 1
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 0
      const calculatedMonday = new Date(monday);
      calculatedMonday.setDate(monday.getDate() + mondayOffset);

      const result = calculatedMonday.toISOString().split("T")[0];
      expect(result).toBe("2025-10-06");
    });

    it("should calculate Sunday from Monday", () => {
      const monday = new Date("2025-10-06");
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const result = sunday.toISOString().split("T")[0];
      expect(result).toBe("2025-10-12");
    });
  });

  describe("Monthly Report - Date Range Calculation", () => {
    it("should calculate October 2025 correctly", () => {
      const year = 2025;
      const month = 10;
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      const formatDate = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      expect(formatDate(startDate)).toBe("2025-10-01");
      expect(formatDate(endDate)).toBe("2025-10-31");
    });

    it("should handle February 2024 (leap year)", () => {
      const year = 2024;
      const month = 2;
      const endDate = new Date(year, month, 0);

      expect(endDate.getDate()).toBe(29);
    });

    it("should handle February 2025 (non-leap year)", () => {
      const year = 2025;
      const month = 2;
      const endDate = new Date(year, month, 0);

      expect(endDate.getDate()).toBe(28);
    });

    it("should handle September (30 days)", () => {
      const year = 2025;
      const month = 9;
      const endDate = new Date(year, month, 0);

      expect(endDate.getDate()).toBe(30);
    });

    it("should handle January (31 days)", () => {
      const year = 2025;
      const month = 1;
      const endDate = new Date(year, month, 0);

      expect(endDate.getDate()).toBe(31);
    });
  });

  describe("Date Range Validation", () => {
    it("should validate that start date is before end date", () => {
      const start = new Date("2025-10-01");
      const end = new Date("2025-10-07");

      expect(start.getTime()).toBeLessThan(end.getTime());
    });

    it("should allow same start and end date", () => {
      const start = new Date("2025-10-08");
      const end = new Date("2025-10-08");

      expect(start.getTime()).toBe(end.getTime());
    });

    it("should detect invalid range (start after end)", () => {
      const start = new Date("2025-10-08");
      const end = new Date("2025-10-01");

      expect(start.getTime()).toBeGreaterThan(end.getTime());
    });
  });

  describe("Edge Cases", () => {
    it("should handle week spanning month boundary", () => {
      const monday = new Date("2025-09-29");
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      expect(monday.toISOString().split("T")[0]).toBe("2025-09-29");
      expect(sunday.toISOString().split("T")[0]).toBe("2025-10-05");
    });

    it("should handle week spanning year boundary", () => {
      const monday = new Date("2024-12-30");
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      expect(monday.toISOString().split("T")[0]).toBe("2024-12-30");
      expect(sunday.toISOString().split("T")[0]).toBe("2025-01-05");
    });

    it("should handle December correctly", () => {
      const year = 2025;
      const month = 12;
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      const formatDate = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      expect(formatDate(startDate)).toBe("2025-12-01");
      expect(formatDate(endDate)).toBe("2025-12-31");
    });
  });
});
