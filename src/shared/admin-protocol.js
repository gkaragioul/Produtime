"use strict";
/**
 * Admin Console Protocol Types
 * Shared between ProduTime user app (agent) and Admin Console
 *
 * COMPLIANCE: This is NOT spyware. All monitoring is explicit and user-visible.
 * - Pairing requires explicit user approval
 * - "Managed by Admin Console" indicator is always visible when paired
 * - Only aggregated stats are shared by default (no window titles unless explicitly enabled)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MDNS_SERVICE_NAME = exports.MDNS_SERVICE_TYPE = exports.MAX_RECONNECT_ATTEMPTS = exports.RECONNECT_DELAY_MS = exports.SESSION_TOKEN_EXPIRY_MS = exports.NONCE_EXPIRY_MS = exports.STATS_SUMMARY_INTERVAL_MS = exports.HEARTBEAT_INTERVAL_MS = exports.ADMIN_CONSOLE_DEFAULT_PORT = void 0;
// ============================================================================
// CONSTANTS
// ============================================================================
exports.ADMIN_CONSOLE_DEFAULT_PORT = 17888;
exports.HEARTBEAT_INTERVAL_MS = 10000; // 10 seconds
exports.STATS_SUMMARY_INTERVAL_MS = 60000; // 1 minute
exports.NONCE_EXPIRY_MS = 300000; // 5 minutes
exports.SESSION_TOKEN_EXPIRY_MS = 86400000; // 24 hours
exports.RECONNECT_DELAY_MS = 5000; // 5 seconds
exports.MAX_RECONNECT_ATTEMPTS = 10;
// mDNS service type for discovery
exports.MDNS_SERVICE_TYPE = '_produtime-admin._tcp';
exports.MDNS_SERVICE_NAME = 'ProduTime Admin Console';
//# sourceMappingURL=admin-protocol.js.map