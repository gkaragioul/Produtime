/**
 * Analytics Tab - Comprehensive analytics view for the ProduTime Admin Console.
 *
 * Provides period-based (Daily / Weekly / Monthly) activity analysis with
 * per-device or whole-team filtering, CSS-based charts, live device status,
 * top-app usage, and a daily breakdown table.
 *
 * All data is fetched from the admin console's own database via IPC.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PeriodType = 'daily' | 'weekly' | 'monthly';

interface DeviceInfo {
  device_id: string;
  device_name: string;
  status: string;
}

interface DailyMetric {
  date_ymd: string;
  device_id?: string;
  active_seconds: number;
  idle_seconds: number;
  untracked_seconds: number;
  productive_seconds: number;
  unproductive_seconds: number;
  top_apps_json?: string;
}

interface LiveDevice {
  device_id: string;
  device_name: string;
  status: 'online' | 'idle' | 'offline';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateRange(period: PeriodType): { startDate: string; endDate: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  if (period === 'daily') {
    // today only
  } else if (period === 'weekly') {
    start.setDate(start.getDate() - 6);
  } else {
    start.setDate(start.getDate() - 29);
  }
  return { startDate: toYmd(start), endDate: toYmd(end) };
}

function formatDateLabel(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateShort(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

// ---------------------------------------------------------------------------
// PDF Export (opens printable report in new window)
// ---------------------------------------------------------------------------

interface TopApp {
  app: string;
  seconds: number;
}

function exportPDF(
  metrics: DailyMetric[],
  devices: DeviceInfo[],
  deviceFilter: string,
  period: PeriodType,
  topApps: TopApp[],
): void {
  if (metrics.length === 0) return;

  const filterLabel = deviceFilter === 'all'
    ? 'All Team'
    : devices.find(d => d.device_id === deviceFilter)?.device_name || deviceFilter;

  const periodLabel = period === 'daily' ? 'Daily' : period === 'weekly' ? 'Weekly (7 Days)' : 'Monthly (30 Days)';
  const { startDate, endDate } = dateRange(period);

  // Totals
  const totalActive = metrics.reduce((s, m) => s + (m.active_seconds || 0), 0);
  const totalIdle = metrics.reduce((s, m) => s + (m.idle_seconds || 0), 0);
  const totalUntracked = metrics.reduce((s, m) => s + (m.untracked_seconds || 0), 0);
  const totalTracked = totalActive + totalIdle;
  const productivityRate = totalTracked > 0 ? Math.round((totalActive / totalTracked) * 100) : 0;

  // Chart bar max
  const maxDayTotal = Math.max(...metrics.map(m => (m.active_seconds || 0) + (m.idle_seconds || 0) + (m.untracked_seconds || 0)), 1);
  const maxAppSeconds = topApps.length > 0 ? topApps[0].seconds : 1;

  // Build chart bars HTML
  const chartBarsHtml = metrics.map(m => {
    const dayTotal = (m.active_seconds || 0) + (m.idle_seconds || 0) + (m.untracked_seconds || 0);
    const barHeight = dayTotal > 0 ? (dayTotal / maxDayTotal) * 100 : 0;
    const activePct = dayTotal > 0 ? ((m.active_seconds || 0) / dayTotal) * 100 : 0;
    const idlePct = dayTotal > 0 ? ((m.idle_seconds || 0) / dayTotal) * 100 : 0;
    const untrackedPct = dayTotal > 0 ? ((m.untracked_seconds || 0) / dayTotal) * 100 : 0;
    const label = new Date(m.date_ymd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `
      <div style="flex:1; display:flex; flex-direction:column; align-items:center; height:100%; justify-content:flex-end; min-width:20px;">
        <div style="width:100%; max-width:36px; height:${barHeight}%; display:flex; flex-direction:column; border-radius:3px 3px 0 0; overflow:hidden; min-height:${dayTotal > 0 ? '2px' : '0'};">
          <div style="height:${untrackedPct}%; background:#f44336;"></div>
          <div style="height:${idlePct}%; background:#FF9800;"></div>
          <div style="height:${activePct}%; background:#4CAF50;"></div>
        </div>
        <div style="font-size:9px; color:#999; margin-top:4px; writing-mode:vertical-rl; text-orientation:mixed; height:50px; overflow:hidden;">${label}</div>
      </div>`;
  }).join('');

  // Top apps bars HTML
  const topAppsHtml = topApps.map((app, i) => `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
      <span style="width:20px; font-size:13px; color:#999; font-weight:600; text-align:right;">${i + 1}</span>
      <span style="width:180px; font-size:13px; font-weight:500; color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${app.app}</span>
      <div style="flex:1; height:16px; background:#f0f0f0; border-radius:3px; overflow:hidden;">
        <div style="width:${(app.seconds / maxAppSeconds) * 100}%; height:100%; background:#2196F3; border-radius:3px;"></div>
      </div>
      <span style="width:70px; font-size:13px; font-weight:600; color:#555; text-align:right;">${formatSeconds(app.seconds)}</span>
    </div>`).join('');

  // Daily breakdown rows
  const tableRows = [...metrics].reverse().map(m => {
    const dayTracked = (m.active_seconds || 0) + (m.idle_seconds || 0);
    const dayProd = dayTracked > 0 ? Math.round(((m.active_seconds || 0) / dayTracked) * 100) : 0;
    const dateLabel = new Date(m.date_ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const prodColor = dayProd >= 70 ? '#2e7d32' : dayProd >= 40 ? '#e65100' : '#c62828';
    const prodBg = dayProd >= 70 ? '#e8f5e9' : dayProd >= 40 ? '#fff3e0' : '#ffebee';
    return `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px 10px; font-weight:500; color:#333;">${dateLabel}</td>
        <td style="padding:8px 10px; text-align:right; font-weight:600; color:#4CAF50;">${formatSeconds(m.active_seconds || 0)}</td>
        <td style="padding:8px 10px; text-align:right; color:#FF9800;">${formatSeconds(m.idle_seconds || 0)}</td>
        <td style="padding:8px 10px; text-align:right; color:#f44336;">${formatSeconds(m.untracked_seconds || 0)}</td>
        <td style="padding:8px 10px; text-align:right;"><span style="padding:3px 8px; border-radius:8px; font-size:12px; font-weight:600; background:${prodBg}; color:${prodColor};">${dayProd}%</span></td>
      </tr>`;
  }).join('');

  const prodColor = productivityRate >= 70 ? '#2e7d32' : productivityRate >= 40 ? '#e65100' : '#c62828';
  const prodBg = productivityRate >= 70 ? '#e8f5e9' : productivityRate >= 40 ? '#fff3e0' : '#ffebee';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ProduTime Report — ${filterLabel} — ${periodLabel}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; padding: 40px; max-width: 900px; margin: 0 auto; }
    @media print {
      body { padding: 20px; }
      .no-print { display: none !important; }
      @page { margin: 15mm; size: A4; }
    }
    h1 { font-size: 26px; color: #1a1a2e; margin-bottom: 4px; }
    h2 { font-size: 18px; color: #1a1a2e; margin: 28px 0 14px 0; }
    .subtitle { font-size: 14px; color: #666; margin-bottom: 24px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px; }
    .summary-card { background: #f8f9fa; border-radius: 10px; padding: 18px; text-align: center; }
    .summary-card .label { font-size: 12px; color: #666; font-weight: 500; margin-bottom: 6px; }
    .summary-card .value { font-size: 28px; font-weight: 700; line-height: 1; }
    .chart-box { background: #f8f9fa; border-radius: 10px; padding: 20px; margin-bottom: 28px; }
    .legend { display: flex; gap: 18px; font-size: 12px; color: #666; margin-bottom: 14px; }
    .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px; font-size: 12px; color: #666; font-weight: 600; border-bottom: 2px solid #e0e0e0; }
    th.right { text-align: right; }
    .print-btn { display: block; margin: 0 auto 30px; padding: 12px 40px; font-size: 16px; font-weight: 600; background: #1976d2; color: white; border: none; border-radius: 8px; cursor: pointer; }
    .print-btn:hover { background: #1565c0; }
    .footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Save as PDF</button>

  <h1>ProduTime Activity Report</h1>
  <div class="subtitle">${filterLabel} &mdash; ${periodLabel} &mdash; ${startDate} to ${endDate} &mdash; Generated ${new Date().toLocaleString()}</div>

  <!-- Summary Cards -->
  <div class="summary-grid">
    <div class="summary-card"><div class="label">Total Active</div><div class="value" style="color:#4CAF50;">${formatSeconds(totalActive)}</div></div>
    <div class="summary-card"><div class="label">Total Idle</div><div class="value" style="color:#FF9800;">${formatSeconds(totalIdle)}</div></div>
    <div class="summary-card"><div class="label">Total Untracked</div><div class="value" style="color:#f44336;">${formatSeconds(totalUntracked)}</div></div>
    <div class="summary-card"><div class="label">Productivity Rate</div><div class="value" style="color:#2196F3;">${productivityRate}%</div></div>
  </div>

  <!-- Activity Trend Chart -->
  <h2>Activity Trend</h2>
  <div class="chart-box">
    <div class="legend">
      <span><span class="legend-dot" style="background:#4CAF50;"></span>Active</span>
      <span><span class="legend-dot" style="background:#FF9800;"></span>Idle</span>
      <span><span class="legend-dot" style="background:#f44336;"></span>Untracked</span>
    </div>
    <div style="display:flex; align-items:flex-end; height:180px; gap:${metrics.length > 15 ? '2' : '4'}px; border-bottom:1px solid #e0e0e0; padding-bottom:4px;">
      ${chartBarsHtml}
    </div>
  </div>

  <!-- Top Apps -->
  ${topApps.length > 0 ? `
  <h2>Top Applications</h2>
  <div class="chart-box">
    ${topAppsHtml}
  </div>` : ''}

  <!-- Daily Breakdown -->
  <h2>Daily Breakdown</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th class="right" style="text-align:right;">Active</th>
        <th class="right" style="text-align:right;">Idle</th>
        <th class="right" style="text-align:right;">Untracked</th>
        <th class="right" style="text-align:right;">Productivity</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
    <tfoot>
      <tr style="border-top:2px solid #ddd; font-weight:700;">
        <td style="padding:10px;">Total</td>
        <td style="padding:10px; text-align:right; color:#4CAF50;">${formatSeconds(totalActive)}</td>
        <td style="padding:10px; text-align:right; color:#FF9800;">${formatSeconds(totalIdle)}</td>
        <td style="padding:10px; text-align:right; color:#f44336;">${formatSeconds(totalUntracked)}</td>
        <td style="padding:10px; text-align:right;"><span style="padding:3px 8px; border-radius:8px; font-size:12px; font-weight:600; background:${prodBg}; color:${prodColor};">${productivityRate}%</span></td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">ProduTime &mdash; Activity Report &mdash; Generated automatically</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const Analytics: React.FC = () => {
  const [period, setPeriod] = useState<PeriodType>('weekly');
  const [deviceFilter, setDeviceFilter] = useState<string>('all');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [liveDevices, setLiveDevices] = useState<LiveDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tooltipData, setTooltipData] = useState<{ x: number; y: number; metric: DailyMetric } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  const loadDevices = useCallback(async () => {
    try {
      const all = await window.adminAPI.getAllDevices();
      setDevices(all.map((d: any) => ({ device_id: d.device_id, device_name: d.device_name, status: d.status })));
    } catch (err) {
      console.error('Analytics: failed to load devices', err);
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const { startDate, endDate } = dateRange(period);
      const params: any = { startDate, endDate };
      if (deviceFilter !== 'all') params.deviceId = deviceFilter;
      const data = await window.adminAPI.getAnalyticsMetrics(params);
      // Sort ascending by date
      const sorted = (data || []).sort((a: DailyMetric, b: DailyMetric) =>
        a.date_ymd.localeCompare(b.date_ymd)
      );
      setMetrics(sorted);
    } catch (err) {
      console.error('Analytics: failed to load metrics', err);
    }
  }, [period, deviceFilter]);

  const loadLiveStatus = useCallback(async () => {
    try {
      const [connectedIds, allDevs] = await Promise.all([
        window.adminAPI.getConnectedDevices(),
        window.adminAPI.getAllDevices(),
      ]);
      const connectedSet = new Set(connectedIds);
      const live: LiveDevice[] = allDevs.map((d: any) => ({
        device_id: d.device_id,
        device_name: d.device_name,
        status: connectedSet.has(d.device_id)
          ? (d.status === 'idle' ? 'idle' : 'online')
          : 'offline',
      }));
      setLiveDevices(live);
    } catch (err) {
      console.error('Analytics: failed to load live status', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([loadDevices(), loadMetrics(), loadLiveStatus()]).finally(() => setLoading(false));
  }, [loadDevices, loadMetrics, loadLiveStatus]);

  // Reload metrics when period or filter changes
  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  // Live status refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(loadLiveStatus, 10_000);
    return () => clearInterval(interval);
  }, [loadLiveStatus]);

  // Metrics auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(loadMetrics, 30_000);
    return () => clearInterval(interval);
  }, [loadMetrics]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadDevices(), loadMetrics(), loadLiveStatus()]);
    setRefreshing(false);
  };

  // -----------------------------------------------------------------------
  // Computed values
  // -----------------------------------------------------------------------

  const totalActive = metrics.reduce((s, m) => s + (m.active_seconds || 0), 0);
  const totalIdle = metrics.reduce((s, m) => s + (m.idle_seconds || 0), 0);
  const totalUntracked = metrics.reduce((s, m) => s + (m.untracked_seconds || 0), 0);
  const totalTracked = totalActive + totalIdle;
  const productivityRate = totalTracked > 0 ? Math.round((totalActive / totalTracked) * 100) : 0;

  // Top apps aggregation
  const appTotals = new Map<string, number>();
  for (const m of metrics) {
    if (m.top_apps_json) {
      try {
        const apps: Array<{ app: string; seconds: number }> = JSON.parse(m.top_apps_json);
        for (const a of apps) {
          appTotals.set(a.app, (appTotals.get(a.app) || 0) + a.seconds);
        }
      } catch { /* ignore */ }
    }
  }
  const topApps = Array.from(appTotals.entries())
    .map(([app, seconds]) => ({ app, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 10);
  const maxAppSeconds = topApps.length > 0 ? topApps[0].seconds : 1;

  // Detailed apps (with site-level breakdown)
  const detailedTotals = new Map<string, number>();
  for (const m of metrics) {
    if ((m as any).detailed_apps_json) {
      try {
        const apps: Array<{ app: string; seconds: number }> = JSON.parse((m as any).detailed_apps_json);
        for (const a of apps) {
          detailedTotals.set(a.app, (detailedTotals.get(a.app) || 0) + a.seconds);
        }
      } catch { /* ignore */ }
    }
  }
  const detailedApps = Array.from(detailedTotals.entries())
    .map(([app, seconds]) => ({ app, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 20);
  const maxDetailedSeconds = detailedApps.length > 0 ? detailedApps[0].seconds : 1;

  // Chart max for bar scaling
  const maxDayTotal = Math.max(...metrics.map(m => (m.active_seconds || 0) + (m.idle_seconds || 0) + (m.untracked_seconds || 0)), 1);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Loading analytics...</div>
      </div>
    );
  }

  return (
    <div style={{
      padding: 'clamp(16px, 2vw, 32px)',
      height: '100%',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'auto',
      boxSizing: 'border-box',
      backgroundColor: '#f5f5f5',
    }}>
      {/* ================================================================= */}
      {/* Header Row                                                         */}
      {/* ================================================================= */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'clamp(16px, 2vw, 24px)', flexShrink: 0, flexWrap: 'wrap', gap: '12px' }}>
        <h1 style={{ fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 600, margin: 0, color: '#1a1a2e' }}>Analytics</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Period selector */}
          {(['daily', 'weekly', 'monthly'] as PeriodType[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={periodButtonStyle(period === p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}

          {/* Person / device filter */}
          <select
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #ddd',
              fontSize: '14px',
              minWidth: '160px',
              backgroundColor: 'white',
            }}
          >
            <option value="all">All Team</option>
            {devices.map((d) => (
              <option key={d.device_id} value={d.device_id}>{d.device_name}</option>
            ))}
          </select>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh data now"
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid #ddd',
              backgroundColor: 'white',
              color: refreshing ? '#999' : '#333',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              fontSize: '16px',
            }}
          >
            {refreshing ? '⏳' : '🔄'}
          </button>

          {/* Export button */}
          <button
            onClick={() => exportPDF(metrics, devices, deviceFilter, period, topApps)}
            disabled={metrics.length === 0}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: metrics.length > 0 ? '#1976d2' : '#ccc',
              color: 'white',
              cursor: metrics.length > 0 ? 'pointer' : 'not-allowed',
              fontWeight: 600,
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* Summary Cards                                                      */}
      {/* ================================================================= */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'clamp(12px, 1.5vw, 16px)', marginBottom: 'clamp(16px, 2vw, 24px)', flexShrink: 0 }}>
        <SummaryCard label="Total Active Time" value={formatSeconds(totalActive)} color="#4CAF50" />
        <SummaryCard label="Total Idle Time" value={formatSeconds(totalIdle)} color="#FF9800" />
        <SummaryCard label="Total Untracked" value={formatSeconds(totalUntracked)} color="#f44336" />
        <SummaryCard label="Productivity Rate" value={`${productivityRate}%`} color="#2196F3" />
      </div>

      {/* ================================================================= */}
      {/* Main content: chart + live panel side by side                      */}
      {/* ================================================================= */}
      <div style={{ display: 'flex', gap: 'clamp(16px, 2vw, 24px)', marginBottom: 'clamp(16px, 2vw, 24px)', flexWrap: 'wrap' }}>
        {/* Activity Trend Chart */}
        <div
          ref={chartRef}
          style={{
            flex: '1 1 65%',
            minWidth: '400px',
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: 'clamp(16px, 2vw, 24px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            position: 'relative',
          }}
        >
          <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 16px 0', color: '#1a1a2e' }}>Activity Trend</h2>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '16px', fontSize: '14px', color: '#666' }}>
            <span><span style={legendDot('#4CAF50')} />Active</span>
            <span><span style={legendDot('#FF9800')} />Idle</span>
            <span><span style={legendDot('#f44336')} />Untracked</span>
          </div>

          {metrics.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '16px' }}>
              No data for the selected period.
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* Y-axis labels */}
              <div style={{ display: 'flex', height: '220px' }}>
                <div style={{ width: '50px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingRight: '8px', textAlign: 'right', fontSize: '12px', color: '#999' }}>
                  <span>{formatSeconds(maxDayTotal)}</span>
                  <span>{formatSeconds(maxDayTotal * 0.75)}</span>
                  <span>{formatSeconds(maxDayTotal * 0.5)}</span>
                  <span>{formatSeconds(maxDayTotal * 0.25)}</span>
                  <span>0</span>
                </div>

                {/* Bars */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: metrics.length > 15 ? '2px' : '6px', borderLeft: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0', padding: '0 0 0 8px', position: 'relative' }}>
                  {/* Horizontal grid lines */}
                  {[0.25, 0.5, 0.75, 1].map((pctVal) => (
                    <div key={pctVal} style={{ position: 'absolute', left: '8px', right: 0, bottom: `${pctVal * 100}%`, borderTop: '1px dashed #f0f0f0', pointerEvents: 'none' }} />
                  ))}

                  {metrics.map((m, i) => {
                    const dayTotal = (m.active_seconds || 0) + (m.idle_seconds || 0) + (m.untracked_seconds || 0);
                    const barHeight = dayTotal > 0 ? (dayTotal / maxDayTotal) * 100 : 0;
                    const activePct = dayTotal > 0 ? ((m.active_seconds || 0) / dayTotal) * 100 : 0;
                    const idlePct = dayTotal > 0 ? ((m.idle_seconds || 0) / dayTotal) * 100 : 0;
                    const untrackedPct = dayTotal > 0 ? ((m.untracked_seconds || 0) / dayTotal) * 100 : 0;

                    return (
                      <div
                        key={m.date_ymd}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', position: 'relative' }}
                        onMouseEnter={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const containerRect = chartRef.current?.getBoundingClientRect();
                          if (containerRect) {
                            setTooltipData({
                              x: rect.left - containerRect.left + rect.width / 2,
                              y: rect.top - containerRect.top - 10,
                              metric: m,
                            });
                          }
                        }}
                        onMouseLeave={() => setTooltipData(null)}
                      >
                        {/* Stacked bar */}
                        <div style={{
                          width: '100%',
                          maxWidth: '40px',
                          height: `${barHeight}%`,
                          display: 'flex',
                          flexDirection: 'column',
                          borderRadius: '4px 4px 0 0',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          transition: 'opacity 0.15s',
                          minHeight: dayTotal > 0 ? '2px' : 0,
                        }}>
                          <div style={{ height: `${untrackedPct}%`, backgroundColor: '#f44336' }} />
                          <div style={{ height: `${idlePct}%`, backgroundColor: '#FF9800' }} />
                          <div style={{ height: `${activePct}%`, backgroundColor: '#4CAF50' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* X-axis labels */}
              <div style={{ display: 'flex', marginLeft: '58px', marginTop: '6px' }}>
                {metrics.map((m, i) => {
                  // Show fewer labels if many bars
                  const showLabel = metrics.length <= 10 || i % Math.ceil(metrics.length / 10) === 0 || i === metrics.length - 1;
                  return (
                    <div key={m.date_ymd} style={{ flex: 1, textAlign: 'center', fontSize: '11px', color: '#999', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {showLabel ? formatDateLabel(m.date_ymd) : ''}
                    </div>
                  );
                })}
              </div>

              {/* Tooltip */}
              {tooltipData && (
                <div style={{
                  position: 'absolute',
                  left: tooltipData.x,
                  top: tooltipData.y,
                  transform: 'translate(-50%, -100%)',
                  backgroundColor: '#333',
                  color: 'white',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  lineHeight: 1.6,
                  pointerEvents: 'none',
                  zIndex: 10,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>{formatDateShort(tooltipData.metric.date_ymd)}</div>
                  <div><span style={{ color: '#81C784' }}>Active:</span> {formatSeconds(tooltipData.metric.active_seconds || 0)}</div>
                  <div><span style={{ color: '#FFB74D' }}>Idle:</span> {formatSeconds(tooltipData.metric.idle_seconds || 0)}</div>
                  <div><span style={{ color: '#E57373' }}>Untracked:</span> {formatSeconds(tooltipData.metric.untracked_seconds || 0)}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Status Panel */}
        <div style={{
          flex: '0 0 28%',
          minWidth: '260px',
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: 'clamp(16px, 2vw, 24px)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          maxHeight: '380px',
          overflow: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0, color: '#1a1a2e' }}>Live Status</h2>
            <span style={{ fontSize: '12px', color: '#999' }}>Auto-refresh 10s</span>
          </div>

          {liveDevices.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#999', fontSize: '15px' }}>
              No devices paired yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {liveDevices.map((d) => (
                <div key={d.device_id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#fafafa',
                  border: '1px solid #f0f0f0',
                }}>
                  <span style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: statusColor(d.status),
                    flexShrink: 0,
                  }} />
                  <span style={{ flex: 1, fontSize: '14px', fontWeight: 500, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.device_name}
                  </span>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '10px',
                    backgroundColor: `${statusColor(d.status)}18`,
                    color: statusColor(d.status),
                    textTransform: 'capitalize',
                  }}>
                    {d.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* Top Apps Table                                                      */}
      {/* ================================================================= */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: 'clamp(16px, 2vw, 24px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        marginBottom: 'clamp(16px, 2vw, 24px)',
      }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 16px 0', color: '#1a1a2e' }}>
          Top Apps ({period === 'daily' ? 'Today' : period === 'weekly' ? 'Last 7 Days' : 'Last 30 Days'})
        </h2>

        {topApps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: '#999', fontSize: '15px' }}>
            No app usage data for the selected period.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {topApps.map((app, i) => (
              <div key={app.app} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ width: '26px', fontSize: '14px', color: '#999', fontWeight: 600, textAlign: 'right' }}>{i + 1}</span>
                <span style={{ width: '200px', fontSize: '15px', fontWeight: 500, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {app.app}
                </span>
                <div style={{ flex: 1, height: '20px', backgroundColor: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(app.seconds / maxAppSeconds) * 100}%`,
                    height: '100%',
                    backgroundColor: '#2196F3',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease',
                    minWidth: '2px',
                  }} />
                </div>
                <span style={{ width: '80px', fontSize: '14px', fontWeight: 600, color: '#555', textAlign: 'right', flexShrink: 0 }}>
                  {formatSeconds(app.seconds)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* Detailed Activity Breakdown (per-site)                             */}
      {/* ================================================================= */}
      {detailedApps.length > 0 && (
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: 'clamp(16px, 2vw, 24px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        marginBottom: 'clamp(16px, 2vw, 24px)',
      }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 16px 0', color: '#1a1a2e' }}>
          Detailed Activity ({period === 'daily' ? 'Today' : period === 'weekly' ? 'Last 7 Days' : 'Last 30 Days'})
        </h2>
        <p style={{ margin: '0 0 16px 0', color: '#888', fontSize: '13px' }}>
          Site-level breakdown for browsers, per-app for other applications
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {detailedApps.map((app, i) => {
            const parts = app.app.split(' · ');
            const issite = parts.length > 1;
            return (
              <div key={app.app} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ width: '26px', fontSize: '14px', color: '#999', fontWeight: 600, textAlign: 'right' }}>{i + 1}</span>
                <span style={{
                  width: '260px', fontSize: '14px', fontWeight: 500,
                  color: issite ? '#555' : '#333',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {issite ? (
                    <><span style={{ color: '#999', fontSize: '12px' }}>{parts[0]} ›</span> {parts[1]}</>
                  ) : app.app}
                </span>
                <div style={{ flex: 1, height: '18px', backgroundColor: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(app.seconds / maxDetailedSeconds) * 100}%`,
                    height: '100%',
                    backgroundColor: issite ? '#66bb6a' : '#2196F3',
                    borderRadius: '4px',
                    transition: 'width 0.3s ease',
                    minWidth: '2px',
                  }} />
                </div>
                <span style={{ width: '80px', fontSize: '14px', fontWeight: 600, color: '#555', textAlign: 'right', flexShrink: 0 }}>
                  {formatSeconds(app.seconds)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* ================================================================= */}
      {/* Daily Breakdown Table                                              */}
      {/* ================================================================= */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: 'clamp(16px, 2vw, 24px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        marginBottom: '24px',
      }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 16px 0', color: '#1a1a2e' }}>Daily Breakdown</h2>

        {metrics.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: '#999', fontSize: '15px' }}>
            No daily data for the selected period.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee' }}>
                  <th style={thStyle}>Date</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Active Time</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Idle Time</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Untracked</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Productivity %</th>
                </tr>
              </thead>
              <tbody>
                {/* Reverse to show most recent first */}
                {[...metrics].reverse().map((m) => {
                  const dayTracked = (m.active_seconds || 0) + (m.idle_seconds || 0);
                  const dayProd = dayTracked > 0 ? Math.round(((m.active_seconds || 0) / dayTracked) * 100) : 0;
                  return (
                    <tr key={m.date_ymd} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 500, color: '#333' }}>{formatDateShort(m.date_ymd)}</td>
                      <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 600, color: '#4CAF50' }}>{formatSeconds(m.active_seconds || 0)}</td>
                      <td style={{ padding: '12px 10px', textAlign: 'right', color: '#FF9800' }}>{formatSeconds(m.idle_seconds || 0)}</td>
                      <td style={{ padding: '12px 10px', textAlign: 'right', color: '#f44336' }}>{formatSeconds(m.untracked_seconds || 0)}</td>
                      <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 10px',
                          borderRadius: '10px',
                          fontSize: '13px',
                          fontWeight: 600,
                          backgroundColor: dayProd >= 70 ? '#e8f5e9' : dayProd >= 40 ? '#fff3e0' : '#ffebee',
                          color: dayProd >= 70 ? '#2e7d32' : dayProd >= 40 ? '#e65100' : '#c62828',
                        }}>
                          {dayProd}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals footer */}
              <tfoot>
                <tr style={{ borderTop: '2px solid #ddd', fontWeight: 700 }}>
                  <td style={{ padding: '12px 10px', color: '#333' }}>Total</td>
                  <td style={{ padding: '12px 10px', textAlign: 'right', color: '#4CAF50' }}>{formatSeconds(totalActive)}</td>
                  <td style={{ padding: '12px 10px', textAlign: 'right', color: '#FF9800' }}>{formatSeconds(totalIdle)}</td>
                  <td style={{ padding: '12px 10px', textAlign: 'right', color: '#f44336' }}>{formatSeconds(totalUntracked)}</td>
                  <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '4px 10px',
                      borderRadius: '10px',
                      fontSize: '13px',
                      fontWeight: 600,
                      backgroundColor: productivityRate >= 70 ? '#e8f5e9' : productivityRate >= 40 ? '#fff3e0' : '#ffebee',
                      color: productivityRate >= 70 ? '#2e7d32' : productivityRate >= 40 ? '#e65100' : '#c62828',
                    }}>
                      {productivityRate}%
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

const SummaryCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div style={{
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  }}>
    <div style={{ fontSize: '14px', color: '#666', fontWeight: 500, marginBottom: '10px' }}>{label}</div>
    <div style={{ fontSize: '32px', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case 'online': return '#4CAF50';
    case 'idle': return '#FF9800';
    case 'offline': return '#9e9e9e';
    default: return '#9e9e9e';
  }
}

function periodButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: active ? '#1976d2' : '#e0e0e0',
    color: active ? 'white' : '#333',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '15px',
  };
}

function legendDot(color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    backgroundColor: color,
    borderRadius: '2px',
    marginRight: '6px',
    verticalAlign: 'middle',
  };
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 10px',
  fontSize: '14px',
  color: '#666',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};
