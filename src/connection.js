import jsforce from 'jsforce';

let conn = null;
let connectingPromise = null;

/**
 * Validates that all required environment variables are present
 * for the chosen auth mode. Fails fast with a clear message.
 */
function validateEnv(mode) {
  const missing = [];

  if (mode === 'jwt') {
    if (!process.env.SF_CLIENT_ID) missing.push('SF_CLIENT_ID');
    if (!process.env.SF_PRIVATE_KEY_PATH) missing.push('SF_PRIVATE_KEY_PATH');
    if (!process.env.SF_JWT_SUBJECT) missing.push('SF_JWT_SUBJECT');
    if (!process.env.SF_INSTANCE_URL) missing.push('SF_INSTANCE_URL');
  } else {
    if (!process.env.SF_USERNAME) missing.push('SF_USERNAME');
    if (!process.env.SF_PASSWORD) missing.push('SF_PASSWORD');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for "${mode}" auth: ${missing.join(', ')}. ` +
        'See .env.example for details.',
    );
  }
}

/**
 * Performs the actual authentication flow. Called only once per
 * connection lifecycle — concurrent callers share the same promise.
 */
async function authenticate() {
  const mode = process.env.SF_AUTH_MODE || 'password';
  validateEnv(mode);

  if (mode === 'jwt') {
    const fs = await import('fs');
    conn = new jsforce.Connection({
      instanceUrl: process.env.SF_INSTANCE_URL,
    });
    await conn.authorize({
      clientId: process.env.SF_CLIENT_ID,
      privateKey: fs.readFileSync(process.env.SF_PRIVATE_KEY_PATH, 'utf8'),
      subject: process.env.SF_JWT_SUBJECT,
      redirectUri: 'https://login.salesforce.com/services/oauth2/success',
    });
  } else {
    conn = new jsforce.Connection({
      loginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
    });
    await conn.login(
      process.env.SF_USERNAME,
      process.env.SF_PASSWORD + (process.env.SF_SECURITY_TOKEN || ''),
    );
  }

  return conn;
}

/**
 * Returns a singleton jsforce Connection, authenticating on first call
 * or when the previous access token has expired.
 *
 * Uses a Promise-caching pattern to prevent concurrent auth race
 * conditions: if two tool calls arrive simultaneously on startup,
 * only one auth flow fires — the second awaits the same promise.
 */
export async function getConnection() {
  if (conn && conn.accessToken) return conn;

  // If an auth flow is already in progress, piggyback on it
  if (connectingPromise) return connectingPromise;

  connectingPromise = authenticate()
    .finally(() => {
      connectingPromise = null;
    });

  return connectingPromise;
}

/**
 * Resets the cached connection so the next getConnection() call
 * re-authenticates. Called on INVALID_SESSION_ID errors.
 */
export function resetConnection() {
  conn = null;
  connectingPromise = null;
}
