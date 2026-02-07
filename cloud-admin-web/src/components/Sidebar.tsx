/**
 * Sidebar Navigation Component
 */

import React, { useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../App';

interface SidebarProps {
  pendingCount: number;
  tenantName?: string;
}

interface NavItem {
  id: string;
  path: string;
  label: string;
  icon: string;
  badge?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ pendingCount, tenantName }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useContext(AuthContext);

  const navItems: NavItem[] = [
    { id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'pairing', path: '/pairing', label: 'Pairing', icon: '🔗', badge: pendingCount > 0 ? pendingCount : undefined },
  ];

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div
      className="sidebar"
      style={{
        width: '240px',
        backgroundColor: '#1a1a2e',
        color: 'white',
        padding: '20px 0',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ padding: '0 20px 20px', borderBottom: '1px solid #333' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>ProduTime</h1>
        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Cloud Admin Console</div>
      </div>

      {/* Tenant Info */}
      {tenantName && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #333', fontSize: '12px' }}>
          <div style={{ color: '#888', marginBottom: '4px' }}>Organization</div>
          <div style={{ color: '#4CAF50', fontWeight: 500 }}>{tenantName}</div>
        </div>
      )}

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '20px 0' }}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.path)}
            style={{
              width: '100%',
              padding: '12px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              background: location.pathname === item.path ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: 'none',
              color: location.pathname === item.path ? 'white' : '#aaa',
              cursor: 'pointer',
              fontSize: '14px',
              textAlign: 'left',
              borderLeft: location.pathname === item.path ? '3px solid #4CAF50' : '3px solid transparent',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.badge && (
              <span
                style={{
                  backgroundColor: '#f44336',
                  color: 'white',
                  borderRadius: '10px',
                  padding: '2px 8px',
                  fontSize: '11px',
                }}
              >
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* User Info & Logout */}
      <div style={{ padding: '20px', borderTop: '1px solid #333' }}>
        {user && (
          <div style={{ marginBottom: '12px', fontSize: '12px' }}>
            <div style={{ color: '#888', marginBottom: '4px' }}>Logged in as</div>
            <div style={{ color: '#fff', wordBreak: 'break-all' }}>{user.email}</div>
          </div>
        )}
        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: '6px',
            color: '#aaa',
            cursor: 'pointer',
            fontSize: '13px',
            transition: 'all 0.15s ease',
          }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};
