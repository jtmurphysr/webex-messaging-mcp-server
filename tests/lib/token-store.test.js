import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import tokenStore from '../../lib/token-store.js'

describe('token-store', () => {
  let tempDir
  let originalEnv
  
  beforeEach(async () => {
    // Save original env
    originalEnv = process.env.WEBEX_TOKEN_STORE_PATH
    
    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-store-test-'))
    
    // Reset the token store's cached path
    tokenStore._storePath = null
  })
  
  afterEach(async () => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.WEBEX_TOKEN_STORE_PATH = originalEnv
    } else {
      delete process.env.WEBEX_TOKEN_STORE_PATH
    }
    
    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
    
    // Reset the token store's cached path
    tokenStore._storePath = null
  })

  describe('read()', () => {
    it('test_read_nonexistent_file_returns_null', async () => {
      const testPath = path.join(tempDir, 'nonexistent', 'tokens.json')
      process.env.WEBEX_TOKEN_STORE_PATH = testPath
      
      const result = await tokenStore.read()
      assert.strictEqual(result, null)
    })

    it('test_read_returns_parsed_credentials', async () => {
      const testPath = path.join(tempDir, 'tokens.json')
      process.env.WEBEX_TOKEN_STORE_PATH = testPath
      
      const testCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: '2026-03-10T17:00:00Z',
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:messages_read', 'spark:messages_write'],
        last_refresh_at: '2026-03-09T17:00:00Z',
        created_at: '2026-03-09T16:00:00Z'
      }
      
      // Create the file manually
      await fs.mkdir(path.dirname(testPath), { recursive: true })
      await fs.writeFile(testPath, JSON.stringify(testCredentials), 'utf8')
      
      const result = await tokenStore.read()
      assert.deepStrictEqual(result, testCredentials)
    })
  })

  describe('write()', () => {
    it('test_write_creates_directory_if_missing', async () => {
      const testPath = path.join(tempDir, 'new-dir', 'subdir', 'tokens.json')
      process.env.WEBEX_TOKEN_STORE_PATH = testPath
      
      const testCredentials = {
        auth_mode: 'bearer',
        access_token: 'test-token',
        access_token_expires_at: '2026-03-10T05:00:00Z',
        refresh_token: null,
        refresh_token_expires_at: null,
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      
      await tokenStore.write(testCredentials)
      
      // Check that directory was created
      const dirExists = await fs.access(path.dirname(testPath)).then(() => true).catch(() => false)
      assert.strictEqual(dirExists, true)
      
      // Check that file was created
      const fileExists = await tokenStore.exists()
      assert.strictEqual(fileExists, true)
      
      // Verify directory permissions (0700)
      const dirStats = await fs.stat(path.dirname(testPath))
      assert.strictEqual(dirStats.mode & 0o777, 0o700)
    })

    it('test_write_sets_600_permissions', async () => {
      const testPath = path.join(tempDir, 'tokens.json')
      process.env.WEBEX_TOKEN_STORE_PATH = testPath
      
      const testCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: '2026-03-10T17:00:00Z',
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:all'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      
      await tokenStore.write(testCredentials)
      
      const stats = await fs.stat(testPath)
      assert.strictEqual(stats.mode & 0o777, 0o600)
    })

    it('test_write_overwrites_existing_file', async () => {
      const testPath = path.join(tempDir, 'tokens.json')
      process.env.WEBEX_TOKEN_STORE_PATH = testPath
      
      const originalCredentials = {
        auth_mode: 'bearer',
        access_token: 'old-token',
        access_token_expires_at: '2026-03-09T17:00:00Z',
        refresh_token: null,
        refresh_token_expires_at: null,
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T16:00:00Z'
      }
      
      const newCredentials = {
        auth_mode: 'oauth',
        access_token: 'new-access-token',
        access_token_expires_at: '2026-03-10T17:00:00Z',
        refresh_token: 'new-refresh-token',
        refresh_token_expires_at: '2026-06-07T17:00:00Z',
        scopes: ['spark:messages_read', 'spark:messages_write'],
        last_refresh_at: '2026-03-09T17:00:00Z',
        created_at: '2026-03-09T17:00:00Z'
      }
      
      // Write original file
      await tokenStore.write(originalCredentials)
      
      // Overwrite with new credentials
      await tokenStore.write(newCredentials)
      
      // Verify the file contains new credentials
      const result = await tokenStore.read()
      assert.deepStrictEqual(result, newCredentials)
    })
  })

  describe('getStorePath()', () => {
    it('test_get_store_path_uses_env_var_override', async () => {
      const customPath = path.join(tempDir, 'custom-tokens.json')
      process.env.WEBEX_TOKEN_STORE_PATH = customPath
      
      const result = tokenStore.getStorePath()
      assert.strictEqual(result, path.resolve(customPath))
    })

    it('test_get_store_path_defaults_to_home_webex_mcp', async () => {
      delete process.env.WEBEX_TOKEN_STORE_PATH
      
      const result = tokenStore.getStorePath()
      const expected = path.join(os.homedir(), '.webex-mcp', 'tokens.json')
      assert.strictEqual(result, expected)
    })
  })

  describe('exists()', () => {
    it('test_exists_returns_false_for_missing_file', async () => {
      const testPath = path.join(tempDir, 'nonexistent.json')
      process.env.WEBEX_TOKEN_STORE_PATH = testPath
      
      const result = await tokenStore.exists()
      assert.strictEqual(result, false)
    })

    it('test_exists_returns_true_for_existing_file', async () => {
      const testPath = path.join(tempDir, 'tokens.json')
      process.env.WEBEX_TOKEN_STORE_PATH = testPath
      
      const testCredentials = {
        auth_mode: 'bot',
        access_token: 'bot-token',
        access_token_expires_at: null,
        refresh_token: null,
        refresh_token_expires_at: null,
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2026-03-09T17:00:00Z'
      }
      
      await tokenStore.write(testCredentials)
      
      const result = await tokenStore.exists()
      assert.strictEqual(result, true)
    })
  })
})