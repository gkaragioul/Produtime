/**
 * WebSocket Connection Manager
 * Handles WebSocket connections for both clients (ProduTime apps) and admins (dashboard).
 * 
 * Requirements:
 * - 4.1: Use WSS (WebSocket Secure) for all client-admin communication
 * - 4.2: Verify device's Ed25519 signature
 * - 4.3: Reject connections from unpaired or revoked devices
 * - 4.4: Validate signature before processing heartbeats
 * - 4.5: Terminate connections that fail signature verification
 * - 4.6: Connection rate limiting (max 100 connections per tenant)
 * - 4.7: Mark device offline after 2 minutes idle
 * - 12.4: Allow dashboard to subscribe to tenant events
 */

import { WebSocket } from 'ws';
import * as nacl from 'tweetnacl';
import { config } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface SignedMessage {
  type: string;
  ts: number;
  nonce: string;
  deviceId: string;
  signature: string;
  payload: any;
}

export interface DashboardEvent {
  type: 'device_status' | 'metrics_update' | 'attention_change' | 'device_connected' | 'device_disconnected';
  data: any;
  timestamp: number;
}

export interface ClientConnection {
  ws: WebSocket;
  deviceId: string;
  tenantId: string;
  publicKey: string;
  connectedAt: number;
  lastMessageAt: number;
}

export interface AdminConnection {
  ws: WebSocket;
  userId: string;
  tenantId: string;
  connectedAt: number;
}

export interface DeviceRecord {
  id: string;
  tenantId: string;
  deviceId: string;
  deviceName: string;
  devicePubKey: string;
  pairedAt: Date;
  status: string;
  appVersion: string | null;
  ip: string | null;
  revoked: boolean;
  lastSeenAt?: Date | null;
}

// ============================================================================
// Database Interface
// ============================================================================

export interface WebSocketDatabase {
  findDeviceByDeviceId(tenantId: string, deviceId: string): Promise<DeviceRecord | null>;
  updateDeviceStatus(tenantId: string, deviceId: string, status: string, lastSeenAt: Date): Promise<void>;
  findTenantById(tenantId: string): Promise<{ id: string; wsEndpoint: string } | null>;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_CONNECTIONS_PER_TENANT = config.rateLimits.wsConnections.max;
const STALE_CONNECTION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const CLEANUP_INTERVAL_MS = 30 * 1000; // 30 seconds
const NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Nonce Store for Replay Protection
// ============================================================================

class NonceStore {
  private nonces: Map<string, number> = new Map();
  private maxSize: number;
  private expiryMs: number;

  constructor(maxSize: number = 10000, expiryMs: number = NONCE_EXPIRY_MS) {
    this.maxSize = maxSize;
    this.expiryMs = expiryMs;
  }

  checkAndStore(nonce: string, timestamp: number): boolean {
    const now = Date.now();
    
    // Clean expired nonces periodically
    if (this.nonces.size > this.maxSize * 0.9) {
      this.cleanup(now);
    }

    // Check if nonce already exists
    if (this.nonces.has(nonce)) {
      return false; // Replay detected
    }

    // Check if timestamp is within acceptable window
    if (Math.abs(now - timestamp) > this.expiryMs) {
      return false; // Message too old or from future
    }

    // Store nonce
    this.nonces.set(nonce, timestamp);
    return true;
  }

  private cleanup(now: number): void {
    const expiredBefore = now - this.expiryMs;
    for (const [nonce, ts] of this.nonces.entries()) {
      if (ts < expiredBefore) {
        this.nonces.delete(nonce);
      }
    }
  }

  clear(): void {
    this.nonces.clear();
  }
}

// ============================================================================
// WebSocket Manager Class
// ============================================================================

export class WebSocketManager {
  // Client connections: Map<tenantId, Map<deviceId, ClientConnection>>
  private clientConnections: Map<string, Map<string, ClientConnection>> = new Map();
  
  // Admin connections: Map<tenantId, Map<userId, AdminConnection>>
  private adminConnections: Map<string, Map<string, AdminConnection>> = new Map();
  
  // Nonce store for replay protection
  private nonceStore: NonceStore = new NonceStore();
  
  // Cleanup interval handle
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  // Database reference
  private db: WebSocketDatabase;
  
  // Message handler callback
  private onClientMessage?: (tenantId: string, deviceId: string, message: SignedMessage) => void;

  constructor(db: WebSocketDatabase) {
    this.db = db;
  }

  // ============================================================================
  // Lifecycle Methods
  // ============================================================================

  /**
   * Start the cleanup interval for stale connections
   */
  start(): void {
    if (this.cleanupInterval) {
      return;
    }
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the cleanup interval and close all connections
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Close all client connections
    for (const tenantConnections of this.clientConnections.values()) {
      for (const conn of tenantConnections.values()) {
        conn.ws.close(1000, 'Server shutting down');
      }
    }
    this.clientConnections.clear();
    
    // Close all admin connections
    for (const tenantConnections of this.adminConnections.values()) {
      for (const conn of tenantConnections.values()) {
        conn.ws.close(1000, 'Server shutting down');
      }
    }
    this.adminConnections.clear();
    
    this.nonceStore.clear();
  }

  /**
   * Set the message handler callback
   */
  setMessageHandler(handler: (tenantId: string, deviceId: string, message: SignedMessage) => void): void {
    this.onClientMessage = handler;
  }

  // ============================================================================
  // Client Connection Handling (Requirements 4.1, 4.3, 4.6)
  // ============================================================================

  /**
   * Handle a new client WebSocket connection
   * Requirements: 4.1, 4.3, 4.6
   */
  async handleClientConnection(
    ws: WebSocket,
    tenantId: string,
    deviceId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Requirement 4.6: Check connection limit per tenant
    const tenantConnections = this.clientConnections.get(tenantId);
    if (tenantConnections && tenantConnections.size >= MAX_CONNECTIONS_PER_TENANT) {
      ws.close(1008, 'Connection limit exceeded');
      return { success: false, error: 'CONNECTION_LIMIT_EXCEEDED' };
    }

    // Requirement 4.3: Verify device is paired and not revoked
    const device = await this.db.findDeviceByDeviceId(tenantId, deviceId);
    
    if (!device) {
      ws.close(1008, 'Device not paired');
      return { success: false, error: 'DEVICE_NOT_PAIRED' };
    }

    if (device.revoked) {
      ws.close(1008, 'Device revoked');
      return { success: false, error: 'DEVICE_REVOKED' };
    }

    // Store connection
    const connection: ClientConnection = {
      ws,
      deviceId,
      tenantId,
      publicKey: device.devicePubKey,
      connectedAt: Date.now(),
      lastMessageAt: Date.now(),
    };

    if (!this.clientConnections.has(tenantId)) {
      this.clientConnections.set(tenantId, new Map());
    }
    this.clientConnections.get(tenantId)!.set(deviceId, connection);

    // Update device status to online
    await this.db.updateDeviceStatus(tenantId, deviceId, 'online', new Date());

    // Set up message handler
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as SignedMessage;
        await this.handleClientMessage(deviceId, message);
      } catch (error) {
        // Invalid message format - close connection
        ws.close(1008, 'Invalid message format');
      }
    });

    // Set up close handler
    ws.on('close', async () => {
      await this.disconnectClient(tenantId, deviceId);
    });

    // Set up error handler
    ws.on('error', async () => {
      await this.disconnectClient(tenantId, deviceId);
    });

    // Broadcast device connected event to admins
    this.broadcastToAdmins(tenantId, {
      type: 'device_connected',
      data: {
        deviceId,
        deviceName: device.deviceName,
        status: 'online',
      },
      timestamp: Date.now(),
    });

    return { success: true };
  }

  /**
   * Handle a message from a client
   * Requirements: 4.2, 4.4, 4.5
   */
  async handleClientMessage(deviceId: string, message: SignedMessage): Promise<boolean> {
    // Find the connection
    let connection: ClientConnection | undefined;
    let tenantId: string | undefined;
    
    for (const [tid, tenantConnections] of this.clientConnections.entries()) {
      const conn = tenantConnections.get(deviceId);
      if (conn) {
        connection = conn;
        tenantId = tid;
        break;
      }
    }

    if (!connection || !tenantId) {
      return false;
    }

    // Requirement 4.2, 4.4: Verify Ed25519 signature
    const isValid = this.verifySignature(message, connection.publicKey);
    
    if (!isValid) {
      // Requirement 4.5: Terminate connection on verification failure
      connection.ws.close(1008, 'Signature verification failed');
      await this.disconnectClient(tenantId, deviceId);
      return false;
    }

    // Check nonce for replay protection
    if (!this.nonceStore.checkAndStore(message.nonce, message.ts)) {
      connection.ws.close(1008, 'Replay detected');
      await this.disconnectClient(tenantId, deviceId);
      return false;
    }

    // Update last message timestamp
    connection.lastMessageAt = Date.now();

    // Call the message handler if set
    if (this.onClientMessage) {
      this.onClientMessage(tenantId, deviceId, message);
    }

    return true;
  }

  /**
   * Disconnect a client
   */
  async disconnectClient(tenantId: string, deviceId: string): Promise<void> {
    const tenantConnections = this.clientConnections.get(tenantId);
    if (!tenantConnections) {
      return;
    }

    const connection = tenantConnections.get(deviceId);
    if (!connection) {
      return;
    }

    // Close WebSocket if still open
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.close(1000, 'Disconnected');
    }

    // Remove from connections map
    tenantConnections.delete(deviceId);
    if (tenantConnections.size === 0) {
      this.clientConnections.delete(tenantId);
    }

    // Update device status to offline
    await this.db.updateDeviceStatus(tenantId, deviceId, 'offline', new Date());

    // Broadcast device disconnected event to admins
    this.broadcastToAdmins(tenantId, {
      type: 'device_disconnected',
      data: {
        deviceId,
        status: 'offline',
      },
      timestamp: Date.now(),
    });
  }

  // ============================================================================
  // Admin Connection Handling (Requirement 12.4)
  // ============================================================================

  /**
   * Handle a new admin WebSocket connection
   * Requirement 12.4
   */
  async handleAdminConnection(
    ws: WebSocket,
    tenantId: string,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Verify tenant exists
    const tenant = await this.db.findTenantById(tenantId);
    if (!tenant) {
      ws.close(1008, 'Tenant not found');
      return { success: false, error: 'TENANT_NOT_FOUND' };
    }

    // Store connection
    const connection: AdminConnection = {
      ws,
      userId,
      tenantId,
      connectedAt: Date.now(),
    };

    if (!this.adminConnections.has(tenantId)) {
      this.adminConnections.set(tenantId, new Map());
    }
    this.adminConnections.get(tenantId)!.set(userId, connection);

    // Set up close handler
    ws.on('close', () => {
      this.disconnectAdmin(tenantId, userId);
    });

    // Set up error handler
    ws.on('error', () => {
      this.disconnectAdmin(tenantId, userId);
    });

    // Send current device statuses
    const connectedDevices = this.getConnectedDevices(tenantId);
    ws.send(JSON.stringify({
      type: 'initial_state',
      data: {
        connectedDevices,
      },
      timestamp: Date.now(),
    }));

    return { success: true };
  }

  /**
   * Disconnect an admin
   */
  disconnectAdmin(tenantId: string, userId: string): void {
    const tenantConnections = this.adminConnections.get(tenantId);
    if (!tenantConnections) {
      return;
    }

    const connection = tenantConnections.get(userId);
    if (!connection) {
      return;
    }

    // Close WebSocket if still open
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.close(1000, 'Disconnected');
    }

    // Remove from connections map
    tenantConnections.delete(userId);
    if (tenantConnections.size === 0) {
      this.adminConnections.delete(tenantId);
    }
  }

  /**
   * Broadcast an event to all admin connections for a tenant
   * Requirement 12.4
   */
  broadcastToAdmins(tenantId: string, event: DashboardEvent): void {
    const tenantConnections = this.adminConnections.get(tenantId);
    if (!tenantConnections) {
      return;
    }

    const message = JSON.stringify(event);
    
    for (const connection of tenantConnections.values()) {
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(message);
      }
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Get list of connected device IDs for a tenant
   */
  getConnectedDevices(tenantId: string): string[] {
    const tenantConnections = this.clientConnections.get(tenantId);
    if (!tenantConnections) {
      return [];
    }
    return Array.from(tenantConnections.keys());
  }

  /**
   * Get connection count for a tenant
   */
  getConnectionCount(tenantId: string): number {
    const tenantConnections = this.clientConnections.get(tenantId);
    return tenantConnections?.size ?? 0;
  }

  /**
   * Check if a device is connected
   */
  isDeviceConnected(tenantId: string, deviceId: string): boolean {
    const tenantConnections = this.clientConnections.get(tenantId);
    return tenantConnections?.has(deviceId) ?? false;
  }

  /**
   * Cleanup stale connections
   * Requirement 4.7: Mark device offline after 2 minutes idle
   */
  async cleanupStaleConnections(): Promise<void> {
    const now = Date.now();
    const staleThreshold = now - STALE_CONNECTION_TIMEOUT_MS;

    for (const [tenantId, tenantConnections] of this.clientConnections.entries()) {
      for (const [deviceId, connection] of tenantConnections.entries()) {
        if (connection.lastMessageAt < staleThreshold) {
          // Mark as idle first, then disconnect
          await this.db.updateDeviceStatus(tenantId, deviceId, 'idle', new Date());
          
          // Close the connection
          connection.ws.close(1000, 'Connection idle timeout');
          await this.disconnectClient(tenantId, deviceId);
        }
      }
    }
  }

  // ============================================================================
  // Signature Verification (Requirements 4.2, 4.4, 4.5)
  // ============================================================================

  /**
   * Verify Ed25519 signature on a message
   * Requirements: 4.2, 4.4
   */
  verifySignature(message: SignedMessage, publicKeyBase64: string): boolean {
    try {
      const { type, ts, nonce, deviceId, signature, payload } = message;
      
      // Create the signable string (same format as client)
      const signable = JSON.stringify({ type, ts, nonce, deviceId, payload });
      const messageBytes = new Uint8Array(Buffer.from(signable, 'utf-8'));
      
      // Decode signature and public key
      const signatureBytes = this.decodeBase64Flexible(signature);
      const publicKeyBytes = this.decodeBase64Flexible(publicKeyBase64);

      // Validate key and signature lengths
      if (publicKeyBytes.length !== nacl.sign.publicKeyLength) {
        return false;
      }

      if (signatureBytes.length !== nacl.sign.signatureLength) {
        return false;
      }

      // Verify signature
      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch (error) {
      return false;
    }
  }

  /**
   * Decode base64 with flexible handling (standard and URL-safe)
   */
  private decodeBase64Flexible(input: string): Uint8Array {
    try {
      return new Uint8Array(Buffer.from(input, 'base64'));
    } catch {
      // Try base64url
      let s = input.replace(/-/g, '+').replace(/_/g, '/');
      const pad = s.length % 4;
      if (pad) s += '='.repeat(4 - pad);
      return new Uint8Array(Buffer.from(s, 'base64'));
    }
  }

  // ============================================================================
  // Testing Helpers
  // ============================================================================

  /**
   * Get all client connections (for testing)
   */
  getAllClientConnections(): Map<string, Map<string, ClientConnection>> {
    return this.clientConnections;
  }

  /**
   * Get all admin connections (for testing)
   */
  getAllAdminConnections(): Map<string, Map<string, AdminConnection>> {
    return this.adminConnections;
  }

  /**
   * Clear nonce store (for testing)
   */
  clearNonceStore(): void {
    this.nonceStore.clear();
  }
}

// ============================================================================
// Exports
// ============================================================================

export const WS_CONSTANTS = {
  MAX_CONNECTIONS_PER_TENANT,
  STALE_CONNECTION_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS,
  NONCE_EXPIRY_MS,
};
