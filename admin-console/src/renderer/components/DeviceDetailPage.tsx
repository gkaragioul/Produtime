/**
 * Device Detail Page - Core Management View
 * 
 * The daily workhorse for managers. Answers:
 * - Did they work today?
 * - When did they start?
 * - Where did the time go?
 * - Is this normal for them?
 * - Why is the system worried?
 * - What can I do now?
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only aggregated stats are displayed
 * - No raw window titles or content
 * - All data is privacy-respecting
 */

import React, { useState, useEffect, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

interface TimelineBlock {
  startTs: number;
  endTs: number;
  type: 'active' | 'idle' | 'untracked';
  durationSeconds: number;
}

interface DailyHistoryEntry {
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
  late: boolean;
  firstActivityTs: number | null;
  productivityPct: number | null;
}

interface BehaviorStats {
  avgStartTime: string | null;
  avgStartMinutes: number | null;
  lateStarts7d: number;
  lateStarts14d: number;
  highUntrackedDays7d: number;
  highIdleDays7d: number;
  trackingOffDays7d: number;
  trend: 'improving' | 'stable' | 'declining';
  trendReason: string;
}

interface TopAppEntry {
  app: string;
  seconds: number;
  category?: 'productive' | 'neutral' | 'distracting';
}

interface ExceptionEntry {
  id: number;
  type: string;
  severity: 'info' | 'warn' | 'crit';
  date: string;
  details: any;
  resolved: boolean;
}

interface DeviceDetailData {
  device: {
    id: string;
    name: string;
    status: 'online' | 'idle' | 'offline';
    lastSeenTs: number;
    appVersion: string;
    ip: string;
    pairedAt: number;
    policyId: string | null;
    policyName: string | null;
    policyCompliant: boolean;
    riskLabel: 'on_track' | 'at_risk' | 'critical';
    riskScore: number;
    riskReasons: string[];
  };
  today: {
    activeSeconds: number;
    idleSeconds: number;
    untrackedSeconds: number;
    productiveSeconds: number;
    distractingSeconds: number;
    neutralSeconds: number;
    firstActivityTs: number | null;
    lastActivityTs: number | null;
    expectedSoFarSeconds: number;
    expectedTotalSeconds: number;
    progressPct: number;
    startDelayMinutes: number;
  };
  timelineToday: TimelineBlock[];
  hourlyToday: Array<{
    hour: number;
    activeSeconds: number;
    idleSeconds: number;
    untrackedSeconds: number;
  }>;
  dailyHistory: DailyHistoryEntry[];
  behaviorStats: BehaviorStats;
  topApps: {
    today: TopAppEntry[];
    week: TopAppEntry[];
  };
  exceptions: ExceptionEntry[];
  todaySentence: string;
  expected: {
    workStart: string;
    workEnd: string;
    graceMinutes: number;
  };
}

interface DeviceDetailPageProps {
  deviceId: string;
  onBack: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function secondsToHuman(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function secondsToShort(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function tsToTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getRiskColors(label: string): { bg: string; text: string; border: string } {
  switch (label) {
    case 'critical': return { bg: '#ffebee', text: '#c62828', border: '#ef9a9a' };
    case 'at_risk': return { bg: '#fff3e0', text: '#e65100', border: '#ffcc80' };
    default: return { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' };
  }
}

function getStatusColors(status: string): { bg: string; text: string; dot: string } {
  switch (status) {
    case 'online': return { bg: '#e8f5e9', text: '#2e7d32', dot: '#4CAF50' };
    case 'idle': return { bg: '#fff3e0', text: '#e65100', dot: '#FF9800' };
    default: return { bg: '#f5f5f5', text: '#666', dot: '#9e9e9e' };
  }
}

function getTrendIcon(trend: string): { icon: string; color: string } {
  switch (trend) {
    case 'improving': return { icon: '📈', color: '#4CAF50' };
    case 'declining': return { icon: '📉', color: '#f44336' };
    default: return { icon: '➡️', color: '#666' };
  }
}

// ============================================================================
// Main Component
// ============================================================================

export const DeviceDetailPage: React.FC<DeviceDetailPageProps> = ({ deviceId, onBack }) => {
  const [data, setData] = useState<DeviceDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const result = await window.adminAPI.getDeviceDetailEnhanced?.(deviceId, range);
      if (result) {
        setData(result);
      } else {
        // Fallback to basic detail
        const basic = await window.adminAPI.getDeviceDetail(deviceId, range === '30d' ? '7d' : range);
        if (basic) {
          setData(transformBasicToEnhanced(basic, deviceId));
        }
      }
    } catch (error) {
      console.error('Failed to load device detail:', error);
    } finally {
      setLoading(false);
    }
  }, [deviceId, range]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleAction = async (action: string) => {
    setActionStatus(`Executing ${action}...`);
    try {
      switch (action) {
        case 'refresh':
          await loadData();
          setActionStatus('Data refreshed');
          break;
        case 'lock':
          await window.adminAPI.lockDevice(deviceId, 'admin_action', 'Locked by administrator');
          setActionStatus('Device locked');
          break;
        case 'unlock':
          await window.adminAPI.unlockDevice(deviceId);
          setActionStatus('Device unlocked');
          break;
        case 'export':
          await window.adminAPI.requestExport(deviceId, { format: 'pdf', range });
          setActionStatus('Export requested');
          break;
        default:
          setActionStatus('Action not implemented');
      }
    } catch (error) {
      setActionStatus('Action failed');
    }
    setTimeout(() => setActionStatus(null), 3000);
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Loading device details...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ marginBottom: '16px', fontSize: '16px' }}>Device not found</div>
        <button onClick={onBack} style={backButtonStyle}>← Back to Dashboard</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto', boxSizing: 'border-box' }}>
      {/* Back Button + Range Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <button onClick={onBack} style={backButtonStyle}>← Back to Dashboard</button>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['today', '7d', '30d'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: range === r ? '#1976d2' : '#e0e0e0',
                color: range === r ? 'white' : '#333',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {r === 'today' ? 'Today' : r === '7d' ? '7 Days' : '30 Days'}
            </button>
          ))}
        </div>
      </div>

      {/* A) HEADER - Identity & Status */}
      <HeaderSection device={data.device} todaySentence={data.todaySentence} />

      {/* B) TODAY SNAPSHOT */}
      <TodaySnapshotSection today={data.today} expected={data.expected} riskReasons={data.device.riskReasons} />

      {/* C) TIMELINE */}
      <TimelineSection hourlyData={data.hourlyToday} expected={data.expected} />

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
        {/* D) TRENDS */}
        <TrendsSection dailyHistory={data.dailyHistory} behaviorStats={data.behaviorStats} />

        {/* E) BEHAVIOR HISTORY */}
        <BehaviorHistorySection 
          behaviorStats={data.behaviorStats} 
          exceptions={data.exceptions}
          dailyHistory={data.dailyHistory}
        />
      </div>

      {/* F) TOP APPS */}
      <TopAppsSection topApps={data.topApps} />

      {/* G) ACTIONS */}
      <ActionsSection 
        device={data.device} 
        onAction={handleAction} 
        actionStatus={actionStatus}
      />
    </div>
  );
};

// ============================================================================
// A) HEADER SECTION
// ============================================================================

const HeaderSection: React.FC<{
  device: DeviceDetailData['device'];
  todaySentence: string;
}> = ({ device, todaySentence }) => {
  const riskColors = getRiskColors(device.riskLabel);
  const statusColors = getStatusColors(device.status);
  
  const riskLabels = {
    on_track: 'On Track',
    at_risk: 'At Risk',
    critical: 'Critical',
  };

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        {/* Left: Device Info */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>{device.name}</h1>
            
            {/* Status Badge */}
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 500,
              backgroundColor: statusColors.bg,
              color: statusColors.text,
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: statusColors.dot }} />
              {device.status.charAt(0).toUpperCase() + device.status.slice(1)}
            </span>
            
            {/* Version */}
            <span style={{ fontSize: '12px', color: '#999' }}>v{device.appVersion}</span>
          </div>
          
          <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
            Last seen: {tsToTime(device.lastSeenTs)} • IP: {device.ip}
          </div>
          
          <div style={{ fontSize: '12px', color: '#999' }}>
            Paired: {new Date(device.pairedAt).toLocaleDateString()}
            {device.policyName && (
              <span>
                {' • Policy: '}
                <span style={{ color: device.policyCompliant ? '#2e7d32' : '#c62828' }}>
                  {device.policyName}
                  {!device.policyCompliant && ' ⚠️'}
                </span>
              </span>
            )}
          </div>
        </div>
        
        {/* Right: Risk Badge */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '8px',
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            borderRadius: '20px',
            fontSize: '14px',
            fontWeight: 600,
            backgroundColor: riskColors.bg,
            color: riskColors.text,
            border: `2px solid ${riskColors.border}`,
          }}>
            {device.riskLabel === 'critical' && '🔴'}
            {device.riskLabel === 'at_risk' && '🟠'}
            {device.riskLabel === 'on_track' && '🟢'}
            {riskLabels[device.riskLabel]}
            <span style={{ opacity: 0.7, fontSize: '12px' }}>({device.riskScore})</span>
          </div>
        </div>
      </div>
      
      {/* Today Sentence */}
      <div style={{
        marginTop: '16px',
        padding: '14px 18px',
        borderRadius: '8px',
        backgroundColor: riskColors.bg,
        borderLeft: `4px solid ${riskColors.text}`,
      }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: riskColors.text }}>
          {todaySentence}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// B) TODAY SNAPSHOT SECTION
// ============================================================================

const TodaySnapshotSection: React.FC<{
  today: DeviceDetailData['today'];
  expected: DeviceDetailData['expected'];
  riskReasons: string[];
}> = ({ today, expected, riskReasons }) => {
  const startTime = today.firstActivityTs ? tsToTime(today.firstActivityTs) : '—';
  const progressPct = Math.round(today.progressPct * 100);
  
  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Today's Snapshot</h2>
      
      {/* Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '16px' }}>
        <MetricCard 
          label="Active" 
          value={secondsToHuman(today.activeSeconds)} 
          color="#4CAF50" 
          icon="⏱️"
          subtitle="Time working"
        />
        <MetricCard 
          label="Idle" 
          value={secondsToHuman(today.idleSeconds)} 
          color="#FF9800" 
          icon="💤"
          subtitle="Away from keyboard"
        />
        <MetricCard 
          label="Untracked" 
          value={secondsToHuman(today.untrackedSeconds)} 
          color={today.untrackedSeconds > 1800 ? '#f44336' : '#666'} 
          icon="❓"
          subtitle="Gaps in tracking"
        />
        <MetricCard 
          label="Start Time" 
          value={startTime} 
          color={today.startDelayMinutes > 0 ? '#e65100' : '#2196F3'} 
          icon="🕐"
          subtitle={today.startDelayMinutes > 0 ? `${today.startDelayMinutes}m late` : 'On time'}
        />
        <MetricCard 
          label="Progress" 
          value={`${progressPct}%`} 
          color={progressPct >= 80 ? '#4CAF50' : progressPct >= 50 ? '#FF9800' : '#f44336'} 
          icon="📊"
          subtitle="vs expected"
        />
        <MetricCard 
          label="Expected" 
          value={secondsToHuman(today.expectedTotalSeconds)} 
          color="#666" 
          icon="🎯"
          subtitle={`${expected.workStart}–${expected.workEnd}`}
        />
      </div>
      
      {/* Progress Bar */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>Progress vs Expected ({secondsToShort(today.expectedSoFarSeconds)} expected so far)</span>
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{progressPct}%</span>
        </div>
        <div style={{ height: '10px', backgroundColor: '#e0e0e0', borderRadius: '5px', overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(100, progressPct)}%`,
            height: '100%',
            backgroundColor: progressPct >= 80 ? '#4CAF50' : progressPct >= 50 ? '#FF9800' : '#f44336',
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>
      
      {/* Risk Reasons */}
      {riskReasons.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>Risk Factors</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {riskReasons.map((reason, i) => (
              <span key={i} style={{
                padding: '6px 12px',
                borderRadius: '16px',
                fontSize: '11px',
                backgroundColor: '#fff3e0',
                color: '#e65100',
                border: '1px solid #ffcc80',
              }}>
                ⚠️ {reason}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: string;
  color: string;
  icon: string;
  subtitle?: string;
}> = ({ label, value, color, icon, subtitle }) => (
  <div style={{
    padding: '14px',
    borderRadius: '10px',
    backgroundColor: '#f8f9fa',
    textAlign: 'center',
    border: '1px solid #eee',
  }}>
    <div style={{ fontSize: '18px', marginBottom: '4px' }}>{icon}</div>
    <div style={{ fontSize: '20px', fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>{label}</div>
    {subtitle && <div style={{ fontSize: '9px', color: '#999', marginTop: '2px' }}>{subtitle}</div>}
  </div>
);

// ============================================================================
// C) TIMELINE SECTION - Hourly stacked bars visualization
// ============================================================================

const TimelineSection: React.FC<{
  hourlyData: DeviceDetailData['hourlyToday'];
  expected: DeviceDetailData['expected'];
}> = ({ hourlyData, expected }) => {
  if (hourlyData.length === 0) {
    return (
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Today's Timeline</h2>
        <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📅</div>
          <div>No activity data yet today.</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Timeline will appear as work is tracked.</div>
        </div>
      </div>
    );
  }

  const maxSeconds = Math.max(...hourlyData.map(h => h.activeSeconds + h.idleSeconds + h.untrackedSeconds), 3600);
  const currentHour = new Date().getHours();

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Today's Timeline</h2>
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '12px', backgroundColor: '#4CAF50', borderRadius: '2px' }} />
            Active
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '12px', backgroundColor: '#FF9800', borderRadius: '2px' }} />
            Idle
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '12px', backgroundColor: '#e0e0e0', borderRadius: '2px' }} />
            Untracked
          </span>
        </div>
      </div>

      {/* Hourly Bars */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '120px', marginBottom: '8px' }}>
        {hourlyData.map((hour, i) => {
          const total = hour.activeSeconds + hour.idleSeconds + hour.untrackedSeconds;
          const height = total > 0 ? (total / maxSeconds) * 100 : 0;
          const activeHeight = total > 0 ? (hour.activeSeconds / total) * 100 : 0;
          const idleHeight = total > 0 ? (hour.idleSeconds / total) * 100 : 0;
          const isCurrent = hour.hour === currentHour;
          const isFuture = hour.hour > currentHour;

          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                opacity: isFuture ? 0.3 : 1,
              }}
              title={`${hour.hour}:00 - Active: ${secondsToShort(hour.activeSeconds)}, Idle: ${secondsToShort(hour.idleSeconds)}, Untracked: ${secondsToShort(hour.untrackedSeconds)}`}
            >
              <div style={{
                width: '100%',
                height: `${height}%`,
                minHeight: total > 0 ? '4px' : '0',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: '3px',
                overflow: 'hidden',
                border: isCurrent ? '2px solid #1976d2' : 'none',
                boxSizing: 'border-box',
              }}>
                <div style={{ height: `${activeHeight}%`, backgroundColor: '#4CAF50' }} />
                <div style={{ height: `${idleHeight}%`, backgroundColor: '#FF9800' }} />
                <div style={{ flex: 1, backgroundColor: '#e0e0e0' }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour Labels */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {hourlyData.map((hour, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '10px', color: '#999' }}>
            {hour.hour}
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// D) TRENDS SECTION - 7-day chart with behavior stats
// ============================================================================

const TrendsSection: React.FC<{
  dailyHistory: DailyHistoryEntry[];
  behaviorStats: BehaviorStats;
}> = ({ dailyHistory, behaviorStats }) => {
  const trendInfo = getTrendIcon(behaviorStats.trend);
  const maxSeconds = Math.max(...dailyHistory.map(d => d.activeSeconds + d.idleSeconds + d.untrackedSeconds), 28800);

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>7-Day Trends</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>{trendInfo.icon}</span>
          <span style={{ fontSize: '12px', color: trendInfo.color, fontWeight: 500 }}>
            {behaviorStats.trend.charAt(0).toUpperCase() + behaviorStats.trend.slice(1)}
          </span>
        </div>
      </div>

      {dailyHistory.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>
          <div>No historical data available yet.</div>
        </div>
      ) : (
        <>
          {/* Mini Chart */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', height: '80px', marginBottom: '12px' }}>
            {dailyHistory.slice(0, 7).reverse().map((day, i) => {
              const total = day.activeSeconds + day.idleSeconds + day.untrackedSeconds;
              const height = total > 0 ? (total / maxSeconds) * 100 : 0;
              const activeHeight = total > 0 ? (day.activeSeconds / total) * 100 : 0;
              const idleHeight = total > 0 ? (day.idleSeconds / total) * 100 : 0;

              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: '100%',
                    height: `${height}%`,
                    minHeight: total > 0 ? '4px' : '0',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}>
                    <div style={{ height: `${activeHeight}%`, backgroundColor: '#4CAF50' }} />
                    <div style={{ height: `${idleHeight}%`, backgroundColor: '#FF9800' }} />
                    <div style={{ flex: 1, backgroundColor: '#e0e0e0' }} />
                  </div>
                  <div style={{ fontSize: '9px', color: '#999', marginTop: '4px' }}>
                    {formatDate(day.date).split(' ')[0]}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Stats Summary */}
          <div style={{ borderTop: '1px solid #eee', paddingTop: '12px' }}>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>{behaviorStats.trendReason}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
              <div>
                <span style={{ color: '#999' }}>Avg Start: </span>
                <span style={{ fontWeight: 500 }}>{behaviorStats.avgStartTime || '—'}</span>
              </div>
              <div>
                <span style={{ color: '#999' }}>Late Starts (7d): </span>
                <span style={{ fontWeight: 500, color: behaviorStats.lateStarts7d > 2 ? '#e65100' : 'inherit' }}>
                  {behaviorStats.lateStarts7d}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// E) BEHAVIOR HISTORY SECTION - Late starts, high untracked, tracking off
// ============================================================================

const BehaviorHistorySection: React.FC<{
  behaviorStats: BehaviorStats;
  exceptions: ExceptionEntry[];
  dailyHistory: DailyHistoryEntry[];
}> = ({ behaviorStats, exceptions, dailyHistory }) => {
  const lateDays = dailyHistory.filter(d => d.late).slice(0, 5);
  const highUntrackedDays = dailyHistory.filter(d => d.untrackedSeconds > 1800).slice(0, 5);
  const unresolvedExceptions = exceptions.filter(e => !e.resolved).slice(0, 5);

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Behavior History</h2>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
        <div style={{ textAlign: 'center', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: behaviorStats.lateStarts14d > 3 ? '#e65100' : '#333' }}>
            {behaviorStats.lateStarts14d}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>Late Starts (14d)</div>
        </div>
        <div style={{ textAlign: 'center', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: behaviorStats.highUntrackedDays7d > 2 ? '#f44336' : '#333' }}>
            {behaviorStats.highUntrackedDays7d}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>High Untracked (7d)</div>
        </div>
        <div style={{ textAlign: 'center', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: behaviorStats.trackingOffDays7d > 0 ? '#c62828' : '#333' }}>
            {behaviorStats.trackingOffDays7d}
          </div>
          <div style={{ fontSize: '11px', color: '#666' }}>Tracking Off (7d)</div>
        </div>
      </div>

      {/* Recent Issues */}
      {unresolvedExceptions.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 500, color: '#666', marginBottom: '8px' }}>Recent Issues</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {unresolvedExceptions.map(ex => (
              <div key={ex.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                backgroundColor: ex.severity === 'crit' ? '#ffebee' : ex.severity === 'warn' ? '#fff3e0' : '#f5f5f5',
                borderRadius: '6px',
                fontSize: '12px',
              }}>
                <span>{ex.severity === 'crit' ? '🔴' : ex.severity === 'warn' ? '🟠' : '🔵'}</span>
                <span style={{ flex: 1 }}>{ex.type.replace(/_/g, ' ')}</span>
                <span style={{ color: '#999' }}>{ex.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Late Days List */}
      {lateDays.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 500, color: '#666', marginBottom: '8px' }}>Recent Late Starts</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {lateDays.map((day, i) => (
              <span key={i} style={{
                padding: '4px 10px',
                backgroundColor: '#fff3e0',
                borderRadius: '12px',
                fontSize: '11px',
                color: '#e65100',
              }}>
                {formatDate(day.date)}
              </span>
            ))}
          </div>
        </div>
      )}

      {unresolvedExceptions.length === 0 && lateDays.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#999', fontSize: '13px' }}>
          ✓ No behavioral issues in recent history
        </div>
      )}
    </div>
  );
};

// ============================================================================
// F) TOP APPS SECTION - Today and week top apps with categories
// ============================================================================

const TopAppsSection: React.FC<{
  topApps: DeviceDetailData['topApps'];
}> = ({ topApps }) => {
  const getCategoryColor = (category?: string) => {
    switch (category) {
      case 'productive': return { bg: '#e8f5e9', text: '#2e7d32' };
      case 'distracting': return { bg: '#ffebee', text: '#c62828' };
      default: return { bg: '#f5f5f5', text: '#666' };
    }
  };

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case 'productive': return '✓';
      case 'distracting': return '⚠';
      default: return '•';
    }
  };

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      marginTop: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Top Applications</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Today's Apps */}
        <div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#666', marginBottom: '12px' }}>Today</div>
          {topApps.today.length === 0 ? (
            <div style={{ color: '#999', fontSize: '12px', padding: '12px', textAlign: 'center' }}>
              No app data yet today
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topApps.today.slice(0, 5).map((app, i) => {
                const colors = getCategoryColor(app.category);
                return (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    backgroundColor: colors.bg,
                    borderRadius: '6px',
                  }}>
                    <span style={{ fontSize: '12px', color: colors.text }}>{getCategoryIcon(app.category)}</span>
                    <span style={{ flex: 1, fontSize: '13px', fontWeight: 500 }}>{app.app}</span>
                    <span style={{ fontSize: '12px', color: '#666' }}>{secondsToShort(app.seconds)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Week's Apps */}
        <div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#666', marginBottom: '12px' }}>This Week</div>
          {topApps.week.length === 0 ? (
            <div style={{ color: '#999', fontSize: '12px', padding: '12px', textAlign: 'center' }}>
              No app data this week
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topApps.week.slice(0, 5).map((app, i) => {
                const colors = getCategoryColor(app.category);
                return (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    backgroundColor: colors.bg,
                    borderRadius: '6px',
                  }}>
                    <span style={{ fontSize: '12px', color: colors.text }}>{getCategoryIcon(app.category)}</span>
                    <span style={{ flex: 1, fontSize: '13px', fontWeight: 500 }}>{app.app}</span>
                    <span style={{ fontSize: '12px', color: '#666' }}>{secondsToShort(app.seconds)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// G) ACTIONS SECTION - Refresh, export, lock/unlock, policy actions
// ============================================================================

const ActionsSection: React.FC<{
  device: DeviceDetailData['device'];
  onAction: (action: string) => void;
  actionStatus: string | null;
}> = ({ device, onAction, actionStatus }) => {
  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      marginTop: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Actions</h2>
        {actionStatus && (
          <span style={{ fontSize: '12px', color: '#1976d2', fontWeight: 500 }}>{actionStatus}</span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        <ActionButton icon="🔄" label="Refresh Data" onClick={() => onAction('refresh')} />
        <ActionButton icon="📄" label="Export PDF" onClick={() => onAction('export')} />
        <ActionButton 
          icon="🔒" 
          label="Lock Device" 
          onClick={() => onAction('lock')} 
          variant="warning"
        />
        <ActionButton 
          icon="🔓" 
          label="Unlock Device" 
          onClick={() => onAction('unlock')} 
        />
        {device.policyName && (
          <ActionButton 
            icon="📋" 
            label={`Policy: ${device.policyName}`} 
            onClick={() => {}} 
            disabled
          />
        )}
      </div>

      {/* Device Info Footer */}
      <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #eee', fontSize: '11px', color: '#999' }}>
        Device ID: {device.id} • Version: {device.appVersion} • IP: {device.ip}
      </div>
    </div>
  );
};

const ActionButton: React.FC<{
  icon: string;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'warning' | 'danger';
  disabled?: boolean;
}> = ({ icon, label, onClick, variant = 'default', disabled = false }) => {
  const colors = {
    default: { bg: '#f5f5f5', hover: '#e0e0e0', text: '#333' },
    warning: { bg: '#fff3e0', hover: '#ffe0b2', text: '#e65100' },
    danger: { bg: '#ffebee', hover: '#ffcdd2', text: '#c62828' },
  };
  const c = colors[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 16px',
        borderRadius: '8px',
        border: 'none',
        backgroundColor: disabled ? '#f5f5f5' : c.bg,
        color: disabled ? '#999' : c.text,
        cursor: disabled ? 'default' : 'pointer',
        fontSize: '13px',
        fontWeight: 500,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
};

// ============================================================================
// Helper: Transform basic API response to enhanced format
// ============================================================================

function transformBasicToEnhanced(basic: any, deviceId: string): DeviceDetailData {
  // Transform basic device detail response to enhanced format
  // This is a fallback when getDeviceDetailEnhanced is not available
  const now = Date.now();
  const todayYmd = new Date().toISOString().split('T')[0];

  return {
    device: {
      id: deviceId,
      name: basic.device?.name || basic.deviceName || deviceId,
      status: basic.device?.status || 'offline',
      lastSeenTs: basic.device?.lastSeenTs || now,
      appVersion: basic.device?.appVersion || '',
      ip: basic.device?.ip || '',
      pairedAt: basic.device?.pairedAt || now,
      policyId: basic.device?.policyId || null,
      policyName: basic.device?.policyName || null,
      policyCompliant: basic.device?.policyCompliant ?? true,
      riskLabel: basic.riskLabel || 'on_track',
      riskScore: basic.riskScore || 0,
      riskReasons: basic.riskReasons || [],
    },
    today: {
      activeSeconds: basic.today?.activeSeconds || basic.activeSeconds || 0,
      idleSeconds: basic.today?.idleSeconds || basic.idleSeconds || 0,
      untrackedSeconds: basic.today?.untrackedSeconds || basic.untrackedSeconds || 0,
      productiveSeconds: basic.today?.productiveSeconds || 0,
      distractingSeconds: basic.today?.distractingSeconds || 0,
      neutralSeconds: basic.today?.neutralSeconds || 0,
      firstActivityTs: basic.today?.firstActivityTs || basic.firstActivityTs || null,
      lastActivityTs: basic.today?.lastActivityTs || basic.lastActivityTs || null,
      expectedSoFarSeconds: basic.today?.expectedSoFarSeconds || 0,
      expectedTotalSeconds: basic.today?.expectedTotalSeconds || 28800,
      progressPct: basic.today?.progressPct || basic.progressPct || 0,
      startDelayMinutes: basic.today?.startDelayMinutes || 0,
    },
    timelineToday: basic.timelineToday || [],
    hourlyToday: basic.hourlyToday || [],
    dailyHistory: basic.dailyHistory || basic.history || [],
    behaviorStats: basic.behaviorStats || {
      avgStartTime: null,
      avgStartMinutes: null,
      lateStarts7d: 0,
      lateStarts14d: 0,
      highUntrackedDays7d: 0,
      highIdleDays7d: 0,
      trackingOffDays7d: 0,
      trend: 'stable',
      trendReason: 'Not enough data',
    },
    topApps: basic.topApps || { today: [], week: [] },
    exceptions: basic.exceptions || [],
    todaySentence: basic.todaySentence || basic.sentence || 'No data available.',
    expected: basic.expected || {
      workStart: '09:00',
      workEnd: '18:00',
      graceMinutes: 15,
    },
  };
}

// ============================================================================
// Styles
// ============================================================================

const backButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '6px',
  border: 'none',
  backgroundColor: '#f5f5f5',
  color: '#333',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
};
