/**
 * Rankings Panel Component
 * Displays most active and biggest improvement rankings
 */

import React from 'react';
import type { RankingsResponse } from '../../types/dashboard';
import { secondsToShort, formatDeltaPct } from '../../types/dashboard';

interface RankingsPanelProps {
  rankings: RankingsResponse | null;
  hasHistory: boolean;
}

export const RankingsPanel: React.FC<RankingsPanelProps> = ({ rankings, hasHistory }) => {
  const hasData = rankings && (rankings.mostActive.length > 0 || rankings.biggestImprovement.length > 0);

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
      <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Rankings</h3>

      {!hasData ? (
        <div style={{ fontSize: '11px', color: '#999', textAlign: 'center', padding: '16px' }}>
          {hasHistory ? 'No rankings data for today yet.' : 'No rankings yet.'}
        </div>
      ) : (
        <>
          {rankings!.mostActive.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>🏆 Most Active</div>
              {rankings!.mostActive.slice(0, 3).map((r, i) => (
                <div
                  key={r.deviceId}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '2px 0' }}
                >
                  <span>
                    {i + 1}. {r.deviceName}
                  </span>
                  <span style={{ color: '#4CAF50' }}>{secondsToShort(r.value)}</span>
                </div>
              ))}
            </div>
          )}

          {rankings!.biggestImprovement.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>📈 Biggest Improvement</div>
              {rankings!.biggestImprovement.slice(0, 3).map((r, i) => {
                const delta = formatDeltaPct(r.deltaPct || 0);
                return (
                  <div
                    key={r.deviceId}
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '2px 0' }}
                  >
                    <span>
                      {i + 1}. {r.deviceName}
                    </span>
                    <span style={{ color: delta.color }}>
                      {delta.arrow}
                      {delta.text}
                    </span>
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
