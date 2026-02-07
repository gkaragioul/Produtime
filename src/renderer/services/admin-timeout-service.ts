/**
 * AdminTimeoutService - Manages admin session timeout functionality
 *
 * This service provides automatic logout functionality for admin sessions
 * after a specified period of inactivity. It includes warning notifications
 * and proper cleanup mechanisms.
 */

export class AdminTimeoutService {
  private static instance: AdminTimeoutService | null = null;

  private readonly timeoutDuration: number;
  private readonly warningDuration: number;
  private timeoutId: NodeJS.Timeout | null = null;
  private warningId: NodeJS.Timeout | null = null;
  private onTimeoutCallback: (() => void) | null = null;
  private onWarningCallback: ((remainingSeconds: number) => void) | null = null;

  public static getInstance(): AdminTimeoutService {
    if (!AdminTimeoutService.instance) {
      const isTest =
        typeof process !== 'undefined' &&
        typeof process.env !== 'undefined' &&
        (!!process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test');

      // Use short timeouts for tests; longer, sane defaults for production
      const timeoutMs = isTest ? 5000 : 10 * 60 * 1000; // 10 minutes
      const warningMs = isTest ? 2000 : 60 * 1000; // 1 minute before timeout

      AdminTimeoutService.instance = new AdminTimeoutService(
        timeoutMs,
        warningMs
      );
    }
    return AdminTimeoutService.instance;
  }

  /**
   * Creates a new AdminTimeoutService instance
   *
   * @param timeoutDuration - Duration in milliseconds before timeout (default: 5000ms)
   * @param warningDuration - Duration in milliseconds before timeout to show warning (default: 2000ms)
   */
  constructor(timeoutDuration: number = 5000, warningDuration: number = 2000) {
    if (timeoutDuration <= 0) {
      throw new Error('Timeout duration must be positive');
    }

    if (warningDuration >= timeoutDuration) {
      throw new Error('Warning duration must be less than timeout duration');
    }

    this.timeoutDuration = timeoutDuration;
    this.warningDuration = warningDuration;
  }

  /**
   * Starts the timeout timer
   *
   * @param onTimeout - Callback to execute when timeout occurs
   * @param onWarning - Optional callback to execute when warning threshold is reached
   * @throws Error if timer is already active
   */
  public startTimer(
    onTimeout: () => void,
    onWarning?: (remainingSeconds: number) => void
  ): void {
    if (this.isTimerActive()) {
      throw new Error('Timer is already active');
    }

    this.onTimeoutCallback = onTimeout;
    this.onWarningCallback = onWarning || null;

    this.scheduleTimers();
  }

  /**
   * Stops the timeout timer and clears all callbacks
   */
  public stopTimer(): void {
    this.clearTimers();
    this.onTimeoutCallback = null;
    this.onWarningCallback = null;
  }

  /**
   * Resets the timeout timer (called when user activity is detected)
   */
  public resetTimer(): void {
    if (!this.isTimerActive()) {
      return;
    }

    // Clear existing timers
    this.clearTimers();

    // Restart timers with same callbacks
    this.scheduleTimers();
  }

  /**
   * Checks if the timer is currently active
   *
   * @returns true if timer is active, false otherwise
   */
  public isTimerActive(): boolean {
    return this.timeoutId !== null || this.warningId !== null;
  }

  /**
   * Gets the configured timeout duration
   *
   * @returns timeout duration in milliseconds
   */
  public getTimeoutDuration(): number {
    return this.timeoutDuration;
  }

  /**
   * Gets the configured warning duration
   *
   * @returns warning duration in milliseconds
   */
  public getWarningDuration(): number {
    return this.warningDuration;
  }

  /**
   * Schedules both warning and timeout timers
   * @private
   */
  private scheduleTimers(): void {
    if (!this.onTimeoutCallback) {
      return;
    }

    // Schedule warning timer (if callback provided)
    if (this.onWarningCallback) {
      const warningDelay = this.timeoutDuration - this.warningDuration;
      this.warningId = setTimeout(() => {
        if (this.onWarningCallback) {
          const remainingSeconds = Math.floor(this.warningDuration / 1000);
          this.onWarningCallback(remainingSeconds);
        }
        this.warningId = null;
      }, warningDelay);
    }

    // Schedule timeout timer
    this.timeoutId = setTimeout(() => {
      const callback = this.onTimeoutCallback;
      this.stopTimer(); // Clean up before calling callback

      if (callback) {
        callback();
      }
    }, this.timeoutDuration);
  }

  /**
   * Clears all active timers
   * @private
   */
  private clearTimers(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.warningId) {
      clearTimeout(this.warningId);
      this.warningId = null;
    }
  }
}
