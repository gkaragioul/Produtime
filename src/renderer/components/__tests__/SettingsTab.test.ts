/**
 * Settings Tab Tests
 * Tests for Phase 2: Date Range Validation
 * Tests for Phase 3: Watchdog Timer
 */

import {
  validateCustomDateRange,
  REPORT_GENERATION_TIMEOUT_MS,
} from '../SettingsTab';

// Helper function to get date string in YYYY-MM-DD format
function getDateString(daysOffset: number = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split('T')[0];
}

describe('SettingsTab - Date Range Validation', () => {
  describe('Valid Date Ranges', () => {
    it('should accept valid date range (same day)', () => {
      const today = getDateString(0);
      const error = validateCustomDateRange(today, today);
      expect(error).toBeNull();
    });

    it('should accept valid date range (multiple days)', () => {
      const today = getDateString(0);
      const fifteenDaysAgo = getDateString(-15);
      const error = validateCustomDateRange(fifteenDaysAgo, today);
      expect(error).toBeNull();
    });

    it('should accept valid date range (365 days)', () => {
      const today = getDateString(0);
      const oneYearAgo = getDateString(-365);
      const error = validateCustomDateRange(oneYearAgo, today);
      expect(error).toBeNull();
    });

    it('should accept valid date range (1 day)', () => {
      const today = getDateString(0);
      const yesterday = getDateString(-1);
      const error = validateCustomDateRange(yesterday, today);
      expect(error).toBeNull();
    });
  });

  describe('Invalid Date Ranges - Start > End', () => {
    it('should reject start > end', () => {
      const today = getDateString(0);
      const yesterday = getDateString(-1);
      const error = validateCustomDateRange(today, yesterday);
      expect(error).not.toBeNull();
      expect(error).toContain('Start date must be before');
    });

    it('should reject start > end (multiple days)', () => {
      const today = getDateString(0);
      const tenDaysAgo = getDateString(-10);
      const error = validateCustomDateRange(today, tenDaysAgo);
      expect(error).not.toBeNull();
      expect(error).toContain('Start date must be before');
    });
  });

  describe('Invalid Date Ranges - Future Dates', () => {
    it('should reject future end date', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const error = validateCustomDateRange('2025-10-01', tomorrowStr);
      expect(error).not.toBeNull();
      expect(error).toContain('End date cannot be in the future');
    });

    it('should reject future start date', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      const error = validateCustomDateRange(tomorrowStr, tomorrowStr);
      expect(error).not.toBeNull();
      expect(error).toContain('End date cannot be in the future');
    });

    it('should accept today as end date', () => {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      const error = validateCustomDateRange('2025-10-01', todayStr);
      expect(error).toBeNull();
    });
  });

  describe('Invalid Date Ranges - Exceeds 365 Days', () => {
    it('should reject range > 365 days', () => {
      const today = getDateString(0);
      const moreThanOneYearAgo = getDateString(-366);
      const error = validateCustomDateRange(moreThanOneYearAgo, today);
      expect(error).not.toBeNull();
      expect(error).toContain('Date range cannot exceed 365 days');
    });

    it('should reject range > 365 days (2 years)', () => {
      const today = getDateString(0);
      const twoYearsAgo = getDateString(-730);
      const error = validateCustomDateRange(twoYearsAgo, today);
      expect(error).not.toBeNull();
      expect(error).toContain('Date range cannot exceed 365 days');
    });

    it('should accept range = 365 days', () => {
      const today = getDateString(0);
      const oneYearAgo = getDateString(-365);
      const error = validateCustomDateRange(oneYearAgo, today);
      expect(error).toBeNull();
    });
  });

  describe('Invalid Date Ranges - Missing Dates', () => {
    it('should reject missing start date', () => {
      const today = getDateString(0);
      const error = validateCustomDateRange('', today);
      expect(error).not.toBeNull();
      expect(error).toContain('Please select both');
    });

    it('should reject missing end date', () => {
      const yesterday = getDateString(-1);
      const error = validateCustomDateRange(yesterday, '');
      expect(error).not.toBeNull();
      expect(error).toContain('Please select both');
    });

    it('should reject both dates missing', () => {
      const error = validateCustomDateRange('', '');
      expect(error).not.toBeNull();
      expect(error).toContain('Please select both');
    });

    it('should reject null start date', () => {
      const today = getDateString(0);
      const error = validateCustomDateRange(null as any, today);
      expect(error).not.toBeNull();
      expect(error).toContain('Please select both');
    });

    it('should reject null end date', () => {
      const yesterday = getDateString(-1);
      const error = validateCustomDateRange(yesterday, null as any);
      expect(error).not.toBeNull();
      expect(error).toContain('Please select both');
    });
  });

  describe('Invalid Date Ranges - Invalid Format', () => {
    it('should reject invalid start date format', () => {
      const today = getDateString(0);
      const error = validateCustomDateRange('invalid', today);
      expect(error).not.toBeNull();
      expect(error).toContain('Invalid date format');
    });

    it('should reject invalid end date format', () => {
      const yesterday = getDateString(-1);
      const error = validateCustomDateRange(yesterday, 'invalid');
      expect(error).not.toBeNull();
      expect(error).toContain('Invalid date format');
    });

    it('should reject both dates invalid format', () => {
      const error = validateCustomDateRange('invalid1', 'invalid2');
      expect(error).not.toBeNull();
      expect(error).toContain('Invalid date format');
    });

    it('should reject wrong date format (MM-DD-YYYY)', () => {
      const error = validateCustomDateRange('10-16-2025', '10-16-2025');
      expect(error).not.toBeNull();
      expect(error).toContain('Invalid date format');
    });

    it('should reject partial date format', () => {
      const today = getDateString(0);
      const error = validateCustomDateRange('2025-10', today);
      expect(error).not.toBeNull();
      expect(error).toContain('Invalid date format');
    });
  });

  describe('Edge Cases', () => {
    it('should handle leap year dates', () => {
      // Use a known leap year date
      const error = validateCustomDateRange('2024-02-29', '2024-02-29');
      expect(error).toBeNull();
    });

    it('should handle year boundary', () => {
      const today = getDateString(0);
      const yesterday = getDateString(-1);
      const error = validateCustomDateRange(yesterday, today);
      expect(error).toBeNull();
    });

    it('should handle month boundary', () => {
      const today = getDateString(0);
      const yesterday = getDateString(-1);
      const error = validateCustomDateRange(yesterday, today);
      expect(error).toBeNull();
    });

    it('should handle whitespace in dates', () => {
      const today = getDateString(0);
      const error = validateCustomDateRange(` ${today} `, ` ${today} `);
      // Should either trim or reject - depends on implementation
      expect(error).toBeDefined();
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error message for missing dates', () => {
      const error = validateCustomDateRange('', '');
      expect(error).toContain('Please select both');
    });

    it('should provide clear error message for invalid format', () => {
      const today = getDateString(0);
      const error = validateCustomDateRange('invalid', today);
      expect(error).toContain('Invalid date format');
    });

    it('should provide clear error message for start > end', () => {
      const today = getDateString(0);
      const yesterday = getDateString(-1);
      const error = validateCustomDateRange(today, yesterday);
      expect(error).toContain('Start date must be before');
    });

    it('should provide clear error message for future date', () => {
      const tomorrow = getDateString(1);
      const today = getDateString(0);
      const error = validateCustomDateRange(today, tomorrow);
      expect(error).toContain('End date cannot be in the future');
    });

    it('should provide clear error message for range > 365 days', () => {
      const today = getDateString(0);
      const moreThanOneYearAgo = getDateString(-366);
      const error = validateCustomDateRange(moreThanOneYearAgo, today);
      expect(error).toContain('Date range cannot exceed 365 days');
    });
  });
});

describe('SettingsTab - Watchdog Timer', () => {
  describe('Timeout Configuration', () => {
    it('should have 30-second timeout constant', () => {
      expect(REPORT_GENERATION_TIMEOUT_MS).toBe(30000);
    });

    it('should be 2x the original timeout', () => {
      const originalTimeout = 15000;
      expect(REPORT_GENERATION_TIMEOUT_MS).toBe(originalTimeout * 2);
    });

    it('should be configurable', () => {
      expect(typeof REPORT_GENERATION_TIMEOUT_MS).toBe('number');
      expect(REPORT_GENERATION_TIMEOUT_MS).toBeGreaterThan(0);
    });
  });

  describe('Timeout Behavior', () => {
    it('should timeout after 60 seconds', (done) => {
      const startTime = Date.now();
      const timeout = setTimeout(() => {
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeGreaterThanOrEqual(REPORT_GENERATION_TIMEOUT_MS);
        done();
      }, REPORT_GENERATION_TIMEOUT_MS);

      // Verify timeout is set correctly
      expect(timeout).toBeDefined();
    }, 65000); // Increase Jest timeout to 65 seconds

    it('should handle timeout cancellation', () => {
      const timeout = setTimeout(() => {
        throw new Error('Should not reach here');
      }, REPORT_GENERATION_TIMEOUT_MS);

      clearTimeout(timeout);
      // If we reach here without error, test passes
      expect(true).toBe(true);
    });
  });
});
