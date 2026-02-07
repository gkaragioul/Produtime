/**
 * ProduTime Admin Console - Main App Component
 * CRITICAL FIX: Added LicenseGate to block access until licensed
 */

import React, { useState, useEffect } from 'react';
import { DeviceList } from './components/DeviceList';
import { PairingInbox } from './components/PairingInbox';
import { PolicyManager } from './components/PolicyManager';
import { Dashboard } from './components/Dashboard';
import { LogViewer } from './components/LogViewer';
import { DeviceDetail } from './components/DeviceDetail';
import { DeviceDetailPage } from './components/DeviceDetailPage';
import { AppCategorization } from './components/AppCategorization';
import { LicenseGate } from './components/LicenseGate';
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

// Logo import
import adminLogo from '../../../assets/PTAdminIcon.png';

type PageType = 'dashboard' | 'devices' | 'policies' | 'pairing' | 'logs' | 'device-detail' | 'app-categories';

declare global {
  interface Window {
    adminAPI: {
      // Licensing API (CRITICAL)
      getLicenseStatus: () => Promise<{
        licensed: boolean;
        reason?: string;
        features?: Record<string, boolean>;
        licenseId?: string;
        expiresAt?: string;
        warnings?: string[];
        machineHash?: string;
        mode?: 'locked' | 'trial' | 'activated';
        trialDaysRemaining?: number;
      }>;
      activateLicense: (licenseKey: string) => Promise<{ success: boolean; error?: string }>;
      deactivateLicense: () => Promise<{ success: boolean }>;
      getMachineHash: () => Promise<string>;
      startTrial: () => Promise<{ success: boolean; error?: string }>;
      onLicenseRevoked: (callback: (data: { reason: string }) => void) => () => void;
      onOpenActivation?: (callback: () => void) => () => void;
      
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
      // Enhanced Dashboard API (Performance Model)
      getDashboardSummaryEnhanced: (range: 'today' | '7d') => Promise<DashboardSummaryEnhanced | null>;
      getDashboardDevicesEnhanced: () => Promise<DeviceListItemEnhanced[]>;
      getAttention: () => Promise<AttentionResponse>;
      getDashboardStory: () => Promise<DashboardStory | null>;
      getRankings: () => Promise<RankingsResponse | null>;
      getTrends: (scope: 'team' | 'device', deviceId?: string, days?: number) => Promise<TrendsResponse | null>;
      // Enhanced Device Detail API
      getDeviceDetailEnhanced: (deviceId: string, range: 'today' | '7d' | '30d') => Promise<any>;
      // App Categorization API
      getAppUsageAggregates: () => Promise<any[]>;
      getAppCategory: (appName: string) => Promise<any>;
      setAppCategory: (appName: string, category: string) => Promise<{ success: boolean }>;
      setAppCategoriesBulk: (apps: Array<{ appName: string; category: string }>) => Promise<{ success: boolean }>;
      getAllAppCategories: () => Promise<any[]>;
      // Weekly Insights API
      getWeeklyInsights: (weekEnd?: string) => Promise<any[]>;
      getWeeklyReports: () => Promise<any[]>;
      getWeeklyReport: (weekEnd: string) => Promise<any>;
      generateWeeklyReport: () => Promise<{ success: boolean; message?: string }>;
    };
  }
}

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [serverInfo, setServerInfo] = useState<{ port: number; publicKey: string } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [connectedCount, setConnectedCount] = useState(0);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Navigation helper for device detail
  const navigateToDeviceDetail = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setCurrentPage('device-detail');
  };

  const navigateBack = () => {
    setSelectedDeviceId(null);
    setCurrentPage('dashboard');
  };

  useEffect(() => {
    // Load initial data
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

    // Set up event listeners
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
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'devices', label: 'Devices', icon: '💻' },
    { id: 'app-categories', label: 'App Categories', icon: '📱' },
    { id: 'policies', label: 'Policies', icon: '📋' },
    { id: 'pairing', label: 'Pairing', icon: '🔗', badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'logs', label: 'Server Logs', icon: '📝' },
  ];

  return (
    <LicenseGate>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Sidebar */}
        <div style={{
          width: '240px',
          backgroundColor: '#1a1a2e',
          color: 'white',
          padding: '20px 0',
          display: 'flex',
          flexDirection: 'column',
        }}>
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
                onClick={() => setCurrentPage(item.id as PageType)}
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
        <div style={{ flex: 1, backgroundColor: '#f5f5f5', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {currentPage === 'dashboard' && <Dashboard onDeviceClick={navigateToDeviceDetail} />}
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
    </LicenseGate>
  );
};

export default App;
