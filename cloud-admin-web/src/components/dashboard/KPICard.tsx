/**
 * KPI Card Component
 */

import React from 'react';

interface KPICardProps {
  title: string;
  value: string | number;
  color: string;
  icon: string;
  subtitle?: string;
}

export const KPICard: React.FC<KPICardProps> = ({ title, value, color, icon, subtitle }) => (
  <div
    style={{
      backgroundColor: 'white',
      borderRadius: '10px',
      padding: '14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
      <span style={{ fontSize: '14px' }}>{icon}</span>
      <span style={{ fontSize: '11px', color: '#666' }}>{title}</span>
    </div>
    <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</div>
    {subtitle && <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>{subtitle}</div>}
  </div>
);
