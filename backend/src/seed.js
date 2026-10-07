import { query } from "./db.js";

export async function initializeDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      contact_name VARCHAR(120),
      email VARCHAR(160),
      phone VARCHAR(40),
      lead_time_days INTEGER NOT NULL DEFAULT 7,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(60) UNIQUE NOT NULL,
      name VARCHAR(160) NOT NULL,
      category VARCHAR(100) NOT NULL,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 10,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      movement_type VARCHAR(10) NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      note VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
      alert_type VARCHAR(40) NOT NULL,
      message VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const supplierCount = await query("SELECT COUNT(*)::int AS count FROM suppliers");
  if (supplierCount.rows[0].count > 0) return;

  const s1 = await query(
    `INSERT INTO suppliers (name, contact_name, email, phone, lead_time_days)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    ["TechSource Supplies", "Aman Verma", "aman@techsource.example", "+91 98765 11111", 5]
  );
  const s2 = await query(
    `INSERT INTO suppliers (name, contact_name, email, phone, lead_time_days)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    ["OfficeKart Wholesale", "Neha Sharma", "neha@officekart.example", "+91 98765 22222", 8]
  );
  const s3 = await query(
    `INSERT INTO suppliers (name, contact_name, email, phone, lead_time_days)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    ["DailyNeeds Distribution", "Rohit Mehta", "rohit@dailyneeds.example", "+91 98765 33333", 6]
  );

  const products = [
    ["SKU-1001", "Wireless Mouse", "Electronics", s1.rows[0].id, 42, 15, 799],
    ["SKU-1002", "Mechanical Keyboard", "Electronics", s1.rows[0].id, 18, 12, 2499],
    ["SKU-1003", "USB-C Hub", "Electronics", s1.rows[0].id, 8, 10, 1499],
    ["SKU-2001", "A4 Printer Paper", "Office", s2.rows[0].id, 95, 30, 399],
    ["SKU-2002", "Whiteboard Marker Set", "Office", s2.rows[0].id, 14, 20, 299],
    ["SKU-3001", "Packing Tape", "Packaging", s3.rows[0].id, 55, 18, 129],
  ];

  for (const p of products) {
    const result = await query(
      `INSERT INTO products
       (sku,name,category,supplier_id,stock_quantity,reorder_level,unit_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      p
    );
    const productId = result.rows[0].id;
    const inQty = Math.max(20, p[4]);
    await query(
      `INSERT INTO stock_movements (product_id,movement_type,quantity,note)
       VALUES ($1,'IN',$2,'Initial demo stock')`,
      [productId, inQty]
    );

    // Add historical OUT movements so the forecast has meaningful data.
    for (let i = 1; i <= 10; i++) {
      const quantity = 1 + ((productId + i) % 6);
      await query(
        `INSERT INTO stock_movements
         (product_id,movement_type,quantity,note,created_at)
         VALUES ($1,'OUT',$2,'Historical demo sale',CURRENT_TIMESTAMP - ($3 || ' days')::interval)`,
        [productId, quantity, i]
      );
    }
  }
}
