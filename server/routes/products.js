const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const QR_DIR = path.join(__dirname, '../../public/qr');
const DEFAULT_BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let lastQrBaseUrl = null;
const QR_OPTIONS = {
  type: 'png',
  width: 512,
  margin: 2,
  errorCorrectionLevel: 'M'
};

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

function getPublicBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');

  const protocol = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (!host || !['http', 'https'].includes(protocol)) return DEFAULT_BASE_URL;
  return `${protocol}://${host}`;
}

async function ensureQrFile(slug, baseUrl, force = false) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid product slug for QR generation.');

  const filePath = path.join(QR_DIR, `${slug}.png`);
  if (!force && fs.existsSync(filePath)) return filePath;

  fs.mkdirSync(QR_DIR, { recursive: true });
  await QRCode.toFile(filePath, `${baseUrl}/p/${slug}`, QR_OPTIONS);
  return filePath;
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

  const rawSupplierId = body.supplier_id !== undefined ? body.supplier_id : (existing ? existing.supplier_id : null);
  const supplierId = rawSupplierId === null || rawSupplierId === '' ? null : Number(rawSupplierId);
  if (supplierId !== null && (!Number.isInteger(supplierId) || supplierId < 1)) errors.push('supplier_id must be a valid supplier.');

  if (errors.length > 0) return { errors };

  return {
    data: {
      name,
      category,
      mfg_date: mfg.value,
      expiry_date: expiry.value,
      quantity: quantity.value === null ? 0 : quantity.value,
      price: price.value === null ? 0 : price.value,
      supplier_id: supplierId
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

    if (data.supplier_id !== null) {
      const supplier = await db.get('SELECT id FROM suppliers WHERE id = $1 AND seller_id = $2', [data.supplier_id, req.seller.id]);
      if (!supplier) return sendError(res, 400, 'Choose a supplier belonging to your account.');
    }

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
      `INSERT INTO products (seller_id, name, category, mfg_date, expiry_date, quantity, price, slug, supplier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [req.seller.id, data.name, data.category, data.mfg_date, data.expiry_date, data.quantity, data.price, slug, data.supplier_id]
    );

    const newId = db.type === 'sqlite' ? result.lastID : result.id;
    const created = await db.get(
      'SELECT id, name, category, mfg_date, expiry_date, quantity, price, slug, qr_code_path, supplier_id, created_at FROM products WHERE id = $1',
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
      `SELECT id, name, category, mfg_date, expiry_date, quantity, price, slug, qr_code_path, supplier_id, created_at
       FROM products WHERE seller_id = $1 ORDER BY id DESC`,
      [req.seller.id]
    );

    const baseUrl = getPublicBaseUrl(req);
    const refreshQrCodes = lastQrBaseUrl !== baseUrl;
    let qrRefreshFailed = false;
    for (const product of products) {
      if (!product.qr_code_path || !product.slug) continue;
      try {
        await ensureQrFile(product.slug, baseUrl, refreshQrCodes);
      } catch (err) {
        qrRefreshFailed = true;
        console.error(`QR image generation failed for product ${product.id}:`, err.message);
      }
    }
    if (!qrRefreshFailed) lastQrBaseUrl = baseUrl;

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

    if (data.supplier_id !== null) {
      const supplier = await db.get('SELECT id FROM suppliers WHERE id = $1 AND seller_id = $2', [data.supplier_id, req.seller.id]);
      if (!supplier) return sendError(res, 400, 'Choose a supplier belonging to your account.');
    }

    const dupe = await db.get(
      'SELECT id FROM products WHERE seller_id = $1 AND LOWER(name) = LOWER($2) AND id != $3',
      [req.seller.id, data.name, id]
    );
    if (dupe) return sendError(res, 400, `You already have a product named "${data.name}".`);

    await db.run(
      `UPDATE products
       SET name = $1, category = $2, mfg_date = $3, expiry_date = $4, quantity = $5, price = $6, supplier_id = $7
       WHERE id = $8 AND seller_id = $9`,
      [data.name, data.category, data.mfg_date, data.expiry_date, data.quantity, data.price, data.supplier_id, id, req.seller.id]
    );

    const updated = await db.get(
      'SELECT id, name, category, mfg_date, expiry_date, quantity, price, slug, supplier_id, created_at FROM products WHERE id = $1',
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
    const baseUrl = getPublicBaseUrl(req);
    const targetUrl = `${baseUrl}/p/${slug}`;

    await ensureQrFile(slug, baseUrl, true);

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

    const hasOrderHistory = await db.get(`SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1 AND o.seller_id = $2 LIMIT 1`, [id, req.seller.id]);
    if (hasOrderHistory) return sendError(res, 409, 'This product is in order history and cannot be deleted. Set its stock to zero instead.');

    await db.run('DELETE FROM products WHERE id = $1', [id]);
    return res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (err) {
    console.error('Product delete error:', err);
    return sendError(res, 500, 'Something went wrong while deleting the product. Please try again.');
  }
});

module.exports = router;
