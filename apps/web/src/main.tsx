import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import './styles/global.css';
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');

const API = import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:8787';

type Product = {
  variant_id: string;
  name: string;
  sku: string;
  selling_price_minor: number;
  variant_label: string;
};
type Business = { id: string; name: string; slug: string; member_id: string; all_outlets: number };
type SaleSummary = {
  id: string;
  receipt_number: string | null;
  outlet_id: string;
  status: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  created_at: string;
};
type SaleDetail = SaleSummary & {
  register_id: string;
  shift_id: string;
  lines: Array<{
    id: string;
    variant_id: string;
    product_name: string;
    sku: string;
    quantity: number;
    unit_price_minor: number;
    item_discount_minor: number;
    tax_minor: number;
    line_net_minor: number;
    refundable_quantity: number;
  }>;
  payments: Array<{
    method: string;
    amount_minor: number;
    received_minor: number | null;
    change_minor: number;
    reference: string | null;
  }>;
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${API}${path}`, { credentials: 'include', ...options, headers });
  const text = await response.text();
  let body: { data?: T; error?: { message: string } } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    if (!response.ok) throw new Error(text || 'Permintaan gagal');
  }
  if (!response.ok) throw new Error(body.error?.message ?? 'Permintaan gagal');
  return body.data as T;
}

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);
  const links: Array<[string, string]> = [
    ['/app/dashboard', 'Ringkasan'],
    ['/app/pos', 'Kasir'],
    ['/app/products', 'Produk'],
    ['/app/inventory', 'Stok'],
    ['/app/reports', 'Laporan'],
    ['/app/sales', 'Penjualan'],
    ['/app/refunds', 'Refund'],
  ];
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="brand" to="/app/dashboard">
          KASU<span>RO</span>
        </Link>
        <div className="workspace-label">RUANG KERJA</div>
        <nav aria-label="Navigasi workspace">
          {links.map(([href, label]) => (
            <Link className={location.pathname === href ? 'active' : ''} key={href} to={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={online ? 'status-dot online' : 'status-dot'} />
          {online ? 'Online' : 'Offline'}
          <button
            className="text-button"
            onClick={() => {
              void api('/api/v1/auth/logout', {
                method: 'POST',
                headers: { 'X-CSRF-Token': getCsrf() },
              }).then(() => {
                window.location.href = '/';
              });
            }}
          >
            Keluar
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-top">
          <div>
            <span className="workspace-kicker">OPERASIONAL</span>
            <strong> Toko aktif</strong>
          </div>
          <div className="top-actions">
            <span className={online ? 'connection' : 'connection offline'}>
              {online ? 'Terhubung' : 'Mode offline'}
            </span>
            <Link to="/app/pos" className="button small">
              Buka kasir
            </Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'authenticated'>('checking');
  useEffect(() => {
    void api('/api/v1/auth/me')
      .then(() => setState('authenticated'))
      .catch(() => navigate('/login', { replace: true }));
  }, [navigate]);
  if (state !== 'authenticated')
    return (
      <main className="not-found">
        <p>Memeriksa sesi…</p>
      </main>
    );
  return <>{children}</>;
}

function Setup() {
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState('');
  const [businessSlug, setBusinessSlug] = useState('');
  const [outletName, setOutletName] = useState('');
  const [outletCode, setOutletCode] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const business = await api<{ id: string }>('/api/v1/businesses', {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ name: businessName, slug: businessSlug }),
      });
      await api(`/api/v1/businesses/${business.id}/outlets`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ name: outletName, code: outletCode }),
      });
      await api(`/api/v1/businesses/${business.id}/setup`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ setup_step: 'products' }),
      });
      navigate('/app/dashboard', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="auth-page">
      <Link className="brand" to="/">
        KASU<span>RO</span>
      </Link>
      <form className="auth-card setup-card" onSubmit={submit}>
        <span className="workspace-kicker">LANGKAH 1 — RUANG KERJA</span>
        <h1>Siapkan toko pertama.</h1>
        <p className="form-intro">Buat konteks bisnis dan outlet sebelum transaksi pertama.</p>
        <label>
          Nama bisnis
          <div className="input-wrap">
            <input
              required
              maxLength={120}
              value={businessName}
              onChange={(event) => {
                setBusinessName(event.target.value);
                setBusinessSlug(
                  event.target.value
                    .toLowerCase()
                    .trim()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, ''),
                );
              }}
            />
          </div>
        </label>
        <label>
          Slug bisnis
          <div className="input-wrap">
            <input
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={businessSlug}
              onChange={(event) => setBusinessSlug(event.target.value.toLowerCase())}
            />
          </div>
        </label>
        <label>
          Nama outlet
          <div className="input-wrap">
            <input
              required
              maxLength={120}
              value={outletName}
              onChange={(event) => setOutletName(event.target.value)}
            />
          </div>
        </label>
        <label>
          Kode outlet
          <div className="input-wrap">
            <input
              required
              maxLength={32}
              value={outletCode}
              onChange={(event) => setOutletCode(event.target.value.toUpperCase())}
            />
          </div>
        </label>
        {error && <Notice message={error} />}
        <button className="button" disabled={saving} type="submit">
          {saving ? 'Menyimpan…' : 'Buat ruang kerja'} <span>↗</span>
        </button>
      </form>
    </main>
  );
}

function Dashboard() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        const id = items[0]?.id;
        if (id)
          return api<Record<string, number>>(`/api/v1/businesses/${id}/reports/summary`).then(
            setSummary,
          );
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">RINGKASAN</span>
          <h1>Operasional hari ini.</h1>
          <p>Angka penting untuk membuat keputusan berikutnya dengan tenang.</p>
        </div>
        <Link to="/app/pos" className="button">
          Mulai transaksi
        </Link>
      </section>
      {error ? (
        <Notice message={error} />
      ) : (
        <>
          <div className="metric-grid">
            <Metric label="Penjualan bersih" value={money(summary?.net_sales_minor)} />
            <Metric label="Transaksi" value={String(summary?.transaction_count ?? '—')} />
            <Metric label="Laba kotor" value={money(summary?.gross_profit_minor)} />
            <Metric label="Bisnis aktif" value={String(businesses.length || '—')} />
          </div>
          <section className="dashboard-grid">
            <article className="panel">
              <div className="panel-header">
                <h2>Mulai dari sini</h2>
                <span className="panel-label">AKSI</span>
              </div>
              <div className="action-list">
                <Link to="/app/pos">
                  <b>01</b>
                  <span>
                    <strong>Buka kasir</strong>
                    <small>Mulai penjualan dari outlet aktif.</small>
                  </span>
                  →
                </Link>
                <Link to="/app/products">
                  <b>02</b>
                  <span>
                    <strong>Atur produk</strong>
                    <small>Kelola katalog dan harga.</small>
                  </span>
                  →
                </Link>
                <Link to="/app/inventory">
                  <b>03</b>
                  <span>
                    <strong>Cek stok</strong>
                    <small>Lihat saldo dan pergerakan.</small>
                  </span>
                  →
                </Link>
              </div>
            </article>
            <article className="panel dark-panel">
              <span className="panel-label">KASURO POS</span>
              <h2>
                Jelas di kasir.
                <br />
                Terkendali di belakang.
              </h2>
              <p>
                Setiap transaksi, pergerakan stok, dan keputusan tim berada di konteks bisnis yang
                sama.
              </p>
            </article>
          </section>
        </>
      )}
    </Layout>
  );
}

function Pos() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [registers, setRegisters] = useState<
    Array<{ id: string; outlet_id: string; name: string }>
  >([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Product[]>([]);
  const [outletId, setOutletId] = useState('');
  const [shift, setShift] = useState<{ id: string; register_id: string; status: string } | null>(
    null,
  );
  const [openingCash, setOpeningCash] = useState('0');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [receivedCash, setReceivedCash] = useState('');
  const [completedSale, setCompletedSale] = useState<{
    receipt_number: string;
    total_minor: number;
    change_minor: number;
  } | null>(null);
  const [heldSales, setHeldSales] = useState<
    Array<{ id: string; total_minor: number; created_at: string }>
  >([]);
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const businessId = businesses[0]?.id ?? '';
  const register = registers.find((item) => item.outlet_id === outletId);
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        setBusinesses(items);
        const id = items[0]?.id;
        if (!id) return;
        const [outletRows, registerRows] = await Promise.all([
          api<typeof outlets>(`/api/v1/businesses/${id}/outlets`),
          api<typeof registers>(`/api/v1/businesses/${id}/registers`),
        ]);
        setOutlets(outletRows);
        setRegisters(registerRows);
        setOutletId(outletRows[0]?.id ?? '');
      })
      .catch((err: Error) => setMessage(err.message));
  }, []);
  useEffect(() => {
    if (!businessId) return;
    void api<Product[]>(`/api/v1/businesses/${businessId}/products?q=${encodeURIComponent(query)}`)
      .then(setProducts)
      .catch((err: Error) => setMessage(err.message));
    void api<typeof heldSales>(`/api/v1/businesses/${businessId}/sales/held`)
      .then(setHeldSales)
      .catch(() => setHeldSales([]));
  }, [businessId, query]);
  useEffect(() => {
    if (!businessId || !outletId) return;
    void api<typeof shift>(`/api/v1/businesses/${businessId}/shifts/current?outlet_id=${outletId}`)
      .then(setShift)
      .catch((err: Error) => setMessage(err.message));
  }, [businessId, outletId]);
  const total = cart.reduce((sum, item) => sum + item.selling_price_minor, 0);
  const grouped = useMemo(
    () =>
      cart.reduce<Record<string, number>>(
        (counts, item) => ({ ...counts, [item.variant_id]: (counts[item.variant_id] ?? 0) + 1 }),
        {},
      ),
    [cart],
  );
  const openShift = async () => {
    if (!businessId || !outletId || !register) return;
    setBusy(true);
    try {
      const next = await api<typeof shift>(`/api/v1/businesses/${businessId}/shifts`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          outlet_id: outletId,
          register_id: register.id,
          opening_cash_minor: openingCash,
        }),
      });
      setShift(next);
      setMessage('Shift dibuka. Kasir siap menerima transaksi.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const complete = async (saleId: string | null, amount: number) => {
    if (!businessId || !outletId || !register || !shift) return;
    setBusy(true);
    try {
      const sale = saleId
        ? await api<typeof completedSale>(
            `/api/v1/businesses/${businessId}/sales/${saleId}/complete`,
            {
              method: 'POST',
              headers: { 'X-CSRF-Token': getCsrf() },
              body: JSON.stringify({ payments: [{ method: 'cash', amount_minor: amount }] }),
            },
          )
        : await api<typeof completedSale>(`/api/v1/businesses/${businessId}/sales`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrf(), 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify({
              outlet_id: outletId,
              register_id: register.id,
              shift_id: shift.id,
              client_transaction_id: crypto.randomUUID(),
              lines: Object.entries(grouped).map(([variant_id, quantity]) => ({
                variant_id,
                quantity,
              })),
              payments: [{ method: 'cash', amount_minor: amount }],
            }),
          });
      setCompletedSale(sale);
      setCart([]);
      setActiveSaleId(null);
      setPaymentOpen(false);
      setReceivedCash('');
      setHeldSales((current) => current.filter((held) => held.id !== saleId));
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hold = async () => {
    if (!businessId || !outletId || !register || !shift || !cart.length) return;
    setBusy(true);
    try {
      const held = await api<{ id: string; total_minor: number }>(
        `/api/v1/businesses/${businessId}/sales/hold`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf(), 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            outlet_id: outletId,
            register_id: register.id,
            shift_id: shift.id,
            client_transaction_id: crypto.randomUUID(),
            lines: Object.entries(grouped).map(([variant_id, quantity]) => ({
              variant_id,
              quantity,
            })),
          }),
        },
      );
      setHeldSales((current) => [{ ...held, created_at: new Date().toISOString() }, ...current]);
      setCart([]);
      setMessage('Pesanan disimpan. Bisa dilanjutkan dari daftar hold.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resume = async (saleId: string) => {
    if (!businessId) return;
    setBusy(true);
    try {
      const detail = await api<SaleDetail>(`/api/v1/businesses/${businessId}/sales/${saleId}`);
      await api(`/api/v1/businesses/${businessId}/sales/${saleId}/resume`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
      });
      setCart(
        detail.lines.flatMap((line) =>
          Array.from({ length: line.quantity }, () => ({
            variant_id: line.variant_id,
            name: line.product_name,
            sku: line.sku,
            selling_price_minor: line.unit_price_minor,
            variant_label: 'Default',
          })),
        ),
      );
      setActiveSaleId(saleId);
      setHeldSales((current) => current.filter((held) => held.id !== saleId));
      setMessage('Pesanan dilanjutkan. Periksa isi keranjang sebelum bayar.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Layout>
      <section className="pos-heading">
        <div>
          <span className="workspace-kicker">KASIR</span>
          <h1>Siap melayani.</h1>
        </div>
        <span className="shift-pill">{shift ? '● Shift terbuka' : '● Shift belum dibuka'}</span>
      </section>
      {message && <Notice message={message} />}
      {completedSale && (
        <section className="receipt-banner" role="status">
          <div>
            <span className="workspace-kicker">TRANSAKSI SELESAI</span>
            <strong>{completedSale.receipt_number}</strong>
            <span>
              {money(completedSale.total_minor)} · Kembalian {money(completedSale.change_minor)}
            </span>
          </div>
          <div className="receipt-actions">
            <button className="button secondary" onClick={() => window.print()}>
              Cetak struk
            </button>
            <button className="text-button" onClick={() => setCompletedSale(null)}>
              Tutup
            </button>
          </div>
        </section>
      )}
      <section className="pos-layout">
        <div className="catalog-panel">
          <div className="pos-controls">
            <label htmlFor="outlet-select">
              Outlet
              <select
                id="outlet-select"
                value={outletId}
                onChange={(event) => {
                  setOutletId(event.target.value);
                  setShift(null);
                }}
              >
                <option value="">Pilih outlet</option>
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name} · {outlet.code}
                  </option>
                ))}
              </select>
            </label>
            {!shift && (
              <label htmlFor="opening-cash">
                Kas awal
                <div className="input-wrap">
                  <input
                    id="opening-cash"
                    inputMode="numeric"
                    value={openingCash}
                    onChange={(event) => setOpeningCash(event.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </label>
            )}
            {!shift && (
              <button
                className="button small"
                disabled={busy || !register}
                onClick={() => void openShift()}
              >
                Buka shift
              </button>
            )}
          </div>
          <div className="search-wrap">
            <label htmlFor="product-search">Cari produk</label>
            <input
              id="product-search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nama, SKU, atau barcode"
            />
          </div>
          <div className="product-grid">
            {products.map((product) => (
              <button
                className="product-tile"
                key={product.variant_id}
                disabled={!shift || busy}
                onClick={() => setCart([...cart, product])}
              >
                <span className="tile-index">{product.sku}</span>
                <strong>{product.name}</strong>
                <span>
                  {product.variant_label} · {money(product.selling_price_minor)}
                </span>
              </button>
            ))}
            {products.length === 0 && (
              <div className="empty-state">
                {shift
                  ? 'Belum ada produk untuk ditampilkan.'
                  : 'Buka shift untuk mulai berjualan.'}
              </div>
            )}
          </div>
          {!!heldSales.length && (
            <section className="held-panel">
              <div className="panel-header">
                <h2>Pesanan ditahan</h2>
                <span>{heldSales.length} item</span>
              </div>
              {heldSales.map((held) => (
                <button
                  className="held-row"
                  disabled={busy || !!cart.length}
                  key={held.id}
                  onClick={() => void resume(held.id)}
                >
                  <span>
                    <strong>{held.id.slice(0, 8).toUpperCase()}</strong>
                    <small>
                      {new Date(held.created_at).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </span>
                  <b>{money(held.total_minor)}</b>
                </button>
              ))}
            </section>
          )}
        </div>
        <aside className="cart-panel">
          <div className="panel-header">
            <h2>Pesanan</h2>
            <span>{cart.length} item</span>
          </div>
          {cart.length === 0 ? (
            <div className="cart-empty">
              <span>+</span>
              <p>
                Pilih produk untuk
                <br />
                memulai transaksi.
              </p>
            </div>
          ) : (
            <div className="cart-lines">
              {Object.entries(grouped).map(([variantId, quantity]) => {
                const item = cart.find((entry) => entry.variant_id === variantId)!;
                return (
                  <div className="cart-line" key={variantId}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {quantity} × {money(item.selling_price_minor)}
                      </small>
                    </span>
                    <b>{money(item.selling_price_minor * quantity)}</b>
                  </div>
                );
              })}
            </div>
          )}
          <div className="cart-total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          <div className="cart-actions">
            <button
              className="button secondary"
              disabled={!shift || !cart.length || busy}
              onClick={() => void hold()}
            >
              Tahan
            </button>
            <button
              className="button checkout"
              disabled={!shift || !cart.length || busy}
              onClick={() => {
                setReceivedCash(String(total));
                setPaymentOpen(true);
              }}
            >
              {busy ? 'Memproses…' : 'Bayar tunai'} <span>F4</span>
            </button>
          </div>
        </aside>
      </section>
      {paymentOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="payment-modal"
            onSubmit={(event) => {
              event.preventDefault();
              const amount = Number(receivedCash);
              if (!Number.isSafeInteger(amount) || amount < total) {
                setMessage('Uang diterima harus menutup total transaksi.');
                return;
              }
              void complete(activeSaleId, amount);
            }}
          >
            <div className="panel-header">
              <div>
                <span className="workspace-kicker">PEMBAYARAN TUNAI</span>
                <h2>{money(total)}</h2>
              </div>
              <button type="button" className="text-button" onClick={() => setPaymentOpen(false)}>
                Tutup
              </button>
            </div>
            <label htmlFor="received-cash">
              Uang diterima
              <input
                id="received-cash"
                autoFocus
                required
                inputMode="numeric"
                value={receivedCash}
                onChange={(event) => setReceivedCash(event.target.value.replace(/\D/g, ''))}
              />
            </label>
            <div className="payment-change">
              <span>Kembalian</span>
              <strong>{money(Math.max(0, Number(receivedCash || 0) - total))}</strong>
            </div>
            <button className="button" disabled={busy} type="submit">
              {busy ? 'Memproses…' : 'Selesaikan transaksi ↗'}
            </button>
          </form>
        </div>
      )}
    </Layout>
  );
}

function Products() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        if (items[0]) return api<Product[]>(`/api/v1/businesses/${items[0].id}/products`);
        return [];
      })
      .then(setProducts)
      .catch((err: Error) => setError(err.message));
  }, []);
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">KATALOG</span>
          <h1>Produk yang siap dijual.</h1>
          <p>
            {businesses[0]
              ? 'Harga, SKU, dan varian yang sedang aktif.'
              : 'Hubungkan ruang kerja untuk memuat katalog.'}
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button" to="/app/products/new">
            Tambah produk
          </Link>
          <span className="panel-label">{products.length} VARIAN</span>
        </div>
      </section>
      {error ? (
        <Notice message={error} />
      ) : products.length ? (
        <div className="data-list">
          {products.map((product) => (
            <article className="data-row" key={product.variant_id}>
              <span>
                <strong>{product.name}</strong>
                <small>
                  {product.variant_label} · {product.sku}
                </small>
              </span>
              <b>{money(product.selling_price_minor)}</b>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <span className="empty-number">—</span>
          <h2>Katalog belum berisi produk.</h2>
          <p>Tambahkan produk pertama untuk mulai mengisi stok dan berjualan.</p>
          <Link className="button" to="/app/products/new">
            Buat produk pertama
          </Link>
        </div>
      )}
    </Layout>
  );
}

function ProductCreate() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    unit_key: 'pcs',
    price_minor: '',
    cost_minor: '',
    tax_rate_bp: '0',
    label: 'Default',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const businesses = await api<Business[]>('/api/v1/businesses');
      const businessId = businesses[0]?.id;
      if (!businessId) throw new Error('Buat ruang kerja terlebih dahulu');
      await api(`/api/v1/businesses/${businessId}/products`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify(form),
      });
      navigate('/app/products');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">KATALOG / PRODUK BARU</span>
          <h1>Tambahkan produk.</h1>
          <p>Harga dan modal disimpan sebagai snapshot untuk transaksi berikutnya.</p>
        </div>
        <Link className="button secondary" to="/app/products">
          Batal
        </Link>
      </section>
      <form className="form-panel" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Nama produk
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
            />
          </label>
          <label>
            SKU
            <input
              required
              maxLength={80}
              value={form.sku}
              onChange={(event) => update('sku', event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Barcode <span className="field-hint">opsional</span>
            <input
              value={form.barcode}
              onChange={(event) => update('barcode', event.target.value)}
            />
          </label>
          <label>
            Label varian
            <input
              required
              value={form.label}
              onChange={(event) => update('label', event.target.value)}
            />
          </label>
          <label>
            Unit dasar
            <input
              required
              value={form.unit_key}
              onChange={(event) => update('unit_key', event.target.value)}
            />
          </label>
          <label>
            Pajak <span className="field-hint">basis poin, 1000 = 10%</span>
            <input
              inputMode="numeric"
              value={form.tax_rate_bp}
              onChange={(event) => update('tax_rate_bp', event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label>
            Harga jual (rupiah)
            <input
              required
              inputMode="numeric"
              min="0"
              value={form.price_minor}
              onChange={(event) => update('price_minor', event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label>
            Harga modal (rupiah)
            <input
              required
              inputMode="numeric"
              min="0"
              value={form.cost_minor}
              onChange={(event) => update('cost_minor', event.target.value.replace(/\D/g, ''))}
            />
          </label>
        </div>
        {error && <Notice message={error} />}
        <div className="form-actions">
          <Link className="button secondary" to="/app/products">
            Kembali
          </Link>
          <button className="button" disabled={saving} type="submit">
            {saving ? 'Menyimpan…' : 'Simpan produk'}
          </button>
        </div>
      </form>
    </Layout>
  );
}
function Inventory() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [rows, setRows] = useState<
    Array<{
      outlet_id: string;
      variant_id: string;
      name: string;
      sku: string;
      label: string;
      quantity_on_hand: number;
    }>
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        if (items[0]) return api<typeof rows>(`/api/v1/businesses/${items[0].id}/inventory`);
        return [];
      })
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">INVENTORI</span>
          <h1>Stok yang dapat dipercaya.</h1>
          <p>
            {businesses[0]
              ? 'Saldo terkini dari setiap outlet.'
              : 'Hubungkan ruang kerja untuk memuat saldo stok.'}
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button" to="/app/inventory/adjustments">
            Isi stok awal
          </Link>
          <span className="panel-label">{rows.length} SALDO</span>
        </div>
      </section>
      {error ? (
        <Notice message={error} />
      ) : rows.length ? (
        <div className="data-list">
          {rows.map((row) => (
            <article className="data-row" key={`${row.outlet_id}-${row.variant_id}`}>
              <span>
                <strong>{row.name}</strong>
                <small>
                  {row.label} · {row.sku} · {row.outlet_id.slice(0, 8)}
                </small>
              </span>
              <b className={row.quantity_on_hand <= 0 ? 'negative' : ''}>
                {row.quantity_on_hand} pcs
              </b>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <span className="empty-number">—</span>
          <h2>Belum ada saldo stok.</h2>
          <p>Buat produk lalu isi stok awal untuk mulai berjualan.</p>
          <Link className="button" to="/app/inventory/adjustments">
            Isi stok awal
          </Link>
        </div>
      )}
    </Layout>
  );
}

function InventoryAdjustment() {
  const navigate = useNavigate();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [outletId, setOutletId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('Stok awal');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        setBusinesses(items);
        const id = items[0]?.id;
        if (!id) return;
        const [outletRows, productRows] = await Promise.all([
          api<typeof outlets>(`/api/v1/businesses/${id}/outlets`),
          api<Product[]>(`/api/v1/businesses/${id}/products`),
        ]);
        setOutlets(outletRows);
        setProducts(productRows);
        setOutletId(outletRows[0]?.id ?? '');
        setVariantId(productRows[0]?.variant_id ?? '');
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const businessId = businesses[0]?.id;
      if (!businessId) throw new Error('Buat ruang kerja terlebih dahulu');
      const result = await api<{ quantity_on_hand: number; average_cost_minor: number }>(
        `/api/v1/businesses/${businessId}/inventory/adjustments`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf() },
          body: JSON.stringify({
            outlet_id: outletId,
            variant_id: variantId,
            quantity_delta: quantity,
            unit_cost_minor: cost,
            reason,
          }),
        },
      );
      setSuccess(
        `Stok tersimpan: ${result.quantity_on_hand} pcs · modal rata-rata ${money(result.average_cost_minor)}`,
      );
      setQuantity('');
      setTimeout(() => navigate('/app/inventory'), 700);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">INVENTORI / STOK AWAL</span>
          <h1>Isi stok pertama.</h1>
          <p>Setiap perubahan membuat movement immutable dan memperbarui saldo outlet.</p>
        </div>
        <Link className="button secondary" to="/app/inventory">
          Batal
        </Link>
      </section>
      <form className="form-panel" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Outlet
            <select required value={outletId} onChange={(event) => setOutletId(event.target.value)}>
              <option value="">Pilih outlet</option>
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name} · {outlet.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Produk
            <select
              required
              value={variantId}
              onChange={(event) => setVariantId(event.target.value)}
            >
              <option value="">Pilih produk</option>
              {products.map((product) => (
                <option key={product.variant_id} value={product.variant_id}>
                  {product.name} · {product.sku}
                </option>
              ))}
            </select>
          </label>
          <label>
            Jumlah stok
            <input
              required
              min="1"
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label>
            Modal per unit (rupiah)
            <input
              required
              min="0"
              inputMode="numeric"
              value={cost}
              onChange={(event) => setCost(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label className="field-wide">
            Alasan
            <input
              required
              maxLength={160}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
        {success && (
          <div className="success-notice" role="status">
            {success}
          </div>
        )}
        {error && <Notice message={error} />}
        <div className="form-actions">
          <Link className="button secondary" to="/app/inventory">
            Kembali
          </Link>
          <button
            className="button"
            disabled={saving || !outlets.length || !products.length}
            type="submit"
          >
            {saving ? 'Menyimpan…' : 'Simpan stok awal'}
          </button>
        </div>
      </form>
    </Layout>
  );
}
function Refunds() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [refunds, setRefunds] = useState<
    Array<{
      id: string;
      sale_id: string;
      receipt_number: string | null;
      amount_minor: number;
      payment_method: string;
      reason: string;
      status: string;
      created_at: string;
    }>
  >([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        setBusinesses(items);
        const id = items[0]?.id;
        if (id) setRefunds(await api<typeof refunds>(`/api/v1/businesses/${id}/refunds`));
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">REFUND</span>
          <h1>Pengembalian yang tercatat.</h1>
          <p>
            {businesses[0]
              ? 'Histori refund dari ruang kerja aktif, dengan stok dan alasan yang dapat ditelusuri.'
              : 'Hubungkan ruang kerja untuk memuat histori refund.'}
          </p>
        </div>
        <span className="panel-label">{refunds.length} REFUND</span>
      </section>
      {error ? (
        <Notice message={error} />
      ) : refunds.length ? (
        <div className="data-list">
          {refunds.map((refund) => (
            <Link className="data-row sale-row" key={refund.id} to={`/app/sales/${refund.sale_id}`}>
              <span>
                <strong>{refund.receipt_number ?? refund.sale_id.slice(0, 8).toUpperCase()}</strong>
                <small>
                  {new Date(refund.created_at).toLocaleString('id-ID')} · {refund.reason} ·{' '}
                  {refund.status}
                </small>
              </span>
              <b>{money(refund.amount_minor)}</b>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <span className="empty-number">—</span>
          <h2>Belum ada refund.</h2>
          <p>Refund yang diproses dari detail transaksi akan muncul di sini.</p>
          <Link className="button" to="/app/sales">
            Lihat penjualan
          </Link>
        </div>
      )}
    </Layout>
  );
}
function Reports() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        if (items[0])
          return api<Record<string, number>>(`/api/v1/businesses/${items[0].id}/reports/summary`);
        return null;
      })
      .then(setSummary)
      .catch((err: Error) => setError(err.message));
  }, []);
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">LAPORAN</span>
          <h1>Keputusan, bukan tebakan.</h1>
          <p>
            {businesses[0]
              ? 'Ringkasan operasional ruang kerja aktif.'
              : 'Hubungkan ruang kerja untuk memuat laporan.'}
          </p>
        </div>
        <span className="panel-label">HARI INI</span>
      </section>
      {error ? (
        <Notice message={error} />
      ) : summary ? (
        <div className="metric-grid">
          <Metric label="Penjualan bersih" value={money(summary.net_sales_minor)} />
          <Metric label="Transaksi" value={String(summary.transaction_count ?? 0)} />
          <Metric label="Laba kotor" value={money(summary.gross_profit_minor)} />
          <Metric label="Biaya operasional" value={money(summary.expenses_minor)} />
        </div>
      ) : (
        <div className="empty-panel">
          <span className="empty-number">—</span>
          <h2>Belum ada laporan.</h2>
          <p>Ringkasan akan terisi setelah transaksi dan biaya tercatat.</p>
        </div>
      )}
    </Layout>
  );
}
function Sales() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        setBusinesses(items);
        const id = items[0]?.id;
        if (id) setSales(await api<SaleSummary[]>(`/api/v1/businesses/${id}/sales`));
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">PENJUALAN</span>
          <h1>Transaksi yang tercatat.</h1>
          <p>
            {businesses[0]
              ? 'Riwayat transaksi terbaru dari ruang kerja aktif.'
              : 'Hubungkan ruang kerja untuk memuat riwayat.'}
          </p>
        </div>
        <span className="panel-label">{sales.length} TRANSAKSI</span>
      </section>
      {error ? (
        <Notice message={error} />
      ) : sales.length ? (
        <div className="data-list">
          {sales.map((sale) => (
            <Link className="data-row sale-row" key={sale.id} to={`/app/sales/${sale.id}`}>
              <span>
                <strong>{sale.receipt_number ?? sale.id.slice(0, 8).toUpperCase()}</strong>
                <small>
                  {new Date(sale.created_at).toLocaleString('id-ID')} · {sale.status}
                </small>
              </span>
              <b>{money(sale.total_minor)}</b>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <span className="empty-number">—</span>
          <h2>Belum ada transaksi.</h2>
          <p>Transaksi yang selesai dari kasir akan muncul di sini.</p>
          <Link className="button" to="/app/pos">
            Buka kasir
          </Link>
        </div>
      )}
    </Layout>
  );
}

function SaleDetail() {
  const { saleId } = useParams();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState('');
  const [refundError, setRefundError] = useState('');
  const [refundMessage, setRefundMessage] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState('');
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        const id = items[0]?.id;
        if (id && saleId) {
          setBusinessId(id);
          setSale(await api<SaleDetail>(`/api/v1/businesses/${id}/sales/${saleId}`));
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [saleId]);
  const refundableLines = sale?.lines.filter((line) => line.refundable_quantity > 0) ?? [];
  const refundTotal = refundableLines.reduce(
    (total, line) => total + (Number(quantities[line.id] ?? 0) || 0) * line.unit_price_minor,
    0,
  );
  const submitRefund = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !saleId) return;
    setSaving(true);
    setRefundError('');
    setRefundMessage('');
    try {
      const lines = refundableLines
        .filter((line) => Number(quantities[line.id] ?? 0) > 0)
        .map((line) => ({ sale_line_id: line.id, quantity: quantities[line.id] }));
      const result = await api<{ id: string; amount_minor: number; sale_status: string }>(
        `/api/v1/businesses/${businessId}/refunds`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf(), 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ sale_id: saleId, reason, payment_method: paymentMethod, lines }),
        },
      );
      setRefundMessage(
        `Refund ${result.id.slice(0, 8).toUpperCase()} selesai · ${money(result.amount_minor)} · stok dikembalikan.`,
      );
      setRefundOpen(false);
      setReason('');
      setQuantities({});
      setSale(await api<SaleDetail>(`/api/v1/businesses/${businessId}/sales/${saleId}`));
    } catch (err) {
      setRefundError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">PENJUALAN / STRUK</span>
          <h1>{sale?.receipt_number ?? 'Detail transaksi.'}</h1>
          <p>
            {sale ? new Date(sale.created_at).toLocaleString('id-ID') : 'Memuat detail transaksi.'}
          </p>
        </div>
        <div className="heading-actions">
          <button className="button secondary" disabled={!sale} onClick={() => window.print()}>
            Cetak struk
          </button>
          <Link className="button" to="/app/sales">
            Kembali
          </Link>
        </div>
      </section>
      {error ? (
        <Notice message={error} />
      ) : sale ? (
        <>
          <section className="receipt-card">
            <div className="receipt-meta">
              <span>Status</span>
              <strong>{sale.status}</strong>
              <span>Total</span>
              <strong>{money(sale.total_minor)}</strong>
            </div>
            <div className="receipt-lines">
              {sale.lines.map((line) => (
                <div className="receipt-line" key={line.id}>
                  <span>
                    <strong>{line.product_name}</strong>
                    <small>
                      {line.quantity} × {money(line.unit_price_minor)} · {line.sku} · dapat direfund{' '}
                      {line.refundable_quantity}
                    </small>
                  </span>
                  <b>{money(line.line_net_minor + line.tax_minor)}</b>
                </div>
              ))}
            </div>
            <div className="receipt-total">
              <span>Total dibayar</span>
              <strong>{money(sale.total_minor)}</strong>
            </div>
            {sale.payments.map((payment, index) => (
              <div className="payment-row" key={`${payment.method}-${index}`}>
                <span>{payment.method}</span>
                <span>
                  {money(payment.amount_minor)}
                  {payment.change_minor ? ` · Kembalian ${money(payment.change_minor)}` : ''}
                </span>
              </div>
            ))}
            {refundableLines.length > 0 && (
              <button className="button refund-button" onClick={() => setRefundOpen(true)}>
                Proses refund
              </button>
            )}
          </section>
          {refundMessage && (
            <div className="success-notice refund-feedback" role="status">
              {refundMessage}
            </div>
          )}
        </>
      ) : (
        <div className="empty-panel">
          <p>Memuat detail transaksi…</p>
        </div>
      )}
      {refundOpen && (
        <div className="modal-backdrop">
          <form className="payment-modal refund-modal" onSubmit={submitRefund}>
            <div className="panel-header">
              <div>
                <span className="workspace-kicker">REFUND TRANSAKSI</span>
                <h2>{money(refundTotal)}</h2>
              </div>
              <button type="button" className="text-button" onClick={() => setRefundOpen(false)}>
                Tutup
              </button>
            </div>
            <div className="refund-lines">
              {refundableLines.map((line) => (
                <label key={line.id}>
                  {line.product_name}
                  <span className="refund-available">
                    Maksimal {line.refundable_quantity} unit · {money(line.unit_price_minor)} per
                    unit
                  </span>
                  <input
                    min="0"
                    max={line.refundable_quantity}
                    inputMode="numeric"
                    value={quantities[line.id] ?? ''}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [line.id]: event.target.value.replace(/\D/g, ''),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Metode pengembalian
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                <option value="cash">Tunai</option>
                <option value="bank_transfer">Transfer bank</option>
                <option value="store_credit">Store credit</option>
              </select>
            </label>
            <label>
              Alasan refund
              <textarea
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {refundError && <Notice message={refundError} />}
            <button className="button" disabled={saving || refundTotal <= 0} type="submit">
              {saving ? 'Memproses…' : `Konfirmasi refund ${money(refundTotal)}`}
            </button>
          </form>
        </div>
      )}
    </Layout>
  );
}
function Auth({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api(`/api/v1/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(
          mode === 'register' ? { email, password, display_name: name } : { email, password },
        ),
      });
      navigate(mode === 'register' ? '/setup' : '/app/dashboard');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <main className="auth-page">
      <Link className="brand" to="/">
        KASU<span>RO</span>
      </Link>
      <form className="auth-card" onSubmit={submit}>
        <span className="workspace-kicker">
          {mode === 'login' ? 'SELAMAT DATANG KEMBALI' : 'MULAI DENGAN KASURO'}
        </span>
        <h1>
          {mode === 'login' ? 'Masuk ke ruang kerja.' : 'Bangun cara kerja yang lebih jelas.'}
        </h1>
        {mode === 'register' && (
          <label>
            Nama
            <div className="input-wrap">
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </label>
        )}
        <label>
          Email
          <div className="input-wrap">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </label>
        <label>
          Password
          <div className="input-wrap">
            <input
              required
              minLength={12}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </label>
        {error && <Notice message={error} />}
        <button className="button" type="submit">
          {mode === 'login' ? 'Masuk' : 'Buat akun'} <span>↗</span>
        </button>
        <p className="auth-switch">
          {mode === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?'}{' '}
          <Link to={mode === 'login' ? '/register' : '/login'}>
            {mode === 'login' ? 'Daftar' : 'Masuk'}
          </Link>
        </p>
      </form>
    </main>
  );
}
function PublicInfo({ title, body }: { title: string; body: string }) {
  return (
    <main className="not-found public-info">
      <Link className="brand" to="/">
        KASU<span>RO</span>
      </Link>
      <div className="eyebrow">Kasuro POS</div>
      <h1>{title}</h1>
      <p>{body}</p>
      <div className="actions">
        <Link className="button" to="/register">
          Mulai gratis
        </Link>
        <Link className="button secondary" to="/">
          Kembali
        </Link>
      </div>
    </main>
  );
}
function Notice({ message }: { message: string }) {
  return (
    <div className="notice" role="alert">
      {message}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
function Placeholder({ title }: { title: string }) {
  return (
    <main className="not-found">
      <div className="eyebrow">Kasuro POS</div>
      <h1>{title}</h1>
      <p>Rute ini disiapkan untuk fase fitur berikutnya.</p>
      <Link className="button" to="/">
        Kembali ke beranda
      </Link>
    </main>
  );
}
function money(value: number | undefined): string {
  return value === undefined
    ? '—'
    : new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      }).format(value);
}
function getCsrf(): string {
  return (
    document.cookie
      .split('; ')
      .find((item) => item.startsWith('kasuro_csrf='))
      ?.split('=')[1] ?? ''
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/register" element={<Auth mode="register" />} />
        <Route
          path="/setup"
          element={
            <RequireAuth>
              <Setup />
            </RequireAuth>
          }
        />
        <Route
          path="/app/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/app/pos"
          element={
            <RequireAuth>
              <Pos />
            </RequireAuth>
          }
        />
        <Route
          path="/app/products/new"
          element={
            <RequireAuth>
              <ProductCreate />
            </RequireAuth>
          }
        />
        <Route
          path="/app/products"
          element={
            <RequireAuth>
              <Products />
            </RequireAuth>
          }
        />
        <Route
          path="/app/inventory/adjustments"
          element={
            <RequireAuth>
              <InventoryAdjustment />
            </RequireAuth>
          }
        />
        <Route
          path="/app/inventory"
          element={
            <RequireAuth>
              <Inventory />
            </RequireAuth>
          }
        />
        <Route
          path="/app/reports"
          element={
            <RequireAuth>
              <Reports />
            </RequireAuth>
          }
        />
        <Route
          path="/app/sales"
          element={
            <RequireAuth>
              <Sales />
            </RequireAuth>
          }
        />
        <Route
          path="/app/sales/:saleId"
          element={
            <RequireAuth>
              <SaleDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/app/refunds"
          element={
            <RequireAuth>
              <Refunds />
            </RequireAuth>
          }
        />
        <Route
          path="/features"
          element={
            <PublicInfo
              title="Semua yang penting, terlihat jelas."
              body="Penjualan, stok, tim, dan keputusan operasional dalam satu ruang kerja."
            />
          }
        />
        <Route
          path="/pricing"
          element={
            <PublicInfo
              title="Mulai sederhana, tumbuh dengan tenang."
              body="Kasuro dimulai dari alur kasir yang jelas dan fondasi yang siap mengikuti bisnis."
            />
          }
        />
        <Route path="*" element={<Placeholder title="Halaman tidak ditemukan" />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

function PublicHome() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          KASU<span>RO</span>
        </Link>
        <nav aria-label="Navigasi utama">
          <Link to="/features">Fitur</Link>
          <Link to="/pricing">Harga</Link>
          <Link to="/login">Masuk</Link>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">Kasir untuk bisnis yang bergerak</div>
            <h1>Kasir cepat. Bisnis terkendali.</h1>
            <p>
              Kelola penjualan, stok, dan tim dari satu ruang kerja yang dibuat untuk ritme toko
              sehari-hari.
            </p>
            <div className="actions">
              <Link className="button" to="/register">
                Mulai gratis
              </Link>
              <Link className="button secondary" to="/features">
                Lihat fitur
              </Link>
            </div>
          </div>
          <div className="hero-panel">
            <div className="panel-content">
              <div className="panel-label">RUANG KERJA HARI INI</div>
              <div className="panel-number">POS</div>
              <p className="panel-note">
                Satu sumber kebenaran untuk kasir, stok, dan keputusan pemilik.
              </p>
            </div>
          </div>
        </section>
        <section className="section">
          <h2>Yang penting, terlihat jelas.</h2>
          <div className="feature-grid">
            <article className="feature">
              <strong>Penjualan tanpa friksi</strong>
              <p>Alur kasir ringkas untuk pencarian cepat, pembayaran, dan struk.</p>
            </article>
            <article className="feature">
              <strong>Stok yang dapat dipercaya</strong>
              <p>Saldo terkini dan riwayat pergerakan yang menjelaskan setiap perubahan.</p>
            </article>
            <article className="feature">
              <strong>Kontrol lintas outlet</strong>
              <p>Tim, outlet, dan akses tetap berada dalam konteks bisnis yang tepat.</p>
            </article>
          </div>
        </section>
      </main>
      <footer className="footer">KASURO POS · Dibuat untuk operasional nyata.</footer>
    </div>
  );
}
