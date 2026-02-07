import {
  AdminLoginRequest,
  AdminLoginResponse,
  AdminLockoutState,
  IPCResponse,
} from '../../shared/types';
import { AdminTimeoutService } from './admin-timeout-service';
import { AdminActivityDetector } from './admin-activity-detector';

export class AdminAuthService {
  private static instance: AdminAuthService;
  private isAuthenticated: boolean = false;
  private authToken: string | null = null;
  private timeoutService: AdminTimeoutService | null = null;
  private activityDetector: AdminActivityDetector | null = null;
  private timeoutWarningListeners: ((remainingSeconds: number) => void)[] = [];
  private authChangeListeners: Array<(isAuthenticated: boolean) => void> = [];

  private constructor(
    timeoutService?: AdminTimeoutService,
    activityDetector?: AdminActivityDetector
  ) {
    this.timeoutService = timeoutService || null;
    this.activityDetector = activityDetector || null;
  }

  public static getInstance(
    timeoutService?: AdminTimeoutService,
    activityDetector?: AdminActivityDetector
  ): AdminAuthService {
    if (!AdminAuthService.instance) {
      AdminAuthService.instance = new AdminAuthService(
        timeoutService,
        activityDetector
      );
    }
    return AdminAuthService.instance;
  }

  /**
   * Attempt to authenticate with admin password
   */
  public async login(password: string): Promise<AdminLoginResponse> {
    try {
      const request: AdminLoginRequest = {
        password,
        ipAddress: 'localhost', // In a real app, you might get the actual IP
      };

      const response: IPCResponse<AdminLoginResponse> =
        await window.electronAPI.adminLogin(request);

      if (!response.success) {
        throw new Error(response.error || 'Login failed');
      }

      const loginResult = response.data!;

      if (loginResult.success) {
        this.isAuthenticated = true;
        this.authToken = this.generateAuthToken();

        // Store authentication state in session storage (cleared on app restart)
        sessionStorage.setItem('admin_authenticated', 'true');
        sessionStorage.setItem('admin_auth_token', this.authToken);
        sessionStorage.setItem('admin_auth_time', new Date().toISOString());

        // Notify listeners that admin is now authenticated
        this.notifyAuthChange(true);

        if (process.env.NODE_ENV === 'development') {
          console.log('🔧 [DEBUG] AdminAuthService: Login successful, starting timeout...');
          console.log('🔧 [DEBUG] AdminAuthService: Timeout service available:', !!this.timeoutService);
          console.log('🔧 [DEBUG] AdminAuthService: Activity detector available:', !!this.activityDetector);
        }

        // Start timeout and activity detection
        this.startTimeoutAndActivityDetection();
      }

      return loginResult;
    } catch (error) {
      console.error('Admin login error:', error);
      throw error;
    }
  }

  /**
   * Check if admin is currently authenticated
   */
  public isAdminAuthenticated(): boolean {
    // Check memory state first
    if (this.isAuthenticated && this.authToken) {
      return true;
    }

    // Check session storage
    const storedAuth = sessionStorage.getItem('admin_authenticated');
    const storedToken = sessionStorage.getItem('admin_auth_token');
    const storedTime = sessionStorage.getItem('admin_auth_time');

    if (storedAuth === 'true' && storedToken && storedTime) {
      // Check if authentication is still valid (e.g., within last hour)
      const authTime = new Date(storedTime);
      const now = new Date();
      const hoursSinceAuth =
        (now.getTime() - authTime.getTime()) / (1000 * 60 * 60);

      if (hoursSinceAuth < 1) {
        // Valid for 1 hour
        this.isAuthenticated = true;
        this.authToken = storedToken;
        return true;
      } else {
        // Authentication expired
        this.logout();
      }
    }

    return false;
  }

  /**
   * Logout admin user
   */
  public logout(): void {
    this.isAuthenticated = false;
    this.authToken = null;

    // Stop timeout and activity detection
    this.stopTimeoutAndActivityDetection();

    // Notify listeners that admin has been logged out (auto or manual)
    this.notifyAuthChange(false);

    // Clear session storage
    sessionStorage.removeItem('admin_authenticated');
    sessionStorage.removeItem('admin_auth_token');
    sessionStorage.removeItem('admin_auth_time');
  }

  /**
   * Get current lockout state
   */
  public async getLockoutState(): Promise<AdminLockoutState> {
    try {
      const response: IPCResponse<AdminLockoutState> =
        await window.electronAPI.getAdminLockoutState();

      if (!response.success) {
        throw new Error(response.error || 'Failed to get lockout state');
      }

      return response.data!;
    } catch (error) {
      console.error('Error getting lockout state:', error);
      throw error;
    }
  }

  /**
   * Reset admin lockout (for development/testing purposes)
   */
  public async resetLockout(): Promise<void> {
    try {
      const response: IPCResponse<void> =
        await window.electronAPI.resetAdminLockout();

      if (!response.success) {
        throw new Error(response.error || 'Failed to reset lockout');
      }
    } catch (error) {
      console.error('Error resetting lockout:', error);
      throw error;
    }
  }

  /**
   * Check if admin is currently locked out
   */
  public async isLockedOut(): Promise<boolean> {
    try {
      const lockoutState = await this.getLockoutState();

      if (!lockoutState.is_locked) {
        return false;
      }

      if (!lockoutState.locked_until) {
        return false;
      }

      const now = new Date();
      const lockedUntil = new Date(lockoutState.locked_until);

      return now < lockedUntil;
    } catch (error) {
      console.error('Error checking lockout status:', error);
      return false;
    }
  }

  /**
   * Get time remaining in lockout
   */
  public async getLockoutTimeRemaining(): Promise<number> {
    try {
      const lockoutState = await this.getLockoutState();

      if (!lockoutState.is_locked || !lockoutState.locked_until) {
        return 0;
      }

      const now = new Date();
      const lockedUntil = new Date(lockoutState.locked_until);
      const remainingMs = lockedUntil.getTime() - now.getTime();

      return Math.max(0, Math.ceil(remainingMs / 1000)); // Return seconds
    } catch (error) {
      console.error('Error getting lockout time remaining:', error);
      return 0;
    }
  }

  /**
   * Generate a simple auth token for session management
   */
  private generateAuthToken(): string {
    return btoa(`admin_${Date.now()}_${Math.random()}`);
  }

  /**
   * Validate current auth token
   */
  public validateAuthToken(token: string): boolean {
    return this.authToken === token && this.isAuthenticated;
  }

  /**
   * Register a listener for timeout warnings
   */
  public onTimeoutWarning(listener: (remainingSeconds: number) => void): void {
    if (!this.timeoutWarningListeners.includes(listener)) {
      this.timeoutWarningListeners.push(listener);
    }
  }

  /**
   * Remove a timeout warning listener
   */
  public removeTimeoutWarningListener(
    listener: (remainingSeconds: number) => void
  ): void {
    const index = this.timeoutWarningListeners.indexOf(listener);
    if (index > -1) {
      this.timeoutWarningListeners.splice(index, 1);
    }
  }

  /**
   * Subscribe to authentication state changes
   */
  public onAuthChange(listener: (isAuthenticated: boolean) => void): void {
    if (!this.authChangeListeners.includes(listener)) {
      this.authChangeListeners.push(listener);
    }
  }

  /**
   * Unsubscribe from authentication state changes
   */
  public removeAuthChangeListener(
    listener: (isAuthenticated: boolean) => void
  ): void {
    const idx = this.authChangeListeners.indexOf(listener);
    if (idx > -1) {
      this.authChangeListeners.splice(idx, 1);
    }
  }

  /**
   * Notify all listeners about authentication state change
   * @private
   */
  private notifyAuthChange(isAuthenticated: boolean): void {
    try {
      const listeners = [...this.authChangeListeners];
      for (const l of listeners) {
        try {
          l(isAuthenticated);
        } catch (err) {
          console.error('Error in auth change listener:', err);
        }
      }
    } catch (error) {
      console.error('Failed to notify auth change:', error);
    }
  }

  /**
   * Extend the current session (reset timeout timer)
   */
  public extendSession(): void {
    if (this.timeoutService && this.isAuthenticated) {
      try {
        this.timeoutService.resetTimer();
      } catch (error) {
        console.error('Error extending session:', error);
      }
    }
  }

  /**
   * Start timeout and activity detection services
   * Made public so UI can ensure timers are running/reset on activity.
   */
  public startTimeoutAndActivityDetection(): void {
    try {
      // Only enable timeout mechanics when admin is authenticated
      if (!this.isAuthenticated) {
        console.log(
          '🔧 [DEBUG] AdminAuthService: Skipping timeout start; admin not authenticated'
        );
        return;
      }

      console.log(
        '🔧 [DEBUG] AdminAuthService: Starting inactivity-based timeout (resets on activity)'
      );

      // Start timeout service with warning callback so UI can display countdown.
      if (this.timeoutService) {
        this.timeoutService.startTimer(
          () => this.handleAutoLogout(),
          (remainingSeconds) => this.handleTimeoutWarning(remainingSeconds)
        );
      } else {
        console.warn(
          '🔧 [DEBUG] AdminAuthService: No timeout service available!'
        );
      }

      // Start activity detection and reset timer on activity
      if (this.activityDetector && this.timeoutService) {
        const onActivity = () => this.handleUserActivity();
        // Ensure no duplicated callbacks from previous sessions
        this.activityDetector.clearCallbacks();
        this.activityDetector.onActivity(onActivity);
        this.activityDetector.startDetection();
        console.log(
          '🔧 [DEBUG] AdminAuthService: Activity detection enabled (AFK-based)'
        );
      }
    } catch (error) {
      console.error('Error starting timeout:', error);
    }
  }

  /**
   * Stop timeout and activity detection services
   * @private
   */
  private stopTimeoutAndActivityDetection(): void {
    try {
      // Stop timeout service
      if (this.timeoutService) {
        this.timeoutService.stopTimer();
      }

      // Stop activity detection
      if (this.activityDetector) {
        this.activityDetector.stopDetection();
        this.activityDetector.clearCallbacks();
      }
    } catch (error) {
      console.error('Error stopping timeout and activity detection:', error);
    }
  }

  /**
   * Handle automatic logout due to timeout
   * @private
   */
  private handleAutoLogout(): void {
    console.log('Admin session timed out - auto logout');
    this.logout();
  }

  /**
   * Handle timeout warning
   * @private
   */
  private handleTimeoutWarning(remainingSeconds: number): void {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔧 [DEBUG] AdminAuthService: Timeout warning triggered!', remainingSeconds, 'seconds remaining');
      console.log('🔧 [DEBUG] AdminAuthService: Number of warning listeners:', this.timeoutWarningListeners.length);
    }

    // Notify all warning listeners
    for (const listener of this.timeoutWarningListeners) {
      try {
        if (process.env.NODE_ENV === 'development') {
          console.log('🔧 [DEBUG] AdminAuthService: Calling warning listener...');
        }
        listener(remainingSeconds);
      } catch (error) {
        console.error('Error in timeout warning listener:', error);
      }
    }
  }

  /**
   * Handle user activity detection
   * @private
   */
  private handleUserActivity(): void {
    if (this.timeoutService && this.isAuthenticated) {
      try {
        this.timeoutService.resetTimer();
      } catch (error) {
        console.error('Error resetting timeout on user activity:', error);
      }
    }
  }
}

export default AdminAuthService;
