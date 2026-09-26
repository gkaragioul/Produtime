/**
 * Brute-force protection for the Admin Console pairing endpoint.
 *
 * The device server listens on the local network, and a pair code has only
 * 1,000,000 possible values. Two limits keep it from being guessed:
 * - each client IP may send only a few pairing requests per minute;
 * - the current pair code is thrown away after a few wrong guesses (from any
 *   IP), so the admin has to generate a new one.
 */

export const PAIR_REQUESTS_PER_IP_PER_WINDOW = 10;
export const PAIR_REQUEST_WINDOW_MS = 60_000;
export const MAX_WRONG_PAIR_CODE_ATTEMPTS = 5;
// Upper bound on tracked IPs so a flood of spoofed sources cannot grow memory.
const MAX_TRACKED_IPS = 10_000;

interface IpWindow {
  windowStart: number;
  count: number;
}

export class PairingGuard {
  private requestsByIp = new Map<string, IpWindow>();
  private wrongAttempts = 0;

  constructor(
    private readonly maxRequestsPerWindow = PAIR_REQUESTS_PER_IP_PER_WINDOW,
    private readonly windowMs = PAIR_REQUEST_WINDOW_MS,
    private readonly maxWrongAttempts = MAX_WRONG_PAIR_CODE_ATTEMPTS
  ) {}

  /**
   * Records a pairing request from `ip` and returns false when that IP has
   * used up its requests for the current window.
   */
  public allowRequest(ip: string, now: number = Date.now()): boolean {
    this.prune(now);
    const entry = this.requestsByIp.get(ip);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      if (!entry && this.requestsByIp.size >= MAX_TRACKED_IPS) {
        return false;
      }
      this.requestsByIp.set(ip, { windowStart: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.maxRequestsPerWindow;
  }

  /**
   * Records a wrong pair code. Returns true when the current code must be
   * invalidated because too many wrong codes were tried.
   */
  public recordWrongCode(): boolean {
    this.wrongAttempts += 1;
    return this.wrongAttempts >= this.maxWrongAttempts;
  }

  /** Call whenever a new pair code is generated or the current one is cleared. */
  public resetCodeAttempts(): void {
    this.wrongAttempts = 0;
  }

  private prune(now: number): void {
    for (const [ip, entry] of this.requestsByIp) {
      if (now - entry.windowStart >= this.windowMs) {
        this.requestsByIp.delete(ip);
      }
    }
  }
}
