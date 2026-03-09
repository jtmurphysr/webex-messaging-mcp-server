import http from 'http'
import { URL } from 'url'
import querystring from 'querystring'
import crypto from 'crypto'
import tokenStore from '../lib/token-store.js'

/**
 * OAuth grant flow CLI command
 * 
 * Implements the OAuth2 authorization code grant flow:
 * 1. Reads WEBEX_CLIENT_ID and WEBEX_CLIENT_SECRET from env
 * 2. Starts local HTTP server for OAuth callback
 * 3. Opens browser to Webex OAuth authorization URL
 * 4. Captures authorization code from callback
 * 5. Exchanges code for access + refresh tokens
 * 6. Stores credentials using token-store
 * 7. Reports success with token expiry info
 */

const WEBEX_AUTH_BASE_URL = 'https://webexapis.com/v1/authorize'
const WEBEX_TOKEN_URL = 'https://webexapis.com/v1/access_token'
const REQUIRED_SCOPES = [
  'spark:messages_read',
  'spark:messages_write', 
  'spark:rooms_read',
  'spark:rooms_write',
  'spark:memberships_read',
  'spark:memberships_write',
  'spark:people_read',
  'spark:teams_read',
  'spark:teams_write',
  'spark:team_memberships_read',
  'spark:team_memberships_write',
  'spark:webhooks_read',
  'spark:webhooks_write'
]

class OAuthSetup {
  constructor() {
    this.server = null
    this.authCode = null
    this.state = null
    this.codeVerifier = null
    this.callbackPort = null
  }

  /**
   * Generate secure random string for PKCE code verifier
   * @returns {string} Base64url encoded random string
   */
  generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url')
  }

  /**
   * Generate PKCE code challenge from verifier
   * @param {string} codeVerifier 
   * @returns {string} Base64url encoded SHA256 hash
   */
  generateCodeChallenge(codeVerifier) {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  }

  /**
   * Generate random state parameter for CSRF protection
   * @returns {string} Hex encoded random string
   */
  generateState() {
    return crypto.randomBytes(16).toString('hex')
  }

  /**
   * Find an available port starting from 8080
   * @returns {Promise<number>} Available port number
   */
  async findAvailablePort() {
    return new Promise((resolve, reject) => {
      const server = http.createServer()
      server.listen(0, () => {
        const port = server.address().port
        server.close(() => resolve(port))
      })
      server.on('error', reject)
    })
  }

  /**
   * Start local HTTP server to capture OAuth callback
   * @returns {Promise<number>} Port the server is listening on
   */
  async startCallbackServer() {
    const port = await this.findAvailablePort()
    this.callbackPort = port

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.url.startsWith('/callback')) {
          this.handleCallback(req, res)
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not Found')
        }
      })

      this.server.listen(port, (err) => {
        if (err) {
          reject(err)
        } else {
          if (process.env.NODE_ENV !== 'test') {
            console.log(`OAuth callback server started on http://localhost:${port}`)
          }
          resolve(port)
        }
      })

      this.server.on('error', reject)
    })
  }

  /**
   * Handle OAuth callback request
   * @param {http.IncomingMessage} req 
   * @param {http.ServerResponse} res 
   */
  handleCallback(req, res) {
    const url = new URL(req.url, `http://localhost:${this.callbackPort}`)
    const params = url.searchParams

    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')
    const errorDescription = params.get('error_description')

    if (error) {
      console.error(`OAuth error: ${error}`)
      if (errorDescription) {
        console.error(`Description: ${errorDescription}`)
      }

      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end(`
        <html>
          <body>
            <h1>OAuth Error</h1>
            <p><strong>Error:</strong> ${error}</p>
            ${errorDescription ? `<p><strong>Description:</strong> ${errorDescription}</p>` : ''}
            <p>Please close this window and try again.</p>
          </body>
        </html>
      `)
      this.shutdownServer()
      return
    }

    if (!code) {
      console.error('No authorization code received in callback')
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end(`
        <html>
          <body>
            <h1>OAuth Error</h1>
            <p>No authorization code received. Please close this window and try again.</p>
          </body>
        </html>
      `)
      this.shutdownServer()
      return
    }

    if (state !== this.state) {
      console.error('Invalid state parameter - possible CSRF attack')
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end(`
        <html>
          <body>
            <h1>OAuth Error</h1>
            <p>Invalid state parameter. Please close this window and try again.</p>
          </body>
        </html>
      `)
      this.shutdownServer()
      return
    }

    if (process.env.NODE_ENV !== 'test') {
      console.log('✅ Authorization code received successfully')
    }
    this.authCode = code

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`
      <html>
        <body>
          <h1>Authorization Successful!</h1>
          <p>You can now close this window. The OAuth setup process will continue in your terminal.</p>
          <script>window.close()</script>
        </body>
      </html>
    `)

    // Give the response time to send before shutting down
    setTimeout(() => {
      this.shutdownServer()
    }, 1000)
  }

  /**
   * Shutdown the callback server
   */
  shutdownServer() {
    if (this.server) {
      this.server.close(() => {
        if (process.env.NODE_ENV !== 'test') {
          console.log('OAuth callback server stopped')
        }
      })
      this.server = null
    }
  }

  /**
   * Exchange authorization code for access and refresh tokens
   * @param {string} clientId 
   * @param {string} clientSecret 
   * @param {string} authCode 
   * @returns {Promise<Object>} Token response from Webex
   */
  async exchangeCodeForTokens(clientId, clientSecret, authCode) {
    const redirectUri = `http://localhost:${this.callbackPort}/callback`

    const params = {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code: authCode,
      redirect_uri: redirectUri,
      code_verifier: this.codeVerifier
    }

    try {
      if (process.env.NODE_ENV !== 'test') {
        console.log('🔄 Exchanging authorization code for tokens...')
      }
      
      const response = await fetch(WEBEX_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: querystring.stringify(params)
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText}\n${errorText}`)
      }

      const tokenData = await response.json()
      if (process.env.NODE_ENV !== 'test') {
        console.log('✅ Token exchange successful')
      }
      
      return tokenData
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('❌ Token exchange failed:', error.message)
      }
      throw error
    }
  }

  /**
   * Build the OAuth authorization URL
   * @param {string} clientId 
   * @returns {string} Authorization URL
   */
  buildAuthUrl(clientId) {
    this.state = this.generateState()
    this.codeVerifier = this.generateCodeVerifier()
    const codeChallenge = this.generateCodeChallenge(this.codeVerifier)
    const redirectUri = `http://localhost:${this.callbackPort}/callback`

    const params = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: REQUIRED_SCOPES.join(' '),
      state: this.state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    }

    return `${WEBEX_AUTH_BASE_URL}?${querystring.stringify(params)}`
  }

  /**
   * Open the authorization URL in the default browser
   * @param {string} url 
   */
  async openBrowser(url) {
    try {
      const { default: open } = await import('open')
      await open(url)
      if (process.env.NODE_ENV !== 'test') {
        console.log('🌐 Browser opened for OAuth authorization')
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.log('⚠️ Could not open browser automatically')
        console.log('📋 Please manually open the following URL in your browser:')
        console.log(`\n${url}\n`)
      }
    }
  }

  /**
   * Wait for the OAuth callback to complete
   * @returns {Promise<string>} Authorization code
   */
  async waitForCallback() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.shutdownServer()
        reject(new Error('OAuth flow timed out after 5 minutes'))
      }, 5 * 60 * 1000) // 5 minute timeout

      const checkForCode = () => {
        if (this.authCode) {
          clearTimeout(timeout)
          resolve(this.authCode)
        } else {
          setTimeout(checkForCode, 1000)
        }
      }

      checkForCode()
    })
  }

  /**
   * Store the tokens using token-store
   * @param {Object} tokenData - Response from token endpoint
   * @returns {Promise<void>}
   */
  async storeTokens(tokenData) {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + (tokenData.expires_in * 1000))
    
    // Refresh tokens for Webex typically expire in 90 days
    const refreshExpiresAt = new Date(now.getTime() + (90 * 24 * 60 * 60 * 1000))

    const credentials = {
      auth_mode: 'oauth',
      access_token: tokenData.access_token,
      access_token_expires_at: expiresAt.toISOString(),
      refresh_token: tokenData.refresh_token || null,
      refresh_token_expires_at: refreshExpiresAt.toISOString(),
      scopes: tokenData.scope ? tokenData.scope.split(' ') : REQUIRED_SCOPES,
      last_refresh_at: null,
      created_at: now.toISOString()
    }

    try {
      await tokenStore.write(credentials)
      
      if (process.env.NODE_ENV !== 'test') {
        console.log('✅ Tokens stored successfully')
        
        console.log('\n📊 Token Information:')
        console.log(`   Access Token: ${tokenData.access_token.substring(0, 8)}...`)
        console.log(`   Expires At: ${expiresAt.toLocaleString()}`)
        console.log(`   Refresh Token: ${tokenData.refresh_token ? tokenData.refresh_token.substring(0, 8) + '...' : 'None'}`)
        console.log(`   Scopes: ${credentials.scopes.join(', ')}`)
        console.log(`   Storage Path: ${tokenStore.getStorePath()}`)
      }
      
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('❌ Failed to store tokens:', error.message)
      }
      throw error
    }
  }

  /**
   * Main OAuth setup flow
   * @returns {Promise<void>}
   */
  async run() {
    try {
      if (process.env.NODE_ENV !== 'test') {
        console.log('🚀 Starting OAuth setup for Webex MCP Server\n')
      }

      // Check for required environment variables
      const clientId = process.env.WEBEX_CLIENT_ID
      const clientSecret = process.env.WEBEX_CLIENT_SECRET

      if (!clientId || !clientSecret) {
        if (process.env.NODE_ENV !== 'test') {
          console.error('❌ Missing required environment variables:')
          if (!clientId) console.error('   WEBEX_CLIENT_ID is not set')
          if (!clientSecret) console.error('   WEBEX_CLIENT_SECRET is not set')
          console.error('\n📖 Please check your .env file and ensure both variables are set.')
          console.error('   You can get these values by registering an Integration at:')
          console.error('   https://developer.webex.com/')
        }
        const error = new Error('Missing required environment variables')
        if (process.env.NODE_ENV === 'test') {
          throw error
        } else {
          process.exit(1)
        }
      }

      if (process.env.NODE_ENV !== 'test') {
        console.log('✅ Client credentials found')
        console.log(`   Client ID: ${clientId.substring(0, 8)}...`)
      }

      // Start local callback server
      await this.startCallbackServer()

      // Build authorization URL
      const authUrl = this.buildAuthUrl(clientId)
      
      if (process.env.NODE_ENV !== 'test') {
        console.log('\n🔐 Starting OAuth authorization flow...')
        console.log('   Please authorize the application in your browser.')
        console.log('   This will grant the MCP server access to your Webex account.\n')
      }

      // Open browser
      await this.openBrowser(authUrl)

      if (process.env.NODE_ENV !== 'test') {
        console.log('⏳ Waiting for authorization (timeout: 5 minutes)...')
      }

      // Wait for callback
      const authCode = await this.waitForCallback()

      // Exchange code for tokens
      const tokenData = await this.exchangeCodeForTokens(clientId, clientSecret, authCode)

      // Store tokens
      await this.storeTokens(tokenData)

      if (process.env.NODE_ENV !== 'test') {
        console.log('\n🎉 OAuth setup completed successfully!')
        console.log('   Your Webex MCP Server is now configured for long-term use.')
        console.log('   You can start the server with: npm run start')
      }

    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('\n❌ OAuth setup failed:', error.message)
      }
      this.shutdownServer()
      if (process.env.NODE_ENV === 'test') {
        throw error
      } else {
        process.exit(1)
      }
    }
  }
}

// Run the OAuth setup if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const setup = new OAuthSetup()
  setup.run()
}

export default OAuthSetup