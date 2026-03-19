/**
 * Admin Console Dashboard - Manager-Grade Decision Dashboard
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only aggregated stats are displayed
 * - No raw window titles shown unless explicitly enabled
 * - All data is privacy-respecting
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  DashboardSummaryEnhanced,
  DeviceListItemEnhanced,
  DashboardStory,
  DashboardMode,
  AttentionResponse,
  AttentionGroup,
  AttentionType,
  RankingsResponse,
  TrendsResponse,
  RiskLabel,
  secondsToShort,
  tsToLocalTime,
  getRiskLabelDisplay,
  getHealthLabelDisplay,
  getModeHealthLabelDisplay,
  getAttentionEmptyMessage,
  formatDeltaPct,
} from '../../shared/dashboard-types';

type RangeType = 'today' | '7d' | '30d';
type RiskFilter = 'all' | 'on_track' | 'at_risk' | 'critical';

interface DashboardProps {
  onDeviceClick?: (deviceId: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onDeviceClick }) => {
  const [range, setRange] = useState<RangeType>('today');
  const [summary, setSummary] = useState<DashboardSummaryEnhanced | null>(null);
  const [devices, setDevices] = useState<DeviceListItemEnhanced[]>([]);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [trendScope, setTrendScope] = useState<'team' | 'device'>('team');
  const [selectedAttentionType, setSelectedAttentionType] = useState<AttentionType | null>(null);
  const teamOverviewRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      const results = await Promise.allSettled([
        window.adminAPI.getDashboardSummaryEnhanced(range),
        window.adminAPI.getDashboardDevicesEnhanced(),
        window.adminAPI.getTrends(trendScope, selectedDevice || undefined, 7),
      ]);
      const summaryData = results[0].status === 'fulfilled' ? results[0].value : null;
      const devicesData = results[1].status === 'fulfilled' ? results[1].value : null;
      const trendsData = results[2].status === 'fulfilled' ? results[2].value : null;

      if (summaryData) setSummary(summaryData);
      if (devicesData) setDevices(devicesData);
      if (trendsData) setTrends(trendsData);

      // Log any failures for debugging
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          const labels = ['summary', 'devices', 'trends'];
          console.error(`Failed to load dashboard ${labels[i]}:`, result.reason);
        }
      });
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [range, trendScope, selectedDevice]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Refresh every 5 seconds
    const unsubConnect = window.adminAPI.onDeviceConnected(() => loadData());
    const unsubDisconnect = window.adminAPI.onDeviceDisconnected(() => loadData());
    return () => {
      clearInterval(interval);
      unsubConnect();
      unsubDisconnect();
    };
  }, [loadData]);

  // Update trends when device selection changes
  useEffect(() => {
    if (selectedDevice) {
      setTrendScope('device');
    }
  }, [selectedDevice]);

  // Filter devices
  const filteredDevices = devices.filter(d => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (riskFilter !== 'all' && d.performance.risk.label !== riskFilter) return false;
    if (searchQuery && !d.deviceName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    // Filter by attention type if selected
    if (selectedAttentionType) {
      const attentionGroup = summary?.attention?.groups.find(g => g.type === selectedAttentionType);
      if (!attentionGroup || !attentionGroup.deviceIds.includes(d.deviceId)) return false;
    }
    return true;
  });

  const handleAttentionClick = (group: AttentionGroup) => {
    // Toggle attention type filter
    if (selectedAttentionType === group.type) {
      // Clear filter
      setSelectedAttentionType(null);
      setStatusFilter('all');
      setRiskFilter('all');
    } else {
      // Set filter to this attention type
      setSelectedAttentionType(group.type);
      setStatusFilter('all');
      // Auto-set risk filter based on severity
      if (group.severity === 'crit') {
        setRiskFilter('all'); // Show all to see the critical ones
      } else {
        setRiskFilter('all');
      }
    }
  };

  const clearAttentionFilter = () => {
    setSelectedAttentionType(null);
    setStatusFilter('all');
    setRiskFilter('all');
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Loading dashboard...</div>
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
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'clamp(16px, 2vw, 24px)', flexShrink: 0 }}>
        <h1 style={{ fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 600, margin: 0, color: '#1a1a2e' }}>Dashboard</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setRange('today')} style={rangeButtonStyle(range === 'today')}>Today</button>
          <button onClick={() => setRange('7d')} style={rangeButtonStyle(range === '7d')}>7 Days</button>
          <button onClick={() => setRange('30d')} style={rangeButtonStyle(range === '30d')}>30 Days</button>
        </div>
      </div>

      {/* Today Story + Health Score */}
      {summary?.story && <TodayStoryPanel story={summary.story} onViewIssues={() => {
        setRiskFilter('at_risk');
        setTimeout(() => teamOverviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      }} />}

      {/* KPI Cards Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'clamp(12px, 1.5vw, 16px)', marginBottom: 'clamp(16px, 2vw, 24px)', flexShrink: 0 }}>
        <KPICard title="Active Now" value={summary?.totals.online || 0} color="#4CAF50" icon="🟢" />
        <KPICard title="Idle Now" value={summary?.totals.idle || 0} color="#FF9800" icon="🟡" />
        <KPICard title="Offline" value={summary?.totals.offline || 0} color="#9e9e9e" icon="⚫" />
        {(() => {
          const totalDevices = Math.max(summary?.totals.devicesTotal || 1, 1);
          const activeS = summary?.totals.activeSeconds || 0;
          const idleS = summary?.totals.idleSeconds || 0;
          const tracked = activeS + idleS;
          const productivity = tracked > 0 ? Math.round((activeS / tracked) * 100) : 0;
          const avgActive = Math.round(activeS / totalDevices);
          const avgIdle = Math.round(idleS / totalDevices);
          const rangeLabel = range === 'today' ? 'Today' : range === '7d' ? '7 Days' : '30 Days';
          return (
            <>
              <KPICard title="Avg Active" value={secondsToShort(avgActive)} color="#2196F3" icon="⏱️" subtitle={`Per person · ${rangeLabel}`} />
              <KPICard title="Productivity" value={`${productivity}%`} color={productivity >= 70 ? '#4CAF50' : productivity >= 40 ? '#FF9800' : '#f44336'} icon="📊" subtitle={rangeLabel} />
              <KPICard title="Avg Idle" value={secondsToShort(avgIdle)} color="#FF9800" icon="💤" subtitle={`Per person · ${rangeLabel}`} />
            </>
          );
        })()}
      </div>

      <div className="dashboard-columns" style={{ display: 'flex', gap: 'clamp(16px, 2vw, 24px)', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Main Content - takes 65-70% */}
        <div className="dashboard-main" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', flex: '1 1 65%', minWidth: 0 }}>
          {/* Attention Groups - ALWAYS RENDER */}
          <AttentionPanel 
            attention={summary?.attention || { groups: [], totalCount: 0 }} 
            onClick={handleAttentionClick} 
            selectedType={selectedAttentionType}
            onClearFilter={clearAttentionFilter}
            mode={summary?.story?.mode || 'NO_DEVICES'}
          />

          {/* Team Table */}
          <div ref={teamOverviewRef} />
          <TeamTable
            devices={filteredDevices}
            allDevices={devices}
            selectedDevice={selectedDevice}
            onSelectDevice={setSelectedDevice}
            onDeviceClick={onDeviceClick}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            riskFilter={riskFilter}
            onRiskFilterChange={setRiskFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </div>

        {/* Sidebar - takes 30-35% */}
        <div className="dashboard-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(12px, 1.5vw, 16px)', overflow: 'auto', minHeight: 0, flex: '0 0 30%', minWidth: '280px', maxWidth: '400px' }}>
          {/* Trend Chart */}
          <TrendChartPanel
            trends={trends}
            scope={trendScope}
            onScopeChange={(s) => { setTrendScope(s); if (s === 'team') setSelectedDevice(null); }}
            selectedDeviceName={devices.find(d => d.deviceId === selectedDevice)?.deviceName}
            hasHistory={summary?.story?.hasHistory7d ?? false}
          />

          {/* Rankings */}
          <RankingsPanel 
            rankings={summary?.rankings || null} 
            hasHistory={summary?.story?.hasHistory7d ?? false}
          />

          {/* Top Apps */}
          <TopAppsPanel 
            apps={summary?.topApps || []} 
            hasTopApps={summary?.story?.hasTopAppsToday ?? false}
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Sub-Components
// ============================================================================

const rangeButtonStyle = (active: boolean): React.CSSProperties => ({
  padding: '12px 24px',
  borderRadius: '8px',
  border: 'none',
  backgroundColor: active ? '#1976d2' : '#e0e0e0',
  color: active ? 'white' : '#333',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '16px',
});

// Today Story Panel with Manager Sentence - MODE AWARE
const TodayStoryPanel: React.FC<{ story: DashboardStory; onViewIssues: () => void }> = ({ story, onViewIssues }) => {
  const healthDisplay = getModeHealthLabelDisplay(story.mode, story.healthLabel);
  
  // Determine manager sentence style based on content
  const isAtRisk = story.managerSentence.startsWith('At risk:');
  const isBehind = story.managerSentence.startsWith('Behind schedule:');
  const isWatch = story.managerSentence.startsWith('Watch:');
  const isPreShift = story.mode === 'PRE_SHIFT';
  const isWaiting = story.mode === 'NO_DATA_YET' || story.mode === 'NO_DEVICES';
  
  const sentenceColor = isAtRisk ? '#c62828' : isBehind ? '#e65100' : isWatch ? '#f57c00' : isPreShift ? '#1976d2' : isWaiting ? '#9e9e9e' : '#2e7d32';
  const sentenceBg = isAtRisk ? '#ffebee' : isBehind ? '#fff3e0' : isWatch ? '#fff8e1' : isPreShift ? '#e3f2fd' : isWaiting ? '#f5f5f5' : '#e8f5e9';
  
  // Format progress display
  const progressDisplay = story.progress.progressPctTeam !== null 
    ? `${Math.round(story.progress.progressPctTeam * 100)}%`
    : '—';
  
  // Format health score display
  const healthScoreDisplay = story.healthScore !== null ? story.healthScore : '—';
  
  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: 'clamp(16px, 2vw, 24px) clamp(20px, 2.5vw, 28px)',
      marginBottom: 'clamp(16px, 2vw, 24px)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      display: 'flex',
      gap: 'clamp(20px, 3vw, 32px)',
      alignItems: 'center',
      flexShrink: 0,
      flexWrap: 'wrap',
    }}>
      {/* Health Score */}
      <div style={{ textAlign: 'center', minWidth: '140px' }}>
        <div style={{ fontSize: '16px', color: '#666', marginBottom: '8px', fontWeight: 500 }}>Team Health</div>
        <div style={{ fontSize: '56px', fontWeight: 700, color: healthDisplay.color, lineHeight: 1 }}>{healthScoreDisplay}</div>
        <div style={{ fontSize: '18px', color: healthDisplay.color, fontWeight: 600, marginTop: '6px' }}>{healthDisplay.text}</div>
      </div>
      
      {/* Divider */}
      <div style={{ width: '1px', height: '90px', backgroundColor: '#e0e0e0' }} />
      
      {/* Manager Sentence + Insights */}
      <div style={{ flex: 1 }}>
        {/* Manager Sentence - prominent */}
        <div style={{
          padding: '14px 18px',
          borderRadius: '8px',
          backgroundColor: sentenceBg,
          marginBottom: '16px',
          borderLeft: `4px solid ${sentenceColor}`,
        }}>
          <div style={{ fontSize: '18px', fontWeight: 600, color: sentenceColor, lineHeight: 1.4 }}>
            {story.managerSentence}
          </div>
        </div>
        
        {/* Expected window microcopy */}
        {story.expected && (
          <div style={{ fontSize: '14px', color: '#888', marginBottom: '10px' }}>
            Expected: {story.expected.workStart}–{story.expected.workEnd} ({Math.round(story.expected.expectedTotalSeconds / 3600)}h)
            {story.expected.mixedPolicies && ' • mixed policies'}
          </div>
        )}
        
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px', color: '#555' }}>Today so far</div>
        <ul style={{ margin: 0, padding: '0 0 0 20px', fontSize: '15px', color: '#555', lineHeight: 1.7 }}>
          {story.bullets.slice(0, 4).map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      </div>
      
      {/* Progress + Actions */}
      <div style={{ textAlign: 'center', minWidth: '160px' }}>
        <div style={{ fontSize: '16px', color: '#666', marginBottom: '8px', fontWeight: 500 }}>Team Progress</div>
        <div style={{ fontSize: '44px', fontWeight: 700, color: story.mode === 'PRE_SHIFT' ? '#9e9e9e' : '#1976d2', lineHeight: 1 }}>
          {progressDisplay}
        </div>
        {story.progress.progressPctTeam !== null && (
          <div style={{ marginTop: '10px' }}><ProgressBarMini value={story.progress.progressPctTeam} /></div>
        )}
        {story.mode === 'PRE_SHIFT' && (
          <div style={{ fontSize: '14px', color: '#999', marginTop: '8px' }}>Pre-shift</div>
        )}
      </div>
    </div>
  );
};

// Progress Bar Mini
const ProgressBarMini: React.FC<{ value: number }> = ({ value }) => (
  <div style={{ width: '100%', height: '6px', backgroundColor: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
    <div style={{
      width: `${Math.min(100, Math.max(0, value * 100))}%`,
      height: '100%',
      backgroundColor: value >= 0.8 ? '#4CAF50' : value >= 0.5 ? '#FF9800' : '#f44336',
      transition: 'width 0.3s ease',
    }} />
  </div>
);

// KPI Card
const KPICard: React.FC<{ title: string; value: string | number; color: string; icon: string; subtitle?: string }> = 
  ({ title, value, color, icon, subtitle }) => (
  <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
      <span style={{ fontSize: '22px' }}>{icon}</span>
      <span style={{ fontSize: '16px', color: '#666', fontWeight: 500 }}>{title}</span>
    </div>
    <div style={{ fontSize: '42px', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
    {subtitle && <div style={{ fontSize: '14px', color: '#999', marginTop: '8px' }}>{subtitle}</div>}
  </div>
);

// Attention Panel with top offenders inline - ALWAYS RENDERS with empty states
const AttentionPanel: React.FC<{ 
  attention: AttentionResponse; 
  onClick: (g: AttentionGroup) => void;
  selectedType: AttentionType | null;
  onClearFilter: () => void;
  mode: DashboardMode;
}> = ({ attention, onClick, selectedType, onClearFilter, mode }) => {
  const emptyState = getAttentionEmptyMessage(mode);
  const hasIssues = attention.totalCount > 0;
  
  // Determine panel style based on state
  const panelBg = hasIssues ? '#fff3e0' : '#f5f5f5';
  const panelBorder = hasIssues ? '#ffcc80' : '#e0e0e0';
  const headerColor = hasIssues ? '#e65100' : '#666';
  const headerIcon = hasIssues ? '⚠️' : '✓';
  
  return (
    <div style={{
      backgroundColor: panelBg,
      borderRadius: '12px',
      padding: '20px 24px',
      marginBottom: '20px',
      border: `1px solid ${panelBorder}`,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hasIssues ? '16px' : '0' }}>
        <div style={{ fontSize: '18px', fontWeight: 600, color: headerColor }}>
          {headerIcon} Needs Attention {hasIssues ? `(${attention.totalCount})` : ''}
        </div>
        {selectedType && (
          <button
            onClick={onClearFilter}
            style={{
              padding: '8px 14px',
              fontSize: '14px',
              backgroundColor: '#fff',
              color: '#666',
              border: '1px solid #ddd',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Clear Filter ✕
          </button>
        )}
      </div>
      
      {hasIssues ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {attention.groups.map((group) => (
            <AttentionGroupCard 
              key={group.type} 
              group={group} 
              onClick={() => onClick(group)}
              isSelected={selectedType === group.type}
            />
          ))}
        </div>
      ) : (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          padding: '12px 0',
        }}>
          <span style={{ fontSize: '16px', color: '#666' }}>{emptyState.message}</span>
          {emptyState.cta && (
            <button
              onClick={() => {
                // Navigate to appropriate section
                if (emptyState.cta?.action === 'pairing') {
                  // Would navigate to pairing - for now just log
                  console.log('Navigate to pairing');
                } else if (emptyState.cta?.action === 'devices') {
                  console.log('Navigate to devices');
                }
              }}
              style={{
                padding: '10px 16px',
                fontSize: '15px',
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {emptyState.cta.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Attention Group Card with top offenders
const AttentionGroupCard: React.FC<{ 
  group: AttentionGroup; 
  onClick: () => void;
  isSelected: boolean;
}> = ({ group, onClick, isSelected }) => {
  const severityColors = {
    crit: { bg: '#ffebee', text: '#c62828', border: '#ef9a9a', icon: '🔴' },
    warn: { bg: '#fff3e0', text: '#e65100', border: '#ffcc80', icon: '🟠' },
    info: { bg: '#e3f2fd', text: '#1565c0', border: '#90caf9', icon: '🔵' },
  };
  const colors = severityColors[group.severity];
  
  return (
    <div
      onClick={onClick}
      style={{
        padding: '16px 18px',
        borderRadius: '10px',
        backgroundColor: isSelected ? colors.bg : 'white',
        border: `2px solid ${isSelected ? colors.text : colors.border}`,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: group.top.length > 0 ? '12px' : 0 }}>
        <span style={{ fontSize: '20px' }}>{colors.icon}</span>
        <span style={{ fontWeight: 700, fontSize: '22px', color: colors.text }}>{group.count}</span>
        <span style={{ fontSize: '16px', color: colors.text, fontWeight: 500 }}>{group.label}</span>
        {isSelected && (
          <span style={{ 
            marginLeft: 'auto', 
            fontSize: '13px', 
            padding: '5px 10px', 
            backgroundColor: colors.text, 
            color: 'white', 
            borderRadius: '4px',
            fontWeight: 500,
          }}>
            Filtering
          </span>
        )}
      </div>
      
      {/* Top offenders inline */}
      {group.top.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '32px' }}>
          {group.top.slice(0, 2).map((offender, i) => (
            <div key={offender.deviceId} style={{ 
              fontSize: '15px', 
              color: '#555',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <span style={{ color: '#999' }}>•</span>
              <span style={{ fontWeight: 500 }}>{offender.deviceName}</span>
              <span style={{ color: '#999' }}>—</span>
              <span style={{ color: colors.text, fontWeight: 500 }}>{offender.valueLabel}</span>
            </div>
          ))}
          {group.top.length > 2 && (
            <div style={{ fontSize: '14px', color: '#999', paddingLeft: '20px' }}>
              +{group.top.length - 2} more
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Risk Badge
const RiskBadge: React.FC<{ label: RiskLabel; score?: number }> = ({ label, score }) => {
  const display = getRiskLabelDisplay(label);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '6px 12px',
      borderRadius: '12px',
      fontSize: '14px',
      fontWeight: 600,
      backgroundColor: display.bgColor,
      color: display.color,
    }}>
      {display.text}
      {score !== undefined && <span style={{ opacity: 0.7 }}>({score})</span>}
    </span>
  );
};


// Team Table
const TeamTable: React.FC<{
  devices: DeviceListItemEnhanced[];
  allDevices: DeviceListItemEnhanced[];
  selectedDevice: string | null;
  onSelectDevice: (id: string | null) => void;
  onDeviceClick?: (deviceId: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  riskFilter: RiskFilter;
  onRiskFilterChange: (v: RiskFilter) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
}> = ({ devices, allDevices, selectedDevice, onSelectDevice, onDeviceClick, statusFilter, onStatusFilterChange, riskFilter, onRiskFilterChange, searchQuery, onSearchChange }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#4CAF50';
      case 'idle': return '#FF9800';
      case 'offline': return '#9e9e9e';
      default: return '#9e9e9e';
    }
  };

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: 'clamp(16px, 2vw, 24px)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
      width: '100%',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexShrink: 0, flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: 'clamp(18px, 2vw, 22px)', fontWeight: 600, margin: 0, color: '#1a1a2e' }}>Team Overview</h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '15px', width: 'clamp(120px, 15vw, 180px)' }}
          />
          <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)} style={selectStyle}>
            <option value="all">All Status</option>
            <option value="online">Online</option>
            <option value="idle">Idle</option>
            <option value="offline">Offline</option>
          </select>
          <select value={riskFilter} onChange={(e) => onRiskFilterChange(e.target.value as RiskFilter)} style={selectStyle}>
            <option value="all">All Risk</option>
            <option value="on_track">On Track</option>
            <option value="at_risk">At Risk</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, width: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'clamp(13px, 1.2vw, 15px)', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee', position: 'sticky', top: 0, backgroundColor: 'white' }}>
              <th style={thStyle}>Device</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Risk</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Progress</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Active</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Idle</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Untracked</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Start</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Δ 7d</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Policy</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '40px', color: '#666', fontSize: '16px' }}>
                  {allDevices.length === 0 ? 'No devices paired yet' : 'No devices match filters'}
                </td>
              </tr>
            ) : (
              devices.map((device) => {
                const activeDelta = formatDeltaPct(device.deltas.deltaActivePct);
                const untrackedDelta = formatDeltaPct(device.deltas.deltaUntrackedPct);
                
                return (
                  <tr
                    key={device.deviceId}
                    onClick={() => onSelectDevice(device.deviceId === selectedDevice ? null : device.deviceId)}
                    onDoubleClick={() => onDeviceClick?.(device.deviceId)}
                    style={{
                      borderBottom: '1px solid #f0f0f0',
                      cursor: 'pointer',
                      backgroundColor: selectedDevice === device.deviceId ? '#e3f2fd' : 'transparent',
                    }}
                  >
                    <td style={{ padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)' }}>
                      <div style={{ fontWeight: 600, fontSize: 'clamp(14px, 1.3vw, 16px)', color: '#333' }}>{device.deviceName}</div>
                      <div style={{ fontSize: 'clamp(11px, 1vw, 13px)', color: '#999' }}>v{device.appVersion}</div>
                    </td>
                    <td style={{ padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '6px 12px',
                        borderRadius: '12px',
                        fontSize: 'clamp(12px, 1.1vw, 14px)',
                        fontWeight: 500,
                        backgroundColor: `${getStatusColor(device.status)}20`,
                        color: getStatusColor(device.status),
                      }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: getStatusColor(device.status) }} />
                        {device.status}
                      </span>
                    </td>
                    <td style={{ padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)', textAlign: 'center' }}>
                      <RiskBadge label={device.performance.risk.label} />
                    </td>
                    <td style={{ padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                        <span style={{ fontSize: 'clamp(14px, 1.3vw, 16px)', fontWeight: 600 }}>{Math.round(device.performance.progressPct * 100)}%</span>
                        <div style={{ width: 'clamp(40px, 5vw, 60px)' }}><ProgressBarMini value={device.performance.progressPct} /></div>
                      </div>
                    </td>
                    <td style={{ padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)', textAlign: 'right', fontWeight: 600, fontSize: 'clamp(14px, 1.3vw, 16px)' }}>
                      {secondsToShort(device.today.activeSeconds)}
                    </td>
                    <td style={{ padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)', textAlign: 'right', color: '#FF9800', fontSize: 'clamp(14px, 1.3vw, 16px)' }}>
                      {secondsToShort(device.today.idleSeconds)}
                    </td>
                    <td style={{ padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)', textAlign: 'right', color: device.today.untrackedSeconds > 1800 ? '#f44336' : '#666', fontSize: 'clamp(14px, 1.3vw, 16px)' }}>
                      {secondsToShort(device.today.untrackedSeconds)}
                    </td>
                    <td style={{ padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)', textAlign: 'center', fontSize: 'clamp(13px, 1.2vw, 15px)' }}>
                      {device.today.firstActivityTs ? tsToLocalTime(device.today.firstActivityTs) : '—'}
                    </td>
                    <td style={{ padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                        <span style={{ fontSize: 'clamp(12px, 1.1vw, 14px)', color: activeDelta.color, fontWeight: 500 }}>{activeDelta.arrow} {activeDelta.text}</span>
                      </div>
                    </td>
                    <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                      {device.policy.id ? (
                        <span style={{
                          padding: '3px 6px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          backgroundColor: device.policy.compliant ? '#e8f5e9' : '#ffebee',
                          color: device.policy.compliant ? '#2e7d32' : '#c62828',
                        }}>
                          {device.policy.compliant ? '✓' : '⚠️'}
                        </span>
                      ) : (
                        <span style={{ fontSize: '10px', color: '#999' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const selectStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '8px',
  border: '1px solid #ddd',
  fontSize: '14px',
  minWidth: '100px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: 'clamp(10px, 1.2vw, 16px) clamp(6px, 0.8vw, 10px)',
  fontSize: 'clamp(13px, 1.2vw, 15px)',
  color: '#666',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

// Trend Chart Panel - with empty state
const TrendChartPanel: React.FC<{
  trends: TrendsResponse | null;
  scope: 'team' | 'device';
  onScopeChange: (s: 'team' | 'device') => void;
  selectedDeviceName?: string;
  hasHistory: boolean;
}> = ({ trends, scope, onScopeChange, selectedDeviceName, hasHistory }) => {
  if (!trends || trends.points.length === 0) {
    return (
      <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '14px', color: '#1a1a2e' }}>7-Day Trend</h3>
        <div style={{ fontSize: '16px', color: '#999', textAlign: 'center', padding: '28px' }}>
          {hasHistory ? 'No trend data available.' : 'No 7-day history yet.'}
        </div>
      </div>
    );
  }

  const maxValue = Math.max(...trends.points.map(d => d.activeSeconds + d.idleSeconds), 1);
  const barHeight = 70;

  const activeDelta = formatDeltaPct(trends.deltas.activePct);
  const untrackedDelta = formatDeltaPct(trends.deltas.untrackedPct);

  return (
    <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 600, margin: 0, color: '#1a1a2e' }}>
          7-Day Trend {scope === 'device' && selectedDeviceName && <span style={{ fontWeight: 400, color: '#666' }}>({selectedDeviceName})</span>}
        </h3>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => onScopeChange('team')} style={{ ...scopeButtonStyle, backgroundColor: scope === 'team' ? '#1976d2' : '#e0e0e0', color: scope === 'team' ? 'white' : '#333' }}>Team</button>
          <button onClick={() => onScopeChange('device')} style={{ ...scopeButtonStyle, backgroundColor: scope === 'device' ? '#1976d2' : '#e0e0e0', color: scope === 'device' ? 'white' : '#333' }} disabled={!selectedDeviceName}>Device</button>
        </div>
      </div>
      
      {/* Delta summary */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '16px', fontSize: '15px' }}>
        <span>Active <span style={{ color: activeDelta.color, fontWeight: 500 }}>{activeDelta.arrow}{activeDelta.text}</span></span>
        <span>Untracked <span style={{ color: untrackedDelta.color, fontWeight: 500 }}>{untrackedDelta.arrow}{untrackedDelta.text}</span></span>
      </div>

      {/* Chart */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: barHeight + 24 }}>
        {trends.points.map((day, i) => {
          const activeHeight = (day.activeSeconds / maxValue) * barHeight;
          const idleHeight = (day.idleSeconds / maxValue) * barHeight;
          const dayLabel = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' });
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column-reverse', height: barHeight }}>
                <div style={{ width: '100%', height: activeHeight, backgroundColor: '#4CAF50', borderRadius: '3px 3px 0 0' }} />
                <div style={{ width: '100%', height: idleHeight, backgroundColor: '#FF9800' }} />
              </div>
              <div style={{ fontSize: '13px', color: '#999', marginTop: '6px' }}>{dayLabel}</div>
            </div>
          );
        })}
      </div>
      
      {/* Legend */}
      <div style={{ display: 'flex', gap: '20px', marginTop: '14px', fontSize: '14px', color: '#666' }}>
        <span><span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: '#4CAF50', borderRadius: '2px', marginRight: '8px' }} />Active</span>
        <span><span style={{ display: 'inline-block', width: '12px', height: '12px', backgroundColor: '#FF9800', borderRadius: '2px', marginRight: '8px' }} />Idle</span>
      </div>
    </div>
  );
};

const scopeButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: '14px',
  borderRadius: '6px',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 500,
};

// Rankings Panel - with empty state
const RankingsPanel: React.FC<{ rankings: RankingsResponse | null; hasHistory: boolean }> = ({ rankings, hasHistory }) => {
  const hasData = rankings && (rankings.mostActive.length > 0 || rankings.biggestImprovement.length > 0);
  
  return (
    <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', flexShrink: 0 }}>
      <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '16px', color: '#1a1a2e' }}>Rankings</h3>
      
      {!hasData ? (
        <div style={{ fontSize: '15px', color: '#999', textAlign: 'center', padding: '24px' }}>
          {hasHistory ? 'No rankings data for today yet.' : 'No rankings yet.'}
        </div>
      ) : (
        <>
          {rankings!.mostActive.length > 0 && (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '15px', color: '#666', marginBottom: '10px', fontWeight: 500 }}>🏆 Most Active</div>
              {rankings!.mostActive.slice(0, 3).map((r, i) => (
                <div key={r.deviceId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', padding: '6px 0' }}>
                  <span>{i + 1}. {r.deviceName}</span>
                  <span style={{ color: '#4CAF50', fontWeight: 600 }}>{secondsToShort(r.value)}</span>
                </div>
              ))}
            </div>
          )}
          
          {rankings!.biggestImprovement.length > 0 && (
            <div>
              <div style={{ fontSize: '15px', color: '#666', marginBottom: '10px', fontWeight: 500 }}>📈 Biggest Improvement</div>
              {rankings!.biggestImprovement.slice(0, 3).map((r, i) => {
                const delta = formatDeltaPct(r.deltaPct || 0);
                return (
                  <div key={r.deviceId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', padding: '6px 0' }}>
                    <span>{i + 1}. {r.deviceName}</span>
                    <span style={{ color: delta.color, fontWeight: 600 }}>{delta.arrow}{delta.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Top Apps Panel - with mode-aware empty state
const TopAppsPanel: React.FC<{ apps: Array<{ app: string; seconds: number }>; hasTopApps: boolean }> = ({ apps, hasTopApps }) => (
  <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', flexShrink: 0 }}>
    <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '16px', color: '#1a1a2e' }}>Top Apps Today</h3>
    {apps.length > 0 ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {apps.slice(0, 6).map((app, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '16px', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '14px' }}>{app.app}</span>
            <span style={{ fontSize: '15px', color: '#666', flexShrink: 0, fontWeight: 500 }}>{secondsToShort(app.seconds)}</span>
          </div>
        ))}
      </div>
    ) : (
      <div style={{ fontSize: '15px', color: '#999', textAlign: 'center', padding: '24px' }}>
        {hasTopApps ? 'No app data yet today.' : 'No activity yet today.'}
      </div>
    )}
  </div>
);
