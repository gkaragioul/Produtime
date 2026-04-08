/**
 * ManagedBadge Component
 * Shows "Managed by [Company Name]" indicator when device is paired
 * 
 * COMPLIANCE: This is a required transparency indicator.
 * Users must always see when their device is managed.
 * Requirement 3.8, 9.3: Display "Managed by [Company Name]" indicator
 */

import React, { useState, useEffect } from 'react';

interface ManagedBadgeProps {
  adminName?: string | null;
  tenantName?: string | null;
  compact?: boolean;
}

export const ManagedBadge: React.FC<ManagedBadgeProps> = ({ adminName, tenantName, compact = false }) => {
  const [isManaged, setIsManaged] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isCloudConnection, setIsCloudConnection] = useState(false);

  useEffect(() => {
    // Check if managed on mount
    const checkManaged = async () => {
      try {
        const response = await window.electronAPI.agentIsManaged();
        if (response.success && response.data) {
          setIsManaged(true);
          
          // Get admin/tenant name if not provided
          if (!tenantName && !adminName) {
            const stateResponse = await window.electronAPI.agentGetState();
            if (stateResponse.success && stateResponse.data) {
              // Prefer tenant name (company name) over admin name
              setDisplayName(stateResponse.data.tenantName || stateResponse.data.adminName);
              setIsCloudConnection(stateResponse.data.isCloudConnection || false);
            }
          }
        }
      } catch (error) {
        console.error('Failed to check managed status:', error);
      }
    };

    checkManaged();

    // Listen for state changes — only update managed status when it actually changes.
    // The WebSocket can oscillate between disconnected/connecting/paired, which would
    // cause the badge to flash without this guard. A paired device stays managed even
    // during brief disconnects.
    const unsubscribe = window.electronAPI.onAgentStateChanged?.((state) => {
      setIsManaged((prev) => {
        const nowManaged = state.status === 'paired';
        // Once managed, stay managed — brief disconnects shouldn't hide the badge
        if (prev && !nowManaged) return prev;
        return nowManaged;
      });
      // Prefer tenant name (company name) over admin name
      if (state.tenantName || state.adminName) {
        setDisplayName(state.tenantName || state.adminName);
      }
      if (state.isCloudConnection !== undefined) {
        setIsCloudConnection(state.isCloudConnection || false);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [adminName, tenantName]);

  // Update display name when props change
  useEffect(() => {
    if (tenantName) {
      setDisplayName(tenantName);
    } else if (adminName) {
      setDisplayName(adminName);
    }
  }, [adminName, tenantName]);

  if (!isManaged) {
    return null;
  }

  // Use tenant name (company name) for display, fall back to admin name
  const name = displayName || tenantName || adminName || 'Admin Console';

  if (compact) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          backgroundColor: isCloudConnection ? '#e8f5e9' : '#e3f2fd',
          borderRadius: '12px',
          fontSize: '11px',
          color: isCloudConnection ? '#2e7d32' : '#1565c0',
          fontWeight: 500,
        }}
        title={`Managed by ${name}${isCloudConnection ? ' (Cloud)' : ''}`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isCloudConnection ? (
            // Cloud icon for cloud connections
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
          ) : (
            // Shield icon for local connections
            <>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </>
          )}
        </svg>
        Managed
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 16px',
        backgroundColor: isCloudConnection ? '#e8f5e9' : '#e3f2fd',
        borderRadius: '8px',
        border: `1px solid ${isCloudConnection ? '#a5d6a7' : '#90caf9'}`,
        marginBottom: '16px',
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={isCloudConnection ? '#2e7d32' : '#1565c0'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {isCloudConnection ? (
          // Cloud icon for cloud connections
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
        ) : (
          // Shield icon for local connections
          <>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </>
        )}
      </svg>
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: isCloudConnection ? '#2e7d32' : '#1565c0' }}>
          Managed by {isCloudConnection ? 'Cloud Admin' : 'Admin Console'}
        </div>
        <div style={{ fontSize: '11px', color: isCloudConnection ? '#388e3c' : '#1976d2' }}>
          {name}
        </div>
      </div>
    </div>
  );
};

export default ManagedBadge;
