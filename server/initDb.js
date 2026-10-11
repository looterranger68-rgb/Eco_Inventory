const db = require('./db');
const bcrypt = require('bcryptjs');

async function initDatabase() {
  if (db.type === 'sqlite') {
    db.raw.exec(`
      CREATE TABLE IF NOT EXISTS sellers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        mfg_date DATE,
        expiry_date DATE,
        quantity INTEGER NOT NULL DEFAULT 0,
        price REAL NOT NULL DEFAULT 0.0,
        qr_code_path TEXT,
        slug TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity_sold INTEGER NOT NULL,
        sale_date DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products(seller_id);
      CREATE INDEX IF NOT EXISTS idx_products_expiry_date ON products(expiry_date);
      CREATE INDEX IF NOT EXISTS idx_sales_product_id ON sales(product_id);
      CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
    `);
  }

  // Seed default demo seller if not exists
  const existingSeller = await db.get('SELECT id FROM sellers WHERE email = $1', ['seller@ecoinventery.com']);
  let defaultSellerId = existingSeller ? existingSeller.id : null;

  if (!existingSeller) {
    const passwordHash = bcrypt.hashSync('demo1234', 10);
    const sRes = await db.run(
      'INSERT INTO sellers (name, email, password_hash) VALUES ($1, $2, $3)',
      ['EcoSeller Demo', 'seller@ecoinventery.com', passwordHash]
    );
    defaultSellerId = db.type === 'sqlite' ? sRes.lastID : sRes.id;
  }

  // Seed sample products aligned with schema
  const existingProds = await db.all('SELECT id FROM products LIMIT 1');
  if (existingProds.length === 0 && defaultSellerId) {
    const seedItems = [
      { name: 'Organic Cotton Crewneck T-Shirt (M, Black)', category: 'Apparel', mfg_date: '2026-01-10', expiry_date: null, quantity: 142, price: 28.00, slug: 'organic-cotton-tshirt-black-m' },
      { name: 'Organic Cotton Crewneck T-Shirt (L, White)', category: 'Apparel', mfg_date: '2026-01-10', expiry_date: null, quantity: 18, price: 28.00, slug: 'organic-cotton-tshirt-white-l' },
      { name: 'Bamboo Cutlery Travel Set with Pouch', category: 'Home Goods', mfg_date: '2026-02-15', expiry_date: null, quantity: 6, price: 14.50, slug: 'bamboo-cutlery-travel-set' },
      { name: 'Solid Zero-Waste Rosemary Shampoo Bar', category: 'Personal Care', mfg_date: '2026-03-01', expiry_date: '2027-03-01', quantity: 4, price: 9.00, slug: 'rosemary-shampoo-bar' },
      { name: 'Organic Cold-Pressed Jojoba Oil 100ml', category: 'Personal Care', mfg_date: '2026-02-20', expiry_date: '2027-08-20', quantity: 76, price: 18.00, slug: 'organic-jojoba-oil-100ml' },
      { name: 'Compostable Mailers Pack of 50', category: 'Packaging', mfg_date: '2026-01-05', expiry_date: '2028-01-05', quantity: 290, price: 29.00, slug: 'compostable-mailers-pack-50' }
    ];

    for (const item of seedItems) {
      const pRes = await db.run(
        `INSERT INTO products (seller_id, name, category, mfg_date, expiry_date, quantity, price, qr_code_path, slug)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          defaultSellerId,
          item.name,
          item.category,
          item.mfg_date,
          item.expiry_date,
          item.quantity,
          item.price,
          `/qr/${item.slug}.png`,
          item.slug
        ]
      );

      const newId = db.type === 'sqlite' ? pRes.lastID : pRes.id;
      if (newId) {
        await db.run(
          `INSERT INTO sales (product_id, quantity_sold, sale_date)
           VALUES ($1, $2, CURRENT_TIMESTAMP)`,
          [newId, Math.floor(Math.random() * 5) + 1]
        );
      }
    }
  }

  console.log('✓ EcoInventery database initialized with sellers, products, & sales schema.');
}

module.exports = { initDatabase };
