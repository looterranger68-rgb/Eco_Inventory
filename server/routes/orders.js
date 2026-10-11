const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const type = ['sale', 'purchase'].includes(req.query.type) ? req.query.type : null;
    const orders = type
      ? await db.all('SELECT * FROM orders WHERE seller_id = $1 AND type = $2 ORDER BY created_at DESC, id DESC', [req.seller.id, type])
      : await db.all('SELECT * FROM orders WHERE seller_id = $1 ORDER BY created_at DESC, id DESC', [req.seller.id]);
    for (const order of orders) {
      order.items = await db.all(`SELECT oi.*, p.name AS product_name, p.id AS product_id
        FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1`, [order.id]);
    }
    res.json({ success: true, data: orders });
  } catch (err) {
    console.error('Order list error:', err);
    res.status(500).json({ success: false, error: 'Could not load orders.' });
  }
});

router.post('/', async (req, res) => {
  const { type = 'sale', customer_or_vendor, items = [], notes = '' } = req.body || {};
  if (!['sale', 'purchase'].includes(type)) return res.status(400).json({ success: false, error: 'Choose sale or purchase.' });
  if (!String(customer_or_vendor || '').trim() || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Enter a customer or vendor and at least one item.' });
  }

  try {
    const lines = [];
    for (const item of items) {
      const productId = Number.parseInt(item.product_id, 10);
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price);
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({ success: false, error: 'Each item needs a valid product, positive whole quantity, and non-negative price.' });
      }
      const product = await db.get('SELECT id, name, quantity FROM products WHERE id = $1 AND seller_id = $2', [productId, req.seller.id]);
      if (!product) return res.status(400).json({ success: false, error: 'One of the selected products was not found.' });
      if (type === 'sale' && product.quantity < quantity) {
        return res.status(400).json({ success: false, error: `Not enough stock for ${product.name}. Available: ${product.quantity}.` });
      }
      lines.push({ product, quantity, unitPrice });
    }

    const orderNumber = `${type === 'sale' ? 'ORD' : 'PO'}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const createOrder = () => {
      const run = (sql, params) => db.raw.prepare(sql.replace(/\$\d+/g, '?')).run(...params);
      const orderResult = run(`INSERT INTO orders (seller_id, order_number, type, customer_or_vendor, total_amount, notes)
        VALUES ($1, $2, $3, $4, $5, $6)`, [req.seller.id, orderNumber, type, String(customer_or_vendor).trim(), total, String(notes || '').trim()]);
      const orderId = Number(orderResult.lastInsertRowid);
      for (const line of lines) {
        const lineTotal = line.quantity * line.unitPrice;
        run(`INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5)`,
          [orderId, line.product.id, line.quantity, line.unitPrice, lineTotal]);
        const delta = type === 'sale' ? -line.quantity : line.quantity;
        const newQuantity = line.product.quantity + delta;
        run('UPDATE products SET quantity = $1 WHERE id = $2 AND seller_id = $3', [newQuantity, line.product.id, req.seller.id]);
        run(`INSERT INTO stock_logs (seller_id, product_id, change_qty, previous_qty, new_qty, type, reference_id, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [req.seller.id, line.product.id, delta, line.product.quantity, newQuantity,
          type === 'sale' ? 'sale' : 'restock', orderNumber, `${type === 'sale' ? 'Sale to' : 'Purchase from'} ${customer_or_vendor}`]);
        if (type === 'sale') run('INSERT INTO sales (product_id, quantity_sold) VALUES ($1, $2)', [line.product.id, line.quantity]);
      }
      return orderId;
    };

    const orderId = db.type === 'sqlite' ? db.raw.transaction(createOrder)() : await db.transaction(async tx => {
      const created = await tx.get(`INSERT INTO orders (seller_id, order_number, type, customer_or_vendor, total_amount, notes)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [req.seller.id, orderNumber, type, String(customer_or_vendor).trim(), total, String(notes || '').trim()]);
      for (const line of lines) {
        const lineTotal = line.quantity * line.unitPrice;
        await tx.run('INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5)',
          [created.id, line.product.id, line.quantity, line.unitPrice, lineTotal]);
        const delta = type === 'sale' ? -line.quantity : line.quantity;
        const newQuantity = line.product.quantity + delta;
        await tx.run('UPDATE products SET quantity = $1 WHERE id = $2 AND seller_id = $3', [newQuantity, line.product.id, req.seller.id]);
        await tx.run(`INSERT INTO stock_logs (seller_id, product_id, change_qty, previous_qty, new_qty, type, reference_id, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [req.seller.id, line.product.id, delta, line.product.quantity, newQuantity,
          type === 'sale' ? 'sale' : 'restock', orderNumber, `${type === 'sale' ? 'Sale to' : 'Purchase from'} ${customer_or_vendor}`]);
        if (type === 'sale') await tx.run('INSERT INTO sales (product_id, quantity_sold) VALUES ($1, $2)', [line.product.id, line.quantity]);
      }
      return created.id;
    });
    const order = await db.get('SELECT * FROM orders WHERE id = $1 AND seller_id = $2', [orderId, req.seller.id]);
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    console.error('Order create error:', err);
    res.status(500).json({ success: false, error: 'Could not record this order. Inventory was not changed.' });
  }
});

module.exports = router;
