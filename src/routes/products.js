const express = require('express');
const router = express.Router();
const db = require('../db');
const { stringify } = require('csv-stringify/sync');
const { parse } = require('csv-parse/sync');
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

// GET all products with optional query filtering
router.get('/products', async (req, res) => {
  try {
    const { search, category, low_stock, sort_by } = req.query;
    let sql = `
      SELECT p.*, s.name as supplier_name, s.lead_time_days as supplier_lead_time 
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      const term = `%${search.trim()}%`;
      params.push(term);
      const p1 = params.length;
      params.push(term);
      const p2 = params.length;
      sql += ` AND (p.name LIKE $${p1} OR p.sku LIKE $${p2})`;
    }

    if (category && category !== 'all') {
      params.push(category);
      sql += ` AND p.category = $${params.length}`;
    }

    if (low_stock === 'true') {
      sql += ` AND p.quantity <= p.min_threshold`;
    }

    if (sort_by === 'quantity_asc') {
      sql += ` ORDER BY p.quantity ASC`;
    } else if (sort_by === 'quantity_desc') {
      sql += ` ORDER BY p.quantity DESC`;
    } else if (sort_by === 'name_asc') {
      sql += ` ORDER BY p.name ASC`;
    } else if (sort_by === 'value_desc') {
      sql += ` ORDER BY (p.quantity * p.cost_price) DESC`;
    } else {
      sql += ` ORDER BY p.id DESC`;
    }

    const products = await db.all(sql, params);
    res.json({ success: true, count: products.length, data: products });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single product by ID
router.get('/products/:id', async (req, res) => {
  try {
    const product = await db.get(
      `SELECT p.*, s.name as supplier_name 
       FROM products p 
       LEFT JOIN suppliers s ON p.supplier_id = s.id 
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const logs = await db.all(
      `SELECT * FROM stock_logs WHERE product_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...product, logs } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create product
router.post('/products', async (req, res) => {
  try {
    const {
      sku,
      name,
      category,
      quantity = 0,
      min_threshold = 10,
      cost_price = 0,
      selling_price = 0,
      supplier_id = null,
      unit = 'pcs',
      location = 'Main Warehouse'
    } = req.body;

    if (!sku || !name || !category) {
      return res.status(400).json({ success: false, error: 'SKU, Name, and Category are required.' });
    }

    const existing = await db.get('SELECT id FROM products WHERE sku = $1', [sku.trim()]);
    if (existing) {
      return res.status(400).json({ success: false, error: `Product with SKU "${sku}" already exists.` });
    }

    const result = await db.run(
      `INSERT INTO products (sku, name, category, quantity, min_threshold, cost_price, selling_price, supplier_id, unit, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        sku.trim().toUpperCase(),
        name.trim(),
        category.trim(),
        parseInt(quantity, 10) || 0,
        parseInt(min_threshold, 10) || 10,
        parseFloat(cost_price) || 0,
        parseFloat(selling_price) || 0,
        supplier_id ? parseInt(supplier_id, 10) : null,
        unit || 'pcs',
        location || 'Main Warehouse'
      ]
    );

    const newId = db.type === 'sqlite' ? result.lastID : result.id;

    if (quantity > 0 && newId) {
      await db.run(
        `INSERT INTO stock_logs (product_id, change_qty, previous_qty, new_qty, type, reference_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newId, quantity, 0, quantity, 'adjustment', 'INIT', 'Initial creation stock entry']
      );
    }

    const created = await db.get('SELECT * FROM products WHERE id = $1', [newId]);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error('Product create error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update product
router.put('/products/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await db.get('SELECT * FROM products WHERE id = $1', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const {
      sku = existing.sku,
      name = existing.name,
      category = existing.category,
      min_threshold = existing.min_threshold,
      cost_price = existing.cost_price,
      selling_price = existing.selling_price,
      supplier_id = existing.supplier_id,
      unit = existing.unit,
      location = existing.location,
      status = existing.status
    } = req.body;

    await db.run(
      `UPDATE products 
       SET sku = $1, name = $2, category = $3, min_threshold = $4, cost_price = $5, selling_price = $6, supplier_id = $7, unit = $8, location = $9, status = $10, updated_at = CURRENT_TIMESTAMP
       WHERE id = $11`,
      [
        sku.trim().toUpperCase(),
        name.trim(),
        category.trim(),
        parseInt(min_threshold, 10),
        parseFloat(cost_price),
        parseFloat(selling_price),
        supplier_id ? parseInt(supplier_id, 10) : null,
        unit,
        location,
        status,
        id
      ]
    );

    const updated = await db.get('SELECT * FROM products WHERE id = $1', [id]);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST adjust inventory quantity (Audit Trail)
router.post('/products/:id/adjust', async (req, res) => {
  try {
    const id = req.params.id;
    const { change_qty, type = 'adjustment', notes = '', reference_id = '' } = req.body;
    const delta = parseInt(change_qty, 10);

    if (isNaN(delta) || delta === 0) {
      return res.status(400).json({ success: false, error: 'Valid non-zero change_qty is required.' });
    }

    const product = await db.get('SELECT * FROM products WHERE id = $1', [id]);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const newQty = Math.max(0, product.quantity + delta);

    await db.run('UPDATE products SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newQty, id]);

    await db.run(
      `INSERT INTO stock_logs (product_id, change_qty, previous_qty, new_qty, type, reference_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, delta, product.quantity, newQty, type, reference_id || 'MANUAL-ADJ', notes || `Manual stock adjustment (${delta > 0 ? '+' : ''}${delta})`]
    );

    res.json({
      success: true,
      data: {
        product_id: id,
        previous_qty: product.quantity,
        new_qty: newQty,
        change_qty: delta
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE product
router.delete('/products/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await db.run('DELETE FROM products WHERE id = $1', [id]);
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET categories
router.get('/categories', async (req, res) => {
  try {
    const categories = await db.all('SELECT DISTINCT category as name FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category ASC');
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CSV Export
router.get('/export/csv', async (req, res) => {
  try {
    const products = await db.all(`
      SELECT p.sku, p.name, p.category, p.quantity, p.min_threshold, p.cost_price, p.selling_price, p.unit, p.location, s.name as supplier
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.id ASC
    `);

    const csvOutput = stringify(products, {
      header: true,
      columns: ['sku', 'name', 'category', 'quantity', 'min_threshold', 'cost_price', 'selling_price', 'unit', 'location', 'supplier']
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ecoinventory_catalog.csv"');
    res.send(csvOutput);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CSV Import
router.post('/import/csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No CSV file uploaded' });
    }

    const records = parse(req.file.buffer.toString(), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    let importedCount = 0;
    for (const row of records) {
      if (!row.sku || !row.name) continue;

      const existing = await db.get('SELECT id FROM products WHERE sku = $1', [row.sku]);
      if (existing) {
        await db.run(
          `UPDATE products 
           SET name = $1, category = $2, quantity = $3, min_threshold = $4, cost_price = $5, selling_price = $6, unit = $7, location = $8, updated_at = CURRENT_TIMESTAMP
           WHERE id = $9`,
          [
            row.name,
            row.category || 'General',
            parseInt(row.quantity, 10) || 0,
            parseInt(row.min_threshold, 10) || 10,
            parseFloat(row.cost_price) || 0,
            parseFloat(row.selling_price) || 0,
            row.unit || 'pcs',
            row.location || 'Main Warehouse',
            existing.id
          ]
        );
      } else {
        await db.run(
          `INSERT INTO products (sku, name, category, quantity, min_threshold, cost_price, selling_price, unit, location)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            row.sku.toUpperCase(),
            row.name,
            row.category || 'General',
            parseInt(row.quantity, 10) || 0,
            parseInt(row.min_threshold, 10) || 10,
            parseFloat(row.cost_price) || 0,
            parseFloat(row.selling_price) || 0,
            row.unit || 'pcs',
            row.location || 'Main Warehouse'
          ]
        );
      }
      importedCount++;
    }

    res.json({ success: true, message: `Successfully processed ${importedCount} items.` });
  } catch (err) {
    res.status(500).json({ success: false, error: 'CSV parsing error: ' + err.message });
  }
});

module.exports = router;
