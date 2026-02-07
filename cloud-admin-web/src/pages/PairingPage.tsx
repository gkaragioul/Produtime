/**
 * Pairing Management Page
 * Requirements: 3.1, 3.6 - Pairing management with approve/deny actions
 */

import React, { useState, useEffect, useCallback } from 'react';
import { api, PairCodeResponse, PendingPairRequest } from '../services/api';

export const PairingPage: React.FC = () => {
  const [pairCode, setPairCode] = useState<PairCodeResponse | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PendingPairRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const requests = await api.getPendingRequests();
      setPendingRequests(requests);
    } catch (err) {
      console.error('Failed to load pending requests:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [loadData]);

  // Check if pair code is expired
  useEffect(() => {
    if (pairCode && Date.now() > pairCode.expiresAt) {
      setPairCode(null);
    }
  }, [pairCode]);

  const handleGenerateCode = async () => {
    setGeneratingCode(true);
    setError(null);
    try {
      const code = await api.generatePairCode();
      setPairCode(code);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setError(error.response?.data?.message || 'Failed to generate pair code');
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setProcessingId(requestId);
    setError(null);
    setSuccess(null);
    try {
      await api.approvePairing(requestId);
      setSuccess('Device paired successfully');
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setError(error.response?.data?.message || 'Failed to approve pairing');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeny = async (requestId: string) => {
    setProcessingId(requestId);
    setError(null);
    setSuccess(null);
    try {
      await api.denyPairing(requestId);
      setSuccess('Pairing request denied');
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setError(error.response?.data?.message || 'Failed to deny pairing');
    } finally {
      setProcessingId(null);
    }
  };

  const formatTimeRemaining = (expiresAt: number): string => {
    const remaining = Math.max(0, expiresAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div
        style={{
          padding: '40px',
          textAlign: 'center',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>Device Pairing</h1>
        <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
          Generate pair codes and manage pairing requests from ProduTime clients.
        </p>
      </div>

      {/* Notifications */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#ffebee',
            borderRadius: '8px',
            marginBottom: '16px',
            color: '#c62828',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#e8f5e9',
            borderRadius: '8px',
            marginBottom: '16px',
            color: '#2e7d32',
            fontSize: '14px',
          }}
        >
          {success}
        </div>
      )}

      {/* Pair Code Section */}
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Generate Pair Code</h2>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '16px' }}>
          Generate a 6-digit code that employees can enter in their ProduTime client to request pairing.
        </p>

        {pairCode && Date.now() < pairCode.expiresAt ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div
              style={{
                fontSize: '48px',
                fontWeight: 700,
                letterSpacing: '8px',
                color: '#1976d2',
                marginBottom: '12px',
                fontFamily: 'monospace',
              }}
            >
              {pairCode.code}
            </div>
            <div style={{ fontSize: '14px', color: '#666' }}>
              Expires in <span style={{ fontWeight: 600 }}>{formatTimeRemaining(pairCode.expiresAt)}</span>
            </div>
            <button
              onClick={handleGenerateCode}
              disabled={generatingCode}
              style={{
                marginTop: '16px',
                padding: '10px 20px',
                fontSize: '14px',
                backgroundColor: '#e0e0e0',
                color: '#333',
                border: 'none',
                borderRadius: '8px',
                cursor: generatingCode ? 'not-allowed' : 'pointer',
              }}
            >
              Generate New Code
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerateCode}
            disabled={generatingCode}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: 600,
              backgroundColor: generatingCode ? '#90caf9' : '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: generatingCode ? 'not-allowed' : 'pointer',
            }}
          >
            {generatingCode ? 'Generating...' : 'Generate Pair Code'}
          </button>
        )}
      </div>

      {/* Pending Requests Section */}
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
            Pending Requests
            {pendingRequests.length > 0 && (
              <span
                style={{
                  marginLeft: '8px',
                  padding: '2px 8px',
                  backgroundColor: '#fff3e0',
                  color: '#e65100',
                  borderRadius: '10px',
                  fontSize: '12px',
                }}
              >
                {pendingRequests.length}
              </span>
            )}
          </h2>
          <button
            onClick={loadData}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              backgroundColor: '#f5f5f5',
              color: '#666',
              border: '1px solid #ddd',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>

        {pendingRequests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
            <div style={{ fontSize: '14px' }}>No pending pairing requests</div>
            <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
              Generate a pair code and share it with employees to start pairing devices.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                style={{
                  padding: '16px',
                  backgroundColor: '#fafafa',
                  borderRadius: '8px',
                  border: '1px solid #eee',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>{request.deviceName}</div>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                      <span>Version: {request.appVersion}</span>
                      <span style={{ margin: '0 8px' }}>•</span>
                      <span>{request.osInfo}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#999' }}>
                      <span>IP: {request.ip}</span>
                      <span style={{ margin: '0 8px' }}>•</span>
                      <span>Requested: {formatDate(request.createdAt)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleApprove(request.id)}
                      disabled={processingId === request.id}
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 500,
                        backgroundColor: processingId === request.id ? '#a5d6a7' : '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: processingId === request.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {processingId === request.id ? '...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleDeny(request.id)}
                      disabled={processingId === request.id}
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 500,
                        backgroundColor: processingId === request.id ? '#ef9a9a' : '#f44336',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: processingId === request.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {processingId === request.id ? '...' : 'Deny'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
