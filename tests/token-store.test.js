import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { read, write, getStorePath, exists } from '../lib/token-store.js';

describe('Token Store Module', () => {
  let originalEnv;
  let testDir;
  let testFilePath;

  beforeEach(async () => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Create a temporary directory for testing
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-store-test-'));
    testFilePath = path.join(testDir, 'test-tokens.json');
    
    // Set test environment variable
    process.env.WEBEX_TOKEN_STORE_PATH = testFilePath;
  });

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv;
    
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('getStorePath', () => {
    it('should use environment variable override when set', () => {
      const customPath = '/custom/path/tokens.json';
      process.env.WEBEX_TOKEN_STORE_PATH = customPath;
      const storePath = getStorePath();
      assert.strictEqual(storePath, path.resolve(customPath));
    });

    it('should default to home directory when env var not set', () => {
      delete process.env.WEBEX_TOKEN_STORE_PATH;
      const storePath = getStorePath();
      const expectedPath = path.join(os.homedir(), '.webex-mcp', 'tokens.json');
      assert.strictEqual(storePath, expectedPath);
    });
  });

  describe('read', () => {
    it('should return null for nonexistent file', async () => {
      const result = await read();
      assert.strictEqual(result, null);
    });

    it('should return parsed credentials from existing file', async () => {
      const testCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-access-token',
        access_token_expires_at: '2024-01-01T00:00:00.000Z',
        refresh_token: 'test-refresh-token',
        refresh_token_expires_at: '2024-02-01T00:00:00.000Z',
        scopes: ['spark:messages_read', 'spark:rooms_read'],
        last_refresh_at: null,
        created_at: '2023-12-01T00:00:00.000Z'
      };

      // Create parent directory
      await fs.mkdir(path.dirname(testFilePath), { recursive: true });
      
      // Write test data
      await fs.writeFile(testFilePath, JSON.stringify(testCredentials));

      const result = await read();
      assert.deepStrictEqual(result, testCredentials);
    });
  });

  describe('write', () => {
    it('should create directory if missing', async () => {
      const testCredentials = {
        auth_mode: 'oauth',
        access_token: 'test-token',
        access_token_expires_at: '2024-01-01T00:00:00.000Z',
        refresh_token: 'test-refresh',
        refresh_token_expires_at: '2024-02-01T00:00:00.000Z',
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2023-12-01T00:00:00.000Z'
      };

      await write(testCredentials);

      // Verify file exists
      const fileExists = await exists();
      assert.strictEqual(fileExists, true);

      // Verify contents
      const result = await read();
      assert.deepStrictEqual(result, testCredentials);
    });

    it('should set 600 permissions on created file', async () => {
      const testCredentials = {
        auth_mode: 'bearer',
        access_token: 'test-token',
        access_token_expires_at: '2024-01-01T00:00:00.000Z',
        refresh_token: null,
        refresh_token_expires_at: null,
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2023-12-01T00:00:00.000Z'
      };

      await write(testCredentials);

      // Check file permissions (0o600 = 384 in decimal)
      const stats = await fs.stat(testFilePath);
      const permissions = stats.mode & 0o777;
      assert.strictEqual(permissions, 0o600);
    });

    it('should overwrite existing file', async () => {
      const originalCredentials = {
        auth_mode: 'oauth',
        access_token: 'original-token',
        access_token_expires_at: '2024-01-01T00:00:00.000Z',
        refresh_token: 'original-refresh',
        refresh_token_expires_at: '2024-02-01T00:00:00.000Z',
        scopes: ['spark:messages_read'],
        last_refresh_at: null,
        created_at: '2023-12-01T00:00:00.000Z'
      };

      const updatedCredentials = {
        auth_mode: 'oauth',
        access_token: 'updated-token',
        access_token_expires_at: '2024-01-02T00:00:00.000Z',
        refresh_token: 'updated-refresh',
        refresh_token_expires_at: '2024-02-02T00:00:00.000Z',
        scopes: ['spark:messages_read', 'spark:rooms_read'],
        last_refresh_at: '2024-01-01T12:00:00.000Z',
        created_at: '2023-12-01T00:00:00.000Z'
      };

      // Write original
      await write(originalCredentials);
      let result = await read();
      assert.deepStrictEqual(result, originalCredentials);

      // Write updated
      await write(updatedCredentials);
      result = await read();
      assert.deepStrictEqual(result, updatedCredentials);
    });
  });

  describe('exists', () => {
    it('should return false for missing file', async () => {
      const fileExists = await exists();
      assert.strictEqual(fileExists, false);
    });

    it('should return true for existing file', async () => {
      const testCredentials = {
        auth_mode: 'bot',
        access_token: 'bot-token',
        access_token_expires_at: null,
        refresh_token: null,
        refresh_token_expires_at: null,
        scopes: ['spark:messages_write'],
        last_refresh_at: null,
        created_at: '2023-12-01T00:00:00.000Z'
      };

      await write(testCredentials);
      
      const fileExists = await exists();
      assert.strictEqual(fileExists, true);
    });
  });
});