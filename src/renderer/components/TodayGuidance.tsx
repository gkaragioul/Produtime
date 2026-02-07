/**
 * Today's Guidance Component - Micro-Coaching Display
 * 
 * Shows one clear, actionable guidance message based on current state.
 * The soul of the performance companion.
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only aggregated insights displayed
 * - No raw data or content
 */

import React from 'react';
import { Guidance } from '../services/daily-insight-engine';

interface TodayGuidanceProps {
  guidance: Guidance;
}

function getToneStyles(tone: string): { bg: string; border: string; text: string } {
  switch (tone) {
    case 'encouraging':
      return { bg: '#e8f5e9', border: '#a5d6a7', text: '#2e7d32' };
    case 'warning':
      return { bg: '#fff3e0', border: '#ffcc80', text: '#e65100' };
    case 'corrective':
      return { bg: '#ffebee', border: '#ef9a9a', text: '#c62828' };
    default: // neutral
      return { bg: '#f5f5f5', border: '#e0e0e0', text: '#424242' };
  }
}

export const TodayGuidance: React.FC<TodayGuidanceProps> = ({ guidance }) => {
  const styles = getToneStyles(guidance.tone);
  
  return (
    <div 
      className="today-guidance"
      style={{
        backgroundColor: styles.bg,
        borderColor: styles.border,
        borderLeft: `4px solid ${styles.border}`,
      }}
    >
      <div className="guidance-header">
        <span className="guidance-label">Today's Guidance</span>
      </div>
      <div className="guidance-content">
        <span className="guidance-icon">{guidance.icon}</span>
        <span className="guidance-message" style={{ color: styles.text }}>
          {guidance.message}
        </span>
      </div>
    </div>
  );
};
