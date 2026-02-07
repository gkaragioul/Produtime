/**
 * Agent Discovery Service
 * mDNS/Bonjour discovery for finding Admin Console on LAN
 * Falls back to manual IP entry if mDNS is unavailable
 */

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as os from 'os';
import {
  ADMIN_CONSOLE_DEFAULT_PORT,
  MDNS_SERVICE_TYPE,
} from '../../../shared/admin-protocol';

export interface DiscoveredAdmin {
  host: string;
  port: number;
  name: string;
  ip: string;
  lastSeen: number;
}

/**
 * Simple mDNS discovery for Admin Console
 * Uses multicast DNS to find admin consoles on the local network
 */
export class AgentDiscoveryService extends EventEmitter {
  private static instance: AgentDiscoveryService;
  private socket: dgram.Socket | null = null;
  private discoveredAdmins: Map<string, DiscoveredAdmin> = new Map();
  private isRunning: boolean = false;
  private queryInterval: NodeJS.Timeout | null = null;

  // mDNS constants
  private readonly MDNS_ADDRESS = '224.0.0.251';
  private readonly MDNS_PORT = 5353;
  private readonly QUERY_INTERVAL_MS = 10000; // Query every 10 seconds
  private readonly ADMIN_EXPIRY_MS = 30000; // Remove admin if not seen for 30 seconds

  private constructor() {
    super();
  }

  public static getInstance(): AgentDiscoveryService {
    if (!AgentDiscoveryService.instance) {
      AgentDiscoveryService.instance = new AgentDiscoveryService();
    }
    return AgentDiscoveryService.instance;
  }

  /**
   * Start mDNS discovery
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }

    console.log('[DISCOVERY] Starting mDNS discovery...');
    
    // Always check localhost first for same-PC testing
    this.checkLocalhost();

    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMdnsResponse(msg, rinfo);
      });

      this.socket.on('error', (err) => {
        console.error('[DISCOVERY] mDNS socket error:', err);
        this.emit('error', err);
      });

      this.socket.bind(this.MDNS_PORT, () => {
        try {
          this.socket?.addMembership(this.MDNS_ADDRESS);
          this.isRunning = true;
          console.log('[DISCOVERY] mDNS discovery started, listening on', this.MDNS_ADDRESS);
          
          // Send initial query
          this.sendQuery();
          
          // Set up periodic queries
          this.queryInterval = setInterval(() => {
            this.sendQuery();
            this.checkLocalhost(); // Keep checking localhost
            this.cleanupExpiredAdmins();
          }, this.QUERY_INTERVAL_MS);
        } catch (err) {
          console.error('[DISCOVERY] Failed to join mDNS multicast group:', err);
        }
      });
    } catch (err) {
      console.error('[DISCOVERY] Failed to start mDNS discovery:', err);
      // Fall back to manual discovery
      this.isRunning = false;
    }
  }

  /**
   * Check if admin console is running on localhost (for same-PC testing)
   */
  private async checkLocalhost(): Promise<void> {
    console.log('[DISCOVERY] Checking localhost for Admin Console...');
    
    // Check 127.0.0.1 first (most reliable for same-PC)
    const host = '127.0.0.1';
    const key = `${host}:${ADMIN_CONSOLE_DEFAULT_PORT}`;
    
    try {
      console.log(`[DISCOVERY] Checking ${host}:${ADMIN_CONSOLE_DEFAULT_PORT}...`);
      const isReachable = await this.checkAdminReachable(host, ADMIN_CONSOLE_DEFAULT_PORT);
      console.log(`[DISCOVERY] ${host}:${ADMIN_CONSOLE_DEFAULT_PORT} reachable: ${isReachable}`);
      
      if (isReachable) {
        if (!this.discoveredAdmins.has(key)) {
          const admin: DiscoveredAdmin = {
            host,
            port: ADMIN_CONSOLE_DEFAULT_PORT,
            name: 'ProduTime Admin Console (Local)',
            ip: host,
            lastSeen: Date.now(),
          };
          this.discoveredAdmins.set(key, admin);
          console.log(`[DISCOVERY] *** Found Admin Console on localhost at ${host}:${ADMIN_CONSOLE_DEFAULT_PORT} ***`);
          this.emit('discovered', admin);
        } else {
          // Update last seen
          const existing = this.discoveredAdmins.get(key)!;
          existing.lastSeen = Date.now();
        }
      }
    } catch (err) {
      console.log(`[DISCOVERY] Error checking localhost:`, err);
    }
  }

  /**
   * Stop mDNS discovery
   */
  public stop(): void {
    if (this.queryInterval) {
      clearInterval(this.queryInterval);
      this.queryInterval = null;
    }

    if (this.socket) {
      try {
        this.socket.dropMembership(this.MDNS_ADDRESS);
      } catch (err) {
        // Ignore - may not have joined
      }
      this.socket.close();
      this.socket = null;
    }

    this.isRunning = false;
    this.discoveredAdmins.clear();
    console.log('Agent discovery stopped');
  }

  /**
   * Send mDNS query for Admin Console
   */
  private sendQuery(): void {
    if (!this.socket || !this.isRunning) {
      return;
    }

    // Simple mDNS query packet for _produtime-admin._tcp.local
    // This is a simplified implementation - production would use a proper mDNS library
    const query = this.buildMdnsQuery(MDNS_SERVICE_TYPE + '.local');
    
    this.socket.send(query, 0, query.length, this.MDNS_PORT, this.MDNS_ADDRESS, (err) => {
      if (err) {
        console.error('[DISCOVERY] Failed to send mDNS query:', err);
      } else {
        console.log('[DISCOVERY] Sent mDNS query for', MDNS_SERVICE_TYPE);
      }
    });
  }

  /**
   * Build a simple mDNS query packet
   */
  private buildMdnsQuery(name: string): Buffer {
    // DNS header
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0, 0);      // Transaction ID
    header.writeUInt16BE(0, 2);      // Flags (standard query)
    header.writeUInt16BE(1, 4);      // Questions: 1
    header.writeUInt16BE(0, 6);      // Answer RRs: 0
    header.writeUInt16BE(0, 8);      // Authority RRs: 0
    header.writeUInt16BE(0, 10);     // Additional RRs: 0

    // Question section
    const nameParts = name.split('.');
    const questionParts: Buffer[] = [];
    
    for (const part of nameParts) {
      const len = Buffer.alloc(1);
      len.writeUInt8(part.length, 0);
      questionParts.push(len);
      questionParts.push(Buffer.from(part));
    }
    questionParts.push(Buffer.from([0])); // Null terminator
    
    const question = Buffer.concat(questionParts);
    
    // Type (PTR = 12) and Class (IN = 1)
    const typeClass = Buffer.alloc(4);
    typeClass.writeUInt16BE(12, 0);  // PTR
    typeClass.writeUInt16BE(1, 2);   // IN

    return Buffer.concat([header, question, typeClass]);
  }

  /**
   * Handle mDNS response
   */
  private handleMdnsResponse(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      // Simple parsing - look for our service type in the response
      const msgStr = msg.toString('utf8', 12); // Skip header
      
      // Check if this looks like a response from our admin console
      if (msgStr.includes('produtime-admin') || msgStr.includes('ProduTime')) {
        // Found a potential admin console
        const admin: DiscoveredAdmin = {
          host: rinfo.address,
          port: ADMIN_CONSOLE_DEFAULT_PORT,
          name: 'ProduTime Admin Console',
          ip: rinfo.address,
          lastSeen: Date.now(),
        };

        const key = `${admin.ip}:${admin.port}`;
        const isNew = !this.discoveredAdmins.has(key);
        this.discoveredAdmins.set(key, admin);

        if (isNew) {
          console.log(`[DISCOVERY] Discovered Admin Console at ${admin.ip}:${admin.port}`);
          this.emit('discovered', admin);
        } else {
          // Update last seen
          const existing = this.discoveredAdmins.get(key)!;
          existing.lastSeen = Date.now();
        }
      }
      
      // Also check for any mDNS response from port 17888 (our default port)
      // This helps when the service name isn't perfectly parsed
      if (rinfo.port === 5353) {
        // Try to verify this is an admin console by checking the health endpoint
        this.verifyAndAddAdmin(rinfo.address, ADMIN_CONSOLE_DEFAULT_PORT);
      }
    } catch (err) {
      // Ignore parsing errors - not all mDNS responses are for us
    }
  }

  /**
   * Verify an address is an admin console and add it
   */
  private async verifyAndAddAdmin(host: string, port: number): Promise<void> {
    const key = `${host}:${port}`;
    
    // Don't re-verify recently seen admins
    if (this.discoveredAdmins.has(key)) {
      return;
    }
    
    const isReachable = await this.checkAdminReachable(host, port);
    if (isReachable) {
      const admin: DiscoveredAdmin = {
        host,
        port,
        name: 'ProduTime Admin Console',
        ip: host,
        lastSeen: Date.now(),
      };
      
      this.discoveredAdmins.set(key, admin);
      console.log(`[DISCOVERY] Verified Admin Console at ${host}:${port}`);
      this.emit('discovered', admin);
    }
  }

  /**
   * Clean up admins that haven't been seen recently
   */
  private cleanupExpiredAdmins(): void {
    const now = Date.now();
    for (const [key, admin] of this.discoveredAdmins.entries()) {
      if (now - admin.lastSeen > this.ADMIN_EXPIRY_MS) {
        this.discoveredAdmins.delete(key);
        this.emit('lost', admin);
        console.log(`Admin Console at ${admin.ip}:${admin.port} no longer available`);
      }
    }
  }

  /**
   * Get all discovered admin consoles
   * Prioritizes localhost for same-PC testing
   */
  public getDiscoveredAdmins(): DiscoveredAdmin[] {
    const admins = Array.from(this.discoveredAdmins.values());
    
    // Sort to prioritize localhost/127.0.0.1 first
    admins.sort((a, b) => {
      const aIsLocal = a.ip === '127.0.0.1' || a.ip === 'localhost';
      const bIsLocal = b.ip === '127.0.0.1' || b.ip === 'localhost';
      if (aIsLocal && !bIsLocal) return -1;
      if (!aIsLocal && bIsLocal) return 1;
      return 0;
    });
    
    return admins;
  }

  /**
   * Manually add an admin console (for manual IP entry fallback)
   */
  public addManualAdmin(host: string, port: number = ADMIN_CONSOLE_DEFAULT_PORT): DiscoveredAdmin {
    const admin: DiscoveredAdmin = {
      host,
      port,
      name: 'ProduTime Admin Console (Manual)',
      ip: host,
      lastSeen: Date.now(),
    };

    const key = `${admin.ip}:${admin.port}`;
    this.discoveredAdmins.set(key, admin);
    this.emit('discovered', admin);
    
    return admin;
  }

  /**
   * Check if an admin is reachable via HTTP
   */
  public async checkAdminReachable(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const http = require('http');
      const req = http.request(
        {
          hostname: host,
          port,
          path: '/health',
          method: 'GET',
          timeout: 3000,
        },
        (res: any) => {
          resolve(res.statusCode === 200);
        }
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * Get local IP addresses for display
   */
  public getLocalIPs(): string[] {
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
}

export default AgentDiscoveryService.getInstance();
