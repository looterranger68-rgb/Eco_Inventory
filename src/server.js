require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const { initSchema } = require('./db/schema');
const { seedDatabase } = require('./db/seed');

const productsRouter = require('./routes/products');
const suppliersRouter = require('./routes/suppliers');
const ordersRouter = require('./routes/orders');
const aiRouter = require('./routes/ai');
const dashboardRouter = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api', productsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/ai', aiRouter);
app.use('/api/dashboard', dashboardRouter);

// Database Health endpoint
app.get('/api/health', (req, res) => {
  const db = require('./db');
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    database_type: db.type,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Fallback route to index.html for root navigation
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start Server
async function startServer() {
  try {
    await initSchema();
    await seedDatabase();

    app.listen(PORT, () => {
      console.log(`\n======================================================`);
      console.log(` EcoInventory Server running at http://localhost:${PORT}`);
      console.log(` Database: ${process.env.DATABASE_TYPE === 'postgres' ? 'PostgreSQL' : 'SQLite Local Engine'}`);
      console.log(` Multi-page frontend served from /public`);
      console.log(`======================================================\n`);
    });
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
}

startServer();
