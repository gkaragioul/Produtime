/**
 * PairingModal Component
 * Allows users to pair their device with an Admin Console.
 *
 * Cloud mode: pairs with the hardcoded WOT cloud admin (no URL needed).
 * Local mode: pairs with an Admin Console discovered on the LAN.
 */

import React, { useState, useEffect } from 'react';

const CLOUD_API_URL = 'https://wot-produtime-production.up.railway.app';
const CLOUD_DISPLAY_HOST = 'wot-produtime-production.up.railway.app';

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

type PairingMode = 'cloud' | 'local';

export const PairingModal: React.FC<PairingModalProps> = ({ isOpen, onClose, onPaired }) => {
  const [pairingMode, setPairingMode] = useState<PairingMode>('cloud');
  const [discoveredAdmins, setDiscoveredAdmins] = useState<DiscoveredAdmin[]>([]);
  const [selectedAdmin, setSelectedAdmin] = useState<DiscoveredAdmin | null>(null);
  const [manualHost, setManualHost] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPairCode('');
      setError(null);
      loadDiscoveredAdmins();
    }
  }, [isOpen]);

  const handleModeSwitch = (mode: PairingMode) => {
    setPairingMode(mode);
    setPairCode('');
    setError(null);
  };

  const loadDiscoveredAdmins = async () => {
    try {
      const response = await window.electronAPI.agentGetDiscoveredAdmins();
      if (response.success && response.data) {
        setDiscoveredAdmins(response.data);
        if (response.data.length > 0 && !selectedAdmin) {
          setSelectedAdmin(response.data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load discovered admins:', err);
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
    } catch {
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
    if (pairCode.length !== 6) {
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
    } catch {
      setError('Failed to connect to Admin Console');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloudPair = async () => {
    if (pairCode.length !== 6) {
      setError('Please enter a valid 6-digit pair code');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await window.electronAPI.agentStartCloudPairing(CLOUD_API_URL, pairCode);
      if (response.success && response.data?.success) {
        onPaired?.();
        onClose();
      } else {
        setError(response.data?.error || response.error || 'Cloud pairing failed');
      }
    } catch {
      setError('Failed to connect to cloud admin');
    } finally {
      setIsLoading(false);
    }
  };

  const isPairDisabled =
    isLoading ||
    pairCode.length !== 6 ||
    (pairingMode === 'local' && !selectedAdmin);

  if (!isOpen) return null;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={s.title}>Register Device</h2>
        <p style={s.subtitle}>
          Connect this device to the ProduTime Admin Console.
          Your administrator will provide a 6-digit pair code.
        </p>

        {/* Mode toggle */}
        <div style={s.toggleRow}>
          <button
            onClick={() => handleModeSwitch('cloud')}
            style={{ ...s.toggleBtn, ...(pairingMode === 'cloud' ? s.toggleActive : {}) }}
          >
            Cloud
          </button>
          <button
            onClick={() => handleModeSwitch('local')}
            style={{ ...s.toggleBtn, ...(pairingMode === 'local' ? s.toggleActive : {}) }}
          >
            Local Network
          </button>
        </div>
        <p style={s.modeHint}>
          {pairingMode === 'cloud'
            ? 'Register with the World of Travel cloud admin'
            : 'Connect to an Admin Console on your local network'}
        </p>

        {/* Cloud mode: show endpoint read-only */}
        {pairingMode === 'cloud' && (
          <div style={s.endpointBox}>
            <span style={s.endpointLabel}>Connecting to</span>
            <span style={s.endpointValue}>{CLOUD_DISPLAY_HOST}</span>
          </div>
        )}

        {/* Local mode: discovered consoles */}
        {pairingMode === 'local' && (
          <div style={{ marginBottom: 16 }}>
            <label style={s.fieldLabel}>Available Admin Consoles</label>
            {discoveredAdmins.length === 0 ? (
              <div style={s.emptyBox}>
                No Admin Consoles found on the network.
                <button onClick={() => setShowManualEntry(true)} style={s.linkBtn}>
                  Enter IP address manually
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {discoveredAdmins.map((admin) => (
                  <div
                    key={`${admin.ip}:${admin.port}`}
                    onClick={() => setSelectedAdmin(admin)}
                    style={{
                      ...s.adminCard,
                      ...(selectedAdmin?.ip === admin.ip ? s.adminCardSelected : {}),
                    }}
                  >
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{admin.name}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>{admin.ip}:{admin.port}</div>
                  </div>
                ))}
                <button onClick={() => setShowManualEntry(true)} style={s.addManualBtn}>
                  + Add manually
                </button>
              </div>
            )}
          </div>
        )}

        {/* Local mode: manual IP entry */}
        {pairingMode === 'local' && showManualEntry && (
          <div style={s.manualBox}>
            <label style={s.fieldLabel}>Admin Console IP Address</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={manualHost}
                onChange={(e) => setManualHost(e.target.value)}
                placeholder="192.168.1.100"
                style={s.input}
              />
              <button onClick={handleAddManualAdmin} style={s.addBtn}>Add</button>
            </div>
          </div>
        )}

        {/* Pair code */}
        <div style={{ marginBottom: 20 }}>
          <label style={s.fieldLabel}>Pair Code (from Admin Console)</label>
          <input
            type="text"
            value={pairCode}
            onChange={(e) => setPairCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="0 0 0 0 0 0"
            maxLength={6}
            style={s.codeInput}
          />
        </div>

        {/* Error */}
        {error && <div style={s.errorBox}>{error}</div>}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={isLoading} style={s.cancelBtn}>
            Cancel
          </button>
          <button
            onClick={handlePair}
            disabled={isPairDisabled}
            style={{ ...s.pairBtn, ...(isPairDisabled ? s.pairBtnDisabled : {}) }}
          >
            {isLoading ? 'Pairing…' : 'Pair'}
          </button>
        </div>
      </div>
    </div>
  );
};

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white', borderRadius: 12, padding: 24,
    width: 440, maxHeight: '80vh', overflow: 'auto',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  },
  title: { fontSize: 18, fontWeight: 600, marginBottom: 12 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 20 },
  toggleRow: { display: 'flex', gap: 8, marginBottom: 8 },
  toggleBtn: {
    flex: 1, padding: '10px', backgroundColor: '#f5f5f5', color: '#333',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500,
  },
  toggleActive: { backgroundColor: '#1976d2', color: 'white' },
  modeHint: { fontSize: 12, color: '#888', margin: '0 0 16px' },
  endpointBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', backgroundColor: '#f0f7ff',
    borderRadius: 8, marginBottom: 16,
    border: '1px solid #b3d4f5',
  },
  endpointLabel: { fontSize: 12, color: '#555', flexShrink: 0 },
  endpointValue: { fontSize: 13, color: '#1565c0', fontFamily: 'monospace', wordBreak: 'break-all' },
  fieldLabel: { fontSize: 13, fontWeight: 500, color: '#444', display: 'block', marginBottom: 8 },
  emptyBox: {
    padding: 12, backgroundColor: '#f5f5f5', borderRadius: 8,
    fontSize: 13, color: '#666',
  },
  linkBtn: {
    display: 'block', marginTop: 8, background: 'none', border: 'none',
    color: '#1976d2', cursor: 'pointer', fontSize: 13, padding: 0,
  },
  adminCard: {
    padding: 12, backgroundColor: '#f5f5f5', borderRadius: 8,
    cursor: 'pointer', border: '2px solid transparent',
  },
  adminCardSelected: { backgroundColor: '#e3f2fd', border: '2px solid #1976d2' },
  addManualBtn: {
    background: 'none', border: 'none', color: '#1976d2',
    cursor: 'pointer', fontSize: 13, textAlign: 'left', padding: '4px 0',
  },
  manualBox: {
    marginBottom: 16, padding: 12,
    backgroundColor: '#f5f5f5', borderRadius: 8,
  },
  input: {
    flex: 1, padding: '8px 12px', borderRadius: 6,
    border: '1px solid #ddd', fontSize: 14,
  },
  addBtn: {
    padding: '8px 16px', backgroundColor: '#1976d2', color: 'white',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
  },
  codeInput: {
    width: '100%', padding: 12, borderRadius: 8,
    border: '1px solid #ddd', fontSize: 24, textAlign: 'center',
    letterSpacing: 8, fontFamily: 'monospace', boxSizing: 'border-box',
  },
  errorBox: {
    padding: 12, backgroundColor: '#ffebee', borderRadius: 8,
    color: '#c62828', fontSize: 13, marginBottom: 16,
  },
  cancelBtn: {
    padding: '10px 20px', backgroundColor: '#f5f5f5', border: 'none',
    borderRadius: 8, cursor: 'pointer', fontSize: 14,
  },
  pairBtn: {
    padding: '10px 20px', backgroundColor: '#1976d2', color: 'white',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
  },
  pairBtnDisabled: { backgroundColor: '#ccc', cursor: 'not-allowed' },
};

export default PairingModal;
