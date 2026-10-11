const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const QR_DIR = path.join(__dirname, '../../public/qr');
const DEFAULT_BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Clean, user-facing error message; never leaks internals to the client.
function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// YYYY-MM-DD date validation. Returns { value } or { error }.
function parseDate(value, field) {
  if (value === undefined || value === null || value === '') {
    return { value: null };
  }
  const str = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return { error: `${field} must be in YYYY-MM-DD format.` };
  }
  const d = new Date(`${str}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== str) {
    return { error: `${field} must be a valid calendar date (YYYY-MM-DD).` };
  }
  return { value: str };
}

// Numeric helper: accepts numbers or numeric strings, rejects NaN/negatives.
function parseNumber(value, field, { min = null, integer = false } = {}) {
  if (value === undefined || value === null || value === '') return { value: null };
  const n = integer ? Number.parseInt(value, 10) : Number(value);
  if (Number.isNaN(n)) return { error: `${field} must be a number.` };
  if (min !== null && n < min) return { error: `${field} must be at least ${min}.` };
  return { value: n };
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'product';
}

// ---------------------------------------------------------------------------
// Validation shared by POST (create) and PUT (update).
// In partial mode (PUT), missing fields fall back to the existing row so
// clients can send only the fields they want to change.
// ---------------------------------------------------------------------------
function validateProductInput(body, existing = null) {
  const partial = existing !== null;
  const errors = [];

  const name = body.name !== undefined ? String(body.name).trim() : (existing ? existing.name : '');
  const category = body.category !== undefined ? String(body.category).trim() : (existing ? existing.category : '');
  if (!name) errors.push('Name is required.');
  if (!category) errors.push('Category is required.');

  // Dates: expiry_date must be strictly after mfg_date when both are present.
  const mfg = parseDate(body.mfg_date !== undefined ? body.mfg_date : (existing ? existing.mfg_date : null), 'mfg_date');
  const expiry = parseDate(body.expiry_date !== undefined ? body.expiry_date : (existing ? existing.expiry_date : null), 'expiry_date');
  if (mfg.error) errors.push(mfg.error);
  if (expiry.error) errors.push(expiry.error);
  if (mfg.value && expiry.value && expiry.value <= mfg.value) {
    errors.push('expiry_date must be after mfg_date.');
  }

  const quantity = parseNumber(
    body.quantity !== undefined ? body.quantity : (existing ? existing.quantity : 0),
    'quantity', { min: 0, integer: true }
  );
  if (quantity.error) errors.push(quantity.error);

  const price = parseNumber(
    body.price !== undefined ? body.price : (existing ? existing.price : 0),
    'price', { min: 0 }
  );
  if (price.error) errors.push(price.error);

  if (errors.length > 0) return { errors };

  return {
    data: {
      name,
      category,
      mfg_date: mfg.value,
      expiry_date: expiry.value,
      quantity: quantity.value === null ? 0 : quantity.value,
      price: price.value === null ? 0 : price.value
    }
  };
}

// ---------------------------------------------------------------------------
// POST /api/products — create a product for the signed-in seller
// ---------------------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  try {
    const v = validateProductInput(req.body || {});
    if (v.errors) return sendError(res, 400, v.errors.join(' '));
    const data = v.data;

    const dupe = await db.get(
      'SELECT id FROM products WHERE seller_id = $1 AND LOWER(name) = LOWER($2)',
      [req.seller.id, data.name]
    );
    if (dupe) {
      return sendError(res, 400, `You already have a product named "${data.name}".`);
    }

    // Generate a unique slug for the public QR listing page
    let slug = slugify(data.name);
    let suffix = Date.now().toString(36);
    let clash = await db.get('SELECT id FROM products WHERE slug = $1', [`${slug}-${suffix}`]);
    while (clash) {
      suffix = Math.random().toString(36).slice(2, 8);
      clash = await db.get('SELECT id FROM products WHERE slug = $1', [`${slug}-${suffix}`]);
    }
    slug = `${slug}-${suffix}`;

    const result = await db.run(
      `INSERT INTO products (seller_id, name, category, mfg_date, expiry_date, quantity, price, slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.seller.id, data.name, data.category, data.mfg_date, data.expiry_date, data.quantity, data.price, slug]
    );

    const newId = db.type === 'sqlite' ? result.lastID : result.id;
    const created = await db.get(
      'SELECT id, name, category, mfg_date, expiry_date, quantity, price, slug, qr_code_path, created_at FROM products WHERE id = $1',
      [newId]
    );
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error('Product create error:', err);
    return sendError(res, 500, 'Something went wrong while creating the product. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// GET /api/products — list the signed-in seller's products
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  try {
    const products = await db.all(
      `SELECT id, name, category, mfg_date, expiry_date, quantity, price, slug, qr_code_path, created_at
       FROM products WHERE seller_id = $1 ORDER BY id DESC`,
      [req.seller.id]
    );
    return res.json({ success: true, count: products.length, data: products });
  } catch (err) {
    console.error('Product list error:', err);
    return sendError(res, 500, 'Something went wrong while loading your products. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// PUT /api/products/:id — update (only the owning seller may update)
// ---------------------------------------------------------------------------
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, 400, 'Invalid product id.');

    const existing = await db.get('SELECT * FROM products WHERE id = $1 AND seller_id = $2', [id, req.seller.id]);
    if (!existing) return sendError(res, 404, 'Product not found.');

    const v = validateProductInput(req.body || {}, existing);
    if (v.errors) return sendError(res, 400, v.errors.join(' '));
    const data = v.data;

    const dupe = await db.get(
      'SELECT id FROM products WHERE seller_id = $1 AND LOWER(name) = LOWER($2) AND id != $3',
      [req.seller.id, data.name, id]
    );
    if (dupe) return sendError(res, 400, `You already have a product named "${data.name}".`);

    await db.run(
      `UPDATE products
       SET name = $1, category = $2, mfg_date = $3, expiry_date = $4, quantity = $5, price = $6
       WHERE id = $7`,
      [data.name, data.category, data.mfg_date, data.expiry_date, data.quantity, data.price, id]
    );

    const updated = await db.get(
      'SELECT id, name, category, mfg_date, expiry_date, quantity, price, slug, created_at FROM products WHERE id = $1',
      [id]
    );
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Product update error:', err);
    return sendError(res, 500, 'Something went wrong while updating the product. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// POST /api/products/:id/generate-qr — render QR PNG for the public page URL
// ---------------------------------------------------------------------------
router.post('/:id/generate-qr', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, 400, 'Invalid product id.');

    const product = await db.get('SELECT id, name, slug, qr_code_path FROM products WHERE id = $1 AND seller_id = $2', [id, req.seller.id]);
    if (!product) return sendError(res, 404, 'Product not found.');

    const slug = product.slug;
    const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
    const targetUrl = `${baseUrl.replace(/\/+$/, '')}/p/${slug}`;

    if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });
    const filePath = path.join(QR_DIR, `${slug}.png`);
    await QRCode.toFile(filePath, targetUrl, {
      type: 'png',
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M'
    });

    const qrPath = `/qr/${slug}.png`;
    await db.run('UPDATE products SET qr_code_path = $1 WHERE id = $2', [qrPath, id]);

    return res.status(201).json({
      success: true,
      data: {
        product_id: product.id,
        slug,
        url: targetUrl,
        qr_code_path: qrPath
      }
    });
  } catch (err) {
    console.error('QR generation error:', err);
    return sendError(res, 500, 'Something went wrong while generating the QR code. Please try again.');
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/products/:id — only the owning seller may delete
// ---------------------------------------------------------------------------
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, 400, 'Invalid product id.');

    const existing = await db.get('SELECT id FROM products WHERE id = $1 AND seller_id = $2', [id, req.seller.id]);
    if (!existing) return sendError(res, 404, 'Product not found.');

    await db.run('DELETE FROM products WHERE id = $1', [id]);
    return res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (err) {
    console.error('Product delete error:', err);
    return sendError(res, 500, 'Something went wrong while deleting the product. Please try again.');
  }
});

module.exports = router;
