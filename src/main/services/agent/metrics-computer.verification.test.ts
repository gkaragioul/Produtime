
import { MetricsComputer } from './metrics-computer';
import { DatabaseManager } from '../../database';

// Simple mock setup since we can't easily import jest types in this environment without proper config
const mockDb = {
    getActivityLogsByDateRange: jest.fn(),
    getActivitySummaryByDateRange: jest.fn(),
    getActivityLogsByDateRangeAggregated: jest.fn(),
    getDailyMetrics: jest.fn(),
    saveDailyMetrics: jest.fn(),
    get: jest.fn().mockReturnValue(null),
    getSetting: jest.fn().mockReturnValue(null),
} as unknown as DatabaseManager;

describe('MetricsComputer Verification', () => {
    let computer: MetricsComputer;

    beforeEach(() => {
        computer = new MetricsComputer(mockDb);
        jest.clearAllMocks();
    });

    test('computeLast15mMetrics categorizes apps correctly', () => {
        const now = new Date();
        const tenMinsAgo = new Date(now.getTime() - 10 * 60000); // 10 mins ago

        // Mock logs (synchronous return)
        (mockDb.getActivityLogsByDateRange as jest.Mock).mockReturnValue([
            {
                app_name: 'VSCode',
                window_title: 'metrics.ts',
                duration: 60,
                timestamp: tenMinsAgo.toISOString()
            },
            {
                app_name: 'Chrome',
                window_title: 'GitHub - Pull Request',
                duration: 120,
                timestamp: tenMinsAgo.toISOString()
            },
            {
                app_name: 'Chrome',
                window_title: 'YouTube - Cat Videos',
                duration: 300,
                timestamp: tenMinsAgo.toISOString()
            },
            {
                app_name: 'Steam',
                window_title: 'Game',
                duration: 100,
                timestamp: tenMinsAgo.toISOString()
            }
        ]);
        (mockDb.get as jest.Mock).mockReturnValue(null);
        (mockDb.getSetting as jest.Mock).mockReturnValue(null);

        const metrics = computer.computeLast15mMetrics();

        console.log('Metrics:', metrics);

        // VSCode (60s) is productive (matches 'code' pattern)
        // Chrome is neutral (no pattern match) - it's a browser, categorization is by app name not window title
        // Steam (100s) is distracting (matches 'steam' pattern)
        expect(metrics.productiveSeconds).toBe(60);
        expect(metrics.unproductiveSeconds).toBe(100);
    });

    test('computeLast15mMetrics uses admin-pushed categories when available', () => {
        const now = new Date();
        const fiveMinsAgo = new Date(now.getTime() - 5 * 60000);

        (mockDb.getActivityLogsByDateRange as jest.Mock).mockReturnValue([
            {
                app_name: 'Chrome',
                window_title: 'Work Dashboard',
                duration: 120,
                timestamp: fiveMinsAgo.toISOString()
            },
            {
                app_name: 'Slack',
                window_title: 'General',
                duration: 60,
                timestamp: fiveMinsAgo.toISOString()
            },
        ]);
        // Admin pushed Chrome as productive and Slack as distracting
        (mockDb.get as jest.Mock).mockReturnValue({
            value: JSON.stringify({ Chrome: 'productive', Slack: 'distracting' })
        });
        (mockDb.getSetting as jest.Mock).mockReturnValue(null);

        const metrics = computer.computeLast15mMetrics();

        // Chrome (120s) overridden to productive, Slack (60s) overridden to distracting
        expect(metrics.productiveSeconds).toBe(120);
        expect(metrics.unproductiveSeconds).toBe(60);
    });
});
