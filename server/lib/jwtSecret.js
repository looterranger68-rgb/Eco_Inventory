const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getOrCreateDevelopmentSecret() {
  // Keep this file in the sandbox workspace so a server restart does not
  // invalidate the demo user's cookie. data/* is gitignored (except the
  // sanitized SQLite demo database), and this file is never served publicly.
  const dataDir = path.join(__dirname, '../../data');
  const secretPath = path.join(dataDir, '.jwt-secret');

  fs.mkdirSync(dataDir, { recursive: true });

  try {
    const savedSecret = fs.readFileSync(secretPath, 'utf8').trim();
    if (savedSecret) return savedSecret;
    throw new Error(`Development JWT secret file is empty: ${secretPath}`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const generatedSecret = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(secretPath, generatedSecret, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return generatedSecret;
  } catch (err) {
    // If another server process created it at the same time, use that value.
    if (err.code === 'EEXIST') {
      const savedSecret = fs.readFileSync(secretPath, 'utf8').trim();
      if (savedSecret) return savedSecret;
    }
    throw err;
  }
}

let jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production. Set it in your environment before starting the server.');
  }

  // Local sandboxes can start without a .env file. Persist the random secret
  // in the ignored workspace data folder so sessions survive server restarts.
  jwtSecret = getOrCreateDevelopmentSecret();
  console.warn('JWT_SECRET is not set; using a persistent, gitignored development secret from data/.jwt-secret.');
}

module.exports = jwtSecret;
