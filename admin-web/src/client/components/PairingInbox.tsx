/**
 * Pairing Inbox Component
 * Shows pending pairing requests and allows generating pair codes
 */

import React, { useState, useEffect } from 'react';

interface PendingPair {
  request_id: string;
  device_id: string;
  device_name: string;
  app_version: string;
  os_info: string;
  ip: string;
  requested_at: number;
  expires_at: number;
}

interface PairingInboxProps {
  onCountChange?: (count: number) => void;
}

export const PairingInbox: React.FC<PairingInboxProps> = ({ onCountChange }) => {
  const [pendingPairs, setPendingPairs] = useState<PendingPair[]>([]);
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeCountdown, setCodeCountdown] = useState(0);

  useEffect(() => {
    loadPendingPairs();
    loadCurrentCode();

    // Set up event listener for new pair requests
    const unsubscribe = window.adminAPI.onPairRequest(() => {
      loadPendingPairs();
    });

    return () => unsubscribe();
  }, []);

  // Update countdown timer
  useEffect(() => {
    if (!pairCode) {
      setCodeCountdown(0);
      return;
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((pairCode.expiresAt - Date.now()) / 1000));
      setCodeCountdown(remaining);
      
      if (remaining === 0) {
        setPairCode(null);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [pairCode]);

  // Notify parent of count changes
  useEffect(() => {
    onCountChange?.(pendingPairs.length);
  }, [pendingPairs.length, onCountChange]);

  const loadPendingPairs = async () => {
    try {
      const pairs = await window.adminAPI.getPendingPairs();
      setPendingPairs(pairs);
    } catch (error) {
      console.error('Failed to load pending pairs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentCode = async () => {
    try {
      const code = await window.adminAPI.getCurrentPairCode();
      setPairCode(code);
    } catch (error) {
      console.error('Failed to load current code:', error);
    }
  };

  const handleGenerateCode = async () => {
    try {
      const result = await window.adminAPI.generatePairCode();
      setPairCode(result);
    } catch (error) {
      console.error('Failed to generate pair code:', error);
    }
  };

  const handleApprove = async (requestId: string) => {
    console.log('[PairingInbox] Approve clicked for requestId:', requestId);
    try {
      const result = await window.adminAPI.approvePairing(requestId);
      console.log('[PairingInbox] approvePairing result:', result);
      if (result.success) {
        setPendingPairs((prev) => prev.filter((p) => p.request_id !== requestId));
      } else {
        alert('Failed to approve pairing');
      }
    } catch (error) {
      console.error('[PairingInbox] Failed to approve pairing:', error);
      alert('Error: ' + String(error));
    }
  };

  const handleDeny = async (requestId: string) => {
    try {
      const result = await window.adminAPI.denyPairing(requestId);
      if (result.success) {
        setPendingPairs((prev) => prev.filter((p) => p.request_id !== requestId));
      } else {
        alert('Failed to deny pairing');
      }
    } catch (error) {
      console.error('Failed to deny pairing:', error);
    }
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
      <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '24px' }}>Device Pairing</h1>

      {/* Pair Code Generator */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Generate Pair Code</h2>
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '16px' }}>
          Generate a 6-digit code for users to enter on their ProduTime app to pair with this Admin Console.
        </p>

        {pairCode ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: '48px',
              fontWeight: 700,
              fontFamily: 'monospace',
              letterSpacing: '8px',
              color: '#1976d2',
              marginBottom: '8px',
            }}>
              {pairCode.code}
            </div>
            <div style={{ fontSize: '14px', color: '#666' }}>
              Expires in {formatCountdown(codeCountdown)}
            </div>
            <button
              onClick={handleGenerateCode}
              style={{
                marginTop: '16px',
                padding: '10px 24px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#f5f5f5',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Generate New Code
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerateCode}
            style={{
              padding: '12px 32px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#1976d2',
              color: 'white',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 500,
            }}
          >
            Generate Pair Code
          </button>
        )}
      </div>

      {/* Pending Requests */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
          Pending Requests
          {pendingPairs.length > 0 && (
            <span style={{
              marginLeft: '8px',
              backgroundColor: '#f44336',
              color: 'white',
              borderRadius: '10px',
              padding: '2px 8px',
              fontSize: '12px',
            }}>
              {pendingPairs.length}
            </span>
          )}
        </h2>

        {pendingPairs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
            No pending pairing requests
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pendingPairs.map((pair) => (
              <div
                key={pair.request_id}
                style={{
                  padding: '16px',
                  backgroundColor: '#f5f5f5',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>{pair.device_name}</div>
                  <div style={{ fontSize: '13px', color: '#666' }}>
                    {pair.os_info} • {pair.ip} • v{pair.app_version}
                  </div>
                  <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                    Requested: {formatTime(pair.requested_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleApprove(pair.request_id)}
                    style={{
                      padding: '8px 20px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: '#4CAF50',
                      color: 'white',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleDeny(pair.request_id)}
                    style={{
                      padding: '8px 20px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: '#f44336',
                      color: 'white',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
