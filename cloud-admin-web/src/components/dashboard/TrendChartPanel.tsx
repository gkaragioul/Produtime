/**
 * Trend Chart Panel Component
 * Displays 7-day trend chart
 */

import React from 'react';
import type { TrendsResponse } from '../../types/dashboard';
import { formatDeltaPct } from '../../types/dashboard';

interface TrendChartPanelProps {
  trends: TrendsResponse | null;
  scope: 'team' | 'device';
  onScopeChange: (s: 'team' | 'device') => void;
  selectedDeviceName?: string;
  hasHistory: boolean;
}

export const TrendChartPanel: React.FC<TrendChartPanelProps> = ({
  trends,
  scope,
  onScopeChange,
  selectedDeviceName,
  hasHistory,
}) => {
  if (!trends || trends.points.length === 0) {
    return (
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '10px',
          padding: '14px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>7-Day Trend</h3>
        <div style={{ fontSize: '12px', color: '#999', textAlign: 'center', padding: '20px' }}>
          {hasHistory ? 'No trend data available.' : 'No 7-day history yet.'}
        </div>
      </div>
    );
  }

  const maxValue = Math.max(...trends.points.map((d) => d.activeSeconds + d.idleSeconds), 1);
  const barHeight = 50;

  const activeDelta = formatDeltaPct(trends.deltas.activePct);
  const untrackedDelta = formatDeltaPct(trends.deltas.untrackedPct);

  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: '10px',
        padding: '14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>
          7-Day Trend{' '}
          {scope === 'device' && selectedDeviceName && (
            <span style={{ fontWeight: 400, color: '#666' }}>({selectedDeviceName})</span>
          )}
        </h3>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => onScopeChange('team')}
            style={{
              ...scopeButtonStyle,
              backgroundColor: scope === 'team' ? '#1976d2' : '#e0e0e0',
              color: scope === 'team' ? 'white' : '#333',
            }}
          >
            Team
          </button>
          <button
            onClick={() => onScopeChange('device')}
            style={{
              ...scopeButtonStyle,
              backgroundColor: scope === 'device' ? '#1976d2' : '#e0e0e0',
              color: scope === 'device' ? 'white' : '#333',
              opacity: selectedDeviceName ? 1 : 0.5,
            }}
            disabled={!selectedDeviceName}
          >
            Device
          </button>
        </div>
      </div>

      {/* Delta summary */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '10px', fontSize: '11px' }}>
        <span>
          Active{' '}
          <span style={{ color: activeDelta.color }}>
            {activeDelta.arrow}
            {activeDelta.text}
          </span>
        </span>
        <span>
          Untracked{' '}
          <span style={{ color: untrackedDelta.color }}>
            {untrackedDelta.arrow}
            {untrackedDelta.text}
          </span>
        </span>
      </div>

      {/* Chart */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: barHeight + 16 }}>
        {trends.points.map((day, i) => {
          const activeHeight = (day.activeSeconds / maxValue) * barHeight;
          const idleHeight = (day.idleSeconds / maxValue) * barHeight;
          const dayLabel = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' });
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column-reverse', height: barHeight }}>
                <div
                  style={{
                    width: '100%',
                    height: activeHeight,
                    backgroundColor: '#4CAF50',
                    borderRadius: '2px 2px 0 0',
                  }}
                />
                <div style={{ width: '100%', height: idleHeight, backgroundColor: '#FF9800' }} />
              </div>
              <div style={{ fontSize: '8px', color: '#999', marginTop: '3px' }}>{dayLabel}</div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '10px', color: '#666' }}>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              backgroundColor: '#4CAF50',
              borderRadius: '2px',
              marginRight: '4px',
            }}
          />
          Active
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              backgroundColor: '#FF9800',
              borderRadius: '2px',
              marginRight: '4px',
            }}
          />
          Idle
        </span>
      </div>
    </div>
  );
};

const scopeButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: '10px',
  borderRadius: '4px',
  border: 'none',
  cursor: 'pointer',
};
