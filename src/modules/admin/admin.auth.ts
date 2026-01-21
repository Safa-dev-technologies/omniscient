import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { env } from '../../config/index.js';

/**
 * Verify admin credentials against environment variables
 * Uses bcrypt for secure password comparison and timing-safe username comparison
 * to prevent timing attacks that could enumerate valid usernames
 */
export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
  const adminUsername = env.ADMIN_USERNAME;
  const adminPasswordHash = env.ADMIN_PASSWORD_HASH;

  // Check if admin credentials are configured
  if (!adminUsername || !adminPasswordHash) {
    throw new Error('Admin credentials are not configured');
  }

  // Use timing-safe comparison for username to prevent enumeration attacks
  // Normalize lengths using HMAC to prevent length-based timing leaks
  const normalizeString = (str: string): Buffer => {
    return crypto.createHmac('sha256', 'omniscient-username-salt').update(str).digest();
  };

  const usernameHash = normalizeString(username);
  const adminUsernameHash = normalizeString(adminUsername);
  const usernameMatch = crypto.timingSafeEqual(usernameHash, adminUsernameHash);

  // Always perform password check to prevent timing attacks
  // Even if username is wrong, we still do the bcrypt comparison
  let passwordMatch = false;
  try {
    passwordMatch = await bcrypt.compare(password, adminPasswordHash);
  } catch {
    // Invalid hash format or other bcrypt error
    throw new Error('Invalid admin password hash configuration');
  }

  // Both must match
  return usernameMatch && passwordMatch;
}

/**
 * Get master API key for authenticated admin
 */
export function getMasterApiKey(): string {
  const masterKey = env.MASTER_API_KEY;

  if (!masterKey) {
    throw new Error('Master API key is not configured');
  }

  return masterKey;
}

/**
 * Generate bcrypt hash for a password (utility function for setup)
 * Usage: node -e "import('./admin.auth.js').then(m => m.hashPassword('your-password').then(console.log))"
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}
