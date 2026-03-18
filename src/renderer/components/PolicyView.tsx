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

interface EmailConfig {
  host: string;
  port: string;
  user: string;
  pass: string;
  secure: string;
  recipient: string;
  isConfigured: boolean;
}

interface PolicyViewProps {
  isManaged?: boolean;
  adminName?: string | null;
}

export const PolicyView: React.FC<PolicyViewProps> = ({ isManaged = false, adminName = null }) => {
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailConfig, setEmailConfig] = useState<EmailConfig | null>(null);
  const [emailForm, setEmailForm] = useState<Partial<EmailConfig>>({});
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string>('');

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

    // Load email config
    const loadEmailConfig = async () => {
      try {
        const response = await window.electronAPI.getEmailConfig();
        if (response.success && response.data) {
          setEmailConfig(response.data);
          setEmailForm(response.data);
        }
      } catch (error) {
        console.error('Failed to load email config:', error);
      }
    };
    loadEmailConfig();

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
          {policy?.autoExportEnabled && policy?.autoExportTime && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#666' }}>Export Time</span>
              <span style={{ fontWeight: 500 }}>{formatTime(policy.autoExportTime)}</span>
            </div>
          )}
          {policy?.exportFolder && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#666' }}>Export Folder</span>
              <span style={{ fontWeight: 500, fontSize: '13px', wordBreak: 'break-all' }}>{policy.exportFolder}</span>
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

      {/* Email Alerts Section */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: '#444' }}>
          Email Alerts
          <span style={{
            marginLeft: '8px',
            fontSize: '12px',
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: emailConfig?.isConfigured ? '#d4edda' : '#f8d7da',
            color: emailConfig?.isConfigured ? '#155724' : '#721c24',
          }}>
            {emailConfig?.isConfigured ? 'Active' : 'Not Configured'}
          </span>
        </h3>
        {!emailEditing ? (
          <div style={{ backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#666' }}>SMTP Server</span>
              <span style={{ fontWeight: 500 }}>{emailConfig?.host || 'Not set'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#666' }}>Recipient</span>
              <span style={{ fontWeight: 500 }}>{emailConfig?.recipient || 'Not set'}</span>
            </div>
            <button
              onClick={() => setEmailEditing(true)}
              style={{
                marginTop: '8px', padding: '6px 16px', backgroundColor: '#4a90d9',
                color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
              }}
            >
              Configure
            </button>
          </div>
        ) : (
          <div style={{ backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '16px' }}>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '4px' }}>SMTP Host</label>
              <input
                type="text" value={emailForm.host || ''} placeholder="smtp.gmail.com"
                onChange={(e) => setEmailForm({ ...emailForm, host: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '4px' }}>Port</label>
                <input
                  type="text" value={emailForm.port || ''} placeholder="587"
                  onChange={(e) => setEmailForm({ ...emailForm, port: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '4px' }}>Secure (TLS)</label>
                <select
                  value={emailForm.secure || 'false'}
                  onChange={(e) => setEmailForm({ ...emailForm, secure: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '4px' }}>Username</label>
              <input
                type="text" value={emailForm.user || ''} placeholder="your@email.com"
                onChange={(e) => setEmailForm({ ...emailForm, user: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '4px' }}>Password</label>
              <input
                type="password" value={emailForm.pass || ''} placeholder="App password"
                onChange={(e) => setEmailForm({ ...emailForm, pass: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '4px' }}>Alert Recipient Email</label>
              <input
                type="email" value={emailForm.recipient || ''} placeholder="admin@company.com"
                onChange={(e) => setEmailForm({ ...emailForm, recipient: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            {emailStatus && (
              <div style={{ fontSize: '13px', marginBottom: '8px', color: emailStatus.startsWith('Error') ? '#dc3545' : '#28a745' }}>
                {emailStatus}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={async () => {
                  setEmailStatus('');
                  const response = await window.electronAPI.saveEmailConfig(emailForm);
                  if (response.success) {
                    setEmailStatus('Saved successfully');
                    setEmailConfig({ ...emailForm as EmailConfig, isConfigured: response.data?.isConfigured });
                    setEmailEditing(false);
                  } else {
                    setEmailStatus('Error: ' + response.error);
                  }
                }}
                style={{
                  padding: '6px 16px', backgroundColor: '#28a745',
                  color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                }}
              >
                Save
              </button>
              <button
                onClick={async () => {
                  setEmailStatus('Sending test...');
                  const response = await window.electronAPI.testEmail();
                  setEmailStatus(response.success ? 'Test email sent!' : 'Error: ' + response.error);
                }}
                style={{
                  padding: '6px 16px', backgroundColor: '#ffc107',
                  color: '#333', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                }}
              >
                Test
              </button>
              <button
                onClick={() => { setEmailEditing(false); setEmailStatus(''); }}
                style={{
                  padding: '6px 16px', backgroundColor: '#6c757d',
                  color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PolicyView;
