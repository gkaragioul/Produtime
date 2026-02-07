/**
 * PolicyView Component
 * Read-only view of policy settings enforced by Admin Console
 * Replaces SettingsTab when device is managed
 */

import React, { useState, useEffect } from 'react';
import { ManagedBadge } from './ManagedBadge';

interface PolicyData {
  version?: string;
  workScheduleStart?: string;
  workScheduleEnd?: string;
  idleThreshold?: number;
  privacyModeEnabled?: boolean;
  autoExportEnabled?: boolean;
  autoExportTime?: string;
  employeeName?: string;
}

export const PolicyView: React.FC = () => {
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminName, setAdminName] = useState<string | null>(null);

  useEffect(() => {
    const loadPolicy = async () => {
      try {
        // Get agent state for admin name
        const stateResponse = await window.electronAPI.agentGetState();
        if (stateResponse.success && stateResponse.data) {
          setAdminName(stateResponse.data.adminName);
        }

        // Get effective policy
        const policyResponse = await window.electronAPI.agentGetEffectivePolicy();
        if (policyResponse.success && policyResponse.data) {
          setPolicy(policyResponse.data);
        }
      } catch (error) {
        console.error('Failed to load policy:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPolicy();

    // Listen for policy updates
    const unsubscribe = window.electronAPI.onAgentPolicyUpdated?.((newPolicy) => {
      setPolicy(newPolicy);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <div style={{ color: '#666' }}>Loading policy...</div>
      </div>
    );
  }

  const formatTime = (time?: string) => {
    if (!time) return 'Not set';
    return time;
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'Not set';
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  };

  return (
    <div style={{ padding: '24px', maxWidth: '600px' }}>
      <ManagedBadge adminName={adminName} />

      <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '24px', color: '#333' }}>
        Policy Settings
      </h2>

      <p style={{ fontSize: '14px', color: '#666', marginBottom: '24px' }}>
        These settings are managed by your administrator. Contact your admin if you need changes.
      </p>

      {/* Work Schedule Section */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: '#444' }}>
          Work Schedule
        </h3>
        <div style={{ backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: '#666' }}>Start Time</span>
            <span style={{ fontWeight: 500 }}>{formatTime(policy?.workScheduleStart)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#666' }}>End Time</span>
            <span style={{ fontWeight: 500 }}>{formatTime(policy?.workScheduleEnd)}</span>
          </div>
        </div>
      </div>

      {/* Tracking Settings Section */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: '#444' }}>
          Tracking Settings
        </h3>
        <div style={{ backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: '#666' }}>Idle Threshold</span>
            <span style={{ fontWeight: 500 }}>{formatDuration(policy?.idleThreshold)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#666' }}>Privacy Mode</span>
            <span style={{ fontWeight: 500 }}>
              {policy?.privacyModeEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      </div>

      {/* Auto-Export Section */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: '#444' }}>
          Auto-Export
        </h3>
        <div style={{ backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: '#666' }}>Auto-Export</span>
            <span style={{ fontWeight: 500 }}>
              {policy?.autoExportEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          {policy?.autoExportEnabled && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>Export Time</span>
              <span style={{ fontWeight: 500 }}>{formatTime(policy?.autoExportTime)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Employee Info Section */}
      {policy?.employeeName && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: '#444' }}>
            Employee Info
          </h3>
          <div style={{ backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>Name</span>
              <span style={{ fontWeight: 500 }}>{policy.employeeName}</span>
            </div>
          </div>
        </div>
      )}

      {/* Policy Version */}
      {policy?.version && (
        <div style={{ fontSize: '12px', color: '#999', textAlign: 'center', marginTop: '24px' }}>
          Policy version: {policy.version}
        </div>
      )}
    </div>
  );
};

export default PolicyView;
