/**
 * Team Table Component
 * Displays device list with performance metrics
 */

import React from 'react';
import type { DeviceListItemEnhanced, RiskLabel } from '../../types/dashboard';
import { secondsToShort, tsToLocalTime, getRiskLabelDisplay, formatDeltaPct } from '../../types/dashboard';

type RiskFilter = 'all' | 'on_track' | 'at_risk' | 'critical';

interface TeamTableProps {
  devices: DeviceListItemEnhanced[];
  allDevices: DeviceListItemEnhanced[];
  selectedDevice: string | null;
  onSelectDevice: (id: string | null) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  riskFilter: RiskFilter;
  onRiskFilterChange: (v: RiskFilter) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
}

export const TeamTable: React.FC<TeamTableProps> = ({
  devices,
  allDevices,
  selectedDevice,
  onSelectDevice,
  statusFilter,
  onStatusFilterChange,
  riskFilter,
  onRiskFilterChange,
  searchQuery,
  onSearchChange,
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return '#4CAF50';
      case 'idle':
        return '#FF9800';
      case 'offline':
        return '#9e9e9e';
      default:
        return '#9e9e9e';
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: '10px',
        padding: '16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexShrink: 0,
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <h2 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>Team Overview</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #ddd',
              fontSize: '12px',
              width: '140px',
            }}
          />
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            style={selectStyle}
          >
            <option value="all">All Status</option>
            <option value="online">Online</option>
            <option value="idle">Idle</option>
            <option value="offline">Offline</option>
          </select>
          <select
            value={riskFilter}
            onChange={(e) => onRiskFilterChange(e.target.value as RiskFilter)}
            style={selectStyle}
          >
            <option value="all">All Risk</option>
            <option value="on_track">On Track</option>
            <option value="at_risk">At Risk</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
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
                <td colSpan={10} style={{ textAlign: 'center', padding: '30px', color: '#666' }}>
                  {allDevices.length === 0 ? 'No devices paired yet' : 'No devices match filters'}
                </td>
              </tr>
            ) : (
              devices.map((device) => {
                const activeDelta = formatDeltaPct(device.deltas.deltaActivePct);

                return (
                  <tr
                    key={device.deviceId}
                    onClick={() => onSelectDevice(device.deviceId === selectedDevice ? null : device.deviceId)}
                    style={{
                      borderBottom: '1px solid #f5f5f5',
                      cursor: 'pointer',
                      backgroundColor: selectedDevice === device.deviceId ? '#e3f2fd' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px 6px' }}>
                      <div style={{ fontWeight: 500, fontSize: '12px' }}>{device.deviceName}</div>
                      <div style={{ fontSize: '10px', color: '#999' }}>v{device.appVersion}</div>
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '3px 8px',
                          borderRadius: '10px',
                          fontSize: '10px',
                          fontWeight: 500,
                          backgroundColor: `${getStatusColor(device.status)}20`,
                          color: getStatusColor(device.status),
                        }}
                      >
                        <span
                          style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            backgroundColor: getStatusColor(device.status),
                          }}
                        />
                        {device.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                      <RiskBadge label={device.performance.risk.label} />
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                        <span style={{ fontSize: '11px', fontWeight: 500 }}>
                          {Math.round(device.performance.progressPct * 100)}%
                        </span>
                        <div style={{ width: '40px' }}>
                          <ProgressBarMini value={device.performance.progressPct} />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 500 }}>
                      {secondsToShort(device.today.activeSeconds)}
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', color: '#FF9800' }}>
                      {secondsToShort(device.today.idleSeconds)}
                    </td>
                    <td
                      style={{
                        padding: '10px 6px',
                        textAlign: 'right',
                        color: device.today.untrackedSeconds > 1800 ? '#f44336' : '#666',
                      }}
                    >
                      {secondsToShort(device.today.untrackedSeconds)}
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'center', fontSize: '11px' }}>
                      {device.today.firstActivityTs ? tsToLocalTime(device.today.firstActivityTs) : '—'}
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                        <span style={{ fontSize: '10px', color: activeDelta.color }}>
                          {activeDelta.arrow} {activeDelta.text}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                      {device.policy.id ? (
                        <span
                          style={{
                            padding: '3px 6px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            backgroundColor: device.policy.compliant ? '#e8f5e9' : '#ffebee',
                            color: device.policy.compliant ? '#2e7d32' : '#c62828',
                          }}
                        >
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

// Risk Badge
const RiskBadge: React.FC<{ label: RiskLabel; score?: number }> = ({ label, score }) => {
  const display = getRiskLabelDisplay(label);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 8px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 600,
        backgroundColor: display.bgColor,
        color: display.color,
      }}
    >
      {display.text}
      {score !== undefined && <span style={{ opacity: 0.7 }}>({score})</span>}
    </span>
  );
};

// Progress Bar Mini
const ProgressBarMini: React.FC<{ value: number }> = ({ value }) => (
  <div style={{ width: '100%', height: '6px', backgroundColor: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
    <div
      style={{
        width: `${Math.min(100, Math.max(0, value * 100))}%`,
        height: '100%',
        backgroundColor: value >= 0.8 ? '#4CAF50' : value >= 0.5 ? '#FF9800' : '#f44336',
        transition: 'width 0.3s ease',
      }}
    />
  </div>
);

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid #ddd',
  fontSize: '12px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 6px',
  fontSize: '11px',
  color: '#666',
  fontWeight: 600,
};
