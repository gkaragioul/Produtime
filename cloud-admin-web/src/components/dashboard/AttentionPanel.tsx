/**
 * Attention Panel Component
 * Displays attention groups with top offenders
 */

import React from 'react';
import type { AttentionResponse, AttentionGroup, AttentionType, DashboardMode } from '../../types/dashboard';
import { getAttentionEmptyMessage } from '../../types/dashboard';

interface AttentionPanelProps {
  attention: AttentionResponse;
  onClick: (g: AttentionGroup) => void;
  selectedType: AttentionType | null;
  onClearFilter: () => void;
  mode: DashboardMode;
  onNavigate?: (action: string) => void;
}

export const AttentionPanel: React.FC<AttentionPanelProps> = ({
  attention,
  onClick,
  selectedType,
  onClearFilter,
  mode,
  onNavigate,
}) => {
  const emptyState = getAttentionEmptyMessage(mode);
  const hasIssues = attention.totalCount > 0;

  // Determine panel style based on state
  const panelBg = hasIssues ? '#fff3e0' : '#f5f5f5';
  const panelBorder = hasIssues ? '#ffcc80' : '#e0e0e0';
  const headerColor = hasIssues ? '#e65100' : '#666';
  const headerIcon = hasIssues ? '⚠️' : '✓';

  return (
    <div
      style={{
        backgroundColor: panelBg,
        borderRadius: '10px',
        padding: '12px 16px',
        marginBottom: '16px',
        border: `1px solid ${panelBorder}`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: hasIssues ? '10px' : '0',
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 600, color: headerColor }}>
          {headerIcon} Needs Attention {hasIssues ? `(${attention.totalCount})` : ''}
        </div>
        {selectedType && (
          <button
            onClick={onClearFilter}
            style={{
              padding: '3px 8px',
              fontSize: '10px',
              backgroundColor: '#fff',
              color: '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Clear Filter ✕
          </button>
        )}
      </div>

      {hasIssues ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {attention.groups.map((group) => (
            <AttentionGroupCard
              key={group.type}
              group={group}
              onClick={() => onClick(group)}
              isSelected={selectedType === group.type}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
          }}
        >
          <span style={{ fontSize: '12px', color: '#666' }}>{emptyState.message}</span>
          {emptyState.cta && onNavigate && (
            <button
              onClick={() => onNavigate(emptyState.cta!.action)}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {emptyState.cta.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Attention Group Card
const AttentionGroupCard: React.FC<{
  group: AttentionGroup;
  onClick: () => void;
  isSelected: boolean;
}> = ({ group, onClick, isSelected }) => {
  const severityColors = {
    crit: { bg: '#ffebee', text: '#c62828', border: '#ef9a9a', icon: '🔴' },
    warn: { bg: '#fff3e0', text: '#e65100', border: '#ffcc80', icon: '🟠' },
    info: { bg: '#e3f2fd', text: '#1565c0', border: '#90caf9', icon: '🔵' },
  };
  const colors = severityColors[group.severity];

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        borderRadius: '8px',
        backgroundColor: isSelected ? colors.bg : 'white',
        border: `2px solid ${isSelected ? colors.text : colors.border}`,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: group.top.length > 0 ? '8px' : 0,
        }}
      >
        <span style={{ fontSize: '12px' }}>{colors.icon}</span>
        <span style={{ fontWeight: 600, fontSize: '12px', color: colors.text }}>{group.count}</span>
        <span style={{ fontSize: '12px', color: colors.text }}>{group.label}</span>
        {isSelected && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '10px',
              padding: '2px 6px',
              backgroundColor: colors.text,
              color: 'white',
              borderRadius: '4px',
            }}
          >
            Filtering
          </span>
        )}
      </div>

      {/* Top offenders inline */}
      {group.top.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '20px' }}>
          {group.top.slice(0, 2).map((offender) => (
            <div
              key={offender.deviceId}
              style={{
                fontSize: '11px',
                color: '#666',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span style={{ color: '#999' }}>•</span>
              <span style={{ fontWeight: 500 }}>{offender.deviceName}</span>
              <span style={{ color: '#999' }}>—</span>
              <span style={{ color: colors.text }}>{offender.valueLabel}</span>
            </div>
          ))}
          {group.top.length > 2 && (
            <div style={{ fontSize: '10px', color: '#999', paddingLeft: '12px' }}>+{group.top.length - 2} more</div>
          )}
        </div>
      )}
    </div>
  );
};
