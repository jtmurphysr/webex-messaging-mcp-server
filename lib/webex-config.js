/**
 * Webex API Configuration Module
 * Centralizes authentication and base URL configuration for all Webex tools
 * Delegates authentication to TokenProvider for multi-mode auth support
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import tokenProvider from './token-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Initialize token provider on first use
let providerInitialized = false;

/**
 * Reset provider initialization state (for testing)
 * @private
 */
export function _resetProviderForTesting() {
  providerInitialized = false;
  if (tokenProvider) {
    tokenProvider.mode = null;
    tokenProvider.currentToken = null;
    tokenProvider.expiresAt = null;
    tokenProvider.isRefreshing = false;
    tokenProvider.refreshPromise = null;
    tokenProvider.lastRefreshAt = null;
  }
}

/**
 * Get the Webex API base URL
 * @returns {string} The base URL for Webex API
 */
export function getWebexBaseUrl() {
  return process.env.WEBEX_API_BASE_URL || 'https://webexapis.com/v1';
}

/**
 * Get the Webex API base URL (interface contract alias)
 * @returns {string} The base URL for Webex API
 */
export function getBaseUrl() {
  return getWebexBaseUrl();
}

/**
 * Get the Webex API token (without Bearer prefix) - LEGACY
 * @deprecated Use TokenProvider through getHeaders() instead
 * @returns {string} The API token
 */
export function getWebexToken() {
  const token = process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY;
  if (!token) {
    throw new Error('WEBEX_PUBLIC_WORKSPACE_API_KEY environment variable is not set');
  }
  
  // Remove 'Bearer ' prefix if it exists (since we'll add it in headers)
  return token.replace(/^Bearer\s+/, '');
}

/**
 * Ensure TokenProvider is initialized (synchronously for backwards compatibility)
 * @private
 */
function ensureProviderInitialized() {
  if (!providerInitialized) {
    // Initialize synchronously - this works for bearer/bot modes
    // For OAuth mode, this will load stored tokens synchronously
    try {
      // Create a synchronous initialization path
      if (!tokenProvider.mode) {
        // Detect auth mode synchronously
        if (process.env.WEBEX_CLIENT_ID && process.env.WEBEX_CLIENT_SECRET) {
          // OAuth mode - initialize with stored tokens if available
          tokenProvider._initializeOAuthModeSync();
        } else if (process.env.WEBEX_BOT_TOKEN) {
          tokenProvider._initializeBotMode();
        } else if (process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY) {
          tokenProvider._initializeBearerMode();
        } else {
          throw new Error('No authentication credentials found. Please set WEBEX_CLIENT_ID+WEBEX_CLIENT_SECRET, WEBEX_BOT_TOKEN, or WEBEX_PUBLIC_WORKSPACE_API_KEY');
        }
      }
      providerInitialized = true;
    } catch (error) {
      throw error;
    }
  }
}

/**
 * Get standard headers for Webex API requests
 * @param {Object} additionalHeaders - Additional headers to include
 * @returns {Object} Headers object for fetch requests
 */
export function getWebexHeaders(additionalHeaders = {}) {
  ensureProviderInitialized();
  const authHeader = tokenProvider.getAuthHeaderSync();
  
  return {
    'Accept': 'application/json',
    'Authorization': authHeader,
    ...additionalHeaders
  };
}

/**
 * Get headers for API requests (interface contract alias)
 * @param {Object} additionalHeaders - Additional headers to include
 * @returns {Object} Headers object for fetch requests
 */
export function getHeaders(additionalHeaders = {}) {
  return getWebexHeaders(additionalHeaders);
}

/**
 * Get headers for POST/PUT requests with JSON content
 * @param {Object} additionalHeaders - Additional headers to include
 * @returns {Object} Headers object for JSON requests
 */
export function getWebexJsonHeaders(additionalHeaders = {}) {
  return getWebexHeaders({
    'Content-Type': 'application/json',
    ...additionalHeaders
  });
}

/**
 * Construct a full Webex API URL
 * @param {string} endpoint - The API endpoint (e.g., '/messages', '/rooms')
 * @returns {string} The complete URL
 */
export function getWebexUrl(endpoint) {
  const baseUrl = getWebexBaseUrl();
  // Ensure endpoint starts with /
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${cleanEndpoint}`;
}

/**
 * Validate that all required environment variables are set
 * @throws {Error} If any required variables are missing
 */
export function validateWebexConfig() {
  // Check for any authentication method
  const hasOAuth = process.env.WEBEX_CLIENT_ID && process.env.WEBEX_CLIENT_SECRET;
  const hasBot = process.env.WEBEX_BOT_TOKEN;
  const hasBearer = process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY;
  
  if (!hasOAuth && !hasBot && !hasBearer) {
    throw new Error('No authentication credentials found. Please set WEBEX_CLIENT_ID+WEBEX_CLIENT_SECRET, WEBEX_BOT_TOKEN, or WEBEX_PUBLIC_WORKSPACE_API_KEY');
  }
}

// Validate configuration on module load
try {
  validateWebexConfig();
} catch (error) {
  console.warn(`[Webex Config Warning] ${error.message}`);
}
