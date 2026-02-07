/**
 * PairingModal Component
 * Allows users to pair their device with an Admin Console
 * 
 * COMPLIANCE: Pairing is explicit and user-initiated.
 * User must enter a pair code shown on the Admin Console.
 */

import React, { useState, useEffect } from 'react';

interface DiscoveredAdmin {
  host: string;
  port: number;
  name: string;
  ip: string;
}

interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaired?: () => void;
}

type PairingMode = 'local' | 'cloud';

export const PairingModal: React.FC<PairingModalProps> = ({ isOpen, onClose, onPaired }) => {
  const [pairingMode, setPairingMode] = useState<PairingMode>('local');
  const [discoveredAdmins, setDiscoveredAdmins] = useState<DiscoveredAdmin[]>([]);
  const [selectedAdmin, setSelectedAdmin] = useState<DiscoveredAdmin | null>(null);
  const [manualHost, setManualHost] = useState('');
  const [cloudApiUrl, setCloudApiUrl] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadDiscoveredAdmins();
    }
  }, [isOpen]);

  const loadDiscoveredAdmins = async () => {
    try {
      const response = await window.electronAPI.agentGetDiscoveredAdmins();
      if (response.success && response.data) {
        setDiscoveredAdmins(response.data);
        // Auto-select the first discovered admin if none selected
        if (response.data.length > 0 && !selectedAdmin) {
          setSelectedAdmin(response.data[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load discovered admins:', error);
    }
  };

  const handleAddManualAdmin = async () => {
    if (!manualHost.trim()) {
      setError('Please enter an IP address or hostname');
      return;
    }

    try {
      const response = await window.electronAPI.agentAddManualAdmin(manualHost.trim());
      if (response.success && response.data) {
        setDiscoveredAdmins((prev) => [...prev, response.data]);
        setSelectedAdmin(response.data);
        setManualHost('');
        setShowManualEntry(false);
      }
    } catch (error) {
      setError('Failed to add admin console');
    }
  };

  const handlePair = async () => {
    if (pairingMode === 'cloud') {
      await handleCloudPair();
    } else {
      await handleLocalPair();
    }
  };

  const handleLocalPair = async () => {
    if (!selectedAdmin) {
      setError('Please select an Admin Console');
      return;
    }

    if (!pairCode.trim() || pairCode.length !== 6) {
      setError('Please enter a valid 6-digit pair code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const adminHost = `${selectedAdmin.ip}:${selectedAdmin.port}`;
      const response = await window.electronAPI.agentStartPairing(adminHost, pairCode);

      if (response.success && response.data?.success) {
        onPaired?.();
        onClose();
      } else {
        setError(response.data?.error || response.error || 'Pairing failed');
      }
    } catch (error) {
      setError('Failed to connect to Admin Console');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloudPair = async () => {
    if (!cloudApiUrl.trim()) {
      setError('Please enter the cloud admin URL');
      return;
    }

    if (!pairCode.trim() || pairCode.length !== 6) {
      setError('Please enter a valid 6-digit pair code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Normalize the URL
      let apiUrl = cloudApiUrl.trim();
      if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
        apiUrl = 'https://' + apiUrl;
      }

      const response = await window.electronAPI.agentStartCloudPairing(apiUrl, pairCode);

      if (response.success && response.data?.success) {
        onPaired?.();
        onClose();
      } else {
        setError(response.data?.error || response.error || 'Cloud pairing failed');
      }
    } catch (error) {
      setError('Failed to connect to cloud admin');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          width: '440px',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
          Pair with Admin Console
        </h2>

        <p style={{ fontSize: '14px', color: '#666', marginBottom: '20px' }}>
          Connect this device to an Admin Console for centralized management.
          Your administrator will provide a 6-digit pair code.
        </p>

        {/* Pairing Mode Toggle */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button
              onClick={() => setPairingMode('local')}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: pairingMode === 'local' ? '#1976d2' : '#f5f5f5',
                color: pairingMode === 'local' ? 'white' : '#333',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              Local Network
            </button>
            <button
              onClick={() => setPairingMode('cloud')}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: pairingMode === 'cloud' ? '#1976d2' : '#f5f5f5',
                color: pairingMode === 'cloud' ? 'white' : '#333',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              Cloud
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
            {pairingMode === 'local' 
              ? 'Connect to an Admin Console on your local network'
              : 'Connect to a cloud-hosted Admin Console'}
          </p>
        </div>

        {/* Local Mode: Discovered Admin Consoles */}
        {pairingMode === 'local' && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#444', display: 'block', marginBottom: '8px' }}>
              Available Admin Consoles
            </label>
            
            {discoveredAdmins.length === 0 ? (
              <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '8px', fontSize: '13px', color: '#666' }}>
                No Admin Consoles found on the network.
                <button
                  onClick={() => setShowManualEntry(true)}
                  style={{
                    display: 'block',
                    marginTop: '8px',
                    background: 'none',
                    border: 'none',
                    color: '#1976d2',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  Enter IP address manually
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {discoveredAdmins.map((admin) => (
                  <div
                    key={`${admin.ip}:${admin.port}`}
                    onClick={() => setSelectedAdmin(admin)}
                    style={{
                      padding: '12px',
                      backgroundColor: selectedAdmin?.ip === admin.ip ? '#e3f2fd' : '#f5f5f5',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      border: selectedAdmin?.ip === admin.ip ? '2px solid #1976d2' : '2px solid transparent',
                    }}
                  >
                    <div style={{ fontWeight: 500, fontSize: '14px' }}>{admin.name}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>{admin.ip}:{admin.port}</div>
                  </div>
                ))}
                <button
                  onClick={() => setShowManualEntry(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#1976d2',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left',
                    padding: '4px 0',
                  }}
                >
                  + Add manually
                </button>
              </div>
            )}
          </div>
        )}

        {/* Local Mode: Manual Entry */}
        {pairingMode === 'local' && showManualEntry && (
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#444', display: 'block', marginBottom: '8px' }}>
              Admin Console IP Address
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={manualHost}
                onChange={(e) => setManualHost(e.target.value)}
                placeholder="192.168.1.100"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #ddd',
                  fontSize: '14px',
                }}
              />
              <button
                onClick={handleAddManualAdmin}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#1976d2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Cloud Mode: API URL Entry */}
        {pairingMode === 'cloud' && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#444', display: 'block', marginBottom: '8px' }}>
              Cloud Admin URL
            </label>
            <input
              type="text"
              value={cloudApiUrl}
              onChange={(e) => setCloudApiUrl(e.target.value)}
              placeholder="admin.yourcompany.com"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
              Enter the URL provided by your administrator
            </p>
          </div>
        )}

        {/* Pair Code Entry */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, color: '#444', display: 'block', marginBottom: '8px' }}>
            Pair Code (from Admin Console)
          </label>
          <input
            type="text"
            value={pairCode}
            onChange={(e) => setPairCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #ddd',
              fontSize: '24px',
              textAlign: 'center',
              letterSpacing: '8px',
              fontFamily: 'monospace',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            padding: '12px',
            backgroundColor: '#ffebee',
            borderRadius: '8px',
            color: '#c62828',
            fontSize: '13px',
            marginBottom: '16px',
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={isLoading}
            style={{
              padding: '10px 20px',
              backgroundColor: '#f5f5f5',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handlePair}
            disabled={isLoading || (pairingMode === 'local' && !selectedAdmin) || (pairingMode === 'cloud' && !cloudApiUrl.trim()) || pairCode.length !== 6}
            style={{
              padding: '10px 20px',
              backgroundColor: isLoading || (pairingMode === 'local' && !selectedAdmin) || (pairingMode === 'cloud' && !cloudApiUrl.trim()) || pairCode.length !== 6 ? '#ccc' : '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: isLoading || (pairingMode === 'local' && !selectedAdmin) || (pairingMode === 'cloud' && !cloudApiUrl.trim()) || pairCode.length !== 6 ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            {isLoading ? 'Pairing...' : 'Pair'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PairingModal;
