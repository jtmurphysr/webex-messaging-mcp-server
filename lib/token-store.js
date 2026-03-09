/**
 * Token Store Module
 * Handles credential file I/O and filesystem permissions management
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Get the path to the credential store file
 * @returns {string} Absolute path to the credential file
 */
function getStorePath() {
  const envPath = process.env.WEBEX_TOKEN_STORE_PATH;
  if (envPath) {
    return path.resolve(envPath);
  }
  
  const homeDir = os.homedir();
  return path.join(homeDir, '.webex-mcp', 'tokens.json');
}

/**
 * Ensure the parent directory exists and create it if necessary
 * @param {string} filePath - Path to the file
 */
async function ensureDirectoryExists(filePath) {
  const dir = path.dirname(filePath);
  try {
    await fs.access(dir);
  } catch (error) {
    // Directory doesn't exist, create it
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Set file permissions to 0600 (owner read/write only)
 * @param {string} filePath - Path to the file
 */
async function setSecurePermissions(filePath) {
  await fs.chmod(filePath, 0o600);
}

/**
 * Read credentials from the token store file
 * @returns {Promise<Object|null>} TokenCredential object or null if file doesn't exist
 */
async function read() {
  const storePath = getStorePath();
  
  try {
    const data = await fs.readFile(storePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist
      return null;
    }
    throw error;
  }
}

/**
 * Write credentials to the token store file
 * @param {Object} credentials - TokenCredential object to store
 */
async function write(credentials) {
  const storePath = getStorePath();
  
  // Ensure parent directory exists
  await ensureDirectoryExists(storePath);
  
  // Write the file
  const data = JSON.stringify(credentials, null, 2);
  await fs.writeFile(storePath, data, 'utf8');
  
  // Set secure permissions (owner read/write only)
  await setSecurePermissions(storePath);
}

/**
 * Check if the credential file exists
 * @returns {Promise<boolean>} True if file exists, false otherwise
 */
async function exists() {
  const storePath = getStorePath();
  
  try {
    await fs.access(storePath);
    return true;
  } catch (error) {
    return false;
  }
}

export {
  read,
  write,
  getStorePath,
  exists
};