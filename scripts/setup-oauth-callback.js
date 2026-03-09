import http from 'http'
import { URL } from 'url'

/**
 * Minimal localhost HTTP server for OAuth redirect capture
 * 
 * This script provides a standalone callback server that can be used
 * by external OAuth flows. It's separate from the main auth-setup.js
 * to allow for more flexible OAuth implementations.
 * 
 * Usage:
 *   node scripts/setup-oauth-callback.js [port]
 * 
 * The server will:
 * 1. Listen on specified port (default: 8080)
 * 2. Handle GET /callback with OAuth response
 * 3. Display success/error pages
 * 4. Log authorization code or error to console
 * 5. Shut down after receiving callback
 */

class OAuthCallbackServer {
  constructor(port = 8080) {
    this.port = port
    this.server = null
    this.authCode = null
    this.error = null
  }

  /**
   * Start the callback server
   * @returns {Promise<void>}
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res)
      })

      this.server.listen(this.port, (err) => {
        if (err) {
          reject(err)
        } else {
          console.log(`📡 OAuth callback server listening on http://localhost:${this.port}`)
          console.log(`📋 Redirect URI: http://localhost:${this.port}/callback`)
          console.log('⏳ Waiting for OAuth callback...\n')
          resolve()
        }
      })

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`❌ Port ${this.port} is already in use`)
          console.error('   Please try a different port or stop the existing service')
        } else {
          console.error('❌ Server error:', err.message)
        }
        reject(err)
      })
    })
  }

  /**
   * Handle incoming HTTP requests
   * @param {http.IncomingMessage} req 
   * @param {http.ServerResponse} res 
   */
  handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`)
    
    if (url.pathname === '/callback') {
      this.handleCallback(req, res, url)
    } else if (url.pathname === '/') {
      this.handleRoot(req, res)
    } else {
      this.handle404(req, res)
    }
  }

  /**
   * Handle the OAuth callback endpoint
   * @param {http.IncomingMessage} req 
   * @param {http.ServerResponse} res 
   * @param {URL} url 
   */
  handleCallback(req, res, url) {
    const params = url.searchParams
    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')
    const errorDescription = params.get('error_description')

    console.log('📨 OAuth callback received')

    if (error) {
      console.error(`❌ OAuth error: ${error}`)
      if (errorDescription) {
        console.error(`   Description: ${errorDescription}`)
      }

      this.error = { error, errorDescription }

      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(this.renderErrorPage(error, errorDescription))
      
      this.scheduleShutdown()
      return
    }

    if (!code) {
      console.error('❌ No authorization code received')
      this.error = { error: 'no_code', errorDescription: 'No authorization code in callback' }

      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(this.renderErrorPage('no_code', 'No authorization code received'))
      
      this.scheduleShutdown()
      return
    }

    console.log('✅ Authorization code received')
    console.log(`   Code: ${code.substring(0, 8)}...`)
    if (state) {
      console.log(`   State: ${state}`)
    }

    this.authCode = code

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(this.renderSuccessPage(code))

    this.scheduleShutdown()
  }

  /**
   * Handle root endpoint (shows server status)
   * @param {http.IncomingMessage} req 
   * @param {http.ServerResponse} res 
   */
  handleRoot(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>OAuth Callback Server</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .container { max-width: 600px; margin: 0 auto; }
            .status { color: #28a745; }
            .code { background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>OAuth Callback Server</h1>
            <p class="status">✅ Server is running and ready to receive callbacks</p>
            <p><strong>Port:</strong> ${this.port}</p>
            <p><strong>Callback URL:</strong> <code class="code">http://localhost:${this.port}/callback</code></p>
            <p>This page confirms the server is listening. The actual OAuth callback should be sent to <code>/callback</code>.</p>
          </div>
        </body>
      </html>
    `)
  }

  /**
   * Handle 404 errors
   * @param {http.IncomingMessage} req 
   * @param {http.ServerResponse} res 
   */
  handle404(req, res) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Not Found</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
          </style>
        </head>
        <body>
          <h1>404 - Not Found</h1>
          <p>The requested URL was not found on this server.</p>
          <p>Valid endpoints: <code>/</code> and <code>/callback</code></p>
        </body>
      </html>
    `)
  }

  /**
   * Render success page for OAuth callback
   * @param {string} code - Authorization code
   * @returns {string} HTML response
   */
  renderSuccessPage(code) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>OAuth Authorization Successful</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 40px; 
              text-align: center; 
              background-color: #f8f9fa;
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background: white; 
              padding: 40px; 
              border-radius: 8px; 
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .success { color: #28a745; }
            .code { 
              background: #e9ecef; 
              padding: 15px; 
              border-radius: 4px; 
              font-family: monospace; 
              margin: 20px 0; 
              word-break: break-all;
            }
            .close-button {
              background: #007bff;
              color: white;
              border: none;
              padding: 10px 20px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 16px;
              margin-top: 20px;
            }
            .close-button:hover { background: #0056b3; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1 class="success">✅ Authorization Successful!</h1>
            <p>The OAuth authorization was completed successfully.</p>
            <p><strong>Authorization Code received:</strong></p>
            <div class="code">${code.substring(0, 20)}...</div>
            <p>You can now close this window. The setup process will continue in your terminal.</p>
            <button class="close-button" onclick="window.close()">Close Window</button>
            <script>
              // Auto-close after 3 seconds
              setTimeout(() => {
                window.close();
              }, 3000);
            </script>
          </div>
        </body>
      </html>
    `
  }

  /**
   * Render error page for OAuth callback
   * @param {string} error - Error code
   * @param {string} errorDescription - Error description
   * @returns {string} HTML response
   */
  renderErrorPage(error, errorDescription) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>OAuth Authorization Error</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 40px; 
              text-align: center; 
              background-color: #f8f9fa;
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              background: white; 
              padding: 40px; 
              border-radius: 8px; 
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .error { color: #dc3545; }
            .error-details { 
              background: #f8d7da; 
              border: 1px solid #f5c6cb;
              color: #721c24;
              padding: 15px; 
              border-radius: 4px; 
              margin: 20px 0; 
              text-align: left;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1 class="error">❌ Authorization Error</h1>
            <p>There was an error during the OAuth authorization process.</p>
            <div class="error-details">
              <strong>Error:</strong> ${error}<br>
              ${errorDescription ? `<strong>Description:</strong> ${errorDescription}` : ''}
            </div>
            <p>Please close this window and try the authorization process again.</p>
            <p>Check your terminal for more details.</p>
          </div>
        </body>
      </html>
    `
  }

  /**
   * Schedule server shutdown after a delay
   */
  scheduleShutdown() {
    console.log('\n🛑 Shutting down callback server in 3 seconds...')
    setTimeout(() => {
      this.shutdown()
    }, 3000)
  }

  /**
   * Shutdown the server
   */
  shutdown() {
    if (this.server) {
      this.server.close(() => {
        console.log('✅ Callback server stopped')
        
        if (this.authCode) {
          console.log(`\n🔑 Authorization code: ${this.authCode}`)
        } else if (this.error) {
          console.log(`\n❌ OAuth error: ${this.error.error}`)
          if (this.error.errorDescription) {
            console.log(`   Description: ${this.error.errorDescription}`)
          }
        }
      })
    }
  }
}

// Run the callback server if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.argv[2]) || 8080
  const server = new OAuthCallbackServer(port)
  
  server.start().catch((error) => {
    console.error('❌ Failed to start callback server:', error.message)
    process.exit(1)
  })

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n⏹️ Received interrupt signal')
    server.shutdown()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('\n\n⏹️ Received terminate signal')
    server.shutdown()
    process.exit(0)
  })
}

export default OAuthCallbackServer