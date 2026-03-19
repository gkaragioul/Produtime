/**
 * ProduTime Admin Console - Main App Component (Freeware Edition)
 * No license gate — all features available immediately.
 */

import React, { useState, useEffect } from 'react';
import './mobile.css';
import { AdminLogin } from './components/AdminLogin';
import { DeviceList } from './components/DeviceList';
import { PairingInbox } from './components/PairingInbox';
import { PolicyManager } from './components/PolicyManager';
import { Dashboard } from './components/Dashboard';
import { LogViewer } from './components/LogViewer';
import { DeviceDetailPage } from './components/DeviceDetailPage';
import { AppCategorization } from './components/AppCategorization';
import { Analytics } from './components/Analytics';
import {
  DashboardSummaryResponse,
  DashboardSummaryEnhanced,
  DeviceListItem,
  DeviceListItemEnhanced,
  DeviceDetailResponse,
  AttentionResponse,
  DashboardStory,
  RankingsResponse,
  TrendsResponse,
} from '../shared/dashboard-types';

// Logo — use the copied asset path
const adminLogo = 'assets/PTAdminIcon.png';

type PageType = 'dashboard' | 'devices' | 'policies' | 'pairing' | 'logs' | 'device-detail' | 'app-categories' | 'analytics';

declare global {
  interface Window {
    adminAuth: {
      login: (password: string) => Promise<{ success: boolean; error?: string }>;
      isAuthenticated: () => Promise<{ authenticated: boolean }>;
      logout: () => Promise<{ success: boolean }>;
    };
    adminAPI: {
      // Device operations
      getAllDevices: () => Promise<any[]>;
      getDevice: (deviceId: string) => Promise<any>;
      deleteDevice: (deviceId: string) => Promise<{ success: boolean }>;
      getConnectedDevices: () => Promise<string[]>;
      getAllPolicies: () => Promise<any[]>;
      getPolicy: (policyId: string) => Promise<any>;
      createPolicy: (policy: any) => Promise<{ success: boolean; policyId: string }>;
      updatePolicy: (policyId: string, name: string, data: any) => Promise<{ success: boolean }>;
      deletePolicy: (policyId: string) => Promise<{ success: boolean }>;
      assignPolicy: (deviceId: string, policyId: string) => Promise<{ success: boolean }>;
      pushPolicy: (deviceId: string, policy: any) => Promise<{ success: boolean }>;
      generatePairCode: () => Promise<{ code: string; expiresAt: number }>;
      getCurrentPairCode: () => Promise<{ code: string; expiresAt: number } | null>;
      getPendingPairs: () => Promise<any[]>;
      approvePairing: (requestId: string) => Promise<{ success: boolean }>;
      denyPairing: (requestId: string) => Promise<{ success: boolean }>;
      lockDevice: (deviceId: string, reason: string, message: string) => Promise<{ success: boolean }>;
      unlockDevice: (deviceId: string) => Promise<{ success: boolean }>;
      requestExport: (deviceId: string, options: any) => Promise<{ success: boolean }>;
      getAuditLogs: (limit?: number) => Promise<any[]>;
      getServerInfo: () => Promise<{ port: number; publicKey: string; connectedDevices: number }>;
      getDeviceStats: (deviceId: string) => Promise<any>;
      onDeviceConnected: (callback: (deviceId: string) => void) => () => void;
      onDeviceDisconnected: (callback: (deviceId: string) => void) => () => void;
      onPairRequest: (callback: (request: any) => void) => () => void;
      onStatsReceived: (callback: (data: any) => void) => () => void;
      onServerStarted: (callback: (info: any) => void) => () => void;
      onServerLog: (callback: (message: string) => void) => () => void;
      getServerLogs: (count?: number) => Promise<string[]>;
      // Dashboard API
      getDashboardSummary: (range: 'today' | '7d') => Promise<DashboardSummaryResponse | null>;
      getDashboardDevices: () => Promise<DeviceListItem[]>;
      getDeviceDetail: (deviceId: string, range: 'today' | '7d') => Promise<DeviceDetailResponse | null>;
      getExceptions: (resolved?: boolean) => Promise<any[]>;
      resolveException: (id: number) => Promise<{ success: boolean }>;
      getExceptionCounts: () => Promise<Record<string, number>>;
      getRecentHeartbeats: (limit?: number) => Promise<any[]>;
      getRecentCommands: (limit?: number) => Promise<any[]>;
      // Enhanced Dashboard API
      getDashboardSummaryEnhanced: (range: 'today' | '7d') => Promise<DashboardSummaryEnhanced | null>;
      getDashboardDevicesEnhanced: () => Promise<DeviceListItemEnhanced[]>;
      getAttention: () => Promise<AttentionResponse>;
      getDashboardStory: () => Promise<DashboardStory | null>;
      getRankings: () => Promise<RankingsResponse | null>;
      getTrends: (scope: 'team' | 'device', deviceId?: string, days?: number) => Promise<TrendsResponse | null>;
      getDeviceDetailEnhanced: (deviceId: string, range: 'today' | '7d' | '30d') => Promise<any>;
      // App Categorization API
      getAppUsageAggregates: () => Promise<any[]>;
      getAppCategory: (appName: string) => Promise<any>;
      setAppCategory: (appName: string, category: string) => Promise<{ success: boolean }>;
      setAppCategoriesBulk: (apps: Array<{ appName: string; category: string }>) => Promise<{ success: boolean }>;
      getAllAppCategories: () => Promise<any[]>;
      // Analytics API
      getAnalyticsMetrics: (params: { deviceId?: string; startDate: string; endDate: string }) => Promise<any[]>;
      // Weekly Insights API
      getWeeklyInsights: (weekEnd?: string) => Promise<any[]>;
      getWeeklyReports: () => Promise<any[]>;
      getWeeklyReport: (weekEnd: string) => Promise<any>;
      generateWeeklyReport: () => Promise<{ success: boolean; message?: string }>;
    };
  }
}

const App: React.FC = () => {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [serverInfo, setServerInfo] = useState<{ port: number; publicKey: string } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [connectedCount, setConnectedCount] = useState(0);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Check auth state on mount
  useEffect(() => {
    window.adminAuth.isAuthenticated().then((result) => {
      setAuthenticated(result.authenticated);
    }).catch(() => {
      setAuthenticated(false);
    });
  }, []);

  // Load server data and subscribe to events (only when authenticated)
  useEffect(() => {
    if (!authenticated) return;

    const loadData = async () => {
      try {
        const info = await window.adminAPI.getServerInfo();
        setServerInfo({ port: info.port, publicKey: info.publicKey });
        setConnectedCount(info.connectedDevices);

        const pending = await window.adminAPI.getPendingPairs();
        setPendingCount(pending.length);
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    };

    loadData();

    const unsubConnect = window.adminAPI.onDeviceConnected(() => {
      setConnectedCount((c) => c + 1);
    });

    const unsubDisconnect = window.adminAPI.onDeviceDisconnected(() => {
      setConnectedCount((c) => Math.max(0, c - 1));
    });

    const unsubPairRequest = window.adminAPI.onPairRequest(() => {
      setPendingCount((c) => c + 1);
    });

    const unsubServerStarted = window.adminAPI.onServerStarted((info) => {
      setServerInfo(info);
    });

    return () => {
      unsubConnect();
      unsubDisconnect();
      unsubPairRequest();
      unsubServerStarted();
    };
  }, [authenticated]);

  const handleLogout = async () => {
    await window.adminAuth.logout();
    setAuthenticated(false);
  };

  // Show nothing while checking auth
  if (authenticated === null) {
    return null;
  }

  // Show login screen if not authenticated
  if (!authenticated) {
    return <AdminLogin onLoginSuccess={() => setAuthenticated(true)} />;
  }

  const navigateToDeviceDetail = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setCurrentPage('device-detail');
  };

  const navigateBack = () => {
    setSelectedDeviceId(null);
    setCurrentPage('dashboard');
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'analytics', label: 'Analytics', icon: '📈' },
    { id: 'devices', label: 'Devices', icon: '💻' },
    { id: 'app-categories', label: 'App Categories', icon: '📱' },
    { id: 'policies', label: 'Policies', icon: '📋' },
    { id: 'pairing', label: 'Pairing', icon: '🔗', badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'logs', label: 'Server Logs', icon: '📝' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Mobile hamburger button */}
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle menu"
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <div
        className={`app-sidebar${sidebarOpen ? ' open' : ''}`}
        style={{
          width: '240px',
          backgroundColor: '#1a1a2e',
          color: 'white',
          padding: '20px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Logo */}
        <div style={{ padding: '10px 20px 20px', borderBottom: '1px solid #333' }}>
          <img
            src={adminLogo}
            alt="ProduTime Admin"
            style={{
              height: '50px',
              width: 'auto',
              display: 'block',
            }}
          />
          <div style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>Admin Console</div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '20px 0' }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => { setCurrentPage(item.id as PageType); setSidebarOpen(false); }}
              style={{
                width: '100%',
                padding: '12px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                background: currentPage === item.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                border: 'none',
                color: currentPage === item.id ? 'white' : '#aaa',
                cursor: 'pointer',
                fontSize: '14px',
                textAlign: 'left',
                borderLeft: currentPage === item.id ? '3px solid #4CAF50' : '3px solid transparent',
              }}
            >
              <span>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span style={{
                  backgroundColor: '#f44336',
                  color: 'white',
                  borderRadius: '10px',
                  padding: '2px 8px',
                  fontSize: '11px',
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Logout Button */}
        <div style={{ padding: '0 20px 10px' }}>
          <button
            onClick={handleLogout}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: '13px',
              backgroundColor: 'transparent',
              border: '1px solid #555',
              borderRadius: '4px',
              color: '#aaa',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            Logout
          </button>
        </div>

        {/* Server Status */}
        <div style={{ padding: '20px', borderTop: '1px solid #333', fontSize: '12px' }}>
          <div style={{ color: '#888', marginBottom: '8px' }}>Server Status</div>
          {serverInfo ? (
            <>
              <div style={{ color: '#4CAF50', marginBottom: '4px' }}>● Online</div>
              <div style={{ color: '#aaa' }}>Port: {serverInfo.port}</div>
              <div style={{ color: '#aaa' }}>{connectedCount} device(s) connected</div>
            </>
          ) : (
            <div style={{ color: '#f44336' }}>● Starting...</div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="app-main" style={{ flex: 1, backgroundColor: '#f5f5f5', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {currentPage === 'dashboard' && <Dashboard onDeviceClick={navigateToDeviceDetail} />}
          {currentPage === 'analytics' && <Analytics />}
          {currentPage === 'devices' && <DeviceList onDeviceClick={navigateToDeviceDetail} />}
          {currentPage === 'app-categories' && <AppCategorization />}
          {currentPage === 'policies' && <PolicyManager />}
          {currentPage === 'pairing' && <PairingInbox onCountChange={setPendingCount} />}
          {currentPage === 'logs' && <LogViewer />}
          {currentPage === 'device-detail' && selectedDeviceId && (
            <DeviceDetailPage deviceId={selectedDeviceId} onBack={navigateBack} />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
