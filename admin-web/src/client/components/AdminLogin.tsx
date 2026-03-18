/**
 * Admin Login Component
 * Simple password gate for the admin console.
 */

import React, { useState } from 'react';

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await window.adminAuth.login(password);
      if (result.success) {
        onLoginSuccess();
      } else {
        setError(result.error || 'Invalid password');
        setPassword('');
      }
    } catch (err) {
      setError('Authentication error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#1a1a2e',
      zIndex: 9999,
    }}>
      <div style={{
        backgroundColor: '#16213e',
        borderRadius: '8px',
        padding: '40px',
        width: '360px',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{
            color: 'white',
            fontSize: '20px',
            fontWeight: 600,
            margin: '0 0 8px 0',
          }}>
            ProduTime Admin Console
          </h1>
          <div style={{ color: '#888', fontSize: '13px' }}>
            Enter password to continue
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                backgroundColor: '#0f3460',
                border: error ? '1px solid #f44336' : '1px solid #333',
                borderRadius: '4px',
                color: 'white',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{
              color: '#f44336',
              fontSize: '13px',
              marginBottom: '16px',
              textAlign: 'center',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '14px',
              fontWeight: 600,
              backgroundColor: loading || !password ? '#2a5a3a' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading || !password ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};
