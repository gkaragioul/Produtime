/**
 * WebSocket Routes
 * Handles WebSocket endpoints for client and admin connections.
 * 
 * Requirements:
 * - 4.1: Use WSS (WebSocket Secure) for all client-admin communication
 * - 4.3: Reject connections from unpaired or revoked devices
 * - 12.4: Allow dashboard to subscribe to tenant events
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { WebSocketManager } from '../services/ws-manager';

// ============================================================================
// Types
// ============================================================================

interface WebSocketRouteOptions {
  wsManager: WebSocketManager;
  verifyToken: (token: string) => Promise<{ userId: string; tenantId: string } | null>;
}

interface ClientConnectionParams {
  tenantId: string;
}

interface ClientConnectionQuery {
  deviceId: string;
  token?: string;
}

interface AdminConnectionParams {
  tenantId: string;
}

interface AdminConnectionQuery {
  token: string;
}

// ============================================================================
// Route Registration
// ============================================================================

export async function websocketRoutes(
  fastify: FastifyInstance,
  options: WebSocketRouteOptions
): Promise<void> {
  const { wsManager, verifyToken } = options;

  /**
   * Client WebSocket endpoint
   * WSS /ws/client/:tenantId
   * 
   * Query params:
   * - deviceId: The device ID
   * - token: Optional session token for authentication
   * 
   * Requirements: 4.1, 4.3
   */
  fastify.get<{
    Params: ClientConnectionParams;
    Querystring: ClientConnectionQuery;
  }>('/client/:tenantId', { websocket: true }, async (socket: WebSocket, request: FastifyRequest<{
    Params: ClientConnectionParams;
    Querystring: ClientConnectionQuery;
  }>) => {
    const { tenantId } = request.params;
    const { deviceId } = request.query;

    if (!deviceId) {
      socket.close(1008, 'Device ID required');
      return;
    }

    // Handle the connection
    const result = await wsManager.handleClientConnection(socket, tenantId, deviceId);
    
    if (!result.success) {
      // Connection was rejected - socket already closed by wsManager
      request.log.warn({ tenantId, deviceId, error: result.error }, 'Client connection rejected');
    } else {
      request.log.info({ tenantId, deviceId }, 'Client connected');
    }
  });

  /**
   * Admin WebSocket endpoint
   * WSS /ws/admin/:tenantId
   * 
   * Query params:
   * - token: JWT token for authentication
   * 
   * Requirement: 12.4
   */
  fastify.get<{
    Params: AdminConnectionParams;
    Querystring: AdminConnectionQuery;
  }>('/admin/:tenantId', { websocket: true }, async (socket: WebSocket, request: FastifyRequest<{
    Params: AdminConnectionParams;
    Querystring: AdminConnectionQuery;
  }>) => {
    const { tenantId } = request.params;
    const { token } = request.query;

    if (!token) {
      socket.close(1008, 'Authentication required');
      return;
    }

    // Verify JWT token
    const tokenPayload = await verifyToken(token);
    
    if (!tokenPayload) {
      socket.close(1008, 'Invalid token');
      return;
    }

    // Verify tenant matches token
    if (tokenPayload.tenantId !== tenantId) {
      socket.close(1008, 'Tenant mismatch');
      return;
    }

    // Handle the connection
    const result = await wsManager.handleAdminConnection(socket, tenantId, tokenPayload.userId);
    
    if (!result.success) {
      request.log.warn({ tenantId, userId: tokenPayload.userId, error: result.error }, 'Admin connection rejected');
    } else {
      request.log.info({ tenantId, userId: tokenPayload.userId }, 'Admin connected');
    }
  });
}

// ============================================================================
// Exports
// ============================================================================

export default websocketRoutes;
