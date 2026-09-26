import * as http from 'http';
import { AddressInfo } from 'net';
import { PairingGuard } from '../pairing-guard';

// The real dashboard service needs SQLite; the pairing endpoint does not use it.
jest.mock('../dashboard-service', () => ({
  DashboardService: jest.fn().mockImplementation(() => ({
    startExceptionsEngine: jest.fn(),
    stopExceptionsEngine: jest.fn(),
  })),
}));

import { AdminServer } from '../server';

describe('PairingGuard', () => {
  test('allows a limited number of requests per IP per window', () => {
    const guard = new PairingGuard(3, 60_000, 5);
    const t0 = 1_000_000;
    expect(guard.allowRequest('10.0.0.1', t0)).toBe(true);
    expect(guard.allowRequest('10.0.0.1', t0 + 1)).toBe(true);
    expect(guard.allowRequest('10.0.0.1', t0 + 2)).toBe(true);
    expect(guard.allowRequest('10.0.0.1', t0 + 3)).toBe(false);
    // Other IPs have their own budget.
    expect(guard.allowRequest('10.0.0.2', t0 + 3)).toBe(true);
    // A new window starts after the window length.
    expect(guard.allowRequest('10.0.0.1', t0 + 60_000)).toBe(true);
  });

  test('asks for the code to be cancelled after the maximum wrong attempts', () => {
    const guard = new PairingGuard(10, 60_000, 3);
    expect(guard.recordWrongCode()).toBe(false);
    expect(guard.recordWrongCode()).toBe(false);
    expect(guard.recordWrongCode()).toBe(true);
    guard.resetCodeAttempts();
    expect(guard.recordWrongCode()).toBe(false);
  });
});

describe('AdminServer /pair/request', () => {
  const realSetInterval = global.setInterval;
  let server: AdminServer;
  let port: number;
  let logs: string[];
  const db: any = {
    getAdminKeypair: jest.fn(() => null),
    setAdminKeypair: jest.fn(),
    insertPendingPair: jest.fn(),
    cleanupExpiredPairs: jest.fn(),
  };

  beforeAll(() => {
    // Keep the server's cleanup timer from holding the test process open.
    jest.spyOn(global, 'setInterval').mockImplementation(((fn: any, ms?: number) => {
      const t = realSetInterval(fn, ms);
      (t as any).unref?.();
      return t;
    }) as any);
  });

  afterAll(() => {
    (global.setInterval as any).mockRestore?.();
  });

  beforeEach(async () => {
    logs = [];
    server = new AdminServer(db, 0);
    server.onLog = (line) => logs.push(line);
    const httpServer: http.Server = (server as any).httpServer;
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    const httpServer: http.Server = (server as any).httpServer;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    jest.clearAllMocks();
  });

  function post(body: unknown): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }> {
    const data = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/pair/request',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, json: JSON.parse(text) }));
        }
      );
      req.on('error', reject);
      req.end(data);
    });
  }

  const pairRequest = (pairCode: string) => ({
    type: 'PAIR_REQUEST',
    deviceId: 'device-1',
    payload: { pairCode, deviceName: 'Test PC', devicePubKey: 'pk', appVersion: '1.0.0', osInfo: 'win32' },
  });

  const wrongCode = (code: string) => (code === '000000' ? '000001' : '000000');

  test('accepts the right code once, sends no CORS header and never logs the code', async () => {
    const code = server.generatePairCode();
    const ok = await post(pairRequest(code));
    expect(ok.status).toBe(200);
    expect(ok.json.success).toBe(true);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
    expect(db.insertPendingPair).toHaveBeenCalledTimes(1);

    // The code is single-use.
    const again = await post(pairRequest(code));
    expect(again.json.error).toBe('No active pair code');

    expect(logs.join('\n')).not.toContain(code);
  });

  test('cancels the pair code after 5 wrong codes', async () => {
    const code = server.generatePairCode();
    for (let i = 0; i < 5; i++) {
      const res = await post(pairRequest(wrongCode(code)));
      expect(res.json.error).toBe('Invalid pair code');
    }
    expect(server.getCurrentPairCode()).toBeNull();
    const late = await post(pairRequest(code));
    expect(late.json.error).toBe('No active pair code');
    expect(db.insertPendingPair).not.toHaveBeenCalled();
    expect(logs.join('\n')).not.toContain(code);
  });

  test('rate-limits pairing requests per client IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      server.generatePairCode(); // fresh code so wrong guesses do not cancel it first
      statuses.push((await post(pairRequest('abc'))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
