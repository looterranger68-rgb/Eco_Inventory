const crypto = require('crypto');

let jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production. Set it in your environment before starting the server.');
  }

  // Local sandboxes can start without a .env file. Keep this secret random and
  // process-local so it is never committed or reused; sessions reset on restart.
  jwtSecret = crypto.randomBytes(48).toString('hex');
  console.warn('JWT_SECRET is not set; using a temporary development secret. Sessions will expire when the server restarts.');
}

module.exports = jwtSecret;
