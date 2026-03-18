/**
 * Global setup for web edition.
 * Injects adminAuth and adminAPI onto window so that all existing
 * React components (copied from admin-console) work without modification.
 */

import { adminAuth, adminAPI } from './services/api-client';

// Assign to window globals — matches the Electron preload bridge
(window as any).adminAuth = adminAuth;
(window as any).adminAPI = adminAPI;
