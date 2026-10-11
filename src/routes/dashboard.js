const express = require('express');
const router = express.Router();
const db = require('../db');

// GET overall store metrics
router.get('/metrics', async (req, res) => {
  try {
    const products = await db.all('SELECT * FROM products');
    const suppliers = await db.all('SELECT * FROM suppliers');
    const orders = await db.all('SELECT * FROM orders');
    const recentLogs = await db.all(`
      SELECT l.*, p.name as product_name, p.sku 
      FROM stock_logs l 
      JOIN products p ON l.product_id = p.id 
      ORDER BY l.created_at DESC LIMIT 8
    `);

    let totalStockUnits = 0;
    let totalCostValuation = 0;
    let totalRetailValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const p of products) {
      totalStockUnits += p.quantity;
      totalCostValuation += (p.quantity * p.cost_price);
      totalRetailValuation += (p.quantity * p.selling_price);

      if (p.quantity === 0) {
        outOfStockCount++;
      } else if (p.quantity <= p.min_threshold) {
        lowStockCount++;
      }
    }

    const totalSalesVolume = orders
      .filter(o => o.type === 'sale')
      .reduce((sum, o) => sum + (o.total_amount || 0), 0);

    const lowStockItems = products
      .filter(p => p.quantity <= p.min_threshold)
      .sort((a, b) => (a.quantity / a.min_threshold) - (b.quantity / b.min_threshold))
      .slice(0, 6);

    res.json({
      success: true,
      data: {
        total_skus: products.length,
        total_stock_units: totalStockUnits,
        inventory_valuation: +totalCostValuation.toFixed(2),
        potential_revenue: +totalRetailValuation.toFixed(2),
        projected_margin_pct: totalRetailValuation > 0 ? +(((totalRetailValuation - totalCostValuation) / totalRetailValuation) * 100).toFixed(1) : 0,
        low_stock_count: lowStockCount,
        out_of_stock_count: outOfStockCount,
        total_suppliers: suppliers.length,
        total_sales_revenue: +totalSalesVolume.toFixed(2),
        low_stock_items: lowStockItems,
        recent_activity: recentLogs
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET settings
router.get('/settings', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM store_settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    // Mask sensitive key if present
    if (settings.gemini_api_key) {
      settings.gemini_api_key_masked = settings.gemini_api_key.slice(0, 4) + '...' + settings.gemini_api_key.slice(-4);
      settings.has_gemini_key = true;
      delete settings.gemini_api_key;
    } else {
      settings.has_gemini_key = false;
    }
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST save settings
router.post('/settings', async (req, res) => {
  try {
    const { store_name, currency, currency_symbol, low_stock_global_threshold, gemini_api_key } = req.body;

    if (store_name !== undefined) await db.run('INSERT OR REPLACE INTO store_settings (key, value) VALUES ($1, $2)', ['store_name', store_name]);
    if (currency !== undefined) await db.run('INSERT OR REPLACE INTO store_settings (key, value) VALUES ($1, $2)', ['currency', currency]);
    if (currency_symbol !== undefined) await db.run('INSERT OR REPLACE INTO store_settings (key, value) VALUES ($1, $2)', ['currency_symbol', currency_symbol]);
    if (low_stock_global_threshold !== undefined) await db.run('INSERT OR REPLACE INTO store_settings (key, value) VALUES ($1, $2)', ['low_stock_global_threshold', low_stock_global_threshold.toString()]);
    if (gemini_api_key !== undefined && gemini_api_key.trim().length > 0) {
      await db.run('INSERT OR REPLACE INTO store_settings (key, value) VALUES ($1, $2)', ['gemini_api_key', gemini_api_key.trim()]);
    }

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
