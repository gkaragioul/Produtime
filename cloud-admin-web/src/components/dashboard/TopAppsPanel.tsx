/**
 * Top Apps Panel Component
 * Displays top applications by usage time
 */

import React from 'react';
import type { TopAppEntry } from '../../types/dashboard';
import { secondsToShort } from '../../types/dashboard';

interface TopAppsPanelProps {
  apps: TopAppEntry[];
  hasTopApps: boolean;
}

export const TopAppsPanel: React.FC<TopAppsPanelProps> = ({ apps, hasTopApps }) => (
  <div
    style={{
      backgroundColor: 'white',
      borderRadius: '10px',
      padding: '14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      flexShrink: 0,
    }}
  >
    <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Top Apps Today</h3>
    {apps.length > 0 ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {apps.slice(0, 6).map((app, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '11px',
                color: '#333',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginRight: '8px',
              }}
            >
              {app.app}
            </span>
            <span style={{ fontSize: '10px', color: '#666', flexShrink: 0 }}>{secondsToShort(app.seconds)}</span>
          </div>
        ))}
      </div>
    ) : (
      <div style={{ fontSize: '11px', color: '#999', textAlign: 'center', padding: '16px' }}>
        {hasTopApps ? 'No app data yet today.' : 'No activity yet today.'}
      </div>
    )}
  </div>
);
