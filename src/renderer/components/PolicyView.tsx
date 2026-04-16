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
  breakDuration: number;
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
  const [nameInput, setNameInput] = useState('');
  const [nameSaved, setNameSaved] = useState(false);

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
            breakDuration: parseInt(settingsMap.break_duration || '30', 10),
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

    // Load employee name directly from settings
    const loadName = async () => {
      try {
        const ipcService = IPCService.getInstance();
        const allSettings = await ipcService.getAllSettings();
        const nameEntry = allSettings.find(s => s.key === 'employee_name');
        if (nameEntry?.value) setNameInput(nameEntry.value);
      } catch {}
    };

    loadPolicy();
    loadName();

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

      {/* Your Name */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: '#444' }}>
          Your Name
        </h3>
        <div style={{ backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => { setNameInput(e.target.value); setNameSaved(false); }}
              placeholder="Enter your name"
              style={{
                flex: 1, padding: '8px 12px', border: '1px solid #ddd',
                borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box',
              }}
            />
            <button
              onClick={async () => {
                try {
                  await window.electronAPI.setSetting({ key: 'employee_name', value: nameInput.trim() });
                  setNameSaved(true);
                  setTimeout(() => setNameSaved(false), 2000);
                } catch {}
              }}
              style={{
                padding: '8px 18px', backgroundColor: '#4a90d9', color: '#fff',
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}
            >
              Save
            </button>
          </div>
          {nameSaved && (
            <div style={{ fontSize: '12px', color: '#28a745', marginTop: '6px' }}>Name saved — it will sync to the admin panel on next heartbeat.</div>
          )}
          {!nameInput && (
            <div style={{ fontSize: '12px', color: '#999', marginTop: '6px' }}>Please enter your name so your administrator can identify you.</div>
          )}
        </div>
      </div>

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
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: '#666' }}>End Time</span>
            <span style={{ fontWeight: 500 }}>{formatTime(policy?.workScheduleEnd)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#666' }}>Break / Lunch</span>
            <span style={{ fontWeight: 500 }}>{policy?.breakDuration ? `${policy.breakDuration} minutes` : 'Not set'}</span>
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


    </div>
  );
};

export default PolicyView;
