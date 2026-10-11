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

-- Composite index for seller & category filtering
CREATE INDEX IF NOT EXISTS idx_products_seller_category ON products(seller_id, category);
