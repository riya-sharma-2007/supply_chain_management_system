'use client';

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    cache: "no-store"
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

function StatCard({ label, value, note }) {
  return (
    <div className="stat-card">
      <div className="muted">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState("dashboard");
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [reports, setReports] = useState(null);
  const [selectedForecast, setSelectedForecast] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadAll() {
    try {
      setError("");
      const [d, p, s, a, m, r] = await Promise.all([
        api("/dashboard"),
        api("/products"),
        api("/suppliers"),
        api("/alerts"),
        api("/movements"),
        api("/reports/summary")
      ]);
      setDashboard(d);
      setProducts(p);
      setSuppliers(s);
      setAlerts(a);
      setMovements(m);
      setReports(r);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function generateAlerts() {
    try {
      const result = await api("/alerts/generate", { method: "POST" });
      setNotice(result.message);
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function resolveAlert(id) {
    try {
      await api(`/alerts/${id}/resolve`, { method: "PATCH" });
      setNotice("Alert resolved.");
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function forecast(productId) {
    try {
      const result = await api(`/forecast/${productId}`);
      setSelectedForecast(result);
    } catch (e) {
      setError(e.message);
    }
  }

  if (!dashboard) {
    return (
      <main className="loading">
        <div>
          <h1>Smart Inventory</h1>
          <p>Connecting to the Node.js API...</p>
          {error && <div className="error-box">{error}<br />Start PostgreSQL/Redis and then run the backend.</div>}
        </div>
      </main>
    );
  }

  const lowStockProducts = products.filter(
    p => Number(p.stock_quantity) <= Number(p.reorder_level)
  );

  return (
    <main>
      <header className="topbar">
        <div>
          <div className="eyebrow">INTERNSHIP PROJECT</div>
          <h1>Smart Inventory & Supply Chain</h1>
          <p className="subtitle">Monitor stock, suppliers, demand and alerts in one place.</p>
        </div>
        <button className="refresh" onClick={loadAll}>↻ Refresh</button>
      </header>

      <nav className="nav">
        {[
          ["dashboard", "Dashboard"],
          ["inventory", "Inventory"],
          ["suppliers", "Suppliers"],
          ["alerts", "Alerts"],
          ["reports", "Reports"]
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "nav-active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error-box">{error}</div>}

      {tab === "dashboard" && (
        <>
          <section className="stats">
            <StatCard label="Total Products" value={dashboard.totalProducts} note="SKUs being tracked" />
            <StatCard label="Low Stock" value={dashboard.lowStockItems} note="Needs attention" />
            <StatCard label="Suppliers" value={dashboard.suppliers} note="Active supplier records" />
            <StatCard label="Inventory Value" value={money.format(dashboard.inventoryValue)} note="Current stock value" />
            <StatCard label="30-Day Units Sold" value={dashboard.unitsSold30Days} note="From stock movements" />
            <StatCard label="Open Alerts" value={dashboard.openAlerts} note="Actionable notifications" />
          </section>

          <section className="grid two">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Stock Watch</h2>
                  <p>Products at or below reorder level.</p>
                </div>
                <button className="small-button" onClick={generateAlerts}>Generate Alerts</button>
              </div>
              {lowStockProducts.length === 0 ? (
                <div className="empty">No low-stock products right now.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>SKU</th><th>Product</th><th>Stock</th><th>Reorder</th><th></th></tr></thead>
                    <tbody>
                      {lowStockProducts.map(p => (
                        <tr key={p.id}>
                          <td>{p.sku}</td><td>{p.name}</td>
                          <td><span className="badge danger">{p.stock_quantity}</span></td>
                          <td>{p.reorder_level}</td>
                          <td><button className="link-button" onClick={() => forecast(p.id)}>Forecast</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Recent Stock Movements</h2>
                  <p>Latest inventory activity.</p>
                </div>
              </div>
              <div className="movement-list">
                {movements.slice(0, 7).map(m => (
                  <div className="movement" key={m.id}>
                    <div>
                      <strong>{m.product_name}</strong>
                      <span>{m.note || "Stock movement"}</span>
                    </div>
                    <b className={m.movement_type === "IN" ? "in" : "out"}>
                      {m.movement_type === "IN" ? "+" : "-"}{m.quantity}
                    </b>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {tab === "inventory" && (
        <Inventory
          products={products}
          suppliers={suppliers}
          onSaved={async () => { setNotice("Inventory updated."); await loadAll(); }}
          onForecast={forecast}
          setError={setError}
        />
      )}

      {tab === "suppliers" && (
        <Suppliers
          suppliers={suppliers}
          onSaved={async () => { setNotice("Supplier added."); await loadAll(); }}
          setError={setError}
        />
      )}

      {tab === "alerts" && (
        <Alerts
          alerts={alerts}
          onResolve={resolveAlert}
          onGenerate={generateAlerts}
        />
      )}

      {tab === "reports" && <Reports reports={reports} products={products} />}

      {selectedForecast && (
        <div className="modal-backdrop" onClick={() => setSelectedForecast(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="close" onClick={() => setSelectedForecast(null)}>×</button>
            <div className="eyebrow">DEMAND FORECAST</div>
            <h2>{selectedForecast.product.name}</h2>
            <p className="muted">{selectedForecast.product.sku}</p>
            <div className="forecast-grid">
              <div><span>Avg. daily demand</span><b>{selectedForecast.averageDailyDemand}</b></div>
              <div><span>7-day forecast</span><b>{selectedForecast.forecast7Days} units</b></div>
              <div><span>Current stock</span><b>{selectedForecast.product.stock_quantity} units</b></div>
              <div><span>Estimated stock cover</span><b>{selectedForecast.daysOfStock == null ? "N/A" : `${selectedForecast.daysOfStock} days`}</b></div>
            </div>
            <div className="recommendation">{selectedForecast.recommendation}</div>
            <h3>Recent demand</h3>
            <div className="bars">
              {selectedForecast.history.map((row, i) => (
                <div className="bar-row" key={i}>
                  <span>{String(row.day).slice(5, 10)}</span>
                  <div className="bar"><i style={{ width: `${Math.min(100, row.quantity * 12)}%` }} /></div>
                  <b>{row.quantity}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Inventory({ products, suppliers, onSaved, onForecast, setError }) {
  const [movement, setMovement] = useState({
    product_id: products[0]?.id || "",
    movement_type: "IN",
    quantity: 10,
    note: ""
  });

  async function submit(e) {
    e.preventDefault();
    try {
      await api("/movements", {
        method: "POST",
        body: JSON.stringify(movement)
      });
      await onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="grid two">
      <div className="panel">
        <div className="panel-head">
          <div><h2>Inventory</h2><p>Current stock levels and reorder points.</p></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Stock</th><th>Reorder</th><th>Supplier</th><th></th></tr></thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td>{p.sku}</td>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.category}</td>
                  <td><span className={`badge ${Number(p.stock_quantity) <= Number(p.reorder_level) ? "danger" : "ok"}`}>{p.stock_quantity}</span></td>
                  <td>{p.reorder_level}</td>
                  <td>{p.supplier_name || "—"}</td>
                  <td><button className="link-button" onClick={() => onForecast(p.id)}>Forecast</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Record Stock Movement</h2>
        <p>Use IN when stock arrives and OUT when stock is sold/used.</p>
        <form onSubmit={submit} className="form">
          <label>Product
            <select value={movement.product_id} onChange={e => setMovement({...movement, product_id: e.target.value})}>
              {products.map(p => <option value={p.id} key={p.id}>{p.name} ({p.stock_quantity} in stock)</option>)}
            </select>
          </label>
          <label>Movement type
            <select value={movement.movement_type} onChange={e => setMovement({...movement, movement_type: e.target.value})}>
              <option value="IN">IN — received</option>
              <option value="OUT">OUT — sold/used</option>
            </select>
          </label>
          <label>Quantity
            <input type="number" min="1" value={movement.quantity} onChange={e => setMovement({...movement, quantity: Number(e.target.value)})} />
          </label>
          <label>Note
            <input value={movement.note} onChange={e => setMovement({...movement, note: e.target.value})} placeholder="e.g. Supplier delivery" />
          </label>
          <button className="primary">Save Movement</button>
        </form>

        <h3 className="subheading">Tech used</h3>
        <div className="tech-chips">
          <span>Next.js</span><span>Node.js</span><span>PostgreSQL</span><span>Redis</span>
        </div>
      </div>
    </section>
  );
}

function Suppliers({ suppliers, onSaved, setError }) {
  const [form, setForm] = useState({ name: "", contact_name: "", email: "", phone: "", lead_time_days: 7 });

  async function submit(e) {
    e.preventDefault();
    try {
      await api("/suppliers", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", contact_name: "", email: "", phone: "", lead_time_days: 7 });
      await onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="grid two">
      <div className="panel">
        <h2>Supplier Management</h2>
        <p>Manage supplier contacts and lead times.</p>
        <div className="supplier-cards">
          {suppliers.map(s => (
            <div className="supplier-card" key={s.id}>
              <div className="supplier-avatar">{s.name.slice(0,1)}</div>
              <div>
                <strong>{s.name}</strong>
                <span>{s.contact_name || "No contact name"}</span>
                <span>{s.email || "No email"} · {s.lead_time_days} day lead time</span>
              </div>
              <b>{s.product_count} SKUs</b>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>Add Supplier</h2>
        <p>Create a supplier record for inventory purchasing.</p>
        <form onSubmit={submit} className="form">
          <label>Supplier name<input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></label>
          <label>Contact name<input value={form.contact_name} onChange={e => setForm({...form, contact_name: e.target.value})} /></label>
          <label>Email<input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></label>
          <label>Phone<input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></label>
          <label>Lead time (days)<input type="number" min="1" value={form.lead_time_days} onChange={e => setForm({...form, lead_time_days: Number(e.target.value)})} /></label>
          <button className="primary">Add Supplier</button>
        </form>
      </div>
    </section>
  );
}

function Alerts({ alerts, onResolve, onGenerate }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>Automated Alerts</h2><p>Low-stock alerts generated from current inventory levels.</p></div>
        <button className="primary" onClick={onGenerate}>Generate Alerts</button>
      </div>
      {alerts.length === 0 ? <div className="empty">No alerts found.</div> : (
        <div className="alerts-list">
          {alerts.map(a => (
            <div className={`alert-row ${a.status === "RESOLVED" ? "resolved" : ""}`} key={a.id}>
              <div className="alert-icon">!</div>
              <div>
                <strong>{a.alert_type.replace("_", " ")}</strong>
                <p>{a.message}</p>
                <small>{new Date(a.created_at).toLocaleString("en-IN")}</small>
              </div>
              <div className="alert-action">
                <span className={`badge ${a.status === "OPEN" ? "danger" : "ok"}`}>{a.status}</span>
                {a.status === "OPEN" && <button className="link-button" onClick={() => onResolve(a.id)}>Resolve</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Reports({ reports, products }) {
  if (!reports) return <section className="panel"><p>Loading reports...</p></section>;

  const maxValue = Math.max(...reports.categories.map(c => Number(c.value)), 1);

  return (
    <section className="grid two">
      <div className="panel">
        <h2>Inventory Value by Category</h2>
        <p>Simple report from PostgreSQL inventory data.</p>
        <div className="report-bars">
          {reports.categories.map(c => (
            <div className="report-row" key={c.category}>
              <div className="report-label"><span>{c.category}</span><b>{money(c.value)}</b></div>
              <div className="bar"><i style={{ width: `${Math.max(5, Number(c.value) / maxValue * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>Supply Snapshot</h2>
        <p>Quick report for an internship demonstration.</p>
        <div className="mini-report">
          <div><span>Total SKUs</span><b>{products.length}</b></div>
          <div><span>Categories</span><b>{new Set(products.map(p => p.category)).size}</b></div>
          <div><span>IN units (30d)</span><b>{reports.last30Days.find(x => x.movement_type === "IN")?.quantity || 0}</b></div>
          <div><span>OUT units (30d)</span><b>{reports.last30Days.find(x => x.movement_type === "OUT")?.quantity || 0}</b></div>
        </div>
      </div>
    </section>
  );
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value));
}
