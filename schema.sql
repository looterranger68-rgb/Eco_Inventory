-- ============================================================================
-- EcoInventery PostgreSQL Database Schema
-- Plain SQL (No ORM required)
-- ============================================================================

-- Ensure UUID or cryptographic extensions if needed (optional)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. Table: sellers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sellers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 2. Table: products
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    mfg_date DATE,
    expiry_date DATE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    qr_code_path VARCHAR(500),
    slug VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 3. Table: sales
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_sold INTEGER NOT NULL CHECK (quantity_sold > 0),
    sale_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seller-scoped supplier directory and optional product association
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    lead_time_days INTEGER NOT NULL DEFAULT 7,
    payment_terms TEXT NOT NULL DEFAULT 'Net 30',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;

-- Seller-scoped orders; deleting products with transaction history is blocked.
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    order_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('sale', 'purchase')),
    customer_or_vendor TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    total_price NUMERIC(10, 2) NOT NULL
);
CREATE TABLE IF NOT EXISTS store_settings (
    seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (seller_id, key)
);
CREATE TABLE IF NOT EXISTS stock_logs (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    change_qty INTEGER NOT NULL,
    previous_qty INTEGER NOT NULL,
    new_qty INTEGER NOT NULL,
    type TEXT NOT NULL,
    reference_id TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 4. Indexes for Query Performance Optimization
-- ----------------------------------------------------------------------------
-- Index on seller_id for fast catalog retrieval per seller
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products(seller_id);

-- Index on expiry_date for efficient expiry tracking, waste mitigation, and FIFO audits
CREATE INDEX IF NOT EXISTS idx_products_expiry_date ON products(expiry_date);

-- Index on product_id and sale_date for sales velocity & time-series aggregation
CREATE INDEX IF NOT EXISTS idx_sales_product_id ON sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_suppliers_seller_id ON suppliers(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_stock_logs_seller_id ON stock_logs(seller_id);

-- Composite index for seller & category filtering
CREATE INDEX IF NOT EXISTS idx_products_seller_category ON products(seller_id, category);
