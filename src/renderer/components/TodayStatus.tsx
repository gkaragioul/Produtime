/**
 * Today Status Component
 *
 * Single consolidated view: expected window, progress bar,
 * active/idle/focus stats. No duplicate information.
 */

import React from 'react';
import {
  DailyInsight,
  ExpectedWindow,
  formatDurationShort,
  isDataSufficientForJudgement,
  isDataSufficientForProductivity,
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
  const { userState, statusColor } = insight;
  const progressPct = Math.round(userState.progressPct * 100);
  const totalTracked = activeSeconds + idleSeconds + untrackedSeconds;
  const hasEnoughData = isDataSufficientForJudgement(totalTracked);
  const hasProductivityData = isDataSufficientForProductivity(totalTracked);
  const focusPct = hasProductivityData ? Math.round(userState.focusRatio * 100) : null;

  return (
    <div className="today-status">
      {/* Expected Window */}
      <div className="expected-window">
        <span className="expected-icon">🎯</span>
        <span className="expected-text">
          {expected.workStart}–{expected.workEnd} ({formatDurationShort(expected.expectedTotalSeconds)})
        </span>
        {!isTracking && (
          <span className="tracking-off-badge" style={{ marginLeft: 'auto' }}>
            Tracking Off
          </span>
        )}
      </div>

      {/* Progress Bar */}
      {expected.isWithinWorkWindow && expected.expectedSoFarSeconds > 0 && (
        <div className="progress-section">
          <div className="progress-header">
            <span className="progress-label">Progress</span>
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

      {/* Stats Row — Active, Idle, Focus (no duplicates) */}
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
        {focusPct !== null && (
          <div className="indicator">
            <span className="indicator-value" style={{
              color: focusPct >= 70 ? '#28a745' : focusPct >= 50 ? '#ff9800' : '#dc3545'
            }}>
              {focusPct}%
            </span>
            <span className="indicator-label">Focus</span>
          </div>
        )}
      </div>

      {/* Early Day Notice */}
      {!hasEnoughData && expected.isWithinWorkWindow && totalTracked > 0 && (
        <div className="early-notice">
          Too early to evaluate your day. Keep working!
        </div>
      )}
    </div>
  );
};
