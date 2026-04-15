import React from 'react';

const LOCKER_URL = 'https://app-production-f45b.up.railway.app';

export const LockerView: React.FC = () => {
  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ margin: '0 0 16px', fontSize: '24px' }}>Password Locker</h1>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        border: '1px solid #ddd',
        padding: '32px',
        maxWidth: '640px',
      }}>
        <p style={{ margin: '0 0 20px', color: '#555', lineHeight: 1.5 }}>
          WOT Locker is the team's shared password manager. It opens in a new
          tab and has its own login.
        </p>
        <a
          href={LOCKER_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#1a1a2e',
            color: 'white',
            borderRadius: '6px',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          Open Password Locker ↗
        </a>
      </div>
    </div>
  );
};
