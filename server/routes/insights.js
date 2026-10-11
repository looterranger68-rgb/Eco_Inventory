const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { findExpiringSoon, findUnderperforming } = require('../lib/insights');

// Clean error helper
function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ---------------------------------------------------------------------------
// GET /api/insights
// Query params:
//   days (default 7)        — expiring-soon window in days
//   threshold (default 10)  — min % of stock that must have sold in 30 days
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  try {
    const days = req.query.days === undefined ? 7 : Number.parseInt(req.query.days, 10);
    const threshold = req.query.threshold === undefined ? 10 : Number.parseFloat(req.query.threshold);

    if (Number.isNaN(days) || days < 1 || days > 365) {
      return sendError(res, 400, 'days must be an integer between 1 and 365.');
    }
    if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
      return sendError(res, 400, 'threshold must be a number between 0 and 100.');
    }

    const products = await db.all(
      'SELECT id, name, quantity, price, mfg_date, expiry_date FROM products WHERE seller_id = $1',
      [req.seller.id]
    );

    // Units sold per product over the last 30 days (seller-scoped via products)
    const soldRows = await db.all(
      `SELECT s.product_id, SUM(s.quantity_sold) AS sold
       FROM sales s
       JOIN products p ON p.id = s.product_id
       WHERE p.seller_id = $1 AND s.sale_date >= datetime('now', '-30 days')
       GROUP BY s.product_id`,
      [req.seller.id]
    );
    const unitsSold = new Map(soldRows.map(r => [r.product_id, Number(r.sold) || 0]));

    const expiringSoon = findExpiringSoon(products, days);
    const underperforming = findUnderperforming(products, unitsSold, threshold);

    return res.json({ success: true, data: { totalProducts: products.length, expiringSoon, underperforming } });
  } catch (err) {
    console.error('Insights error:', err);
    return sendError(res, 500, 'Something went wrong while computing insights. Please try again.');
  }
});

module.exports = router;
