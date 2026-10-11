const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all orders
router.get('/', async (req, res) => {
  try {
    const { type, status } = req.query;
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    const orders = await db.all(sql, params);

    // Attach items
    for (const ord of orders) {
      ord.items = await db.all(
        `SELECT oi.*, p.name as product_name, p.sku 
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = $1`,
        [ord.id]
      );
    }

    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create order (sale or purchase)
router.post('/', async (req, res) => {
  try {
    const { type = 'sale', customer_or_vendor, items = [], notes = '' } = req.body;

    if (!customer_or_vendor || !items.length) {
      return res.status(400).json({ success: false, error: 'Customer/Vendor name and at least one item are required.' });
    }

    const orderNumber = (type === 'purchase' ? 'PO-' : 'ORD-') + Date.now().toString().slice(-6);
    let totalAmount = 0;

    // Validate items and calculate total
    for (const item of items) {
      const prod = await db.get('SELECT * FROM products WHERE id = $1', [item.product_id]);
      if (!prod) {
        return res.status(400).json({ success: false, error: `Product ID ${item.product_id} not found.` });
      }
      if (type === 'sale' && prod.quantity < item.quantity) {
        return res.status(400).json({
          success: false,
          error: `Insufficient inventory for "${prod.name}" (SKU: ${prod.sku}). Available: ${prod.quantity}, Requested: ${item.quantity}.`
        });
      }
      totalAmount += (item.quantity * item.unit_price);
    }

    const orderResult = await db.run(
      `INSERT INTO orders (order_number, type, customer_or_vendor, status, total_amount, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderNumber, type, customer_or_vendor.trim(), 'completed', totalAmount, notes]
    );

    const orderId = db.type === 'sqlite' ? orderResult.lastID : orderResult.id;

    // Insert items & update stock
    for (const item of items) {
      const lineTotal = item.quantity * item.unit_price;
      await db.run(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, item.product_id, item.quantity, item.unit_price, lineTotal]
      );

      // Stock adjustment
      const prod = await db.get('SELECT quantity FROM products WHERE id = $1', [item.product_id]);
      const prevQty = prod.quantity;
      const qtyDelta = type === 'sale' ? -item.quantity : item.quantity;
      const newQty = Math.max(0, prevQty + qtyDelta);

      await db.run('UPDATE products SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newQty, item.product_id]);

      await db.run(
        `INSERT INTO stock_logs (product_id, change_qty, previous_qty, new_qty, type, reference_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [item.product_id, qtyDelta, prevQty, newQty, type === 'sale' ? 'sale' : 'restock', orderNumber, `${type === 'sale' ? 'Sale to' : 'Purchase from'} ${customer_or_vendor}`]
      );
    }

    const createdOrder = await db.get('SELECT * FROM orders WHERE id = $1', [orderId]);
    res.status(201).json({ success: true, data: createdOrder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
