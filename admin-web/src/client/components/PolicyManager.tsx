/**
 * Policy Manager Component
 * Create, edit, and assign policies to devices
 */

import React, { useState, useEffect } from 'react';

interface Policy {
  policy_id: string;
  name: string;
  policy_json: string;
  updated_at: number;
}

interface PolicyData {
  workScheduleStart: string;
  workScheduleEnd: string;
  idleThreshold: number;       // stored in seconds
  breakDuration: number;       // stored in minutes
  privacyModeEnabled: boolean;
  titleSharingEnabled: boolean;
  autoExportEnabled: boolean;
  autoExportTime: string;
}

const defaultPolicyData: PolicyData = {
  workScheduleStart: '09:00',
  workScheduleEnd: '17:00',
  idleThreshold: 300,
  breakDuration: 30,
  privacyModeEnabled: true,
  titleSharingEnabled: false,
  autoExportEnabled: true,
  autoExportTime: '18:00',
};

export const PolicyManager: React.FC = () => {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [policyName, setPolicyName] = useState('');
  const [policyData, setPolicyData] = useState<PolicyData>(defaultPolicyData);
  const [assignStatus, setAssignStatus] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [policyList, deviceList] = await Promise.all([
        window.adminAPI.getAllPolicies(),
        window.adminAPI.getAllDevices(),
      ]);
      setPolicies(policyList);
      setDevices(deviceList);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePolicy = async () => {
    if (!policyName.trim()) {
      alert('Please enter a policy name');
      return;
    }

    try {
      const result = await window.adminAPI.createPolicy({
        name: policyName,
        data: policyData,
      });

      if (result.success) {
        await loadData();
        resetForm();
      }
    } catch (error) {
      console.error('Failed to create policy:', error);
    }
  };

  const handleUpdatePolicy = async () => {
    if (!selectedPolicy || !policyName.trim()) return;

    try {
      const result = await window.adminAPI.updatePolicy(
        selectedPolicy.policy_id,
        policyName,
        policyData
      );

      if (result.success) {
        await loadData();
        setEditMode(false);
      }
    } catch (error) {
      console.error('Failed to update policy:', error);
    }
  };

  const handleDeletePolicy = async (policyId: string) => {
    if (!confirm('Are you sure you want to delete this policy?')) return;

    try {
      const result = await window.adminAPI.deletePolicy(policyId);
      if (result.success) {
        await loadData();
        if (selectedPolicy?.policy_id === policyId) {
          setSelectedPolicy(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete policy:', error);
    }
  };

  const handleAssignPolicy = async (deviceId: string, policyId: string) => {
    try {
      setAssignStatus(null);
      await window.adminAPI.assignPolicy(deviceId, policyId);

      // Push policy to device if online
      const connected = await window.adminAPI.getConnectedDevices();
      if (connected.includes(deviceId)) {
        const policy = policies.find((p) => p.policy_id === policyId);
        if (policy) {
          const data = JSON.parse(policy.policy_json);
          await window.adminAPI.pushPolicy(deviceId, {
            version: policy.policy_id.substring(0, 8),
            updatedAt: policy.updated_at,
            ...data,
          });
        }
      } else {
        const device = devices.find((d) => d.device_id === deviceId);
        const deviceLabel = device?.device_name || deviceId;
        setAssignStatus(`Policy assigned to ${deviceLabel} but the device is offline. It will be applied when the device comes online.`);
      }

      await loadData();
    } catch (error) {
      console.error('Failed to assign policy:', error);
    }
  };

  const selectPolicy = (policy: Policy) => {
    setSelectedPolicy(policy);
    setPolicyName(policy.name);
    try {
      const data = JSON.parse(policy.policy_json);
      setPolicyData({ ...defaultPolicyData, ...data });
    } catch {
      setPolicyData(defaultPolicyData);
    }
    setEditMode(false);
  };

  const resetForm = () => {
    setSelectedPolicy(null);
    setPolicyName('');
    setPolicyData(defaultPolicyData);
    setEditMode(false);
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '24px' }}>Policies</h1>

      <div style={{ display: 'flex', gap: '24px' }}>
        {/* Policy List */}
        <div style={{ width: '300px' }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '16px',
              borderBottom: '1px solid #eee',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontWeight: 600 }}>All Policies</span>
              <button
                onClick={resetForm}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#1976d2',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                + New
              </button>
            </div>

            {policies.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
                No policies created yet
              </div>
            ) : (
              <div>
                {policies.map((policy) => (
                  <div
                    key={policy.policy_id}
                    onClick={() => selectPolicy(policy)}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid #f5f5f5',
                      cursor: 'pointer',
                      backgroundColor: selectedPolicy?.policy_id === policy.policy_id ? '#e3f2fd' : 'transparent',
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{policy.name}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      Updated: {formatTime(policy.updated_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Policy Editor */}
        <div style={{ flex: 1 }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px' }}>
              {selectedPolicy ? (editMode ? 'Edit Policy' : 'Policy Details') : 'Create New Policy'}
            </h2>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                Policy Name
              </label>
              <input
                type="text"
                value={policyName}
                onChange={(e) => setPolicyName(e.target.value)}
                disabled={!!(selectedPolicy && !editMode)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #ddd',
                  fontSize: '14px',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                  Work Start Time
                </label>
                <input
                  type="time"
                  value={policyData.workScheduleStart}
                  onChange={(e) => setPolicyData({ ...policyData, workScheduleStart: e.target.value })}
                  disabled={!!(selectedPolicy && !editMode)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '6px',
                    border: '1px solid #ddd',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                  Work End Time
                </label>
                <input
                  type="time"
                  value={policyData.workScheduleEnd}
                  onChange={(e) => setPolicyData({ ...policyData, workScheduleEnd: e.target.value })}
                  disabled={!!(selectedPolicy && !editMode)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '6px',
                    border: '1px solid #ddd',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                  Idle Threshold (minutes)
                </label>
                <input
                  type="number"
                  value={Math.round(policyData.idleThreshold / 60)}
                  onChange={(e) => setPolicyData({ ...policyData, idleThreshold: (parseInt(e.target.value) || 5) * 60 })}
                  disabled={!!(selectedPolicy && !editMode)}
                  min={1}
                  max={60}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '6px',
                    border: '1px solid #ddd',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                  Break / Lunch (minutes)
                </label>
                <input
                  type="number"
                  value={policyData.breakDuration || 30}
                  onChange={(e) => setPolicyData({ ...policyData, breakDuration: parseInt(e.target.value) || 30 })}
                  disabled={!!(selectedPolicy && !editMode)}
                  min={0}
                  max={120}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '6px',
                    border: '1px solid #ddd',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              {selectedPolicy ? (
                editMode ? (
                  <>
                    <button
                      onClick={handleUpdatePolicy}
                      style={{
                        padding: '10px 24px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: '#4CAF50',
                        color: 'white',
                        cursor: 'pointer',
                      }}
                    >
                      Save Changes
                    </button>
                    <button
                      onClick={() => selectPolicy(selectedPolicy)}
                      style={{
                        padding: '10px 24px',
                        borderRadius: '8px',
                        border: '1px solid #ddd',
                        backgroundColor: 'white',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setEditMode(true)}
                      style={{
                        padding: '10px 24px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: '#1976d2',
                        color: 'white',
                        cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeletePolicy(selectedPolicy.policy_id)}
                      style={{
                        padding: '10px 24px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: '#f44336',
                        color: 'white',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </>
                )
              ) : (
                <button
                  onClick={handleCreatePolicy}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    cursor: 'pointer',
                  }}
                >
                  Create Policy
                </button>
              )}
            </div>
          </div>

          {/* Assign to Devices */}
          {selectedPolicy && !editMode && (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              marginTop: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Assign to Devices</h3>

              {assignStatus && (
                <div style={{
                  padding: '12px 16px',
                  marginBottom: '16px',
                  borderRadius: '8px',
                  backgroundColor: '#fff3e0',
                  color: '#e65100',
                  fontSize: '14px',
                  borderLeft: '4px solid #ff9800',
                }}>
                  {assignStatus}
                </div>
              )}
              
              {devices.length === 0 ? (
                <div style={{ color: '#666' }}>No devices available</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {devices.map((device) => (
                    <div
                      key={device.device_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px',
                        backgroundColor: '#f5f5f5',
                        borderRadius: '8px',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>{device.device_name}</div>
                        <div style={{ fontSize: '12px', color: '#666' }}>{device.ip}</div>
                      </div>
                      <button
                        onClick={() => handleAssignPolicy(device.device_id, selectedPolicy.policy_id)}
                        disabled={device.policy_id === selectedPolicy.policy_id}
                        style={{
                          padding: '6px 16px',
                          borderRadius: '6px',
                          border: 'none',
                          backgroundColor: device.policy_id === selectedPolicy.policy_id ? '#e0e0e0' : '#1976d2',
                          color: device.policy_id === selectedPolicy.policy_id ? '#666' : 'white',
                          cursor: device.policy_id === selectedPolicy.policy_id ? 'default' : 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        {device.policy_id === selectedPolicy.policy_id ? 'Assigned' : 'Assign'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
