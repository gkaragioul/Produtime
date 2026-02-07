import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityLog } from "../../shared/types";

interface CurrentActivityUI {
  appName: string;
  windowTitle: string;
  startTime: string;
  isIdle: boolean;
}

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
};

export const ActivityDashboard: React.FC = () => {
  const [current, setCurrent] = useState<CurrentActivityUI | null>(null);
  const [recent, setRecent] = useState<ActivityLog[]>([]);
  const [sessionStart] = useState<Date>(() => {
    // CRITICAL FIX: Use start of day (00:00:00) to match PDF reports
    // This ensures dashboard shows the same data as reports (full day, not just from app open time)
    try {
      const key = "produtime.sessionStartISO";
      const lastSessionDateKey = "produtime.lastSessionDate";
      let stored = window.localStorage.getItem(key);
      let lastSessionDate = window.localStorage.getItem(lastSessionDateKey);
      // Backward-compat: copy from legacy timeport.* keys if present
      if (!stored) {
        const legacy = window.localStorage.getItem("timeport.sessionStartISO");
        if (legacy) {
          stored = legacy;
          window.localStorage.setItem(key, legacy);
        }
      }
      if (!lastSessionDate) {
        const legacyDate = window.localStorage.getItem(
          "timeport.lastSessionDate"
        );
        if (legacyDate) {
          lastSessionDate = legacyDate;
          window.localStorage.setItem(lastSessionDateKey, legacyDate);
        }
      }

      const today = new Date().toDateString(); // e.g., "Mon Sep 29 2025"

      // Always use start of current day (00:00:00) for consistency with reports
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // If we have a stored session but it's from a different day, reset it
      if (stored && lastSessionDate && lastSessionDate !== today) {
        console.log("🔄 New day detected, resetting session to start of day");
        window.localStorage.setItem(key, startOfDay.toISOString());
        window.localStorage.setItem(lastSessionDateKey, today);
        return startOfDay;
      }

      // If we have a stored session from today, verify it's start of day
      if (stored && lastSessionDate === today) {
        const storedDate = new Date(stored);
        // Check if stored session is already start of day
        if (
          storedDate.getHours() === 0 &&
          storedDate.getMinutes() === 0 &&
          storedDate.getSeconds() === 0
        ) {
          console.log("📅 Using existing start-of-day session");
          return storedDate;
        } else {
          // Migrate old session to start of day
          console.log("🔄 Migrating session to start of day for consistency");
          window.localStorage.setItem(key, startOfDay.toISOString());
          return startOfDay;
        }
      }

      // First launch of the day - create new session at start of day
      console.log("🆕 First launch today, creating session at start of day");
      window.localStorage.setItem(key, startOfDay.toISOString());
      window.localStorage.setItem(lastSessionDateKey, today);
      return startOfDay;
    } catch (e) {
      console.error("Error managing session:", e);
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      return startOfDay;
    }
  });
  const [now, setNow] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isTracking, setIsTracking] = useState<boolean>(true);
  const prevIsTrackingRef = useRef<boolean | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [stoppedAt, setStoppedAt] = useState<Date | null>(null);
  const [totalStoppedDuration, setTotalStoppedDuration] = useState<number>(0);
  const lastMetricsRef = useRef<any>(null);
  const isPausedRef = useRef<boolean>(false);
  // Carry active seconds across a stopped period so metrics resume from previous value
  const resumeActiveCarryRef = useRef<number>(0);
  const resumeStartRef = useRef<Date | null>(null);
  // Keep a ref of latest stoppedAt to avoid stale closure inside poll loop
  const stoppedAtRef = useRef<Date | null>(null);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    stoppedAtRef.current = stoppedAt;
  }, [stoppedAt]);
  const [productivityGoal, setProductivityGoal] = useState<number>(75);
  const [showMetricsDetails, setShowMetricsDetails] = useState<boolean>(false);
  const [activityFilter, setActivityFilter] = useState<string>("");
  const [focusedActivity, setFocusedActivity] = useState<{
    app: string;
    title: string;
  } | null>(null);
  // Track which item is visually focused/selected for immediate feedback
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(
    null
  );
  const [hoveredActivityId, setHoveredActivityId] = useState<number | null>(
    null
  );
  const [isNarrow, setIsNarrow] = useState<boolean>(() =>
    typeof window !== "undefined" ? (window as any).innerWidth <= 600 : false
  );

  // Display options and schedule awareness
  const [boundedBySchedule, setBoundedBySchedule] = useState<boolean>(false);
  const [todaySchedule, setTodaySchedule] = useState<{
    start: string;
    end: string;
    nonWorking: boolean;
    overnight: boolean;
  } | null>(null);
  const [scheduledSeconds, setScheduledSeconds] = useState<number>(0);
  // Display helpers: what to show to user (today or next shift)
  const [displayScheduledSeconds, setDisplayScheduledSeconds] =
    useState<number>(0);
  const [scheduleBadgeText, setScheduleBadgeText] = useState<string>("");

  const refreshSchedule = async () => {
    try {
      const api = (window as any).electronAPI;
      if (!api || typeof api.getWorkScheduleForDay !== "function") return;
      const res = await api.getWorkScheduleForDay({
        dateISO: new Date().toISOString(),
      });
      if (!res?.success || !res.data) return;
      setTodaySchedule(res.data);

      const toMin = (hhmm: string) => {
        const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
        return h * 60 + m;
      };
      const minsToday = (() => {
        if (res.data.nonWorking) return 0;
        const s = toMin(res.data.start);
        const e = toMin(res.data.end);
        return e >= s ? e - s : 24 * 60 - s + e; // handle overnight
      })();
      setScheduledSeconds(minsToday * 60);

      // Decide what to display: today's window if active, otherwise next shift
      const base = new Date();
      const start = new Date(base);
      const end = new Date(base);
      const [sh, sm] = res.data.start
        .split(":")
        .map((n: string) => parseInt(n, 10));
      const [eh, em] = res.data.end
        .split(":")
        .map((n: string) => parseInt(n, 10));
      start.setHours(sh, sm, 0, 0);
      end.setHours(eh, em, 0, 0);
      if (res.data.overnight && end <= start) end.setDate(end.getDate() + 1);

      const nowTs = Date.now();
      const withinToday =
        !res.data.nonWorking &&
        nowTs >= start.getTime() &&
        nowTs <= end.getTime();
      const beforeToday = !res.data.nonWorking && nowTs < start.getTime();

      if (withinToday) {
        setScheduleBadgeText(`${res.data.start}–${res.data.end}`);
        setDisplayScheduledSeconds(minsToday * 60);
        return;
      }

      // Find next shift (today if before start; otherwise look ahead up to 7 days)
      let foundText = "";
      let foundSecs = minsToday * 60;
      if (beforeToday) {
        foundText = `Next: Today ${res.data.start}–${res.data.end}`;
      } else {
        for (let i = 1; i <= 7; i++) {
          const d = new Date();
          d.setDate(d.getDate() + i);
          const r = await api.getWorkScheduleForDay({
            dateISO: d.toISOString(),
          });
          if (r?.success && r.data && !r.data.nonWorking) {
            const mins = (() => {
              const s = toMin(r.data.start);
              const e = toMin(r.data.end);
              return e >= s ? e - s : 24 * 60 - s + e;
            })();
            const dayName = d.toLocaleDateString(undefined, {
              weekday: "short",
            });
            foundText = `Next: ${dayName} ${r.data.start}–${r.data.end}`;
            foundSecs = mins * 60;
            break;
          }
        }
      }
      setScheduleBadgeText(foundText || "");
      setDisplayScheduledSeconds(foundSecs);
    } catch (e) {
      console.warn("Failed to load today's or next schedule", e);
    }
  };

  useEffect(() => {
    refreshSchedule();
    // Listen for settings changes to auto-refresh schedule
    const handler = (e: any) => {
      const key = e?.detail?.key as string;
      if (!key) return;
      if (key.startsWith("work_schedule")) {
        refreshSchedule();
      }
    };
    window.addEventListener("settings-updated", handler as any);
    return () => window.removeEventListener("settings-updated", handler as any);
  }, []);

  const getScheduleWindow = useMemo(() => {
    if (!todaySchedule) return null as null | { start: Date; end: Date };
    const base = new Date();
    const start = new Date(base);
    const end = new Date(base);
    const [sh, sm] = todaySchedule.start.split(":").map((n) => parseInt(n, 10));
    const [eh, em] = todaySchedule.end.split(":").map((n) => parseInt(n, 10));
    start.setHours(sh, sm, 0, 0);
    end.setHours(eh, em, 0, 0);
    if (todaySchedule.overnight && end <= start) {
      end.setDate(end.getDate() + 1);
    }
    return { start, end };
  }, [todaySchedule]);

  const scheduleBounded = useMemo(() => {
    if (!boundedBySchedule || !getScheduleWindow)
      return null as null | { active: number; total: number };
    const { start: winStart, end: winEnd } = getScheduleWindow;
    const startMs = winStart.getTime();
    const endMs = winEnd.getTime();

    let a = 0;
    let i = 0;
    const relevantLogs = recent.filter(
      (log) => new Date(log.timestamp).getTime() >= sessionStart.getTime()
    );
    for (const log of relevantLogs) {
      const ts = new Date(log.timestamp).getTime();
      if (ts >= startMs && ts < endMs) {
        const isIdle =
          log.app_name === "System" &&
          (log.window_title === "Idle" || log.window_title === "Paused");
        if (isIdle) i += log.duration;
        else a += log.duration;
      }
    }
    // Add current live activity if inside window
    if (current) {
      const nowMs = Date.now();
      const st = new Date(current.startTime).getTime();
      const segStart = Math.max(st, startMs);
      const segEnd = Math.min(nowMs, endMs);
      if (segEnd > segStart && !current.isIdle) {
        a += Math.floor((segEnd - segStart) / 1000);
      }
    }
    return { active: a, total: a + i };
  }, [boundedBySchedule, getScheduleWindow, recent, current, sessionStart]);

  // Ensure PDF snapshot uses the exact same session start as the dashboard
  // Also check for day change periodically
  useEffect(() => {
    try {
      const key = "produtime.sessionStartISO";
      const lastSessionDateKey = "produtime.lastSessionDate";

      // Ensure session is set; if only legacy exists, copy it forward
      let stored = window.localStorage.getItem(key);
      if (!stored) {
        const legacy = window.localStorage.getItem("timeport.sessionStartISO");
        if (legacy) {
          stored = legacy;
          window.localStorage.setItem(key, legacy);
        }
      }
      if (!window.localStorage.getItem(lastSessionDateKey)) {
        const legacyDate = window.localStorage.getItem(
          "timeport.lastSessionDate"
        );
        if (legacyDate) {
          window.localStorage.setItem(lastSessionDateKey, legacyDate);
        }
      }
      if (!stored) {
        window.localStorage.setItem(key, sessionStart.toISOString());
        window.localStorage.setItem(
          lastSessionDateKey,
          new Date().toDateString()
        );
      }

      // BUG FIX #8: Check for day change every 30 seconds instead of 60
      // This reduces stale data after midnight from 60s to 30s
      const dayCheckInterval = setInterval(() => {
        const lastSessionDate = window.localStorage.getItem(lastSessionDateKey);
        const today = new Date().toDateString();

        if (lastSessionDate && lastSessionDate !== today) {
          console.log(
            "🔄 Day changed while app running, reloading to reset session"
          );
          window.location.reload();
        }
      }, 30000); // Check every 30 seconds

      return () => clearInterval(dayCheckInterval);
    } catch (e) {
      console.error("Error in session management:", e);
    }
    // Run once on mount to mark the start of this UI session
  }, []);

  // System health
  const [dbHealthy, setDbHealthy] = useState<boolean>(false); // default to false until fetched
  const [showDbWarning, setShowDbWarning] = useState<boolean>(false);

  // Refs removed - CSS Grid handles equal heights automatically
  const recentRef = useRef<HTMLUListElement | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);

  // Responsive helper: toggle narrow class based on viewport width
  useEffect(() => {
    const applyNarrow = () => {
      const narrow = (window as any).innerWidth <= 600;
      setIsNarrow(narrow);
      if (rootRef.current) {
        if (narrow) rootRef.current.classList.add("narrow");
        else rootRef.current.classList.remove("narrow");
      }
    };
    window.addEventListener("resize", applyNarrow);
    // sync once on mount
    applyNarrow();
    return () => window.removeEventListener("resize", applyNarrow);
  }, []);

  const [showAllActivities, setShowAllActivities] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage] = useState<number>(10);
  const [notifications, setNotifications] = useState<
    Array<{
      id: string;
      message: string;
      type: "success" | "error" | "info";
      timestamp: number;
    }>
  >([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState<{
    show: boolean;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    show: false,
    message: "",
    onConfirm: () => {},
    onCancel: () => {},
  });
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [diagnostics, setDiagnostics] = useState<any | null>(null);

  // Utility: ensure logs are sorted newest-first (by timestamp, fallback id)
  const sortLogsDesc = (logs: ActivityLog[]) =>
    [...logs].sort((a, b) => {
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();
      if (tb !== ta) return tb - ta;
      // tie-breaker by id if present
      const ida = (a as any).id ?? 0;
      const idb = (b as any).id ?? 0;
      return idb - ida;
    });

  // BUG FIX: Fetch ALL logs for today instead of just the last N logs
  // This prevents data loss when user has more than 200 activity changes in a day
  const fetchTodaysLogs = async (api: any): Promise<ActivityLog[]> => {
    if (typeof api.getActivityLogsByDate !== "function") {
      // Fallback to old method if API not available
      if (typeof api.getActivityLogs === "function") {
        const res = await api.getActivityLogs({ limit: 500, offset: 0 });
        return res.success && res.data ? res.data : [];
      }
      return [];
    }

    // Get today's date range (start of day to end of day)
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

  // Subscribe to activity changes
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) {
      console.error("electronAPI not available in renderer");
      return;
    }

    const handler = (activity: any) => {
      if (!activity) return;
      // If paused, accept paused updates; if an active update arrives, unpause and accept it
      if (isPausedRef.current) {
        if (activity.isIdle && activity.windowTitle === "Paused") {
          setCurrent({
            appName: activity.appName,
            windowTitle: activity.windowTitle,
            startTime: activity.startTime
              ? new Date(activity.startTime).toISOString()
              : new Date().toISOString(),
            isIdle: true,
          });
        } else {
          // Active update while UI thinks we're paused: flip to active
          setIsPaused(false);
          setCurrent({
            appName: activity.appName,
            windowTitle: activity.windowTitle,
            startTime: activity.startTime
              ? new Date(activity.startTime).toISOString()
              : new Date().toISOString(),
            isIdle: !!activity.isIdle,
          });
        }
      } else {
        setCurrent({
          appName: activity.appName,
          windowTitle: activity.windowTitle,
          startTime: activity.startTime
            ? new Date(activity.startTime).toISOString()
            : new Date().toISOString(),
          isIdle: !!activity.isIdle,
        });
      }

      // Always refresh recent logs on activity change (fetch ALL logs for today)
      fetchTodaysLogs(api)
        .then((logs) => {
          if (logs.length > 0) setRecent(sortLogsDesc(logs));
        })
        .catch(() => {});
    };

    const cleanup =
      typeof api.onActivityChanged === "function"
        ? api.onActivityChanged(handler)
        : (() => {
            console.warn(
              "electronAPI.onActivityChanged not available; using no-op"
            );
            return () => {};
          })();

    // Initial recent logs fetch: load ALL logs for today
    fetchTodaysLogs(api)
      .then((logs) => {
        if (logs.length > 0) setRecent(sortLogsDesc(logs));
      })
      .catch(() => {});

    // Load db health
    try {
      api.getDbHealth?.().then((res: any) => {
        if (res?.success) {
          setDbHealthy(!!res.data);
          setShowDbWarning(!res.data);
        }
      });
    } catch {}

    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => {
      cleanup?.();
      clearInterval(tick);
    };
  }, []);

  // Poll tracking/paused flags so renderer stays in sync even when user uses tray/shortcuts
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    let mounted = true;
    const POLL_MS = 2000;
    const poll = async () => {
      try {
        const res = await api.getTrackingStats();
        if (mounted && res?.success && res.data) {
          const {
            isTracking: serverTracking,
            currentActivity,
            idleThreshold,
          } = res.data as any;
          if (typeof res.data.isPaused === "boolean")
            setIsPaused(res.data.isPaused);
          if (typeof serverTracking === "boolean") {
            // Detect transitions and mirror isTracking
            setIsTracking(serverTracking);

            // Transition handling for stoppedAt and totalStoppedDuration
            const prev = prevIsTrackingRef.current;
            if (prev !== null && prev !== serverTracking) {
              if (!serverTracking) {
                // Tracking just stopped externally
                if (!stoppedAtRef.current) {
                  // Backdate stop time by one poll interval to freeze immediately as of intent time
                  const stopTime = new Date(Date.now() - POLL_MS);
                  setStoppedAt(stopTime);
                  stoppedAtRef.current = stopTime;
                  // Preserve current active so we can resume accumulation later
                  resumeActiveCarryRef.current =
                    lastMetricsRef.current?.active || 0;
                  console.log(
                    "⏹️ POLL: Preserve active carry =",
                    resumeActiveCarryRef.current,
                    "s"
                  );
                  console.log(
                    "⏹️ POLL: Detected external stop, set stoppedAt(backdated) =",
                    stopTime.toISOString()
                  );
                }
              } else {
                // Tracking just started externally
                if (stoppedAtRef.current) {
                  const dur = Math.floor(
                    (Date.now() - (stoppedAtRef.current as Date).getTime()) /
                      1000
                  );
                  setTotalStoppedDuration((p) => p + dur);
                  setStoppedAt(null);
                  stoppedAtRef.current = null;
                  // Reset resume baseline and adjust current start so elapsed excludes stopped time
                  const resumeStart = new Date();
                  resumeStartRef.current = resumeStart;
                  setCurrent((prevCurrent) =>
                    prevCurrent
                      ? {
                          ...prevCurrent,
                          startTime: resumeStart.toISOString(),
                        }
                      : prevCurrent
                  );
                  // Force recalc immediately after resume
                  setNow(new Date());
                  console.log(
                    "POLL: Detected external start, added stopped duration =",
                    dur,
                    "s; resume baseline at",
                    resumeStart.toISOString()
                  );
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

  // Ensure every pause immediately reflects a fresh paused current entry
  useEffect(() => {
    if (isPaused) {
      setCurrent((prev) => {
        // If already showing a paused/idle entry, keep it; otherwise switch to paused
        if (!prev || !prev.isIdle || prev.windowTitle !== "Paused") {
          return {
            appName: "System",
            windowTitle: "Paused",
            startTime: new Date().toISOString(),
            isIdle: true,
          };
        }
        return prev;
      });
      setNow(new Date());
    }
  }, [isPaused]);

  // CSS Grid should handle equal heights automatically with align-items: stretch
  // No JavaScript height matching needed

  const metrics = useMemo(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log("📊 METRICS: Calculating metrics...");
      console.log("📊 METRICS: isPaused:", isPaused);
      console.log("📊 METRICS: recent logs count:", recent.length);
      console.log("📊 METRICS: stoppedAt:", stoppedAt);
    }

    const now: Date = new Date();

    // If tracking is stopped OR not tracking, return frozen metrics
    if (stoppedAt || !isTracking) {
      if (process.env.NODE_ENV === 'development') {
        console.log("⏹️ METRICS: Tracking is stopped or inactive - returning frozen metrics");
      }
      // Return the last calculated metrics without any updates
      return (
        lastMetricsRef.current || {
          active: 0,
          idle: 0,
          total: 0,
          productivity: 0,
          perApp: {},
        }
      );
    }

    // Aggregate per-app durations from logs since sessionStart only
    const perApp: Record<string, number> = {};
    let active = 0;
    let idle = 0;

    const relevantLogs = recent.filter(
      (log) => new Date(log.timestamp).getTime() >= sessionStart.getTime()
    );

    if (process.env.NODE_ENV === 'development') {
      console.log("📊 METRICS: Relevant logs:", relevantLogs.length);
    }

    for (const log of relevantLogs) {
      const isIdle =
        log.app_name === "System" &&
        (log.window_title === "Idle" || log.window_title === "Paused");
      if (isIdle) {
        idle += log.duration;
      } else {
        active += log.duration;
        perApp[log.app_name] = (perApp[log.app_name] || 0) + log.duration;
      }
    }

    // Include current ongoing activity in both totals and per-app
    if (current) {
      const endTime = stoppedAt || now;
      const elapsed = Math.max(
        0,
        Math.floor(
          (endTime.getTime() - new Date(current.startTime).getTime()) / 1000
        )
      );

      // Simplified logic: trust the current state directly without complex stale detection
      // If isPaused is true, current should be idle/paused
      // If isPaused is false and current shows paused, it's a brief transition state - ignore it
      const isTransitioning = !isPaused && current.isIdle && current.windowTitle === "Paused";

      if (process.env.NODE_ENV === 'development') {
        console.log("📊 METRICS: Current activity elapsed:", elapsed);
        console.log("📊 METRICS: isTransitioning:", isTransitioning);
        console.log("📊 METRICS: current.isIdle:", current.isIdle);
        console.log("📊 METRICS: isPaused:", isPaused);
      }

      // During transition, skip adding the time to avoid double-counting
      if (!isTransitioning) {
        if (current.isIdle) {
          idle += elapsed;
          if (process.env.NODE_ENV === 'development') {
            console.log("📊 METRICS: Added current idle time:", elapsed);
          }
        } else {
          active += elapsed;
          perApp[current.appName] = (perApp[current.appName] || 0) + elapsed;
          if (process.env.NODE_ENV === 'development') {
            console.log("📊 METRICS: Added current active time:", elapsed);
          }
        }
      }
    }

    const total = active + idle;
    const endTime = stoppedAt || now;
    const rawSessionTotal = Math.floor(
      (endTime.getTime() - sessionStart.getTime()) / 1000
    );

    // Calculate current stopped duration if currently stopped
    const currentStoppedDuration = stoppedAt
      ? Math.floor((now.getTime() - (stoppedAt as Date).getTime()) / 1000)
      : 0;

    // Exclude all stopped time from session total
    // Do NOT subtract currentStoppedDuration; rawSessionTotal uses stoppedAt when stopped
    const sessionTotal = Math.max(0, rawSessionTotal - totalStoppedDuration);

    // Do not add any unaccounted time to avoid retroactive additions entirely
    const unaccountedTime = 0;
    const adjustedIdle = idle;
    const adjustedTotal = active + adjustedIdle;

    // Add any carried active accumulated before a stop (freeze) so resume continues from prior value
    if (isTracking && resumeActiveCarryRef.current > 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log("📊 METRICS: Applying resume active carry =", resumeActiveCarryRef.current, "s");
      }
      active += resumeActiveCarryRef.current;
    }

    // BUG FIX #9: Prevent negative productivity by clamping active to 0-100 range
    // The carry logic can make active negative, so we clamp it
    const productivity =
      adjustedTotal > 0
        ? Math.max(0, Math.min(100, Math.round((Math.max(0, active) / adjustedTotal) * 100)))
        : 0;

    if (process.env.NODE_ENV === 'development') {
      console.log("📊 METRICS: Final - active:", active, "idle:", idle, "total:", adjustedTotal, "productivity:", productivity);
    }

    const currentMetrics = {
      active,
      idle: adjustedIdle,
      total: adjustedTotal,
      productivity,
      perApp,
    } as const;

    // Store current metrics for frozen state
    lastMetricsRef.current = currentMetrics;

    return currentMetrics;
  }, [
    recent,
    current,
    now,
    sessionStart,
    isPaused,
    stoppedAt,
    totalStoppedDuration,
  ]);
  const filteredActivities = useMemo(() => {
    let filtered = recent;

    // Note: do NOT filter the list by focusedActivity; focused is only a UI selection
    if (activityFilter) {
      filtered = filtered.filter(
        (activity) =>
          activity.app_name
            .toLowerCase()
            .includes(activityFilter.toLowerCase()) ||
          activity.window_title
            .toLowerCase()
            .includes(activityFilter.toLowerCase())
      );
    }

    return filtered;
  }, [recent, activityFilter]);

  // Build display list with an ongoing (synthetic) entry for the current activity
  const displayActivities = useMemo(() => {
    // Hide sub-1 second idle entries to reduce noise
    const base = filteredActivities.filter(
      (log) =>
        !(
          log.app_name === "System" &&
          log.window_title === "Idle" &&
          log.duration < 1
        )
    );

    let list = base;
    if (current) {
      const endTime = stoppedAt || now;
      const elapsed = Math.max(
        0,
        Math.floor(
          (endTime.getTime() - new Date(current.startTime).getTime()) / 1000
        )
      );
      // Always show the ongoing current entry (active or idle/paused)
      const ongoing: ActivityLog = {
        id: -1,
        timestamp: new Date(current.startTime).toISOString(),
        app_name: current.appName,
        window_title: current.windowTitle,
        duration: elapsed,
      };
      list = [ongoing, ...list];
    }
    return list;
  }, [filteredActivities, current, now, stoppedAt]);

  // Show up to 8 recent activities; the overall dashboard page handles scrolling
  const paginatedActivities = useMemo(
    () => displayActivities.slice(0, 8),
    [displayActivities]
  );

  const totalPages = 1;

  const handleRefresh = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;

    setIsLoading(true);
    try {
      const logs = await fetchTodaysLogs(api);
      if (logs.length > 0) setRecent(sortLogsDesc(logs));
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Start and Stop tracking as separate actions
  const handleStartTracking = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    setIsLoading(true);
    try {
      await api.startTracking();
      setIsTracking(true);

      // If resuming from a stopped state, accumulate the stopped duration
      if (stoppedAt) {
        const stoppedDuration = Math.floor(
          (new Date().getTime() - stoppedAt.getTime()) / 1000
        );
        setTotalStoppedDuration((prev) => prev + stoppedDuration);
        console.log(
          "🔄 START: Adding stopped duration:",
          stoppedDuration,
          "seconds. Total stopped:",
          totalStoppedDuration + stoppedDuration
        );
      }

      // Clear stopped timestamp to resume metrics
      setStoppedAt(null);
      showNotification("Activity tracking started", "success");
    } catch (error) {
      console.error("Error starting tracking:", error);
      showNotification("Failed to start tracking. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopTracking = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    setIsLoading(true);

    console.log("⏹️ STOP: Starting stop process");
    console.log("⏹️ STOP: Current metrics before stop:", metrics);
    console.log(
      "⏹️ STOP: Current totalStoppedDuration before stop:",
      totalStoppedDuration
    );

    try {
      await api.stopTracking();
      setIsTracking(false);
      setIsPaused(false);
      // Clear current activity so no more time accumulates
      setCurrent(null);
      // Record when tracking was stopped to freeze metrics
      const stopTime = new Date();
      // BUG FIX #11: Reset carry on full stop to prevent carry accumulation
      // This prevents carry from growing indefinitely across multiple stop/resume cycles
      resumeActiveCarryRef.current = 0;
      setStoppedAt(stopTime);
      console.log("⏹️ STOP: Set stoppedAt to:", stopTime.toISOString());
      showNotification("Activity tracking stopped", "info");
    } catch (error) {
      console.error("Error stopping tracking:", error);
      showNotification("Failed to stop tracking. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePauseTracking = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    
    // Prevent double-clicks
    if (isLoading) return;
    setIsLoading(true);

    if (process.env.NODE_ENV === 'development') {
      console.log("⏸️ PAUSE: Starting pause process");
    }

    try {
      // Call the API first to ensure it succeeds before updating UI
      await api.pauseTracking();
      
      // Only update UI state after successful API call
      isPausedRef.current = true;
      setIsPaused(true);
      const pauseTime = new Date().toISOString();
      setCurrent({
        appName: "System",
        windowTitle: "Paused",
        startTime: pauseTime,
        isIdle: true,
      });

      setNow(new Date()); // force immediate metrics recompute
      showNotification("Tracking paused", "info");
    } catch (error) {
      console.error("Error pausing tracking:", error);
      showNotification("Failed to pause tracking. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResumeTracking = async () => {
    const api = (window as any).electronAPI;
    if (!api) return;
    
    // Prevent double-clicks
    if (isLoading) return;
    setIsLoading(true);

    if (process.env.NODE_ENV === 'development') {
      console.log("🔄 RESUME: Starting resume process");
    }

    try {
      await api.resumeTracking();

      setIsPaused(false);
      isPausedRef.current = false;

      // Wait for main process to send updated activity, then refresh logs
      setTimeout(async () => {
        if (typeof api.getActivityLogs !== "function") return;
        const res = await api.getActivityLogs({ limit: 200, offset: 0 });

        if (res.success && res.data) {
          setRecent(sortLogsDesc(res.data));
        }

        // Force metrics recalculation after logs are updated
        setNow(new Date());
      }, 100);

      showNotification("Tracking resumed", "success");
    } catch (error) {
      console.error("Error resuming tracking:", error);
      showNotification("Failed to resume tracking. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearSession = () => {
    showConfirmation(
      "Are you sure you want to clear the current session data? This action cannot be undone.",
      () => {
        setRecent([]);
        showNotification("Session data cleared successfully", "success");
        // Reset session start time
        setTimeout(() => window.location.reload(), 1000);
      }
    );
  };

  const handleStartStopToggle = async () => {
    if (isTracking) {
      await handleStopTracking();
    } else {
      await handleStartTracking();
    }
  };

  // time range control removed per new design

  const handleProductivityGoalChange = (goal: number) => {
    setProductivityGoal(goal);
    // In a real implementation, this would save the goal to settings
    console.log("Productivity goal changed to:", goal);
  };

  const toggleMetricsDetails = () => {
    setShowMetricsDetails(!showMetricsDetails);
  };

  const handleActivityFilter = (filter: string) => {
    setActivityFilter(filter);
    setCurrentPage(1); // Reset to first page when filtering
  };

  const toggleShowAllActivities = () => {
    setShowAllActivities(!showAllActivities);
  };

  const showNotification = (
    message: string,
    type: "success" | "error" | "info" = "info"
  ) => {
    const id = Date.now().toString();
    setNotifications((prev) => [
      ...prev,
      { id, message, type, timestamp: Date.now() },
    ]);

    // Auto-remove notification after 5 seconds
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  };

  const showConfirmation = (message: string, onConfirm: () => void) => {
    setShowConfirmDialog({
      show: true,
      message,
      onConfirm: () => {
        onConfirm();
        setShowConfirmDialog({
          show: false,
          message: "",
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
      onCancel: () => {
        setShowConfirmDialog({
          show: false,
          message: "",
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
    });
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <>
      {/* Global Warning Banner for DB health */}
      {showDbWarning && (
        <div className="warning-banner" role="alert">
          <span>Database unavailable. Some features may be limited.</span>
          <button
            className="warning-dismiss"
            aria-label="Dismiss warning"
            onClick={() => setShowDbWarning(false)}
          >
            ×
          </button>
        </div>
      )}

      <div
        ref={rootRef}
        className={`activity-dashboard ${isNarrow ? "narrow" : ""}`}
      >
        <div className="dashboard-two-column">
          <div className="dashboard-left-column">
            <div className="current-activity">
              <div className="section-header space-lg-bottom">
                <h3 className="typography-section">Current Activity</h3>
              </div>

              {current ? (
                <div
                  className={`current-activity-card ${!isTracking ? "stopped" : isPaused || current.isIdle ? "idle" : "active"}`}
                >
                  <div className="app-name">
                    {current.appName}
                    {current.isIdle && (
                      <span className="badge idle-badge">Idle</span>
                    )}
                  </div>
                  <div className="window-title">{current.windowTitle}</div>
                  <div className="status">
                    Status:{" "}
                    {!isTracking
                      ? "Stopped"
                      : isPaused || current.isIdle
                        ? isPaused
                          ? "Paused"
                          : "Idle"
                        : "Active"}
                  </div>
                </div>
              ) : (
                <div className="current-activity-card">
                  <div className="status">
                    {!isTracking
                      ? "Tracking Stopped"
                      : isPaused
                        ? "Paused"
                        : "Waiting for activity…"}
                  </div>
                </div>
              )}
            </div>

            <div className="metrics">
              <div className="section-header space-lg-bottom">
                <h3 className="typography-section">Performance Metrics</h3>
                {/* Time range selector removed per new design */}
              </div>

              {/* Primary Action Controls */}
              <div className="dashboard-actions-inline">
                {!isTracking ? (
                  <button
                    className="dashboard-button success btn-primary"
                    aria-label="Start Tracking"
                    onClick={handleStartTracking}
                    disabled={isLoading}
                  >
                    ▶️ Start Tracking
                  </button>
                ) : isPaused ? (
                  <>
                    <button
                      className="dashboard-button success resume btn-success"
                      aria-label="Resume Tracking"
                      onClick={handleResumeTracking}
                      disabled={isLoading}
                    >
                      ▶️ Resume Tracking
                    </button>
                    <button
                      className="dashboard-button danger btn-danger"
                      aria-label="Stop Tracking"
                      onClick={handleStopTracking}
                      disabled={isLoading}
                      style={{ marginLeft: 12 }}
                    >
                      ⏹️ Stop Tracking
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="dashboard-button warning btn-warning"
                      aria-label="Pause Tracking"
                      onClick={handlePauseTracking}
                      disabled={isLoading}
                    >
                      ⏸️ Pause Tracking
                    </button>
                    <button
                      className="dashboard-button danger btn-danger"
                      aria-label="Stop Tracking"
                      onClick={handleStopTracking}
                      disabled={isLoading}
                      style={{ marginLeft: 12 }}
                    >
                      ⏹️ Stop Tracking
                    </button>
                  </>
                )}
              </div>

              {showMetricsDetails && (
                <div className="productivity-goal-section">
                  <label htmlFor="productivity-goal">Productivity Goal:</label>
                  <div className="goal-input-group">
                    <input
                      id="productivity-goal"
                      type="range"
                      min="0"
                      max="100"
                      value={productivityGoal}
                      onChange={(e) =>
                        handleProductivityGoalChange(parseInt(e.target.value))
                      }
                    />
                    <span className="goal-value">{productivityGoal}%</span>
                  </div>
                </div>
              )}

              {/* View toggle: display-only, does not change tracking */}
              <div className="view-toggle time-range-selector">
                <span className="muted">View:</span>
                <button
                  className="section-button toggle-button"
                  onClick={() => setBoundedBySchedule(!boundedBySchedule)}
                  aria-pressed={boundedBySchedule}
                  title="Display-only — toggles schedule-bounded view"
                >
                  {boundedBySchedule ? "Scheduled window" : "Full day"}
                </button>
                {scheduleBadgeText && (
                  <span
                    className="muted schedule-badge"
                    title={"Working hours"}
                  >
                    {scheduleBadgeText}
                  </span>
                )}
              </div>

              <div className="metrics-grid metrics-grid-5">
                <div className="metric">
                  <div className="label">Scheduled Hours</div>
                  <div className="value">
                    {Number.isFinite(displayScheduledSeconds)
                      ? `${(displayScheduledSeconds / 3600).toFixed(1)}h`
                      : "—"}
                  </div>
                </div>
                <div className="metric">
                  <div className="label">Active Time</div>
                  <div className="value">
                    {formatDuration(
                      scheduleBounded ? scheduleBounded.active : metrics.active
                    )}
                  </div>
                </div>
                <div className="metric">
                  <div className="label">Idle Time</div>
                  <div className="value">{formatDuration(metrics.idle)}</div>
                </div>
                <div className="metric">
                  <div className="label">
                    {boundedBySchedule
                      ? "Total (in schedule)"
                      : "Total Logged"}
                  </div>
                  <div className="value">
                    {formatDuration(
                      scheduleBounded ? scheduleBounded.total : metrics.total
                    )}
                  </div>
                </div>
                <div className="metric productivity-metric">
                  <div className="label">
                    Productivity
                    {showMetricsDetails && (
                      <span className="goal-indicator">
                        (Goal: {productivityGoal}%)
                      </span>
                    )}
                  </div>
                  {(() => {
                    const displayedProductivity = (() => {
                      if (scheduleBounded) {
                        return scheduleBounded.total > 0
                          ? Math.round(
                              (scheduleBounded.active / scheduleBounded.total) *
                                100
                            )
                          : 0;
                      }
                      return metrics.productivity;
                    })();
                    return (
                      <div
                        className="value"
                        style={{
                          color:
                            displayedProductivity >= productivityGoal
                              ? "#28a745"
                              : displayedProductivity >= productivityGoal * 0.8
                                ? "#ffc107"
                                : "#dc3545",
                        }}
                      >
                        {displayedProductivity}%
                        {showMetricsDetails && (
                          <div className="progress-bar">
                            <div
                              className="progress-fill"
                              style={{
                                width: `${Math.min(displayedProductivity, 100)}%`,
                                backgroundColor:
                                  displayedProductivity >= productivityGoal
                                    ? "#28a745"
                                    : displayedProductivity >=
                                        productivityGoal * 0.8
                                      ? "#ffc107"
                                      : "#dc3545",
                              }}
                            ></div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>

          <div className="dashboard-right-column">
            <div className="recent-activity">
              <div className="section-header space-lg-bottom">
                <h3 className="typography-section">Recent Activity</h3>
                {/* Search removed per new design */}
              </div>

              {paginatedActivities.length === 0 ? (
                <div className="empty">
                  {activityFilter
                    ? "No activities match your search."
                    : "No recent activity yet."}
                </div>
              ) : (
                <>
                  <ul className="activity-list" ref={recentRef}>
                    {paginatedActivities.map((log) => (
                      <li
                        key={log.id}
                        className={`activity-item ${selectedActivityId === log.id ? "focused" : ""} ${hoveredActivityId === log.id ? "hovered" : ""}`}
                        tabIndex={0}
                        aria-selected={selectedActivityId === log.id}
                        onClick={() => {
                          setSelectedActivityId(log.id ?? null);
                          setFocusedActivity({
                            app: log.app_name,
                            title: log.window_title,
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setSelectedActivityId(log.id ?? null);
                            setFocusedActivity({
                              app: log.app_name,
                              title: log.window_title,
                            });
                          }
                        }}
                        onMouseOver={() => setHoveredActivityId(log.id ?? -1)}
                        onMouseOut={() => setHoveredActivityId(null)}
                      >
                        <div className="activity-info">
                          <div className="title">{log.app_name}</div>
                          <div className="subtitle">{log.window_title}</div>
                        </div>
                        <div className="activity-actions">
                          <div className="meta">
                            <span>
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span>
                              {formatDuration(log.duration)}
                              {log.app_name === "System" &&
                                log.window_title === "Idle" && (
                                  <span
                                    className="badge idle-badge"
                                    style={{ marginLeft: 8 }}
                                  >
                                    Idle
                                  </span>
                                )}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Notification System */}
        {notifications.length > 0 && (
          <div className="notification-container">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`notification notification-${notification.type}`}
              >
                <div className="notification-content">
                  <span className="notification-message">
                    {notification.message}
                  </span>
                  <button
                    className="notification-close"
                    onClick={() => dismissNotification(notification.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Confirmation Dialog */}
        {showConfirmDialog.show && (
          <div className="modal-overlay">
            <div className="confirmation-dialog">
              <div className="dialog-header">
                <h3>Confirm Action</h3>
              </div>
              <div className="dialog-content">
                <p>{showConfirmDialog.message}</p>
              </div>
              <div className="dialog-actions">
                <button
                  className="dialog-button cancel"
                  onClick={showConfirmDialog.onCancel}
                >
                  Cancel
                </button>
                <button
                  className="dialog-button confirm"
                  onClick={showConfirmDialog.onConfirm}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};



