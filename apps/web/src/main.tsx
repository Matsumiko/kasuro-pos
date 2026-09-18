import {
  cacheCatalog,
  listOfflineConflicts,
  listPendingOfflineSales,
  readCachedCatalog,
  syncOfflineSales,
  queueOfflineSale,
  type OfflineSalePayload,
} from './lib/offline';
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

const API =
  import.meta.env.VITE_API_ORIGIN ??
  (import.meta.env.PROD ? 'https://kasuro-api.fadztech12.workers.dev' : 'http://localhost:8787');

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
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const refreshOffline = async () => {
    setPendingCount((await listPendingOfflineSales()).length);
    setConflictCount((await listOfflineConflicts()).length);
  };
  useEffect(() => {
    const on = () => {
      setOnline(true);
      void syncOfflineSales(API).then(refreshOffline).catch(refreshOffline);
    };
    const off = () => setOnline(false);
    const changed = () => void refreshOffline();
    addEventListener('online', on);
    addEventListener('offline', off);
    addEventListener('kasuro-offline-queue-changed', changed);
    void refreshOffline();
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
      removeEventListener('kasuro-offline-queue-changed', changed);
    };
  }, []);
  const links: Array<[string, string]> = [
    ['/app/dashboard', 'Ringkasan'],
    ['/app/pos', 'Kasir'],
    ['/app/products', 'Produk'],
    ['/app/inventory', 'Stok'],
    ['/app/purchases', 'Pembelian'],
    ['/app/expenses', 'Biaya'],
    ['/app/import-export', 'Import / Export'],
    ['/app/customers', 'Pelanggan'],
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
            {pendingCount > 0 && <span className="panel-label">{pendingCount} MENUNGGU SYNC</span>}
            {conflictCount > 0 && <span className="panel-label">{conflictCount} KONFLIK</span>}
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

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'authenticated'>('checking');
  useEffect(() => {
    void api('/api/v1/auth/me')
      .then(() => setState('authenticated'))
      .catch(() => navigate('/admin/login', { replace: true }));
  }, [navigate]);
  if (state !== 'authenticated')
    return (
      <main className="not-found">
        <p>Memeriksa akses platform…</p>
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
    const loadProducts = async () => {
      try {
        if (!navigator.onLine) {
          setProducts(await readCachedCatalog<Product>(businessId));
          return;
        }
        const rows = await api<Product[]>(
          `/api/v1/businesses/${businessId}/products?q=${encodeURIComponent(query)}`,
        );
        setProducts(rows);
        await cacheCatalog(
          businessId,
          rows.map((row) => ({ ...row, variant_id: row.variant_id })),
        );
      } catch (err) {
        const cached = await readCachedCatalog<Product>(businessId);
        if (cached.length) setProducts(cached);
        else setMessage((err as Error).message);
      }
    };
    void loadProducts();
    if (navigator.onLine)
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
    const payload: OfflineSalePayload = {
      business_id: businessId,
      outlet_id: outletId,
      register_id: register.id,
      shift_id: shift.id,
      client_transaction_id: crypto.randomUUID(),
      lines: Object.entries(grouped).map(([variant_id, quantity]) => ({ variant_id, quantity })),
      payment: { method: 'cash', amount_minor: amount },
    };
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
            body: JSON.stringify(payload),
          });
      setCompletedSale(sale);
      setCart([]);
      setActiveSaleId(null);
      setPaymentOpen(false);
      setReceivedCash('');
      setHeldSales((current) => current.filter((held) => held.id !== saleId));
    } catch (err) {
      if (!saleId && !navigator.onLine) {
        await queueOfflineSale(payload, 'Menunggu koneksi untuk sinkronisasi');
        window.dispatchEvent(new Event('kasuro-offline-queue-changed'));
        setCart([]);
        setPaymentOpen(false);
        setReceivedCash('');
        setMessage(
          'Transaksi tunai disimpan sebagai provisional dan akan disinkronkan saat online.',
        );
      } else setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hold = async () => {
    if (!navigator.onLine) {
      setMessage('Simpan pesanan membutuhkan koneksi. Offline hanya mendukung penjualan tunai.');
      return;
    }
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
function Purchasing() {
  type Supplier = { id: string; supplier_code: string; name: string; phone: string | null };
  type Purchase = {
    id: string;
    supplier_name: string | null;
    outlet_name: string | null;
    outlet_id: string;
    status: string;
    total_minor: number;
    created_at: string;
  };
  type PurchaseDetail = Purchase & {
    lines: Array<{
      id: string;
      variant_id: string;
      product_name: string;
      label: string;
      sku: string;
      quantity_ordered: number;
      quantity_received: number;
      unit_cost_minor: number;
    }>;
  };
  type OrderLine = { variant_id: string; quantity: string; unit_cost_minor: string };
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [outletId, setOutletId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([
    { variant_id: '', quantity: '1', unit_cost_minor: '' },
  ]);
  const [receiveQuantities, setReceiveQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const businessId = businesses[0]?.id;
  const refresh = async (id: string) => {
    const [supplierRows, outletRows, productRows, purchaseRows] = await Promise.all([
      api<Supplier[]>(`/api/v1/businesses/${id}/suppliers`),
      api<typeof outlets>(`/api/v1/businesses/${id}/outlets`),
      api<Product[]>(`/api/v1/businesses/${id}/products`),
      api<Purchase[]>(`/api/v1/businesses/${id}/purchases`),
    ]);
    setSuppliers(supplierRows);
    setOutlets(outletRows);
    setProducts(productRows);
    setPurchases(purchaseRows);
    setSupplierId((current) => current || supplierRows[0]?.id || '');
    setOutletId((current) => current || outletRows[0]?.id || '');
    setLines((current) =>
      current.map((line, index) => ({
        ...line,
        variant_id: line.variant_id || (index === 0 ? productRows[0]?.variant_id || '' : ''),
      })),
    );
  };
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        if (items[0]) return refresh(items[0].id);
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  const createSupplier = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api(`/api/v1/businesses/${businessId}/suppliers`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          supplier_code: supplierCode,
          name: supplierName,
          phone: supplierPhone,
        }),
      });
      setSupplierName('');
      setSupplierCode('');
      setSupplierPhone('');
      await refresh(businessId);
      setSuccess('Supplier tersimpan.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const createPurchase = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const created = await api<{ id: string }>(`/api/v1/businesses/${businessId}/purchases`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          supplier_id: supplierId || undefined,
          outlet_id: outletId,
          lines: lines.map((line) => ({
            variant_id: line.variant_id,
            quantity: line.quantity,
            unit_cost_minor: line.unit_cost_minor,
          })),
        }),
      });
      await refresh(businessId);
      await openPurchase(created.id);
      setSuccess('Purchase order dibuat. Siap diterima bertahap.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const openPurchase = async (id: string) => {
    if (!businessId) return;
    try {
      const row = await api<PurchaseDetail>(`/api/v1/businesses/${businessId}/purchases/${id}`);
      setDetail(row);
      setReceiveQuantities(
        Object.fromEntries(
          row.lines.map((line) => [
            line.id,
            String(line.quantity_ordered - line.quantity_received),
          ]),
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const receive = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !detail) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const receivingLines = detail.lines
        .map((line) => ({ line_id: line.id, quantity: receiveQuantities[line.id] || '0' }))
        .filter((line) => Number(line.quantity) > 0);
      if (!receivingLines.length) throw new Error('Masukkan jumlah penerimaan terlebih dahulu.');
      await api(`/api/v1/businesses/${businessId}/purchases/${detail.id}/receive`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ lines: receivingLines }),
      });
      await refresh(businessId);
      await openPurchase(detail.id);
      setSuccess('Penerimaan tersimpan. Stok dan modal rata-rata sudah diperbarui.');
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
          <span className="workspace-kicker">PEMBELIAN</span>
          <h1>Barang masuk, tercatat.</h1>
          <p>Kelola supplier, pesanan, penerimaan parsial, dan modal stok dari satu alur.</p>
        </div>
        <span className="panel-label">{purchases.length} ORDER</span>
      </section>
      {error && <Notice message={error} />}
      {success && (
        <div className="success-notice" role="status">
          {success}
        </div>
      )}
      <div className="purchasing-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Supplier</h2>
            <span className="panel-label">{suppliers.length} AKTIF</span>
          </div>
          <form className="compact-form" onSubmit={createSupplier}>
            <label>
              Kode
              <input
                required
                maxLength={40}
                value={supplierCode}
                onChange={(e) => setSupplierCode(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Nama
              <input
                required
                maxLength={120}
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
              />
            </label>
            <label>
              Telepon
              <input value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} />
            </label>
            <button className="button" disabled={saving} type="submit">
              Tambah supplier
            </button>
          </form>
          <div className="mini-list">
            {suppliers.map((supplier) => (
              <div className="mini-row" key={supplier.id}>
                <span>
                  <strong>{supplier.name}</strong>
                  <small>
                    {supplier.supplier_code}
                    {supplier.phone ? ` · ${supplier.phone}` : ''}
                  </small>
                </span>
              </div>
            ))}
            {!suppliers.length && <small className="muted-copy">Belum ada supplier.</small>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Purchase order baru</h2>
            <span className="panel-label">IDR</span>
          </div>
          <form className="compact-form" onSubmit={createPurchase}>
            <div className="form-grid">
              <label>
                Supplier
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Tanpa supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Outlet
                <select required value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                  <option value="">Pilih outlet</option>
                  {outlets.map((outlet) => (
                    <option key={outlet.id} value={outlet.id}>
                      {outlet.name} · {outlet.code}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {lines.map((line, index) => (
              <div className="purchase-line" key={index}>
                <select
                  required
                  value={line.variant_id}
                  onChange={(e) =>
                    setLines((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, variant_id: e.target.value } : item,
                      ),
                    )
                  }
                >
                  <option value="">Produk</option>
                  {products.map((product) => (
                    <option key={product.variant_id} value={product.variant_id}>
                      {product.name} · {product.variant_label}
                    </option>
                  ))}
                </select>
                <input
                  required
                  min="1"
                  inputMode="numeric"
                  placeholder="Qty"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, quantity: e.target.value.replace(/\D/g, '') }
                          : item,
                      ),
                    )
                  }
                />
                <input
                  required
                  min="0"
                  inputMode="numeric"
                  placeholder="Modal/unit"
                  value={line.unit_cost_minor}
                  onChange={(e) =>
                    setLines((current) =>
                      current.map((item, i) =>
                        i === index
                          ? { ...item, unit_cost_minor: e.target.value.replace(/\D/g, '') }
                          : item,
                      ),
                    )
                  }
                />
                {lines.length > 1 && (
                  <button
                    className="text-button"
                    type="button"
                    aria-label="Hapus baris"
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="form-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    { variant_id: '', quantity: '1', unit_cost_minor: '' },
                  ])
                }
              >
                Tambah baris
              </button>
              <button
                className="button"
                disabled={saving || !products.length || !outlets.length}
                type="submit"
              >
                {saving ? 'Menyimpan…' : 'Buat purchase order'}
              </button>
            </div>
          </form>
        </section>
      </div>
      <section className="panel purchase-history">
        <div className="panel-header">
          <h2>Riwayat pembelian</h2>
          <span className="panel-label">TERBARU</span>
        </div>
        {purchases.length ? (
          <div className="data-list">
            {purchases.map((purchase) => (
              <button
                className="data-row purchase-row"
                key={purchase.id}
                type="button"
                onClick={() => void openPurchase(purchase.id)}
              >
                <span>
                  <strong>{purchase.supplier_name ?? 'Tanpa supplier'}</strong>
                  <small>
                    {purchase.outlet_name ?? purchase.outlet_id.slice(0, 8)} ·{' '}
                    {new Date(purchase.created_at).toLocaleString('id-ID')} · {purchase.status}
                  </small>
                </span>
                <b>{money(purchase.total_minor)}</b>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted-copy">Belum ada purchase order.</p>
        )}
      </section>
      {detail && (
        <div className="modal-backdrop">
          <form className="payment-modal purchase-modal" onSubmit={receive}>
            <div className="panel-header">
              <div>
                <span className="workspace-kicker">DETAIL PEMBELIAN</span>
                <h2>{detail.supplier_name ?? 'Tanpa supplier'}</h2>
              </div>
              <button className="text-button" type="button" onClick={() => setDetail(null)}>
                Tutup
              </button>
            </div>
            <p className="muted-copy">
              {detail.outlet_name} · {detail.status} · Total {money(detail.total_minor)}
            </p>
            <div className="receive-list">
              {detail.lines.map((line) => {
                const remaining = line.quantity_ordered - line.quantity_received;
                return (
                  <label className="receive-row" key={line.id}>
                    <span>
                      <strong>
                        {line.product_name} · {line.label}
                      </strong>
                      <small>
                        {line.sku} · {line.quantity_received}/{line.quantity_ordered} diterima ·
                        modal {money(line.unit_cost_minor)}
                      </small>
                    </span>
                    <input
                      aria-label={`Penerimaan ${line.product_name}`}
                      disabled={!remaining}
                      max={remaining}
                      min="0"
                      inputMode="numeric"
                      value={receiveQuantities[line.id] ?? '0'}
                      onChange={(e) =>
                        setReceiveQuantities((current) => ({
                          ...current,
                          [line.id]: e.target.value.replace(/\D/g, ''),
                        }))
                      }
                    />
                  </label>
                );
              })}
            </div>
            {detail.status !== 'received' && (
              <button className="button" disabled={saving} type="submit">
                {saving ? 'Memproses…' : 'Catat penerimaan'}
              </button>
            )}
          </form>
        </div>
      )}
    </Layout>
  );
}
function Customers() {
  type Customer = {
    id: string;
    customer_code: string;
    name: string;
    phone: string | null;
    email: string | null;
    total_spend_minor: number;
    transaction_count: number;
    last_transaction_at: string | null;
  };
  type History = {
    customer: Customer & { notes: string | null };
    sales: Array<{
      id: string;
      receipt_number: string | null;
      status: string;
      total_minor: number;
      created_at: string;
    }>;
    loyalty_ledger: Array<{ points_delta: number; source_type: string; created_at: string }>;
    credit_ledger: Array<{ amount_delta_minor: number; source_type: string; created_at: string }>;
    loyalty_account: { points_balance: number };
    credit_account: { credit_limit_minor: number; balance_minor: number };
  };
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<History | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [points, setPoints] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [payment, setPayment] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const businessId = businesses[0]?.id;
  const loadCustomers = async (id: string) =>
    setCustomers(await api<Customer[]>(`/api/v1/businesses/${id}/customers`));
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        if (items[0]) return loadCustomers(items[0].id);
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  const createCustomer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api(`/api/v1/businesses/${businessId}/customers`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ name, customer_code: code, phone }),
      });
      setName('');
      setCode('');
      setPhone('');
      await loadCustomers(businessId);
      setSuccess('Pelanggan tersimpan.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const openCustomer = async (id: string) => {
    if (!businessId) return;
    try {
      setSelected(await api<History>(`/api/v1/businesses/${businessId}/customers/${id}/history`));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const post = async (path: string, body: unknown, message: string) => {
    if (!businessId || !selected) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api(`/api/v1/businesses/${businessId}/customers/${selected.customer.id}/${path}`, {
        method: path === 'credit' ? 'PUT' : 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify(body),
      });
      await openCustomer(selected.customer.id);
      setSuccess(message);
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
          <span className="workspace-kicker">PELANGGAN</span>
          <h1>Relasi yang terlihat jelas.</h1>
          <p>Profil, riwayat transaksi, loyalty, dan piutang dalam konteks bisnis yang sama.</p>
        </div>
        <span className="panel-label">{customers.length} PELANGGAN</span>
      </section>
      {error && <Notice message={error} />}
      {success && (
        <div className="success-notice" role="status">
          {success}
        </div>
      )}
      <div className="purchasing-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Pelanggan baru</h2>
            <span className="panel-label">CRM</span>
          </div>
          <form className="compact-form" onSubmit={createCustomer}>
            <label>
              Nama
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Kode
              <input
                maxLength={40}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Otomatis bila kosong"
              />
            </label>
            <label>
              Telepon
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <button className="button" disabled={saving} type="submit">
              Tambah pelanggan
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Daftar pelanggan</h2>
            <span className="panel-label">TERBARU</span>
          </div>
          {customers.length ? (
            <div className="mini-list">
              {customers.map((customer) => (
                <button
                  className="customer-row"
                  key={customer.id}
                  type="button"
                  onClick={() => void openCustomer(customer.id)}
                >
                  <span>
                    <strong>{customer.name}</strong>
                    <small>
                      {customer.customer_code} · {customer.phone ?? 'Tanpa telepon'} ·{' '}
                      {customer.transaction_count} transaksi
                    </small>
                  </span>
                  <b>{money(customer.total_spend_minor)}</b>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted-copy">Belum ada pelanggan.</p>
          )}
        </section>
      </div>
      {selected && (
        <div className="modal-backdrop">
          <section className="payment-modal customer-modal">
            <div className="panel-header">
              <div>
                <span className="workspace-kicker">PROFIL PELANGGAN</span>
                <h2>{selected.customer.name}</h2>
              </div>
              <button className="text-button" type="button" onClick={() => setSelected(null)}>
                Tutup
              </button>
            </div>
            <p className="muted-copy">
              {selected.customer.customer_code} · {selected.customer.phone ?? 'Tanpa telepon'} ·{' '}
              {selected.customer.email ?? 'Tanpa email'}
            </p>
            <div className="metric-grid">
              <Metric label="Belanja" value={money(selected.customer.total_spend_minor)} />
              <Metric label="Transaksi" value={String(selected.customer.transaction_count)} />
              <Metric label="Loyalty" value={`${selected.loyalty_account.points_balance} poin`} />
              <Metric
                label="Piutang"
                value={`${money(selected.credit_account.balance_minor)} / ${money(selected.credit_account.credit_limit_minor)}`}
              />
            </div>
            <div className="customer-controls">
              <label>
                Atur loyalty points
                <input
                  inputMode="numeric"
                  value={points}
                  onChange={(e) => setPoints(e.target.value.replace(/^-?\D/g, ''))}
                  placeholder="+ / - points"
                />
              </label>
              <button
                className="button secondary"
                disabled={saving || !points}
                onClick={() =>
                  void post(
                    'loyalty/adjust',
                    {
                      points_delta: Number(points),
                      reason: 'Penyesuaian manual dari profil pelanggan',
                    },
                    'Loyalty diperbarui.',
                  )
                }
              >
                Sesuaikan
              </button>
              <label>
                Limit kredit
                <input
                  inputMode="numeric"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value.replace(/\D/g, ''))}
                  placeholder="Rupiah"
                />
              </label>
              <button
                className="button secondary"
                disabled={saving || !creditLimit}
                onClick={() =>
                  void post(
                    'credit',
                    { credit_limit_minor: Number(creditLimit) },
                    'Limit kredit diperbarui.',
                  )
                }
              >
                Simpan limit
              </button>
              <label>
                Bayar piutang
                <input
                  inputMode="numeric"
                  value={payment}
                  onChange={(e) => setPayment(e.target.value.replace(/\D/g, ''))}
                  placeholder="Rupiah"
                />
              </label>
              <button
                className="button secondary"
                disabled={saving || !payment}
                onClick={() =>
                  void post(
                    'credit/payment',
                    { amount_minor: Number(payment) },
                    'Pembayaran piutang tercatat.',
                  )
                }
              >
                Catat pembayaran
              </button>
            </div>
            <h3>Riwayat transaksi</h3>
            <div className="mini-list">
              {selected.sales.map((sale) => (
                <div className="mini-row" key={sale.id}>
                  <span>
                    <strong>{sale.receipt_number ?? sale.id.slice(0, 8)}</strong>
                    <small>
                      {sale.status} · {new Date(sale.created_at).toLocaleString('id-ID')}
                    </small>
                  </span>
                  <b>{money(sale.total_minor)}</b>
                </div>
              ))}
              {!selected.sales.length && <p className="muted-copy">Belum ada transaksi.</p>}
            </div>
          </section>
        </div>
      )}
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
function Expenses() {
  type Expense = {
    id: string;
    outlet_id: string | null;
    outlet_name: string | null;
    amount_minor: number;
    category: string;
    description: string;
    expense_date: string;
    payment_method: string;
    status: string;
    created_at: string;
  };
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [outletId, setOutletId] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Operasional');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const businessId = businesses[0]?.id;
  const load = async (id: string, filters = '') =>
    setExpenses(await api<Expense[]>(`/api/v1/businesses/${id}/expenses${filters}`));
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        setBusinesses(items);
        if (!items[0]) return;
        const rows = await api<typeof outlets>(`/api/v1/businesses/${items[0].id}/outlets`);
        setOutlets(rows);
        setOutletId(rows[0]?.id ?? '');
        await load(items[0].id);
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api(`/api/v1/businesses/${businessId}/expenses`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          outlet_id: outletId || undefined,
          amount_minor: amount,
          category,
          description,
          expense_date: expenseDate,
          payment_method: paymentMethod,
        }),
      });
      setAmount('');
      setDescription('');
      await load(businessId);
      setSuccess('Biaya tersimpan.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const filter = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setError('');
    try {
      const query = new URLSearchParams();
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      if (outletId) query.set('outlet_id', outletId);
      await load(businessId, `?${query.toString()}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const archive = async (expense: Expense) => {
    if (!businessId) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/v1/businesses/${businessId}/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ status: 'archived' }),
      });
      await load(businessId);
      setSuccess('Biaya diarsipkan.');
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
          <span className="workspace-kicker">BIAYA OPERASIONAL</span>
          <h1>Pengeluaran, tetap terlihat.</h1>
          <p>Catat biaya, batasi ruang lingkup outlet, dan jaga laporan tetap dapat ditelusuri.</p>
        </div>
        <span className="panel-label">{expenses.length} BIAYA</span>
      </section>
      {error && <Notice message={error} />}
      {success && (
        <div className="success-notice" role="status">
          {success}
        </div>
      )}
      <div className="purchasing-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Catat biaya</h2>
            <span className="panel-label">IDR</span>
          </div>
          <form className="compact-form" onSubmit={submit}>
            <label>
              Outlet
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                <option value="">Lintas bisnis</option>
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name} · {outlet.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Jumlah
              <input
                required
                min="1"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label>
              Kategori
              <input
                required
                maxLength={80}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
            <label>
              Deskripsi
              <input
                required
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="form-grid">
              <label>
                Tanggal
                <input
                  required
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                />
              </label>
              <label>
                Metode
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Tunai</option>
                  <option value="bank_transfer">Transfer bank</option>
                  <option value="card">Kartu</option>
                  <option value="other">Lainnya</option>
                </select>
              </label>
            </div>
            <button className="button" disabled={saving} type="submit">
              Simpan biaya
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Filter riwayat</h2>
            <span className="panel-label">MAKS 100</span>
          </div>
          <form className="compact-form" onSubmit={filter}>
            <div className="form-grid">
              <label>
                Dari
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                Sampai
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <button className="button secondary" type="submit">
              Terapkan filter
            </button>
          </form>
          <div className="metric">
            <span>Total tampilan</span>
            <strong>
              {money(expenses.reduce((sum, expense) => sum + expense.amount_minor, 0))}
            </strong>
          </div>
        </section>
      </div>
      <section className="panel purchase-history">
        <div className="panel-header">
          <h2>Riwayat biaya</h2>
          <span className="panel-label">AKTIF</span>
        </div>
        {expenses.length ? (
          <div className="data-list">
            {expenses.map((expense) => (
              <div className="data-row" key={expense.id}>
                <span>
                  <strong>
                    {expense.category} · {money(expense.amount_minor)}
                  </strong>
                  <small>
                    {expense.expense_date} · {expense.outlet_name ?? 'Lintas bisnis'} ·{' '}
                    {expense.payment_method} · {expense.description}
                  </small>
                </span>
                <button
                  className="text-button"
                  disabled={saving}
                  type="button"
                  onClick={() => void archive(expense)}
                >
                  Arsipkan
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-panel">
            <span className="empty-number">—</span>
            <h2>Belum ada biaya.</h2>
            <p>Catat biaya operasional pertama untuk mulai membangun laporan.</p>
          </div>
        )}
      </section>
    </Layout>
  );
}
function ImportExport() {
  type Job = {
    id: string;
    status: string;
    total_rows: number;
    valid_rows: number;
    error_rows: number;
    rows?: Array<{ row_number: number; status: string; error_json: string | null }>;
  };
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [importType, setImportType] = useState<'products' | 'customers' | 'suppliers'>('products');
  const [filename, setFilename] = useState('kasuro-import.json');
  const [rawRows, setRawRows] = useState(
    '[{"name":"Contoh Produk","sku":"SKU-001","price_minor":10000,"cost_minor":5000}]',
  );
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const businessId = businesses[0]?.id;
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(setBusinesses)
      .catch((err: Error) => setError(err.message));
  }, []);
  const createImport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setBusy(true);
    setError('');
    try {
      const rows = JSON.parse(rawRows) as unknown;
      if (!Array.isArray(rows)) throw new Error('Rows harus berupa array JSON.');
      const created = await api<Job>(`/api/v1/businesses/${businessId}/imports`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ import_type: importType, filename, rows }),
      });
      setJob(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const validate = async () => {
    if (!businessId || !job) return;
    setBusy(true);
    setError('');
    try {
      setJob(
        await api<Job>(`/api/v1/businesses/${businessId}/imports/${job.id}/validate`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf() },
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!businessId || !job) return;
    setBusy(true);
    setError('');
    try {
      setJob(
        await api<Job>(`/api/v1/businesses/${businessId}/imports/${job.id}/confirm`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf() },
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const exports = ['products', 'customers', 'suppliers', 'sales', 'inventory', 'expenses'];
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">DATA PORTABILITY</span>
          <h1>Masuk dan keluar dengan aman.</h1>
          <p>
            Preview, validasi, lalu konfirmasi. Export tetap dibatasi dan mengikuti ruang lingkup
            bisnis aktif.
          </p>
        </div>
        <span className="panel-label">CSV / JSON</span>
      </section>
      {error && <Notice message={error} />}
      <div className="purchasing-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Import data</h2>
            <span className="panel-label">PREVIEW DULU</span>
          </div>
          <form className="compact-form" onSubmit={createImport}>
            <label>
              Jenis data
              <select
                value={importType}
                onChange={(event) => setImportType(event.target.value as typeof importType)}
              >
                <option value="products">Produk</option>
                <option value="customers">Pelanggan</option>
                <option value="suppliers">Supplier</option>
              </select>
            </label>
            <label>
              Nama file
              <input
                required
                maxLength={200}
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
              />
            </label>
            <label>
              Rows JSON
              <textarea
                required
                value={rawRows}
                onChange={(event) => setRawRows(event.target.value)}
                rows={8}
              />
            </label>
            <button className="button" disabled={busy || !businessId} type="submit">
              Buat preview
            </button>
          </form>
          {job && (
            <div className="metric">
              <span>
                Status: {job.status} · {job.total_rows} baris
              </span>
              <strong>
                {job.valid_rows ?? 0} valid / {job.error_rows ?? 0} error
              </strong>
              <div className="form-grid">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void validate()}
                  type="button"
                >
                  Validasi
                </button>
                <button
                  className="button"
                  disabled={busy || job.status !== 'validated' || Boolean(job.error_rows)}
                  onClick={() => void confirm()}
                  type="button"
                >
                  Konfirmasi import
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Export data</h2>
            <span className="panel-label">MAKS 2.000 BARIS</span>
          </div>
          <div className="data-list">
            {exports.map((resource) => (
              <a
                className="data-row"
                key={resource}
                href={
                  businessId ? `${API}/api/v1/businesses/${businessId}/export/${resource}.csv` : '#'
                }
                download={`kasuro-${resource}.csv`}
              >
                <span>
                  <strong>{resource}</strong>
                  <small>CSV bounded dan tenant-scoped</small>
                </span>
                <b>Unduh ↗</b>
              </a>
            ))}
          </div>
        </section>
      </div>
      {job?.rows?.some((row) => row.status === 'invalid') && (
        <section className="panel">
          <div className="panel-header">
            <h2>Baris yang perlu diperbaiki</h2>
            <span className="panel-label">ERROR</span>
          </div>
          <div className="data-list">
            {job.rows
              .filter((row) => row.status === 'invalid')
              .slice(0, 100)
              .map((row) => (
                <div className="data-row" key={row.row_number}>
                  <span>
                    <strong>Baris {row.row_number}</strong>
                    <small>{row.error_json ?? 'Data tidak valid'}</small>
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
    </Layout>
  );
}
function Reports() {
  type Report = {
    summary: Record<string, number>;
    daily: Array<{ report_date: string; transaction_count: number; net_sales_minor: number }>;
    payments: Array<{ method: string; amount_minor: number; payment_count: number }>;
    top_products: Array<{ product_name: string; quantity: number; net_sales_minor: number }>;
  };
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [outletId, setOutletId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const businessId = businesses[0]?.id;
  const load = async (id: string, nextFrom = from, nextTo = to, nextOutlet = outletId) => {
    const query = new URLSearchParams({ date_from: nextFrom, date_to: nextTo });
    if (nextOutlet) query.set('outlet_id', nextOutlet);
    setLoading(true);
    try {
      setReport(await api<Report>(`/api/v1/businesses/${id}/reports/overview?${query.toString()}`));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        setBusinesses(items);
        if (!items[0]) return;
        const rows = await api<typeof outlets>(`/api/v1/businesses/${items[0].id}/outlets`);
        setOutlets(rows);
        await load(items[0].id, from, to, '');
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (businessId) void load(businessId);
  };
  const exportHref = businessId
    ? `${API}/api/v1/businesses/${businessId}/reports/export.csv?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}${outletId ? `&outlet_id=${encodeURIComponent(outletId)}` : ''}`
    : '#';
  const summary = report?.summary;
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">LAPORAN OPERASIONAL</span>
          <h1>Keputusan, bukan tebakan.</h1>
          <p>
            Penjualan, biaya, pembayaran, dan produk teratas dalam rentang yang bisa ditelusuri.
          </p>
        </div>
        <a className="button small" href={exportHref} download="kasuro-report.csv">
          Ekspor CSV
        </a>
      </section>
      {error && <Notice message={error} />}
      <section className="panel">
        <div className="panel-header">
          <h2>Rentang laporan</h2>
          <span className="panel-label">MAKS 366 HARI</span>
        </div>
        <form className="compact-form" onSubmit={apply}>
          <div className="form-grid">
            <label>
              Dari
              <input
                type="date"
                required
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              Sampai
              <input
                type="date"
                required
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
          <label>
            Outlet
            <select value={outletId} onChange={(event) => setOutletId(event.target.value)}>
              <option value="">Semua outlet yang diizinkan</option>
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name} · {outlet.code}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary" disabled={loading || !businessId} type="submit">
            {loading ? 'Memuat…' : 'Terapkan filter'}
          </button>
        </form>
      </section>
      {loading && !report ? (
        <div className="empty-panel">
          <span className="empty-number">…</span>
          <h2>Memuat laporan.</h2>
          <p>Mengambil data dalam ruang lingkup bisnis aktif.</p>
        </div>
      ) : report ? (
        <>
          <div className="metric-grid">
            <Metric label="Penjualan bersih" value={money(summary?.net_sales_minor)} />
            <Metric label="Transaksi" value={String(summary?.transaction_count ?? 0)} />
            <Metric label="Laba kotor" value={money(summary?.gross_profit_minor)} />
            <Metric label="Hasil operasional" value={money(summary?.operating_result_minor)} />
          </div>
          <section className="dashboard-grid">
            <article className="panel">
              <div className="panel-header">
                <h2>Tren harian</h2>
                <span className="panel-label">{report.daily.length} HARI</span>
              </div>
              {report.daily.length ? (
                <div className="data-list">
                  {report.daily.map((day) => (
                    <div className="data-row" key={day.report_date}>
                      <span>
                        <strong>{day.report_date}</strong>
                        <small>{day.transaction_count} transaksi</small>
                      </span>
                      <b>{money(day.net_sales_minor)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyReport text="Belum ada penjualan pada rentang ini." />
              )}
            </article>
            <article className="panel">
              <div className="panel-header">
                <h2>Metode pembayaran</h2>
                <span className="panel-label">MIX</span>
              </div>
              {report.payments.length ? (
                <div className="data-list">
                  {report.payments.map((payment) => (
                    <div className="data-row" key={payment.method}>
                      <span>
                        <strong>{payment.method}</strong>
                        <small>{payment.payment_count} pembayaran</small>
                      </span>
                      <b>{money(payment.amount_minor)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyReport text="Belum ada pembayaran tercatat." />
              )}
            </article>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Produk teratas</h2>
              <span className="panel-label">TOP 10</span>
            </div>
            {report.top_products.length ? (
              <div className="data-list">
                {report.top_products.map((product) => (
                  <div className="data-row" key={product.product_name}>
                    <span>
                      <strong>{product.product_name}</strong>
                      <small>{product.quantity} unit terjual</small>
                    </span>
                    <b>{money(product.net_sales_minor)}</b>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyReport text="Belum ada produk terjual pada rentang ini." />
            )}
          </section>
          <section className="metric-grid">
            <Metric label="Diskon" value={money(summary?.discounts_minor)} />
            <Metric label="Pajak" value={money(summary?.tax_minor)} />
            <Metric label="HPP" value={money(summary?.cogs_minor)} />
            <Metric label="Biaya operasional" value={money(summary?.expenses_minor)} />
          </section>
        </>
      ) : (
        <div className="empty-panel">
          <span className="empty-number">—</span>
          <h2>Belum ada laporan.</h2>
          <p>Hubungkan ruang kerja untuk memuat ringkasan.</p>
        </div>
      )}
    </Layout>
  );
}
function EmptyReport({ text }: { text: string }) {
  return (
    <div className="empty-panel">
      <span className="empty-number">—</span>
      <p>{text}</p>
    </div>
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
function Admin() {
  type Metrics = { users: number; businesses: number; active_businesses: number };
  type PlatformBusiness = {
    id: string;
    name: string;
    slug: string;
    status: string;
    currency_code: string;
    timezone: string;
    created_at: string;
  };
  type PlatformUser = {
    id: string;
    email: string;
    display_name: string;
    status: string;
    active_businesses: number;
    is_platform_admin: number;
  };
  type Flag = { key: string; description: string; enabled: number };
  type Audit = {
    id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    summary_json: string;
    created_at: string;
  };
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [businesses, setBusinesses] = useState<PlatformBusiness[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = async () => {
    try {
      const [nextMetrics, nextBusinesses, nextUsers, nextFlags, nextAudit] = await Promise.all([
        api<Metrics>('/api/v1/platform/metrics'),
        api<PlatformBusiness[]>('/api/v1/platform/businesses'),
        api<PlatformUser[]>('/api/v1/platform/users'),
        api<Flag[]>('/api/v1/platform/feature-flags'),
        api<Audit[]>('/api/v1/platform/audit'),
      ]);
      setMetrics(nextMetrics);
      setBusinesses(nextBusinesses);
      setUsers(nextUsers);
      setFlags(nextFlags);
      setAudit(nextAudit);
    } catch (err) {
      if (
        (err as Error).message.toLowerCase().includes('unauthorized') ||
        (err as Error).message.toLowerCase().includes('forbidden')
      )
        navigate('/admin/login', { replace: true });
      else setError((err as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const changeStatus = async (businessId: string, status: 'active' | 'suspended' | 'disabled') => {
    setBusy(businessId);
    setError('');
    try {
      await api(`/api/v1/platform/businesses/${businessId}/status`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };
  const assignPlan = async (businessId: string) => {
    const planKey = window.prompt('Plan key', 'starter');
    if (!planKey) return;
    setBusy(businessId);
    setError('');
    try {
      await api(`/api/v1/platform/businesses/${businessId}/plan`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ plan_key: planKey }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };
  const toggleFlag = async (flag: Flag) => {
    setBusy(flag.key);
    setError('');
    try {
      await api(`/api/v1/platform/feature-flags/${flag.key}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ enabled: !flag.enabled }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };
  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <Link className="brand" to="/">
            KASU<span>RO</span>
          </Link>
          <span className="workspace-kicker"> PLATFORM CONTROL</span>
        </div>
        <button
          className="text-button"
          onClick={() => {
            void api('/api/v1/auth/logout', {
              method: 'POST',
              headers: { 'X-CSRF-Token': getCsrf() },
            }).then(() => navigate('/admin/login'));
          }}
        >
          Keluar
        </button>
      </header>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">PLATFORM ADMINISTRATION</span>
          <h1>Operasi platform, tanpa menembus data merchant.</h1>
          <p>
            Metadata, status, paket, feature flag, dan audit. Data finansial tenant tidak
            ditampilkan.
          </p>
        </div>
        <span className="panel-label">RESTRICTED</span>
      </section>
      {error && <Notice message={error} />}
      {metrics && (
        <section className="metric-grid">
          <Metric label="Pengguna" value={String(metrics.users)} />
          <Metric label="Bisnis" value={String(metrics.businesses)} />
          <Metric label="Bisnis aktif" value={String(metrics.active_businesses)} />
        </section>
      )}
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Bisnis</h2>
            <span className="panel-label">METADATA</span>
          </div>
          <div className="data-list">
            {businesses.map((business) => (
              <div className="data-row" key={business.id}>
                <span>
                  <strong>{business.name}</strong>
                  <small>
                    {business.slug} · {business.status} · {business.timezone}
                  </small>
                </span>
                <span className="heading-actions">
                  <button
                    className="text-button"
                    disabled={busy === business.id}
                    onClick={() =>
                      void changeStatus(
                        business.id,
                        business.status === 'active' ? 'suspended' : 'active',
                      )
                    }
                  >
                    {business.status === 'active' ? 'Suspend' : 'Aktifkan'}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy === business.id}
                    onClick={() => void assignPlan(business.id)}
                  >
                    Plan
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Feature flags</h2>
            <span className="panel-label">CONTROLLED</span>
          </div>
          <div className="data-list">
            {flags.map((flag) => (
              <button
                className="data-row"
                key={flag.key}
                disabled={busy === flag.key}
                onClick={() => void toggleFlag(flag)}
              >
                <span>
                  <strong>{flag.key}</strong>
                  <small>{flag.description}</small>
                </span>
                <b>{flag.enabled ? 'ON' : 'OFF'}</b>
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Pengguna</h2>
            <span className="panel-label">IDENTITAS</span>
          </div>
          <div className="data-list">
            {users.map((user) => (
              <div className="data-row" key={user.id}>
                <span>
                  <strong>{user.display_name}</strong>
                  <small>
                    {user.email} · {user.active_businesses} bisnis
                  </small>
                </span>
                <b>{user.status}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Audit platform</h2>
            <span className="panel-label">100 TERAKHIR</span>
          </div>
          <div className="data-list">
            {audit.map((event) => (
              <div className="data-row" key={event.id}>
                <span>
                  <strong>{event.action}</strong>
                  <small>
                    {event.entity_type}/{event.entity_id} ·{' '}
                    {new Date(event.created_at).toLocaleString('id-ID')}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
function AdminLogin() {
  return <Auth mode="login" redirectTo="/admin" />;
}
function Auth({
  mode,
  redirectTo = '/app/dashboard',
}: {
  mode: 'login' | 'register';
  redirectTo?: string;
}) {
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
      navigate(mode === 'register' ? '/setup' : redirectTo);
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
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <Admin />
            </RequireAdmin>
          }
        />
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
          path="/app/import-export"
          element={
            <RequireAuth>
              <ImportExport />
            </RequireAuth>
          }
        />
        <Route
          path="/app/expenses"
          element={
            <RequireAuth>
              <Expenses />
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
          path="/app/purchases"
          element={
            <RequireAuth>
              <Purchasing />
            </RequireAuth>
          }
        />
        <Route
          path="/app/customers"
          element={
            <RequireAuth>
              <Customers />
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
