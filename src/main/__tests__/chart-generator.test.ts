/**
 * @jest-environment jsdom
 */

import {
  ChartGenerator,
  ColumnChartGenerator,
  LineChartGenerator,
  BarChartData,
  LineChartDataPoint,
} from "../utils/chart-generator";

describe("ChartGenerator", () => {
  describe("ColumnChartGenerator", () => {
    test("should generate valid SVG with data", () => {
      // Arrange
      const generator = new ColumnChartGenerator();
      const data: BarChartData[] = [
        { label: "Active", value: 6.5, color: "#4CAF50" },
        { label: "Idle", value: 1.5, color: "#FFC107" },
      ];

      // Act
      const svg = generator.generate(data, "Time Distribution", "Hours");

      // Assert
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain("Time Distribution");
      expect(svg).toContain("Hours");
      expect(svg).toContain("Active");
      expect(svg).toContain("Idle");
      expect(svg).toContain("6.5");
      expect(svg).toContain("1.5");
    });

    test("should generate bars with correct colors", () => {
      // Arrange
      const generator = new ColumnChartGenerator();
      const data: BarChartData[] = [
        { label: "Test1", value: 10, color: "#FF0000" },
        { label: "Test2", value: 20, color: "#00FF00" },
      ];

      // Act
      const svg = generator.generate(data, "Test Chart", "Value");

      // Assert
      expect(svg).toContain("#FF0000");
      expect(svg).toContain("#00FF00");
    });

    test("should use default color when not specified", () => {
      // Arrange
      const generator = new ColumnChartGenerator();
      const data: BarChartData[] = [{ label: "Test", value: 10 }];

      // Act
      const svg = generator.generate(data, "Test Chart", "Value");

      // Assert
      expect(svg).toContain("#4A90E2"); // Default color
    });

    test("should handle empty data gracefully", () => {
      // Arrange
      const generator = new ColumnChartGenerator();
      const data: BarChartData[] = [];

      // Act
      const svg = generator.generate(data, "Empty Chart", "Value");

      // Assert
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain("Empty Chart - No Data");
    });

    test("should escape special characters in labels", () => {
      // Arrange
      const generator = new ColumnChartGenerator();
      const data: BarChartData[] = [{ label: "Test & <Special>", value: 10 }];

      // Act
      const svg = generator.generate(data, "Chart & Title", "Value");

      // Assert
      expect(svg).toContain("&amp;");
      expect(svg).toContain("&lt;");
      expect(svg).toContain("&gt;");
    });

    test("should generate multiple bars correctly", () => {
      // Arrange
      const generator = new ColumnChartGenerator();
      const data: BarChartData[] = [
        { label: "App1", value: 5 },
        { label: "App2", value: 10 },
        { label: "App3", value: 15 },
        { label: "App4", value: 20 },
      ];

      // Act
      const svg = generator.generate(data, "Applications", "Hours");

      // Assert
      expect(svg).toContain("App1");
      expect(svg).toContain("App2");
      expect(svg).toContain("App3");
      expect(svg).toContain("App4");
      // Should have 4 rect elements
      const rectCount = (svg.match(/<rect/g) || []).length;
      expect(rectCount).toBe(4);
    });

    test("should scale bars proportionally to max value", () => {
      // Arrange
      const generator = new ColumnChartGenerator();
      const data: BarChartData[] = [
        { label: "Small", value: 1 },
        { label: "Large", value: 100 },
      ];

      // Act
      const svg = generator.generate(data, "Test", "Value");

      // Assert
      expect(svg).toContain("<svg");
      // Both bars should be present
      expect(svg).toContain("Small");
      expect(svg).toContain("Large");
    });

    test("should use custom dimensions when provided", () => {
      // Arrange
      const generator = new ColumnChartGenerator({
        width: 800,
        height: 400,
      });
      const data: BarChartData[] = [{ label: "Test", value: 10 }];

      // Act
      const svg = generator.generate(data, "Test", "Value");

      // Assert
      expect(svg).toContain('width="800"');
      expect(svg).toContain('height="400"');
    });
  });

  describe("LineChartGenerator", () => {
    test("should generate valid SVG with data", () => {
      // Arrange
      const generator = new LineChartGenerator();
      const data: LineChartDataPoint[] = [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
        { x: 2, y: 15 },
        { x: 3, y: 25 },
      ];

      // Act
      const svg = generator.generate(
        data,
        "Hourly Activity",
        "Hour",
        "Minutes"
      );

      // Assert
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain("Hourly Activity");
      expect(svg).toContain("Hour");
      expect(svg).toContain("Minutes");
    });

    test("should generate path element for line", () => {
      // Arrange
      const generator = new LineChartGenerator();
      const data: LineChartDataPoint[] = [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
      ];

      // Act
      const svg = generator.generate(data, "Test", "X", "Y");

      // Assert
      expect(svg).toContain("<path");
      expect(svg).toContain('stroke="#4A90E2"');
    });

    test("should generate circle elements for data points", () => {
      // Arrange
      const generator = new LineChartGenerator();
      const data: LineChartDataPoint[] = [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
        { x: 2, y: 15 },
      ];

      // Act
      const svg = generator.generate(data, "Test", "X", "Y");

      // Assert
      const circleCount = (svg.match(/<circle/g) || []).length;
      expect(circleCount).toBe(3);
    });

    test("should handle empty data gracefully", () => {
      // Arrange
      const generator = new LineChartGenerator();
      const data: LineChartDataPoint[] = [];

      // Act
      const svg = generator.generate(data, "Empty Chart", "X", "Y");

      // Assert
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain("Empty Chart - No Data");
    });

    test("should generate axis labels", () => {
      // Arrange
      const generator = new LineChartGenerator();
      const data: LineChartDataPoint[] = [
        { x: 0, y: 10 },
        { x: 23, y: 20 },
      ];

      // Act
      const svg = generator.generate(data, "Test", "Hour of Day", "Activity");

      // Assert
      expect(svg).toContain("Hour of Day");
      expect(svg).toContain("Activity");
    });

    test("should handle 24-hour data correctly", () => {
      // Arrange
      const generator = new LineChartGenerator();
      const data: LineChartDataPoint[] = Array.from({ length: 24 }, (_, i) => ({
        x: i,
        y: Math.random() * 60,
      }));

      // Act
      const svg = generator.generate(
        data,
        "Hourly Breakdown",
        "Hour",
        "Minutes"
      );

      // Assert
      expect(svg).toContain("<svg");
      const circleCount = (svg.match(/<circle/g) || []).length;
      expect(circleCount).toBe(24);
    });

    test("should use custom dimensions when provided", () => {
      // Arrange
      const generator = new LineChartGenerator({
        width: 1000,
        height: 500,
      });
      const data: LineChartDataPoint[] = [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
      ];

      // Act
      const svg = generator.generate(data, "Test", "X", "Y");

      // Assert
      expect(svg).toContain('width="1000"');
      expect(svg).toContain('height="500"');
    });

    test("should escape special characters in labels", () => {
      // Arrange
      const generator = new LineChartGenerator();
      const data: LineChartDataPoint[] = [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
      ];

      // Act
      const svg = generator.generate(
        data,
        "Test & Chart",
        "X & Axis",
        "Y & Value"
      );

      // Assert
      expect(svg).toContain("&amp;");
    });
  });
});
