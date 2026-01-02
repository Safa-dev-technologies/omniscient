/**
 * Web Adapter
 * Browser-based chat widget adapter
 */

export { WebAdapter } from './web.adapter.js';
export type {
  WebIncomingMessage,
  WebOutgoingMessage,
  WebSession,
  WebWidgetConfig,
  WebEvent,
} from './web.types.js';
export { createSessionManager, type SessionManager } from './web.session.js';
