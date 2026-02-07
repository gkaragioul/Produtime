export interface AppDuration { app: string; seconds: number }

export function computePerAppAndTop(
  logs: Array<{ app_name: string; window_title: string; duration: number; timestamp: string }>,
  current?: { appName: string; windowTitle: string; startTime: string | Date; isIdle: boolean },
  now: Date = new Date()
) {
  const perApp: Record<string, number> = {};
  let active = 0;
  let idle = 0;

  for (const log of logs) {
    const isIdle = log.app_name === 'System' && log.window_title === 'Idle';
    if (isIdle) idle += log.duration;
    else {
      active += log.duration;
      perApp[log.app_name] = (perApp[log.app_name] || 0) + log.duration;
    }
  }

  if (current) {
    const start = new Date(current.startTime).getTime();
    const elapsed = Math.max(0, Math.floor((now.getTime() - start) / 1000));
    if (current.isIdle) idle += elapsed;
    else {
      active += elapsed;
      perApp[current.appName] = (perApp[current.appName] || 0) + elapsed;
    }
  }

  const topApps = Object.entries(perApp)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([app, seconds]) => ({ app, seconds }));

  const total = active + idle;
  const productivity = total > 0 ? Math.round((active / total) * 100) : 0;
  return { active, idle, total, productivity, perApp, topApps } as const;
}

