import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { query } from "./db.js";
import { cacheGet, cacheSet, cacheDelete, connectRedis } from "./redis.js";
import { initializeDatabase } from "./seed.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function invalidateDashboard() {
  await cacheDelete("dashboard");
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  await query("SELECT 1");
  res.json({ status: "ok", database: "connected", service: "inventory-api" });
}));

app.get("/api/dashboard", asyncRoute(async (_req, res) => {
  const cached = await cacheGet("dashboard");
  if (cached) return res.json(JSON.parse(cached));

  const [products, lowStock, suppliers, inventoryValue, movements, openAlerts] =
    await Promise.all([
      query("SELECT COUNT(*)::int AS count FROM products"),
      query("SELECT COUNT(*)::int AS count FROM products WHERE stock_quantity <= reorder_level"),
      query("SELECT COUNT(*)::int AS count FROM suppliers"),
      query("SELECT COALESCE(SUM(stock_quantity * unit_price),0)::numeric(14,2) AS value FROM products"),
      query(`
        SELECT COALESCE(SUM(CASE WHEN movement_type='OUT' THEN quantity ELSE 0 END),0)::int AS units_sold
        FROM stock_movements
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
      `),
      query("SELECT COUNT(*)::int AS count FROM alerts WHERE status='OPEN'")
    ]);

  const result = {
    totalProducts: products.rows[0].count,
    lowStockItems: lowStock.rows[0].count,
    suppliers: suppliers.rows[0].count,
    inventoryValue: Number(inventoryValue.rows[0].value),
    unitsSold30Days: movements.rows[0].units_sold,
    openAlerts: openAlerts.rows[0].count
  };

  await cacheSet("dashboard", JSON.stringify(result), 45);
  res.json(result);
}));

app.get("/api/products", asyncRoute(async (_req, res) => {
  const result = await query(`
    SELECT p.*, s.name AS supplier_name
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    ORDER BY p.id DESC
  `);
  res.json(result.rows);
}));

app.post("/api/products", asyncRoute(async (req, res) => {
  const { sku, name, category, supplier_id, stock_quantity, reorder_level, unit_price } = req.body;

  if (!sku || !name || !category) {
    return res.status(400).json({ error: "SKU, name and category are required." });
  }

  const result = await query(
    `INSERT INTO products
     (sku,name,category,supplier_id,stock_quantity,reorder_level,unit_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      sku, name, category,
      supplier_id || null,
      Number(stock_quantity || 0),
      Number(reorder_level || 10),
      Number(unit_price || 0)
    ]
  );
  await invalidateDashboard();
  res.status(201).json(result.rows[0]);
}));

app.put("/api/products/:id", asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { name, category, supplier_id, stock_quantity, reorder_level, unit_price } = req.body;

  const result = await query(
    `UPDATE products
     SET name=$1, category=$2, supplier_id=$3, stock_quantity=$4,
         reorder_level=$5, unit_price=$6, updated_at=CURRENT_TIMESTAMP
     WHERE id=$7 RETURNING *`,
    [
      name, category, supplier_id || null,
      Number(stock_quantity || 0),
      Number(reorder_level || 10),
      Number(unit_price || 0),
      id
    ]
  );

  if (!result.rowCount) return res.status(404).json({ error: "Product not found." });
  await invalidateDashboard();
  res.json(result.rows[0]);
}));

app.delete("/api/products/:id", asyncRoute(async (req, res) => {
  const result = await query("DELETE FROM products WHERE id=$1 RETURNING id", [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Product not found." });
  await invalidateDashboard();
  res.json({ message: "Product deleted." });
}));

app.get("/api/suppliers", asyncRoute(async (_req, res) => {
  const result = await query(`
    SELECT s.*, COUNT(p.id)::int AS product_count
    FROM suppliers s
    LEFT JOIN products p ON p.supplier_id=s.id
    GROUP BY s.id
    ORDER BY s.id DESC
  `);
  res.json(result.rows);
}));

app.post("/api/suppliers", asyncRoute(async (req, res) => {
  const { name, contact_name, email, phone, lead_time_days } = req.body;
  if (!name) return res.status(400).json({ error: "Supplier name is required." });

  const result = await query(
    `INSERT INTO suppliers (name,contact_name,email,phone,lead_time_days)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, contact_name || "", email || "", phone || "", Number(lead_time_days || 7)]
  );
  await invalidateDashboard();
  res.status(201).json(result.rows[0]);
}));

app.get("/api/alerts", asyncRoute(async (_req, res) => {
  const result = await query(`
    SELECT a.*, p.name AS product_name, p.sku
    FROM alerts a
    LEFT JOIN products p ON p.id=a.product_id
    ORDER BY a.created_at DESC
  `);
  res.json(result.rows);
}));

app.post("/api/alerts/generate", asyncRoute(async (_req, res) => {
  const lowStock = await query(`
    SELECT id, name, stock_quantity, reorder_level
    FROM products
    WHERE stock_quantity <= reorder_level
  `);

  let created = 0;
  for (const product of lowStock.rows) {
    const exists = await query(
      `SELECT id FROM alerts
       WHERE product_id=$1 AND alert_type='LOW_STOCK' AND status='OPEN'`,
      [product.id]
    );

    if (!exists.rowCount) {
      await query(
        `INSERT INTO alerts (product_id,alert_type,message)
         VALUES ($1,'LOW_STOCK',$2)`,
        [
          product.id,
          `${product.name} (${product.stock_quantity}) is at or below its reorder level (${product.reorder_level}).`
        ]
      );
      created++;
    }
  }

  await invalidateDashboard();
  res.json({ created, message: `${created} new alert(s) generated.` });
}));

app.patch("/api/alerts/:id/resolve", asyncRoute(async (req, res) => {
  const result = await query(
    `UPDATE alerts SET status='RESOLVED' WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Alert not found." });
  await invalidateDashboard();
  res.json(result.rows[0]);
}));

app.get("/api/movements", asyncRoute(async (_req, res) => {
  const result = await query(`
    SELECT m.*, p.name AS product_name, p.sku
    FROM stock_movements m
    JOIN products p ON p.id=m.product_id
    ORDER BY m.created_at DESC
    LIMIT 100
  `);
  res.json(result.rows);
}));

app.post("/api/movements", asyncRoute(async (req, res) => {
  const { product_id, movement_type, quantity, note } = req.body;
  const qty = Number(quantity);

  if (!product_id || !["IN", "OUT"].includes(movement_type) || !Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ error: "Valid product, movement type and positive quantity are required." });
  }

  const client = await (await import("./db.js")).pool.connect();
  try {
    await client.query("BEGIN");

    const product = await client.query(
      "SELECT id, stock_quantity FROM products WHERE id=$1 FOR UPDATE",
      [product_id]
    );
    if (!product.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found." });
    }

    const current = product.rows[0].stock_quantity;
    const next = movement_type === "IN" ? current + qty : current - qty;

    if (next < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Not enough stock for this OUT movement." });
    }

    await client.query(
      `INSERT INTO stock_movements (product_id,movement_type,quantity,note)
       VALUES ($1,$2,$3,$4)`,
      [product_id, movement_type, qty, note || ""]
    );

    const updated = await client.query(
      `UPDATE products
       SET stock_quantity=$1, updated_at=CURRENT_TIMESTAMP
       WHERE id=$2 RETURNING *`,
      [next, product_id]
    );

    await client.query("COMMIT");
    await invalidateDashboard();
    res.status(201).json(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

app.get("/api/forecast/:productId", asyncRoute(async (req, res) => {
  const productResult = await query(
    "SELECT id, sku, name, stock_quantity, reorder_level FROM products WHERE id=$1",
    [req.params.productId]
  );

  if (!productResult.rowCount) return res.status(404).json({ error: "Product not found." });

  const movementResult = await query(
    `SELECT DATE(created_at) AS day, SUM(quantity)::int AS quantity
     FROM stock_movements
     WHERE product_id=$1
       AND movement_type='OUT'
       AND created_at >= CURRENT_DATE - INTERVAL '30 days'
     GROUP BY DATE(created_at)
     ORDER BY day`,
    [req.params.productId]
  );

  const rows = movementResult.rows;
  const total = rows.reduce((sum, row) => sum + Number(row.quantity), 0);
  const daysWithSales = Math.max(rows.length, 1);
  const averageDailyDemand = total / daysWithSales;
  const forecast7Days = Math.ceil(averageDailyDemand * 7);
  const currentStock = Number(productResult.rows[0].stock_quantity);
  const daysOfStock =
    averageDailyDemand > 0 ? Math.floor(currentStock / averageDailyDemand) : null;

  res.json({
    product: productResult.rows[0],
    history: rows.map(r => ({ day: r.day, quantity: Number(r.quantity) })),
    averageDailyDemand: Number(averageDailyDemand.toFixed(2)),
    forecast7Days,
    daysOfStock,
    recommendation:
      averageDailyDemand > 0 && currentStock < forecast7Days
        ? "Consider replenishing stock."
        : "Current stock covers the simple 7-day forecast."
  });
}));

app.get("/api/reports/summary", asyncRoute(async (_req, res) => {
  const category = await query(`
    SELECT category,
           COUNT(*)::int AS products,
           SUM(stock_quantity)::int AS units,
           SUM(stock_quantity * unit_price)::numeric(14,2) AS value
    FROM products
    GROUP BY category
    ORDER BY value DESC
  `);

  const movement = await query(`
    SELECT movement_type, COALESCE(SUM(quantity),0)::int AS quantity
    FROM stock_movements
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY movement_type
  `);

  res.json({
    categories: category.rows.map(r => ({
      ...r,
      value: Number(r.value)
    })),
    last30Days: movement.rows.map(r => ({
      movement_type: r.movement_type,
      quantity: Number(r.quantity)
    }))
  });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error." });
});

initializeDatabase()
  .then(connectRedis)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Inventory API running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Startup failed:", error);
    process.exit(1);
  });
