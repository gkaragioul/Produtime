/**
 * WebSocket Hook for React Components
 * Provides easy access to WebSocket events and connection state
 */

import { useState, useEffect, useCallback } from 'react';
import { wsManager, WebSocketEvent, WebSocketEventType } from '../services/websocket';

interface UseWebSocketOptions {
  autoConnect?: boolean;
  onEvent?: (event: WebSocketEvent) => void;
  eventTypes?: WebSocketEventType[];
}

interface UseWebSocketResult {
  isConnected: boolean;
  connectionState: 'connecting' | 'connected' | 'disconnected';
  connect: () => void;
  disconnect: () => void;
}

/**
 * Hook for managing WebSocket connection and events
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketResult {
  const { autoConnect = true, onEvent, eventTypes } = options;
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>(
    wsManager.getState()
  );

  // Update connection state periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setConnectionState(wsManager.getState());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      wsManager.connect();
    }

    return () => {
      // Don't disconnect on unmount - let the manager handle reconnection
    };
  }, [autoConnect]);

  // Subscribe to events
  useEffect(() => {
    if (!onEvent) return;

    const unsubscribe = wsManager.addListener((event) => {
      // Filter by event types if specified
      if (eventTypes && !eventTypes.includes(event.type)) {
        return;
      }
      onEvent(event);
    });

    return unsubscribe;
  }, [onEvent, eventTypes]);

  const connect = useCallback(() => {
    wsManager.connect();
  }, []);

  const disconnect = useCallback(() => {
    wsManager.disconnect();
  }, []);

  return {
    isConnected: connectionState === 'connected',
    connectionState,
    connect,
    disconnect,
  };
}

/**
 * Hook for subscribing to specific WebSocket event types
 */
export function useWebSocketEvent<T = unknown>(
  eventType: WebSocketEventType,
  callback: (data: T) => void
): void {
  useEffect(() => {
    const unsubscribe = wsManager.addListener((event) => {
      if (event.type === eventType) {
        callback(event.data as T);
      }
    });

    return unsubscribe;
  }, [eventType, callback]);
}
