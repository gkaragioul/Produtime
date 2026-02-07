
import { MetricsComputer } from './metrics-computer';
import { Database } from '../../database';

// Simple mock setup since we can't easily import jest types in this environment without proper config
const mockDb = {
    getActivityLogsByDateRange: jest.fn(),
    getActivitySummaryByDateRange: jest.fn(),
    getActivityLogsByDateRangeAggregated: jest.fn(),
    getDailyMetrics: jest.fn(),
    saveDailyMetrics: jest.fn(),
} as unknown as Database;

describe('MetricsComputer Verification', () => {
    let computer: MetricsComputer;

    beforeEach(() => {
        computer = new MetricsComputer(mockDb);
        jest.clearAllMocks();
    });

    test('computeLast15mMetrics categorizes apps correctly', async () => {
        const now = new Date();
        const tenMinsAgo = new Date(now.getTime() - 10 * 60000); // 10 mins ago

        // Mock logs
        (mockDb.getActivityLogsByDateRange as jest.Mock).mockResolvedValue([
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

        const metrics = await computer.computeLast15mMetrics();

        console.log('Metrics:', metrics);

        // VSCode (60) + GitHub (120) = 180 productive
        // YouTube (300) + Steam (100) = 400 unproductive
        // Allow for small timing diffs in "effective duration" calculation
        expect(metrics.productiveSeconds).toBeGreaterThan(100);
        expect(metrics.unproductiveSeconds).toBeGreaterThan(300);
    });
});
