/**
 * Log Viewer Component
 * Shows real-time server logs, recent heartbeats, and commands for debugging
 */

import React, { useState, useEffect, useRef } from 'react';

type TabType = 'logs' | 'heartbeats' | 'commands';

export const LogViewer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const [logs, setLogs] = useState<string[]>([]);
  const [heartbeats, setHeartbeats] = useState<any[]>([]);
  const [commands, setCommands] = useState<any[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();

    // Subscribe to new logs
    let unsubscribe: (() => void) | undefined;
    if (window.adminAPI?.onServerLog) {
      unsubscribe = window.adminAPI.onServerLog((message) => {
        setLogs((prev) => {
          const newLogs = [...prev, message];
          if (newLogs.length > 500) {
            return newLogs.slice(-500);
          }
          return newLogs;
        });
      });
    }

    // Refresh heartbeats and commands every 10 seconds
    const interval = setInterval(() => {
      loadHeartbeats();
      loadCommands();
    }, 10000);

    return () => {
      unsubscribe?.();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const loadData = async () => {
    await Promise.all([loadLogs(), loadHeartbeats(), loadCommands()]);
  };

  const loadLogs = async () => {
    try {
      if (window.adminAPI?.getServerLogs) {
        const serverLogs = await window.adminAPI.getServerLogs(500);
        setLogs(serverLogs || []);
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
  };

  const loadHeartbeats = async () => {
    try {
      if (window.adminAPI?.getRecentHeartbeats) {
        const data = await window.adminAPI.getRecentHeartbeats(100);
        setHeartbeats(data || []);
      }
    } catch (error) {
      console.error('Failed to load heartbeats:', error);
    }
  };

  const loadCommands = async () => {
    try {
      if (window.adminAPI?.getRecentCommands) {
        const data = await window.adminAPI.getRecentCommands(100);
        setCommands(data || []);
      }
    } catch (error) {
      console.error('Failed to load commands:', error);
    }
  };

  const clearLogs = () => setLogs([]);

  const filteredLogs = filter
    ? logs.filter((log) => log.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  const getLogColor = (log: string): string => {
    if (log.includes('ERROR') || log.includes('WARNING')) return '#ff6b6b';
    if (log.includes('HEARTBEAT')) return '#69db7c';
    if (log.includes('IDENTIFY')) return '#74c0fc';
    if (log.includes('PAIR')) return '#ffd43b';
    if (log.includes('WebSocket')) return '#da77f2';
    return '#e9ecef';
  };

  const formatTimestamp = (ts: number) => new Date(ts).toLocaleString();

  return (
    <div style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600 }}>Server Logs</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['logs', 'heartbeats', 'commands'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: activeTab === tab ? '#1976d2' : '#e0e0e0',
                color: activeTab === tab ? 'white' : '#333',
                cursor: 'pointer',
                fontWeight: 500,
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'logs' && (
        <>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="Filter logs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                width: '200px',
              }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
            <button
              onClick={loadLogs}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#2196F3',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Refresh
            </button>
            <button
              onClick={clearLogs}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#f44336',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
            <button
              onClick={() => {
                const text = filteredLogs.join('\n');
                navigator.clipboard.writeText(text).then(() => {
                  const btn = document.activeElement as HTMLButtonElement;
                  if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Logs'; }, 1500); }
                });
              }}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#9c27b0',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Copy Logs
            </button>
          </div>

          <div
            ref={logContainerRef}
            style={{
              flex: 1,
              backgroundColor: '#1e1e1e',
              borderRadius: '8px',
              padding: '16px',
              overflow: 'auto',
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: '12px',
              lineHeight: '1.5',
            }}
          >
            {filteredLogs.length === 0 ? (
              <div style={{ color: '#666', textAlign: 'center', padding: '40px' }}>
                No logs yet. Logs will appear here as events occur.
              </div>
            ) : (
              filteredLogs.map((log, index) => (
                <div
                  key={index}
                  style={{
                    color: getLogColor(log),
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    padding: '2px 0',
                  }}
                >
                  {log}
                </div>
              ))
            )}
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
            Showing {filteredLogs.length} of {logs.length} log entries
          </div>
        </>
      )}

      {activeTab === 'heartbeats' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ marginBottom: '12px' }}>
            <button
              onClick={loadHeartbeats}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#2196F3',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: '8px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee' }}>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', color: '#666' }}>Time</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', color: '#666' }}>Device</th>
                <th style={{ textAlign: 'right', padding: '12px', fontSize: '12px', color: '#666' }}>Active</th>
                <th style={{ textAlign: 'right', padding: '12px', fontSize: '12px', color: '#666' }}>Idle</th>
                <th style={{ textAlign: 'right', padding: '12px', fontSize: '12px', color: '#666' }}>Untracked</th>
              </tr>
            </thead>
            <tbody>
              {heartbeats.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                    No heartbeats recorded yet
                  </td>
                </tr>
              ) : (
                heartbeats.map((hb, i) => {
                  let payload: any = {};
                  try {
                    payload = JSON.parse(hb.payload_json || '{}');
                  } catch {}
                  const enhanced = payload.enhanced || {};
                  const today = enhanced.today || {};
                  
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '10px 12px', fontSize: '12px' }}>{formatTimestamp(hb.ts)}</td>
                      <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 500 }}>{hb.device_name || hb.device_id}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'right' }}>{Math.round((today.activeSeconds || 0) / 60)}m</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'right', color: '#FF9800' }}>{Math.round((today.idleSeconds || 0) / 60)}m</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', textAlign: 'right', color: '#f44336' }}>{Math.round((today.untrackedSeconds || 0) / 60)}m</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'commands' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ marginBottom: '12px' }}>
            <button
              onClick={loadCommands}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#2196F3',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: '8px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #eee' }}>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', color: '#666' }}>Time</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', color: '#666' }}>Device</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', color: '#666' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', color: '#666' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {commands.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                    No commands recorded yet
                  </td>
                </tr>
              ) : (
                commands.map((cmd, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '10px 12px', fontSize: '12px' }}>{formatTimestamp(cmd.created_at)}</td>
                    <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 500 }}>{cmd.device_name || cmd.device_id}</td>
                    <td style={{ padding: '10px 12px', fontSize: '12px' }}>{cmd.type}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        backgroundColor: cmd.status === 'acknowledged' ? '#e8f5e9' : cmd.status === 'failed' ? '#ffebee' : '#fff3e0',
                        color: cmd.status === 'acknowledged' ? '#2e7d32' : cmd.status === 'failed' ? '#c62828' : '#e65100',
                      }}>
                        {cmd.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
