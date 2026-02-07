import { computePerAppAndTop } from '../../renderer/utils/metrics';

function s(seconds: number) {
  return seconds;
}

describe('metrics.computePerAppAndTop', () => {
  it('aggregates per-app durations and top apps including current activity', () => {
    const logs = [
      {
        app_name: 'Chrome',
        window_title: 'A',
        duration: s(30),
        timestamp: new Date().toISOString(),
      },
      {
        app_name: 'VS Code',
        window_title: 'B',
        duration: s(20),
        timestamp: new Date().toISOString(),
      },
      {
        app_name: 'System',
        window_title: 'Idle',
        duration: s(10),
        timestamp: new Date().toISOString(),
      },
    ];
    const now = new Date();
    const startTime = new Date(now.getTime() - 15_000).toISOString();
    const current = {
      appName: 'Chrome',
      windowTitle: 'C',
      startTime,
      isIdle: false,
    };

    const m = computePerAppAndTop(logs as any, current as any, now);

    expect(m.active).toBe(30 + 20 + 15);
    expect(m.idle).toBe(10);
    expect(m.perApp['Chrome']).toBe(30 + 15);
    expect(m.perApp['VS Code']).toBe(20);
    expect(m.topApps[0].app).toBe('Chrome');
    expect(m.total).toBe(m.active + m.idle);
    expect(m.productivity).toBe(Math.round((m.active / m.total) * 100));
  });
});
