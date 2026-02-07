/**
 * AdminLockScreen Component
 * Displayed when admin has soft-locked the app
 * Does NOT lock the OS - only the ProduTime UI
 */

import React from 'react';

interface AdminLockScreenProps {
  message: string;
  adminName?: string | null;
}

export const AdminLockScreen: React.FC<AdminLockScreenProps> = ({ message, adminName }) => {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#f5f5f5',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '48px',
          textAlign: 'center',
          maxWidth: '400px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
        }}
      >
        {/* Lock Icon */}
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            backgroundColor: '#fff3e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f57c00"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px', color: '#333' }}>
          App Locked
        </h1>

        <p style={{ fontSize: '14px', color: '#666', marginBottom: '24px', lineHeight: 1.6 }}>
          {message || 'This application has been temporarily locked by your administrator.'}
        </p>

        {adminName && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#f5f5f5',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#666',
            }}
          >
            Managed by: <strong>{adminName}</strong>
          </div>
        )}

        <p style={{ fontSize: '12px', color: '#999', marginTop: '24px' }}>
          Contact your administrator to unlock this application.
        </p>
      </div>
    </div>
  );
};

export default AdminLockScreen;
