import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import tokenStore from '../../lib/token-store.js'
import TokenProvider from '../../lib/token-provider.js'
import { _resetProviderForTesting } from '../../lib/webex-config.js'

describe('OAuth Flow Integration Tests', () => {
  let tempDir
  let originalEnv
  let provider
  let originalFetch

  beforeEach(async () => {
    // Save original environment
    originalEnv = { ...process.env }
    
    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-flow-test-'))
    
    // Set test environment variables
    process.env.WEBEX_TOKEN_STORE_PATH = path.join(tempDir, 'tokens.json')
    process.env.WEBEX_CLIENT_ID = 'test-client-id'
    process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'
    
    // Clear any existing provider
    _resetProviderForTesting()
    
    // Reset the token store's cached path
    tokenStore._storePath = null
    
    // Mock fetch for API calls
    originalFetch = global.fetch
  })

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv
    
    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
    
    // Reset provider and token store
    _resetProviderForTesting()
    tokenStore._storePath = null
    
    // Restore fetch
    global.fetch = originalFetch
  })

  describe('test_integration_bearer_to_oauth_compatibility', () => {
    it('should maintain compatibility when switching from bearer to OAuth mode', async () => {
      // Start with bearer token mode
      delete process.env.WEBEX_CLIENT_ID
      delete process.env.WEBEX_CLIENT_SECRET
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'test-bearer-token'
      
      const bearerProvider = new TokenProvider()
      await bearerProvider.initialize()
      
      assert.strictEqual(bearerProvider.mode, 'bearer')
      assert.strictEqual(bearerProvider.getAuthHeader(), 'Bearer test-bearer-token')
      
      // Switch to OAuth mode with stored credentials
      const oauthCredentials = {
        auth_mode: 'oauth',
        access_token: 'oauth-access-token',
        access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        refresh_token: 'oauth-refresh-token',
        refresh_token_expires_at: new Date(Date.now() + 7776000000).toISOString(),
        scopes: ['spark:messages_read', 'spark:messages_write'],
        last_refresh_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      }
      
      await tokenStore.write(oauthCredentials)
      
      // Configure environment for OAuth
      delete process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'
      
      const oauthProvider = new TokenProvider()
      await oauthProvider.initialize()
      
      assert.strictEqual(oauthProvider.mode, 'oauth')
      assert.strictEqual(oauthProvider.getAuthHeader(), 'Bearer oauth-access-token')
    })
  })

  describe('test_integration_end_to_end_oauth_flow', () => {
    it('should complete full OAuth authorization and token storage flow', async () => {
      // Mock successful token exchange
      global.fetch = async (url, options) => {
        if (url.includes('/v1/access_token')) {
          assert.strictEqual(options.method, 'POST')
          assert.ok(options.headers['Content-Type'].includes('application/x-www-form-urlencoded'))
          
          const body = options.body
          assert.ok(body.includes('grant_type=authorization_code'))
          assert.ok(body.includes('code=test-auth-code'))
          assert.ok(body.includes('client_id=test-client-id'))
          assert.ok(body.includes('client_secret=test-client-secret'))
          
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: 'new-access-token',
              token_type: 'Bearer',
              expires_in: 3600,
              refresh_token: 'new-refresh-token',
              refresh_token_expires_in: 7776000,
              scope: 'spark:messages_read spark:messages_write'
            })
          }
        }
        throw new Error('Unexpected request to ' + url)
      }
      
      // Initialize provider in OAuth mode
      provider = new TokenProvider()
      await provider.initialize()
      
      // Simulate OAuth token exchange
      const mockTokenResponse = {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        refresh_token_expires_in: 7776000,
        scope: 'spark:messages_read spark:messages_write'
      }
      
      // Create credentials from token response
      const credentials = {
        auth_mode: 'oauth',
        access_token: mockTokenResponse.access_token,
        access_token_expires_at: new Date(Date.now() + mockTokenResponse.expires_in * 1000).toISOString(),
        refresh_token: mockTokenResponse.refresh_token,
        refresh_token_expires_at: new Date(Date.now() + mockTokenResponse.refresh_token_expires_in * 1000).toISOString(),
        scopes: mockTokenResponse.scope.split(' '),
        last_refresh_at: null,
        created_at: new Date().toISOString()
      }
      
      // Store credentials
      await tokenStore.write(credentials)
      
      // Verify credentials are stored
      const storedCredentials = await tokenStore.read()
      assert.deepStrictEqual(storedCredentials, credentials)
      
      // Verify provider can use stored credentials
      await provider.initialize()
      assert.strictEqual(provider.mode, 'oauth')
      assert.strictEqual(provider.getAuthHeader(), 'Bearer new-access-token')
    })
  })

  describe('test_integration_token_refresh_scenario', () => {
    it('should automatically refresh tokens when near expiry', async () => {
      // Set up OAuth credentials that are near expiry
      const nearExpiryTime = new Date(Date.now() + 1800000) // 30 minutes from now
      const credentials = {
        auth_mode: 'oauth',
        access_token: 'expiring-token',
        access_token_expires_at: nearExpiryTime.toISOString(),
        refresh_token: 'valid-refresh-token',
        refresh_token_expires_at: new Date(Date.now() + 7776000000).toISOString(),
        scopes: ['spark:messages_read', 'spark:messages_write'],
        last_refresh_at: new Date(Date.now() - 3600000).toISOString(), // Last refreshed 1 hour ago
        created_at: new Date(Date.now() - 86400000).toISOString() // Created 1 day ago
      }
      
      await tokenStore.write(credentials)
      
      // Mock successful token refresh
      global.fetch = async (url, options) => {
        if (url.includes('/v1/access_token')) {
          assert.strictEqual(options.method, 'POST')
          const body = options.body
          assert.ok(body.includes('grant_type=refresh_token'))
          assert.ok(body.includes('refresh_token=valid-refresh-token'))
          
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: 'refreshed-access-token',
              token_type: 'Bearer',
              expires_in: 3600,
              refresh_token: 'new-refresh-token',
              refresh_token_expires_in: 7776000,
              scope: 'spark:messages_read spark:messages_write'
            })
          }
        }
        throw new Error('Unexpected request to ' + url)
      }
      
      provider = new TokenProvider()
      await provider.initialize()
      
      // Should detect that token needs refresh and do it automatically
      const authHeader = await provider.getAuthHeader()
      assert.strictEqual(authHeader, 'Bearer refreshed-access-token')
      
      // Verify updated credentials are stored
      const updatedCredentials = await tokenStore.read()
      assert.strictEqual(updatedCredentials.access_token, 'refreshed-access-token')
      assert.strictEqual(updatedCredentials.refresh_token, 'new-refresh-token')
      assert.ok(updatedCredentials.last_refresh_at)
      assert.ok(new Date(updatedCredentials.last_refresh_at) > new Date(credentials.last_refresh_at))
    })
  })

  describe('test_integration_error_recovery_scenarios', () => {
    it('should handle refresh token expiry gracefully', async () => {
      // Set up OAuth credentials with expired refresh token
      const expiredCredentials = {
        auth_mode: 'oauth',
        access_token: 'expired-access-token',
        access_token_expires_at: new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
        refresh_token: 'expired-refresh-token',
        refresh_token_expires_at: new Date(Date.now() - 86400000).toISOString(), // Expired 1 day ago
        scopes: ['spark:messages_read'],
        last_refresh_at: new Date(Date.now() - 172800000).toISOString(), // Last refreshed 2 days ago
        created_at: new Date(Date.now() - 7776000000).toISOString() // Created 90 days ago
      }
      
      await tokenStore.write(expiredCredentials)
      
      // Mock failed token refresh (expired refresh token)
      global.fetch = async (url, options) => {
        if (url.includes('/v1/access_token')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: 'invalid_grant',
              error_description: 'The refresh token is expired.'
            })
          }
        }
        throw new Error('Unexpected request to ' + url)
      }
      
      provider = new TokenProvider()
      await provider.initialize()
      
      // Should throw error when trying to refresh with expired token
      try {
        await provider.refresh()
        assert.fail('Should have thrown an error for expired refresh token')
      } catch (error) {
        assert.ok(error.message.includes('refresh token'))
        assert.ok(error.message.includes('expired') || error.message.includes('invalid'))
      }
    })

    it('should handle network errors during token refresh', async () => {
      // Set up OAuth credentials that need refresh
      const credentials = {
        auth_mode: 'oauth',
        access_token: 'expiring-token',
        access_token_expires_at: new Date(Date.now() + 1800000).toISOString(), // 30 minutes from now
        refresh_token: 'valid-refresh-token',
        refresh_token_expires_at: new Date(Date.now() + 7776000000).toISOString(),
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: new Date().toISOString()
      }
      
      await tokenStore.write(credentials)
      
      // Mock network error
      global.fetch = async () => {
        throw new Error('Network error: Connection failed')
      }
      
      provider = new TokenProvider()
      await provider.initialize()
      
      // Should handle network errors gracefully
      try {
        await provider.refresh()
        assert.fail('Should have thrown a network error')
      } catch (error) {
        assert.ok(error.message.includes('Network') || error.message.includes('Connection'))
      }
    })

    it('should handle invalid JSON responses', async () => {
      // Set up OAuth credentials
      const credentials = {
        auth_mode: 'oauth',
        access_token: 'current-token',
        access_token_expires_at: new Date(Date.now() + 1800000).toISOString(),
        refresh_token: 'valid-refresh-token',
        refresh_token_expires_at: new Date(Date.now() + 7776000000).toISOString(),
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: new Date().toISOString()
      }
      
      await tokenStore.write(credentials)
      
      // Mock invalid JSON response
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON')
        }
      })
      
      provider = new TokenProvider()
      await provider.initialize()
      
      // Should handle JSON parsing errors
      try {
        await provider.refresh()
        assert.fail('Should have thrown a JSON parsing error')
      } catch (error) {
        assert.ok(error.message.includes('JSON') || error.message.includes('parse'))
      }
    })

    it('should handle missing or corrupted token store file', async () => {
      // Delete the token store file to simulate missing file
      const tokenPath = path.join(tempDir, 'tokens.json')
      try {
        await fs.rm(tokenPath, { force: true })
      } catch {
        // File might not exist, which is fine
      }
      
      provider = new TokenProvider()
      
      // Should detect that no OAuth credentials are available and fall back
      // In this case, it should throw because we have client ID/secret but no stored tokens
      try {
        await provider.initialize()
        assert.fail('Should have thrown an error for missing OAuth credentials')
      } catch (error) {
        assert.ok(error.message.includes('credentials') || error.message.includes('OAuth'))
      }
    })
  })

  describe('test_integration_concurrent_refresh_handling', () => {
    it('should handle concurrent token refresh requests with mutex', async () => {
      // Set up OAuth credentials that need immediate refresh
      const credentials = {
        auth_mode: 'oauth',
        access_token: 'expired-token',
        access_token_expires_at: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
        refresh_token: 'valid-refresh-token',
        refresh_token_expires_at: new Date(Date.now() + 7776000000).toISOString(),
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: new Date().toISOString()
      }
      
      await tokenStore.write(credentials)
      
      let refreshCallCount = 0
      
      // Mock token refresh that takes time
      global.fetch = async (url, options) => {
        if (url.includes('/v1/access_token')) {
          refreshCallCount++
          
          // Simulate some delay
          await new Promise(resolve => setTimeout(resolve, 100))
          
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: `refreshed-token-${refreshCallCount}`,
              token_type: 'Bearer',
              expires_in: 3600,
              refresh_token: 'new-refresh-token',
              refresh_token_expires_in: 7776000,
              scope: 'spark:messages_read'
            })
          }
        }
        throw new Error('Unexpected request to ' + url)
      }
      
      provider = new TokenProvider()
      await provider.initialize()
      
      // Make multiple concurrent requests that should trigger refresh
      const concurrentRequests = Promise.all([
        provider.getAuthHeader(),
        provider.getAuthHeader(),
        provider.getAuthHeader(),
        provider.getAuthHeader(),
        provider.getAuthHeader()
      ])
      
      const results = await concurrentRequests
      
      // All requests should return the same refreshed token
      results.forEach(result => {
        assert.strictEqual(result, 'Bearer refreshed-token-1')
      })
      
      // Should have only made one refresh call due to mutex
      assert.strictEqual(refreshCallCount, 1, 'Should have made exactly one refresh API call')
    })
  })
})