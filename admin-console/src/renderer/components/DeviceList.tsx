/**
 * Device List Component
 * Shows all paired devices with their status and controls
 */

import React, { useState, useEffect } from 'react';

interface Device {
  device_id: string;
  device_name: string;
  device_pubkey: string;
  paired_at: number;
  last_seen: number;
  status: string;
  app_version: string;
  ip: string;
  policy_id?: string;
  isOnline?: boolean;
}

interface DeviceListProps {
  onDeviceClick?: (deviceId: string) => void;
}

export const DeviceList: React.FC<DeviceListProps> = ({ onDeviceClick }) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadDevices();

    // Set up event listeners
    const unsubConnect = window.adminAPI.onDeviceConnected((deviceId) => {
      console.log('[DeviceList] device:connected event received for:', deviceId);
      setConnectedIds((prev) => {
        if (!prev.includes(deviceId)) {
          return [...prev, deviceId];
        }
        return prev;
      });
      // Also reload devices to get the new device in the list
      loadDevices();
    });

    const unsubDisconnect = window.adminAPI.onDeviceDisconnected((deviceId) => {
      console.log('[DeviceList] device:disconnected event received for:', deviceId);
      setConnectedIds((prev) => prev.filter((id) => id !== deviceId));
    });

    // Periodic refresh to catch any missed updates
    const refreshInterval = setInterval(() => {
      loadDevices();
    }, 5000); // Refresh every 5 seconds

    return () => {
      unsubConnect();
      unsubDisconnect();
      clearInterval(refreshInterval);
    };
  }, []);

  const loadDevices = async () => {
    try {
      const [deviceList, connected] = await Promise.all([
        window.adminAPI.getAllDevices(),
        window.adminAPI.getConnectedDevices(),
      ]);
      console.log('[DeviceList] Loaded devices:', deviceList.length, 'connected:', connected);
      setDevices(deviceList);
      setConnectedIds(connected);
    } catch (error) {
      console.error('Failed to load devices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLock = async (device: Device) => {
    const reason = prompt('Enter lock reason:');
    if (!reason) return;

    const message = prompt('Enter message to display to user:', 'Your device has been locked by the administrator.');
    if (!message) return;

    const result = await window.adminAPI.lockDevice(device.device_id, reason, message);
    if (result.success) {
      alert('Device locked successfully');
    } else {
      alert('Failed to lock device');
    }
  };

  const handleUnlock = async (device: Device) => {
    const result = await window.adminAPI.unlockDevice(device.device_id);
    if (result.success) {
      alert('Device unlocked successfully');
    } else {
      alert('Failed to unlock device');
    }
  };

  const handleRequestExport = async (device: Device) => {
    const result = await window.adminAPI.requestExport(device.device_id, {
      reportType: 'daily',
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      deliveryMode: 'local',
    });
    if (result.success) {
      alert('Export requested');
    } else {
      alert('Failed to request export');
    }
  };

  const handleDelete = async (device: Device) => {
    if (!confirm(`Are you sure you want to remove ${device.device_name}?`)) return;

    const result = await window.adminAPI.deleteDevice(device.device_id);
    if (result.success) {
      setDevices((prev) => prev.filter((d) => d.device_id !== device.device_id));
      setSelectedDevice(null);
    } else {
      alert('Failed to remove device');
    }
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  const filteredDevices = devices.filter((d) =>
    d.device_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.ip.includes(searchTerm)
  );

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div>Loading devices...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600 }}>Devices</h1>
        <input
          type="text"
          placeholder="Search devices..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid #ddd',
            width: '250px',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '24px' }}>
        {/* Device List */}
        <div style={{ flex: 1 }}>
          <div style={{ backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            {filteredDevices.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                {devices.length === 0 ? 'No devices paired yet' : 'No devices match your search'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <th style={{ textAlign: 'left', padding: '16px', fontSize: '13px', color: '#666' }}>Device</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontSize: '13px', color: '#666' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontSize: '13px', color: '#666' }}>Version</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontSize: '13px', color: '#666' }}>Last Seen</th>
                    <th style={{ textAlign: 'right', padding: '16px', fontSize: '13px', color: '#666' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDevices.map((device) => {
                    const isOnline = connectedIds.includes(device.device_id);
                    return (
                      <tr
                        key={device.device_id}
                        onClick={() => setSelectedDevice(device)}
                        onDoubleClick={() => onDeviceClick?.(device.device_id)}
                        style={{
                          borderBottom: '1px solid #f5f5f5',
                          cursor: 'pointer',
                          backgroundColor: selectedDevice?.device_id === device.device_id ? '#f5f5f5' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '16px' }}>
                          <div style={{ fontWeight: 500 }}>{device.device_name}</div>
                          <div style={{ fontSize: '12px', color: '#999' }}>{device.ip}</div>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            backgroundColor: isOnline ? '#e8f5e9' : '#f5f5f5',
                            color: isOnline ? '#2e7d32' : '#666',
                          }}>
                            <span style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              backgroundColor: isOnline ? '#4CAF50' : '#9e9e9e',
                            }} />
                            {isOnline ? 'Online' : 'Offline'}
                          </span>
                        </td>
                        <td style={{ padding: '16px', fontSize: '13px', color: '#666' }}>
                          {device.app_version || 'Unknown'}
                        </td>
                        <td style={{ padding: '16px', fontSize: '13px', color: '#666' }}>
                          {formatTime(device.last_seen)}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'right' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRequestExport(device); }}
                            disabled={!isOnline}
                            style={{
                              padding: '6px 12px',
                              marginRight: '8px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: isOnline ? '#2196F3' : '#ccc',
                              color: 'white',
                              cursor: isOnline ? 'pointer' : 'not-allowed',
                              fontSize: '12px',
                            }}
                          >
                            Export
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(device); }}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#f44336',
                              color: 'white',
                              cursor: 'pointer',
                              fontSize: '12px',
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Device Details Panel */}
        {selectedDevice && (
          <div style={{ width: '320px' }}>
            <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Device Details</h3>
              
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Name</div>
                <div style={{ fontWeight: 500 }}>{selectedDevice.device_name}</div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>IP Address</div>
                <div>{selectedDevice.ip}</div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>App Version</div>
                <div>{selectedDevice.app_version || 'Unknown'}</div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Paired At</div>
                <div>{formatTime(selectedDevice.paired_at)}</div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Device ID</div>
                <div style={{ fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {selectedDevice.device_id}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleLock(selectedDevice)}
                  disabled={!connectedIds.includes(selectedDevice.device_id)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#ff9800',
                    color: 'white',
                    cursor: connectedIds.includes(selectedDevice.device_id) ? 'pointer' : 'not-allowed',
                    opacity: connectedIds.includes(selectedDevice.device_id) ? 1 : 0.5,
                  }}
                >
                  Lock
                </button>
                <button
                  onClick={() => handleUnlock(selectedDevice)}
                  disabled={!connectedIds.includes(selectedDevice.device_id)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    cursor: connectedIds.includes(selectedDevice.device_id) ? 'pointer' : 'not-allowed',
                    opacity: connectedIds.includes(selectedDevice.device_id) ? 1 : 0.5,
                  }}
                >
                  Unlock
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
