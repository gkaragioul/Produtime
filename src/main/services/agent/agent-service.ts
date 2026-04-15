/**
 * Agent Service
 * Main service for managing Admin Console connection and communication
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Pairing requires explicit user action (entering pair code)
 * - User sees "Managed by Admin Console" indicator when paired
 * - Only aggregated stats shared by default
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import * as os from 'os';
import { DatabaseManager } from '../../database';
import { AgentCryptoService } from './crypto';
import { MetricsComputer } from './metrics-computer';
import {
  AdminProtocolMessage,
  AgentPairingState,
  PolicyData,
  HeartbeatPayload,
  StatsSummaryPayload,
  AppSummary,
  HEARTBEAT_INTERVAL_MS,
  STATS_SUMMARY_INTERVAL_MS,
  CLOUD_RECONNECT_BASE_DELAY_MS,
  CLOUD_RECONNECT_MAX_DELAY_MS,
  CLOUD_ADMIN_WSS_URL,
} from '../../../shared/admin-protocol';
import {
  EnhancedHeartbeatPayload,
  computePolicyHash,
} from '../../../shared/dashboard-types';
import { DeviceIdService } from '../device-id-service';

export type AgentStatus = 'disconnected' | 'connecting' | 'connected' | 'pairing' | 'paired';

export interface AgentState {
  status: AgentStatus;
  adminName: string | null;
  adminHost: string | null;
  lastConnected: number | null;
  lastHeartbeat: number | null;
  policyVersion: string | null;
  isLocked: boolean;
  lockMessage: string | null;
  // Cloud connection state (Requirement 11.2, 11.4)
  isCloudConnection: boolean;
  cloudConnectionFailed: boolean;
  tenantName: string | null;
}

/**
 * Agent Service - manages connection to Admin Console
 */
export class AgentService extends EventEmitter {
  private static instance: AgentService;
  
  private database: DatabaseManager;
  private crypto: AgentCryptoService;
  private deviceIdService: DeviceIdService;
  private metricsComputer: MetricsComputer;
  
  private ws: WebSocket | null = null;
  private pairingState: AgentPairingState | null = null;
  private effectivePolicy: PolicyData | null = null;
  
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pairingPollTimeout: NodeJS.Timeout | null = null;
  private pairingPollCancelled: boolean = false;
  
  private state: AgentState = {
    status: 'disconnected',
    adminName: null,
    adminHost: null,
    lastConnected: null,
    lastHeartbeat: null,
    policyVersion: null,
    isLocked: false,
    lockMessage: null,
    // Cloud connection state
    isCloudConnection: false,
    cloudConnectionFailed: false,
    tenantName: null,
  };

  private deviceId: string = '';
  private appVersion: string = '';
  private trackingRunning: boolean = true;
  
  // Cloud connection tracking (Requirement 11.3)
  private cloudReconnectAttempts: number = 0;
  private isCloudMode: boolean = false;

  // Deduplication: only emit stateChanged when status actually changes
  private lastEmittedStatus: string = 'disconnected';

  private constructor(database: DatabaseManager) {
    super();
    this.database = database;
    this.crypto = AgentCryptoService.getInstance();
    this.metricsComputer = new MetricsComputer(database);
    this.deviceIdService = DeviceIdService.getInstance();
  }

  /**
   * Emit stateChanged only when the status field actually changes.
   * Prevents UI flashing from rapid WebSocket reconnect cycles.
   */
  private emitStateChanged(): void {
    if (this.state.status !== this.lastEmittedStatus) {
      this.lastEmittedStatus = this.state.status;
      this.emit('stateChanged', this.state);
    }
  }

  public static getInstance(database?: DatabaseManager): AgentService {
    if (!AgentService.instance) {
      if (!database) {
        throw new Error('Database required for first AgentService initialization');
      }
      AgentService.instance = new AgentService(database);
    }
    return AgentService.instance;
  }

  /**
   * Initialize the agent service
   */
  public async initialize(appVersion: string): Promise<void> {
    this.appVersion = appVersion;
    this.deviceId = await this.deviceIdService.getDeviceId();
    
    // Load pairing state from database
    await this.loadPairingState();
    console.log('[AGENT] Loaded pairing state:', this.pairingState?.paired ? 'paired' : 'not paired', 'adminHost:', this.pairingState?.adminHost, 'cloudWsEndpoint:', this.pairingState?.cloudWsEndpoint);
    
    // Load effective policy
    await this.loadEffectivePolicy();
    
    // MANAGED DEPLOYMENT: Always connect to the hardcoded cloud admin URL.
    // Generate keys if this is a fresh install, then connect.
    if (!this.pairingState?.devicePubKey) {
      console.log('[AGENT] Fresh install — generating keys for cloud auto-connect');
      const keyPair = this.crypto.generateKeyPair();
      this.pairingState = {
        paired: false,
        adminHost: null,
        adminName: null,
        adminPubKey: null,
        devicePubKey: keyPair.publicKey,
        devicePrivKeyEncrypted: this.crypto.encryptWithPassword(keyPair.privateKey, this.deviceId),
        pairedAt: null,
        lastConnectedAt: null,
        sessionToken: null,
        cloudWsEndpoint: CLOUD_ADMIN_WSS_URL,
        tenantId: null,
        tenantName: null,
      };
      await this.savePairingState();
    }

    // Always override to cloud endpoint (even if old local pairing exists)
    if (this.pairingState) {
      this.pairingState.cloudWsEndpoint = CLOUD_ADMIN_WSS_URL;
    }

    console.log('[AGENT] Connecting to cloud admin:', CLOUD_ADMIN_WSS_URL);
    this.isCloudMode = true;
    this.state.isCloudConnection = true;
    this.state.tenantName = this.pairingState?.tenantName || null;
    this.connectToCloud(CLOUD_ADMIN_WSS_URL);
    
    console.log('Agent service initialized');
  }

  /**
   * Get device display name — employee name from settings, or hostname as fallback
   */
  private getDeviceDisplayName(): string {
    try {
      const name = this.database.getSetting('employee_name');
      if (name && name.trim()) return name.trim();
    } catch {}
    return os.hostname();
  }

  /**
   * Get current agent state
   */
  public getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Get pairing state
   */
  public getPairingState(): AgentPairingState | null {
    return this.pairingState ? { ...this.pairingState } : null;
  }

  /**
   * Get effective policy
   */
  public getEffectivePolicy(): PolicyData | null {
    return this.effectivePolicy ? { ...this.effectivePolicy } : null;
  }

  /**
   * Check if managed by admin
   */
  public isManaged(): boolean {
    return this.pairingState?.paired === true;
  }

  /**
   * Start cloud-based pairing process
   * Requirement 3.3: Support cloud-based pair code submission
   * Requirement 3.7: Handle approval response with WebSocket URL
   * 
   * @param cloudApiUrl - The cloud admin API URL (e.g., https://api.example.com)
   * @param pairCode - The 6-digit pair code
   */
  public async startCloudPairing(cloudApiUrl: string, pairCode: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Generate device key pair if not exists
      if (!this.pairingState?.devicePubKey) {
        const keyPair = this.crypto.generateKeyPair();
        this.pairingState = {
          paired: false,
          adminHost: null,
          adminName: null,
          adminPubKey: null,
          devicePubKey: keyPair.publicKey,
          devicePrivKeyEncrypted: this.crypto.encryptWithPassword(keyPair.privateKey, this.deviceId),
          pairedAt: null,
          lastConnectedAt: null,
          sessionToken: null,
          cloudWsEndpoint: null,
          tenantId: null,
          tenantName: null,
        };
      } else {
        // Reset for new cloud pairing attempt
        this.pairingState = {
          ...this.pairingState,
          adminHost: null,
          paired: false,
          cloudWsEndpoint: null,
          tenantId: null,
          tenantName: null,
        };
      }

      this.state.status = 'pairing';
      this.state.isCloudConnection = true;
      this.isCloudMode = true;
      this.emitStateChanged();

      // Send pairing request to cloud API
      const response = await this.sendCloudPairRequest(cloudApiUrl, pairCode);
      
      if (response.success && response.requestId) {
        // Store the request ID for polling or WebSocket notification
        console.log('[AGENT] Cloud pairing request submitted, requestId:', response.requestId);
        
        // The cloud API will notify us via WebSocket when approved
        // For now, we'll poll for approval status
        this.pollCloudPairingStatus(cloudApiUrl, response.requestId);
        
        return { success: true };
      } else {
        this.state.status = 'disconnected';
        this.state.isCloudConnection = false;
        this.isCloudMode = false;
        this.emitStateChanged();
        return { success: false, error: response.error || 'Failed to submit pairing request' };
      }
    } catch (error) {
      this.state.status = 'disconnected';
      this.state.isCloudConnection = false;
      this.isCloudMode = false;
      this.emitStateChanged();
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send pairing request to cloud API
   * Requirement 3.3: Create pending pairing request with valid code
   */
  private async sendCloudPairRequest(cloudApiUrl: string, pairCode: string): Promise<{ success: boolean; requestId?: string; error?: string }> {
    return new Promise((resolve) => {
      const https = require('https');
      const http = require('http');
      
      const payload = {
        pairCode,
        deviceId: this.deviceId,
        deviceName: this.getDeviceDisplayName(),
        devicePubKey: this.pairingState!.devicePubKey!,
        appVersion: this.appVersion,
        osInfo: `${process.platform} ${require('os').release()}`,
      };

      const postData = JSON.stringify(payload);
      const url = new URL(`${cloudApiUrl}/api/v1/pairing/request`);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const req = httpModule.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: 30000,
        },
        (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              if (res.statusCode === 200 || res.statusCode === 201) {
                resolve({ success: true, requestId: result.requestId });
              } else {
                resolve({ success: false, error: result.message || result.error || 'Request failed' });
              }
            } catch {
              resolve({ success: false, error: 'Invalid response from cloud API' });
            }
          });
        }
      );

      req.on('error', (err: Error) => {
        resolve({ success: false, error: `Connection failed: ${err.message}` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Connection timeout' });
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Poll cloud API for pairing approval status
   * This is a fallback mechanism - ideally the cloud would push via WebSocket
   */
  private async pollCloudPairingStatus(cloudApiUrl: string, requestId: string): Promise<void> {
    const maxPolls = 60; // Poll for up to 5 minutes (60 * 5 seconds)
    const pollInterval = 5000; // 5 seconds
    let pollCount = 0;

    // Reset cancellation state for a new pairing session.
    this.pairingPollCancelled = false;
    if (this.pairingPollTimeout) {
      clearTimeout(this.pairingPollTimeout);
      this.pairingPollTimeout = null;
    }

    const schedule = () => {
      if (this.pairingPollCancelled) return;
      this.pairingPollTimeout = setTimeout(poll, pollInterval);
    };

    const poll = async () => {
      this.pairingPollTimeout = null;
      if (this.pairingPollCancelled) return;

      if (pollCount >= maxPolls || this.state.status !== 'pairing') {
        if (this.state.status === 'pairing') {
          console.log('[AGENT] Cloud pairing polling timed out');
          this.state.status = 'disconnected';
          this.state.isCloudConnection = false;
          this.isCloudMode = false;
          this.emitStateChanged();
          this.emit('pairDenied', { reason: 'Pairing request timed out' });
        }
        return;
      }

      pollCount++;

      try {
        const status = await this.checkCloudPairingStatus(cloudApiUrl, requestId);
        if (this.pairingPollCancelled) return;

        if (status.status === 'approved') {
          console.log('[AGENT] Cloud pairing approved!');
          await this.handleCloudPairApproved(status);
        } else if (status.status === 'denied') {
          console.log('[AGENT] Cloud pairing denied');
          this.state.status = 'disconnected';
          this.state.isCloudConnection = false;
          this.isCloudMode = false;
          this.emitStateChanged();
          this.emit('pairDenied', { reason: status.reason || 'Pairing request denied' });
        } else {
          schedule();
        }
      } catch (error) {
        console.error('[AGENT] Error polling pairing status:', error);
        schedule();
      }
    };

    schedule();
  }

  /**
   * Check cloud pairing request status
   */
  private async checkCloudPairingStatus(cloudApiUrl: string, requestId: string): Promise<{ status: string; wsEndpoint?: string; adminPubKey?: string; sessionToken?: string; tenantId?: string; tenantName?: string; adminName?: string; reason?: string }> {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      
      const url = new URL(`${cloudApiUrl}/api/v1/pairing/status/${requestId}`);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const req = httpModule.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
        (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              resolve(result);
            } catch {
              reject(new Error('Invalid response from cloud API'));
            }
          });
        }
      );

      req.on('error', (err: Error) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timeout'));
      });

      req.end();
    });
  }

  /**
   * Handle cloud pairing approval
   * Requirement 3.7: Handle approval response with WebSocket URL
   */
  private async handleCloudPairApproved(approval: { wsEndpoint?: string; adminPubKey?: string; sessionToken?: string; tenantId?: string; tenantName?: string; adminName?: string }): Promise<void> {
    console.log('[AGENT] Handling cloud pair approval:', approval);

    this.pairingState = {
      ...this.pairingState!,
      paired: true,
      adminName: approval.adminName || approval.tenantName || 'Cloud Admin',
      adminPubKey: approval.adminPubKey || null,
      pairedAt: Date.now(),
      lastConnectedAt: Date.now(),
      sessionToken: approval.sessionToken || null,
      cloudWsEndpoint: approval.wsEndpoint || null,
      tenantId: approval.tenantId || null,
      tenantName: approval.tenantName || approval.adminName || null,
    };

    // Save to database
    await this.savePairingState();
    console.log('[AGENT] Cloud pairing state saved to database');

    this.state.status = 'paired';
    this.state.adminName = this.pairingState.adminName;
    this.state.tenantName = this.pairingState.tenantName;
    this.state.isCloudConnection = true;
    this.emitStateChanged();
    this.emit('paired', { 
      adminName: this.pairingState.adminName,
      tenantName: this.pairingState.tenantName,
      cloudWsEndpoint: this.pairingState.cloudWsEndpoint,
    });

    // Connect to cloud WebSocket endpoint
    if (this.pairingState.cloudWsEndpoint) {
      console.log('[AGENT] Connecting to cloud WebSocket:', this.pairingState.cloudWsEndpoint);
      this.connectToCloud(this.pairingState.cloudWsEndpoint);
    }
  }

  /**
   * Connect to cloud admin console via WebSocket
   * Requirement 11.2: Connect to stored cloud endpoint on startup
   * Requirement 11.3: Implement exponential backoff retry (max 10 attempts)
   * Requirement 11.4: Fall back to local-only mode if unavailable
   */
  private connectToCloud(cloudWsEndpoint: string): void {
    // Cancel any pending reconnect — we're starting one now.
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Tear down previous socket fully so its listeners don't linger in memory.
    if (this.ws) {
      try { this.ws.removeAllListeners(); } catch {}
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    console.log(`[AGENT] Connecting to Cloud Admin Console: ${cloudWsEndpoint}`);
    this.state.status = 'connecting';
    this.state.isCloudConnection = true;
    this.emitStateChanged();

    try {
      const ws = new WebSocket(cloudWsEndpoint);
      this.ws = ws;

      // Guard: 'error' and 'close' can both fire for the same socket.
      // Without this, handleCloudDisconnect ran twice → two reconnect timers
      // → WebSocket pile-up and duplicate tray/state updates.
      let disconnectHandled = false;
      const handleDisconnect = () => {
        if (disconnectHandled) return;
        disconnectHandled = true;
        this.handleCloudDisconnect();
      };

      ws.on('open', () => {
        console.log('[AGENT] Connected to Cloud Admin Console');
        this.cloudReconnectAttempts = 0;
        this.state.status = this.pairingState?.paired ? 'paired' : 'pairing';
        this.state.lastConnected = Date.now();
        this.state.cloudConnectionFailed = false;
        this.emitStateChanged();

        // Send identification message for cloud connection
        const identifyMsg = this.crypto.createSignedMessage(
          'IDENTIFY',
          this.deviceId,
          {
            deviceName: this.getDeviceDisplayName(),
            devicePubKey: this.pairingState!.devicePubKey,
            appVersion: this.appVersion,
            osInfo: `${process.platform} ${require('os').release()}`,
            tenantId: this.pairingState?.tenantId,
            sessionToken: this.pairingState?.sessionToken,
            isPairing: false,
          },
          this.getPrivateKey()
        );
        ws.send(JSON.stringify(identifyMsg));

        // Start heartbeat
        this.startHeartbeat();
      });

      ws.on('message', (data) => {
        console.log('[AGENT] Received cloud message:', data.toString().substring(0, 100));
        this.handleMessage(data.toString());
      });

      ws.on('close', (code, reason) => {
        console.log(`[AGENT] Disconnected from Cloud Admin Console: code=${code}, reason=${reason}`);
        handleDisconnect();
      });

      ws.on('error', (err) => {
        console.error('[AGENT] Cloud WebSocket error:', err);
        handleDisconnect();
      });
    } catch (err) {
      console.error('[AGENT] Failed to connect to cloud:', err);
      this.handleCloudDisconnect();
    }
  }

  /**
   * Handle cloud WebSocket disconnection with exponential backoff
   * Requirement 11.3: Implement exponential backoff retry (max 10 attempts)
   * Requirement 11.4: Fall back to local-only mode if unavailable
   */
  private handleCloudDisconnect(): void {
    this.stopHeartbeat();

    if (this.ws) {
      try { this.ws.removeAllListeners(); } catch {}
      this.ws = null;
    }

    this.state.status = 'disconnected';
    this.emitStateChanged();

    // Always reconnect to cloud — never give up
    const cloudEndpoint = this.pairingState?.cloudWsEndpoint || CLOUD_ADMIN_WSS_URL;
    if (cloudEndpoint) {
      // Drop any pending reconnect so we don't stack two timers.
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      this.cloudReconnectAttempts++;

      // Exponential backoff: delay = base * 2^(attempt-1), capped at max (60s)
      const delay = Math.min(
        CLOUD_RECONNECT_BASE_DELAY_MS * Math.pow(2, this.cloudReconnectAttempts - 1),
        CLOUD_RECONNECT_MAX_DELAY_MS
      );

      console.log(`[AGENT] Cloud reconnecting in ${delay}ms (attempt ${this.cloudReconnectAttempts})`);

      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        this.connectToCloud(cloudEndpoint);
      }, delay);
    }
  }

  /**
   * Handle incoming message from admin
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as AdminProtocolMessage;
      
      // Verify signature if we have admin's public key.
      // Skip verification for PAIR_APPROVED — it carries the new admin public key
      // and may be signed with a key we don't have yet (server keypair regeneration).
      if (this.pairingState?.adminPubKey && message.type !== 'PAIR_APPROVED') {
        if (!this.crypto.verifyMessage(message, this.pairingState.adminPubKey)) {
          console.warn('Invalid message signature from admin');
          return;
        }
      }

      switch (message.type) {
        case 'PAIR_APPROVED':
          this.handlePairApproved(message);
          break;
        case 'PAIR_DENIED':
          this.handlePairDenied(message);
          break;
        case 'POLICY_PUSH':
          this.handlePolicyPush(message);
          break;
        case 'EXPORT_REQUEST':
          this.handleExportRequest(message);
          break;
        case 'STATS_SNAPSHOT_REQUEST':
          this.handleStatsSnapshotRequest(message);
          break;
        case 'LOCK':
          this.handleLock(message);
          break;
        case 'UNLOCK':
          this.handleUnlock(message);
          break;
        case 'UNPAIR':
          this.handleUnpair(message);
          break;
        case 'SALES_RESPONSE':
          this.handleSalesResponse(message);
          break;
        case 'ACK':
          // Acknowledgment received
          break;
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (err) {
      console.error('Failed to handle message:', err);
    }
  }

  /**
   * Handle pairing approval
   */
  private async handlePairApproved(message: AdminProtocolMessage): Promise<void> {
    const payload = (message as any).payload;
    const wasAlreadyPaired = this.pairingState?.paired === true;

    // Silently update the admin public key (handles server key rotation)
    this.pairingState = {
      ...this.pairingState!,
      paired: true,
      adminName: payload.adminName,
      adminPubKey: payload.adminPubKey,
      pairedAt: this.pairingState?.pairedAt || Date.now(),
      lastConnectedAt: Date.now(),
      sessionToken: payload.sessionToken,
      cloudWsEndpoint: payload.wsEndpoint || this.pairingState?.cloudWsEndpoint || null,
      tenantId: payload.tenantId || this.pairingState?.tenantId || null,
      tenantName: payload.tenantName || payload.adminName || this.pairingState?.tenantName || null,
    };

    // Save to database
    await this.savePairingState();

    // Apply initial policy if provided
    if (payload.initialPolicy) {
      await this.applyPolicy(payload.initialPolicy);
    }

    // Only emit events on first pairing (not on key refresh)
    if (!wasAlreadyPaired) {
      this.state.status = 'paired';
      this.state.adminName = payload.adminName;
      this.state.lastConnected = Date.now();
      this.emitStateChanged();
      this.emit('paired', {
        adminName: payload.adminName,
        tenantName: payload.tenantName || payload.adminName,
        cloudWsEndpoint: payload.wsEndpoint,
      });
      console.log(`[AGENT] Paired with Admin Console: ${payload.adminName}`);
    } else {
      // Already paired — just update last connected time silently
      this.state.lastConnected = Date.now();
    }

    // Start heartbeat to maintain connection and show as online
    this.startHeartbeat();
  }

  /**
   * Handle pairing denial
   */
  private handlePairDenied(message: AdminProtocolMessage): void {
    const payload = (message as any).payload;
    
    this.state.status = 'disconnected';
    this.emitStateChanged();
    this.emit('pairDenied', { reason: payload.reason });
    
    console.log('Pairing denied:', payload.reason);
    
    if (this.ws) {
      this.ws.close();
    }
  }

  /**
   * Handle policy push from admin
   */
  private async handlePolicyPush(message: AdminProtocolMessage): Promise<void> {
    const payload = (message as any).payload;
    await this.applyPolicy(payload.policy);
    
    // Send acknowledgment
    this.sendAck(message.nonce);
    
    this.emit('policyUpdated', payload.policy);
    console.log('Policy updated from admin');
  }

  /**
   * Apply policy to local settings
   */
  private async applyPolicy(policy: PolicyData): Promise<void> {
    this.effectivePolicy = policy;
    this.state.policyVersion = policy.version;

    // Save policy to database
    const policyKeys: (keyof PolicyData)[] = [
      'workScheduleStart', 'workScheduleEnd', 'workScheduleWeekly',
      'idleThreshold', 'breakDuration', 'privacyModeEnabled', 'privacyApps',
      'titleSharingEnabled', 'autoExportEnabled', 'autoExportTime',
      'exportFolder', 'reportRetentionDays', 'employeeName',
      'slackUserId',
      'appCategories',
    ];

    for (const key of policyKeys) {
      const value = policy[key];
      if (value !== undefined) {
        const dbKey = this.policyKeyToSettingKey(key);
        const dbValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

        // Store in effective_policy table
        this.database.execute(
          `INSERT OR REPLACE INTO effective_policy (key, value, updated_at, source) VALUES (?, ?, ?, ?)`,
          [dbKey, dbValue, Date.now(), 'admin']
        );

        // Also apply to settings table so the entire app respects admin policy
        this.database.setSetting(dbKey, dbValue);

        // Admin controls the lock: non-empty name locks; empty clears the lock
        // so the user can re-enter on next boot.
        if (key === 'employeeName') {
          const trimmed = String(value || '').trim();
          this.database.setSetting('employee_name_locked', trimmed ? 'true' : 'false');
        }
      }
    }

    this.emitStateChanged();
  }

  /**
   * Convert policy key to settings key
   */
  private policyKeyToSettingKey(key: string): string {
    const mapping: Record<string, string> = {
      workScheduleStart: 'work_schedule_start',
      workScheduleEnd: 'work_schedule_end',
      workScheduleWeekly: 'work_schedule_weekly',
      idleThreshold: 'idle_threshold',
      breakDuration: 'break_duration',
      privacyModeEnabled: 'privacy_mode_enabled',
      privacyApps: 'privacy_apps',
      titleSharingEnabled: 'title_sharing_enabled',
      autoExportEnabled: 'auto_export_enabled',
      autoExportTime: 'auto_export_time',
      exportFolder: 'export_folder',
      reportRetentionDays: 'report_retention_days',
      employeeName: 'employee_name',
      slackUserId: 'slack_user_id',
      appCategories: 'app_categories',
    };
    return mapping[key] || key;
  }

  /**
   * Handle export request from admin
   */
  private async handleExportRequest(message: AdminProtocolMessage): Promise<void> {
    const payload = (message as any).payload;

    // ACK immediately so admin knows request was received
    this.sendAck(message.nonce);

    // Emit event for main process to handle PDF generation
    this.emit('exportRequested', {
      requestId: message.nonce,
      ...payload,
    });
  }

  /**
   * Handle stats snapshot request
   */
  private async handleStatsSnapshotRequest(message: AdminProtocolMessage): Promise<void> {
    const payload = (message as any).payload;
    
    // Get stats from database
    const stats = await this.getStatsSummary(payload.period, payload.startDate, payload.endDate);
    
    // Send response
    const response = this.crypto.createSignedMessage(
      'STATS_SNAPSHOT_RESULT',
      this.deviceId,
      stats,
      this.getPrivateKey()
    );
    
    this.send(response);
  }

  /**
   * Handle lock command
   */
  private handleLock(message: AdminProtocolMessage): void {
    const payload = (message as any).payload;

    this.state.isLocked = true;
    this.state.lockMessage = payload.message;
    this.emitStateChanged();
    this.emit('locked', { reason: payload.reason, message: payload.message });
    this.sendAck(message.nonce);

    console.log('App locked by admin:', payload.reason);
  }

  /**
   * Handle unlock command
   */
  private handleUnlock(message: AdminProtocolMessage): void {
    this.state.isLocked = false;
    this.state.lockMessage = null;
    this.emitStateChanged();
    this.emit('unlocked');
    this.sendAck(message.nonce);

    console.log('App unlocked by admin');
  }

  /**
   * Handle unpair command
   */
  private async handleUnpair(message: AdminProtocolMessage): Promise<void> {
    await this.unpair();
    this.emit('unpaired', { reason: (message as any).payload.reason });
  }

  /**
   * Unpair from admin console
   */
  public async unpair(): Promise<void> {
    // Clear pairing state
    this.pairingState = {
      paired: false,
      adminHost: null,
      adminName: null,
      adminPubKey: null,
      devicePubKey: null,
      devicePrivKeyEncrypted: null,
      pairedAt: null,
      lastConnectedAt: null,
      sessionToken: null,
      // Cloud pairing fields
      cloudWsEndpoint: null,
      tenantId: null,
      tenantName: null,
    };

    // Clear from database
    this.database.execute('DELETE FROM agent_pairing WHERE id = 1');
    this.database.execute('DELETE FROM effective_policy');

    // Disconnect
    if (this.ws) {
      this.ws.close();
    }

    // Reset cloud connection state
    this.isCloudMode = false;
    this.cloudReconnectAttempts = 0;

    this.state = {
      status: 'disconnected',
      adminName: null,
      adminHost: null,
      lastConnected: null,
      lastHeartbeat: null,
      policyVersion: null,
      isLocked: false,
      lockMessage: null,
      isCloudConnection: false,
      cloudConnectionFailed: false,
      tenantName: null,
    };

    this.effectivePolicy = null;
    this.emitStateChanged();
    
    console.log('Unpaired from Admin Console');
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    this.statsInterval = setInterval(() => {
      this.sendStatsSummary();
    }, STATS_SUMMARY_INTERVAL_MS);
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  /**
   * Send heartbeat to admin
   */
  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Compute metrics for enhanced heartbeat
    const todayMetrics = this.metricsComputer.computeTodayMetrics();
    const last15mMetrics = this.metricsComputer.computeLast15mMetrics();
    const topAppsToday = this.metricsComputer.computeTopAppsToday();
    const detailedAppsToday = this.metricsComputer.computeDetailedAppsToday();

    // Get local IP address
    const localIp = this.getLocalIpAddress();

    // Compute policy hash for compliance check
    const policyHash = this.effectivePolicy 
      ? computePolicyHash(JSON.stringify(this.effectivePolicy))
      : '';

    // Build enhanced heartbeat payload
    const enhancedPayload: EnhancedHeartbeatPayload = {
      deviceId: this.deviceId,
      deviceName: this.getDeviceDisplayName(),
      ip: localIp,
      appVersion: this.appVersion,
      trackingRunning: this.trackingRunning,
      effectivePolicyHash: policyHash,
      privacyModeEffective: this.effectivePolicy?.privacyModeEnabled || false,
      titleSharingEffective: this.effectivePolicy?.titleSharingEnabled || false,
      today: todayMetrics,
      last15m: last15mMetrics,
      topAppsToday,
      detailedAppsToday,
    };

    // Also include legacy fields for backward compatibility
    const payload: HeartbeatPayload & { enhanced: EnhancedHeartbeatPayload } = {
      appVersion: this.appVersion,
      trackingStatus: this.trackingRunning ? 'active' : 'paused',
      policyVersion: this.state.policyVersion || '',
      uptime: process.uptime(),
      lastActivityAt: todayMetrics.lastActivityTs || Date.now(),
      enhanced: enhancedPayload,
    };

    const message = this.crypto.createSignedMessage(
      'HEARTBEAT',
      this.deviceId,
      payload,
      this.getPrivateKey()
    );

    this.send(message);
    this.state.lastHeartbeat = Date.now();
  }

  /**
   * Get local IP address
   */
  private getLocalIpAddress(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) {
          return info.address;
        }
      }
    }
    return '127.0.0.1';
  }

  /**
   * Set tracking running state
   */
  public setTrackingRunning(running: boolean): void {
    this.trackingRunning = running;
  }

  /**
   * Send stats summary to admin
   */
  private async sendStatsSummary(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const stats = await this.getStatsSummary('last15m');
    
    const message = this.crypto.createSignedMessage(
      'STATS_SUMMARY',
      this.deviceId,
      stats,
      this.getPrivateKey()
    );

    this.send(message);
  }

  /**
   * Get stats summary from database
   */
  private async getStatsSummary(
    period: string,
    startDate?: string,
    endDate?: string
  ): Promise<StatsSummaryPayload> {
    const now = Date.now();
    let periodStart: number;
    let periodEnd = now;

    switch (period) {
      case 'last15m':
        periodStart = now - 15 * 60 * 1000;
        break;
      case 'today':
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        periodStart = today.getTime();
        break;
      default:
        periodStart = startDate ? new Date(startDate).getTime() : now - 24 * 60 * 60 * 1000;
        periodEnd = endDate ? new Date(endDate).getTime() : now;
    }

    // Get activity summary from database
    const startISO = new Date(periodStart).toISOString();
    const endISO = new Date(periodEnd).toISOString();
    
    const summary = this.database.getActivitySummaryByDateRange(
      startISO.split('T')[0],
      endISO.split('T')[0]
    );

    // Get top apps
    const topAppsData = this.database.getActivityLogsByDateRangeAggregated(
      startISO.split('T')[0],
      endISO.split('T')[0]
    );

    // Aggregate by app
    const appTotals = new Map<string, number>();
    for (const entry of topAppsData) {
      const current = appTotals.get(entry.app_name) || 0;
      appTotals.set(entry.app_name, current + entry.total_duration);
    }

    // Sort and take top 5
    const sortedApps = Array.from(appTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const totalSeconds = summary.total_active_seconds + summary.total_idle_seconds;
    const topApps: AppSummary[] = sortedApps.map(([appName, seconds]) => ({
      appName,
      totalSeconds: seconds,
      percentage: totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0,
    }));

    return {
      period: period as any,
      periodStart,
      periodEnd,
      totalActiveSeconds: summary.total_active_seconds,
      totalIdleSeconds: summary.total_idle_seconds,
      topApps,
      includeTitles: this.effectivePolicy?.titleSharingEnabled || false,
    };
  }

  /**
   * Send message to admin
   */
  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send acknowledgment
   */
  private sendAck(ackNonce: string): void {
    const message = this.crypto.createSignedMessage(
      'ACK',
      this.deviceId,
      { ackNonce },
      this.getPrivateKey()
    );
    this.send(message);
  }

  // Slack sales proxy — request/response over the pairing WS channel.
  private pendingSalesRequests: Map<string, {
    resolve: (v: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  public async requestSales(range: 'day' | 'week' | 'month'): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { unavailable: true, reason: 'not_connected' };
    }
    const requestId = `sales_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const message = this.crypto.createSignedMessage(
      'SALES_REQUEST',
      this.deviceId,
      { requestId, range },
      this.getPrivateKey()
    );
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingSalesRequests.delete(requestId);
        resolve({ unavailable: true, reason: 'timeout' });
      }, 10_000);
      this.pendingSalesRequests.set(requestId, { resolve, timeout });
      try {
        this.send(message);
      } catch {
        clearTimeout(timeout);
        this.pendingSalesRequests.delete(requestId);
        resolve({ unavailable: true, reason: 'send_failed' });
      }
    });
  }

  private handleSalesResponse(message: AdminProtocolMessage): void {
    const payload = (message as any).payload || {};
    const requestId = payload.requestId;
    if (!requestId) return;
    const pending = this.pendingSalesRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingSalesRequests.delete(requestId);
    // Strip the requestId before handing to callers.
    const { requestId: _rid, ...rest } = payload;
    pending.resolve(rest);
  }

  /**
   * Get decrypted private key
   */
  private getPrivateKey(): string {
    if (!this.pairingState?.devicePrivKeyEncrypted) {
      throw new Error('No private key available');
    }
    return this.crypto.decryptWithPassword(
      this.pairingState.devicePrivKeyEncrypted,
      this.deviceId
    );
  }

  /**
   * Load pairing state from database
   */
  private async loadPairingState(): Promise<void> {
    const row = this.database.get<any>(
      'SELECT * FROM agent_pairing WHERE id = 1'
    );

    if (row) {
      this.pairingState = {
        paired: Boolean(row.paired),
        adminHost: row.admin_host,
        adminName: row.admin_name,
        adminPubKey: row.admin_pubkey,
        devicePubKey: row.device_pubkey,
        devicePrivKeyEncrypted: row.device_privkey_encrypted,
        pairedAt: row.paired_at,
        lastConnectedAt: row.last_connected_at,
        sessionToken: row.session_token,
        // Cloud pairing fields (Requirement 11.1)
        cloudWsEndpoint: row.cloud_ws_endpoint || null,
        tenantId: row.tenant_id || null,
        tenantName: row.tenant_name || null,
      };

      if (this.pairingState.paired) {
        this.state.status = 'disconnected'; // Will connect shortly
        this.state.adminName = this.pairingState.adminName;
        this.state.adminHost = this.pairingState.adminHost;
      }
    }
  }

  /**
   * Save pairing state to database
   */
  private async savePairingState(): Promise<void> {
    if (!this.pairingState) {
      console.log('[AGENT] savePairingState: No pairing state to save');
      return;
    }

    console.log('[AGENT] Saving pairing state:', {
      paired: this.pairingState.paired,
      adminHost: this.pairingState.adminHost,
      adminName: this.pairingState.adminName,
      cloudWsEndpoint: this.pairingState.cloudWsEndpoint,
      tenantId: this.pairingState.tenantId,
      tenantName: this.pairingState.tenantName,
    });

    this.database.execute(
      `INSERT OR REPLACE INTO agent_pairing 
       (id, paired, admin_host, admin_name, admin_pubkey, device_pubkey, 
        device_privkey_encrypted, paired_at, last_connected_at, session_token,
        cloud_ws_endpoint, tenant_id, tenant_name)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.pairingState.paired ? 1 : 0,
        this.pairingState.adminHost,
        this.pairingState.adminName,
        this.pairingState.adminPubKey,
        this.pairingState.devicePubKey,
        this.pairingState.devicePrivKeyEncrypted,
        this.pairingState.pairedAt,
        this.pairingState.lastConnectedAt,
        this.pairingState.sessionToken,
        this.pairingState.cloudWsEndpoint,
        this.pairingState.tenantId,
        this.pairingState.tenantName,
      ]
    );
  }

  /**
   * Load effective policy from database
   */
  private async loadEffectivePolicy(): Promise<void> {
    const rows = this.database.all<{ key: string; value: string }>(
      'SELECT * FROM effective_policy WHERE source = ?',
      ['admin']
    );

    if (rows && rows.length > 0) {
      // Reverse mapping: DB snake_case keys → camelCase policy keys
      const settingKeyToPolicyKey: Record<string, string> = {
        work_schedule_start: 'workScheduleStart',
        work_schedule_end: 'workScheduleEnd',
        work_schedule_weekly: 'workScheduleWeekly',
        idle_threshold: 'idleThreshold',
        break_duration: 'breakDuration',
        privacy_mode_enabled: 'privacyModeEnabled',
        privacy_apps: 'privacyApps',
        title_sharing_enabled: 'titleSharingEnabled',
        auto_export_enabled: 'autoExportEnabled',
        auto_export_time: 'autoExportTime',
        export_folder: 'exportFolder',
        report_retention_days: 'reportRetentionDays',
        employee_name: 'employeeName',
        app_categories: 'appCategories',
      };

      // Reconstruct policy from rows using camelCase keys
      const policy: any = {};
      for (const row of rows) {
        const policyKey = settingKeyToPolicyKey[row.key] || row.key;
        try {
          policy[policyKey] = JSON.parse(row.value);
        } catch {
          policy[policyKey] = row.value;
        }
      }
      this.effectivePolicy = policy as PolicyData;
      this.state.policyVersion = this.crypto.hashPolicy(policy);
    }
  }

  /**
   * Send export result back to admin
   */
  public sendExportResult(result: any): void {
    const message = this.crypto.createSignedMessage(
      'EXPORT_RESULT',
      this.deviceId,
      result,
      this.getPrivateKey()
    );
    this.send(message);
  }

  /**
   * Check if connected to cloud admin console
   * Requirement 11.2
   */
  public isCloudConnected(): boolean {
    return this.isCloudMode && this.state.status === 'paired';
  }

  /**
   * Check if cloud connection has failed and we're in local-only mode
   * Requirement 11.4
   */
  public isInLocalOnlyMode(): boolean {
    return this.state.cloudConnectionFailed;
  }

  /**
   * Get tenant name for display (company name)
   * Requirement 3.8
   */
  public getTenantName(): string | null {
    return this.pairingState?.tenantName || null;
  }

  /**
   * Retry cloud connection manually
   * Useful after network recovery
   */
  public retryCloudConnection(): void {
    if (this.pairingState?.cloudWsEndpoint && this.pairingState.paired) {
      console.log('[AGENT] Manually retrying cloud connection');
      this.cloudReconnectAttempts = 0;
      this.state.cloudConnectionFailed = false;
      this.isCloudMode = true;
      this.connectToCloud(this.pairingState.cloudWsEndpoint);
    }
  }

  /**
   * Shutdown the agent service
   */
  public shutdown(): void {
    this.stopHeartbeat();

    // Cancel pairing poll so stale setTimeout closures don't fire after shutdown.
    this.pairingPollCancelled = true;
    if (this.pairingPollTimeout) {
      clearTimeout(this.pairingPollTimeout);
      this.pairingPollTimeout = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      try { this.ws.removeAllListeners(); } catch {}
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    // Drop listeners attached to the singleton (IPCHandlers / tray).
    // Singleton persists across app-lifecycle events, so uncleaned listeners
    // would stack if init ever ran again.
    this.removeAllListeners();

    console.log('Agent service shutdown');
  }
}

export default AgentService;
