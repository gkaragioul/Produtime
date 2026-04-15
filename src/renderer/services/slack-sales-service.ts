/**
 * Slack sales service.
 *
 * Thin wrapper around the main-process IPC that proxies SALES_REQUEST /
 * SALES_RESPONSE over the existing authenticated admin WebSocket. The
 * renderer never talks to the Slack bot directly.
 */

export type SalesRange = 'day' | 'week' | 'month';

export interface SalesCounters {
  wins: number;
  losses: number;
  winRate: number;
  totalAmount: number;
  currency?: string | null;
}

export interface SalesTicket {
  client: string | null;
  destination: string | null;
  outcome: 'won' | 'lost';
  amount: number | null;
  currency: string | null;
  resolvedAt: string;
  permalink: string | null;

  // Optional rich fields populated when the bot had the full GPT output
  // (new cases) or the backfill text parser recovered them (historical).
  travelDates?: string | null;
  travelers?: string | null;
  contact?: string | null;
  clientBudget?: string | null;
  whatTheyWanted?: string | null;
  objectionsOrBlockers?: string | null;
  notes?: string | null;
  agentDisplayName?: string | null;
  caseDate?: string | null;
}

export interface SalesResponse {
  counters?: SalesCounters;
  recent?: SalesTicket[];
  unconfigured?: boolean;
  unavailable?: boolean;
  reason?: string;
}

export async function fetchSales(range: SalesRange): Promise<SalesResponse> {
  try {
    const res: any = await (window as any).electronAPI?.agentGetSalesStats?.(range);
    if (!res) return { unavailable: true, reason: 'no_ipc' };
    if (res.success === false) {
      return { unavailable: true, reason: res.error || 'ipc_failed' };
    }
    return (res.data as SalesResponse) || { unavailable: true };
  } catch (e: any) {
    return { unavailable: true, reason: String(e?.message || e) };
  }
}
