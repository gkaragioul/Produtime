/**
 * @jest-environment jsdom
 */

import { AdminTimeoutService } from '../admin-timeout-service';

// Mock timers for testing
jest.useFakeTimers();

describe('AdminTimeoutService', () => {
  let service: AdminTimeoutService;

  beforeEach(() => {
    service = new AdminTimeoutService();
    jest.clearAllTimers();
  });

  afterEach(() => {
    service.stopTimer();
    jest.clearAllTimers();
  });

  describe('Initialization', () => {
    it('should initialize with 5-second timeout', () => {
      expect(service.getTimeoutDuration()).toBe(5000);
    });

    it('should initialize with 2-second warning duration', () => {
      expect(service.getWarningDuration()).toBe(2000);
    });

    it('should not have active timer on initialization', () => {
      expect(service.isTimerActive()).toBe(false);
    });
  });

  describe('Timer Management', () => {
    it('should start timer when admin logs in', () => {
      const mockCallback = jest.fn();
      service.startTimer(mockCallback);
      expect(service.isTimerActive()).toBe(true);
    });

    it('should stop timer when admin logs out', () => {
      const mockCallback = jest.fn();
      service.startTimer(mockCallback);
      service.stopTimer();
      expect(service.isTimerActive()).toBe(false);
    });

    it('should not allow multiple timers to be started', () => {
      const mockCallback1 = jest.fn();
      const mockCallback2 = jest.fn();

      service.startTimer(mockCallback1);
      expect(() => service.startTimer(mockCallback2)).toThrow(
        'Timer is already active'
      );
    });

    it('should handle stopping timer when not active', () => {
      expect(() => service.stopTimer()).not.toThrow();
      expect(service.isTimerActive()).toBe(false);
    });
  });

  describe('Activity Reset', () => {
    it('should reset timer on user activity', () => {
      const mockCallback = jest.fn();
      service.startTimer(mockCallback);

      // Advance time to 3 seconds
      jest.advanceTimersByTime(3000);

      // Reset timer (simulate user activity)
      service.resetTimer();

      // Advance another 3 seconds (total would be 6, but reset happened)
      jest.advanceTimersByTime(3000);

      // Callback should not have been called yet
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should not reset timer when not active', () => {
      expect(() => service.resetTimer()).not.toThrow();
    });

    it('should reset both timeout and warning timers', () => {
      const mockTimeoutCallback = jest.fn();
      const mockWarningCallback = jest.fn();

      service.startTimer(mockTimeoutCallback, mockWarningCallback);

      // Advance to warning threshold (3 seconds)
      jest.advanceTimersByTime(3000);
      expect(mockWarningCallback).toHaveBeenCalledTimes(1);

      // Reset timer
      service.resetTimer();

      // Advance another 3 seconds
      jest.advanceTimersByTime(3000);

      // Warning should be called again after reset
      expect(mockWarningCallback).toHaveBeenCalledTimes(2);
      expect(mockTimeoutCallback).not.toHaveBeenCalled();
    });
  });

  describe('Timeout Execution', () => {
    it('should execute callback after 5 seconds of inactivity', () => {
      const mockCallback = jest.fn();
      service.startTimer(mockCallback);

      jest.advanceTimersByTime(5000);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should not execute callback before timeout', () => {
      const mockCallback = jest.fn();
      service.startTimer(mockCallback);

      jest.advanceTimersByTime(4999);
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should stop timer after timeout execution', () => {
      const mockCallback = jest.fn();
      service.startTimer(mockCallback);

      jest.advanceTimersByTime(30000);
      expect(service.isTimerActive()).toBe(false);
    });
  });

  describe('Warning System', () => {
    it('should trigger warning 2 seconds before timeout', () => {
      const mockTimeoutCallback = jest.fn();
      const mockWarningCallback = jest.fn();

      service.startTimer(mockTimeoutCallback, mockWarningCallback);

      // Advance to warning threshold (3 seconds)
      jest.advanceTimersByTime(3000);

      expect(mockWarningCallback).toHaveBeenCalledTimes(1);
      expect(mockWarningCallback).toHaveBeenCalledWith(2); // 2 seconds remaining
      expect(mockTimeoutCallback).not.toHaveBeenCalled();
    });

    it('should not trigger warning if no warning callback provided', () => {
      const mockTimeoutCallback = jest.fn();

      service.startTimer(mockTimeoutCallback);

      // Advance to warning threshold
      jest.advanceTimersByTime(3000);

      // Should not throw error
      expect(() => jest.advanceTimersByTime(1)).not.toThrow();
    });

    it('should trigger timeout after warning', () => {
      const mockTimeoutCallback = jest.fn();
      const mockWarningCallback = jest.fn();

      service.startTimer(mockTimeoutCallback, mockWarningCallback);

      // Advance to warning threshold
      jest.advanceTimersByTime(3000);
      expect(mockWarningCallback).toHaveBeenCalledTimes(1);

      // Advance to timeout
      jest.advanceTimersByTime(2000);
      expect(mockTimeoutCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid start/stop cycles', () => {
      const mockCallback = jest.fn();

      service.startTimer(mockCallback);
      service.stopTimer();
      service.startTimer(mockCallback);
      service.stopTimer();

      expect(service.isTimerActive()).toBe(false);
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should handle timer reset during warning period', () => {
      const mockTimeoutCallback = jest.fn();
      const mockWarningCallback = jest.fn();

      service.startTimer(mockTimeoutCallback, mockWarningCallback);

      // Advance to warning
      jest.advanceTimersByTime(3000);
      expect(mockWarningCallback).toHaveBeenCalledTimes(1);

      // Reset during warning period
      service.resetTimer();

      // Advance full timeout duration
      jest.advanceTimersByTime(5000);

      // Should trigger warning again, then timeout
      expect(mockWarningCallback).toHaveBeenCalledTimes(2);
      expect(mockTimeoutCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Configuration', () => {
    it('should allow custom timeout duration', () => {
      const customService = new AdminTimeoutService(60000); // 60 seconds
      expect(customService.getTimeoutDuration()).toBe(60000);
    });

    it('should allow custom warning duration', () => {
      const customService = new AdminTimeoutService(30000, 5000); // 5 second warning
      expect(customService.getWarningDuration()).toBe(5000);
    });

    it('should validate timeout duration is positive', () => {
      expect(() => new AdminTimeoutService(0)).toThrow(
        'Timeout duration must be positive'
      );
      expect(() => new AdminTimeoutService(-1000)).toThrow(
        'Timeout duration must be positive'
      );
    });

    it('should validate warning duration is less than timeout', () => {
      expect(() => new AdminTimeoutService(10000, 15000)).toThrow(
        'Warning duration must be less than timeout duration'
      );
    });
  });
});
