/**
 * Focus Summary Component - Replaces Raw Activity List
 * 
 * Shows meaningful focus insights instead of raw app switching.
 * Answers: How focused has my day been? What apps consumed my time?
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only aggregated stats are displayed
 * - No raw window titles or content
 * - All data is privacy-respecting
 */

import React, { useState } from 'react';
import { 
  FocusStats, 
  getFocusQualityLabel, 
  getFocusQualityColor,
  getDominantActivityMessage,
  FocusQuality,
  isDataSufficientForJudgement,
} from '../services/daily-insight-engine';
import { ActivityLog } from '../../shared/types';

interface FocusSummaryProps {
  focusStats: FocusStats;
  recentLogs: ActivityLog[];
  totalTracked: number;
  focusQuality?: FocusQuality;
  dominantActivity?: 'active' | 'idle' | 'balanced' | 'unknown';
}

// Format seconds to human-readable (1h 12m style)
function formatDurationHuman(seconds: number): string {
  if (seconds < 60) return '< 1m';
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Format time for display
function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const FocusSummary: React.FC<FocusSummaryProps> = ({
  focusStats,
  recentLogs,
  totalTracked,
  focusQuality,
  dominantActivity,
}) => {
  const [showRecentActivity, setShowRecentActivity] = useState(false);
  
  const { active, idle, untracked } = focusStats.focusSplit;
  const hasData = totalTracked > 0;
  const hasEnoughData = isDataSufficientForJudgement(totalTracked);
  
  // Calculate percentages for the split bar
  const total = active + idle + untracked || 1;
  const activePct = (active / total) * 100;
  const idlePct = (idle / total) * 100;
  const untrackedPct = (untracked / total) * 100;
  
  return (
    <div className="focus-summary">
      <div className="section-header">
        <h3 className="typography-section">Focus Summary</h3>
      </div>
      
      {!hasData ? (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <div className="empty-text">No activity has been recorded yet today.</div>
          <div className="empty-hint">Focus insights will appear as you work.</div>
        </div>
      ) : (
        <>
          {/* Focus Quality Badge - Only show with enough data */}
          {hasEnoughData && focusQuality && (
            <div className="focus-quality-section" style={{ marginBottom: '16px' }}>
              <div className="focus-quality-badge">
                <span className="quality-label">Focus Quality:</span>
                <span 
                  className="quality-value"
                  style={{ 
                    color: getFocusQualityColor(focusQuality),
                    fontWeight: 600,
                    marginLeft: '8px',
                  }}
                >
                  {getFocusQualityLabel(focusQuality)}
                </span>
              </div>
              {dominantActivity && dominantActivity !== 'unknown' && (
                <div className="dominant-activity-hint">
                  {getDominantActivityMessage(dominantActivity)}
                </div>
              )}
            </div>
          )}
          
          {/* Focus Split Bar */}
          <div className="focus-split-section">
            <div className="focus-split-header">
              <span className="split-label">Today's Time Split</span>
            </div>
            <div className="focus-split-bar">
              {activePct > 0 && (
                <div 
                  className="split-segment active"
                  style={{ width: `${activePct}%` }}
                  title={`Active: ${formatDurationHuman(active)}`}
                />
              )}
              {idlePct > 0 && (
                <div 
                  className="split-segment idle"
                  style={{ width: `${idlePct}%` }}
                  title={`Idle: ${formatDurationHuman(idle)}`}
                />
              )}
              {untrackedPct > 0 && (
                <div 
                  className="split-segment untracked"
                  style={{ width: `${untrackedPct}%` }}
                  title={`Untracked: ${formatDurationHuman(untracked)}`}
                />
              )}
            </div>
            <div className="focus-split-legend">
              <span className="legend-item">
                <span className="legend-dot active" />
                Active {formatDurationHuman(active)}
              </span>
              <span className="legend-item">
                <span className="legend-dot idle" />
                Idle {formatDurationHuman(idle)}
              </span>
              {untracked > 0 && (
                <span className="legend-item">
                  <span className="legend-dot untracked" />
                  Untracked {formatDurationHuman(untracked)}
                </span>
              )}
            </div>
          </div>
          
          {/* Focus Streaks */}
          <div className="focus-streaks">
            <div className="streak-card">
              <div className="streak-icon">🎯</div>
              <div className="streak-content">
                <div className="streak-value">{formatDurationHuman(focusStats.longestFocusStreak)}</div>
                <div className="streak-label">Longest Focus</div>
              </div>
            </div>
            <div className="streak-card">
              <div className="streak-icon">💤</div>
              <div className="streak-content">
                <div className="streak-value">{formatDurationHuman(focusStats.longestIdlePeriod)}</div>
                <div className="streak-label">Longest Break</div>
              </div>
            </div>
          </div>
          
          {/* Top Apps */}
          {focusStats.topApps.length > 0 && (
            <div className="top-apps-section">
              <div className="top-apps-header">Top Apps Today</div>
              <div className="top-apps-list">
                {focusStats.topApps.slice(0, 3).map((app, i) => (
                  <div key={i} className="top-app-item">
                    <span className="app-rank">{i + 1}</span>
                    <span className="app-name">{app.app}</span>
                    <span className="app-duration">{formatDurationHuman(app.seconds)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Recent Activity Toggle */}
          <div className="recent-toggle">
            <button 
              className="toggle-button"
              onClick={() => setShowRecentActivity(!showRecentActivity)}
            >
              {showRecentActivity ? '▼ Hide Recent Activity' : '▶ Show Recent Activity'}
            </button>
          </div>
          
          {/* Collapsible Recent Activity */}
          {showRecentActivity && (
            <div className="recent-activity-list">
              {recentLogs.slice(0, 8).map((log, i) => {
                const isIdle = log.app_name === 'System' &&
                  (log.window_title === 'Idle' || log.window_title === 'Paused' || log.window_title === 'System');
                return (
                  <div key={log.id || i} className={`recent-item ${isIdle ? 'idle' : ''}`}>
                    <span className="recent-time">{formatTime(log.timestamp)}</span>
                    <span className="recent-app">{log.app_name}</span>
                    <span className="recent-duration">{formatDurationHuman(log.duration)}</span>
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
