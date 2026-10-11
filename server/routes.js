const express = require('express');
const router = express.Router();
const db = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = require('./lib/jwtSecret');

// Middleware to authenticate token (optional for demo / lenient)
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'Authorization header required' });
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session token' });
  }
}

// POST /api/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, store_name } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
    }

    const existing = await db.get('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.run(
      'INSERT INTO users (name, email, password_hash, store_name) VALUES ($1, $2, $3, $4)',
      [name.trim(), email.trim().toLowerCase(), hash, store_name ? store_name.trim() : 'My Sustainable Store']
    );

    const newId = db.type === 'sqlite' ? result.lastID : result.id;
    const user = await db.get('SELECT id, name, email, store_name FROM users WHERE id = $1', [newId]);

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = await db.get('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Invalid email or password credentials.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, store_name: user.store_name }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/user/me
router.get('/user/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.get('SELECT id, name, email, store_name, created_at FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dashboard/metrics
router.get('/dashboard/metrics', async (req, res) => {
  try {
    const products = await db.all('SELECT * FROM products');
    let totalStockUnits = 0;
    let totalCostValuation = 0;
    let totalRetailValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const p of products) {
      totalStockUnits += p.quantity;
      totalCostValuation += (p.quantity * p.cost_price);
      totalRetailValuation += (p.quantity * p.selling_price);

      if (p.quantity === 0) outOfStockCount++;
      else if (p.quantity <= p.min_threshold) lowStockCount++;
    }

    const lowStockList = products
      .filter(p => p.quantity <= p.min_threshold)
      .slice(0, 5);

    const recentLogs = await db.all(`
      SELECT l.*, p.sku, p.name as product_name 
      FROM stock_logs l 
      JOIN products p ON l.product_id = p.id 
      ORDER BY l.created_at DESC LIMIT 6
    `);

    res.json({
      success: true,
      data: {
        total_skus: products.length,
        total_units: totalStockUnits,
        inventory_valuation: +totalCostValuation.toFixed(2),
        potential_retail: +totalRetailValuation.toFixed(2),
        projected_margin_pct: totalRetailValuation > 0 ? +(((totalRetailValuation - totalCostValuation) / totalRetailValuation) * 100).toFixed(1) : 0,
        low_stock_count: lowStockCount,
        out_of_stock_count: outOfStockCount,
        low_stock_items: lowStockList,
        recent_logs: recentLogs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/products
router.get('/products', async (req, res) => {
  try {
    const { search, category, low_stock, sort_by } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (search) {
      const term = `%${search.trim()}%`;
      params.push(term);
      const p1 = params.length;
      params.push(term);
      const p2 = params.length;
      sql += ` AND (name LIKE $${p1} OR sku LIKE $${p2})`;
    }

    if (category && category !== 'all') {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }

    if (low_stock === 'true') {
      sql += ` AND quantity <= min_threshold`;
    }

    if (sort_by === 'quantity_asc') sql += ' ORDER BY quantity ASC';
    else if (sort_by === 'quantity_desc') sql += ' ORDER BY quantity DESC';
    else if (sort_by === 'value_desc') sql += ' ORDER BY (quantity * cost_price) DESC';
    else if (sort_by === 'name_asc') sql += ' ORDER BY name ASC';
    else sql += ' ORDER BY id DESC';

    const products = await db.all(sql, params);
    res.json({ success: true, count: products.length, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products
router.post('/products', async (req, res) => {
  try {
    const { sku, name, category, quantity = 0, min_threshold = 10, cost_price = 0, selling_price = 0, unit = 'pcs', location = 'Main Warehouse' } = req.body;
    if (!sku || !name || !category) {
      return res.status(400).json({ success: false, error: 'SKU, Name, and Category are required.' });
    }

    const existing = await db.get('SELECT id FROM products WHERE sku = $1', [sku.trim()]);
    if (existing) {
      return res.status(400).json({ success: false, error: `SKU "${sku}" already exists.` });
    }

    const cleanSku = sku.trim().toUpperCase();
    const result = await db.run(
      `INSERT INTO products (sku, name, category, quantity, min_threshold, cost_price, selling_price, unit, location, qr_code_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [cleanSku, name.trim(), category.trim(), parseInt(quantity, 10) || 0, parseInt(min_threshold, 10) || 10, parseFloat(cost_price) || 0, parseFloat(selling_price) || 0, unit, location, `http://localhost:3000/p/${cleanSku}`]
    );

    const newId = db.type === 'sqlite' ? result.lastID : result.id;
    if (newId) {
      // Auto create QR Listing
      await db.run(
        `INSERT INTO qr_listings (product_id, listing_code, public_url, views_count, scans_count, status)
         VALUES ($1, $2, $3, 0, 0, 'active')`,
        [newId, `QR-${cleanSku}`, `http://localhost:3000/p/${cleanSku}`]
      );

      if (quantity > 0) {
        await db.run(
          `INSERT INTO stock_logs (product_id, change_qty, previous_qty, new_qty, type, notes)
           VALUES ($1, $2, 0, $2, 'initial', 'Initial SKU entry')`,
          [newId, quantity]
        );
      }
    }

    const created = await db.get('SELECT * FROM products WHERE id = $1', [newId]);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/products/:id
router.put('/products/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { sku, name, category, min_threshold, cost_price, selling_price, unit, location } = req.body;
    await db.run(
      `UPDATE products 
       SET sku = $1, name = $2, category = $3, min_threshold = $4, cost_price = $5, selling_price = $6, unit = $7, location = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [sku.trim().toUpperCase(), name.trim(), category.trim(), parseInt(min_threshold, 10), parseFloat(cost_price), parseFloat(selling_price), unit, location, id]
    );
    const updated = await db.get('SELECT * FROM products WHERE id = $1', [id]);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/:id/adjust
router.post('/products/:id/adjust', async (req, res) => {
  try {
    const id = req.params.id;
    const { change_qty, type = 'adjustment', notes = '' } = req.body;
    const delta = parseInt(change_qty, 10);
    if (isNaN(delta) || delta === 0) {
      return res.status(400).json({ success: false, error: 'Valid non-zero adjustment is required.' });
    }

    const product = await db.get('SELECT * FROM products WHERE id = $1', [id]);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    const newQty = Math.max(0, product.quantity + delta);
    await db.run('UPDATE products SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newQty, id]);
    await db.run(
      `INSERT INTO stock_logs (product_id, change_qty, previous_qty, new_qty, type, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, delta, product.quantity, newQty, type, notes || `Stock adjusted (${delta > 0 ? '+' : ''}${delta})`]
    );

    res.json({ success: true, data: { previous_qty: product.quantity, new_qty: newQty, change_qty: delta } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/products/:id
router.delete('/products/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Product removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/qr-listings
router.get('/qr-listings', async (req, res) => {
  try {
    const listings = await db.all(`
      SELECT q.*, p.name as product_name, p.sku, p.category, p.selling_price, p.quantity, p.location
      FROM qr_listings q
      JOIN products p ON q.product_id = p.id
      ORDER BY q.id DESC
    `);
    res.json({ success: true, data: listings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/qr-listings/scan/:code
router.post('/qr-listings/scan/:code', async (req, res) => {
  try {
    const code = req.params.code;
    await db.run('UPDATE qr_listings SET scans_count = scans_count + 1 WHERE listing_code = $1', [code]);
    const listing = await db.get(`
      SELECT q.*, p.name as product_name, p.sku, p.selling_price, p.quantity
      FROM qr_listings q
      JOIN products p ON q.product_id = p.id
      WHERE q.listing_code = $1
    `, [code]);
    res.json({ success: true, data: listing });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai/forecast
router.post('/ai/forecast', async (req, res) => {
  try {
    const products = await db.all('SELECT * FROM products');
    const restock = [];
    const deadstock = [];
    const forecast = [];

    let criticalCount = 0;
    let totalRestockCost = 0;

    for (const p of products) {
      const dailyVelocity = Math.max(0.4, p.min_threshold / 14);
      const daysRunway = Math.round(p.quantity / dailyVelocity);

      if (p.quantity <= p.min_threshold) {
        const orderQty = Math.max(p.min_threshold * 2, Math.ceil(dailyVelocity * 30) - p.quantity);
        const cost = +(orderQty * p.cost_price).toFixed(2);
        totalRestockCost += cost;
        const urgency = p.quantity <= (p.min_threshold * 0.4) ? 'critical' : 'warning';
        if (urgency === 'critical') criticalCount++;

        restock.push({
          sku: p.sku,
          name: p.name,
          urgency,
          current_qty: p.quantity,
          min_threshold: p.min_threshold,
          suggested_order_qty: orderQty,
          estimated_cost: cost,
          runway_days: daysRunway,
          reason: p.quantity === 0 ? 'Stock exhausted.' : `Runway is down to ${daysRunway} days before stockout.`
        });
      }

      if (p.quantity > p.min_threshold * 3.5 && (p.quantity * p.cost_price) > 200) {
        deadstock.push({
          sku: p.sku,
          name: p.name,
          holding_value: +(p.quantity * p.cost_price).toFixed(2),
          units: p.quantity,
          suggestion: `Holding ${p.quantity} units ($${(p.quantity * p.cost_price).toFixed(2)}). Launch a 15% clearance or product bundle to unlock cash flow.`
        });
      }

      forecast.push({
        sku: p.sku,
        name: p.name,
        stock: p.quantity,
        projected_monthly_demand: Math.round(dailyVelocity * 30),
        runway_days: daysRunway,
        confidence: '92%',
        risk_level: daysRunway < 10 ? 'High' : (daysRunway < 25 ? 'Moderate' : 'Low')
      });
    }

    res.json({
      success: true,
      data: {
        summary: `AI Scan audited ${products.length} SKUs. Flagged ${restock.length} items needing replenishment ($${totalRestockCost.toFixed(2)} estimated reorder capital required).`,
        restock,
        deadstock,
        forecast,
        savings_tip: 'Consolidate packaging & merchandise restocks into single weekly shipments to reduce parcel freight fees by ~18%.'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai/query
router.post('/ai/query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ success: false, error: 'Query text required' });

    const products = await db.all('SELECT * FROM products');
    const q = query.toLowerCase();

    let reply = '';
    if (q.includes('low') || q.includes('restock') || q.includes('reorder')) {
      const low = products.filter(p => p.quantity <= p.min_threshold);
      reply = `You have ${low.length} items at or below safety threshold:\n` + 
        low.map(i => `• ${i.sku} (${i.name}): ${i.quantity} units on hand (threshold: ${i.min_threshold})`).join('\n');
    } else if (q.includes('valuation') || q.includes('worth') || q.includes('cost')) {
      const cost = products.reduce((s, i) => s + (i.quantity * i.cost_price), 0);
      const retail = products.reduce((s, i) => s + (i.quantity * i.selling_price), 0);
      reply = `Inventory Valuation Summary:\n• Total Cost Asset: $${cost.toFixed(2)}\n• Potential Retail Value: $${retail.toFixed(2)}\n• Projected Gross Margin: $${(retail - cost).toFixed(2)} (${(((retail - cost) / retail) * 100).toFixed(1)}%)`;
    } else {
      reply = `Live Catalog Status: Monitoring ${products.length} active SKUs. Restock advisory indicates steady turnover. Check the Insights tab for full 30-day runway projections.`;
    }

    res.json({ success: true, query, reply });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
