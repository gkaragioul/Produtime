/**
 * AdminActivityDetector - Detects user activity for admin timeout functionality
 *
 * This service monitors various user interaction events (mouse, keyboard, touch, scroll)
 * and notifies registered callbacks when activity is detected. It includes throttling
 * to prevent excessive callback execution.
 */

export class AdminActivityDetector {
  private static instance: AdminActivityDetector | null = null;

  private readonly activityEvents: string[];
  private readonly throttleDelay: number;
  private callbacks: (() => void)[] = [];
  private isDetectingActivity: boolean = false;
  private lastActivityTime: number = 0;
  private boundHandleActivity: (event: Event) => void;

  public static getInstance(): AdminActivityDetector {
    if (!AdminActivityDetector.instance) {
      AdminActivityDetector.instance = new AdminActivityDetector();
    }
    return AdminActivityDetector.instance;
  }

  /**
   * Creates a new AdminActivityDetector instance
   *
   * @param activityEvents - Array of event names to listen for (default: common activity events)
   * @param throttleDelay - Minimum time between callback executions in milliseconds (default: 100ms)
   */
  constructor(
    activityEvents: string[] = [
      'mousedown',
      'mousemove',
      'keypress',
      'keydown',
      'scroll',
      'touchstart',
    ],
    throttleDelay: number = 100
  ) {
    this.activityEvents = [...activityEvents];
    this.throttleDelay = throttleDelay;
    this.boundHandleActivity = this.handleActivity.bind(this);
  }

  /**
   * Registers a callback to be called when user activity is detected
   *
   * @param callback - Function to call when activity is detected
   */
  public onActivity(callback: () => void): void {
    if (!this.callbacks.includes(callback)) {
      this.callbacks.push(callback);
    }
  }

  /**
   * Removes a specific callback from the activity detection
   *
   * @param callback - The callback function to remove
   */
  public removeCallback(callback: () => void): void {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Clears all registered callbacks
   */
  public clearCallbacks(): void {
    this.callbacks = [];
  }

  /**
   * Starts detecting user activity
   */
  public startDetection(): void {
    if (this.isDetectingActivity) {
      return; // Already detecting
    }

    this.isDetectingActivity = true;
    this.addEventListeners();
  }

  /**
   * Stops detecting user activity and removes all event listeners
   */
  public stopDetection(): void {
    if (!this.isDetectingActivity) {
      return; // Not detecting
    }

    this.isDetectingActivity = false;
    this.removeEventListeners();
  }

  /**
   * Checks if activity detection is currently active
   *
   * @returns true if detecting activity, false otherwise
   */
  public isDetecting(): boolean {
    return this.isDetectingActivity;
  }

  /**
   * Gets the list of activity events being monitored
   *
   * @returns array of event names
   */
  public getActivityEvents(): string[] {
    return [...this.activityEvents];
  }

  /**
   * Gets the current throttle delay
   *
   * @returns throttle delay in milliseconds
   */
  public getThrottleDelay(): number {
    return this.throttleDelay;
  }

  /**
   * Gets the number of registered callbacks
   *
   * @returns number of callbacks
   */
  public getCallbackCount(): number {
    return this.callbacks.length;
  }

  /**
   * Handles detected activity events
   * @private
   */
  private handleActivity(event: Event): void {
    const now = Date.now();

    // Throttle rapid events
    if (now - this.lastActivityTime < this.throttleDelay) {
      return;
    }

    this.lastActivityTime = now;
    this.notifyCallbacks();
  }

  /**
   * Notifies all registered callbacks of activity
   * @private
   */
  private notifyCallbacks(): void {
    // Create a copy of callbacks to avoid issues if callbacks modify the array
    const callbacksCopy = [...this.callbacks];

    for (const callback of callbacksCopy) {
      try {
        callback();
      } catch (error) {
        // Log error but continue with other callbacks
        console.error('Error in activity callback:', error);
      }
    }
  }

  /**
   * Adds event listeners for all activity events
   * @private
   */
  private addEventListeners(): void {
    for (const eventName of this.activityEvents) {
      document.addEventListener(eventName, this.boundHandleActivity, {
        passive: true,
        capture: true,
      });
    }
  }

  /**
   * Removes event listeners for all activity events
   * @private
   */
  private removeEventListeners(): void {
    for (const eventName of this.activityEvents) {
      document.removeEventListener(eventName, this.boundHandleActivity, {
        capture: true,
      });
    }
  }
}
