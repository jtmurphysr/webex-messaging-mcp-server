import tokenStore from './token-store.js'

/**
 * TokenProvider - Auth mode detection and token lifecycle management
 * 
 * Handles OAuth, bearer, and bot token authentication modes with automatic
 * refresh and concurrent request protection.
 */
class TokenProvider {
  constructor() {
    this.mode = null
    this.currentToken = null
    this.expiresAt = null
    this.refreshBuffer = 1 * 60 * 60 * 1000 // 1 hour in milliseconds
    this.isRefreshing = false
    this.refreshPromise = null
    this.lastRefreshAt = null
  }

  /**
   * Initialize provider - detects auth mode from environment variables
   * @returns {Promise<void>}
   */
  async initialize() {
    // Detect auth mode based on environment variables
    // Priority: OAuth > Bot > Bearer (as specified in PRD)
    if (process.env.WEBEX_CLIENT_ID && process.env.WEBEX_CLIENT_SECRET) {
      this.mode = 'oauth'
      await this._initializeOAuthMode()
    } else if (process.env.WEBEX_BOT_TOKEN) {
      this.mode = 'bot'
      this._initializeBotMode()
    } else if (process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY) {
      this.mode = 'bearer'
      this._initializeBearerMode()
    } else {
      throw new Error('No authentication credentials found. Please set WEBEX_CLIENT_ID+WEBEX_CLIENT_SECRET, WEBEX_BOT_TOKEN, or WEBEX_PUBLIC_WORKSPACE_API_KEY')
    }
  }

  /**
   * Get current authorization header value
   * @returns {Promise<string>} Bearer token header value
   */
  async getAuthHeader() {
    if (this.mode === 'oauth') {
      await this._ensureValidToken()
    }
    
    if (!this.currentToken) {
      throw new Error(`No valid ${this.mode} token available`)
    }
    
    return `Bearer ${this.currentToken}`
  }

  /**
   * Get current auth mode
   * @returns {string} "oauth" | "bearer" | "bot"
   */
  getMode() {
    return this.mode
  }

  /**
   * Force token refresh (OAuth mode only)
   * @returns {Promise<void>}
   */
  async refresh() {
    if (this.mode !== 'oauth') {
      throw new Error('Token refresh is only supported in OAuth mode')
    }
    
    await this._refreshOAuthToken()
  }

  /**
   * Get token status info
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      mode: this.mode,
      expiresAt: this.expiresAt,
      isExpired: this.expiresAt ? new Date() > this.expiresAt : false,
      isRefreshing: this.isRefreshing,
      lastRefreshAt: this.lastRefreshAt
    }
  }

  /**
   * Get current authorization header value synchronously (for backwards compatibility)
   * For OAuth mode, triggers background refresh if needed but returns current token
   * @returns {string} Bearer token header value
   */
  getAuthHeaderSync() {
    if (this.mode === 'oauth') {
      this._ensureValidTokenBackground()
    }
    
    if (!this.currentToken) {
      throw new Error(`No valid ${this.mode} token available`)
    }
    
    return `Bearer ${this.currentToken}`
  }

  /**
   * Initialize OAuth mode synchronously by loading stored credentials
   * @private
   */
  _initializeOAuthModeSync() {
    try {
      const credentials = tokenStore.readSync()
      
      if (!credentials || credentials.auth_mode !== 'oauth') {
        throw new Error('OAuth credentials not found. Please run setup command to authenticate.')
      }

      this.mode = 'oauth'
      this.currentToken = credentials.access_token
      this.expiresAt = credentials.access_token_expires_at ? new Date(credentials.access_token_expires_at) : null
      this.lastRefreshAt = credentials.last_refresh_at ? new Date(credentials.last_refresh_at) : null

      // Check if refresh token is close to expiry (within 30 days)
      if (credentials.refresh_token_expires_at) {
        const refreshExpiresAt = new Date(credentials.refresh_token_expires_at)
        const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        
        if (refreshExpiresAt < thirtyDaysFromNow) {
          console.warn(`[TokenProvider] WARNING: Refresh token expires ${refreshExpiresAt.toISOString()}. Re-run setup command before expiry.`)
        }
      }
    } catch (error) {
      // If sync read fails, fall back to bearer mode for compatibility
      console.warn(`[TokenProvider] OAuth initialization failed, checking for fallback auth: ${error.message}`)
      if (process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY) {
        this.mode = 'bearer'
        this._initializeBearerMode()
      } else {
        throw error
      }
    }
  }

  /**
   * Trigger background token refresh if needed (OAuth only, non-blocking)
   * @private
   */
  _ensureValidTokenBackground() {
    if (!this.expiresAt) {
      return // No expiry info, assume valid
    }

    const now = new Date()
    const needsRefresh = (this.expiresAt.getTime() - now.getTime()) < this.refreshBuffer

    if (needsRefresh && !this.isRefreshing) {
      // Trigger refresh in background - don't await
      this._refreshOAuthToken().catch(error => {
        console.error(`[TokenProvider] Background refresh failed: ${error.message}`)
      })
    }
  }

  /**
   * Initialize OAuth mode by loading stored credentials
   * @private
   */
  async _initializeOAuthMode() {
    const credentials = await tokenStore.read()
    
    if (!credentials || credentials.auth_mode !== 'oauth') {
      throw new Error('OAuth credentials not found. Please run setup command to authenticate.')
    }

    this.currentToken = credentials.access_token
    this.expiresAt = credentials.access_token_expires_at ? new Date(credentials.access_token_expires_at) : null
    this.lastRefreshAt = credentials.last_refresh_at ? new Date(credentials.last_refresh_at) : null

    // Check if refresh token is close to expiry (within 30 days)
    if (credentials.refresh_token_expires_at) {
      const refreshExpiresAt = new Date(credentials.refresh_token_expires_at)
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      
      if (refreshExpiresAt < thirtyDaysFromNow) {
        console.warn(`[TokenProvider] WARNING: Refresh token expires ${refreshExpiresAt.toISOString()}. Re-run setup command before expiry.`)
      }
    }
  }

  /**
   * Initialize bot token mode
   * @private
   */
  _initializeBotMode() {
    this.mode = 'bot'
    this.currentToken = process.env.WEBEX_BOT_TOKEN
    // Bot tokens don't expire
    this.expiresAt = null
  }

  /**
   * Initialize bearer token mode
   * @private
   */
  _initializeBearerMode() {
    this.mode = 'bearer'
    let token = process.env.WEBEX_PUBLIC_WORKSPACE_API_KEY
    // Remove 'Bearer ' prefix if it exists
    token = token.replace(/^Bearer\s+/, '')
    this.currentToken = token
    // Bearer tokens expire in 12 hours, but we don't know when they were created
    this.expiresAt = null
  }

  /**
   * Ensure token is valid and refresh if needed (OAuth only)
   * @private
   */
  async _ensureValidToken() {
    if (!this.expiresAt) {
      return // No expiry info, assume valid
    }

    const now = new Date()
    const needsRefresh = (this.expiresAt.getTime() - now.getTime()) < this.refreshBuffer

    if (needsRefresh) {
      await this._refreshOAuthToken()
    }
  }

  /**
   * Refresh OAuth token with mutex protection
   * @private
   */
  async _refreshOAuthToken() {
    // If already refreshing, wait for existing refresh
    if (this.isRefreshing && this.refreshPromise) {
      return await this.refreshPromise
    }

    this.isRefreshing = true
    
    try {
      this.refreshPromise = this._performTokenRefresh()
      await this.refreshPromise
    } finally {
      this.isRefreshing = false
      this.refreshPromise = null
    }
  }

  /**
   * Perform the actual token refresh API call
   * @private
   */
  async _performTokenRefresh() {
    const credentials = await tokenStore.read()
    
    if (!credentials || !credentials.refresh_token) {
      throw new Error('No refresh token available. Please re-run setup command.')
    }

    const refreshPayload = {
      grant_type: 'refresh_token',
      refresh_token: credentials.refresh_token,
      client_id: process.env.WEBEX_CLIENT_ID,
      client_secret: process.env.WEBEX_CLIENT_SECRET
    }

    const response = await fetch('https://webexapis.com/v1/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams(refreshPayload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      
      // Check for specific error cases
      if (response.status === 400) {
        try {
          const errorData = JSON.parse(errorText)
          if (errorData.error === 'invalid_grant') {
            throw new Error('Refresh token expired or invalid. Please re-run setup command.')
          }
        } catch {
          // Fall through to generic error
        }
      }

      // Check for admin token invalidation
      if (response.status === 401) {
        throw new Error('Token invalidated by admin action. Please re-run setup command.')
      }

      throw new Error(`Token refresh failed: ${response.status} ${errorText.substring(0, 100)}`)
    }

    const tokenData = await response.json()
    
    // Update credentials
    const now = new Date()
    const expiresIn = tokenData.expires_in * 1000 // Convert seconds to milliseconds
    
    const updatedCredentials = {
      ...credentials,
      access_token: tokenData.access_token,
      access_token_expires_at: new Date(now.getTime() + expiresIn).toISOString(),
      refresh_token: tokenData.refresh_token || credentials.refresh_token, // Some providers don't return new refresh token
      last_refresh_at: now.toISOString()
    }

    // If new refresh token provided, update its expiry (90 days from now)
    if (tokenData.refresh_token) {
      updatedCredentials.refresh_token_expires_at = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()
    }

    await tokenStore.write(updatedCredentials)

    // Update internal state
    this.currentToken = tokenData.access_token
    this.expiresAt = new Date(updatedCredentials.access_token_expires_at)
    this.lastRefreshAt = now

    console.log(`[TokenProvider] Token refreshed successfully. New token: ${this.currentToken.substring(0, 8)}...`)
  }
}

// Export singleton instance
const tokenProvider = new TokenProvider()

export default tokenProvider