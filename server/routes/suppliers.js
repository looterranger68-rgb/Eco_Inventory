const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const data = await db.all(`
      SELECT s.*, COUNT(p.id) AS product_count,
             COALESCE(SUM(p.quantity * p.price), 0) AS inventory_value
      FROM suppliers s LEFT JOIN products p ON p.supplier_id = s.id AND p.seller_id = s.seller_id
      WHERE s.seller_id = $1 GROUP BY s.id ORDER BY s.name`, [req.seller.id]);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Supplier list error:', err);
    res.status(500).json({ success: false, error: 'Could not load suppliers.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, contact_person = '', email = '', phone = '', lead_time_days = 7, payment_terms = 'Net 30', notes = '' } = req.body || {};
    const leadTime = Number(lead_time_days);
    if (!String(name || '').trim()) return res.status(400).json({ success: false, error: 'Supplier name is required.' });
    if (!Number.isInteger(leadTime) || leadTime < 1 || leadTime > 365) return res.status(400).json({ success: false, error: 'Lead time must be from 1 to 365 days.' });
    const result = await db.run(`INSERT INTO suppliers (seller_id, name, contact_person, email, phone, lead_time_days, payment_terms, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [req.seller.id, String(name).trim(), contact_person, email, phone, leadTime, payment_terms, notes]);
    const data = await db.get('SELECT * FROM suppliers WHERE id = $1 AND seller_id = $2', [result.lastID, req.seller.id]);
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('Supplier create error:', err);
    res.status(500).json({ success: false, error: 'Could not save this supplier.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const existing = await db.get('SELECT id FROM suppliers WHERE id = $1 AND seller_id = $2', [id, req.seller.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'Supplier not found.' });
    const { name, contact_person = '', email = '', phone = '', lead_time_days = 7, payment_terms = 'Net 30', notes = '' } = req.body || {};
    const leadTime = Number(lead_time_days);
    if (!String(name || '').trim()) return res.status(400).json({ success: false, error: 'Supplier name is required.' });
    if (!Number.isInteger(leadTime) || leadTime < 1 || leadTime > 365) return res.status(400).json({ success: false, error: 'Lead time must be from 1 to 365 days.' });
    await db.run(`UPDATE suppliers SET name = $1, contact_person = $2, email = $3, phone = $4,
      lead_time_days = $5, payment_terms = $6, notes = $7 WHERE id = $8 AND seller_id = $9`,
    [String(name).trim(), contact_person, email, phone, leadTime, payment_terms, notes, id, req.seller.id]);
    res.json({ success: true, data: await db.get('SELECT * FROM suppliers WHERE id = $1 AND seller_id = $2', [id, req.seller.id]) });
  } catch (err) {
    console.error('Supplier update error:', err);
    res.status(500).json({ success: false, error: 'Could not update this supplier.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const result = await db.run('DELETE FROM suppliers WHERE id = $1 AND seller_id = $2', [id, req.seller.id]);
    if (!result.changes) return res.status(404).json({ success: false, error: 'Supplier not found.' });
    res.json({ success: true, message: 'Supplier deleted.' });
  } catch (err) {
    console.error('Supplier delete error:', err);
    res.status(500).json({ success: false, error: 'Could not delete this supplier.' });
  }
});

module.exports = router;
