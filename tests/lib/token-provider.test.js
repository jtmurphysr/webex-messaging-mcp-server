import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import tokenStore from '../../lib/token-store.js'
import tokenProvider from '../../lib/token-provider.js'

describe('token-provider', () => {
  let tempDir
  let originalEnv

  beforeEach(async () => {
    // Save original environment
    originalEnv = {
      WEBEX_CLIENT_ID: process.env.WEBEX_CLIENT_ID,
      WEBEX_CLIENT_SECRET: process.env.WEBEX_CLIENT_SECRET,
      WEBEX_BOT_TOKEN: process.env.WEBEX_BOT_TOKEN,
      WEBEX_PUBLIC_WORKSPACE_API_KEY: process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY,
      WEBEX_AUTH_MODE: process.env.WEBEX_AUTH_MODE,
      WEBEX_TOKEN_STORE_PATH: process.env.WEBEX_TOKEN_STORE_PATH
    }

    // Clear all auth-related env vars
    delete process.env.WEBEX_CLIENT_ID
    delete process.env.WEBEX_CLIENT_SECRET
    delete process.env.WEBEX_BOT_TOKEN
    delete process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY
    delete process.env.WEBEX_AUTH_MODE

    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-provider-test-'))
    process.env.WEBEX_TOKEN_STORE_PATH = path.join(tempDir, 'tokens.json')

    // Reset provider state
    tokenProvider.mode = null
    tokenProvider.currentToken = null
    tokenProvider.expiresAt = null
    tokenProvider.isRefreshing = false
    tokenProvider.refreshPromise = null
    tokenProvider.lastRefreshAt = null

    // Reset token store state
    tokenStore._storePath = null
  })

  afterEach(async () => {
    // Restore original environment
    Object.keys(originalEnv).forEach(key => {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key]
      } else {
        delete process.env[key]
      }
    })

    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }

    // Reset provider state
    tokenProvider.mode = null
    tokenProvider.currentToken = null
    tokenProvider.expiresAt = null
    tokenProvider.isRefreshing = false
    tokenProvider.refreshPromise = null
    tokenProvider.lastRefreshAt = null

    // Reset token store state
    tokenStore._storePath = null
  })

  describe('initialize()', () => {
    it('test_initialize_detects_oauth_mode_with_client_id', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'

      // Mock token store with valid OAuth credentials
      const mockCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: '2026-03-10T17:00:00Z',
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      await tokenStore.write(mockCredentials)

      await tokenProvider.initialize()

      assert.strictEqual(tokenProvider.getMode(), 'oauth')
      assert.strictEqual(tokenProvider.currentToken, 'test-access-token')
    })

    it('test_initialize_detects_bearer_mode_with_api_key', async () => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'test-bearer-token'

      await tokenProvider.initialize()

      assert.strictEqual(tokenProvider.getMode(), 'bearer')
      assert.strictEqual(tokenProvider.currentToken, 'test-bearer-token')
    })

    it('test_initialize_detects_bot_mode_with_bot_token', async () => {
      process.env.WEBEX_BOT_TOKEN = 'test-bot-token'

      await tokenProvider.initialize()

      assert.strictEqual(tokenProvider.getMode(), 'bot')
      assert.strictEqual(tokenProvider.currentToken, 'test-bot-token')
    })

    it('test_oauth_mode_priority_over_bot_mode', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'
      process.env.WEBEX_BOT_TOKEN = 'test-bot-token'

      // Mock token store with valid OAuth credentials
      const mockCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-oauth-token',
        access_token_expires_at: '2026-03-10T17:00:00Z',
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      await tokenStore.write(mockCredentials)

      await tokenProvider.initialize()

      assert.strictEqual(tokenProvider.getMode(), 'oauth')
      assert.strictEqual(tokenProvider.currentToken, 'test-oauth-token')
    })

    it('test_initialize_throws_when_no_credentials', async () => {
      await assert.rejects(
        tokenProvider.initialize(),
        /No authentication credentials found/
      )
    })

    it('test_initialize_throws_when_oauth_credentials_missing', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'

      await assert.rejects(
        tokenProvider.initialize(),
        /OAuth credentials not found/
      )
    })
  })

  describe('getAuthHeader()', () => {
    it('test_get_auth_header_returns_bearer_format', async () => {
      process.env.WEBEX_BOT_TOKEN = 'test-bot-token'
      await tokenProvider.initialize()

      const header = await tokenProvider.getAuthHeader()

      assert.strictEqual(header, 'Bearer test-bot-token')
    })

    it('test_get_auth_header_strips_bearer_prefix', async () => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'Bearer existing-bearer-prefix'
      await tokenProvider.initialize()

      const header = await tokenProvider.getAuthHeader()

      assert.strictEqual(header, 'Bearer existing-bearer-prefix')
    })

    it('test_get_auth_header_throws_when_no_token', async () => {
      process.env.WEBEX_BOT_TOKEN = 'test-bot-token'
      await tokenProvider.initialize()
      
      // Clear the token to simulate failure
      tokenProvider.currentToken = null

      await assert.rejects(
        tokenProvider.getAuthHeader(),
        /No valid bot token available/
      )
    })
  })

  describe('refresh()', () => {
    it('test_refresh_throws_for_non_oauth_mode', async () => {
      process.env.WEBEX_BOT_TOKEN = 'test-bot-token'
      await tokenProvider.initialize()

      await assert.rejects(
        tokenProvider.refresh(),
        /Token refresh is only supported in OAuth mode/
      )
    })

    it('test_refresh_mutex_prevents_concurrent_calls', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'

      // Mock token store with valid OAuth credentials
      const mockCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: '2026-03-10T17:00:00Z',
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      await tokenStore.write(mockCredentials)
      await tokenProvider.initialize()

      // Mock fetch for token refresh
      const originalFetch = global.fetch
      let fetchCallCount = 0
      global.fetch = async () => {
        fetchCallCount++
        return {
          ok: true,
          json: async () => ({
            access_token: 'new-access-token',
            expires_in: 14400,
            refresh_token: 'new-refresh-token'
          })
        }
      }

      // Start multiple refresh calls simultaneously
      const refreshPromises = [
        tokenProvider.refresh(),
        tokenProvider.refresh(),
        tokenProvider.refresh()
      ]

      await Promise.all(refreshPromises)

      // Verify only one fetch call was made (mutex worked)
      assert.strictEqual(fetchCallCount, 1)

      global.fetch = originalFetch
    })

    it('test_pre_emptive_refresh_within_buffer_window', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'

      // Create token that expires within the refresh buffer (1 hour)
      const soonExpiry = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      const mockCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: soonExpiry.toISOString(),
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      await tokenStore.write(mockCredentials)
      await tokenProvider.initialize()

      // Mock fetch for token refresh
      const originalFetch = global.fetch
      let fetchCalled = false
      global.fetch = async () => {
        fetchCalled = true
        return {
          ok: true,
          json: async () => ({
            access_token: 'refreshed-access-token',
            expires_in: 14400,
            refresh_token: 'new-refresh-token'
          })
        }
      }

      // Getting auth header should trigger refresh due to soon expiry
      const header = await tokenProvider.getAuthHeader()

      assert.strictEqual(header, 'Bearer refreshed-access-token')
      assert.strictEqual(fetchCalled, true)

      global.fetch = originalFetch
    })

    it('test_refresh_token_expiry_warning_logged', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'

      // Mock console.warn to capture warnings
      const originalWarn = console.warn
      let warningMessage = ''
      console.warn = (msg) => { warningMessage = msg }

      // Create credentials with refresh token expiring within 30 days
      const soonRefreshExpiry = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000) // 25 days from now
      const mockCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: '2026-03-10T17:00:00Z',
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: soonRefreshExpiry.toISOString(),
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      await tokenStore.write(mockCredentials)

      await tokenProvider.initialize()

      // Restore console.warn
      console.warn = originalWarn

      assert.match(warningMessage, /WARNING: Refresh token expires/)
      assert.match(warningMessage, /Re-run setup command before expiry/)
    })

    it('test_token_invalidation_error_handling', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'

      const mockCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: '2026-03-10T17:00:00Z',
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      await tokenStore.write(mockCredentials)
      await tokenProvider.initialize()

      // Mock fetch to return 401 (admin token invalidation)
      const originalFetch = global.fetch
      global.fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => 'Token invalidated by admin'
      })

      await assert.rejects(
        tokenProvider.refresh(),
        /Token invalidated by admin action/
      )

      global.fetch = originalFetch
    })
  })

  describe('getStatus()', () => {
    it('test_get_status_returns_correct_fields', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'

      const expiryDate = new Date('2026-03-10T17:00:00Z')
      const lastRefreshDate = new Date('2026-03-09T16:00:00Z')
      const mockCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: expiryDate.toISOString(),
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:messages_read'],
        last_refresh_at: lastRefreshDate.toISOString(),
        created_at: '2026-03-09T17:00:00Z'
      }
      await tokenStore.write(mockCredentials)
      await tokenProvider.initialize()

      const status = tokenProvider.getStatus()

      assert.strictEqual(status.mode, 'oauth')
      assert.deepStrictEqual(status.expiresAt, expiryDate)
      assert.strictEqual(status.isExpired, false)
      assert.strictEqual(status.isRefreshing, false)
      assert.deepStrictEqual(status.lastRefreshAt, lastRefreshDate)
    })

    it('test_get_status_shows_expired_token', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'

      // Create expired token
      const pastExpiry = new Date('2026-03-08T17:00:00Z') // yesterday
      const mockCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: pastExpiry.toISOString(),
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      await tokenStore.write(mockCredentials)
      await tokenProvider.initialize()

      const status = tokenProvider.getStatus()

      assert.strictEqual(status.isExpired, true)
    })

    it('test_get_status_bot_mode_no_expiry', async () => {
      process.env.WEBEX_BOT_TOKEN = 'test-bot-token'
      await tokenProvider.initialize()

      const status = tokenProvider.getStatus()

      assert.strictEqual(status.mode, 'bot')
      assert.strictEqual(status.expiresAt, null)
      assert.strictEqual(status.isExpired, false)
      assert.strictEqual(status.lastRefreshAt, null)
    })
  })
})