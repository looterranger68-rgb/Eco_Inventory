const db = require('./index');
const { initSchema } = require('./schema');

async function seedDatabase() {
  await initSchema();

  // Check if products already exist
  const existingProducts = await db.all('SELECT id FROM products LIMIT 1');
  if (existingProducts.length > 0) {
    console.log('ℹ Database already contains data. Skipping default seed.');
    return;
  }

  console.log('🌱 Seeding sample sustainable inventory & seller records...');

  // 1. Categories
  const categories = [
    { name: 'Apparel', description: 'Organic cotton and recycled fabric clothing' },
    { name: 'Home Goods', description: 'Zero-waste household essentials' },
    { name: 'Personal Care', description: 'Biodegradable hygiene and skincare' },
    { name: 'Stationery', description: 'Recycled paper and plant-ink notebooks' },
    { name: 'Packaging', description: 'Compostable mailers and kraft tape' }
  ];

  for (const cat of categories) {
    await db.run('INSERT INTO categories (name, description) VALUES ($1, $2)', [cat.name, cat.description]);
  }

  // 2. Suppliers
  const suppliers = [
    { name: 'Nordic Fibres Ltd', contact_person: 'Astrid Lind', email: 'orders@nordicfibres.com', phone: '+46 8 123 4567', lead_time_days: 10, payment_terms: 'Net 30', notes: 'GOTS certified organic cotton mill' },
    { name: 'TerraPak Solutions', contact_person: 'Marcus Vance', email: 'supply@terrapak.io', phone: '+1 415 555 0192', lead_time_days: 5, payment_terms: 'Net 15', notes: 'Certified FSC cardboard and cornstarch bubble mailers' },
    { name: 'Botanica Elements', contact_person: 'Elena Rossi', email: 'elena@botanicaelements.it', phone: '+39 02 8899 110', lead_time_days: 14, payment_terms: 'Net 45', notes: 'Cold-pressed natural oils & solid soap bars' },
    { name: 'CraftPaper Works', contact_person: 'Kenji Sato', email: 'sales@craftpaperworks.jp', phone: '+81 3 5555 0188', lead_time_days: 12, payment_terms: 'Net 30', notes: 'Bamboo & post-consumer recycled journals' }
  ];

  for (const sup of suppliers) {
    await db.run(
      'INSERT INTO suppliers (name, contact_person, email, phone, lead_time_days, payment_terms, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [sup.name, sup.contact_person, sup.email, sup.phone, sup.lead_time_days, sup.payment_terms, sup.notes]
    );
  }

  // 3. Products
  const products = [
    { sku: 'APP-TEE-BLK-M', name: 'Organic Cotton Crewneck T-Shirt (M, Black)', category: 'Apparel', quantity: 142, min_threshold: 40, cost_price: 9.50, selling_price: 28.00, supplier_id: 1, unit: 'pcs', location: 'Rack A-1' },
    { sku: 'APP-TEE-WHT-L', name: 'Organic Cotton Crewneck T-Shirt (L, Off-White)', category: 'Apparel', quantity: 24, min_threshold: 30, cost_price: 9.50, selling_price: 28.00, supplier_id: 1, unit: 'pcs', location: 'Rack A-2' },
    { sku: 'APP-HDY-SGE-L', name: 'Recycled Hemp Overhead Hoodie (Sage, L)', category: 'Apparel', quantity: 68, min_threshold: 20, cost_price: 24.00, selling_price: 64.00, supplier_id: 1, unit: 'pcs', location: 'Rack A-5' },
    { sku: 'HOM-BAM-CUT', name: 'Bamboo Cutlery Travel Set with Linen Pouch', category: 'Home Goods', quantity: 8, min_threshold: 25, cost_price: 3.20, selling_price: 14.50, supplier_id: 4, unit: 'sets', location: 'Bin H-04' },
    { sku: 'HOM-COP-BOT', name: 'Pure Copper Water Bottle 750ml (Hammered)', category: 'Home Goods', quantity: 45, min_threshold: 15, cost_price: 11.00, selling_price: 34.00, supplier_id: 4, unit: 'pcs', location: 'Bin H-08' },
    { sku: 'HOM-SOY-CND', name: 'Hand-Poured Soy Wax Candle (Cedar & Moss)', category: 'Home Goods', quantity: 110, min_threshold: 35, cost_price: 5.80, selling_price: 22.00, supplier_id: 3, unit: 'pcs', location: 'Bin H-12' },
    { sku: 'PC-SHM-BAR', name: 'Solid Zero-Waste Shampoo Bar (Rosemary & Mint)', category: 'Personal Care', quantity: 5, min_threshold: 30, cost_price: 2.10, selling_price: 9.00, supplier_id: 3, unit: 'bars', location: 'Bin P-02' },
    { sku: 'PC-JOJ-OIL', name: 'Organic Cold-Pressed Jojoba Oil 100ml Glass Dropper', category: 'Personal Care', quantity: 82, min_threshold: 25, cost_price: 4.50, selling_price: 18.00, supplier_id: 3, unit: 'bottles', location: 'Bin P-07' },
    { sku: 'STA-BAM-JRN', name: 'Bamboo Hardcover Dotted Journal (A5, 120gsm)', category: 'Stationery', quantity: 95, min_threshold: 20, cost_price: 4.80, selling_price: 16.50, supplier_id: 4, unit: 'pcs', location: 'Shelf S-01' },
    { sku: 'PKG-COM-MAIL-M', name: 'Compostable Bubble Mailers (Size M, Pack of 50)', category: 'Packaging', quantity: 320, min_threshold: 100, cost_price: 12.00, selling_price: 29.00, supplier_id: 2, unit: 'packs', location: 'Bay P-01' },
    { sku: 'PKG-KRF-TPE', name: 'Water-Activated Reinforced Kraft Paper Tape 50m', category: 'Packaging', quantity: 14, min_threshold: 25, cost_price: 3.50, selling_price: 11.00, supplier_id: 2, unit: 'rolls', location: 'Bay P-03' }
  ];

  for (const prod of products) {
    const res = await db.run(
      `INSERT INTO products (sku, name, category, quantity, min_threshold, cost_price, selling_price, supplier_id, unit, location) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [prod.sku, prod.name, prod.category, prod.quantity, prod.min_threshold, prod.cost_price, prod.selling_price, prod.supplier_id, prod.unit, prod.location]
    );

    const prodId = db.type === 'sqlite' ? res.lastID : 1;
    if (prodId) {
      await db.run(
        `INSERT INTO stock_logs (product_id, change_qty, previous_qty, new_qty, type, reference_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [prodId, prod.quantity, 0, prod.quantity, 'restock', 'INIT-INV-001', 'Initial stock take inventory intake']
      );
    }
  }

  // 4. Sample Recent Orders
  const sampleOrders = [
    { order_number: 'ORD-2026-0891', type: 'sale', customer_or_vendor: 'Emma Watson', status: 'completed', total_amount: 84.00, items: [{ sku: 'APP-TEE-BLK-M', qty: 3, price: 28.00 }] },
    { order_number: 'ORD-2026-0892', type: 'sale', customer_or_vendor: 'David G. (Etsy)', status: 'completed', total_amount: 54.50, items: [{ sku: 'PC-JOJ-OIL', qty: 2, price: 18.00 }, { sku: 'PC-SHM-BAR', qty: 2, price: 9.00 }] },
    { order_number: 'ORD-2026-0893', type: 'sale', customer_or_vendor: 'Studio Green Corp', status: 'completed', total_amount: 145.00, items: [{ sku: 'PKG-COM-MAIL-M', qty: 5, price: 29.00 }] },
    { order_number: 'PO-2026-0104', type: 'purchase', customer_or_vendor: 'TerraPak Solutions', status: 'pending', total_amount: 600.00, items: [{ sku: 'PKG-COM-MAIL-M', qty: 50, price: 12.00 }] }
  ];

  for (const ord of sampleOrders) {
    const oRes = await db.run(
      'INSERT INTO orders (order_number, type, customer_or_vendor, status, total_amount, notes) VALUES ($1, $2, $3, $4, $5, $6)',
      [ord.order_number, ord.type, ord.customer_or_vendor, ord.status, ord.total_amount, 'Standard shipment terms']
    );
    const ordId = db.type === 'sqlite' ? oRes.lastID : 1;
    if (ordId) {
      for (const item of ord.items) {
        const prod = await db.get('SELECT id FROM products WHERE sku = $1', [item.sku]);
        if (prod) {
          await db.run(
            'INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5)',
            [ordId, prod.id, item.qty, item.price, item.qty * item.price]
          );
        }
      }
    }
  }

  // Settings
  const defaultSettings = [
    { key: 'store_name', value: 'EcoInventery Sustainable Goods' },
    { key: 'currency', value: 'USD' },
    { key: 'currency_symbol', value: '$' },
    { key: 'low_stock_global_threshold', value: '15' },
    { key: 'ai_model', value: 'gemini-1.5-flash' },
    { key: 'ai_enabled', value: 'true' }
  ];

  for (const s of defaultSettings) {
    await db.run('INSERT OR REPLACE INTO store_settings (key, value) VALUES ($1, $2)', [s.key, s.value]);
  }

  console.log('✓ Seeding complete with sample catalog, suppliers, and order logs.');
}

if (require.main === module) {
  seedDatabase().then(() => process.exit(0)).catch(err => {
    console.error('Seed error:', err);
    process.exit(1);
  });
}

module.exports = { seedDatabase };
