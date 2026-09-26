/**
 * PairingModal Component
 * Allows users to pair their device with an admin server whose address they
 * enter. There is no built-in server: nothing is contacted until the user
 * enters an address and a pair code and presses Pair.
 */

import React, { useState, useEffect } from 'react';

// Returns an error message, or null when the address is a usable https:// URL.
function validateServerUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter the address of your admin server';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return 'The server address must start with https://';
    return null;
  } catch {
    return 'Enter a full address, for example https://admin.example.com';
  }
}

interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaired?: () => void;
}

export const PairingModal: React.FC<PairingModalProps> = ({ isOpen, onClose, onPaired }) => {
  const [serverUrl, setServerUrl] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPairCode('');
      setError(null);
    }
  }, [isOpen]);

  const handlePair = async () => {
    const urlError = validateServerUrl(serverUrl);
    if (urlError) {
      setError(urlError);
      return;
    }
    if (pairCode.length !== 6) {
      setError('Please enter a valid 6-digit pair code');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await window.electronAPI.agentStartCloudPairing(serverUrl.trim(), pairCode);
      if (response.success && response.data?.success) {
        onPaired?.();
        onClose();
      } else {
        setError(response.data?.error || response.error || 'Pairing failed');
      }
    } catch {
      setError('Failed to connect to the admin server');
    } finally {
      setIsLoading(false);
    }
  };

  const isPairDisabled = isLoading || pairCode.length !== 6 || !serverUrl.trim();

  if (!isOpen) return null;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={s.title}>Register Device</h2>
        <p style={s.subtitle}>
          Connect this device to an admin server. Your administrator will give
          you the server address and a 6-digit pair code. Once paired, this
          device sends its name, IP address, app version and activity summaries
          to that server.
        </p>

        {/* Server address */}
        <div style={{ marginBottom: 16 }}>
          <label style={s.fieldLabel}>Admin server address</label>
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://admin.example.com"
            style={s.urlInput}
          />
        </div>

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
  urlInput: {
    width: '100%', padding: 10, borderRadius: 8,
    border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box',
  },
  fieldLabel: { fontSize: 13, fontWeight: 500, color: '#444', display: 'block', marginBottom: 8 },
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
