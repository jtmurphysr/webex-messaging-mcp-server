import tokenProvider from '../lib/token-provider.js'
import tokenStore from '../lib/token-store.js'

/**
 * Auth status reporter CLI command
 * 
 * Reports comprehensive authentication status including:
 * - Auth mode (oauth/bearer/bot)
 * - Token type and expiry information
 * - Scopes (for oauth mode)
 * - Warning messages for potential issues
 */

/**
 * Format time difference as human readable string
 * @param {Date} targetDate 
 * @param {Date} now 
 * @returns {string}
 */
function formatTimeUntil(targetDate, now = new Date()) {
  const diffMs = targetDate.getTime() - now.getTime()
  
  if (diffMs <= 0) {
    return 'expired'
  }
  
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000))
  
  if (days > 0) {
    return `in ${days} day${days !== 1 ? 's' : ''}${hours > 0 ? `, ${hours} hour${hours !== 1 ? 's' : ''}` : ''}`
  } else if (hours > 0) {
    return `in ${hours} hour${hours !== 1 ? 's' : ''}${minutes > 0 ? `, ${minutes} minute${minutes !== 1 ? 's' : ''}` : ''}`
  } else {
    return `in ${minutes} minute${minutes !== 1 ? 's' : ''}`
  }
}

/**
 * Get token type string based on auth mode
 * @param {string} mode 
 * @returns {string}
 */
function getTokenType(mode) {
  switch (mode) {
    case 'oauth':
      return 'Integration'
    case 'bot':
      return 'Bot'
    case 'bearer':
      return 'Bearer'
    default:
      return 'Unknown'
  }
}

/**
 * Display authentication status
 */
async function showAuthStatus() {
  try {
    // Initialize token provider to detect auth mode
    await tokenProvider.initialize()
    
    const mode = tokenProvider.getMode()
    const status = tokenProvider.getStatus()
    const now = new Date()
    
    console.log(`Auth Mode: ${mode}`)
    console.log(`Token Type: ${getTokenType(mode)}`)
    
    // Handle different auth modes
    if (mode === 'oauth') {
      try {
        const credentials = await tokenStore.read()
        
        if (credentials) {
          // Access token expiry
          if (credentials.access_token_expires_at) {
            const expiresAt = new Date(credentials.access_token_expires_at)
            console.log(`Expires At: ${expiresAt.toISOString()} (${formatTimeUntil(expiresAt, now)})`)
          } else {
            console.log('Expires At: Unknown')
          }
          
          // Refresh token expiry
          if (credentials.refresh_token_expires_at) {
            const refreshExpiresAt = new Date(credentials.refresh_token_expires_at)
            console.log(`Refresh Token Expires: ${refreshExpiresAt.toISOString()} (${formatTimeUntil(refreshExpiresAt, now)})`)
          } else {
            console.log('Refresh Token Expires: Unknown')
          }
          
          // Scopes
          if (credentials.scopes && Array.isArray(credentials.scopes)) {
            console.log(`Scopes: ${credentials.scopes.join(', ')}`)
          } else {
            console.log('Scopes: Unknown')
          }
          
          // Last refresh
          if (credentials.last_refresh_at) {
            const lastRefresh = new Date(credentials.last_refresh_at)
            console.log(`Last Refreshed: ${lastRefresh.toISOString()}`)
          } else {
            console.log('Last Refreshed: Never')
          }
          
          // Status
          if (status.isExpired) {
            console.log('Status: Expired')
          } else if (status.isRefreshing) {
            console.log('Status: Refreshing')
          } else {
            console.log('Status: Active')
          }
          
          // Domain warnings
          console.log()
          
          // Warn about refresh token expiry cliff
          if (credentials.refresh_token_expires_at) {
            const refreshExpiresAt = new Date(credentials.refresh_token_expires_at)
            const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
            
            if (refreshExpiresAt < thirtyDaysFromNow) {
              console.log('⚠️  WARNING: Refresh token expiry cliff — Refresh token expires within 30 days.')
              console.log('   If the server is stopped for >90 days, the refresh token dies silently.')
              console.log('   Re-run auth:setup before expiry to avoid service interruption.')
              console.log()
            }
          }
          
          // Warn about scope mismatch potential
          if (!credentials.scopes || credentials.scopes.length === 0) {
            console.log('⚠️  WARNING: Scope mismatch — No scopes recorded in credentials.')
            console.log('   If tools receive 403 errors (not 401s), check Integration scope configuration.')
            console.log()
          }
          
        } else {
          console.log('Status: No credentials file found')
        }
      } catch (error) {
        console.log('Status: Error reading credentials')
        console.log(`Error: ${error.message}`)
      }
      
    } else if (mode === 'bearer') {
      console.log('Expires At: ~12 hours from token creation (exact time unknown)')
      console.log('Refresh Token Expires: N/A (bearer tokens cannot be refreshed)')
      console.log('Scopes: Determined by token creator')
      console.log('Last Refreshed: N/A')
      console.log('Status: Unknown (bearer tokens do not report expiry)')
      
      console.log()
      console.log('⚠️  WARNING: Token security — Bearer tokens expire in 12 hours and cannot be refreshed.')
      console.log('   For long-running services, consider using OAuth Integration mode instead.')
      
    } else if (mode === 'bot') {
      console.log('Expires At: Never (bot tokens do not expire)')
      console.log('Refresh Token Expires: N/A')
      console.log('Scopes: Bot permissions only')
      console.log('Last Refreshed: N/A')
      console.log('Status: Active')
      
    } else {
      console.log('Status: Unknown auth mode')
    }
    
    // General token security warning
    console.log()
    console.log('⚠️  WARNING: Token security — Access tokens, refresh tokens, and client secrets')
    console.log('   are never logged in full. Debug output shows only first 8 characters.')
    
  } catch (error) {
    if (error.message.includes('No authentication credentials found')) {
      console.log('Auth Mode: none')
      console.log('Status: No credentials configured')
      console.log()
      console.log('⚠️  WARNING: No authentication configured')
      console.log('   Set WEBEX_CLIENT_ID+WEBEX_CLIENT_SECRET (OAuth), WEBEX_BOT_TOKEN (Bot),')
      console.log('   or WEBEX_PUBLIC_WORKSPACE_API_KEY (Bearer) environment variables.')
      console.log()
      console.log('   For OAuth mode, run: npm run auth:setup')
    } else if (error.message.includes('OAuth credentials not found')) {
      console.log('Auth Mode: oauth (configured)')
      console.log('Status: No credentials file')
      console.log()
      console.log('⚠️  WARNING: OAuth configured but not set up')
      console.log('   Client ID and secret are set, but no tokens stored.')
      console.log('   Run: npm run auth:setup')
    } else if (error.message.includes('corrupted') || error.message.includes('JSON')) {
      console.log('Auth Mode: oauth (configured)')
      console.log('Status: Corrupted credentials')
      console.log()
      console.log('⚠️  WARNING: Corrupted credentials file')
      console.log('   The credentials file exists but cannot be read.')
      console.log('   Run: npm run auth:setup')
    } else {
      console.log('Status: Error')
      console.log(`Error: ${error.message}`)
    }
    
    process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  showAuthStatus().catch(error => {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  })
}

export default showAuthStatus