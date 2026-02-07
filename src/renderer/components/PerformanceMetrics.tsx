/**
 * Performance Metrics Component - Simplified, Honest Metrics
 * 
 * Shows only meaningful metrics without fake precision.
 * Never shows "100% productivity" with insufficient data.
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only aggregated stats are displayed
 * - No raw window titles or content
 * - All data is privacy-respecting
 */

import React from 'react';
import { 
  DailyInsight, 
  ExpectedWindow,
  isDataSufficientForProductivity,
} from '../services/daily-insight-engine';

interface PerformanceMetricsProps {
  activeSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
  insight: DailyInsight;
  expected: ExpectedWindow;
}

// Format seconds to human-readable (1h 12m style)
function formatDurationHuman(seconds: number): string {
  if (seconds < 60) return '0m';
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export const PerformanceMetrics: React.FC<PerformanceMetricsProps> = ({
  activeSeconds,
  idleSeconds,
  untrackedSeconds,
  insight,
  expected,
}) => {
  const totalTracked = activeSeconds + idleSeconds + untrackedSeconds;
  const hasEnoughData = isDataSufficientForProductivity(totalTracked); // Use engine's truth enforcement
  const progressPct = Math.round(insight.userState.progressPct * 100);
  
  // Focus ratio as percentage (only show if enough data)
  const focusPct = hasEnoughData ? Math.round(insight.userState.focusRatio * 100) : null;
  
  return (
    <div className="performance-metrics">
      <div className="metrics-grid-simple">
        {/* Active Today */}
        <div className="metric-card">
          <div className="metric-icon">⏱️</div>
          <div className="metric-value" style={{ color: '#28a745' }}>
            {formatDurationHuman(activeSeconds)}
          </div>
          <div className="metric-label">Active Today</div>
        </div>
        
        {/* Idle Today */}
        <div className="metric-card">
          <div className="metric-icon">💤</div>
          <div className="metric-value" style={{ color: '#ff9800' }}>
            {formatDurationHuman(idleSeconds)}
          </div>
          <div className="metric-label">Idle Today</div>
        </div>
        
        {/* Untracked Today */}
        <div className="metric-card">
          <div className="metric-icon">❓</div>
          <div className="metric-value" style={{ color: untrackedSeconds > 1800 ? '#dc3545' : '#6c757d' }}>
            {formatDurationHuman(untrackedSeconds)}
          </div>
          <div className="metric-label">Time Not Tracked</div>
        </div>
        
        {/* Progress vs Expected */}
        <div className="metric-card">
          <div className="metric-icon">📊</div>
          <div 
            className="metric-value"
            style={{ 
              color: progressPct >= 80 ? '#28a745' : progressPct >= 50 ? '#ff9800' : '#dc3545'
            }}
          >
            {expected.expectedSoFarSeconds > 0 ? `${progressPct}%` : '—'}
          </div>
          <div className="metric-label">Progress</div>
        </div>
      </div>
      
      {/* Focus Ratio - Only show with enough data */}
      {hasEnoughData && focusPct !== null && (
        <div className="focus-ratio-section">
          <div className="focus-ratio-header">
            <span className="focus-label">Focus Ratio</span>
            <span className="focus-value" style={{ 
              color: focusPct >= 70 ? '#28a745' : focusPct >= 50 ? '#ff9800' : '#dc3545'
            }}>
              {focusPct}%
            </span>
          </div>
          <div className="focus-bar-container">
            <div 
              className="focus-bar-fill"
              style={{ 
                width: `${focusPct}%`,
                backgroundColor: focusPct >= 70 ? '#28a745' : focusPct >= 50 ? '#ff9800' : '#dc3545',
              }}
            />
          </div>
          <div className="focus-hint">
            Active time as percentage of total tracked time
          </div>
        </div>
      )}
      
      {/* Early Day Message */}
      {!hasEnoughData && totalTracked > 0 && (
        <div className="early-day-message">
          <span className="early-icon">⏳</span>
          <span className="early-text">
            Too early to evaluate productivity. Keep going!
          </span>
        </div>
      )}
    </div>
  );
};
