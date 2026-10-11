const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');

// Cookie options: httpOnly, secure in production, SameSite lax
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
};

// ----------------------------------------------------------------------------
// POST /api/auth/register
// ----------------------------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await db.get('SELECT id FROM sellers WHERE email = $1', [cleanEmail]);
    if (existing) {
      return res.status(400).json({ success: false, error: 'A seller with this email address already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.run(
      'INSERT INTO sellers (name, email, password_hash) VALUES ($1, $2, $3)',
      [name.trim(), cleanEmail, passwordHash]
    );

    const sellerId = db.type === 'sqlite' ? result.lastID : result.id;
    const seller = await db.get('SELECT id, name, email, created_at FROM sellers WHERE id = $1', [sellerId]);

    const token = jwt.sign(
      { id: seller.id, email: seller.email, name: seller.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set JWT in httpOnly cookie
    res.cookie('token', token, COOKIE_OPTIONS);

    res.status(201).json({
      success: true,
      message: 'Seller account registered successfully.',
      seller: { id: seller.id, name: seller.name, email: seller.email }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------------------------------
// POST /api/auth/login
// ----------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const seller = await db.get('SELECT * FROM sellers WHERE email = $1', [cleanEmail]);

    if (!seller || !(await bcrypt.compare(password, seller.password_hash))) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: seller.id, email: seller.email, name: seller.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set JWT in httpOnly cookie
    res.cookie('token', token, COOKIE_OPTIONS);

    res.json({
      success: true,
      message: 'Signed in successfully.',
      seller: { id: seller.id, name: seller.name, email: seller.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------------------------------
// POST /api/auth/logout
// ----------------------------------------------------------------------------
router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTIONS);
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ----------------------------------------------------------------------------
// GET /api/auth/me (Protected route test)
// ----------------------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  try {
    const seller = await db.get('SELECT id, name, email, created_at FROM sellers WHERE id = $1', [req.seller.id]);
    if (!seller) {
      return res.status(404).json({ success: false, error: 'Seller not found.' });
    }
    res.json({ success: true, seller });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
