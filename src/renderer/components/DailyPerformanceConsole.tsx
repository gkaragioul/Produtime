/**
 * Daily Performance Console - The New Main Dashboard
 * 
 * Transforms ProduTime from a passive activity viewer into an active
 * daily execution tool. Users instantly know:
 * - Am I on track today?
 * - Am I behind?
 * - What is expected of me right now?
 * - How focused has my day been?
 * - What should I correct?
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only aggregated stats are displayed
 * - No raw window titles or content
 * - All data is privacy-respecting
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityLog } from '../../shared/types';
import { TodayStatus } from './TodayStatus';
import { FocusSummary } from './FocusSummary';
import { TrackingControls } from './TrackingControls';
import {
  computeExpectedWindow,
  computeDailyInsight,
  computeFocusStats,
  DailyMetrics,
  ExpectedWindow,
  FocusStats,
} from '../services/daily-insight-engine';


interface CurrentActivityUI {
  appName: string;
  windowTitle: string;
  startTime: string;
  isIdle: boolean;
}

export const DailyPerformanceConsole: React.FC = () => {
  // Core state
  const [current, setCurrent] = useState<CurrentActivityUI | null>(null);
  const [recent, setRecent] = useState<ActivityLog[]>([]);
  const [now, setNow] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isTracking, setIsTracking] = useState<boolean>(true);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [stoppedAt, setStoppedAt] = useState<Date | null>(null);
  const [totalStoppedDuration, setTotalStoppedDuration] = useState<number>(0);
  
  // Refs for tracking state
  const prevIsTrackingRef = useRef<boolean | null>(null);
  const isPausedRef = useRef<boolean>(false);
  const stoppedAtRef = useRef<Date | null>(null);
  const lastMetricsRef = useRef<any>(null);
  const resumeActiveCarryRef = useRef<number>(0);
  const pendingIdleRef = useRef<number>(0); // idle seconds not yet in DB after idle→active transition
  const prevCurrentRef = useRef<any>(null);
  
  // Work schedule state
  const [workSchedule, setWorkSchedule] = useState<{ start: string; end: string } | null>(null);
  const [breakDurationMinutes, setBreakDurationMinutes] = useState<number>(0);
  
  // Session start (start of day)
  const [sessionStart] = useState<Date>(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return startOfDay;
  });

  // Sync refs
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  
  useEffect(() => {
    stoppedAtRef.current = stoppedAt;
  }, [stoppedAt]);

  // Load work schedule
  useEffect(() => {
    const loadSchedule = async () => {
      try {
        const api = (window as any).electronAPI;
        if (!api?.getWorkScheduleForDay) {
          // Default schedule
          setWorkSchedule({ start: '09:00', end: '18:00' });
          return;
        }
        
        const res = await api.getWorkScheduleForDay({ dateISO: new Date().toISOString() });
        if (res?.success && res.data && !res.data.nonWorking) {
          setWorkSchedule({ start: res.data.start, end: res.data.end });
        } else {
          setWorkSchedule({ start: '09:00', end: '18:00' });
        }
      } catch {
        setWorkSchedule({ start: '09:00', end: '18:00' });
      }
    };
    
    loadSchedule();

    // Load break duration from settings
    const loadBreakDuration = async () => {
      try {
        const api = (window as any).electronAPI;
        if (api?.getSetting) {
          const res = await api.getSetting({ key: 'break_duration' });
          if (res?.success && res.data != null) {
            const mins = parseInt(res.data, 10);
            if (!isNaN(mins) && mins > 0) setBreakDurationMinutes(mins);
          }
        }
      } catch { /* keep default 0 */ }
    };
    loadBreakDuration();

    // Re-fetch schedule and break duration when admin pushes a policy update
    const api = (window as any).electronAPI;
    const unsubscribe = api?.onAgentPolicyUpdated?.((newPolicy: any) => {
      if (newPolicy?.workScheduleStart && newPolicy?.workScheduleEnd) {
        setWorkSchedule({ start: newPolicy.workScheduleStart, end: newPolicy.workScheduleEnd });
      }
      if (newPolicy?.breakDuration != null) {
        const mins = typeof newPolicy.breakDuration === 'number'
          ? newPolicy.breakDuration
          : parseInt(newPolicy.breakDuration, 10);
        if (!isNaN(mins) && mins > 0) setBreakDurationMinutes(mins);
      }
    });

    return () => { unsubscribe?.(); };
  }, []);

  // Fetch today's logs
  const fetchTodaysLogs = async (api: any): Promise<ActivityLog[]> => {
    if (typeof api.getActivityLogsByDate !== 'function') {
      if (typeof api.getActivityLogs === 'function') {
        const res = await api.getActivityLogs({ limit: 500, offset: 0 });
        return res.success && res.data ? res.data : [];
      }
      return [];
    }

    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const res = await api.getActivityLogsByDate({
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString(),
    });

    return res.success && res.data ? res.data : [];
  };

  const sortLogsDesc = (logs: ActivityLog[]) =>
    [...logs].sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      if (tb !== ta) return tb - ta;
      const ida = (a as any).id ?? 0;
      const idb = (b as any).id ?? 0;
      return idb - ida;
    });

  // Subscribe to activity changes
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    const handler = (activity: any) => {
      if (!activity) return;

      // Capture idle duration before it's lost in the transition
      const prev = prevCurrentRef.current;
      if (prev && prev.isIdle && !activity.isIdle) {
        // Idle→Active transition: save the live idle seconds that won't be in DB yet
        const idleElapsed = Math.max(0, Math.floor((Date.now() - new Date(prev.startTime).getTime()) / 1000));
        pendingIdleRef.current = idleElapsed;
      }

      const newCurrent = {
        appName: activity.appName,
        windowTitle: activity.windowTitle,
        startTime: activity.startTime ? new Date(activity.startTime).toISOString() : new Date().toISOString(),
        isIdle: !!activity.isIdle,
      };

      if (isPausedRef.current) {
        if (activity.isIdle && activity.windowTitle === 'Paused') {
          newCurrent.isIdle = true;
        } else {
          setIsPaused(false);
        }
      }

      prevCurrentRef.current = newCurrent;
      setCurrent(newCurrent);

      // Fetch logs after delay, then clear pending idle once DB has the record
      setTimeout(() => {
        fetchTodaysLogs(api).then((logs) => {
          if (logs.length > 0) {
            setRecent(sortLogsDesc(logs));
            // DB now has the idle record — clear the pending carry
            pendingIdleRef.current = 0;
          }
        }).catch(() => {});
      }, 500);
    };

    const cleanup = typeof api.onActivityChanged === 'function'
      ? api.onActivityChanged(handler)
      : () => {};

    // Initial fetch
    fetchTodaysLogs(api).then((logs) => {
      if (logs.length > 0) setRecent(sortLogsDesc(logs));
    }).catch(() => {});

    const tick = setInterval(() => setNow(new Date()), 5000); // 5s is enough for display updates
    
    return () => {
      cleanup?.();
      clearInterval(tick);
    };
  }, []);

  // Poll tracking state
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    
    let mounted = true;
    const POLL_MS = 2000;
    
    const poll = async () => {
      try {
        const res = await api.getTrackingStats();
        if (mounted && res?.success && res.data) {
          const { isTracking: serverTracking } = res.data as any;
          if (typeof res.data.isPaused === 'boolean') setIsPaused(res.data.isPaused);
          if (typeof serverTracking === 'boolean') {
            setIsTracking(serverTracking);
            
            const prev = prevIsTrackingRef.current;
            if (prev !== null && prev !== serverTracking) {
              if (!serverTracking) {
                if (!stoppedAtRef.current) {
                  const stopTime = new Date(Date.now() - POLL_MS);
                  setStoppedAt(stopTime);
                  stoppedAtRef.current = stopTime;
                  resumeActiveCarryRef.current = lastMetricsRef.current?.active || 0;
                }
              } else {
                if (stoppedAtRef.current) {
                  const dur = Math.floor((Date.now() - stoppedAtRef.current.getTime()) / 1000);
                  setTotalStoppedDuration((p) => p + dur);
                  setStoppedAt(null);
                  stoppedAtRef.current = null;
                  setNow(new Date());
                }
              }
            }
            prevIsTrackingRef.current = serverTracking;
          }
        }
      } catch {}
    };
    
    const t = setInterval(poll, POLL_MS);
    poll();
    
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  // Compute metrics
  const metrics = useMemo(() => {
    const nowDate = new Date();

    if (stoppedAt || !isTracking) {
      return lastMetricsRef.current || { active: 0, idle: 0, total: 0, perApp: {} };
    }

    const perApp: Record<string, number> = {};
    let active = 0;
    let idle = 0;

    const relevantLogs = recent.filter(
      (log) => new Date(log.timestamp).getTime() >= sessionStart.getTime()
    );

    for (const log of relevantLogs) {
      const isIdle = log.app_name === 'System' && 
        (log.window_title === 'Idle' || log.window_title === 'Paused');
      if (isIdle) {
        idle += log.duration;
      } else {
        active += log.duration;
        perApp[log.app_name] = (perApp[log.app_name] || 0) + log.duration;
      }
    }

    if (current) {
      const endTime = stoppedAt || nowDate;
      const elapsed = Math.max(0, Math.floor((endTime.getTime() - new Date(current.startTime).getTime()) / 1000));
      const isTransitioning = !isPaused && current.isIdle && current.windowTitle === 'Paused';

      if (!isTransitioning) {
        if (current.isIdle) {
          idle += elapsed;
        } else {
          active += elapsed;
          perApp[current.appName] = (perApp[current.appName] || 0) + elapsed;
        }
      }
    }

    if (isTracking && resumeActiveCarryRef.current > 0) {
      active += resumeActiveCarryRef.current;
    }

    // Add pending idle from idle→active transition (not yet in DB)
    if (pendingIdleRef.current > 0) {
      idle += pendingIdleRef.current;
    }

    const total = active + idle;
    const currentMetrics = { active, idle, total, perApp };
    lastMetricsRef.current = currentMetrics;

    return currentMetrics;
  }, [recent, current, now, sessionStart, isPaused, stoppedAt, isTracking]);

  // Compute expected window (deducting break allowance from expected active time)
  const expectedWindow = useMemo<ExpectedWindow>(() => {
    if (!workSchedule) {
      return computeExpectedWindow('09:00', '18:00', breakDurationMinutes);
    }
    return computeExpectedWindow(workSchedule.start, workSchedule.end, breakDurationMinutes);
  }, [workSchedule, breakDurationMinutes]);

  // Compute daily metrics for insight engine
  const dailyMetrics = useMemo<DailyMetrics>(() => {
    const firstLog = recent.length > 0 ? recent[recent.length - 1] : null;
    const lastLog = recent.length > 0 ? recent[0] : null;
    
    return {
      activeSeconds: metrics.active,
      idleSeconds: metrics.idle,
      untrackedSeconds: 0, // Would need to compute from gaps
      firstActivityTs: firstLog ? new Date(firstLog.timestamp).getTime() : null,
      lastActivityTs: lastLog ? new Date(lastLog.timestamp).getTime() : null,
    };
  }, [metrics, recent]);

  // Compute focus stats (include live current activity for real-time display)
  const focusStats = useMemo<FocusStats>(() => {
    return computeFocusStats(recent, sessionStart, current);
  }, [recent, sessionStart, current]);

  // Compute daily insight (with focus stats for guidance)
  const dailyInsight = useMemo(() => {
    return computeDailyInsight(dailyMetrics, expectedWindow, focusStats);
  }, [dailyMetrics, expectedWindow, focusStats]);



  // Tracking control handlers
  const handleStartTracking = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    setIsLoading(true);
    try {
      await api.startTracking();
      setIsTracking(true);
      if (stoppedAt) {
        const stoppedDuration = Math.floor((new Date().getTime() - stoppedAt.getTime()) / 1000);
        setTotalStoppedDuration((prev) => prev + stoppedDuration);
      }
      setStoppedAt(null);
    } catch (error) {
      console.error('Error starting tracking:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopTracking = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    setIsLoading(true);
    try {
      await api.stopTracking();
      setIsTracking(false);
      setIsPaused(false);
      setCurrent(null);
      resumeActiveCarryRef.current = 0;
      setStoppedAt(new Date());
    } catch (error) {
      console.error('Error stopping tracking:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePauseTracking = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    setIsLoading(true);
    isPausedRef.current = true;
    setIsPaused(true);
    setCurrent({
      appName: 'System',
      windowTitle: 'Paused',
      startTime: new Date().toISOString(),
      isIdle: true,
    });
    setNow(new Date());
    try {
      await api.pauseTracking();
    } catch (error) {
      console.error('Error pausing tracking:', error);
      setIsPaused(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResumeTracking = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    setIsLoading(true);
    try {
      await api.resumeTracking();
      setIsPaused(false);
      isPausedRef.current = false;
      setTimeout(async () => {
        const logs = await fetchTodaysLogs(api);
        if (logs.length > 0) setRecent(sortLogsDesc(logs));
        setNow(new Date());
      }, 100);
    } catch (error) {
      console.error('Error resuming tracking:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const totalTracked = metrics.active + metrics.idle;

  return (
    <div className="daily-performance-console">
      {/* Main Two-Column Layout */}
      <div className="console-main-row">
        {/* Left Column: Today Status + Metrics + Controls */}
        <div className="console-left-column">
          {/* A) TODAY STATUS - Primary, Dominant */}
          <TodayStatus
            insight={dailyInsight}
            expected={expectedWindow}
            activeSeconds={metrics.active}
            idleSeconds={metrics.idle}
            untrackedSeconds={0}
            isTracking={isTracking}
          />
          
          {/* D) CONTROLS - De-emphasized */}
          <TrackingControls
            isTracking={isTracking}
            isPaused={isPaused}
            isLoading={isLoading}
            onStart={handleStartTracking}
            onStop={handleStopTracking}
            onPause={handlePauseTracking}
            onResume={handleResumeTracking}
          />
        </div>
        
        {/* Right Column: Focus Summary */}
        <div className="console-right-column">
          {/* B) FOCUS SUMMARY - Replaces Recent Activity */}
          <FocusSummary
            focusStats={focusStats}
            recentLogs={recent}
            totalTracked={totalTracked}
            focusQuality={dailyInsight.userState.focusQuality}
            dominantActivity={dailyInsight.userState.dominantActivity}
          />
        </div>
      </div>
    </div>
  );
};
