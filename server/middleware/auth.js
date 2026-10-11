const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../lib/jwtSecret');

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
