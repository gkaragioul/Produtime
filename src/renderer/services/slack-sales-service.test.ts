/**
 * @jest-environment jsdom
 */
import { fetchSales } from './slack-sales-service';

describe('fetchSales', () => {
  beforeEach(() => {
    (window as any).electronAPI = {
      agentGetSalesStats: jest.fn(),
    };
  });

  it('returns the data payload on success', async () => {
    (window as any).electronAPI.agentGetSalesStats.mockResolvedValue({
      success: true,
      data: { counters: { wins: 1, losses: 0, winRate: 1, totalAmount: 100, currency: 'EUR' }, recent: [] },
    });
    const r = await fetchSales('week');
    expect(r.counters?.wins).toBe(1);
    expect(r.recent).toEqual([]);
  });

  it('returns unconfigured when the bridge says so', async () => {
    (window as any).electronAPI.agentGetSalesStats.mockResolvedValue({
      success: true,
      data: { unconfigured: true },
    });
    const r = await fetchSales('day');
    expect(r.unconfigured).toBe(true);
  });

  it('falls back to unavailable when the IPC errors', async () => {
    (window as any).electronAPI.agentGetSalesStats.mockResolvedValue({
      success: false,
      error: 'boom',
    });
    const r = await fetchSales('month');
    expect(r.unavailable).toBe(true);
    expect(r.reason).toBe('boom');
  });

  it('falls back to unavailable when the bridge throws', async () => {
    (window as any).electronAPI.agentGetSalesStats.mockRejectedValue(new Error('disconnected'));
    const r = await fetchSales('day');
    expect(r.unavailable).toBe(true);
    expect(r.reason).toMatch(/disconnected/);
  });

  it('returns unavailable when no bridge is present', async () => {
    delete (window as any).electronAPI;
    const r = await fetchSales('week');
    expect(r.unavailable).toBe(true);
    expect(r.reason).toBe('no_ipc');
  });
});
