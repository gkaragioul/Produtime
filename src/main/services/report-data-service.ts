import { DatabaseManager } from '../database';
import {
    ReportOptions,
    ActivityLog,
    ReportData,
    Analytics,
    ComprehensiveReportData,
    ApplicationCategory,
    HourlyActivity,
    ProductivityMetrics,
    SessionDetail
} from '../../shared/types';
import { DEFAULT_PRIVACY_APPS } from './privacy-constants';
import * as path from 'path';
import * as os from 'os';

export class ReportDataService {
    // Application categorization mapping
    private readonly applicationCategories = {
        'Development Tools': {
            keywords: [
                'vscode', 'visual studio', 'code', 'intellij', 'eclipse', 'atom', 'sublime',
                'vim', 'emacs', 'webstorm', 'pycharm', 'android studio', 'xcode',
                'git', 'github', 'gitlab', 'terminal', 'cmd', 'powershell', 'bash',
            ],
            color: '#4e79a7',
        },
        'Web Browsers': {
            keywords: [
                'chrome', 'firefox', 'safari', 'edge', 'opera', 'brave', 'internet explorer',
            ],
            color: '#f28e2b',
        },
        Communication: {
            keywords: [
                'slack', 'teams', 'discord', 'zoom', 'skype', 'telegram', 'whatsapp',
                'outlook', 'thunderbird', 'mail',
            ],
            color: '#e15759',
        },
        'Design & Media': {
            keywords: [
                'photoshop', 'illustrator', 'figma', 'sketch', 'canva', 'gimp',
                'blender', 'premiere', 'after effects', 'lightroom',
            ],
            color: '#76b7b2',
        },
        'Office & Productivity': {
            keywords: [
                'word', 'excel', 'powerpoint', 'notion', 'obsidian', 'evernote',
                'onenote', 'google docs', 'sheets', 'slides', 'libreoffice', 'openoffice',
            ],
            color: '#59a14f',
        },
        Entertainment: {
            keywords: [
                'spotify', 'youtube', 'netflix', 'twitch', 'steam', 'epic games',
                'discord', 'vlc', 'media player',
            ],
            color: '#edc949',
        },
        'System & Utilities': {
            keywords: [
                'explorer', 'finder', 'task manager', 'activity monitor', 'calculator',
                'notepad', 'textedit', 'settings', 'control panel',
            ],
            color: '#af7aa1',
        },
    };

    constructor(private database: DatabaseManager) { }

    private isIdleLog(log: ActivityLog): boolean {
        return (
            log.app_name === 'System' &&
            (log.window_title === 'Idle' || log.window_title === 'Paused')
        );
    }

    private getLocalDateKey(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    private getDateRangeBounds(dateRange: { startDate: string; endDate: string }) {
        const start = new Date(`${dateRange.startDate}T00:00:00`);
        const end = new Date(`${dateRange.endDate}T23:59:59.999`);
        return { start, end };
    }

    private forEachHourSegment(
        start: Date,
        end: Date,
        cb: (hour: number, seconds: number) => void
    ): void {
        const startTime = start.getTime();
        const endTime = end.getTime();
        if (!isFinite(startTime) || !isFinite(endTime) || endTime <= startTime) {
            return;
        }

        let cursor = new Date(startTime);
        while (cursor.getTime() < endTime) {
            const next = new Date(cursor.getTime());
            next.setMinutes(0, 0, 0);
            next.setHours(cursor.getHours() + 1);
            const segmentEnd =
                next.getTime() < endTime ? next : new Date(endTime);
            const seconds = Math.max(
                0,
                Math.floor((segmentEnd.getTime() - cursor.getTime()) / 1000)
            );
            if (seconds > 0) {
                cb(cursor.getHours(), seconds);
            }
            cursor = segmentEnd;
        }
    }

    private isProductiveApp(appName: string): boolean {
        const productiveCategories = [
            'Development Tools',
            'Office & Productivity',
            'Design & Media',
            'Communication',
        ];
        const category = this.getApplicationCategory(appName);
        return productiveCategories.includes(category);
    }

    private getApplicationCategory(appName: string): string {
        const lowerAppName = appName.toLowerCase();

        for (const [categoryName, categoryData] of Object.entries(
            this.applicationCategories
        )) {
            if (
                categoryData.keywords.some((keyword) =>
                    lowerAppName.includes(keyword.toLowerCase())
                )
            ) {
                return categoryName;
            }
        }
        return 'Other';
    }

    /**
     * Sanitize activity logs based on privacy mode settings.
     */
    private sanitizeActivityLogs(logs: ActivityLog[]): ActivityLog[] {
        const privacyEnabled = this.database.getSetting('privacy_mode_enabled') === 'true';

        if (!privacyEnabled) {
            return logs;
        }

        // Get privacy apps list
        let privacyApps: string[] = DEFAULT_PRIVACY_APPS;
        const privacyAppsJson = this.database.getSetting('privacy_apps');
        if (privacyAppsJson) {
            try {
                privacyApps = JSON.parse(privacyAppsJson);
            } catch {
                privacyApps = DEFAULT_PRIVACY_APPS;
            }
        }

        return logs.map(log => {
            // Check if this app or window title matches a privacy app
            const isPrivacyApp = privacyApps.some(app => {
                const appLower = app.toLowerCase();
                return log.app_name.toLowerCase().includes(appLower) ||
                    log.window_title.toLowerCase().includes(appLower);
            });

            if (isPrivacyApp) {
                // Replace window title with just the app name
                return {
                    ...log,
                    window_title: log.app_name
                };
            }

            return log;
        });
    }

    public async getReportData(
        options: ReportOptions
    ): Promise<ComprehensiveReportData> {
        try {
            const { dateRange } = options;

            // Snapshot in-progress activity so the report includes up-to-the-moment data
            try {
                const tracker: any = (global as any).activityTracker;
                if (tracker && typeof tracker.snapshotNow === 'function') {
                    console.log(
                        '[ReportDataService] Snapshotting current activity before data fetch...'
                    );
                    await tracker.snapshotNow();
                }
            } catch (e) {
                console.warn('[ReportDataService] Snapshot attempt failed (continuing):', e);
            }

            // Calculate date range in days to determine if we need to limit query
            const startDateObj = new Date(dateRange.startDate);
            const endDateObj = new Date(dateRange.endDate);
            const dateRangeDays = Math.ceil((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24)) + 1;

            // For large date ranges (>7 days), limit to prevent memory issues
            // Monthly reports can have 50,000+ records which causes crashes
            const SAFE_LIMIT = 10000; // Safe limit to prevent memory exhaustion
            const shouldLimit = dateRangeDays > 7;

            console.log(
                `[ReportDataService] Date range: ${dateRangeDays} days (${dateRange.startDate} to ${dateRange.endDate})`
            );

            // Get activity logs for the date range with safety limit
            const rawActivityLogs = await this.database.getActivityLogsByDateRange(
                dateRange.startDate,
                dateRange.endDate,
                shouldLimit ? SAFE_LIMIT : undefined
            );

            // Apply privacy sanitization to activity logs
            const activityLogs = this.sanitizeActivityLogs(rawActivityLogs);

            console.log(
                `[ReportDataService] Loaded activity logs: count=${activityLogs?.length ?? 0} in ${dateRange.startDate}..${dateRange.endDate}${shouldLimit ? ' (LIMITED to prevent crash)' : ''}`
            );

            // Enhanced logging for data verification
            if (activityLogs && activityLogs.length > 0) {
                console.log(
                    `[ReportDataService] First log: ${activityLogs[0].timestamp} - ${activityLogs[0].app_name} (${activityLogs[0].duration}s)`
                );
                console.log(
                    `[ReportDataService] Last log: ${activityLogs[activityLogs.length - 1].timestamp} - ${activityLogs[activityLogs.length - 1].app_name} (${activityLogs[activityLogs.length - 1].duration}s)`
                );

                const totalDuration = activityLogs.reduce(
                    (sum, log) => sum + log.duration,
                    0
                );
                const activeDuration = activityLogs
                    .filter(
                        (log) =>
                            !(
                                log.app_name === 'System' &&
                                (log.window_title === 'Idle' || log.window_title === 'Paused')
                            )
                    )
                    .reduce((sum, log) => sum + log.duration, 0);
                const idleDuration = totalDuration - activeDuration;

                console.log(
                    `[ReportDataService] Total duration: ${totalDuration}s (${(totalDuration / 3600).toFixed(2)}h)`
                );
                console.log(
                    `[ReportDataService] Active duration: ${activeDuration}s (${(activeDuration / 3600).toFixed(2)}h)`
                );
                console.log(
                    `[ReportDataService] Idle duration: ${idleDuration}s (${(idleDuration / 3600).toFixed(2)}h)`
                );
            }

            // Get analytics data
            const analytics = await this.database.getAnalyticsByDateRange(
                dateRange.startDate,
                dateRange.endDate
            );
            console.log(`[ReportDataService] Loaded analytics: count=${analytics?.length ?? 0}`);

            // Calculate basic summary statistics
            const summary = this.calculateSummary(activityLogs);

            // Generate comprehensive data
            const applicationCategories = this.categorizeApplications(activityLogs);
            const hourlyTimeline = this.generateHourlyTimeline(
                activityLogs,
                dateRange
            );
            const productivityMetrics =
                this.calculateProductivityMetrics(activityLogs);
            const sessionDetails = this.generateSessionDetails(activityLogs);
            const workSchedule = this.calculateWorkScheduleMetrics(
                activityLogs,
                dateRange
            );
            const topApplications = this.getTopApplications(activityLogs);
            const timeDistribution = this.calculateTimeDistribution(
                activityLogs,
                workSchedule
            );

            // Build enhanced analytics bundle expected by tests
            const enhancedAnalytics = {
                userInfo: this.getSystemInfo(),
                scheduleAnalysis: this.calculateScheduleAnalysis(
                    dateRange,
                    activityLogs
                ),
                applicationBreakdown: this.calculateApplicationBreakdown(activityLogs),
                hourlyBreakdown: this.calculateHourlyBreakdown(dateRange, activityLogs),
            };

            const reportData: ComprehensiveReportData = {
                title: options.title || `Report ${dateRange.startDate} - ${dateRange.endDate}`,
                dateRange,
                summary,
                activityLogs,
                analytics,
                applicationCategories,
                hourlyTimeline,
                productivityMetrics,
                sessionDetails,
                workSchedule,
                topApplications,
                timeDistribution,
                // Add warning flag if data was truncated to prevent crash
                isTruncated: shouldLimit && activityLogs.length >= SAFE_LIMIT,
                truncatedAtLimit: shouldLimit ? SAFE_LIMIT : undefined,
                enhancedAnalytics,
            };

            console.log(
                `[ReportDataService] Prepared report data: categories=${applicationCategories.length}, topApps=${topApplications.length}, hourly=${hourlyTimeline.length}`
            );

            return reportData;
        } catch (error) {
            console.error('Error getting report data:', error);
            throw new Error(`Failed to get report data: ${error}`);
        }
    }

    // Placeholder methods for logic I need to check in the original file to copy correctly
    // I will use 'view_file' next to copy the implementations of:
    // calculateSummary, categorizeApplications, generateHourlyTimeline, calculateProductivityMetrics,
    // generateSessionDetails, calculateWorkScheduleMetrics, getTopApplications, calculateTimeDistribution,
    // getSystemInfo, calculateScheduleAnalysis, calculateApplicationBreakdown, calculateHourlyBreakdown

    private calculateSummary(activityLogs: ActivityLog[]) {
        const activeLogs = activityLogs.filter((log) => !this.isIdleLog(log));
        const totalSessions = activeLogs.length;
        let totalSeconds = 0;
        const dayCount: { [key: string]: number } = {};
        const hourCount: { [key: number]: number } = {};

        activeLogs.forEach((log) => {
            // Use duration from database or calculate from timestamp
            if (log.duration) {
                totalSeconds += log.duration;
            }

            const timestamp = new Date(log.timestamp);
            const day = timestamp.toDateString();
            dayCount[day] = (dayCount[day] || 0) + 1;

            const hour = timestamp.getHours();
            hourCount[hour] = (hourCount[hour] || 0) + 1;
        });

        const totalHours = totalSeconds / 3600;
        const averageSessionLength =
            totalSessions > 0 ? totalSeconds / 60 / totalSessions : 0;

        const mostActiveDay = Object.keys(dayCount).reduce(
            (a, b) => (dayCount[a] > dayCount[b] ? a : b),
            Object.keys(dayCount)[0] || 'N/A'
        );

        const mostActiveHour =
            Object.keys(hourCount).length > 0
                ? parseInt(
                    Object.keys(hourCount).reduce((a, b) =>
                        hourCount[parseInt(a)] > hourCount[parseInt(b)] ? a : b
                    )
                )
                : 0;

        return {
            totalHours: Math.round(totalHours * 100) / 100,
            totalSessions,
            averageSessionLength: Math.round(averageSessionLength * 100) / 100,
            mostActiveDay,
            mostActiveHour,
            // Add missing properties expected by interface if needed, or update interface
            activeTimeRaw: totalSeconds,
            productivityScore: 0, // Calculated elsewhere
            mostUsedApp: '', // Calculated elsewhere
            mostProductiveTime: `${mostActiveHour}:00`
        };
    }

    private categorizeApplications(
        activityLogs: ActivityLog[]
    ): ApplicationCategory[] {
        const categoryTotals: {
            [key: string]: { time: number; apps: Set<string> };
        } = {};
        let totalTime = 0;

        // Initialize categories
        Object.keys(this.applicationCategories).forEach((category) => {
            categoryTotals[category] = { time: 0, apps: new Set() };
        });
        categoryTotals['Other'] = { time: 0, apps: new Set() };

        // Categorize each activity log
        activityLogs.forEach((log) => {
            if (this.isIdleLog(log)) return;
            const appName = log.app_name.toLowerCase();
            const duration = log.duration || 0;
            totalTime += duration;

            let categorized = false;

            for (const [categoryName, categoryData] of Object.entries(
                this.applicationCategories
            )) {
                if (
                    categoryData.keywords.some((keyword) =>
                        appName.includes(keyword.toLowerCase())
                    )
                ) {
                    categoryTotals[categoryName].time += duration;
                    categoryTotals[categoryName].apps.add(log.app_name);
                    categorized = true;
                    break;
                }
            }

            if (!categorized) {
                categoryTotals['Other'].time += duration;
                categoryTotals['Other'].apps.add(log.app_name);
            }
        });

        // Convert to ApplicationCategory array
        return Object.entries(categoryTotals)
            .filter(([_, data]) => data.time > 0)
            .map(([name, data]) => ({
                name,
                applications: Array.from(data.apps),
                totalTime: data.time,
                percentage:
                    totalTime > 0 ? Math.round((data.time / totalTime) * 100) : 0,
                color:
                    this.applicationCategories[
                        name as keyof typeof this.applicationCategories
                    ]?.color || '#bab0ab',
            }))
            .sort((a, b) => b.totalTime - a.totalTime);
    }
    private generateHourlyTimeline(
        activityLogs: ActivityLog[],
        dateRange: { startDate: string; endDate: string }
    ): HourlyActivity[] {
        const hourlyData: { [hour: number]: HourlyActivity } = {};

        // Initialize all 24 hours
        for (let hour = 0; hour < 24; hour++) {
            hourlyData[hour] = {
                hour,
                totalTime: 0,
                activeTime: 0,
                idleTime: 0,
                sessionCount: 0,
                topApplications: [],
            };
        }

        const hourlyApps: { [hour: number]: { [app: string]: number } } = {};
        const { start: rangeStart, end: rangeEnd } =
            this.getDateRangeBounds(dateRange);

        for (const log of activityLogs) {
            const duration = log.duration || 0;
            if (duration <= 0) continue;

            const logStart = new Date(log.timestamp);
            const logEnd = new Date(logStart.getTime() + duration * 1000);
            const segmentStart =
                logStart.getTime() < rangeStart.getTime() ? rangeStart : logStart;
            const segmentEnd =
                logEnd.getTime() > rangeEnd.getTime() ? rangeEnd : logEnd;
            if (segmentEnd.getTime() <= segmentStart.getTime()) continue;

            const isIdle = this.isIdleLog(log);
            this.forEachHourSegment(segmentStart, segmentEnd, (hour, seconds) => {
                hourlyData[hour].totalTime += seconds;
                if (isIdle) {
                    hourlyData[hour].idleTime += seconds;
                } else {
                    hourlyData[hour].activeTime += seconds;
                    hourlyData[hour].sessionCount += 1;
                    if (!hourlyApps[hour]) hourlyApps[hour] = {};
                    hourlyApps[hour][log.app_name] =
                        (hourlyApps[hour][log.app_name] || 0) + seconds;
                }
            });
        }

        // Calculate top applications for each hour
        Object.keys(hourlyData).forEach((hourStr) => {
            const hour = parseInt(hourStr, 10);
            if (hourlyApps[hour]) {
                hourlyData[hour].topApplications = Object.entries(hourlyApps[hour])
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3)
                    .map(([name, time]) => ({ name, time }));
            }
        });

        return Object.values(hourlyData);
    }
    private calculateProductivityMetrics(
        activityLogs: ActivityLog[]
    ): ProductivityMetrics {
        const activeLogs = activityLogs.filter((log) => !this.isIdleLog(log));
        if (activeLogs.length === 0) {
            return {
                productivityScore: 0,
                focusScore: 0,
                distractionTime: 0,
                mostProductiveHour: 9,
                leastProductiveHour: 15,
                averageSessionLength: 0,
                contextSwitches: 0,
            };
        }

        const productiveCategories = [
            'Development Tools',
            'Office & Productivity',
            'Design & Media',
            'Communication',
        ];
        const distractiveCategories = ['Entertainment'];

        const sorted = [...activeLogs].sort(
            (a, b) =>
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        let activeSeconds = 0;
        let productiveSeconds = 0;
        let distractiveSeconds = 0;
        let contextSwitches = 0;
        let lastApp: string | null = null;

        const hourlyProductive: { [hour: number]: number } = {};
        const sessionBreakSeconds = 15 * 60;
        const sessionDurations: number[] = [];
        let currentSessionSeconds = 0;
        let lastActiveEnd: Date | null = null;

        for (const log of sorted) {
            const duration = log.duration || 0;
            if (duration <= 0) continue;

            const logStart = new Date(log.timestamp);
            const logEnd = new Date(logStart.getTime() + duration * 1000);

            if (lastActiveEnd) {
                const gapSeconds =
                    (logStart.getTime() - lastActiveEnd.getTime()) / 1000;
                if (gapSeconds >= sessionBreakSeconds) {
                    if (currentSessionSeconds > 0) {
                        sessionDurations.push(currentSessionSeconds);
                    }
                    currentSessionSeconds = 0;
                    lastApp = null;
                }
            }

            currentSessionSeconds += duration;
            lastActiveEnd = logEnd;
            activeSeconds += duration;

            const category = this.getApplicationCategory(log.app_name);
            const isProductive = productiveCategories.includes(category);
            if (isProductive) {
                productiveSeconds += duration;
                this.forEachHourSegment(logStart, logEnd, (hour, seconds) => {
                    hourlyProductive[hour] = (hourlyProductive[hour] || 0) + seconds;
                });
            } else if (distractiveCategories.includes(category)) {
                distractiveSeconds += duration;
            }

            if (lastApp && lastApp !== log.app_name) {
                contextSwitches++;
            }
            lastApp = log.app_name;
        }

        if (currentSessionSeconds > 0) {
            sessionDurations.push(currentSessionSeconds);
        }

        const productivityScore =
            activeSeconds > 0
                ? Math.round((productiveSeconds / activeSeconds) * 100)
                : 0;

        const productiveHours = Object.entries(hourlyProductive)
            .filter(([_, time]) => time > 0)
            .sort(([, a], [, b]) => b - a);
        const mostProductiveHour =
            productiveHours.length > 0 ? parseInt(productiveHours[0][0], 10) : 9;
        const leastProductiveHour =
            productiveHours.length > 0
                ? parseInt(productiveHours[productiveHours.length - 1][0], 10)
                : 15;

        const avgSessionSeconds =
            sessionDurations.length > 0
                ? Math.round(
                    sessionDurations.reduce((sum, s) => sum + s, 0) /
                    sessionDurations.length
                )
                : 0;
        const activeHours = activeSeconds / 3600;
        const switchRate = activeHours > 0 ? contextSwitches / activeHours : 0;
        const avgSessionMinutes = avgSessionSeconds / 60;
        const focusScoreRaw =
            avgSessionMinutes > 0
                ? (avgSessionMinutes / 60) * (1 / (1 + switchRate)) * 100
                : 0;
        const focusScore = Math.max(0, Math.min(100, Math.round(focusScoreRaw)));

        return {
            productivityScore,
            focusScore,
            distractionTime: distractiveSeconds,
            mostProductiveHour,
            leastProductiveHour,
            averageSessionLength: avgSessionSeconds,
            contextSwitches,
        };
    }
    private generateSessionDetails(activityLogs: ActivityLog[]): SessionDetail[] {
        // Group activities by day to create session details
        const dailySessions: { [date: string]: ActivityLog[] } = {};

        activityLogs.forEach((log) => {
            if (this.isIdleLog(log)) return;
            const date = this.getLocalDateKey(new Date(log.timestamp));
            if (!dailySessions[date]) dailySessions[date] = [];
            dailySessions[date].push(log);
        });

        return Object.entries(dailySessions).map(([date, logs]) => {
            const sortedLogs = logs.sort(
                (a, b) =>
                    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            const startTime = sortedLogs[0]?.timestamp || '';
            const endTime = sortedLogs[sortedLogs.length - 1]?.timestamp || '';
            const totalDuration = logs.reduce(
                (sum, log) => sum + (log.duration || 0),
                0
            );

            // Calculate application breakdown for this session
            const appTimes: { [app: string]: number } = {};
            logs.forEach((log) => {
                appTimes[log.app_name] =
                    (appTimes[log.app_name] || 0) + (log.duration || 0);
            });

            const applications = Object.entries(appTimes)
                .map(([name, time]) => ({
                    name,
                    time,
                    percentage:
                        totalDuration > 0 ? Math.round((time / totalDuration) * 100) : 0,
                }))
                .sort((a, b) => b.time - a.time);

            // Simple productivity calculation based on productive apps
            const productiveTime = applications
                .filter((app) => this.isProductiveApp(app.name))
                .reduce((sum, app) => sum + app.time, 0);
            const productivity =
                totalDuration > 0
                    ? Math.round((productiveTime / totalDuration) * 100)
                    : 0;

            return {
                startTime,
                endTime,
                duration: totalDuration,
                applications,
                breaks: [], // Could be enhanced to detect breaks
                productivity,
            };
        });
    }
    private calculateWorkScheduleMetrics(
        activityLogs: ActivityLog[],
        dateRange: any
    ) {
        // Helpers
        const parseHHMM = (value?: string | null): { h: number; m: number } => {
            if (!value) return { h: 0, m: 0 };
            const [hh, mm] = String(value)
                .split(':')
                .map((n) => Number(n));
            return { h: hh || 0, m: mm || 0 };
        };
        const hoursBetween = (start: string, end: string): number => {
            const { h: sh, m: sm } = parseHHMM(start);
            const { h: eh, m: em } = parseHHMM(end);
            let startMin = sh * 60 + sm;
            let endMin = eh * 60 + em;
            // Support overnight windows (e.g., 22:00–06:00)
            if (endMin <= startMin) endMin += 24 * 60;
            return (endMin - startMin) / 60;
        };

        // Separate active vs idle seconds
        let activeSeconds = 0;
        let idleSeconds = 0;
        for (const log of activityLogs || []) {
            const d = log.duration || 0;
            if (this.isIdleLog(log))
                idleSeconds += d;
            else activeSeconds += d;
        }

        // Determine scheduled hours across the whole date range
        const flatStart =
            this.database.getSetting('work_schedule_start') || '09:00';
        const flatEnd = this.database.getSetting('work_schedule_end') || '17:00';

        const weeklyRaw = this.database.getSetting('work_schedule_weekly');
        const startDate = new Date(`${dateRange.startDate}T00:00:00`);
        const endDate = new Date(`${dateRange.endDate}T00:00:00`);

        const dayKeyFromIdx = (idx: number) =>
            [
                'sunday',
                'monday',
                'tuesday',
                'wednesday',
                'thursday',
                'friday',
                'saturday',
            ][idx];

        let scheduledHours = 0;
        let displayStart = flatStart;
        let displayEnd = flatEnd;

        try {
            if (weeklyRaw) {
                const weekly = JSON.parse(weeklyRaw || '{}');
                const iter = new Date(startDate);
                while (iter.getTime() <= endDate.getTime()) {
                    const idx = iter.getDay();
                    const key = dayKeyFromIdx(idx);
                    const entry = weekly?.[key];
                    if (entry && !entry.nonWorking) {
                        const s = entry.start || flatStart;
                        const e = entry.end || flatEnd;
                        scheduledHours += hoursBetween(s, e);
                        // Use the first day's window for display
                        if (iter.getTime() === startDate.getTime()) {
                            displayStart = s;
                            displayEnd = e;
                        }
                    }
                    // Advance one day
                    iter.setDate(iter.getDate() + 1);
                }
            } else {
                const days =
                    Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
                scheduledHours = days * hoursBetween(flatStart, flatEnd);
            }
        } catch {
            const days =
                Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
            scheduledHours = days * hoursBetween(flatStart, flatEnd);
            displayStart = flatStart;
            displayEnd = flatEnd;
        }

        const actualHours = Math.round((activeSeconds / 3600) * 100) / 100;
        const scheduledHoursRounded = Math.round(scheduledHours * 100) / 100;
        const efficiency =
            scheduledHoursRounded > 0
                ? Math.round((actualHours / scheduledHoursRounded) * 100)
                : 0;

        return {
            start: displayStart,
            end: displayEnd,
            scheduledHours: scheduledHoursRounded,
            actualHours,
            efficiency,
        };
    }
    private getTopApplications(activityLogs: ActivityLog[]) {
        const appTimes: { [app: string]: number } = {};
        const activeLogs = activityLogs.filter((log) => !this.isIdleLog(log));
        const totalTime = activeLogs.reduce(
            (sum, log) => sum + (log.duration || 0),
            0
        );

        activeLogs.forEach((log) => {
            appTimes[log.app_name] =
                (appTimes[log.app_name] || 0) + (log.duration || 0);
        });

        return Object.entries(appTimes)
            .map(([name, time]) => ({
                name,
                time,
                percentage: totalTime > 0 ? Math.round((time / totalTime) * 100) : 0,
                category: this.getApplicationCategory(name),
            }))
            .sort((a, b) => b.time - a.time)
            .slice(0, 10);
    }
    private calculateTimeDistribution(
        activityLogs: ActivityLog[],
        workSchedule: any
    ) {
        // Compute in hours consistently
        let activeSeconds = 0;
        let idleSeconds = 0;
        for (const log of activityLogs || []) {
            const d = log.duration || 0;
            if (this.isIdleLog(log))
                idleSeconds += d;
            else activeSeconds += d;
        }

        const activeHours = activeSeconds / 3600;
        const breakHours = idleSeconds / 3600;

        const scheduled = Number(workSchedule?.scheduledHours || 0);
        const workTimeHours = Math.min(activeHours, scheduled);
        const overtimeHours = Math.max(0, activeHours - scheduled);
        const undertimeHours = Math.max(0, scheduled - activeHours);

        return {
            workTime: Math.round(workTimeHours * 100) / 100,
            breakTime: Math.round(breakHours * 100) / 100,
            overtimeHours: Math.round(overtimeHours * 100) / 100,
            undertimeHours: Math.round(undertimeHours * 100) / 100,
        };
    }
    private getSystemInfo(): {
        employeeName: string;
        computerName: string;
        ipAddress: string;
        reportGeneratedAt: string;
    } {
        try {
            const hostname = os.hostname();
            const nets = os.networkInterfaces();
            let ipAddress = 'Unknown';
            if (nets) {
                for (const name of Object.keys(nets)) {
                    const addrs = nets[name] || [];
                    for (const addr of addrs) {
                        if (addr.family === 'IPv4' && !addr.internal) {
                            ipAddress = addr.address;
                            break;
                        }
                    }
                    if (ipAddress !== 'Unknown') break;
                }
            }
            const employeeName = (
                this.database.getSetting('employee_name') || 'Unknown'
            ).trim();
            return {
                employeeName: employeeName || 'Unknown',
                computerName: hostname || 'Unknown',
                ipAddress,
                reportGeneratedAt: new Date().toISOString(),
            };
        } catch {
            return {
                employeeName:
                    (this.database.getSetting('employee_name') || 'Unknown').trim() ||
                    'Unknown',
                computerName: 'Unknown',
                ipAddress: 'Unknown',
                reportGeneratedAt: new Date().toISOString(),
            };
        }
    }
    private calculateScheduleAnalysis(
        dateRange: { startDate: string; endDate: string },
        activityLogs: ActivityLog[]
    ) {
        // Compute active/idle seconds
        let activeSeconds = 0;
        let idleSeconds = 0;
        for (const log of activityLogs || []) {
            const d = log.duration || 0;
            if (this.isIdleLog(log))
                idleSeconds += d;
            else activeSeconds += d;
        }

        const ws = this.calculateWorkScheduleMetrics(activityLogs, dateRange);
        const dist = this.calculateTimeDistribution(activityLogs, ws);

        // Build list of non-working days within the range when weekly schedule marks them as nonWorking
        const weeklyRaw = this.database.getSetting('work_schedule_weekly');
        const nonWorkingDays: string[] = [];
        try {
            if (weeklyRaw) {
                const weekly = JSON.parse(weeklyRaw);
                const dayKeyFromIdx = (idx: number) =>
                    [
                        'sunday',
                        'monday',
                        'tuesday',
                        'wednesday',
                        'thursday',
                        'friday',
                        'saturday',
                    ][idx];
                const iter = new Date(`${dateRange.startDate}T00:00:00`);
                const end = new Date(`${dateRange.endDate}T00:00:00`);
                const fmtLocal = (d: Date) => {
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    return `${y}-${m}-${dd}`;
                };
                while (iter.getTime() <= end.getTime()) {
                    const key = dayKeyFromIdx(iter.getDay());
                    if (weekly?.[key]?.nonWorking) {
                        nonWorkingDays.push(fmtLocal(iter));
                    }
                    iter.setDate(iter.getDate() + 1);
                }
            }
        } catch { }

        const totalSeconds = activeSeconds + idleSeconds;
        const productivePercentage =
            totalSeconds > 0 ? Math.round((activeSeconds / totalSeconds) * 100) : 0;

        return {
            scheduledHours: ws.scheduledHours,
            actualActiveHours: Math.round((activeSeconds / 3600) * 100) / 100,
            actualIdleHours: Math.round((idleSeconds / 3600) * 100) / 100,
            productivePercentage,
            overtimeHours: dist.overtimeHours,
            undertimeHours: dist.undertimeHours,
            nonWorkingDays,
        };
    }
    private calculateApplicationBreakdown(activityLogs: ActivityLog[]) {
        const filtered = (activityLogs || []).filter(
            (l) => !this.isIdleLog(l)
        );
        return this.getTopApplications(filtered).map((a) => ({
            appName: a.name,
            totalSeconds: a.time,
            percentage: a.percentage,
            category: a.category,
        }));
    }
    private calculateHourlyBreakdown(
        dateRange: { startDate: string; endDate: string },
        activityLogs: ActivityLog[]
    ) {
        const startDay = new Date(`${dateRange.startDate}T00:00:00`);
        const endDay = new Date(`${dateRange.endDate}T00:00:00`);

        const hours: Array<{
            hour: number;
            scheduledMinutes: number;
            activeMinutes: number;
            idleMinutes: number;
            topApps: { name: string; minutes: number }[];
        }> = Array.from({ length: 24 }, (_, h) => ({
            hour: h,
            scheduledMinutes: 0,
            activeMinutes: 0,
            idleMinutes: 0,
            topApps: [],
        }));

        const minutesFromHHMM = (t: string) => {
            const [hh, mm] = String(t || '00:00')
                .split(':')
                .map((n) => Number(n));
            return (hh || 0) * 60 + (mm || 0);
        };

        const addOverlapMinutes = (
            hourIdx: number,
            startMin: number,
            endMin: number
        ) => {
            const hStart = hourIdx * 60;
            const hEnd = hStart + 60;
            const overlap = Math.max(
                0,
                Math.min(endMin, hEnd) - Math.max(startMin, hStart)
            );
            hours[hourIdx].scheduledMinutes += overlap;
        };

        // Compute scheduled minutes per hour for each day in range
        try {
            const weeklyRaw = this.database.getSetting('work_schedule_weekly');
            const flatStart =
                this.database.getSetting('work_schedule_start') || '09:00';
            const flatEnd = this.database.getSetting('work_schedule_end') || '17:00';

            const weekly = weeklyRaw ? JSON.parse(weeklyRaw) : null;
            const dayKeyFromIdx = (idx: number) =>
                [
                    'sunday',
                    'monday',
                    'tuesday',
                    'wednesday',
                    'thursday',
                    'friday',
                    'saturday',
                ][idx];

            const iter = new Date(startDay);
            while (iter.getTime() <= endDay.getTime()) {
                const idx = iter.getDay();
                const key = dayKeyFromIdx(idx);
                const entry = weekly?.[key];
                const nonWorking = !!entry?.nonWorking;
                const s = entry?.start || flatStart;
                const e = entry?.end || flatEnd;

                if (!nonWorking) {
                    let sMin = minutesFromHHMM(s);
                    let eMin = minutesFromHHMM(e);
                    if (eMin <= sMin) eMin += 24 * 60; // overnight support

                    for (let h = 0; h < 24; h++) {
                        // For overnight shifts, may span past midnight
                        if (eMin <= 24 * 60) {
                            addOverlapMinutes(h, sMin, eMin);
                        } else {
                            // Split across two intervals
                            addOverlapMinutes(h, sMin, 24 * 60);
                            addOverlapMinutes(h, 0, eMin - 24 * 60);
                        }
                    }
                }

                iter.setDate(iter.getDate() + 1);
            }
        } catch { }

        // Aggregate active/idle minutes and top apps per hour within date range
        const { start: rangeStart, end: rangeEnd } =
            this.getDateRangeBounds(dateRange);

        const hourlyApps: { [hour: number]: { [app: string]: number } } = {};

        for (const log of activityLogs || []) {
            const duration = log.duration || 0;
            if (duration <= 0) continue;
            const logStart = new Date(log.timestamp);
            const logEnd = new Date(logStart.getTime() + duration * 1000);
            const segmentStart =
                logStart.getTime() < rangeStart.getTime() ? rangeStart : logStart;
            const segmentEnd =
                logEnd.getTime() > rangeEnd.getTime() ? rangeEnd : logEnd;
            if (segmentEnd.getTime() <= segmentStart.getTime()) continue;

            const isIdle = this.isIdleLog(log);
            this.forEachHourSegment(segmentStart, segmentEnd, (hour, seconds) => {
                if (isIdle) {
                    hours[hour].idleMinutes += seconds / 60;
                } else {
                    hours[hour].activeMinutes += seconds / 60;
                    if (!hourlyApps[hour]) hourlyApps[hour] = {};
                    hourlyApps[hour][log.app_name] =
                        (hourlyApps[hour][log.app_name] || 0) + seconds;
                }
            });
        }

        for (let h = 0; h < 24; h++) {
            if (hourlyApps[h]) {
                hours[h].topApps = Object.entries(hourlyApps[h])
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3)
                    .map(([name, seconds]) => ({
                        name,
                        minutes: Math.round(seconds / 60),
                    }));
            }
            hours[h].activeMinutes = Math.round(hours[h].activeMinutes);
            hours[h].idleMinutes = Math.round(hours[h].idleMinutes);
        }

        return hours;
    }
}
