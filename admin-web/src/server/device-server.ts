/**
 * Admin Console Server
 * HTTP + WebSocket server for managing ProduTime agents
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as dgram from 'dgram';
import * as os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import * as nacl from 'tweetnacl';
import { AdminDatabase } from './db';
import { DashboardService } from './dashboard-service';
import {
  AdminProtocolMessage,
  PairRequestPayload,
  HeartbeatPayload,
  StatsSummaryPayload,
  PolicyData,
  ADMIN_CONSOLE_DEFAULT_PORT,
  MDNS_SERVICE_TYPE,
  MDNS_SERVICE_NAME,
} from '../shared/admin-protocol';
import { EnhancedHeartbeatPayload } from '../shared/dashboard-types';

interface ConnectedDevice {
  ws: WebSocket;
  deviceId: string;
  devicePubKey: string;
  lastHeartbeat: number;
  ip: string;
}

interface PendingConnection {
  ws: WebSocket;
  deviceId: string;
  devicePubKey: string;
  ip: string;
}

export class AdminServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private db: AdminDatabase;
  private dashboardService: DashboardService;
  private connectedDevices: Map<string, ConnectedDevice> = new Map();
  private pendingConnections: Map<string, PendingConnection> = new Map(); // Devices waiting for pairing approval
  private adminKeyPair: { publicKey: string; privateKey: string } | null = null;
  private currentPairCode: string | null = null;
  private pairCodeExpiry: number = 0;
  private port: number;
  
  // mDNS advertising
  private mdnsSocket: dgram.Socket | null = null;
  private mdnsInterval: NodeJS.Timeout | null = null;
  private readonly MDNS_ADDRESS = '224.0.0.251';
  private readonly MDNS_PORT = 5353;

  // Log buffer for UI display
  private logBuffer: string[] = [];
  private readonly MAX_LOG_ENTRIES = 500;

  // 60s in-memory cache for Slack bot sales responses, keyed by "<uid>:<range>"
  private salesCache: Map<string, { at: number; body: any }> = new Map();

  // Event callbacks
  public onDeviceConnected?: (deviceId: string) => void;
  public onDeviceDisconnected?: (deviceId: string) => void;
  public onPairRequest?: (request: any) => void;
  public onStatsReceived?: (deviceId: string, stats: any) => void;
  public onExportResult?: (deviceId: string, result: any) => void;
  public onLog?: (message: string) => void;

  constructor(db: AdminDatabase, port: number = ADMIN_CONSOLE_DEFAULT_PORT) {
    this.db = db;
    this.port = port;
    this.dashboardService = new DashboardService(db);
    // Wire live connection truth into dashboard + performance services
    const getIds = () => this.getConnectedDevices();
    this.dashboardService.getConnectedDeviceIds = getIds;
    (this.dashboardService as any).performanceService.getConnectedDeviceIds = getIds;

    // Initialize or load admin keypair
    this.initializeKeypair();

    // Create HTTP server
    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws, req) => {
      this.handleWebSocketConnection(ws, req);
    });

    // Periodic cleanup
    setInterval(() => {
      this.cleanupStaleConnections();
      this.db.cleanupExpiredPairs();
    }, 30000);
  }

  /**
   * Log a message and store in buffer
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} ${message}`;
    console.log(message);
    
    this.logBuffer.push(logEntry);
    if (this.logBuffer.length > this.MAX_LOG_ENTRIES) {
      this.logBuffer.shift();
    }
    
    this.onLog?.(logEntry);
  }

  /**
   * Get recent logs
   */
  public getLogs(count: number = 100): string[] {
    return this.logBuffer.slice(-count);
  }

  /**
   * Initialize or load admin keypair
   */
  private initializeKeypair(): void {
    const existing = this.db.getAdminKeypair();

    if (existing) {
      try {
        // Load existing keypair
        this.adminKeyPair = {
          publicKey: existing.public_key,
          privateKey: this.decryptPrivateKey(existing.private_key_encrypted),
        };
        return;
      } catch (err) {
        // Decryption failed — machine identifiers changed (e.g. container redeployed
        // without ENCRYPTION_KEY). Regenerate the keypair.
        this.log(`[SERVER] Failed to decrypt stored keypair (machine changed?), regenerating: ${err}`);
      }
    }

    // Generate new keypair
    const keyPair = nacl.sign.keyPair();
    this.adminKeyPair = {
      publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
      privateKey: Buffer.from(keyPair.secretKey).toString('base64'),
    };

    // Store encrypted
    const encrypted = this.encryptPrivateKey(this.adminKeyPair.privateKey);
    this.db.setAdminKeypair(this.adminKeyPair.publicKey, encrypted);
  }

  /**
   * Derive encryption key. In web/cloud mode, uses ENCRYPTION_KEY env var.
   * Falls back to machine-specific derivation for local deployments.
   */
  private deriveEncryptionKey(): Buffer {
    if (process.env.ENCRYPTION_KEY) {
      // Cloud mode: use explicit env var
      const salt = 'produtime-admin-web:ed25519-key-encryption:v1';
      return crypto.pbkdf2Sync(process.env.ENCRYPTION_KEY, salt, 100000, 32, 'sha256');
    }
    // Local mode: derive from machine identifiers
    const machineId = [
      os.hostname(),
      os.userInfo().username,
      os.cpus()[0]?.model || 'unknown',
      os.homedir(),
    ].join('|');
    const salt = 'produtime-admin-console:ed25519-key-encryption:v2';
    return crypto.pbkdf2Sync(machineId, salt, 100000, 32, 'sha256');
  }

  /**
   * Encrypt private key for storage using AES-256-GCM with a
   * machine-specific key derived from multiple OS identifiers.
   */
  private encryptPrivateKey(privateKey: string): string {
    const key = this.deriveEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(privateKey, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  }

  private decryptPrivateKey(encrypted: string): string {
    const [ivB64, authTagB64, data] = encrypted.split(':');
    const key = this.deriveEncryptionKey();
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Start the server
   */
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log(`[SERVER] Starting server on port ${this.port}`);
      this.httpServer.listen(this.port, '0.0.0.0', () => {
        this.log(`[SERVER] Server started successfully on port ${this.port}`);
        this.log(`[SERVER] Waiting for client connections...`);
        console.log(`Admin Console server listening on port ${this.port}`);
        
        // Start mDNS advertising so clients can discover us
        this.startMdnsAdvertising();
        
        // Start exceptions engine
        this.dashboardService.startExceptionsEngine();
        
        resolve();
      });
      this.httpServer.on('error', (err) => {
        console.error('[SERVER] Server error:', err);
        reject(err);
      });
    });
  }

  /**
   * Stop the server
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      // Stop mDNS advertising
      this.stopMdnsAdvertising();
      
      // Stop exceptions engine
      this.dashboardService.stopExceptionsEngine();
      
      // Close all WebSocket connections
      for (const device of this.connectedDevices.values()) {
        device.ws.close();
      }
      this.connectedDevices.clear();

      this.wss.close(() => {
        this.httpServer.close(() => {
          resolve();
        });
      });
    });
  }

  /**
   * Start mDNS advertising to allow clients to discover this Admin Console
   */
  private startMdnsAdvertising(): void {
    try {
      this.mdnsSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      
      this.mdnsSocket.on('error', (err) => {
        console.error('[SERVER] mDNS socket error:', err);
      });

      this.mdnsSocket.bind(this.MDNS_PORT, () => {
        try {
          this.mdnsSocket?.addMembership(this.MDNS_ADDRESS);
          this.log('[SERVER] mDNS advertising started');
          
          // Listen for queries and respond
          this.mdnsSocket?.on('message', (msg, rinfo) => {
            this.handleMdnsQuery(msg, rinfo);
          });
          
          // Also send periodic announcements
          this.sendMdnsAnnouncement();
          this.mdnsInterval = setInterval(() => {
            this.sendMdnsAnnouncement();
          }, 10000); // Announce every 10 seconds
          
        } catch (err) {
          console.error('[SERVER] Failed to join mDNS multicast group:', err);
        }
      });
    } catch (err) {
      console.error('[SERVER] Failed to start mDNS advertising:', err);
    }
  }

  /**
   * Stop mDNS advertising
   */
  private stopMdnsAdvertising(): void {
    if (this.mdnsInterval) {
      clearInterval(this.mdnsInterval);
      this.mdnsInterval = null;
    }
    
    if (this.mdnsSocket) {
      try {
        this.mdnsSocket.dropMembership(this.MDNS_ADDRESS);
      } catch (err) {
        // Ignore
      }
      this.mdnsSocket.close();
      this.mdnsSocket = null;
    }
    
    this.log('[SERVER] mDNS advertising stopped');
  }

  /**
   * Handle incoming mDNS query
   */
  private handleMdnsQuery(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      // Check if this is a query for our service
      const msgStr = msg.toString('utf8', 12);
      if (msgStr.includes('produtime-admin') || msgStr.includes('_tcp')) {
        // Respond with our presence
        this.sendMdnsResponse(rinfo.address, rinfo.port);
      }
    } catch (err) {
      // Ignore parsing errors
    }
  }

  /**
   * Send mDNS announcement (unsolicited response)
   */
  private sendMdnsAnnouncement(): void {
    if (!this.mdnsSocket) return;
    
    const response = this.buildMdnsResponse();
    this.mdnsSocket.send(response, 0, response.length, this.MDNS_PORT, this.MDNS_ADDRESS, (err) => {
      if (err) {
        console.error('[SERVER] Failed to send mDNS announcement:', err);
      }
    });
  }

  /**
   * Send mDNS response to a specific address
   */
  private sendMdnsResponse(address: string, port: number): void {
    if (!this.mdnsSocket) return;
    
    const response = this.buildMdnsResponse();
    this.mdnsSocket.send(response, 0, response.length, port, address, (err) => {
      if (err) {
        console.error('[SERVER] Failed to send mDNS response:', err);
      }
    });
  }

  /**
   * Build mDNS response packet advertising our service
   */
  private buildMdnsResponse(): Buffer {
    // Get local IP addresses
    const localIPs = this.getLocalIPs();
    const hostname = os.hostname();
    
    // Build a simple mDNS response
    // DNS header - response with authoritative answer
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0, 0);        // Transaction ID
    header.writeUInt16BE(0x8400, 2);   // Flags: response, authoritative
    header.writeUInt16BE(0, 4);        // Questions: 0
    header.writeUInt16BE(1, 6);        // Answer RRs: 1
    header.writeUInt16BE(0, 8);        // Authority RRs: 0
    header.writeUInt16BE(localIPs.length, 10);  // Additional RRs: IP addresses

    // Answer section - PTR record for service
    const serviceName = MDNS_SERVICE_TYPE + '.local';
    const instanceName = MDNS_SERVICE_NAME + '.' + serviceName;
    
    // Encode service name
    const nameBuffer = this.encodeDnsName(serviceName);
    
    // PTR record pointing to our instance
    const ptrRecord = Buffer.alloc(10);
    ptrRecord.writeUInt16BE(12, 0);    // Type: PTR
    ptrRecord.writeUInt16BE(1, 2);     // Class: IN
    ptrRecord.writeUInt32BE(120, 4);   // TTL: 120 seconds
    
    const instanceBuffer = this.encodeDnsName(instanceName);
    ptrRecord.writeUInt16BE(instanceBuffer.length, 8);  // Data length
    
    // Additional records - A records for IP addresses
    const additionalRecords: Buffer[] = [];
    for (const ip of localIPs) {
      const hostBuffer = this.encodeDnsName(hostname + '.local');
      const aRecord = Buffer.alloc(10);
      aRecord.writeUInt16BE(1, 0);     // Type: A
      aRecord.writeUInt16BE(1, 2);     // Class: IN
      aRecord.writeUInt32BE(120, 4);   // TTL: 120 seconds
      aRecord.writeUInt16BE(4, 8);     // Data length: 4 bytes for IPv4
      
      const ipParts = ip.split('.').map(p => parseInt(p));
      const ipBuffer = Buffer.from(ipParts);
      
      additionalRecords.push(Buffer.concat([hostBuffer, aRecord, ipBuffer]));
    }

    // Also include TXT record with port info
    const txtData = `port=${this.port}`;
    const txtBuffer = Buffer.alloc(1 + txtData.length);
    txtBuffer.writeUInt8(txtData.length, 0);
    txtBuffer.write(txtData, 1);

    return Buffer.concat([
      header,
      nameBuffer,
      ptrRecord,
      instanceBuffer,
      ...additionalRecords,
    ]);
  }

  /**
   * Encode a DNS name (e.g., "_produtime-admin._tcp.local")
   */
  private encodeDnsName(name: string): Buffer {
    const parts = name.split('.');
    const buffers: Buffer[] = [];
    
    for (const part of parts) {
      const len = Buffer.alloc(1);
      len.writeUInt8(part.length, 0);
      buffers.push(len);
      buffers.push(Buffer.from(part));
    }
    buffers.push(Buffer.from([0])); // Null terminator
    
    return Buffer.concat(buffers);
  }

  /**
   * Get local IPv4 addresses
   */
  private getLocalIPs(): string[] {
    const interfaces = os.networkInterfaces();
    const ips: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;

      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) {
          ips.push(info.address);
        }
      }
    }

    return ips;
  }

  /**
   * Handle HTTP requests
   */
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers for local network
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url || '/';

    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
      return;
    }

    if (url === '/pair/request' && req.method === 'POST') {
      this.handlePairRequest(req, res);
      return;
    }

    if (url === '/info' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'ProduTime Admin Console',
        publicKey: this.adminKeyPair?.publicKey,
        port: this.port,
      }));
      return;
    }

    if (url === '/debug' && req.method === 'GET') {
      const connectedDevices = Array.from(this.connectedDevices.entries()).map(([id, d]) => ({
        deviceId: id,
        ip: d.ip,
        lastHeartbeat: d.lastHeartbeat,
        timeSinceHeartbeat: Date.now() - d.lastHeartbeat,
      }));
      const pendingConnections = Array.from(this.pendingConnections.keys());
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        connectedDevices,
        pendingConnections,
        currentPairCode: this.currentPairCode,
        pairCodeExpiry: this.pairCodeExpiry,
      }, null, 2));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * Handle pairing request
   */
  private handlePairRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.log('[SERVER] ========================================');
    this.log('[SERVER] HTTP POST /pair/request received');
    this.log(`[SERVER] Remote address: ${req.socket.remoteAddress}`);
    
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        this.log(`[SERVER] Request body length: ${body.length}`);
        this.log(`[SERVER] Request body preview: ${body.substring(0, 300)}`);
        
        const message = JSON.parse(body) as AdminProtocolMessage;
        
        if (message.type !== 'PAIR_REQUEST') {
          this.log(`[SERVER] ERROR: Invalid message type: ${message.type}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid message type' }));
          return;
        }

        const payload = (message as any).payload as PairRequestPayload;
        this.log('[SERVER] Pair request details:');
        this.log(`[SERVER]   deviceId: ${message.deviceId}`);
        this.log(`[SERVER]   deviceName: ${payload.deviceName}`);
        this.log(`[SERVER]   pairCode: ${payload.pairCode}`);
        this.log(`[SERVER]   appVersion: ${payload.appVersion}`);

        // Verify pair code
        this.log(`[SERVER] Current pair code: ${this.currentPairCode}`);
        this.log(`[SERVER] Pair code expiry: ${this.pairCodeExpiry} now: ${Date.now()}`);
        
        if (!this.currentPairCode || Date.now() > this.pairCodeExpiry) {
          this.log('[SERVER] ERROR: No active pair code or expired');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No active pair code' }));
          return;
        }

        if (payload.pairCode !== this.currentPairCode) {
          this.log('[SERVER] ERROR: Pair code mismatch');
          this.log(`[SERVER]   received: ${payload.pairCode}`);
          this.log(`[SERVER]   expected: ${this.currentPairCode}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid pair code' }));
          return;
        }

        // Store pending pair request
        const requestId = crypto.randomUUID();
        const ip = req.socket.remoteAddress || 'unknown';
        this.log('[SERVER] Creating pending pair request:');
        this.log(`[SERVER]   requestId: ${requestId}`);
        this.log(`[SERVER]   ip: ${ip}`);

        this.db.insertPendingPair({
          request_id: requestId,
          device_id: message.deviceId,
          device_name: payload.deviceName,
          device_pubkey: payload.devicePubKey,
          app_version: payload.appVersion,
          os_info: payload.osInfo,
          ip,
          pair_code: payload.pairCode,
          requested_at: Date.now(),
          expires_at: Date.now() + 300000, // 5 minutes
        });

        // Notify UI
        this.log('[SERVER] Notifying UI of pair request');
        this.onPairRequest?.({
          requestId,
          deviceId: message.deviceId,
          deviceName: payload.deviceName,
          appVersion: payload.appVersion,
          osInfo: payload.osInfo,
          ip,
        });

        // Clear pair code after use
        this.currentPairCode = null;

        this.log(`[SERVER] Pair request accepted, requestId: ${requestId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, requestId }));
      } catch (error) {
        this.log(`[SERVER] Error handling pair request: ${error}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
      }
    });
  }

  /**
   * Handle WebSocket connection
   */
  private handleWebSocketConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const ip = req.socket.remoteAddress || 'unknown';
    let deviceId: string | null = null;

    this.log(`[SERVER] ========================================`);
    this.log(`[SERVER] New WebSocket connection from ${ip}`);
    this.log(`[SERVER] WebSocket readyState: ${ws.readyState}`);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as any; // Use any to handle IDENTIFY
        this.log(`[SERVER] ========================================`);
        this.log(`[SERVER] WebSocket MESSAGE received`);
        this.log(`[SERVER] message.type=${message.type}`);
        this.log(`[SERVER] message.deviceId=${message.deviceId}`);
        this.log(`[SERVER] closure deviceId=${deviceId}`);
        
        // Handle IDENTIFY message (device connecting for pairing or reconnecting)
        if (message.type === 'IDENTIFY') {
          deviceId = message.deviceId;
          const payload = message.payload;
          this.log(`[SERVER] *** IDENTIFY received ***`);
          this.log(`[SERVER] Setting deviceId=${deviceId}`);
          this.log(`[SERVER] isPairing=${payload.isPairing}`);
          this.log(`[SERVER] devicePubKey=${payload.devicePubKey?.substring(0, 20)}...`);

          if (payload.isPairing) {
            // Device is waiting for pairing approval
            this.pendingConnections.set(deviceId!, {
              ws,
              deviceId: deviceId!,
              devicePubKey: payload.devicePubKey,
              ip,
            });
            this.log(`[SERVER] Device ${deviceId} added to pendingConnections`);

            // Keep the connection alive
            const pingInterval = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
              } else {
                clearInterval(pingInterval);
              }
            }, 15000);

            this.log(`[SERVER] Returning after IDENTIFY (isPairing=true)`);
            return;
          }

          // Not pairing — check if device exists in DB
          let device = this.db.getDevice(deviceId!);

          if (!device) {
            // AUTO-REGISTER: unknown device — register automatically (TOFU)
            const deviceName = payload.deviceName || deviceId;
            const devicePubKey = payload.devicePubKey || '';
            const appVersion = payload.appVersion || 'unknown';

            this.log(`[SERVER] Auto-registering new device: ${deviceId} (${deviceName})`);

            this.db.insertDevice({
              device_id: deviceId!,
              device_name: deviceName,
              device_pubkey: devicePubKey,
              paired_at: Date.now(),
              last_seen: Date.now(),
              app_version: appVersion,
              ip,
            });

            this.db.insertAuditLog({
              action: 'AUTO_REGISTERED',
              device_id: deviceId!,
              details: `Auto-registered device ${deviceName} from ${ip}`,
              timestamp: Date.now(),
              admin_user: 'system',
            });

            // Send PAIR_APPROVED so the agent transitions to paired state
            const publicUrl = process.env.RAILWAY_PUBLIC_DOMAIN
              ? `wss://${process.env.RAILWAY_PUBLIC_DOMAIN}`
              : null;

            const approvalMessage = this.signMessage('PAIR_APPROVED', deviceId!, {
              adminName: 'ProduTime Admin Console',
              adminPubKey: this.adminKeyPair?.publicKey,
              sessionToken: crypto.randomUUID(),
              initialPolicy: null,
              wsEndpoint: publicUrl,
            });

            try {
              ws.send(JSON.stringify(approvalMessage));
              this.log(`[SERVER] Sent PAIR_APPROVED (auto-register) to ${deviceId}`);
            } catch (err) {
              this.log(`[SERVER] Failed to send PAIR_APPROVED: ${err}`);
            }

            device = this.db.getDevice(deviceId!);
          }

          // Close old connection for this device if it exists (prevents flickering)
          const oldConn = this.connectedDevices.get(deviceId!);
          if (oldConn && oldConn.ws !== ws) {
            this.log(`[SERVER] Closing stale WebSocket for ${deviceId}`);
            try { oldConn.ws.removeAllListeners(); oldConn.ws.close(); } catch {}
          }

          // Register in connectedDevices
          this.connectedDevices.set(deviceId!, {
            ws,
            deviceId: deviceId!,
            devicePubKey: device?.device_pubkey || payload.devicePubKey || '',
            lastHeartbeat: Date.now(),
            ip,
          });
          this.log(`[SERVER] Device ${deviceId} registered in connectedDevices`);

          // Always send PAIR_APPROVED with current admin public key so the
          // agent has the latest key (handles server keypair regeneration)
          const publicUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `wss://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null;
          const welcomeMsg = this.signMessage('PAIR_APPROVED', deviceId!, {
            adminName: 'ProduTime Admin Console',
            adminPubKey: this.adminKeyPair?.publicKey,
            sessionToken: crypto.randomUUID(),
            initialPolicy: null,
            wsEndpoint: publicUrl,
          });
          try {
            ws.send(JSON.stringify(welcomeMsg));
            this.log(`[SERVER] Sent PAIR_APPROVED (key refresh) to ${deviceId}`);
          } catch (err) {
            this.log(`[SERVER] Failed to send PAIR_APPROVED: ${err}`);
          }

          this.db.updateDeviceStatus(deviceId!, 'online', Date.now());
          this.onDeviceConnected?.(deviceId!);
          // Fall through to handle any subsequent messages
        }
        
        // Check if device is in connectedDevices (either already paired or just approved)
        // This check must be dynamic - don't use a closure variable
        const isConnected = deviceId && this.connectedDevices.has(deviceId);
        const isPending = deviceId && this.pendingConnections.has(deviceId);
        
        // Route message to handler if connected
        
        // Fallback: first message without prior IDENTIFY (shouldn't happen normally)
        if (!deviceId) {
          deviceId = message.deviceId;
          this.log(`[SERVER] First message without IDENTIFY from ${deviceId}, closing`);
          ws.close(4001, 'Send IDENTIFY first');
          return;
        }

        // Handle message if device is connected (approved)
        // Re-check connectedDevices since it may have been updated by approvePairing
        if (deviceId && this.connectedDevices.has(deviceId)) {
          this.log(`[SERVER] Routing message type=${message.type} from ${deviceId} to handleDeviceMessage`);
          this.handleDeviceMessage(deviceId, message as AdminProtocolMessage);
        } else if (isPending) {
          this.log(`[SERVER] Device ${deviceId} still pending approval, ignoring message type=${message.type}`);
        }
      } catch (error) {
        this.log(`[SERVER] WebSocket message error: ${error}`);
      }
    });

    ws.on('close', (code, reason) => {
      this.log(`[SERVER] ========================================`);
      this.log(`[SERVER] WebSocket CLOSED for device ${deviceId || 'unknown'}`);
      this.log(`[SERVER] Close code: ${code}, reason: ${reason?.toString() || 'none'}`);
      
      if (deviceId) {
        if (this.pendingConnections.has(deviceId)) {
          const pending = this.pendingConnections.get(deviceId);
          if (pending?.ws === ws) {
            this.pendingConnections.delete(deviceId);
            this.log(`[SERVER] Removed ${deviceId} from pendingConnections`);
          }
        } else if (this.connectedDevices.has(deviceId)) {
          const connected = this.connectedDevices.get(deviceId);
          // Only remove if this is the CURRENT socket (not a stale replaced one)
          if (connected?.ws === ws) {
            this.connectedDevices.delete(deviceId);
            this.db.updateDeviceStatus(deviceId, 'offline');
            this.onDeviceDisconnected?.(deviceId);
            this.log(`[SERVER] Removed ${deviceId} from connectedDevices`);
          } else {
            this.log(`[SERVER] Stale socket closed for ${deviceId}, ignoring (new connection active)`);
          }
        }
      }
    });

    ws.on('error', (error) => {
      this.log(`[SERVER] WebSocket error: ${error}`);
    });
  }

  /**
   * Handle message from device
   */
  private handleDeviceMessage(deviceId: string, message: AdminProtocolMessage): void {
    this.log(`[SERVER] handleDeviceMessage called for ${deviceId}, type=${message.type}`);
    
    const device = this.connectedDevices.get(deviceId);
    if (!device) {
      this.log(`[SERVER] ERROR: Device ${deviceId} not in connectedDevices!`);
      return;
    }

    // Verify signature
    const dbDevice = this.db.getDevice(deviceId);
    if (!dbDevice) {
      this.log(`[SERVER] ERROR: Device ${deviceId} not found in database!`);
      return;
    }
    
    this.log(`[SERVER] Verifying signature for ${deviceId}...`);
    if (!this.verifyMessage(message, dbDevice.device_pubkey)) {
      this.log(`[SERVER] ERROR: Invalid message signature from device: ${deviceId}`);
      return;
    }
    this.log(`[SERVER] Signature verified for ${deviceId}`);

    switch (message.type) {
      case 'HEARTBEAT':
        this.handleHeartbeat(deviceId, (message as any).payload as HeartbeatPayload);
        break;
      case 'STATS_SUMMARY':
        this.handleStatsSummary(deviceId, (message as any).payload as StatsSummaryPayload);
        break;
      case 'EXPORT_RESULT':
        this.handleExportResult(deviceId, (message as any).payload);
        break;
      case 'SALES_REQUEST':
        this.handleSalesRequest(deviceId, (message as any).payload);
        break;
      case 'ACK':
        // Handle acknowledgment
        break;
    }
  }

  /**
   * Proxy a device's sales request to the internal Slack-bot endpoint.
   * The device must have a slack_user_id assigned by the admin; otherwise
   * we return { unconfigured: true } so the client can show an empty state.
   */
  private async handleSalesRequest(
    deviceId: string,
    payload: { requestId: string; range: 'day' | 'week' | 'month' }
  ): Promise<void> {
    const range = (['day', 'week', 'month'] as const).includes(payload?.range as any)
      ? (payload.range as 'day' | 'week' | 'month')
      : 'week';
    const requestId = payload?.requestId || '';

    const reply = (response: any) => {
      const device = this.connectedDevices.get(deviceId);
      if (!device) return;
      const msg = this.signMessage('SALES_RESPONSE', deviceId, { requestId, ...response });
      try { device.ws.send(JSON.stringify(msg)); } catch {}
    };

    const row = this.db.getDevice(deviceId);
    const uid = (row as any)?.slack_user_id;
    if (!uid || !String(uid).trim()) {
      reply({ unconfigured: true });
      return;
    }

    const botUrl = process.env.SLACK_BOT_INTERNAL_URL;
    const apiKey = process.env.INTERNAL_API_KEY;
    if (!botUrl || !apiKey) {
      this.log('[SERVER] SALES_REQUEST: SLACK_BOT_INTERNAL_URL or INTERNAL_API_KEY not configured');
      reply({ unavailable: true, error: 'server_misconfigured' });
      return;
    }

    const cacheKey = `${uid}:${range}`;
    const cached = this.salesCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 60_000) {
      reply(cached.body);
      return;
    }

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 5000);
      const url = `${botUrl.replace(/\/$/, '')}/internal/sales/${encodeURIComponent(String(uid))}?range=${range}`;
      const res = await fetch(url, {
        headers: { 'X-Internal-Api-Key': apiKey },
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        reply({ unavailable: true });
        return;
      }
      const body = await res.json();
      this.salesCache.set(cacheKey, { at: Date.now(), body });
      reply(body);
    } catch (e) {
      this.log(`[SERVER] SALES_REQUEST: bot unreachable: ${e}`);
      reply({ unavailable: true });
    }
  }

  /**
   * Handle heartbeat from device
   */
  private handleHeartbeat(deviceId: string, payload: HeartbeatPayload & { enhanced?: EnhancedHeartbeatPayload }): void {
    const device = this.connectedDevices.get(deviceId);
    if (device) {
      device.lastHeartbeat = Date.now();
    }

    const updateInfo: any = {
      last_seen: Date.now(),
      status: 'online',
      app_version: payload.appVersion,
    };
    if (payload.enhanced?.deviceName) {
      updateInfo.device_name = payload.enhanced.deviceName;
    }
    this.db.updateDeviceInfo(deviceId, updateInfo);

    if (payload.enhanced) {
      this.dashboardService.ingestHeartbeat(payload.enhanced);
    } else {
      this.db.updateDeviceStats(deviceId, 0, 0);
    }
  }

  /**
   * Handle stats summary from device
   */
  private handleStatsSummary(deviceId: string, payload: StatsSummaryPayload): void {
    if (payload.period === 'today') {
      this.db.updateDeviceStats(deviceId, payload.totalActiveSeconds, payload.totalIdleSeconds);
    }
    this.onStatsReceived?.(deviceId, payload);
  }

  private handleExportResult(deviceId: string, payload: any): void {
    this.log(`[SERVER] Export result from ${deviceId}: success=${payload?.success}`);
    const device = this.db.getDevice(deviceId);
    const deviceName = device?.device_name || deviceId;
    this.db.insertAuditLog({
      action: 'export_completed',
      device_id: deviceId,
      details: `Export ${payload?.success ? 'completed' : 'failed'} on ${deviceName}${payload?.filePath ? ': ' + payload.filePath : ''}${payload?.error ? ' — ' + payload.error : ''}`,
      timestamp: Date.now(),
      admin_user: 'system',
    });
    this.onExportResult?.(deviceId, payload);
  }

  /**
   * Verify message signature
   */
  private verifyMessage(message: AdminProtocolMessage, publicKeyBase64: string): boolean {
    try {
      const { type, ts, nonce, deviceId, signature, ...rest } = message;
      const payload = (rest as any).payload;
      
      const signable = JSON.stringify({ type, ts, nonce, deviceId, payload });
      const messageBytes = new Uint8Array(Buffer.from(signable, 'utf-8'));
      const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
      const publicKey = new Uint8Array(Buffer.from(publicKeyBase64, 'base64'));

      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
    } catch {
      return false;
    }
  }

  /**
   * Sign a message
   */
  private signMessage(type: string, deviceId: string, payload: any): AdminProtocolMessage {
    const ts = Date.now();
    const nonce = crypto.randomBytes(16).toString('hex');
    
    const signable = JSON.stringify({ type, ts, nonce, deviceId, payload });
    const messageBytes = new Uint8Array(Buffer.from(signable, 'utf-8'));
    const privateKey = new Uint8Array(Buffer.from(this.adminKeyPair!.privateKey, 'base64'));
    const signature = nacl.sign.detached(messageBytes, privateKey);

    return {
      type: type as any,
      ts,
      nonce,
      deviceId,
      signature: Buffer.from(signature).toString('base64'),
      payload,
    } as any;
  }

  /**
   * Generate a new pair code
   */
  public generatePairCode(): string {
    const bytes = crypto.randomBytes(3);
    const num = bytes.readUIntBE(0, 3) % 1000000;
    this.currentPairCode = num.toString().padStart(6, '0');
    this.pairCodeExpiry = Date.now() + 300000; // 5 minutes
    return this.currentPairCode;
  }

  /**
   * Get current pair code
   */
  public getCurrentPairCode(): { code: string; expiresAt: number } | null {
    if (!this.currentPairCode || Date.now() > this.pairCodeExpiry) {
      return null;
    }
    return { code: this.currentPairCode, expiresAt: this.pairCodeExpiry };
  }

  /**
   * Approve pairing request
   */
  public approvePairing(requestId: string): boolean {
    this.log(`[SERVER] ========================================`);
    this.log(`[SERVER] approvePairing called for requestId: ${requestId}`);
    this.log(`[SERVER] Current pendingConnections size: ${this.pendingConnections.size}`);
    this.log(`[SERVER] Current pendingConnections keys: [${Array.from(this.pendingConnections.keys()).join(', ')}]`);
    
    const pending = this.db.getPendingPair(requestId);
    if (!pending) {
      this.log(`[SERVER] ERROR: No pending pair found in DB for requestId: ${requestId}`);
      return false;
    }

    this.log(`[SERVER] Found pending pair in DB:`);
    this.log(`[SERVER]   device_id: ${pending.device_id}`);
    this.log(`[SERVER]   device_name: ${pending.device_name}`);
    this.log(`[SERVER]   ip: ${pending.ip}`);

    // Add device to database
    this.db.insertDevice({
      device_id: pending.device_id,
      device_name: pending.device_name,
      device_pubkey: pending.device_pubkey,
      paired_at: Date.now(),
      last_seen: Date.now(),
      app_version: pending.app_version,
      ip: pending.ip,
    });

    // Remove pending request
    this.db.deletePendingPair(requestId);

    // Log action
    this.db.insertAuditLog({
      action: 'PAIR_APPROVED',
      device_id: pending.device_id,
      details: `Approved pairing for ${pending.device_name}`,
      timestamp: Date.now(),
      admin_user: 'admin',
    });

    // Send PAIR_APPROVED to the waiting device
    const pendingConn = this.pendingConnections.get(pending.device_id);
    this.log(`[SERVER] Looking for WebSocket connection for device: ${pending.device_id}`);
    this.log(`[SERVER] pendingConnections.has(${pending.device_id}): ${this.pendingConnections.has(pending.device_id)}`);
    
    if (pendingConn) {
      this.log(`[SERVER] Found pending WebSocket connection!`);
      this.log(`[SERVER] WebSocket readyState: ${pendingConn.ws.readyState} (1=OPEN)`);
      
      // Include wsEndpoint so devices can reconnect via the cloud/public URL
      const publicUrl = process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN
        ? `wss://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : null;

      const approvalMessage = this.signMessage('PAIR_APPROVED', pending.device_id, {
        adminName: 'ProduTime Admin Console',
        adminPubKey: this.adminKeyPair?.publicKey,
        sessionToken: crypto.randomUUID(),
        initialPolicy: null,
        wsEndpoint: publicUrl,
      });
      
      try {
        this.log(`[SERVER] Sending PAIR_APPROVED message...`);
        pendingConn.ws.send(JSON.stringify(approvalMessage));
        this.log(`[SERVER] PAIR_APPROVED sent successfully to device ${pending.device_id}`);
        
        // Move from pending to connected
        this.pendingConnections.delete(pending.device_id);
        this.connectedDevices.set(pending.device_id, {
          ws: pendingConn.ws,
          deviceId: pending.device_id,
          devicePubKey: pending.device_pubkey,
          lastHeartbeat: Date.now(),
          ip: pendingConn.ip,
        });
        
        this.log(`[SERVER] Moved device ${pending.device_id} to connectedDevices`);
        this.log(`[SERVER] connectedDevices size: ${this.connectedDevices.size}`);
        this.log(`[SERVER] connectedDevices keys: [${Array.from(this.connectedDevices.keys()).join(', ')}]`);
        
        // Update status and notify
        this.db.updateDeviceStatus(pending.device_id, 'online', Date.now());
        this.log(`[SERVER] Calling onDeviceConnected callback...`);
        this.onDeviceConnected?.(pending.device_id);
        this.log(`[SERVER] onDeviceConnected callback completed`);
      } catch (err) {
        this.log(`[SERVER] ERROR: Failed to send PAIR_APPROVED: ${err}`);
      }
    } else {
      this.log(`[SERVER] WARNING: No pending WebSocket connection found for device ${pending.device_id}`);
      this.log(`[SERVER] This means the device's WebSocket disconnected before approval`);
      this.log(`[SERVER] The device will need to reconnect after pairing is approved`);
    }

    return true;
  }

  /**
   * Deny pairing request
   */
  public denyPairing(requestId: string): boolean {
    const pending = this.db.getPendingPair(requestId);
    if (!pending) return false;

    this.db.deletePendingPair(requestId);

    this.db.insertAuditLog({
      action: 'PAIR_DENIED',
      device_id: pending.device_id,
      details: `Denied pairing for ${pending.device_name}`,
      timestamp: Date.now(),
      admin_user: 'admin',
    });

    // Send PAIR_DENIED to the waiting device
    const pendingConn = this.pendingConnections.get(pending.device_id);
    if (pendingConn) {
      const denyMessage = this.signMessage('PAIR_DENIED', pending.device_id, {
        reason: 'Pairing request was denied by administrator',
      });
      
      try {
        pendingConn.ws.send(JSON.stringify(denyMessage));
        pendingConn.ws.close();
        this.pendingConnections.delete(pending.device_id);
        this.log(`[SERVER] Sent PAIR_DENIED to device ${pending.device_id}`);
      } catch (err) {
        this.log(`[SERVER] Failed to send PAIR_DENIED: ${err}`);
      }
    }

    return true;
  }

  /**
   * Push policy to device
   */
  public pushPolicy(deviceId: string, policy: PolicyData): boolean {
    const device = this.connectedDevices.get(deviceId);
    if (!device) return false;

    // Merge app categories into the policy before sending
    const allCategories = this.db.getAllAppCategories();
    const appCategories: Record<string, string> = {};
    for (const cat of allCategories) {
      appCategories[cat.app_name] = cat.category;
    }
    const policyWithCategories = { ...policy, appCategories };

    const message = this.signMessage('POLICY_PUSH', deviceId, { policy: policyWithCategories, force: false });
    try {
      device.ws.send(JSON.stringify(message));
    } catch (err) {
      this.log(`[SERVER] Failed to send POLICY_PUSH to ${deviceId}: ${err}`);
      return false;
    }

    this.db.insertAuditLog({
      action: 'POLICY_PUSH',
      device_id: deviceId,
      details: `Pushed policy ${policy.version}`,
      timestamp: Date.now(),
      admin_user: 'admin',
    });

    return true;
  }

  /**
   * Request export from device
   */
  public requestExport(deviceId: string, options: any): boolean {
    const device = this.connectedDevices.get(deviceId);
    if (!device) return false;

    const message = this.signMessage('EXPORT_REQUEST', deviceId, options);
    try {
      device.ws.send(JSON.stringify(message));
    } catch (err) {
      this.log(`[SERVER] Failed to send EXPORT_REQUEST to ${deviceId}: ${err}`);
      return false;
    }
    return true;
  }

  /**
   * Lock device
   */
  public lockDevice(deviceId: string, reason: string, message: string): boolean {
    const device = this.connectedDevices.get(deviceId);
    if (!device) return false;

    const msg = this.signMessage('LOCK', deviceId, { reason, message });
    try {
      device.ws.send(JSON.stringify(msg));
    } catch (err) {
      this.log(`[SERVER] Failed to send LOCK to ${deviceId}: ${err}`);
      return false;
    }

    this.db.insertAuditLog({
      action: 'DEVICE_LOCKED',
      device_id: deviceId,
      details: reason,
      timestamp: Date.now(),
      admin_user: 'admin',
    });

    return true;
  }

  /**
   * Unlock device
   */
  public unlockDevice(deviceId: string): boolean {
    const device = this.connectedDevices.get(deviceId);
    if (!device) return false;

    const message = this.signMessage('UNLOCK', deviceId, {});
    try {
      device.ws.send(JSON.stringify(message));
    } catch (err) {
      this.log(`[SERVER] Failed to send UNLOCK to ${deviceId}: ${err}`);
      return false;
    }

    this.db.insertAuditLog({
      action: 'DEVICE_UNLOCKED',
      device_id: deviceId,
      details: 'Device unlocked',
      timestamp: Date.now(),
      admin_user: 'admin',
    });

    return true;
  }

  /**
   * Cleanup stale connections
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    for (const [deviceId, device] of this.connectedDevices.entries()) {
      const timeSinceHeartbeat = now - device.lastHeartbeat;
      if (timeSinceHeartbeat > staleThreshold) {
        this.log(`[SERVER] Removing stale device ${deviceId} - no heartbeat for ${timeSinceHeartbeat}ms`);
        device.ws.close();
        this.connectedDevices.delete(deviceId);
        this.db.updateDeviceStatus(deviceId, 'offline');
        this.onDeviceDisconnected?.(deviceId);
      }
    }
  }

  /**
   * Get connected devices
   */
  public getConnectedDevices(): string[] {
    return Array.from(this.connectedDevices.keys());
  }

  /**
   * Get admin public key
   */
  public getAdminPublicKey(): string {
    return this.adminKeyPair?.publicKey || '';
  }

  /**
   * Get server port
   */
  public getPort(): number {
    return this.port;
  }

  /**
   * Get dashboard service for API access
   */
  public getDashboardService(): DashboardService {
    return this.dashboardService;
  }
}

