const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateInventoryInsights, answerNaturalLanguageQuery } = require('../services/aiService');

// POST generate complete inventory forecasting & optimization report
router.post('/forecast', async (req, res) => {
  try {
    const products = await db.all(`
      SELECT p.*, s.name as supplier_name, s.lead_time_days as supplier_lead_time 
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.id ASC
    `);

    const orders = await db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50');
    const suppliers = await db.all('SELECT * FROM suppliers');

    const apiKeySetting = await db.get('SELECT value FROM store_settings WHERE key = $1', ['gemini_api_key']);
    const apiKey = apiKeySetting ? apiKeySetting.value : (process.env.GEMINI_API_KEY || '');

    const insights = await generateInventoryInsights(products, orders, suppliers, apiKey);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      provider: (apiKey && apiKey.length > 10) ? 'Gemini 1.5' : 'EcoInventory Deterministic Intelligence',
      data: insights
    });
  } catch (err) {
    console.error('AI forecast error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST interactive AI assistant query
router.post('/query', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, error: 'Query text is required.' });
    }

    const products = await db.all(`
      SELECT p.*, s.name as supplier_name 
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
    `);
    const orders = await db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 30');
    const suppliers = await db.all('SELECT * FROM suppliers');

    const apiKeySetting = await db.get('SELECT value FROM store_settings WHERE key = $1', ['gemini_api_key']);
    const apiKey = apiKeySetting ? apiKeySetting.value : (process.env.GEMINI_API_KEY || '');

    const reply = await answerNaturalLanguageQuery(query, products, orders, suppliers, apiKey);

    res.json({ success: true, query, reply });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
