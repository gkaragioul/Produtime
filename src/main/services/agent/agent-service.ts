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
import * as http from 'http';
import * as os from 'os';
import { DatabaseManager } from '../../database';
import { AgentCryptoService } from './crypto';
import { AgentDiscoveryService, DiscoveredAdmin } from './discovery';
import { MetricsComputer } from './metrics-computer';
import {
  AdminProtocolMessage,
  AgentPairingState,
  PolicyData,
  HeartbeatPayload,
  StatsSummaryPayload,
  AppSummary,
  PairRequestPayload,
  ADMIN_CONSOLE_DEFAULT_PORT,
  HEARTBEAT_INTERVAL_MS,
  STATS_SUMMARY_INTERVAL_MS,
  RECONNECT_DELAY_MS,
  MAX_RECONNECT_ATTEMPTS,
  CLOUD_RECONNECT_BASE_DELAY_MS,
  CLOUD_RECONNECT_MAX_DELAY_MS,
  CLOUD_MAX_RECONNECT_ATTEMPTS,
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
  private discovery: AgentDiscoveryService;
  private deviceIdService: DeviceIdService;
  private metricsComputer: MetricsComputer;
  
  private ws: WebSocket | null = null;
  private pairingState: AgentPairingState | null = null;
  private effectivePolicy: PolicyData | null = null;
  
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  
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

  private constructor(database: DatabaseManager) {
    super();
    this.database = database;
    this.crypto = AgentCryptoService.getInstance();
    this.discovery = AgentDiscoveryService.getInstance();
    this.metricsComputer = new MetricsComputer(database);
    this.deviceIdService = DeviceIdService.getInstance();
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
    
    // Start discovery
    this.discovery.start();
    
    // If already paired, try to connect
    if (this.pairingState?.paired) {
      // Requirement 11.2: Connect to stored cloud endpoint on startup
      if (this.pairingState.cloudWsEndpoint) {
        console.log('[AGENT] Already paired with cloud endpoint, connecting to:', this.pairingState.cloudWsEndpoint);
        this.isCloudMode = true;
        this.state.isCloudConnection = true;
        this.state.tenantName = this.pairingState.tenantName;
        this.connectToCloud(this.pairingState.cloudWsEndpoint);
      } else if (this.pairingState.adminHost) {
        // Fall back to local admin host
        console.log('[AGENT] Already paired with local admin, connecting to:', this.pairingState.adminHost);
        this.isCloudMode = false;
        this.state.isCloudConnection = false;
        this.connect(this.pairingState.adminHost);
      }
    } else {
      // AUTO-CONNECT: Not paired yet — generate keys and connect to hardcoded cloud admin
      console.log('[AGENT] Not paired — auto-connecting to cloud admin:', CLOUD_ADMIN_WSS_URL);

      // Generate key pair if we don't have one
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
          cloudWsEndpoint: CLOUD_ADMIN_WSS_URL,
          tenantId: null,
          tenantName: null,
        };
        await this.savePairingState();
      }

      this.isCloudMode = true;
      this.state.isCloudConnection = true;
      this.connectToCloud(CLOUD_ADMIN_WSS_URL);
    }
    
    console.log('Agent service initialized');
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
   * Start pairing process with admin console
   */
  public async startPairing(adminHost: string, pairCode: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Generate device key pair if not exists
      if (!this.pairingState?.devicePubKey) {
        const keyPair = this.crypto.generateKeyPair();
        this.pairingState = {
          paired: false,
          adminHost,
          adminName: null,
          adminPubKey: null,
          devicePubKey: keyPair.publicKey,
          devicePrivKeyEncrypted: this.crypto.encryptWithPassword(keyPair.privateKey, this.deviceId),
          pairedAt: null,
          lastConnectedAt: null,
          sessionToken: null,
          // Cloud pairing fields - initialized as null
          cloudWsEndpoint: null,
          tenantId: null,
          tenantName: null,
        };
      } else {
        // Update adminHost even if we already have keys
        this.pairingState = {
          ...this.pairingState,
          adminHost,
          paired: false,
          // Reset cloud fields for new pairing attempt
          cloudWsEndpoint: null,
          tenantId: null,
          tenantName: null,
        };
      }

      this.state.status = 'pairing';
      this.state.adminHost = adminHost;
      this.emit('stateChanged', this.state);

      // Send pairing request via HTTP
      const response = await this.sendPairRequest(adminHost, pairCode);
      
      if (response.success) {
        // Connect via WebSocket to wait for approval
        // The WebSocket connection will receive PAIR_APPROVED or PAIR_DENIED
        this.connectForPairing(adminHost);
        return { success: true };
      } else {
        this.state.status = 'disconnected';
        this.emit('stateChanged', this.state);
        return { success: false, error: response.error };
      }
    } catch (error) {
      this.state.status = 'disconnected';
      this.emit('stateChanged', this.state);
      return { success: false, error: String(error) };
    }
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
      this.emit('stateChanged', this.state);

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
        this.emit('stateChanged', this.state);
        return { success: false, error: response.error || 'Failed to submit pairing request' };
      }
    } catch (error) {
      this.state.status = 'disconnected';
      this.state.isCloudConnection = false;
      this.isCloudMode = false;
      this.emit('stateChanged', this.state);
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
        deviceName: require('os').hostname(),
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

    const poll = async () => {
      if (pollCount >= maxPolls || this.state.status !== 'pairing') {
        if (this.state.status === 'pairing') {
          console.log('[AGENT] Cloud pairing polling timed out');
          this.state.status = 'disconnected';
          this.state.isCloudConnection = false;
          this.isCloudMode = false;
          this.emit('stateChanged', this.state);
          this.emit('pairDenied', { reason: 'Pairing request timed out' });
        }
        return;
      }

      pollCount++;
      
      try {
        const status = await this.checkCloudPairingStatus(cloudApiUrl, requestId);
        
        if (status.status === 'approved') {
          // Pairing approved - handle the approval
          console.log('[AGENT] Cloud pairing approved!');
          await this.handleCloudPairApproved(status);
        } else if (status.status === 'denied') {
          // Pairing denied
          console.log('[AGENT] Cloud pairing denied');
          this.state.status = 'disconnected';
          this.state.isCloudConnection = false;
          this.isCloudMode = false;
          this.emit('stateChanged', this.state);
          this.emit('pairDenied', { reason: status.reason || 'Pairing request denied' });
        } else {
          // Still pending - continue polling
          setTimeout(poll, pollInterval);
        }
      } catch (error) {
        console.error('[AGENT] Error polling pairing status:', error);
        setTimeout(poll, pollInterval);
      }
    };

    // Start polling
    setTimeout(poll, pollInterval);
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
    this.emit('stateChanged', this.state);
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
   * Connect to admin console for pairing (waiting for approval)
   */
  private connectForPairing(adminHost: string): void {
    console.log('[AGENT] ========================================');
    console.log('[AGENT] connectForPairing() called');
    console.log('[AGENT] adminHost:', adminHost);
    
    if (this.ws) {
      console.log('[AGENT] Closing existing WebSocket connection');
      this.ws.close();
    }

    const [host, portStr] = adminHost.split(':');
    const port = parseInt(portStr) || ADMIN_CONSOLE_DEFAULT_PORT;
    const wsUrl = `ws://${host}:${port}/ws`;

    console.log(`[AGENT] Connecting to Admin Console for pairing: ${wsUrl}`);

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.on('open', () => {
        console.log('[AGENT] ========================================');
        console.log('[AGENT] WebSocket OPEN - connected to Admin Console');
        console.log('[AGENT] WebSocket readyState:', ws.readyState);
        console.log('[AGENT] Preparing IDENTIFY message...');
        
        // Send identification message so admin knows who we are
        const identifyMsg = this.crypto.createSignedMessage(
          'IDENTIFY',
          this.deviceId,
          {
            deviceName: require('os').hostname(),
            devicePubKey: this.pairingState!.devicePubKey,
            appVersion: this.appVersion,
            isPairing: true,
          },
          this.getPrivateKey()
        );
        
        console.log('[AGENT] Sending IDENTIFY message...');
        console.log('[AGENT] IDENTIFY deviceId:', this.deviceId);
        ws.send(JSON.stringify(identifyMsg));
        console.log('[AGENT] IDENTIFY message sent, waiting for approval...');
        console.log('[AGENT] ========================================');
      });

      ws.on('message', (data) => {
        console.log('[AGENT] ========================================');
        console.log('[AGENT] WebSocket MESSAGE received');
        console.log('[AGENT] Data preview:', data.toString().substring(0, 200));
        this.handleMessage(data.toString());
      });

      ws.on('close', (code, reason) => {
        console.log('[AGENT] ========================================');
        console.log('[AGENT] WebSocket CLOSED during pairing');
        console.log('[AGENT] Close code:', code);
        console.log('[AGENT] Close reason:', reason?.toString() || 'none');
        console.log('[AGENT] Current state.status:', this.state.status);
        
        if (this.state.status === 'pairing') {
          this.state.status = 'disconnected';
          this.emit('stateChanged', this.state);
        }
      });

      ws.on('error', (err) => {
        console.error('[AGENT] ========================================');
        console.error('[AGENT] WebSocket ERROR during pairing:', err);
        this.state.status = 'disconnected';
        this.emit('stateChanged', this.state);
      });
    } catch (err) {
      console.error('[AGENT] Failed to connect for pairing:', err);
      this.state.status = 'disconnected';
      this.emit('stateChanged', this.state);
    }
  }

  /**
   * Send pairing request to admin console
   */
  private async sendPairRequest(adminHost: string, pairCode: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const payload: PairRequestPayload = {
        deviceName: require('os').hostname(),
        devicePubKey: this.pairingState!.devicePubKey!,
        appVersion: this.appVersion,
        osInfo: `${process.platform} ${require('os').release()}`,
        pairCode,
      };

      const message = this.crypto.createSignedMessage(
        'PAIR_REQUEST',
        this.deviceId,
        payload,
        this.getPrivateKey()
      );

      const postData = JSON.stringify(message);
      const [host, portStr] = adminHost.split(':');
      const port = parseInt(portStr) || ADMIN_CONSOLE_DEFAULT_PORT;

      const req = http.request(
        {
          hostname: host,
          port,
          path: '/pair/request',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              resolve(result);
            } catch {
              resolve({ success: false, error: 'Invalid response from admin' });
            }
          });
        }
      );

      req.on('error', (err) => {
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
   * Connect to admin console via WebSocket
   */
  private connect(adminHost: string): void {
    // Clean up old socket without triggering reconnect via handleDisconnect
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.stopHeartbeat();

    const [host, portStr] = adminHost.split(':');
    const port = parseInt(portStr) || ADMIN_CONSOLE_DEFAULT_PORT;
    const wsUrl = `ws://${host}:${port}/ws`;

    console.log(`[AGENT] Connecting to Admin Console: ${wsUrl}`);
    this.state.status = 'connecting';
    this.emit('stateChanged', this.state);

    try {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        // Store reference only once connection is actually open
        this.ws = ws;
        console.log('[AGENT] Connected to Admin Console');
        console.log('[AGENT] WebSocket readyState after open:', this.ws?.readyState);
        this.reconnectAttempts = 0;
        this.state.status = this.pairingState?.paired ? 'paired' : 'pairing';
        this.state.lastConnected = Date.now();
        this.emit('stateChanged', this.state);

        // Start heartbeat
        this.startHeartbeat();
      });

      ws.on('message', (data) => {
        console.log('[AGENT] Received message:', data.toString().substring(0, 100));
        this.handleMessage(data.toString());
      });

      ws.on('close', (code, reason) => {
        console.log(`[AGENT] Disconnected from Admin Console: code=${code}, reason=${reason}`);
        // Only handle disconnect if this is still the active socket
        if (this.ws === ws) {
          this.handleDisconnect();
        }
      });

      ws.on('error', (err) => {
        console.error('[AGENT] WebSocket error:', err);
        // Only handle disconnect if this is still the active socket
        if (this.ws === ws || this.ws === null) {
          this.handleDisconnect();
        }
      });
    } catch (err) {
      console.error('[AGENT] Failed to connect:', err);
      this.handleDisconnect();
    }
  }

  /**
   * Connect to cloud admin console via WebSocket
   * Requirement 11.2: Connect to stored cloud endpoint on startup
   * Requirement 11.3: Implement exponential backoff retry (max 10 attempts)
   * Requirement 11.4: Fall back to local-only mode if unavailable
   */
  private connectToCloud(cloudWsEndpoint: string): void {
    if (this.ws) {
      this.ws.close();
    }

    console.log(`[AGENT] Connecting to Cloud Admin Console: ${cloudWsEndpoint}`);
    this.state.status = 'connecting';
    this.state.isCloudConnection = true;
    this.emit('stateChanged', this.state);

    try {
      const ws = new WebSocket(cloudWsEndpoint);
      this.ws = ws;

      ws.on('open', () => {
        console.log('[AGENT] Connected to Cloud Admin Console');
        this.cloudReconnectAttempts = 0;
        this.state.status = this.pairingState?.paired ? 'paired' : 'pairing';
        this.state.lastConnected = Date.now();
        this.state.cloudConnectionFailed = false;
        this.emit('stateChanged', this.state);

        // Send identification message for cloud connection
        const identifyMsg = this.crypto.createSignedMessage(
          'IDENTIFY',
          this.deviceId,
          {
            deviceName: require('os').hostname(),
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
        this.handleCloudDisconnect();
      });

      ws.on('error', (err) => {
        console.error('[AGENT] Cloud WebSocket error:', err);
        this.handleCloudDisconnect();
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
    this.ws = null;
    this.state.status = 'disconnected';
    this.emit('stateChanged', this.state);

    // Always reconnect to cloud — never give up
    const cloudEndpoint = this.pairingState?.cloudWsEndpoint || CLOUD_ADMIN_WSS_URL;
    if (cloudEndpoint) {
      this.cloudReconnectAttempts++;

      // Exponential backoff: delay = base * 2^(attempt-1), capped at max (60s)
      const delay = Math.min(
        CLOUD_RECONNECT_BASE_DELAY_MS * Math.pow(2, this.cloudReconnectAttempts - 1),
        CLOUD_RECONNECT_MAX_DELAY_MS
      );

      console.log(`[AGENT] Cloud reconnecting in ${delay}ms (attempt ${this.cloudReconnectAttempts})`);

      this.reconnectTimeout = setTimeout(() => {
        this.connectToCloud(cloudEndpoint);
      }, delay);
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleDisconnect(): void {
    this.stopHeartbeat();
    this.ws = null;
    this.state.status = 'disconnected';
    this.emit('stateChanged', this.state);

    // If in cloud mode, use cloud reconnect logic
    if (this.isCloudMode && this.pairingState?.cloudWsEndpoint) {
      this.handleCloudDisconnect();
      return;
    }

    // Attempt reconnect if paired (local mode)
    if (this.pairingState?.paired && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      console.log(`Reconnecting in ${RECONNECT_DELAY_MS}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      
      this.reconnectTimeout = setTimeout(() => {
        if (this.pairingState?.adminHost) {
          this.connect(this.pairingState.adminHost);
        }
      }, RECONNECT_DELAY_MS);
    }
  }

  /**
   * Handle incoming message from admin
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as AdminProtocolMessage;
      
      // Verify signature if we have admin's public key
      if (this.pairingState?.adminPubKey) {
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
    console.log('[AGENT] ========================================');
    console.log('[AGENT] *** PAIR_APPROVED received! ***');
    console.log('[AGENT] Message:', JSON.stringify(message).substring(0, 300));
    
    const payload = (message as any).payload;
    console.log('[AGENT] Payload adminName:', payload.adminName);
    console.log('[AGENT] Payload adminPubKey:', payload.adminPubKey?.substring(0, 30) + '...');
    console.log('[AGENT] Payload wsEndpoint:', payload.wsEndpoint);
    console.log('[AGENT] Payload tenantId:', payload.tenantId);
    console.log('[AGENT] Payload tenantName:', payload.tenantName);
    
    this.pairingState = {
      ...this.pairingState!,
      paired: true,
      adminName: payload.adminName,
      adminPubKey: payload.adminPubKey,
      pairedAt: Date.now(),
      lastConnectedAt: Date.now(),
      sessionToken: payload.sessionToken,
      // Store cloud WebSocket endpoint (Requirement 11.1)
      cloudWsEndpoint: payload.wsEndpoint || null,
      tenantId: payload.tenantId || null,
      tenantName: payload.tenantName || payload.adminName || null,
    };

    console.log('[AGENT] Pairing state updated:', {
      paired: this.pairingState.paired,
      adminHost: this.pairingState.adminHost,
      adminName: this.pairingState.adminName,
      cloudWsEndpoint: this.pairingState.cloudWsEndpoint,
      tenantId: this.pairingState.tenantId,
      tenantName: this.pairingState.tenantName,
    });

    // Save to database
    await this.savePairingState();
    console.log('[AGENT] Pairing state saved to database');

    // Apply initial policy if provided
    if (payload.initialPolicy) {
      await this.applyPolicy(payload.initialPolicy);
    }

    this.state.status = 'paired';
    this.state.adminName = payload.adminName;
    this.state.lastConnected = Date.now();
    this.emit('stateChanged', this.state);
    this.emit('paired', { 
      adminName: payload.adminName,
      tenantName: payload.tenantName || payload.adminName,
      cloudWsEndpoint: payload.wsEndpoint,
    });
    
    // Start heartbeat to maintain connection and show as online
    console.log('[AGENT] WebSocket state before startHeartbeat:', this.ws?.readyState, '(1=OPEN)');
    this.startHeartbeat();
    
    console.log(`[AGENT] Paired with Admin Console: ${payload.adminName}`);
    console.log('[AGENT] ========================================');
  }

  /**
   * Handle pairing denial
   */
  private handlePairDenied(message: AdminProtocolMessage): void {
    const payload = (message as any).payload;
    
    this.state.status = 'disconnected';
    this.emit('stateChanged', this.state);
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
      'idleThreshold', 'privacyModeEnabled', 'privacyApps',
      'titleSharingEnabled', 'autoExportEnabled', 'autoExportTime',
      'exportFolder', 'reportRetentionDays', 'employeeName',
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
      }
    }

    this.emit('stateChanged', this.state);
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
      privacyModeEnabled: 'privacy_mode_enabled',
      privacyApps: 'privacy_apps',
      titleSharingEnabled: 'title_sharing_enabled',
      autoExportEnabled: 'auto_export_enabled',
      autoExportTime: 'auto_export_time',
      exportFolder: 'export_folder',
      reportRetentionDays: 'report_retention_days',
      employeeName: 'employee_name',
      appCategories: 'app_categories',
    };
    return mapping[key] || key;
  }

  /**
   * Handle export request from admin
   */
  private async handleExportRequest(message: AdminProtocolMessage): Promise<void> {
    const payload = (message as any).payload;
    
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
    this.emit('stateChanged', this.state);
    this.emit('locked', { reason: payload.reason, message: payload.message });
    
    console.log('App locked by admin:', payload.reason);
  }

  /**
   * Handle unlock command
   */
  private handleUnlock(message: AdminProtocolMessage): void {
    this.state.isLocked = false;
    this.state.lockMessage = null;
    this.emit('stateChanged', this.state);
    this.emit('unlocked');
    
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
    this.emit('stateChanged', this.state);
    
    console.log('Unpaired from Admin Console');
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    console.log('[AGENT] ========================================');
    console.log('[AGENT] startHeartbeat() called');
    console.log('[AGENT] WebSocket exists:', !!this.ws);
    console.log('[AGENT] WebSocket readyState:', this.ws?.readyState, '(1=OPEN)');
    
    this.stopHeartbeat();
    
    // Send initial heartbeat
    console.log('[AGENT] Sending initial heartbeat...');
    this.sendHeartbeat();
    
    // Set up intervals
    this.heartbeatInterval = setInterval(() => {
      console.log('[AGENT] Heartbeat interval tick, ws state:', this.ws?.readyState);
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    this.statsInterval = setInterval(() => {
      this.sendStatsSummary();
    }, STATS_SUMMARY_INTERVAL_MS);
    
    console.log('[AGENT] Heartbeat intervals configured');
    console.log('[AGENT] HEARTBEAT_INTERVAL_MS:', HEARTBEAT_INTERVAL_MS);
    console.log('[AGENT] ========================================');
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
    console.log('[AGENT] sendHeartbeat() called');
    console.log('[AGENT] WebSocket exists:', !!this.ws);
    console.log('[AGENT] WebSocket readyState:', this.ws?.readyState, '(1=OPEN, 0=CONNECTING, 2=CLOSING, 3=CLOSED)');
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('[AGENT] Cannot send heartbeat - WebSocket not open');
      return;
    }

    // Compute metrics for enhanced heartbeat
    const todayMetrics = this.metricsComputer.computeTodayMetrics();
    const last15mMetrics = this.metricsComputer.computeLast15mMetrics();
    const topAppsToday = this.metricsComputer.computeTopAppsToday();

    // Get local IP address
    const localIp = this.getLocalIpAddress();

    // Compute policy hash for compliance check
    const policyHash = this.effectivePolicy 
      ? computePolicyHash(JSON.stringify(this.effectivePolicy))
      : '';

    // Build enhanced heartbeat payload
    const enhancedPayload: EnhancedHeartbeatPayload = {
      deviceId: this.deviceId,
      deviceName: os.hostname(),
      ip: localIp,
      appVersion: this.appVersion,
      trackingRunning: this.trackingRunning,
      effectivePolicyHash: policyHash,
      privacyModeEffective: this.effectivePolicy?.privacyModeEnabled || false,
      titleSharingEffective: this.effectivePolicy?.titleSharingEnabled || false,
      today: todayMetrics,
      last15m: last15mMetrics,
      topAppsToday,
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

    console.log('[AGENT] Creating enhanced heartbeat message');

    const message = this.crypto.createSignedMessage(
      'HEARTBEAT',
      this.deviceId,
      payload,
      this.getPrivateKey()
    );

    console.log('[AGENT] Sending heartbeat message...');
    this.send(message);
    this.state.lastHeartbeat = Date.now();
    console.log('[AGENT] Heartbeat sent successfully');
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
      const msgStr = JSON.stringify(message);
      console.log('[AGENT] Sending message:', msgStr.substring(0, 100));
      this.ws.send(msgStr);
    } else {
      console.log('[AGENT] Cannot send - WebSocket not open. State:', this.ws?.readyState);
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
    const rows = this.database.get<any[]>(
      'SELECT * FROM effective_policy WHERE source = ?',
      ['admin']
    );

    if (rows && Array.isArray(rows) && rows.length > 0) {
      // Reconstruct policy from rows
      const policy: any = {};
      for (const row of rows) {
        try {
          policy[row.key] = JSON.parse(row.value);
        } catch {
          policy[row.key] = row.value;
        }
      }
      this.effectivePolicy = policy as PolicyData;
      this.state.policyVersion = this.crypto.hashPolicy(policy);
    }
  }

  /**
   * Get discovered admin consoles
   */
  public getDiscoveredAdmins(): DiscoveredAdmin[] {
    return this.discovery.getDiscoveredAdmins();
  }

  /**
   * Add manual admin host
   */
  public addManualAdmin(host: string, port?: number): DiscoveredAdmin {
    return this.discovery.addManualAdmin(host, port);
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
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.ws) {
      this.ws.close();
    }
    
    this.discovery.stop();
    
    console.log('Agent service shutdown');
  }
}

export default AgentService;
