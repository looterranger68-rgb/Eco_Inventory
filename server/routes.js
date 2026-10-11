const express = require('express');
const db = require('./db');
const { requireAuth } = require('./middleware/auth');

const router = express.Router();
const editableSettings = new Set(['store_name', 'currency', 'currency_symbol', 'low_stock_global_threshold']);

router.get('/dashboard/settings', requireAuth, async (req, res) => {
  try {
    const rows = await db.all('SELECT key, value FROM store_settings WHERE seller_id = $1', [req.seller.id]);
    const data = Object.fromEntries(rows.map(row => [row.key, row.value]));
    res.json({ success: true, data });
  } catch (err) {
    console.error('Settings load error:', err);
    res.status(500).json({ success: false, error: 'Could not load settings.' });
  }
});

router.post('/dashboard/settings', requireAuth, async (req, res) => {
  try {
    const entries = Object.entries(req.body || {}).filter(([key]) => editableSettings.has(key));
    for (const [key, value] of entries) {
      const cleanValue = String(value).trim();
      if (key === 'low_stock_global_threshold' && (!/^\d+$/.test(cleanValue) || Number(cleanValue) < 1 || Number(cleanValue) > 100000)) {
        return res.status(400).json({ success: false, error: 'Low-stock threshold must be a whole number from 1 to 100000.' });
      }
      if (key === 'currency_symbol' && cleanValue.length > 5) return res.status(400).json({ success: false, error: 'Currency symbol is too long.' });
      if (key === 'store_name' && (!cleanValue || cleanValue.length > 100)) return res.status(400).json({ success: false, error: 'Store name must be 1 to 100 characters.' });
      if (key === 'currency' && !/^[A-Z]{3}$/.test(cleanValue)) return res.status(400).json({ success: false, error: 'Currency must be a 3-letter code such as USD.' });
      const existing = await db.get('SELECT key FROM store_settings WHERE seller_id = $1 AND key = $2', [req.seller.id, key]);
      if (existing) await db.run('UPDATE store_settings SET value = $1 WHERE seller_id = $2 AND key = $3', [cleanValue, req.seller.id, key]);
      else await db.run('INSERT INTO store_settings (seller_id, key, value) VALUES ($1, $2, $3)', [req.seller.id, key, cleanValue]);
    }
    res.json({ success: true, message: 'Settings saved.' });
  } catch (err) {
    console.error('Settings save error:', err);
    res.status(500).json({ success: false, error: 'Could not save settings.' });
  }
});

router.get('/dashboard/metrics', requireAuth, async (req, res) => {
  try {
    const products = await db.all('SELECT id, name, quantity, price FROM products WHERE seller_id = $1', [req.seller.id]);
    const suppliers = await db.get('SELECT COUNT(*) AS count FROM suppliers WHERE seller_id = $1', [req.seller.id]);
    const orders = await db.get("SELECT COALESCE(SUM(total_amount), 0) AS total FROM orders WHERE seller_id = $1 AND type = 'sale'", [req.seller.id]);
    const stock = products.reduce((sum, product) => sum + Number(product.quantity || 0), 0);
    const value = products.reduce((sum, product) => sum + Number(product.quantity || 0) * Number(product.price || 0), 0);
    res.json({ success: true, data: { total_skus: products.length, total_stock_units: stock, inventory_valuation: +value.toFixed(2),
      potential_revenue: +value.toFixed(2), projected_margin_pct: 0, low_stock_count: products.filter(p => p.quantity > 0 && p.quantity <= 5).length,
      out_of_stock_count: products.filter(p => p.quantity === 0).length, total_suppliers: Number(suppliers.count), total_sales_revenue: Number(orders.total),
      low_stock_items: [], recent_activity: [] } });
  } catch (err) {
    console.error('Dashboard metrics error:', err);
    res.status(500).json({ success: false, error: 'Could not load dashboard metrics.' });
  }
});

router.post('/ai/forecast', requireAuth, async (req, res) => {
  try {
    const products = await db.all('SELECT id, name, category, quantity, price FROM products WHERE seller_id = $1 ORDER BY name', [req.seller.id]);
    const salesWindow = db.type === 'postgres' ? "s.sale_date >= NOW() - INTERVAL '30 days'" : "s.sale_date >= datetime('now', '-30 days')";
    const sales = await db.all(`SELECT s.product_id, COALESCE(SUM(s.quantity_sold), 0) AS units_sold
      FROM sales s JOIN products p ON p.id = s.product_id WHERE p.seller_id = $1
      AND ${salesWindow} GROUP BY s.product_id`, [req.seller.id]);
    const soldByProduct = new Map(sales.map(row => [row.product_id, Number(row.units_sold)]));
    const thresholdRow = await db.get("SELECT value FROM store_settings WHERE seller_id = $1 AND key = 'low_stock_global_threshold'", [req.seller.id]);
    const threshold = Number(thresholdRow?.value || 15);
    const restock_recommendations = products.filter(p => p.quantity <= threshold).map(p => ({
      sku: `#${p.id}`, name: p.name, urgency: p.quantity === 0 ? 'critical' : 'warning',
      recommended_order_qty: Math.max(threshold, threshold * 2 - p.quantity), estimated_cost: 0,
      supplier: 'Add supplier details to estimate sourcing.', reason: p.quantity === 0 ? 'Out of stock.' : `Stock is at or below the ${threshold}-unit alert threshold.`
    }));
    const demand_forecast = products.map(p => {
      const sold = soldByProduct.get(p.id) || 0;
      const dailyRate = sold / 30;
      const days = dailyRate > 0 ? Math.floor(p.quantity / dailyRate) : null;
      return { sku: `#${p.id}`, current_stock: p.quantity, projected_monthly_sales: sold,
        stockout_risk_days: days === null ? 'No recent sales' : days,
        status: days === null ? 'No recent sales' : days < 10 ? 'High Risk' : days < 25 ? 'Moderate' : 'Low Risk' };
    });
    res.json({ success: true, provider: 'Local inventory insights', data: { restock_recommendations, demand_forecast,
      deadstock_alerts: [], cost_savings_tip: 'Record sales consistently to improve demand and restock estimates.' } });
  } catch (err) {
    console.error('Forecast error:', err);
    res.status(500).json({ success: false, error: 'Could not calculate inventory insights.' });
  }
});

router.post('/ai/query', requireAuth, async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ success: false, error: 'Enter a question first.' });
    const products = await db.all('SELECT name, quantity, price FROM products WHERE seller_id = $1', [req.seller.id]);
    const low = products.filter(product => product.quantity <= 5);
    const totalUnits = products.reduce((sum, product) => sum + Number(product.quantity || 0), 0);
    const value = products.reduce((sum, product) => sum + Number(product.quantity || 0) * Number(product.price || 0), 0);
    let reply;
    if (/low|restock|reorder|stockout/i.test(query)) reply = `${low.length} product(s) are at 5 units or below: ${low.length ? low.map(p => `${p.name} (${p.quantity})`).join('; ') : 'none'}.`;
    else if (/value|worth|inventory/i.test(query)) reply = `Your catalog has ${products.length} products and ${totalUnits} units in stock. Estimated value at listed prices: $${value.toFixed(2)}.`;
    else reply = `Your catalog currently has ${products.length} products and ${totalUnits} units in stock. Ask about low stock or inventory value for a focused summary.`;
    res.json({ success: true, query, reply });
  } catch (err) {
    console.error('Inventory query error:', err);
    res.status(500).json({ success: false, error: 'Could not answer that inventory question.' });
  }
});

module.exports = router;
