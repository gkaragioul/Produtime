/**
 * @jest-environment jsdom
 */

import { AdminActivityDetector } from '../admin-activity-detector';
import { fireEvent } from '@testing-library/react';

describe('AdminActivityDetector', () => {
  let detector: AdminActivityDetector;
  let mockCallback: jest.Mock;

  beforeEach(() => {
    detector = new AdminActivityDetector();
    mockCallback = jest.fn();
  });

  afterEach(() => {
    detector.stopDetection();
  });

  describe('Initialization', () => {
    it('should initialize without active detection', () => {
      expect(detector.isDetecting()).toBe(false);
    });

    it('should have default activity events configured', () => {
      const events = detector.getActivityEvents();
      expect(events).toContain('mousedown');
      expect(events).toContain('mousemove');
      expect(events).toContain('keypress');
      expect(events).toContain('scroll');
      expect(events).toContain('touchstart');
    });
  });

  describe('Activity Detection Management', () => {
    it('should start detection when requested', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();
      expect(detector.isDetecting()).toBe(true);
    });

    it('should stop detection when requested', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();
      detector.stopDetection();
      expect(detector.isDetecting()).toBe(false);
    });

    it('should handle multiple start calls gracefully', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();
      detector.startDetection(); // Should not throw
      expect(detector.isDetecting()).toBe(true);
    });

    it('should handle stop when not detecting', () => {
      expect(() => detector.stopDetection()).not.toThrow();
      expect(detector.isDetecting()).toBe(false);
    });
  });

  describe('Callback Management', () => {
    it('should register activity callback', () => {
      detector.onActivity(mockCallback);
      expect(detector.getCallbackCount()).toBe(1);
    });

    it('should support multiple callbacks', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      detector.onActivity(callback1);
      detector.onActivity(callback2);

      expect(detector.getCallbackCount()).toBe(2);
    });

    it('should remove specific callback', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      detector.onActivity(callback1);
      detector.onActivity(callback2);
      detector.removeCallback(callback1);

      expect(detector.getCallbackCount()).toBe(1);
    });

    it('should clear all callbacks', () => {
      detector.onActivity(jest.fn());
      detector.onActivity(jest.fn());
      detector.clearCallbacks();

      expect(detector.getCallbackCount()).toBe(0);
    });
  });

  describe('Mouse Activity Detection', () => {
    it('should detect mouse movements', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();

      fireEvent.mouseMove(document);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should detect mouse clicks', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();

      fireEvent.mouseDown(document);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should not detect mouse activity when not detecting', () => {
      detector.onActivity(mockCallback);
      // Don't start detection

      fireEvent.mouseMove(document);
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard Activity Detection', () => {
    it('should detect keyboard events', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();

      fireEvent.keyPress(document);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should detect key down events', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();

      fireEvent.keyDown(document);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Scroll Activity Detection', () => {
    it('should detect scroll events', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();

      fireEvent.scroll(document);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Touch Activity Detection', () => {
    it('should detect touch events', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();

      fireEvent.touchStart(document);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Multiple Callbacks', () => {
    it('should call all registered callbacks on activity', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      detector.onActivity(callback1);
      detector.onActivity(callback2);
      detector.onActivity(callback3);
      detector.startDetection();

      fireEvent.mouseMove(document);

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledTimes(1);
    });
  });

  describe('Activity Throttling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should throttle rapid activity events', () => {
      detector.onActivity(mockCallback);
      detector.startDetection();

      // Fire multiple events rapidly
      fireEvent.mouseMove(document);
      fireEvent.mouseMove(document);
      fireEvent.mouseMove(document);

      // Should only call callback once due to throttling
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // Advance time past throttle period
      jest.advanceTimersByTime(100);

      // Fire another event
      fireEvent.mouseMove(document);
      expect(mockCallback).toHaveBeenCalledTimes(2);
    });
  });

  describe('Custom Configuration', () => {
    it('should allow custom activity events', () => {
      const customEvents = ['click', 'focus'];
      const customDetector = new AdminActivityDetector(customEvents);

      expect(customDetector.getActivityEvents()).toEqual(customEvents);
    });

    it('should allow custom throttle delay', () => {
      const customDetector = new AdminActivityDetector(undefined, 200);
      expect(customDetector.getThrottleDelay()).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should handle callback errors gracefully', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Callback error');
      });
      const normalCallback = jest.fn();

      detector.onActivity(errorCallback);
      detector.onActivity(normalCallback);
      detector.startDetection();

      // Should not throw and should still call other callbacks
      expect(() => fireEvent.mouseMove(document)).not.toThrow();
      expect(normalCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cleanup', () => {
    it('should remove event listeners on stop', () => {
      const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = jest.spyOn(
        document,
        'removeEventListener'
      );

      detector.onActivity(mockCallback);
      detector.startDetection();

      const addCallCount = addEventListenerSpy.mock.calls.length;

      detector.stopDetection();

      expect(removeEventListenerSpy).toHaveBeenCalledTimes(addCallCount);

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });
});
