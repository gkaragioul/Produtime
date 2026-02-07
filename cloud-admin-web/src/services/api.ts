/**
 * API Service for Cloud Admin Web
 * Handles all REST API communication with the cloud-admin-api backend
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  DashboardStory,
  AttentionResponse,
  DeviceListItemEnhanced,
  TrendsResponse,
  RankingsResponse,
} from '../types/dashboard';

// ============================================================================
// Types
// ============================================================================

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface User {
  id: string;
  email: string;
  tenantId: string;
  tenantName: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

export interface PairCodeResponse {
  code: string;
  expiresAt: number;
  tenantId: string;
}

export interface PendingPairRequest {
  id: string;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  osInfo: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
}

export interface ApprovalResponse {
  success: boolean;
  wsEndpoint: string;
  adminPubKey: string;
  sessionToken: string;
}

export interface ApiError {
  error: string;
  message: string;
}

// ============================================================================
// Token Storage
// ============================================================================

const TOKEN_KEY = 'cloud_admin_tokens';
const USER_KEY = 'cloud_admin_user';

export function getStoredTokens(): AuthTokens | null {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function setStoredTokens(tokens: AuthTokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearStoredTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): User | null {
  const stored = localStorage.getItem(USER_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// ============================================================================
// API Client
// ============================================================================

class ApiClient {
  private client: AxiosInstance;
  private refreshPromise: Promise<AuthTokens> | null = null;
  private onAuthError: (() => void) | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: '/api/v1',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use((config) => {
      const tokens = getStoredTokens();
      if (tokens?.accessToken) {
        config.headers.Authorization = `Bearer ${tokens.accessToken}`;
      }
      return config;
    });

    // Response interceptor to handle token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError<ApiError>) => {
        const originalRequest = error.config;
        
        if (error.response?.status === 401 && originalRequest && !originalRequest.url?.includes('/auth/')) {
          try {
            const tokens = await this.refreshTokens();
            if (tokens && originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
              return this.client(originalRequest);
            }
          } catch {
            this.onAuthError?.();
          }
        }
        
        return Promise.reject(error);
      }
    );
  }

  setAuthErrorHandler(handler: () => void): void {
    this.onAuthError = handler;
  }

  // ============================================================================
  // Auth Endpoints
  // ============================================================================

  async login(email: string, password: string, captchaToken?: string): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/auth/login', {
      email,
      password,
      captchaToken,
    });
    
    const { accessToken, refreshToken, expiresIn, user } = response.data;
    setStoredTokens({ accessToken, refreshToken, expiresIn });
    setStoredUser(user);
    
    return response.data;
  }

  async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout');
    } finally {
      clearStoredTokens();
    }
  }

  private async refreshTokens(): Promise<AuthTokens | null> {
    // Prevent multiple simultaneous refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const tokens = getStoredTokens();
    if (!tokens?.refreshToken) {
      return null;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await this.client.post<{ accessToken: string; expiresIn: number }>('/auth/refresh', {
          refreshToken: tokens.refreshToken,
        });
        
        const newTokens: AuthTokens = {
          accessToken: response.data.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: response.data.expiresIn,
        };
        
        setStoredTokens(newTokens);
        return newTokens;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // ============================================================================
  // Dashboard Endpoints
  // ============================================================================

  async getDashboardStory(): Promise<DashboardStory> {
    const response = await this.client.get<DashboardStory>('/dashboard/story');
    return response.data;
  }

  async getAttention(): Promise<AttentionResponse> {
    const response = await this.client.get<AttentionResponse>('/dashboard/attention');
    return response.data;
  }

  async getDevices(): Promise<DeviceListItemEnhanced[]> {
    const response = await this.client.get<{ devices: DeviceListItemEnhanced[] }>('/dashboard/devices');
    return response.data.devices;
  }

  async getTrends(scope: 'team' | 'device' = 'team', deviceId?: string, days: number = 7): Promise<TrendsResponse> {
    const params = new URLSearchParams({ scope, days: days.toString() });
    if (deviceId) params.append('deviceId', deviceId);
    
    const response = await this.client.get<TrendsResponse>(`/dashboard/trends?${params}`);
    return response.data;
  }

  async getRankings(): Promise<RankingsResponse> {
    const response = await this.client.get<RankingsResponse>('/dashboard/rankings');
    return response.data;
  }

  // ============================================================================
  // Pairing Endpoints
  // ============================================================================

  async generatePairCode(): Promise<PairCodeResponse> {
    const response = await this.client.post<PairCodeResponse>('/pairing/generate-code');
    return response.data;
  }

  async getPendingRequests(): Promise<PendingPairRequest[]> {
    const response = await this.client.get<{ requests: PendingPairRequest[] }>('/pairing/pending');
    return response.data.requests;
  }

  async approvePairing(requestId: string): Promise<ApprovalResponse> {
    const response = await this.client.post<ApprovalResponse>(`/pairing/approve/${requestId}`);
    return response.data;
  }

  async denyPairing(requestId: string): Promise<void> {
    await this.client.post(`/pairing/deny/${requestId}`);
  }
}

// Export singleton instance
export const api = new ApiClient();
