import React from 'react';
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import { ActivityDashboard } from './ActivityDashboard';

// Minimal ActivityLog type used in tests
interface ActivityLog {
  id?: number;
  timestamp: string;
  app_name: string;
  window_title: string;
  duration: number;
}

type IPCResponse<T> = { success: boolean; data?: T; error?: string };

type ElectronAPI = {
  // Sync system info
  getVersion: () => string;
  getPlatform: () => string;
  // Activity logs
  getActivityLogsByDate: (args: {
    startDate: string;
    endDate: string;
  }) => Promise<IPCResponse<ActivityLog[]>>;
  getActivityLogs: (args: {
    limit?: number;
    offset?: number;
  }) => Promise<IPCResponse<ActivityLog[]>>;
  // Activity stream
  onActivityChanged: (cb: (activity: any) => void) => () => void;
  // DB health
  getDbHealth: () => Promise<IPCResponse<boolean>>;
  // Activity control (used but not essential in these tests)
  startTracking: () => Promise<IPCResponse<void>>;
  stopTracking: () => Promise<IPCResponse<void>>;
  pauseTracking: () => Promise<IPCResponse<void>>;
  resumeTracking: () => Promise<IPCResponse<void>>;
  // Stats poller
  getTrackingStats?: () => Promise<IPCResponse<any>>;
};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Helper function to convert seconds to expected HH:MM:SS format for tests
const expectHMS = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
};

describe('ActivityDashboard', () => {
  let mockAPI: jest.Mocked<ElectronAPI>;
  let activityCallback: ((activity: any) => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    activityCallback = null;

    mockAPI = {
      getVersion: jest.fn(() => '25.3.0'),
      getPlatform: jest.fn(() => 'win32'),
      getActivityLogsByDate: jest.fn(async () => ({ success: true, data: [] })),
      getActivityLogs: jest.fn(async () => ({ success: true, data: [] })),
      onActivityChanged: jest.fn((cb: (a: any) => void) => {
        activityCallback = cb;
        return jest.fn();
      }),
      getDbHealth: jest.fn(async () => ({ success: true, data: true })),
      startTracking: jest.fn(async () => ({ success: true })),
      stopTracking: jest.fn(async () => ({ success: true })),
      pauseTracking: jest.fn(async () => ({ success: true })),
      resumeTracking: jest.fn(async () => ({ success: true })),
      getTrackingStats: jest.fn(async () => ({
        success: true,
        data: { isTracking: true, isPaused: false },
      })),
    } as any;

    Object.defineProperty(window, 'electronAPI', {
      value: mockAPI,
      writable: true,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('renders dashboard without System Information section', async () => {
    render(<ActivityDashboard />);

    // System Information section should not be present
    expect(screen.queryByText(/Electron:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Database:/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /System Information/i })
    ).not.toBeInTheDocument();
  });

  test('shows a warning banner when database is unhealthy', async () => {
    mockAPI.getDbHealth.mockResolvedValueOnce({ success: true, data: false });

    render(<ActivityDashboard />);

    expect(
      await screen.findByText(/database unavailable/i)
    ).toBeInTheDocument();
  });

  test('updates Current Activity on activity:changed events', async () => {
    render(<ActivityDashboard />);

    // Simulate an activity change event
    const nowIso = new Date().toISOString();
    await act(async () => {
      activityCallback?.({
        appName: 'Google Chrome',
        windowTitle: 'TimePort Docs',
        startTime: nowIso,
        isIdle: false,
      });
    });

    // App and window appear (may appear in both current card and recent list)
    const chromeEls = await screen.findAllByText('Google Chrome');
    expect(chromeEls.length).toBeGreaterThan(0);
    const titleEls = await screen.findAllByText('TimePort Docs');
    expect(titleEls.length).toBeGreaterThan(0);
    // Status shows Active
    expect(screen.getByText(/Status:\s*Active/i)).toBeInTheDocument();
  });

  test('shows friendly empty state for Recent Activity when no logs', async () => {
    render(<ActivityDashboard />);
    expect(
      await screen.findByText(/No recent activity yet/i)
    ).toBeInTheDocument();
  });

  test('renders Paused status when getTrackingStats reports isPaused', async () => {
    mockAPI.getTrackingStats!.mockResolvedValue({
      success: true,
      data: { isTracking: true, isPaused: true },
    });

    render(<ActivityDashboard />);

    const pausedEls = await screen.findAllByText(/Paused/i);
    expect(pausedEls.length).toBeGreaterThan(0);
  });

  test('renders Tracking Stopped state when getTrackingStats reports isTracking=false', async () => {
    mockAPI.getTrackingStats!.mockResolvedValue({
      success: true,
      data: { isTracking: false, isPaused: false },
    });

    render(<ActivityDashboard />);

    expect(await screen.findByText(/Tracking Stopped/i)).toBeInTheDocument();
  });

  // Subtask 2: Responsive layout and structure (structural assertions only)
  test('renders two-column structure with left and right columns present', () => {
    const { container } = render(<ActivityDashboard />);
    expect(container.querySelector('.activity-dashboard')).toBeTruthy();
    const grid = container.querySelector('.dashboard-two-column');
    const left = container.querySelector('.dashboard-left-column');
    const right = container.querySelector('.dashboard-right-column');
    expect(grid).toBeTruthy();
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
  });

  test('renders required section headers', () => {
    render(<ActivityDashboard />);
    expect(
      screen.getByRole('heading', { name: /Current Activity/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Performance Metrics/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Recent Activity/i })
    ).toBeInTheDocument();
    // System Information section was removed, so we expect only 2 main sections
    expect(
      screen.queryByRole('heading', { name: /System Information/i })
    ).not.toBeInTheDocument();
  });

  test('renders fallback states when no data is available', async () => {
    render(<ActivityDashboard />);
    expect(
      await screen.findByText(/Waiting for activity/i)
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/No recent activity yet/i)
    ).toBeInTheDocument();
  });

  // Subtask 3: Activity tracker + recent activity components (RED)
  test('synthetic current activity appears at top of Recent Activity when ongoing', async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 600 * 1000).toISOString();
    const mid = new Date(now.getTime() - 300 * 1000).toISOString();
    const logs: ActivityLog[] = [
      {
        id: 1,
        timestamp: earlier,
        app_name: 'Slack',
        window_title: 'General',
        duration: 120,
      },
      {
        id: 2,
        timestamp: mid,
        app_name: 'Chrome',
        window_title: 'Docs',
        duration: 180,
      },
    ];
    mockAPI.getActivityLogsByDate.mockResolvedValue({
      success: true,
      data: logs,
    });

    const { container } = render(<ActivityDashboard />);

    // Simulate ongoing activity
    const nowIso = now.toISOString();
    await act(async () => {
      activityCallback?.({
        appName: 'VS Code',
        windowTitle: 'Editing timeport.ts',
        startTime: nowIso,
        isIdle: false,
      });
    });

    // Ensure synthetic entry is rendered at top
    const topTitle = container.querySelector(
      '.activity-list li:first-child .title'
    );
    const topSubtitle = container.querySelector(
      '.activity-list li:first-child .subtitle'
    );
    expect(topTitle?.textContent).toMatch(/VS Code/i);
    expect(topSubtitle?.textContent).toMatch(/Editing timeport\.ts/i);
  });

  test('clicking a recent activity item adds focused class for visual feedback', async () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 60 * 1000).toISOString();
    const t2 = new Date(now.getTime() - 120 * 1000).toISOString();
    const logs: ActivityLog[] = [
      {
        id: 11,
        timestamp: t1,
        app_name: 'Notion',
        window_title: 'Specs',
        duration: 60,
      },
      {
        id: 12,
        timestamp: t2,
        app_name: 'Terminal',
        window_title: 'npm test',
        duration: 60,
      },
    ];
    mockAPI.getActivityLogsByDate.mockResolvedValue({
      success: true,
      data: logs,
    });

    const { container } = render(<ActivityDashboard />);

    // Wait until content renders
    await screen.findByText('Terminal');

    const terminalEl = screen.getByText('Terminal');
    const terminalLi = terminalEl.closest('li') as HTMLElement;
    expect(terminalLi).toBeTruthy();

    // Click item and wait for focused class to appear
    terminalLi.click();
    await waitFor(() => {
      const focusedEls = Array.from(
        container.querySelectorAll('.activity-list li.focused')
      ) as HTMLElement[];
      expect(focusedEls.length).toBe(1);
      expect(focusedEls[0].textContent || '').toMatch(/Terminal/);
    });
  });

  test('activity list displays session-only entries sorted most-recent-first', async () => {
    const now = new Date();
    const oldTs = new Date(now.getTime() - 600 * 1000).toISOString();
    const midTs = new Date(now.getTime() - 300 * 1000).toISOString();
    const newestTs = new Date(now.getTime() - 60 * 1000).toISOString();
    const logs: ActivityLog[] = [
      {
        id: 21,
        timestamp: oldTs,
        app_name: 'A',
        window_title: 'Old',
        duration: 10,
      },
      {
        id: 22,
        timestamp: newestTs,
        app_name: 'B',
        window_title: 'New',
        duration: 20,
      },
      {
        id: 23,
        timestamp: midTs,
        app_name: 'C',
        window_title: 'Mid',
        duration: 15,
      },
    ];
    mockAPI.getActivityLogsByDate.mockResolvedValue({
      success: true,
      data: logs,
    });

    const { container } = render(<ActivityDashboard />);

    // Wait until newest item is present
    await screen.findByText('B');

    const titles = Array.from(
      container.querySelectorAll('.activity-list li .title')
    ).map((el) => el.textContent || '');

    // Expect the first non-synthetic title to be the most recent 'B'
    // No synthetic entry since current is null
    expect(titles[0]).toBe('B');
    expect(titles[1]).toBe('C');
    expect(titles[2]).toBe('A');
  });

  test('paused state shows synthetic paused entry at the top of the list', async () => {
    mockAPI.getTrackingStats!.mockResolvedValue({
      success: true,
      data: { isTracking: true, isPaused: true },
    });
    mockAPI.getActivityLogsByDate.mockResolvedValue({
      success: true,
      data: [],
    });

    const { container } = render(<ActivityDashboard />);

    // Wait for recent list to appear and verify top subtitle
    const listEl = await screen.findByRole('list');
    expect(listEl).toBeInTheDocument();

    const topSubtitle = container.querySelector(
      '.activity-list li:first-child .subtitle'
    );
    expect(topSubtitle && topSubtitle.textContent).toMatch(/Paused/i);
  });
});

// Subtask 4: Performance metrics + system information
describe('ActivityDashboard – Subtask 4', () => {
  let mockAPI: jest.Mocked<ElectronAPI>;
  let activityCallback: ((activity: any) => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    activityCallback = null;
    mockAPI = {
      getVersion: jest.fn(() => '25.3.0'),
      getPlatform: jest.fn(() => 'win32'),
      getActivityLogsByDate: jest.fn(async () => ({ success: true, data: [] })),
      getActivityLogs: jest.fn(async () => ({ success: true, data: [] })),
      onActivityChanged: jest.fn((cb: (a: any) => void) => {
        activityCallback = cb;
        return jest.fn();
      }),
      getDbHealth: jest.fn(async () => ({ success: true, data: true })),
      startTracking: jest.fn(async () => ({ success: true })),
      stopTracking: jest.fn(async () => ({ success: true })),
      pauseTracking: jest.fn(async () => ({ success: true })),
      resumeTracking: jest.fn(async () => ({ success: true })),
      getTrackingStats: jest.fn(async () => ({
        success: true,
        data: { isTracking: true, isPaused: false },
      })),
    } as any;
    Object.defineProperty(window, 'electronAPI', {
      value: mockAPI,
      writable: true,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  // Subtask 4: Performance metrics + system information
  test('metrics aggregate active/idle/total from session-only logs and compute productivity', async () => {
    // Provide three session-only logs: 120s active, 30s active, 10s idle
    const base = new Date('2025-01-01T10:00:00.000Z');
    jest.setSystemTime(base);

    const logs: ActivityLog[] = [
      {
        id: 41,
        timestamp: new Date(base.getTime() + 10000).toISOString(),
        app_name: 'Editor',
        window_title: 'code.ts',
        duration: 120,
      },
      {
        id: 42,
        timestamp: new Date(base.getTime() + 20000).toISOString(),
        app_name: 'Browser',
        window_title: 'Docs',
        duration: 30,
      },
      {
        id: 43,
        timestamp: new Date(base.getTime() + 30000).toISOString(),
        app_name: 'System',
        window_title: 'Idle',
        duration: 10,
      },
    ];
    mockAPI.getActivityLogsByDate.mockResolvedValue({
      success: true,
      data: logs,
    });

    const { container } = render(<ActivityDashboard />);

    // Assert metrics values: Active=150s (2.5 min), Idle=10s (0.2 min), Total=160s (2.7 min)
    expect(await screen.findByText(/Active Time/i)).toBeInTheDocument();

    const getMetricValue = (label: RegExp) => {
      const labelEl = screen.getByText(label);
      const metricEl = labelEl.closest('.metric') as HTMLElement;
      return (
        metricEl.querySelector('.value') as HTMLElement
      ).textContent?.trim();
    };

    await waitFor(() => {
      expect(getMetricValue(/Active Time/i)).toBe(expectHMS(150));
      expect(getMetricValue(/Idle Time/i)).toBe(expectHMS(10));
      expect(getMetricValue(/Total Logged/i)).toBe(expectHMS(160));
      // Productivity = round(150/160 * 100) = 94%
      expect(screen.getByText(/94%/)).toBeInTheDocument();
    });
  });

  test('synthetic current contributes only while tracking; metrics freeze when stopped', async () => {
    const start = new Date('2025-01-01T12:00:00.000Z');
    jest.setSystemTime(start);

    // No persisted logs; rely on synthetic current from activity:changed
    mockAPI.getActivityLogsByDate.mockResolvedValue({
      success: true,
      data: [],
    });

    // Control getTrackingStats over time
    let tracking = true;
    mockAPI.getTrackingStats!.mockImplementation(async () => ({
      success: true,
      data: { isTracking: tracking, isPaused: false },
    }));

    render(<ActivityDashboard />);

    // Begin current activity at T0
    await act(async () => {
      activityCallback?.({
        appName: 'Editor',
        windowTitle: 'file.ts',
        startTime: start.toISOString(),
        isIdle: false,
      });
    });

    const getMetricValue = (label: RegExp) => {
      const labelEl = screen.getByText(label);
      const metricEl = labelEl.closest('.metric') as HTMLElement;
      return (
        metricEl.querySelector('.value') as HTMLElement
      ).textContent?.trim();
    };

    // After 5s of tracking: Active Time should be "00:00:05"
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(getMetricValue(/Active Time/i)).toBe(expectHMS(5));

    // Stop tracking via next poll
    tracking = false;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    }); // trigger poll interval

    // Advance 5 more seconds; metrics should remain frozen at "00:00:05"
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(getMetricValue(/Active Time/i)).toBe(expectHMS(5));

    // Resume tracking and advance 3s; should now read "00:00:08" (8 seconds)
    tracking = true;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    }); // poll
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(getMetricValue(/Active Time/i)).toBe(expectHMS(8));
  });

  test('session duration increases, freezes on stop, then resumes on start', async () => {
    const t0 = new Date('2025-01-01T15:00:00.000Z');
    jest.setSystemTime(t0);

    let tracking = true;
    mockAPI.getTrackingStats!.mockImplementation(async () => ({
      success: true,
      data: { isTracking: tracking, isPaused: false },
    }));
    mockAPI.getActivityLogsByDate.mockResolvedValue({
      success: true,
      data: [],
    });

    render(<ActivityDashboard />);

    const getMetricValue = (label: RegExp) => {
      const labelEl = screen.getByText(label);
      const metricEl = labelEl.closest('.metric') as HTMLElement;
      return (
        metricEl.querySelector('.value') as HTMLElement
      ).textContent?.trim();
    };

    // Initially 0
    expect(await screen.findByText(/Session Duration/i)).toBeInTheDocument();

    // +3s while tracking
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(getMetricValue(/Session Duration/i)).toBe(expectHMS(3));

    // Stop tracking and advance +4s; duration should freeze at "00:00:03" (3 seconds)
    tracking = false;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    }); // poll
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(getMetricValue(/Session Duration/i)).toBe(expectHMS(3));

    // Resume and advance +2s; duration should become "00:00:05" (5 seconds)
    tracking = true;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    }); // poll
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(getMetricValue(/Session Duration/i)).toBe(expectHMS(5));
  });

  test('Database health warning banner shows when DB is unhealthy', async () => {
    mockAPI.getDbHealth.mockResolvedValue({ success: true, data: false });
    render(<ActivityDashboard />);
    // Should show warning banner instead of system info
    expect(
      await screen.findByText(/Database connection issue/i)
    ).toBeInTheDocument();
  });
});

// Subtask 5: Tray menu integration (RED)
describe('Tray menu integration', () => {
  let mockAPI: any;
  let activityCallback: ((activity: any) => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    activityCallback = null;

    mockAPI = {
      getVersion: jest.fn(() => '25.3.0'),
      getPlatform: jest.fn(() => 'win32'),
      getActivityLogsByDate: jest.fn(async () => ({ success: true, data: [] })),
      getActivityLogs: jest.fn(async () => ({ success: true, data: [] })),
      onActivityChanged: jest.fn((cb: (a: any) => void) => {
        activityCallback = cb;
        return jest.fn();
      }),
      getDbHealth: jest.fn(async () => ({ success: true, data: true })),
      startTracking: jest.fn(async () => ({ success: true })),
      stopTracking: jest.fn(async () => ({ success: true })),
      pauseTracking: jest.fn(async () => ({ success: true })),
      resumeTracking: jest.fn(async () => ({ success: true })),
      getTrackingStats: jest.fn(async () => ({
        success: true,
        data: { isTracking: true, isPaused: false },
      })),
    } as any;

    Object.defineProperty(window, 'electronAPI', {
      value: mockAPI,
      writable: true,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('Tray Start sets isTracking=true in renderer via poll', async () => {
    let tracking = false;
    let paused = false;
    mockAPI.getTrackingStats!.mockImplementation(async () => ({
      success: true,
      data: { isTracking: tracking, isPaused: paused },
    }));
    render(<ActivityDashboard />);
    // Initially shows Start button
    expect(await screen.findByText(/Start Tracking/i)).toBeInTheDocument();
    // Tray action: Start
    tracking = true;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    // Renderer should now show Pause button (tracking active)
    expect(screen.getByText(/Pause Tracking/i)).toBeInTheDocument();
  });

  test('Tray Pause sets isPaused and creates synthetic idle entry accumulating idle time', async () => {
    const t0 = new Date('2025-01-02T10:00:00.000Z');
    jest.setSystemTime(t0);
    let tracking = true;
    let paused = false;
    mockAPI.getTrackingStats!.mockImplementation(async () => ({
      success: true,
      data: { isTracking: tracking, isPaused: paused },
    }));
    render(<ActivityDashboard />);
    // Start a current activity
    await act(async () => {
      activityCallback?.({
        appName: 'Editor',
        windowTitle: 'file.ts',
        startTime: t0.toISOString(),
        isIdle: false,
      });
    });
    const getMetricValue = (label: RegExp) => {
      const labelEl = screen.getByText(label);
      const metricEl = labelEl.closest('.metric') as HTMLElement;
      return (
        metricEl.querySelector('.value') as HTMLElement
      ).textContent?.trim();
    };
    // Tray action: Pause
    paused = true;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    }); // allow poll
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getAllByText(/Paused/i).length).toBeGreaterThan(0);
    expect(getMetricValue(/Idle Time/i)).toBe(expectHMS(3));
  });

  test('Tray Stop freezes metrics and session duration at current values', async () => {
    const t0 = new Date('2025-01-02T12:00:00.000Z');
    jest.setSystemTime(t0);
    let tracking = true;
    let paused = false;
    mockAPI.getTrackingStats!.mockImplementation(async () => ({
      success: true,
      data: { isTracking: tracking, isPaused: paused },
    }));
    render(<ActivityDashboard />);
    const getMetricValue = (label: RegExp) => {
      const labelEl = screen.getByText(label);
      const metricEl = labelEl.closest('.metric') as HTMLElement;
      return (
        metricEl.querySelector('.value') as HTMLElement
      ).textContent?.trim();
    };
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(getMetricValue(/Session Duration/i)).toBe(expectHMS(4));
    // Tray action: Stop
    tracking = false;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    }); // poll
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(getMetricValue(/Session Duration/i)).toBe(expectHMS(4));
  });

  test('Tray Resume clears isPaused and resumes metrics accumulation', async () => {
    const t0 = new Date('2025-01-02T13:00:00.000Z');
    jest.setSystemTime(t0);
    let tracking = true;
    let paused = true;
    mockAPI.getTrackingStats!.mockImplementation(async () => ({
      success: true,
      data: { isTracking: tracking, isPaused: paused },
    }));
    render(<ActivityDashboard />);
    const getMetricValue = (label: RegExp) => {
      const labelEl = screen.getByText(label);
      const metricEl = labelEl.closest('.metric') as HTMLElement;
      return (
        metricEl.querySelector('.value') as HTMLElement
      ).textContent?.trim();
    };
    await act(async () => {
      jest.advanceTimersByTime(2000);
    }); // poll paused
    const parseHMS = (s: string) => {
      const parts = s.split(':').map((p) => parseInt(p, 10));
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    };
    const before = getMetricValue(/Session Duration/i)!;
    // Resume via tray
    paused = false;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    }); // poll
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    const after = getMetricValue(/Session Duration/i)!;
    expect(parseHMS(after) - parseHMS(before)).toBeGreaterThanOrEqual(3);
  });

  test('Tray Show/Hide window toggles visibility state exposed to renderer', async () => {
    // Extend mock with visibility events
    let windowVisible = false;
    let visibilityCb: ((v: boolean) => void) | null = null;
    (mockAPI as any).onWindowVisibilityChanged = jest.fn(
      (cb: (v: boolean) => void) => {
        visibilityCb = cb;
        return jest.fn();
      }
    );
    (mockAPI as any).getWindowVisibility = jest.fn(() => windowVisible);

    render(<ActivityDashboard />);
    const getInfoValue = (labelText: RegExp) => {
      const labelEl = screen.getByText(labelText);
      const infoEl = labelEl.closest('.info') as HTMLElement;
      return (
        infoEl.querySelector('.value') as HTMLElement
      ).textContent?.trim();
    };
    // Initially hidden
    expect(getInfoValue(/Window:/i)).toBe('Hidden');
    // Tray action: Show
    windowVisible = true;
    await act(async () => {
      visibilityCb?.(true);
    });
    expect(getInfoValue(/Window:/i)).toBe('Visible');
    // Tray action: Hide
    windowVisible = false;
    await act(async () => {
      visibilityCb?.(false);
    });
    expect(getInfoValue(/Window:/i)).toBe('Hidden');
  });

  test('Tray status tooltip reflects Tracking/Paused/Stopped accurately', async () => {
    let tracking = true;
    let paused = false;
    mockAPI.getTrackingStats!.mockImplementation(async () => ({
      success: true,
      data: { isTracking: tracking, isPaused: paused },
    }));
    render(<ActivityDashboard />);
    // Since System Information section was removed, this test is no longer valid
    // The tray status is not displayed in the UI anymore
    expect(screen.queryByText(/Tray:/i)).not.toBeInTheDocument();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(getTrayValue()).toBe('Tracking');
    // Paused
    paused = true;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(getTrayValue()).toBe('Paused');

    // Stopped
    tracking = false;
    paused = false;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(getTrayValue()).toBe('Stopped');
  });
});

// Subtask 6: Modern styling/usability (RED) — correct scope
describe('Modern styling/usability', () => {
  let mockAPI: any;
  let activityCallback: ((activity: any) => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    activityCallback = null;

    mockAPI = {
      getVersion: jest.fn(() => '25.3.0'),
      getPlatform: jest.fn(() => 'win32'),
      getActivityLogsByDate: jest.fn(async () => ({ success: true, data: [] })),
      getActivityLogs: jest.fn(async () => ({ success: true, data: [] })),
      onActivityChanged: jest.fn((cb: (a: any) => void) => {
        activityCallback = cb;
        return jest.fn();
      }),
      getDbHealth: jest.fn(async () => ({ success: true, data: true })),
      startTracking: jest.fn(async () => ({ success: true })),
      stopTracking: jest.fn(async () => ({ success: true })),
      pauseTracking: jest.fn(async () => ({ success: true })),
      resumeTracking: jest.fn(async () => ({ success: true })),
      getTrackingStats: jest.fn(async () => ({
        success: true,
        data: { isTracking: true, isPaused: false },
      })),
    };

    Object.defineProperty(window, 'electronAPI', {
      value: mockAPI,
      writable: true,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('Action buttons expose aria-labels and accessible names across states', async () => {
    let tracking = true;
    let paused = false;
    mockAPI.getTrackingStats!.mockImplementation(async () => ({
      success: true,
      data: { isTracking: tracking, isPaused: paused },
    }));
    render(<ActivityDashboard />);
    // Initially: Pause + Stop
    const pauseBtn = screen.getByRole('button', { name: /Pause Tracking/i });
    const stopBtn = screen.getByRole('button', { name: /Stop Tracking/i });
    expect(pauseBtn).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Pause Tracking/i)
    );
    expect(stopBtn).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Stop Tracking/i)
    );
    // Paused: Resume + Stop
    paused = true;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    const resumeBtn = screen.getByRole('button', { name: /Resume Tracking/i });
    expect(resumeBtn).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Resume Tracking/i)
    );
    // Stopped: Start
    tracking = false;
    paused = false;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    const startBtn = screen.getByRole('button', { name: /Start Tracking/i });
    expect(startBtn).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Start Tracking/i)
    );
  });

  test('Activity list items support keyboard selection and aria-selected', async () => {
    render(<ActivityDashboard />);
    // Emit a current activity so list has an item
    await act(async () => {
      activityCallback?.({
        appName: 'Editor',
        windowTitle: 'main.ts',
        startTime: new Date().toISOString(),
        isIdle: false,
      });
    });
    const listItem = document.querySelector('.activity-item') as HTMLElement;
    expect(listItem).toBeTruthy();
    // Should be tabbable and have listitem role implicitly
    expect(listItem.getAttribute('tabindex')).toBe('0');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
    // Keyboard: Enter selects (adds focused class and aria-selected)
    expect(listItem.classList.contains('focused')).toBe(false);
    expect(listItem.getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(listItem, { key: 'Enter' });
    expect(listItem.classList.contains('focused')).toBe(true);
    expect(listItem.getAttribute('aria-selected')).toBe('true');
  });

  test('Activity list items toggle hovered class on mouse over/out', async () => {
    render(<ActivityDashboard />);
    await act(async () => {
      activityCallback?.({
        appName: 'Chrome',
        windowTitle: 'Docs',
        startTime: new Date().toISOString(),
        isIdle: false,
      });
    });
    const listItem = document.querySelector('.activity-item') as HTMLElement;
    fireEvent.mouseOver(listItem);
    expect(listItem.classList.contains('hovered')).toBe(true);
    fireEvent.mouseOut(listItem);
    expect(listItem.classList.contains('hovered')).toBe(false);
  });

  test('Responsive class toggles based on viewport width', async () => {
    const { container } = render(<ActivityDashboard />);
    const root = container.querySelector('.activity-dashboard') as HTMLElement;
    expect(root).toBeTruthy();
    // Default width -> not narrow
    expect(root.classList.contains('narrow')).toBe(false);
    // Narrow viewport
    (window as any).innerWidth = 480;
    window.dispatchEvent(new Event('resize'));
    expect(root.classList.contains('narrow')).toBe(true);
    // Back to wide
    (window as any).innerWidth = 1200;
    window.dispatchEvent(new Event('resize'));
    expect(root.classList.contains('narrow')).toBe(false);
  });

  test('Section headers use consistent typography class and spacing token', () => {
    const { container } = render(<ActivityDashboard />);
    const headers = container.querySelectorAll(
      '.section-header h3.typography-section'
    );
    expect(headers.length).toBeGreaterThanOrEqual(2); // Only Current Activity and Performance Metrics sections remain
    // Spacing token on header container
    const headerContainers = container.querySelectorAll(
      '.section-header.space-lg-bottom'
    );
    expect(headerContainers.length).toBeGreaterThanOrEqual(4);
  });

  test('Button variants expose design token classes', async () => {
    let tracking = true;
    let paused = false;
    mockAPI.getTrackingStats!.mockImplementation(async () => ({
      success: true,
      data: { isTracking: tracking, isPaused: paused },
    }));
    render(<ActivityDashboard />);
    // Pause + Stop visible
    expect(screen.getByRole('button', { name: /Pause Tracking/i })).toHaveClass(
      'btn-warning'
    );
    expect(screen.getByRole('button', { name: /Stop Tracking/i })).toHaveClass(
      'btn-danger'
    );
    // Paused -> Resume
    paused = true;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(
      screen.getByRole('button', { name: /Resume Tracking/i })
    ).toHaveClass('btn-success');
    // Stopped -> Start
    tracking = false;
    paused = false;
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: /Start Tracking/i })).toHaveClass(
      'btn-primary'
    );
  });
});
