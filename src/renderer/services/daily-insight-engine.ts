/**
 * Daily Insight Engine - User State & Micro-Coaching System
 * 
 * The soul of ProduTime's daily execution cockpit.
 * Transforms metrics into guidance. Never lies. Never shows fake precision.
 * 
 * COMPLIANCE: This is NOT spyware.
 * - Only aggregated stats are used
 * - No raw window titles or content analysis
 * - All data is privacy-respecting
 */

// ============================================================================
// Types
// ============================================================================

export type UserMode = 'NO_DATA' | 'PRE_SHIFT' | 'IN_SHIFT_NO_ACTIVITY' | 'NORMAL';
export type DayState = 'ON_TRACK' | 'BEHIND' | 'OFF_SCHEDULE' | 'PRE_SHIFT' | 'WAITING';
export type GuidanceTone = 'neutral' | 'warning' | 'encouraging' | 'corrective';
export type FocusQuality = 'strong' | 'moderate' | 'low' | 'unknown';

export interface DailyMetrics {
  activeSeconds: number;
  idleSeconds: number;
  untrackedSeconds: number;
  firstActivityTs: number | null;
  lastActivityTs: number | null;
}

export interface ExpectedWindow {
  workStart: string;  // "09:00"
  workEnd: string;    // "18:00"
  expectedTotalSeconds: number;
  expectedSoFarSeconds: number;
  isWithinWorkWindow: boolean;
  isBeforeWorkWindow: boolean;
  isAfterWorkWindow: boolean;
}

export interface UserState {
  mode: UserMode;
  dayState: DayState;
  progressPct: number;
  behindBySeconds: number;
  focusRatio: number;
  focusQuality: FocusQuality;
  totalTracked: number;
  isDataSufficient: boolean;
  dominantActivity: 'active' | 'idle' | 'balanced' | 'unknown';
}

export interface Guidance {
  message: string;
  tone: GuidanceTone;
  icon: string;
}

export interface DailyInsight {
  userState: UserState;
  sentence: string;
  guidance: Guidance;
  statusEmoji: string;
  statusLabel: string;
  statusColor: string;
}

export interface FocusStats {
  longestFocusStreak: number;
  longestIdlePeriod: number;
  topApps: Array<{ app: string; seconds: number }>;
  focusSplit: {
    active: number;
    idle: number;
    untracked: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

const MIN_DATA_FOR_JUDGEMENT_SECONDS = 600; // 10 minutes
const MIN_DATA_FOR_PRODUCTIVITY_SECONDS = 1800; // 30 minutes
const BEHIND_THRESHOLD_SECONDS = 600; // 10 minutes
const OFF_SCHEDULE_THRESHOLD_SECONDS = 3600; // 60 minutes
const STRONG_FOCUS_THRESHOLD = 0.65;
const MODERATE_FOCUS_THRESHOLD = 0.35;
const MIN_FOCUS_STREAK_GOOD = 900; // 15 minutes
// Realistic active ratio — nobody is 100% active.  Allow ~15% natural idle
// (micro-breaks, water, context switches) before marking user as behind.
const REALISTIC_ACTIVE_RATIO = 0.85;

// ============================================================================
// Helper Functions
// ============================================================================

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function getCurrentMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function formatDurationHuman(seconds: number): string {
  if (seconds < 60) return 'less than a minute';
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatDurationShort(seconds: number): string {
  if (seconds < 60) return '0m';
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Check if we have enough data to make meaningful judgements
 */
export function isDataSufficientForJudgement(totalTracked: number): boolean {
  return totalTracked >= MIN_DATA_FOR_JUDGEMENT_SECONDS;
}

/**
 * Check if we have enough data to show productivity metrics
 */
export function isDataSufficientForProductivity(totalTracked: number): boolean {
  return totalTracked >= MIN_DATA_FOR_PRODUCTIVITY_SECONDS;
}

// ============================================================================
// Expected Window Computation
// ============================================================================

export function computeExpectedWindow(
  workStart: string = '09:00',
  workEnd: string = '17:00',
  breakDurationMinutes: number = 0
): ExpectedWindow {
  const startMinutes = parseTimeToMinutes(workStart);
  const endMinutes = parseTimeToMinutes(workEnd);
  const currentMinutes = getCurrentMinutes();

  // Total window minutes (clock time) and effective active minutes (minus break)
  const totalWindowMinutes = endMinutes > startMinutes
    ? endMinutes - startMinutes
    : (24 * 60 - startMinutes) + endMinutes; // overnight shift
  const effectiveMinutes = Math.max(0, totalWindowMinutes - breakDurationMinutes);
  const expectedTotalSeconds = effectiveMinutes * 60;

  // Determine position relative to work window
  const isBeforeWorkWindow = currentMinutes < startMinutes;
  const isAfterWorkWindow = currentMinutes >= endMinutes;
  const isWithinWorkWindow = !isBeforeWorkWindow && !isAfterWorkWindow;

  // Expected active seconds so far — break allowance distributed proportionally
  let expectedSoFarSeconds = 0;
  if (isWithinWorkWindow) {
    const minutesWorked = currentMinutes - startMinutes;
    const progressRatio = totalWindowMinutes > 0 ? minutesWorked / totalWindowMinutes : 0;
    expectedSoFarSeconds = Math.round(progressRatio * effectiveMinutes * 60);
  } else if (isAfterWorkWindow) {
    expectedSoFarSeconds = expectedTotalSeconds;
  }

  return {
    workStart,
    workEnd,
    expectedTotalSeconds,
    expectedSoFarSeconds,
    isWithinWorkWindow,
    isBeforeWorkWindow,
    isAfterWorkWindow,
  };
}

// ============================================================================
// User State Engine (PART 1)
// ============================================================================

export function computeUserState(
  metrics: DailyMetrics,
  expected: ExpectedWindow,
  focusStats: FocusStats
): UserState {
  const { activeSeconds, idleSeconds, untrackedSeconds } = metrics;
  const { expectedSoFarSeconds, isBeforeWorkWindow } = expected;
  
  const totalTracked = activeSeconds + idleSeconds + untrackedSeconds;
  const isDataSufficient = isDataSufficientForJudgement(totalTracked);
  
  // Compute mode
  let mode: UserMode;
  if (totalTracked === 0 && !isBeforeWorkWindow && expectedSoFarSeconds === 0) {
    mode = 'NO_DATA';
  } else if (isBeforeWorkWindow) {
    mode = 'PRE_SHIFT';
  } else if (expectedSoFarSeconds > 0 && activeSeconds === 0) {
    mode = 'IN_SHIFT_NO_ACTIVITY';
  } else {
    mode = 'NORMAL';
  }
  
  // Compute progress — compare against a realistic expectation, not 100%.
  // Nobody is active every second; natural idle (micro-breaks, water, etc.) is normal.
  const realisticExpected = expectedSoFarSeconds * REALISTIC_ACTIVE_RATIO;
  const progressPct = realisticExpected > 0
    ? Math.min(1, activeSeconds / realisticExpected)
    : 0;

  // Compute behind by — only count as behind when under the realistic bar
  const behindBySeconds = Math.max(0, realisticExpected - activeSeconds);
  
  // Compute focus ratio
  const focusRatio = totalTracked > 0 
    ? activeSeconds / totalTracked 
    : 0;
  
  // Determine focus quality
  let focusQuality: FocusQuality;
  if (!isDataSufficient) {
    focusQuality = 'unknown';
  } else if (focusRatio >= STRONG_FOCUS_THRESHOLD) {
    focusQuality = 'strong';
  } else if (focusRatio >= MODERATE_FOCUS_THRESHOLD) {
    focusQuality = 'moderate';
  } else {
    focusQuality = 'low';
  }
  
  // Determine day state
  let dayState: DayState;
  if (mode === 'PRE_SHIFT') {
    dayState = 'PRE_SHIFT';
  } else if (mode === 'NO_DATA' || mode === 'IN_SHIFT_NO_ACTIVITY') {
    dayState = expectedSoFarSeconds > 0 ? 'BEHIND' : 'WAITING';
  } else if (behindBySeconds > OFF_SCHEDULE_THRESHOLD_SECONDS) {
    dayState = 'OFF_SCHEDULE';
  } else if (behindBySeconds > BEHIND_THRESHOLD_SECONDS) {
    dayState = 'BEHIND';
  } else {
    dayState = 'ON_TRACK';
  }
  
  // Determine dominant activity
  let dominantActivity: 'active' | 'idle' | 'balanced' | 'unknown';
  if (!isDataSufficient) {
    dominantActivity = 'unknown';
  } else if (activeSeconds > idleSeconds * 1.5) {
    dominantActivity = 'active';
  } else if (idleSeconds > activeSeconds * 1.5) {
    dominantActivity = 'idle';
  } else {
    dominantActivity = 'balanced';
  }
  
  return {
    mode,
    dayState,
    progressPct,
    behindBySeconds,
    focusRatio,
    focusQuality,
    totalTracked,
    isDataSufficient,
    dominantActivity,
  };
}

// ============================================================================
// Sentence Generator (PART 2)
// ============================================================================

function generateSentence(
  userState: UserState,
  expected: ExpectedWindow
): string {
  const { mode, dayState, behindBySeconds, progressPct } = userState;
  
  // Priority order as specified
  switch (dayState) {
    case 'OFF_SCHEDULE':
      return 'You are significantly behind today\'s expected progress.';
    
    case 'BEHIND':
      if (mode === 'IN_SHIFT_NO_ACTIVITY') {
        return 'Your workday has started, but no activity is recorded yet.';
      }
      return `You are ${formatDurationHuman(behindBySeconds)} behind today's target.`;
    
    case 'PRE_SHIFT':
      return `Your workday starts at ${expected.workStart}.`;
    
    case 'WAITING':
      return 'Waiting for first activity today.';
    
    case 'ON_TRACK':
      if (!userState.isDataSufficient) {
        return 'Just getting started. Keep going!';
      }
      const pct = Math.round(progressPct * 100);
      return `You are on track today (${pct}% progress).`;
    
    default:
      return 'Tracking your day.';
  }
}

// ============================================================================
// Micro-Coaching Engine (PART 3)
// ============================================================================

function generateGuidance(
  userState: UserState,
  focusStats: FocusStats
): Guidance {
  const { mode, dayState, focusRatio, dominantActivity, isDataSufficient } = userState;
  const { longestFocusStreak, longestIdlePeriod } = focusStats;
  
  // A) PRE_SHIFT
  if (mode === 'PRE_SHIFT') {
    return {
      message: 'Pre-shift. Decide your first task so you can start strong.',
      tone: 'neutral',
      icon: '🌅',
    };
  }
  
  // B) IN_SHIFT_NO_ACTIVITY
  if (mode === 'IN_SHIFT_NO_ACTIVITY') {
    return {
      message: 'Your workday has started. Begin a focused work session.',
      tone: 'corrective',
      icon: '🎯',
    };
  }
  
  // C) OFF_SCHEDULE
  if (dayState === 'OFF_SCHEDULE') {
    return {
      message: 'You are far behind today. Start a 25-minute focus block now.',
      tone: 'corrective',
      icon: '⚡',
    };
  }
  
  // D) BEHIND
  if (dayState === 'BEHIND') {
    if (dominantActivity === 'idle') {
      return {
        message: 'You\'ve spent more time idle than working so far. Try a distraction-free focus block.',
        tone: 'warning',
        icon: '🔄',
      };
    }
    return {
      message: 'Pick one task and focus on it for 20 minutes.',
      tone: 'warning',
      icon: '📋',
    };
  }
  
  // E) ON_TRACK
  if (dayState === 'ON_TRACK') {
    // Check for long idle streak (re-engagement hint)
    if (longestIdlePeriod > 1500 && isDataSufficient) { // > 25 minutes
      return {
        message: 'You\'ve had a long break. Time to re-engage with your work.',
        tone: 'neutral',
        icon: '🔄',
      };
    }
    
    // Check focus quality
    if (isDataSufficient && focusRatio < MODERATE_FOCUS_THRESHOLD) {
      return {
        message: 'Your focus quality is low so far. Try a dedicated work block.',
        tone: 'warning',
        icon: '🎯',
      };
    }
    
    // Check focus streak
    if (longestFocusStreak < MIN_FOCUS_STREAK_GOOD) {
      return {
        message: 'Good start. Try to build a longer focus streak.',
        tone: 'encouraging',
        icon: '📈',
      };
    }
    
    // Strong performance
    return {
      message: 'Strong focus today. Protect this momentum.',
      tone: 'encouraging',
      icon: '🔥',
    };
  }
  
  // Default (WAITING or unknown)
  return {
    message: 'Begin your first task to start tracking.',
    tone: 'neutral',
    icon: '▶️',
  };
}

// ============================================================================
// Status Display
// ============================================================================

function getStatusDisplay(dayState: DayState): { emoji: string; label: string; color: string } {
  switch (dayState) {
    case 'ON_TRACK':
      return { emoji: '🟢', label: 'On Track', color: '#28a745' };
    case 'BEHIND':
      return { emoji: '🟠', label: 'Behind', color: '#ff9800' };
    case 'OFF_SCHEDULE':
      return { emoji: '🔴', label: 'Off Schedule', color: '#dc3545' };
    case 'WAITING':
      return { emoji: '⚪', label: 'Waiting', color: '#6c757d' };
    case 'PRE_SHIFT':
      return { emoji: '🌙', label: 'Pre-shift', color: '#6c757d' };
    default:
      return { emoji: '⚪', label: 'Unknown', color: '#6c757d' };
  }
}

// ============================================================================
// Main Insight Computation
// ============================================================================

export function computeDailyInsight(
  metrics: DailyMetrics,
  expected: ExpectedWindow,
  focusStats: FocusStats
): DailyInsight {
  const userState = computeUserState(metrics, expected, focusStats);
  const sentence = generateSentence(userState, expected);
  const guidance = generateGuidance(userState, focusStats);
  const { emoji, label, color } = getStatusDisplay(userState.dayState);
  
  return {
    userState,
    sentence,
    guidance,
    statusEmoji: emoji,
    statusLabel: label,
    statusColor: color,
  };
}

// ============================================================================
// Focus Stats Computation
// ============================================================================

export function computeFocusStats(
  logs: Array<{ app_name: string; window_title: string; duration: number; timestamp: string }>,
  sessionStart: Date,
  currentActivity?: { appName: string; windowTitle: string; startTime: string; isIdle: boolean } | null
): FocusStats {
  const sessionStartTs = sessionStart.getTime();

  // Filter logs to session
  const relevantLogs = logs.filter(log => new Date(log.timestamp).getTime() >= sessionStartTs);

  // Compute totals
  let activeTotal = 0;
  let idleTotal = 0;
  let untrackedTotal = 0;
  let longestFocusStreak = 0;
  let longestIdlePeriod = 0;
  let currentFocusStreak = 0;
  let currentIdlePeriod = 0;

  const appTotals = new Map<string, number>();

  for (const log of relevantLogs) {
    const isIdle = log.app_name === 'System' &&
      (log.window_title === 'Idle' || log.window_title === 'Paused');

    if (isIdle) {
      idleTotal += log.duration;
      currentIdlePeriod += log.duration;
      longestIdlePeriod = Math.max(longestIdlePeriod, currentIdlePeriod);
      // Reset focus streak
      longestFocusStreak = Math.max(longestFocusStreak, currentFocusStreak);
      currentFocusStreak = 0;
    } else {
      activeTotal += log.duration;
      currentFocusStreak += log.duration;
      longestFocusStreak = Math.max(longestFocusStreak, currentFocusStreak);
      // Reset idle period
      longestIdlePeriod = Math.max(longestIdlePeriod, currentIdlePeriod);
      currentIdlePeriod = 0;

      // Track app usage
      const existing = appTotals.get(log.app_name) || 0;
      appTotals.set(log.app_name, existing + log.duration);
    }
  }

  // Include the live current activity so the display updates in real-time
  if (currentActivity && currentActivity.startTime) {
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(currentActivity.startTime).getTime()) / 1000));
    if (elapsed > 0) {
      const isIdle = currentActivity.isIdle;
      if (isIdle) {
        idleTotal += elapsed;
        currentIdlePeriod += elapsed;
        longestIdlePeriod = Math.max(longestIdlePeriod, currentIdlePeriod);
        longestFocusStreak = Math.max(longestFocusStreak, currentFocusStreak);
        currentFocusStreak = 0;
      } else {
        activeTotal += elapsed;
        currentFocusStreak += elapsed;
        longestFocusStreak = Math.max(longestFocusStreak, currentFocusStreak);
        longestIdlePeriod = Math.max(longestIdlePeriod, currentIdlePeriod);
        currentIdlePeriod = 0;

        const existing = appTotals.get(currentActivity.appName) || 0;
        appTotals.set(currentActivity.appName, existing + elapsed);
      }
    }
  }

  // Finalize streaks
  longestFocusStreak = Math.max(longestFocusStreak, currentFocusStreak);
  longestIdlePeriod = Math.max(longestIdlePeriod, currentIdlePeriod);

  // Get top apps
  const topApps = Array.from(appTotals.entries())
    .map(([app, seconds]) => ({ app, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);

  return {
    longestFocusStreak,
    longestIdlePeriod,
    topApps,
    focusSplit: {
      active: activeTotal,
      idle: idleTotal,
      untracked: untrackedTotal,
    },
  };
}

// ============================================================================
// Focus Quality Helpers
// ============================================================================

export function getFocusQualityLabel(quality: FocusQuality): string {
  switch (quality) {
    case 'strong': return 'Strong';
    case 'moderate': return 'Moderate';
    case 'low': return 'Low';
    default: return 'Too early to judge';
  }
}

export function getFocusQualityColor(quality: FocusQuality): string {
  switch (quality) {
    case 'strong': return '#28a745';
    case 'moderate': return '#ff9800';
    case 'low': return '#dc3545';
    default: return '#6c757d';
  }
}

export function getDominantActivityMessage(dominant: 'active' | 'idle' | 'balanced' | 'unknown'): string {
  switch (dominant) {
    case 'active': return 'Active time is leading your day.';
    case 'idle': return 'You\'ve spent more time idle than working so far.';
    case 'balanced': return 'Your time is balanced between active and idle.';
    default: return '';
  }
}
