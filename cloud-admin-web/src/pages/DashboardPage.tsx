/**
 * Dashboard Page Component
 * Requirements: 12.2 - Display same information as current Electron dashboard
 * Requirements: 12.4 - Show real-time updates via WebSocket subscription
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import type { WebSocketEvent } from '../services/websocket';
import type {
  DashboardStory,
  AttentionResponse,
  DeviceListItemEnhanced,
  TrendsResponse,
  RankingsResponse,
  AttentionGroup,
  AttentionType,
  TopAppEntry,
} from '../types/dashboard';
import { secondsToShort } from '../types/dashboard';
import { TodayStoryPanel } from '../components/dashboard/TodayStoryPanel';
import { KPICard } from '../components/dashboard/KPICard';
import { AttentionPanel } from '../components/dashboard/AttentionPanel';
import { TeamTable } from '../components/dashboard/TeamTable';
import { TrendChartPanel } from '../components/dashboard/TrendChartPanel';
import { RankingsPanel } from '../components/dashboard/RankingsPanel';
import { TopAppsPanel } from '../components/dashboard/TopAppsPanel';

type RangeType = 'today' | '7d';
type RiskFilter = 'all' | 'on_track' | 'at_risk' | 'critical';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeType>('today');
  const [story, setStory] = useState<DashboardStory | null>(null);
  const [attention, setAttention] = useState<AttentionResponse | null>(null);
  const [devices, setDevices] = useState<DeviceListItemEnhanced[]>([]);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [rankings, setRankings] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [trendScope, setTrendScope] = useState<'team' | 'device'>('team');
  const [selectedAttentionType, setSelectedAttentionType] = useState<AttentionType | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [storyData, attentionData, devicesData, trendsData, rankingsData] = await Promise.all([
        api.getDashboardStory(),
        api.getAttention(),
        api.getDevices(),
        api.getTrends(trendScope, selectedDevice || undefined, 7),
        api.getRankings(),
      ]);
      setStory(storyData);
      setAttention(attentionData);
      setDevices(devicesData || []);
      setTrends(trendsData);
      setRankings(rankingsData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [trendScope, selectedDevice]);

  // WebSocket connection for real-time updates
  const { isConnected } = useWebSocket({
    autoConnect: true,
    onEvent: useCallback((event: WebSocketEvent) => {
      // Handle real-time events
      if (event.type === 'device_status' || event.type === 'metrics_update') {
        // Refresh data when device status or metrics change
        loadData();
      } else if (event.type === 'attention_change') {
        // Refresh attention data
        api.getAttention().then(setAttention).catch(console.error);
      }
    }, [loadData]),
  });

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000); // Refresh every 15 seconds
    return () => clearInterval(interval);
  }, [loadData]);

  // Update trends when device selection changes
  useEffect(() => {
    if (selectedDevice) {
      setTrendScope('device');
    }
  }, [selectedDevice]);

  // Filter devices
  const filteredDevices = devices.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (riskFilter !== 'all' && d.performance.risk.label !== riskFilter) return false;
    if (searchQuery && !d.deviceName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedAttentionType) {
      const attentionGroup = attention?.groups.find((g) => g.type === selectedAttentionType);
      if (!attentionGroup || !attentionGroup.deviceIds.includes(d.deviceId)) return false;
    }
    return true;
  });

  const handleAttentionClick = (group: AttentionGroup) => {
    if (selectedAttentionType === group.type) {
      setSelectedAttentionType(null);
      setStatusFilter('all');
      setRiskFilter('all');
    } else {
      setSelectedAttentionType(group.type);
      setStatusFilter('all');
      setRiskFilter('all');
    }
  };

  const clearAttentionFilter = () => {
    setSelectedAttentionType(null);
    setStatusFilter('all');
    setRiskFilter('all');
  };

  // Compute totals from devices
  const totals = {
    online: devices.filter((d) => d.status === 'online').length,
    idle: devices.filter((d) => d.status === 'idle').length,
    offline: devices.filter((d) => d.status === 'offline').length,
    activeSeconds: devices.reduce((sum, d) => sum + d.today.activeSeconds, 0),
    idleSeconds: devices.reduce((sum, d) => sum + d.today.idleSeconds, 0),
    untrackedSeconds: devices.reduce((sum, d) => sum + d.today.untrackedSeconds, 0),
  };

  // Get top apps from devices
  const topApps: TopAppEntry[] = [];
  const appMap = new Map<string, number>();
  devices.forEach((d) => {
    d.topAppsToday.forEach((app) => {
      appMap.set(app.app, (appMap.get(app.app) || 0) + app.seconds);
    });
  });
  Array.from(appMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([app, seconds]) => {
      topApps.push({ app, seconds });
    });

  if (loading) {
    return (
      <div
        style={{
          padding: '40px',
          textAlign: 'center',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '24px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>Dashboard</h1>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '12px',
              fontSize: '10px',
              backgroundColor: isConnected ? '#e8f5e9' : '#fff3e0',
              color: isConnected ? '#2e7d32' : '#e65100',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: isConnected ? '#4CAF50' : '#FF9800',
              }}
            />
            {isConnected ? 'Live' : 'Connecting...'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <RangeButton active={range === 'today'} onClick={() => setRange('today')}>
            Today
          </RangeButton>
          <RangeButton active={range === '7d'} onClick={() => setRange('7d')}>
            7 Days
          </RangeButton>
        </div>
      </div>

      {/* Today Story + Health Score */}
      {story && <TodayStoryPanel story={story} onViewIssues={() => setRiskFilter('at_risk')} />}

      {/* KPI Cards Row */}
      <div
        className="kpi-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
          flexShrink: 0,
        }}
      >
        <KPICard title="Active Now" value={totals.online} color="#4CAF50" icon="🟢" />
        <KPICard title="Idle Now" value={totals.idle} color="#FF9800" icon="🟡" />
        <KPICard title="Offline" value={totals.offline} color="#9e9e9e" icon="⚫" />
        <KPICard
          title="Active Time"
          value={secondsToShort(totals.activeSeconds)}
          color="#2196F3"
          icon="⏱️"
          subtitle={range === 'today' ? 'Today' : '7 Days'}
        />
        <KPICard
          title="Idle Time"
          value={secondsToShort(totals.idleSeconds)}
          color="#FF9800"
          icon="💤"
          subtitle={range === 'today' ? 'Today' : '7 Days'}
        />
        <KPICard
          title="Untracked"
          value={secondsToShort(totals.untrackedSeconds)}
          color="#f44336"
          icon="❓"
          subtitle={range === 'today' ? 'Today' : '7 Days'}
        />
      </div>

      <div
        className="dashboard-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr minmax(280px, 340px)',
          gap: '20px',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* Attention Groups */}
          <AttentionPanel
            attention={attention || { groups: [], totalCount: 0 }}
            onClick={handleAttentionClick}
            selectedType={selectedAttentionType}
            onClearFilter={clearAttentionFilter}
            mode={story?.mode || 'NO_DEVICES'}
            onNavigate={(action) => {
              if (action === 'pairing') navigate('/pairing');
            }}
          />

          {/* Team Table */}
          <TeamTable
            devices={filteredDevices}
            allDevices={devices}
            selectedDevice={selectedDevice}
            onSelectDevice={setSelectedDevice}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            riskFilter={riskFilter}
            onRiskFilterChange={setRiskFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto', minHeight: 0 }}>
          {/* Trend Chart */}
          <TrendChartPanel
            trends={trends}
            scope={trendScope}
            onScopeChange={(s) => {
              setTrendScope(s);
              if (s === 'team') setSelectedDevice(null);
            }}
            selectedDeviceName={devices.find((d) => d.deviceId === selectedDevice)?.deviceName}
            hasHistory={story?.hasHistory7d ?? false}
          />

          {/* Rankings */}
          <RankingsPanel rankings={rankings} hasHistory={story?.hasHistory7d ?? false} />

          {/* Top Apps */}
          <TopAppsPanel apps={topApps} hasTopApps={story?.hasTopAppsToday ?? false} />
        </div>
      </div>
    </div>
  );
};

// Range Button Component
const RangeButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      padding: '8px 16px',
      borderRadius: '8px',
      border: 'none',
      backgroundColor: active ? '#1976d2' : '#e0e0e0',
      color: active ? 'white' : '#333',
      cursor: 'pointer',
      fontWeight: 500,
      transition: 'all 0.15s ease',
    }}
  >
    {children}
  </button>
);
