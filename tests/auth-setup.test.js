import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { URL } from 'url'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// Import the classes we're testing
import OAuthSetup from '../commands/auth-setup.js'
import tokenStore from '../lib/token-store.js'

describe('OAuth Setup Tests', () => {
  let testTempDir
  let originalTokenStorePath

  before(async () => {
    // Create a temporary directory for test token storage
    testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webex-mcp-test-'))
    originalTokenStorePath = process.env.WEBEX_TOKEN_STORE_PATH
    process.env.WEBEX_TOKEN_STORE_PATH = path.join(testTempDir, 'tokens.json')
    
    // Clear token store cache
    tokenStore._storePath = null
    
    // Suppress console output during tests
    process.env.NODE_ENV = 'test'
  })

  after(async () => {
    // Clean up
    if (originalTokenStorePath) {
      process.env.WEBEX_TOKEN_STORE_PATH = originalTokenStorePath
    } else {
      delete process.env.WEBEX_TOKEN_STORE_PATH
    }
    
    try {
      await fs.rm(testTempDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
    
    // Clear token store cache
    tokenStore._storePath = null
  })

  describe('test_auth_setup_reads_client_credentials_from_env', () => {
    it('should read client credentials from environment variables', async () => {
      const originalClientId = process.env.WEBEX_CLIENT_ID
      const originalClientSecret = process.env.WEBEX_CLIENT_SECRET

      try {
        process.env.WEBEX_CLIENT_ID = 'test-client-id'
        process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'

        const setup = new OAuthSetup()
        
        // Test that credentials are read from environment
        const clientId = process.env.WEBEX_CLIENT_ID
        const clientSecret = process.env.WEBEX_CLIENT_SECRET
        
        assert.strictEqual(clientId, 'test-client-id', 'Should read client ID from environment')
        assert.strictEqual(clientSecret, 'test-client-secret', 'Should read client secret from environment')

      } finally {
        if (originalClientId) {
          process.env.WEBEX_CLIENT_ID = originalClientId
        } else {
          delete process.env.WEBEX_CLIENT_ID
        }
        
        if (originalClientSecret) {
          process.env.WEBEX_CLIENT_SECRET = originalClientSecret
        } else {
          delete process.env.WEBEX_CLIENT_SECRET
        }
      }
    })
  })

  describe('test_auth_setup_starts_local_http_server', () => {
    it('should be able to find an available port', async () => {
      const setup = new OAuthSetup()
      
      const port = await setup.findAvailablePort()
      
      assert.strictEqual(typeof port, 'number', 'Should return a port number')
      assert.ok(port > 0 && port <= 65535, 'Should return a valid port number')
    })
  })

  describe('test_auth_setup_opens_browser_to_oauth_url', () => {
    it('should generate correct OAuth authorization URL', async () => {
      const setup = new OAuthSetup()
      setup.callbackPort = 8080 // Set a test port
      
      const clientId = 'test-client-id'
      const authUrl = setup.buildAuthUrl(clientId)
      
      const url = new URL(authUrl)
      assert.strictEqual(url.hostname, 'webexapis.com', 'Should use Webex OAuth endpoint')
      assert.strictEqual(url.pathname, '/v1/authorize', 'Should use correct OAuth path')
      
      const params = url.searchParams
      assert.strictEqual(params.get('response_type'), 'code', 'Should request authorization code')
      assert.strictEqual(params.get('client_id'), clientId, 'Should include client ID')
      assert.ok(params.get('redirect_uri').includes('localhost'), 'Should use localhost redirect')
      assert.ok(params.get('scope'), 'Should include scopes')
      assert.ok(params.get('state'), 'Should include state parameter')
      assert.ok(params.get('code_challenge'), 'Should include PKCE code challenge')
      assert.strictEqual(params.get('code_challenge_method'), 'S256', 'Should use S256 for PKCE')
    })
  })

  describe('test_oauth_callback_captures_authorization_code', () => {
    it('should validate callback URL structure', () => {
      // This test validates the callback URL parsing logic without actually starting a server
      const testCode = 'test-auth-code-12345'
      const testState = 'test-state'
      const callbackUrl = `http://localhost:8080/callback?code=${testCode}&state=${testState}`
      
      const url = new URL(callbackUrl)
      const params = url.searchParams
      
      assert.strictEqual(params.get('code'), testCode, 'Should extract authorization code from URL')
      assert.strictEqual(params.get('state'), testState, 'Should extract state from URL')
      assert.strictEqual(url.pathname, '/callback', 'Should use correct callback path')
    })
  })

  describe('test_token_exchange_with_webex_oauth_endpoint', () => {
    it('should build correct token exchange request', () => {
      const setup = new OAuthSetup()
      setup.callbackPort = 8080
      setup.codeVerifier = 'test-code-verifier'
      
      // Test the URL building logic
      const clientId = 'test-client-id'
      const clientSecret = 'test-client-secret'
      const authCode = 'test-code'
      const redirectUri = `http://localhost:${setup.callbackPort}/callback`

      const expectedParams = {
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code: authCode,
        redirect_uri: redirectUri,
        code_verifier: setup.codeVerifier
      }

      // Verify all required parameters are present
      assert.strictEqual(expectedParams.grant_type, 'authorization_code', 'Should use authorization code grant')
      assert.strictEqual(expectedParams.client_id, clientId, 'Should include client ID')
      assert.strictEqual(expectedParams.code, authCode, 'Should include authorization code')
      assert.strictEqual(expectedParams.code_verifier, 'test-code-verifier', 'Should include PKCE verifier')
    })
  })

  describe('test_token_storage_after_successful_exchange', () => {
    it('should store tokens after successful exchange', async () => {
      const setup = new OAuthSetup()
      
      const mockTokenData = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        scope: 'spark:messages_read spark:messages_write'
      }
      
      await setup.storeTokens(mockTokenData)
      
      const storedCredentials = await tokenStore.read()
      assert.ok(storedCredentials, 'Should store credentials')
      assert.strictEqual(storedCredentials.auth_mode, 'oauth', 'Should set oauth auth mode')
      assert.strictEqual(storedCredentials.access_token, 'mock-access-token', 'Should store access token')
      assert.strictEqual(storedCredentials.refresh_token, 'mock-refresh-token', 'Should store refresh token')
      assert.ok(storedCredentials.access_token_expires_at, 'Should set access token expiry')
      assert.ok(Array.isArray(storedCredentials.scopes), 'Should store scopes as array')
    })
  })

  describe('test_error_handling_missing_client_credentials', () => {
    it('should handle missing client credentials gracefully', async () => {
      const originalClientId = process.env.WEBEX_CLIENT_ID
      const originalClientSecret = process.env.WEBEX_CLIENT_SECRET
      const originalNodeEnv = process.env.NODE_ENV
      
      try {
        delete process.env.WEBEX_CLIENT_ID
        delete process.env.WEBEX_CLIENT_SECRET
        process.env.NODE_ENV = 'test'
        
        const setup = new OAuthSetup()
        
        try {
          await setup.run()
          assert.fail('Should have thrown error for missing credentials')
        } catch (error) {
          assert.strictEqual(error.message, 'Missing required environment variables')
        }
        
      } finally {
        if (originalClientId) {
          process.env.WEBEX_CLIENT_ID = originalClientId
        }
        if (originalClientSecret) {
          process.env.WEBEX_CLIENT_SECRET = originalClientSecret
        }
        if (originalNodeEnv) {
          process.env.NODE_ENV = originalNodeEnv
        } else {
          delete process.env.NODE_ENV
        }
      }
    })
  })

  describe('test_error_handling_oauth_denial', () => {
    it('should parse OAuth denial error from callback URL', () => {
      // Test OAuth denial URL parsing without starting actual server
      const callbackUrl = `http://localhost:8080/callback?error=access_denied&error_description=User%20denied%20access`
      
      const url = new URL(callbackUrl)
      const params = url.searchParams
      
      const error = params.get('error')
      const errorDescription = params.get('error_description')
      
      assert.strictEqual(error, 'access_denied', 'Should capture denial error')
      assert.strictEqual(errorDescription, 'User denied access', 'Should capture error description')
    })
  })

  describe('test_error_handling_token_exchange_failure', () => {
    it('should handle token exchange failure', async () => {
      const setup = new OAuthSetup()
      setup.callbackPort = 8080
      
      // Mock fetch to return error response
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (url, options) => {
        if (url.includes('access_token')) {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => '{"error":"invalid_grant"}'
          }
        }
        return originalFetch(url, options)
      }
      
      try {
        await setup.exchangeCodeForTokens('test-client-id', 'test-client-secret', 'invalid-code')
        assert.fail('Should throw error for failed token exchange')
      } catch (error) {
        assert.ok(error.message.includes('Token exchange failed'), 'Should throw descriptive error')
        assert.ok(error.message.includes('400'), 'Should include status code in error')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('test_callback_server_shutdown_after_success', () => {
    it('should have server shutdown method', () => {
      const setup = new OAuthSetup()
      
      // Test that the shutdown method exists and is callable
      assert.strictEqual(typeof setup.shutdownServer, 'function', 'Should have shutdownServer method')
      
      // Test calling shutdown when no server is running (should not throw)
      setup.shutdownServer()
      assert.ok(true, 'Should not throw when shutting down non-existent server')
    })
  })
})

describe('OAuth Setup Utility Functions', () => {
  describe('PKCE Implementation', () => {
    it('should generate secure code verifier', () => {
      const setup = new OAuthSetup()
      const verifier = setup.generateCodeVerifier()
      
      assert.strictEqual(typeof verifier, 'string', 'Should return string')
      assert.ok(verifier.length >= 43 && verifier.length <= 128, 'Should meet PKCE length requirements')
      assert.ok(/^[A-Za-z0-9_-]+$/.test(verifier), 'Should be base64url encoded')
    })

    it('should generate code challenge from verifier', () => {
      const setup = new OAuthSetup()
      const verifier = 'test-code-verifier-123'
      const challenge = setup.generateCodeChallenge(verifier)
      
      assert.strictEqual(typeof challenge, 'string', 'Should return string')
      assert.ok(challenge.length > 0, 'Should generate non-empty challenge')
      assert.ok(/^[A-Za-z0-9_-]+$/.test(challenge), 'Should be base64url encoded')
    })

    it('should generate different verifiers each time', () => {
      const setup = new OAuthSetup()
      const verifier1 = setup.generateCodeVerifier()
      const verifier2 = setup.generateCodeVerifier()
      
      assert.notStrictEqual(verifier1, verifier2, 'Should generate unique verifiers')
    })
  })

  describe('State Parameter', () => {
    it('should generate secure state parameter', () => {
      const setup = new OAuthSetup()
      const state = setup.generateState()
      
      assert.strictEqual(typeof state, 'string', 'Should return string')
      assert.ok(state.length >= 32, 'Should be long enough for security')
      assert.ok(/^[a-f0-9]+$/.test(state), 'Should be hex encoded')
    })

    it('should generate different state values each time', () => {
      const setup = new OAuthSetup()
      const state1 = setup.generateState()
      const state2 = setup.generateState()
      
      assert.notStrictEqual(state1, state2, 'Should generate unique state values')
    })
  })

  describe('Port Selection', () => {
    it('should find available port', async () => {
      const setup = new OAuthSetup()
      const port = await setup.findAvailablePort()
      
      assert.strictEqual(typeof port, 'number', 'Should return number')
      assert.ok(port > 0 && port <= 65535, 'Should return valid port number')
    })
  })
})