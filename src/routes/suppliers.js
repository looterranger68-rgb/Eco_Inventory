const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all suppliers
router.get('/', async (req, res) => {
  try {
    const suppliers = await db.all(`
      SELECT s.*, 
             COUNT(p.id) as product_count,
             COALESCE(SUM(p.quantity * p.cost_price), 0) as inventory_value
      FROM suppliers s
      LEFT JOIN products p ON s.id = p.supplier_id
      GROUP BY s.id
      ORDER BY s.name ASC
    `);
    res.json({ success: true, data: suppliers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single supplier by ID
router.get('/:id', async (req, res) => {
  try {
    const supplier = await db.get('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
    if (!supplier) {
      return res.status(404).json({ success: false, error: 'Supplier not found' });
    }
    const products = await db.all('SELECT * FROM products WHERE supplier_id = $1 ORDER BY name ASC', [req.params.id]);
    res.json({ success: true, data: { ...supplier, products } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create supplier
router.post('/', async (req, res) => {
  try {
    const { name, contact_person, email, phone, lead_time_days = 7, payment_terms = 'Net 30', notes = '' } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: 'Supplier name is required.' });
    }

    const result = await db.run(
      `INSERT INTO suppliers (name, contact_person, email, phone, lead_time_days, payment_terms, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name.trim(), contact_person || '', email || '', phone || '', parseInt(lead_time_days, 10) || 7, payment_terms || 'Net 30', notes || '']
    );

    const newId = db.type === 'sqlite' ? result.lastID : result.id;
    const created = await db.get('SELECT * FROM suppliers WHERE id = $1', [newId]);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update supplier
router.put('/:id', async (req, res) => {
  try {
    const { name, contact_person, email, phone, lead_time_days, payment_terms, notes } = req.body;
    const id = req.params.id;

    await db.run(
      `UPDATE suppliers 
       SET name = $1, contact_person = $2, email = $3, phone = $4, lead_time_days = $5, payment_terms = $6, notes = $7
       WHERE id = $8`,
      [name, contact_person, email, phone, parseInt(lead_time_days, 10) || 7, payment_terms, notes, id]
    );

    const updated = await db.get('SELECT * FROM suppliers WHERE id = $1', [id]);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE supplier
router.delete('/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM suppliers WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Supplier deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
