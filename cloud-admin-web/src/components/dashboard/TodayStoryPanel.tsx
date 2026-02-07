/**
 * Today Story Panel Component
 * Displays health score, manager sentence, and progress
 */

import React from 'react';
import type { DashboardStory } from '../../types/dashboard';
import { getModeHealthLabelDisplay } from '../../types/dashboard';

interface TodayStoryPanelProps {
  story: DashboardStory;
  onViewIssues: () => void;
}

export const TodayStoryPanel: React.FC<TodayStoryPanelProps> = ({ story, onViewIssues }) => {
  const healthDisplay = getModeHealthLabelDisplay(story.mode, story.healthLabel);

  // Determine manager sentence style based on content
  const isAtRisk = story.managerSentence.startsWith('At risk:');
  const isBehind = story.managerSentence.startsWith('Behind schedule:');
  const isWatch = story.managerSentence.startsWith('Watch:');
  const isPreShift = story.mode === 'PRE_SHIFT';
  const isWaiting = story.mode === 'NO_DATA_YET' || story.mode === 'NO_DEVICES';

  const sentenceColor = isAtRisk
    ? '#c62828'
    : isBehind
    ? '#e65100'
    : isWatch
    ? '#f57c00'
    : isPreShift
    ? '#1976d2'
    : isWaiting
    ? '#9e9e9e'
    : '#2e7d32';
  const sentenceBg = isAtRisk
    ? '#ffebee'
    : isBehind
    ? '#fff3e0'
    : isWatch
    ? '#fff8e1'
    : isPreShift
    ? '#e3f2fd'
    : isWaiting
    ? '#f5f5f5'
    : '#e8f5e9';

  // Format progress display
  const progressDisplay =
    story.progress.progressPctTeam !== null ? `${Math.round(story.progress.progressPctTeam * 100)}%` : '—';

  // Format health score display
  const healthScoreDisplay = story.healthScore !== null ? story.healthScore : '—';

  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '16px 20px',
        marginBottom: '16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        display: 'flex',
        gap: '24px',
        alignItems: 'center',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      {/* Health Score */}
      <div style={{ textAlign: 'center', minWidth: '100px' }}>
        <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>Team Health</div>
        <div style={{ fontSize: '32px', fontWeight: 700, color: healthDisplay.color }}>{healthScoreDisplay}</div>
        <div style={{ fontSize: '12px', color: healthDisplay.color, fontWeight: 500 }}>{healthDisplay.text}</div>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '70px', backgroundColor: '#eee' }} />

      {/* Manager Sentence + Insights */}
      <div style={{ flex: 1, minWidth: '200px' }}>
        {/* Manager Sentence - prominent */}
        <div
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            backgroundColor: sentenceBg,
            marginBottom: '10px',
            borderLeft: `3px solid ${sentenceColor}`,
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: sentenceColor }}>{story.managerSentence}</div>
        </div>

        {/* Expected window microcopy */}
        {story.expected && (
          <div style={{ fontSize: '10px', color: '#999', marginBottom: '6px' }}>
            Expected: {story.expected.workStart}–{story.expected.workEnd} (
            {Math.round(story.expected.expectedTotalSeconds / 3600)}h)
            {story.expected.mixedPolicies && ' • mixed policies'}
          </div>
        )}

        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: '#666' }}>Today so far</div>
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '11px', color: '#555', lineHeight: 1.5 }}>
          {story.bullets.slice(0, 4).map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      </div>

      {/* Progress + Actions */}
      <div style={{ textAlign: 'center', minWidth: '120px' }}>
        <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>Team Progress</div>
        <div
          style={{
            fontSize: '24px',
            fontWeight: 700,
            color: story.mode === 'PRE_SHIFT' ? '#9e9e9e' : '#1976d2',
          }}
        >
          {progressDisplay}
        </div>
        {story.progress.progressPctTeam !== null && <ProgressBarMini value={story.progress.progressPctTeam} />}
        {story.mode === 'PRE_SHIFT' && <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>Pre-shift</div>}
        {(story.highlights.criticalCount > 0 || story.highlights.atRiskCount > 0) && story.mode === 'NORMAL' && (
          <button
            onClick={onViewIssues}
            style={{
              marginTop: '8px',
              padding: '4px 12px',
              fontSize: '11px',
              backgroundColor: '#fff3e0',
              color: '#e65100',
              border: '1px solid #ffcc80',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            View Issues ({story.highlights.criticalCount + story.highlights.atRiskCount})
          </button>
        )}
      </div>
    </div>
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
