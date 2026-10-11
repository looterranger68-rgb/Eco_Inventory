require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { initDatabase } = require('./initDb');
const db = require('./db');
const fs = require('fs');
const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const insightsRouter = require('./routes/insights');
const apiRouter = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.CORS_ORIGIN
].filter(Boolean));

// Standard middleware
app.use((req, res, next) => {
  const origin = req.get('origin');
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0].trim();
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0].trim();
  let matchesForwardedApp = false;

  if (origin) {
    try {
      const originUrl = new URL(origin);
      const appHosts = [req.get('host'), forwardedHost].filter(Boolean);
      const appProtocol = forwardedProto || req.protocol;
      matchesForwardedApp = appHosts.includes(originUrl.host) && originUrl.protocol === `${appProtocol}:`;
    } catch {
      matchesForwardedApp = false;
    }
  }

  if (origin && !allowedOrigins.has(origin) && !matchesForwardedApp) {
    return res.status(403).json({ success: false, error: 'Origin not allowed.' });
  }

  // Reflect approved origins so cookie-based login works in hosted sandboxes.
  cors({ origin: origin || false, credentials: true })(req, res, next);
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static frontend files from /public without any build step
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// Auth & API Routes
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/insights', insightsRouter);
app.use('/api', apiRouter);

// Public product page routing for QR listings (no auth)
app.get('/p/:slug', async (req, res) => {
  try {
    const product = await db.get(
      'SELECT name, category, price, quantity, mfg_date, expiry_date FROM products WHERE slug = $1',
      [req.params.slug]
    );
    if (!product) return res.status(404).sendFile(path.join(publicDir, '404.html'));

    const template = fs.readFileSync(path.join(publicDir, 'public.html'), 'utf8');
    const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

    const priceBlock = product.quantity > 0
      ? `<div class="price">$${Number(product.price).toFixed(2)}<small>${product.quantity} in stock</small></div>`
      : `<div class="out-of-stock">Out of stock</div>`;

    const html = template
      .replace(/{{PRODUCT_NAME}}/g, escapeHtml(product.name))
      .replace(/{{PRODUCT_CATEGORY}}/g, escapeHtml(product.category))
      .replace(/{{PRICE_BLOCK}}/g, priceBlock)
      .replace(/{{MFG_DATE}}/g, fmtDate(product.mfg_date))
      .replace(/{{EXPIRY_DATE}}/g, fmtDate(product.expiry_date));

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Public product page error:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Minimal HTML escaping for injected template values
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Start Server
async function startServer() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`\n=============================================================`);
      console.log(`  EcoInventery Server running at http://localhost:${PORT}`);
      console.log(`  Auth: POST /api/auth/register, POST /api/auth/login (httpOnly JWT)`);
      console.log(`  Middleware: requireAuth available on protected endpoints`);
      console.log(`=============================================================\n`);
    });
  } catch (err) {
    console.error('Server startup error:', err);
    process.exit(1);
  }
}

startServer();
