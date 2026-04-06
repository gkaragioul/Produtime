/**
 * Today Status Component - Command Center (Final Form)
 * 
 * The hero element of the Daily Performance Console.
 * Shows at a glance: Where am I? On track or behind? Why?
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
  formatDurationShort,
  isDataSufficientForJudgement,
} from '../services/daily-insight-engine';

interface TodayStatusProps {
  insight: DailyInsight;
  expected: ExpectedWindow;
  activeSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
  isTracking: boolean;
}

export const TodayStatus: React.FC<TodayStatusProps> = ({
  insight,
  expected,
  activeSeconds,
  idleSeconds,
  untrackedSeconds,
  isTracking,
}) => {
  const { userState, sentence, statusEmoji, statusLabel, statusColor } = insight;
  const progressPct = Math.round(userState.progressPct * 100);
  const totalTracked = activeSeconds + idleSeconds + untrackedSeconds;
  const hasEnoughData = isDataSufficientForJudgement(totalTracked);
  
  return (
    <div className="today-status">
      {!isTracking && (
        <div className="today-status-header">
          <div className="tracking-off-badge">
            Tracking Off
          </div>
        </div>
      )}

      {/* Progress Bar - Only show when meaningful */}
      {expected.isWithinWorkWindow && expected.expectedSoFarSeconds > 0 && (
        <div className="progress-section">
          <div className="progress-header">
            <span className="progress-label">Progress vs Expected</span>
            <span className="progress-value" style={{ color: statusColor }}>
              {progressPct}%
            </span>
          </div>
          <div className="progress-bar-container">
            <div 
              className="progress-bar-fill"
              style={{ 
                width: `${Math.min(100, progressPct)}%`,
                backgroundColor: statusColor,
              }}
            />
          </div>
          <div className="progress-detail">
            {formatDurationShort(activeSeconds)} active of {formatDurationShort(expected.expectedSoFarSeconds)} expected so far
          </div>
        </div>
      )}
      
      {/* Expected Window */}
      <div className="expected-window">
        <span className="expected-icon">🎯</span>
        <span className="expected-text">
          Expected today: {expected.workStart}–{expected.workEnd} ({formatDurationShort(expected.expectedTotalSeconds)})
        </span>
      </div>
      
      {/* Live Stats - Simplified */}
      <div className="live-indicators">
        <div className="indicator">
          <span className="indicator-value" style={{ color: '#28a745' }}>
            {formatDurationShort(activeSeconds)}
          </span>
          <span className="indicator-label">Active</span>
        </div>
        <div className="indicator">
          <span className="indicator-value" style={{ color: '#ff9800' }}>
            {formatDurationShort(idleSeconds)}
          </span>
          <span className="indicator-label">Idle</span>
        </div>
        {untrackedSeconds > 0 && (
          <div className="indicator">
            <span className="indicator-value" style={{ color: '#dc3545' }}>
              {formatDurationShort(untrackedSeconds)}
            </span>
            <span className="indicator-label">Untracked</span>
          </div>
        )}
      </div>
      
      {/* Early Day Notice - Truth enforcement */}
      {!hasEnoughData && expected.isWithinWorkWindow && totalTracked > 0 && (
        <div className="early-notice">
          Too early to evaluate your day. Keep working!
        </div>
      )}
    </div>
  );
};
