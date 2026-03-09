import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { 
  getWebexBaseUrl, 
  getWebexToken, 
  getWebexHeaders, 
  getWebexJsonHeaders, 
  getWebexUrl,
  validateWebexConfig,
  getBaseUrl,
  getHeaders,
  _resetProviderForTesting
} from '../../lib/webex-config.js';
import tokenProvider from '../../lib/token-provider.js';

describe('Webex Configuration Module', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getWebexBaseUrl', () => {
    it('should return default base URL when env var is not set', () => {
      delete process.env.WEBEX_API_BASE_URL;
      const baseUrl = getWebexBaseUrl();
      assert.strictEqual(baseUrl, 'https://webexapis.com/v1');
    });

    it('should return custom base URL when env var is set', () => {
      process.env.WEBEX_API_BASE_URL = 'https://custom.webex.com/v2';
      const baseUrl = getWebexBaseUrl();
      assert.strictEqual(baseUrl, 'https://custom.webex.com/v2');
    });
  });

  describe('getWebexToken', () => {
    it('should return token without Bearer prefix', () => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'test-token-123';
      const token = getWebexToken();
      assert.strictEqual(token, 'test-token-123');
    });

    it('should remove Bearer prefix if present', () => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'Bearer test-token-123';
      const token = getWebexToken();
      assert.strictEqual(token, 'test-token-123');
    });

    it('should remove Bearer prefix with extra spaces', () => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'Bearer   test-token-123';
      const token = getWebexToken();
      assert.strictEqual(token, 'test-token-123');
    });

    it('should throw error when token is not set', () => {
      delete process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY;
      assert.throws(() => {
        getWebexToken();
      }, /WEBEX_PUBLIC_WORKSPACE_API_KEY environment variable is not set/);
    });
  });

  describe('getWebexHeaders', () => {
    beforeEach(() => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'test-token-123';
    });

    it('should return standard headers with Authorization', () => {
      const headers = getWebexHeaders();
      assert.deepStrictEqual(headers, {
        'Accept': 'application/json',
        'Authorization': 'Bearer test-token-123'
      });
    });

    it('should merge additional headers', () => {
      const headers = getWebexHeaders({ 'Custom-Header': 'custom-value' });
      assert.deepStrictEqual(headers, {
        'Accept': 'application/json',
        'Authorization': 'Bearer test-token-123',
        'Custom-Header': 'custom-value'
      });
    });

    it('should allow overriding default headers', () => {
      const headers = getWebexHeaders({ 'Accept': 'text/plain' });
      assert.deepStrictEqual(headers, {
        'Accept': 'text/plain',
        'Authorization': 'Bearer test-token-123'
      });
    });
  });

  describe('getWebexJsonHeaders', () => {
    beforeEach(() => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'test-token-123';
    });

    it('should return JSON headers with Content-Type', () => {
      const headers = getWebexJsonHeaders();
      assert.deepStrictEqual(headers, {
        'Accept': 'application/json',
        'Authorization': 'Bearer test-token-123',
        'Content-Type': 'application/json'
      });
    });

    it('should merge additional headers with JSON headers', () => {
      const headers = getWebexJsonHeaders({ 'X-Custom': 'value' });
      assert.deepStrictEqual(headers, {
        'Accept': 'application/json',
        'Authorization': 'Bearer test-token-123',
        'Content-Type': 'application/json',
        'X-Custom': 'value'
      });
    });
  });

  describe('getWebexUrl', () => {
    beforeEach(() => {
      process.env.WEBEX_API_BASE_URL = 'https://webexapis.com/v1';
    });

    it('should construct URL with leading slash', () => {
      const url = getWebexUrl('/messages');
      assert.strictEqual(url, 'https://webexapis.com/v1/messages');
    });

    it('should construct URL without leading slash', () => {
      const url = getWebexUrl('messages');
      assert.strictEqual(url, 'https://webexapis.com/v1/messages');
    });

    it('should handle complex endpoints', () => {
      const url = getWebexUrl('/rooms/123/messages');
      assert.strictEqual(url, 'https://webexapis.com/v1/rooms/123/messages');
    });

    it('should work with custom base URL', () => {
      process.env.WEBEX_API_BASE_URL = 'https://custom.api.com/v2';
      const url = getWebexUrl('/test');
      assert.strictEqual(url, 'https://custom.api.com/v2/test');
    });
  });

  describe('validateWebexConfig', () => {
    it('should not throw when all required vars are set', () => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'test-token';
      assert.doesNotThrow(() => {
        validateWebexConfig();
      });
    });

    it('should throw when required var is missing', () => {
      delete process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY;
      assert.throws(() => {
        validateWebexConfig();
      }, /No authentication credentials found/);
    });

    it('should throw when required var is empty string', () => {
      process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = '';
      assert.throws(() => {
        validateWebexConfig();
      }, /No authentication credentials found/);
    });
  });

  // NEW TESTS FOR TOKENPROVIDER INTEGRATION
  describe('TokenProvider Integration Tests', () => {
    beforeEach(() => {
      // Reset provider state for clean test isolation
      _resetProviderForTesting();
    });

    describe('getHeaders interface contract', () => {
      it('test_get_headers_delegates_to_token_provider', () => {
        process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'contract-test-token';
        delete process.env.WEBEX_CLIENT_ID;
        delete process.env.WEBEX_CLIENT_SECRET;
        delete process.env.WEBEX_BOT_TOKEN;

        const headers = getHeaders();
        assert.deepStrictEqual(headers, {
          'Accept': 'application/json',
          'Authorization': 'Bearer contract-test-token'
        });
      });

      it('test_get_headers_maintains_existing_format', () => {
        process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'format-test-token';
        delete process.env.WEBEX_CLIENT_ID;
        delete process.env.WEBEX_CLIENT_SECRET;
        delete process.env.WEBEX_BOT_TOKEN;

        const headers = getHeaders({ 'Custom': 'value' });
        
        // Should maintain the exact same format as before
        assert.ok(typeof headers === 'object');
        assert.strictEqual(headers['Accept'], 'application/json');
        assert.strictEqual(headers['Authorization'], 'Bearer format-test-token');
        assert.strictEqual(headers['Custom'], 'value');
      });

      it('test_get_headers_handles_bearer_mode_unchanged', () => {
        process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'bearer-unchanged-token';
        delete process.env.WEBEX_CLIENT_ID;
        delete process.env.WEBEX_CLIENT_SECRET;
        delete process.env.WEBEX_BOT_TOKEN;

        const headers = getHeaders();
        assert.strictEqual(headers['Authorization'], 'Bearer bearer-unchanged-token');
      });

      it('test_get_headers_handles_bot_mode', () => {
        process.env.WEBEX_BOT_TOKEN = 'bot-test-token-123';
        delete process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY;
        delete process.env.WEBEX_CLIENT_ID;
        delete process.env.WEBEX_CLIENT_SECRET;

        const headers = getHeaders();
        assert.strictEqual(headers['Authorization'], 'Bearer bot-test-token-123');
      });
    });

    describe('getBaseUrl interface contract', () => {
      it('should maintain same behavior as getWebexBaseUrl', () => {
        delete process.env.WEBEX_API_BASE_URL;
        assert.strictEqual(getBaseUrl(), getWebexBaseUrl());
        assert.strictEqual(getBaseUrl(), 'https://webexapis.com/v1');

        process.env.WEBEX_API_BASE_URL = 'https://custom.test.com/v3';
        assert.strictEqual(getBaseUrl(), getWebexBaseUrl());
        assert.strictEqual(getBaseUrl(), 'https://custom.test.com/v3');
      });
    });

    describe('test_backwards_compatibility_with_existing_tools', () => {
      it('should work with existing getWebexHeaders pattern', () => {
        process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'compat-test-token';
        delete process.env.WEBEX_CLIENT_ID;
        delete process.env.WEBEX_CLIENT_SECRET;
        delete process.env.WEBEX_BOT_TOKEN;

        // Existing tools call getWebexHeaders
        const legacyHeaders = getWebexHeaders();
        // New interface provides getHeaders
        const newHeaders = getHeaders();
        
        assert.deepStrictEqual(legacyHeaders, newHeaders);
      });
    });

    describe('test_token_provider_initialization_on_first_call', () => {
      it('should initialize provider on first getHeaders call', () => {
        process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY = 'init-test-token';
        delete process.env.WEBEX_CLIENT_ID;
        delete process.env.WEBEX_CLIENT_SECRET;
        delete process.env.WEBEX_BOT_TOKEN;

        // Provider should be uninitialized
        assert.strictEqual(tokenProvider.getMode(), null);
        
        // First call should initialize
        getHeaders();
        assert.strictEqual(tokenProvider.getMode(), 'bearer');
      });
    });

    describe('test_error_handling_when_token_provider_fails', () => {
      it('should propagate initialization errors', () => {
        // Set up environment with no auth credentials
        delete process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY;
        delete process.env.WEBEX_CLIENT_ID;
        delete process.env.WEBEX_CLIENT_SECRET;
        delete process.env.WEBEX_BOT_TOKEN;

        assert.throws(() => {
          getHeaders();
        }, /No authentication credentials found/);
      });
    });
  });

  // Test OAuth mode handling (when token store exists)
  // Note: This test would require mocking the token-store module
  // which is not in scope for this issue since OAuth tokens
  // come from issue #2's implementation
  describe('OAuth mode integration (placeholder)', () => {
    it('test_get_headers_handles_oauth_mode_with_refresh - requires token store', () => {
      // This test would need to:
      // 1. Mock tokenStore.read() to return valid OAuth credentials
      // 2. Set WEBEX_CLIENT_ID and WEBEX_CLIENT_SECRET
      // 3. Verify headers are returned with OAuth token
      // 4. Test token refresh logic
      // 
      // Since this requires the full OAuth infrastructure from issue #2,
      // we're documenting this as a placeholder for integration testing
      assert.ok(true, 'OAuth integration test requires token-store infrastructure');
    });
  });
});
