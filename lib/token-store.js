import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import os from 'os'

/**
 * TokenStore - Credential file I/O and permissions management
 * 
 * Handles reading and writing token credentials to filesystem with proper
 * security permissions (0600 for files, 0700 for directories).
 */
class TokenStore {
  constructor() {
    this._storePath = null
  }

  /**
   * Get the absolute path to the credentials file
   * @returns {string} Absolute path to tokens.json
   */
  getStorePath() {
    if (this._storePath) {
      return this._storePath
    }

    // Check for environment variable override
    if (process.env.WEBEX_TOKEN_STORE_PATH) {
      this._storePath = path.resolve(process.env.WEBEX_TOKEN_STORE_PATH)
    } else {
      // Default to ~/.webex-mcp/tokens.json
      const homeDir = os.homedir()
      const webexMcpDir = path.join(homeDir, '.webex-mcp')
      this._storePath = path.join(webexMcpDir, 'tokens.json')
    }

    return this._storePath
  }

  /**
   * Check if credentials file exists
   * @returns {Promise<boolean>} True if file exists, false otherwise
   */
  async exists() {
    try {
      await fs.access(this.getStorePath())
      return true
    } catch {
      return false
    }
  }

  /**
   * Read credentials from file
   * @returns {Promise<Object|null>} TokenCredential object or null if no file exists
   */
  async read() {
    try {
      const filePath = this.getStorePath()
      const data = await fs.readFile(filePath, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  /**
   * Read credentials from file synchronously (for backwards compatibility)
   * @returns {Object|null} - TokenCredential object or null if not found
   */
  readSync() {
    try {
      const filePath = this.getStorePath()
      const data = fsSync.readFileSync(filePath, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  /**
   * Write credentials to file with proper permissions
   * @param {Object} credentials - TokenCredential object
   * @returns {Promise<void>}
   */
  async write(credentials) {
    const filePath = this.getStorePath()
    const dirPath = path.dirname(filePath)

    // Ensure directory exists with 0700 permissions (owner only)
    try {
      await fs.mkdir(dirPath, { recursive: true, mode: 0o700 })
    } catch (error) {
      // Directory might already exist, check if we can write to it
      if (error.code !== 'EEXIST') {
        throw error
      }
    }

    // Write file with JSON formatting
    const data = JSON.stringify(credentials, null, 2)
    await fs.writeFile(filePath, data, 'utf8')

    // Set file permissions to 0600 (owner read/write only)
    await fs.chmod(filePath, 0o600)
  }
}

// Export singleton instance
const tokenStore = new TokenStore()

export default tokenStore