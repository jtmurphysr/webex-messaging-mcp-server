import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// Import modules to test
import showAuthStatus from '../../commands/auth-status.js'
import tokenProvider from '../../lib/token-provider.js'
import tokenStore from '../../lib/token-store.js'

describe('auth-status command', () => {
  let originalEnv
  let testTokenDir
  
  beforeEach(async () => {
    // Save original environment
    originalEnv = { ...process.env }
    
    // Set test mode to avoid process.exit calls
    process.env.NODE_ENV = 'test'
    
    // Create temporary directory for token files
    testTokenDir = path.join(os.tmpdir(), 'webex-mcp-test-' + Math.random().toString(36).substr(2, 9))
    await fs.mkdir(testTokenDir, { recursive: true })
    
    // Set test token directory
    process.env.WEBEX_TOKEN_STORE_PATH = path.join(testTokenDir, 'tokens.json')
    
    // Clear auth env vars
    delete process.env.WEBEX_CLIENT_ID
    delete process.env.WEBEX_CLIENT_SECRET
    delete process.env.WEBEX_BOT_TOKEN
    delete process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY
    
    // Reset token store and provider state
    tokenStore._storePath = null
    tokenProvider.mode = null
    tokenProvider.currentToken = null
    tokenProvider.expiresAt = null
    tokenProvider.isRefreshing = false
    tokenProvider.refreshPromise = null
    tokenProvider.lastRefreshAt = null
  })
  
  afterEach(async () => {
    // Restore environment
    process.env = originalEnv
    
    // Reset token store and provider state
    tokenStore._storePath = null
    tokenProvider.mode = null
    tokenProvider.currentToken = null
    tokenProvider.expiresAt = null
    tokenProvider.isRefreshing = false
    tokenProvider.refreshPromise = null
    tokenProvider.lastRefreshAt = null
    
    // Clean up test directory
    try {
      await fs.rm(testTokenDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  describe('OAuth mode', () => {
    beforeEach(() => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'
    })

    it('displays OAuth mode info with valid credentials', async () => {
      const now = new Date()
      const accessTokenExpiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) // 14 days
      const refreshTokenExpiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000) // 90 days
      const lastRefresh = new Date(now.getTime() - 2 * 60 * 60 * 1000) // 2 hours ago
      
      const credentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token-12345',
        access_token_expires_at: accessTokenExpiry.toISOString(),
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: refreshTokenExpiry.toISOString(),
        scopes: ['spark:messages_read', 'spark:rooms_read', 'spark:memberships_read'],
        last_refresh_at: lastRefresh.toISOString(),
        created_at: now.toISOString()
      }
      
      await fs.writeFile(process.env.WEBEX_TOKEN_STORE_PATH, JSON.stringify(credentials, null, 2))
      
      const logs = []
      const originalLog = console.log
      console.log = (...args) => logs.push(args.join(' '))
      
      try {
        await showAuthStatus()
      } finally {
        console.log = originalLog
      }
      
      const output = logs.join('\n')
      
      assert(output.includes('Auth Mode: oauth'))
      assert(output.includes('Token Type: Integration'))
      assert(output.includes('Expires At: ' + accessTokenExpiry.toISOString()))
      assert(output.includes('in 13 day')) // Should show "in 13 days" or similar
      assert(output.includes('Refresh Token Expires: ' + refreshTokenExpiry.toISOString()))
      assert(output.includes('Scopes: spark:messages_read, spark:rooms_read, spark:memberships_read'))
      assert(output.includes('Last Refreshed: ' + lastRefresh.toISOString()))
      assert(output.includes('Status: Active'))
    })

    it('shows time until expiry in different formats', async () => {
      const testCases = [
        { offset: 2 * 60 * 60 * 1000 + 30000, expected: 'in 2 hours' },
        { offset: 25 * 60 * 60 * 1000 + 30000, expected: 'in 1 day, 1 hour' },
        { offset: 30 * 60 * 1000 + 30000, expected: 'in 30 minutes' },
        { offset: -1000, expected: 'expired' },
      ]
      
      for (const testCase of testCases) {
        const now = new Date()
        const expiryTime = new Date(now.getTime() + testCase.offset)
        
        const credentials = {
          auth_mode: 'oauth',
          access_token: 'test-token',
          access_token_expires_at: expiryTime.toISOString(),
          refresh_token: 'refresh-token',
          scopes: ['spark:messages_read'],
          created_at: now.toISOString()
        }
        
        await fs.writeFile(process.env.WEBEX_TOKEN_STORE_PATH, JSON.stringify(credentials))
        
        // Reset provider between iterations
        tokenProvider.mode = null
        tokenProvider.currentToken = null
        tokenProvider.expiresAt = null
        tokenStore._storePath = null
        
        const logs = []
        const originalLog = console.log
        console.log = (...args) => logs.push(args.join(' '))
        
        try {
          await showAuthStatus()
        } finally {
          console.log = originalLog
        }
        
        const output = logs.join('\n')
        assert(output.includes(testCase.expected), `Expected "${testCase.expected}" in output: ${output}`)
      }
    })

    it('warns when refresh token is near expiry', async () => {
      const now = new Date()
      const accessTokenExpiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
      const refreshTokenExpiry = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000) // 20 days (within 30 day warning)
      
      const credentials = {
        auth_mode: 'oauth',
        access_token: 'test-token',
        access_token_expires_at: accessTokenExpiry.toISOString(),
        refresh_token: 'refresh-token',
        refresh_token_expires_at: refreshTokenExpiry.toISOString(),
        scopes: ['spark:messages_read'],
        created_at: now.toISOString()
      }
      
      await fs.writeFile(process.env.WEBEX_TOKEN_STORE_PATH, JSON.stringify(credentials))
      
      const logs = []
      const originalLog = console.log
      console.log = (...args) => logs.push(args.join(' '))
      
      try {
        await showAuthStatus()
      } finally {
        console.log = originalLog
      }
      
      const output = logs.join('\n')
      assert(output.includes('⚠️  WARNING: Refresh token expiry cliff'))
      assert(output.includes('expires within 30 days'))
    })

    it('handles no credentials file', async () => {
      const logs = []
      const originalLog = console.log
      console.log = (...args) => logs.push(args.join(' '))
      
      try {
        await showAuthStatus()
        assert.fail('Should have thrown for missing credentials file')
      } catch (error) {
        // Expected: auth-status throws in test mode
        assert.strictEqual(error.message, 'Auth status check failed')
      } finally {
        console.log = originalLog
      }
      
      const output = logs.join('\n')
      assert(output.includes('Auth Mode: oauth (configured)'))
      assert(output.includes('Status: No credentials file'))
      assert(output.includes('⚠️  WARNING: OAuth configured but not set up'))
    })

    it('handles corrupted credentials file', async () => {
      // Write invalid JSON
      await fs.writeFile(process.env.WEBEX_TOKEN_STORE_PATH, 'invalid json content')
      
      const logs = []
      const originalLog = console.log
      console.log = (...args) => logs.push(args.join(' '))
      
      try {
        await showAuthStatus()
        assert.fail('Should have thrown for corrupted credentials')
      } catch (error) {
        assert.strictEqual(error.message, 'Auth status check failed')
      } finally {
        console.log = originalLog
      }
      
      const output = logs.join('\n')
      assert(output.includes('Auth Mode: oauth (configured)'))
      assert(output.includes('Status: Corrupted credentials'))
      assert(output.includes('⚠️  WARNING: Corrupted credentials file'))
    })
  })

  describe('Bearer mode', () => {
    it('displays bearer mode info', async () => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'Bearer test-bearer-token'
      
      const logs = []
      const originalLog = console.log
      console.log = (...args) => logs.push(args.join(' '))
      
      try {
        await showAuthStatus()
      } finally {
        console.log = originalLog
      }
      
      const output = logs.join('\n')
      
      assert(output.includes('Auth Mode: bearer'))
      assert(output.includes('Token Type: Bearer'))
      assert(output.includes('Expires At: ~12 hours from token creation'))
      assert(output.includes('Refresh Token Expires: N/A'))
      assert(output.includes('Scopes: Determined by token creator'))
      assert(output.includes('Status: Unknown'))
      assert(output.includes('⚠️  WARNING: Token security — Bearer tokens expire in 12 hours'))
    })
  })

  describe('Bot mode', () => {
    it('displays bot mode info', async () => {
      process.env.WEBEX_BOT_TOKEN = 'test-bot-token'
      
      const logs = []
      const originalLog = console.log
      console.log = (...args) => logs.push(args.join(' '))
      
      try {
        await showAuthStatus()
      } finally {
        console.log = originalLog
      }
      
      const output = logs.join('\n')
      
      assert(output.includes('Auth Mode: bot'))
      assert(output.includes('Token Type: Bot'))
      assert(output.includes('Expires At: Never'))
      assert(output.includes('Refresh Token Expires: N/A'))
      assert(output.includes('Scopes: Bot permissions only'))
      assert(output.includes('Status: Active'))
    })
  })

  describe('No credentials', () => {
    it('handles no credentials configured', async () => {
      const logs = []
      const originalLog = console.log
      console.log = (...args) => logs.push(args.join(' '))
      
      try {
        await showAuthStatus()
        assert.fail('Should have thrown for no credentials')
      } catch (error) {
        assert.strictEqual(error.message, 'Auth status check failed')
      } finally {
        console.log = originalLog
      }
      
      const output = logs.join('\n')
      assert(output.includes('Auth Mode: none'))
      assert(output.includes('Status: No credentials configured'))
      assert(output.includes('⚠️  WARNING: No authentication configured'))
      assert(output.includes('Set WEBEX_CLIENT_ID+WEBEX_CLIENT_SECRET'))
    })
  })

  describe('Sensitive token masking', () => {
    it('masks sensitive tokens in output', async () => {
      process.env.WEBEX_CLIENT_ID = 'test-client-id'
      process.env.WEBEX_CLIENT_SECRET = 'test-client-secret'
      
      const now = new Date()
      const credentials = {
        auth_mode: 'oauth',
        access_token: 'very-sensitive-access-token-12345',
        access_token_expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        refresh_token: 'very-sensitive-refresh-token-67890',
        scopes: ['spark:messages_read'],
        created_at: now.toISOString()
      }
      
      await fs.writeFile(process.env.WEBEX_TOKEN_STORE_PATH, JSON.stringify(credentials))
      
      const logs = []
      const originalLog = console.log
      console.log = (...args) => logs.push(args.join(' '))
      
      try {
        await showAuthStatus()
      } finally {
        console.log = originalLog
      }
      
      const output = logs.join('\n')
      
      // Ensure full tokens are never displayed
      assert(!output.includes('very-sensitive-access-token-12345'))
      assert(!output.includes('very-sensitive-refresh-token-67890'))
      
      // Ensure security warning is present
      assert(output.includes('⚠️  WARNING: Token security'))
      assert(output.includes('never logged in full'))
      assert(output.includes('first 8 characters'))
    })
  })
})
