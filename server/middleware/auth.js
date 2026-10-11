const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required. Set it in your .env file or environment before starting the server.');
}

function requireAuth(req, res, next) {
  // Check httpOnly cookie first, fallback to Authorization header if present
  const token = (req.cookies && req.cookies.token) ||
    (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));

  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Please sign in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.seller = decoded; // { id, email, name }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session. Please sign in again.' });
  }
}

module.exports = {
  requireAuth,
  JWT_SECRET
};
