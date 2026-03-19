/**
 * PolicyView Component
 * Read-only view of current app settings.
 * Shows settings from local database (or admin policy when managed).
 * No authentication required — this is a user-facing view.
 */

import React, { useState, useEffect } from 'react';
import { ManagedBadge } from './ManagedBadge';
import { IPCService } from '../services/ipc-service';

interface PolicyData {
  workScheduleStart: string;
  workScheduleEnd: string;
  idleThreshold: number;
  privacyModeEnabled: boolean;
  autoExportEnabled: boolean;
  autoExportTime: string;
  employeeName: string;
  exportFolder: string;
}

interface PolicyViewProps {
  isManaged?: boolean;
  adminName?: string | null;
}

export const PolicyView: React.FC<PolicyViewProps> = ({ isManaged = false, adminName = null }) => {
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const loadPolicy = async () => {
      try {
        if (isManaged) {
          // Load from admin policy when managed
          const policyResponse = await window.electronAPI.agentGetEffectivePolicy();
          if (policyResponse.success && policyResponse.data) {
            setPolicy(policyResponse.data);
          }
        } else {
          // Load from local settings
          const ipcService = IPCService.getInstance();
          const allSettings = await ipcService.getAllSettings();
          const settingsMap = allSettings.reduce(
            (acc, setting) => {
              acc[setting.key] = setting.value;
              return acc;
            },
            {} as Record<string, string>
          );

          setPolicy({
            workScheduleStart: settingsMap.work_schedule_start || '09:00',
            workScheduleEnd: settingsMap.work_schedule_end || '17:00',
            idleThreshold: parseInt(settingsMap.idle_threshold || '300', 10),
            privacyModeEnabled: settingsMap.privacy_mode_enabled === 'true',
            autoExportEnabled: settingsMap.auto_export_enabled !== 'false',
            autoExportTime: settingsMap.auto_export_time || '',
            employeeName: settingsMap.employee_name || '',
            exportFolder: settingsMap.export_folder || '',
          });
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPolicy();

    // Listen for policy updates when managed
    if (isManaged) {
      const unsubscribe = window.electronAPI.onAgentPolicyUpdated?.((newPolicy) => {
        setPolicy(newPolicy);
      });
      return () => {
        unsubscribe?.();
      };
    }
  }, [isManaged]);

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <div style={{ color: '#666' }}>Loading settings...</div>
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
      {isManaged && <ManagedBadge adminName={adminName} />}

      <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '24px', color: '#333' }}>
        Settings
      </h2>

      {isManaged && (
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '24px' }}>
          These settings are managed by your administrator. Contact your admin if you need changes.
        </p>
      )}

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

    </div>
  );
};

export default PolicyView;
