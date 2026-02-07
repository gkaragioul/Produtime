/**
 * WebSocket Service for Cloud Admin Web
 * Handles real-time updates from the cloud-admin-api backend
 * Requirements: 12.4 - Show real-time updates via WebSocket subscription
 */

import { getStoredTokens, getStoredUser } from './api';

// ============================================================================
// Types
// ============================================================================

export type WebSocketEventType = 'device_status' | 'metrics_update' | 'attention_change' | 'pair_request';

export interface WebSocketEvent {
  type: WebSocketEventType;
  data: unknown;
}

export interface DeviceStatusEvent {
  deviceId: string;
  status: 'online' | 'idle' | 'offline';
  lastSeenTs: number;
}

export interface MetricsUpdateEvent {
  deviceId: string;
  activeSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
}

export interface PairRequestEvent {
  id: string;
  deviceId: string;
  deviceName: string;
}

type EventCallback = (event: WebSocketEvent) => void;

// ============================================================================
// WebSocket Manager
// ============================================================================

class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private listeners: Set<EventCallback> = new Set();
  private isConnecting = false;
  private shouldReconnect = true;

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    const tokens = getStoredTokens();
    const user = getStoredUser();

    if (!tokens?.accessToken || !user?.tenantId) {
      console.warn('Cannot connect WebSocket: not authenticated');
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/admin/${user.tenantId}?token=${tokens.accessToken}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WebSocketEvent;
          this.notifyListeners(data);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.isConnecting = false;
        this.ws = null;

        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      this.isConnecting = false;
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`Scheduling WebSocket reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Add an event listener
   */
  addListener(callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners of an event
   */
  private notifyListeners(event: WebSocketEvent): void {
    this.listeners.forEach((callback) => {
      try {
        callback(event);
      } catch (err) {
        console.error('Error in WebSocket listener:', err);
      }
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection state
   */
  getState(): 'connecting' | 'connected' | 'disconnected' {
    if (this.isConnecting) return 'connecting';
    if (this.ws?.readyState === WebSocket.OPEN) return 'connected';
    return 'disconnected';
  }
}

// Export singleton instance
export const wsManager = new WebSocketManager();
