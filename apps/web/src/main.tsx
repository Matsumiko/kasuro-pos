import {
  cacheCatalog,
  listOfflineConflicts,
  listPendingOfflineSales,
  readCachedCatalog,
  syncOfflineSales,
  queueOfflineSale,
  type OfflineSalePayload,
} from './lib/offline';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
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
let authToken = '';
let csrfToken = '';

async function bootstrapCsrf(): Promise<void> {
  const result = await api<{ token: string }>('/api/v1/auth/csrf');
  csrfToken = result.token;
}

type Product = {
  id?: string;
  variant_id: string;
  name: string;
  sku: string;
  price_minor?: number;
  selling_price_minor: number;
  variant_label: string;
};
type PaymentMethod = 'cash' | 'transfer' | 'qris';
type PaymentEntry = { id: string; method: PaymentMethod; amount: string; reference: string };
type Business = { id: string; name: string; slug: string; member_id: string; all_outlets: number };
type SetupState = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency_code: string;
  setup_step:
    'business' | 'outlet' | 'configure' | 'products' | 'staff' | 'first-sale' | 'complete';
  setup_completed_at: string | null;
  outlet_count: number;
  product_count: number;
  staff_count: number;
};
type Outlet = {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  timezone?: string | null;
  status: 'active' | 'inactive';
};
type StaffMember = {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  status: string;
  all_outlets: number;
  role_keys: string | null;
  outlet_ids: string | null;
};
const ACTIVE_BUSINESS_KEY = 'kasuro-active-business';
function readActiveBusinessId(businesses: Business[]): string {
  const stored = localStorage.getItem(ACTIVE_BUSINESS_KEY);
  return businesses.some((business) => business.id === stored)
    ? stored!
    : (businesses[0]?.id ?? '');
}
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
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
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
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const refreshOffline = async () => {
    setPendingCount((await listPendingOfflineSales()).length);
    setConflictCount((await listOfflineConflicts()).length);
  };
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        setBusinessId(readActiveBusinessId(items));
      })
      .catch(() => setBusinesses([]));
  }, [location.pathname]);
  useEffect(() => {
    const on = () => {
      setOnline(true);
      void syncOfflineSales(API).then(refreshOffline).catch(refreshOffline);
    };
    const off = () => setOnline(false);
    const changed = () => {
      void refreshOffline();
      void api<Business[]>('/api/v1/businesses').then((items) => {
        setBusinesses(items);
        setBusinessId(readActiveBusinessId(items));
      });
    };
    addEventListener('online', on);
    addEventListener('offline', off);
    addEventListener('kasuro-offline-queue-changed', changed);
    addEventListener('kasuro-business-changed', changed);
    void refreshOffline();
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
      removeEventListener('kasuro-offline-queue-changed', changed);
      removeEventListener('kasuro-business-changed', changed);
    };
  }, []);
  const links: Array<[string, string]> = [
    ['/app/dashboard', 'Ringkasan'],
    ['/app/pos', 'Kasir'],
    ['/app/shifts', 'Shift'],
    ['/app/products', 'Produk'],
    ['/app/inventory', 'Stok'],
    ['/app/purchases', 'Pembelian'],
    ['/app/expenses', 'Biaya'],
    ['/app/import-export', 'Import / Export'],
    ['/app/customers', 'Pelanggan'],
    ['/app/refunds', 'Refund'],
    ['/app/staff', 'Tim'],
    ['/app/outlets', 'Outlet'],
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
          <div className="top-context">
            <span className="workspace-kicker">OPERASIONAL</span>
            <label className="top-business-select">
              <span className="visually-hidden">Bisnis aktif</span>
              <select
                aria-label="Bisnis aktif"
                value={businessId}
                onChange={(event) => {
                  localStorage.setItem(ACTIVE_BUSINESS_KEY, event.target.value);
                  setBusinessId(event.target.value);
                  window.dispatchEvent(new Event('kasuro-business-changed'));
                }}
              >
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name}
                  </option>
                ))}
              </select>
            </label>
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
  const location = useLocation();
  const [state, setState] = useState<'checking' | 'authenticated'>('checking');
  useEffect(() => {
    let cancelled = false;
    void api('/api/v1/auth/me')
      .then(() => bootstrapCsrf())
      .then(async () => {
        if (location.pathname === '/setup') return;
        const businesses = await api<Business[]>('/api/v1/businesses');
        const businessId = readActiveBusinessId(businesses);
        if (!businessId) return;
        const setup = await api<SetupState>(`/api/v1/businesses/${businessId}/setup`);
        if (!setup.setup_completed_at && !cancelled) navigate('/setup', { replace: true });
      })
      .then(() => {
        if (!cancelled) setState('authenticated');
      })
      .catch(() => {
        if (!cancelled) navigate('/login', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);
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
      .then(() => bootstrapCsrf())
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
  const [businessId, setBusinessId] = useState('');
  const [step, setStep] = useState<SetupState['setup_step']>('business');
  const [loading, setLoading] = useState(true);
  const [outletCount, setOutletCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessSlug, setBusinessSlug] = useState('');
  const [outletName, setOutletName] = useState('');
  const [outletCode, setOutletCode] = useState('');
  const [taxMode, setTaxMode] = useState<'exclusive' | 'inclusive'>('exclusive');
  const [taxRate, setTaxRate] = useState('0');
  const [stockPolicy, setStockPolicy] = useState<'prevent_negative' | 'allow_negative'>(
    'prevent_negative',
  );
  const [product, setProduct] = useState({ name: '', sku: '', price_minor: '', cost_minor: '' });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('cashier');
  const loadSetup = async (id: string) => {
    const state = await api<SetupState>(`/api/v1/businesses/${id}/setup`);
    setBusinessId(id);
    setStep(state.setup_completed_at ? 'complete' : state.setup_step);
    setBusinessName(state.name);
    setBusinessSlug(state.slug);
    setOutletCount(state.outlet_count);
  };
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        const id = readActiveBusinessId(items);
        if (id) await loadSetup(id);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);
  const checkpoint = async (
    nextStep: SetupState['setup_step'],
    payload: Record<string, unknown> = {},
  ) => {
    if (!businessId) return;
    await api(`/api/v1/businesses/${businessId}/setup`, {
      method: 'PATCH',
      headers: { 'X-CSRF-Token': getCsrf() },
      body: JSON.stringify({ setup_step: nextStep, ...payload }),
    });
    setStep(nextStep);
    setSuccess('Langkah tersimpan. Kamu bisa lanjut kapan saja.');
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      if (step === 'business') {
        if (!businessId) {
          const business = await api<{ id: string }>('/api/v1/businesses', {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrf() },
            body: JSON.stringify({ name: businessName, slug: businessSlug }),
          });
          setBusinessId(business.id);
          localStorage.setItem(ACTIVE_BUSINESS_KEY, business.id);
          await api(`/api/v1/businesses/${business.id}/setup`, {
            method: 'PATCH',
            headers: { 'X-CSRF-Token': getCsrf() },
            body: JSON.stringify({ setup_step: 'outlet' }),
          });
          setStep('outlet');
          setSuccess('Ruang kerja dibuat. Tambahkan outlet pertama.');
        } else {
          await checkpoint('outlet');
        }
      } else if (step === 'outlet') {
        if (outletCount === 0) {
          await api(`/api/v1/businesses/${businessId}/outlets`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrf() },
            body: JSON.stringify({ name: outletName, code: outletCode }),
          });
          setOutletCount(1);
        }
        await checkpoint('outlet');
        await checkpoint('configure');
      } else if (step === 'configure') {
        await checkpoint('products', {
          tax_mode: taxMode,
          default_tax_rate_bp: taxRate,
          stock_policy: stockPolicy,
          enabled_payment_methods: ['cash', 'transfer', 'qris'],
        });
      } else if (step === 'products') {
        if (product.name.trim()) {
          if (!product.sku.trim() || !product.price_minor || !product.cost_minor)
            throw new Error('Lengkapi nama, SKU, harga jual, dan harga modal produk.');
          await api(`/api/v1/businesses/${businessId}/products`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrf() },
            body: JSON.stringify({
              ...product,
              sku: product.sku.toUpperCase(),
              label: 'Default',
              unit_key: 'pcs',
            }),
          });
        }
        await checkpoint('staff');
      } else if (step === 'staff') {
        if (inviteEmail.trim()) {
          await api(`/api/v1/businesses/${businessId}/staff/invitations`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrf() },
            body: JSON.stringify({ email: inviteEmail.trim(), role_key: inviteRole }),
          });
        }
        await checkpoint('first-sale');
      } else if (step === 'first-sale') {
        await checkpoint('complete', { completed: true });
        navigate('/app/pos', { replace: true });
      } else if (step === 'complete') {
        navigate('/app/dashboard', { replace: true });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const canSkip = step === 'products' || step === 'staff' || step === 'first-sale';
  const skip = async () => {
    if (!canSkip) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const next: Record<'products' | 'staff' | 'first-sale', SetupState['setup_step']> = {
        products: 'staff',
        staff: 'first-sale',
        'first-sale': 'complete',
      };
      await checkpoint(next[step], step === 'first-sale' ? { completed: true } : {});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  if (loading)
    return (
      <main className="not-found">
        <p>Memuat progres setup…</p>
      </main>
    );
  if (step === 'complete')
    return (
      <main className="auth-page">
        <Link className="brand" to="/app/dashboard">
          KASU<span>RO</span>
        </Link>
        <section className="auth-card setup-card setup-complete">
          <span className="workspace-kicker">SETUP SELESAI</span>
          <h1>Ruang kerja siap dipakai.</h1>
          <p className="form-intro">
            Bisnis, outlet, dan akses dasar sudah tersimpan. Sekarang lanjut ke operasional.
          </p>
          <button className="button" onClick={() => navigate('/app/dashboard')} type="button">
            Masuk ke dashboard
          </button>
        </section>
      </main>
    );
  const stepIndex = ['business', 'outlet', 'configure', 'products', 'staff', 'first-sale'].indexOf(
    step,
  );
  const titles: Record<SetupState['setup_step'], [string, string]> = {
    business: [
      'Siapkan ruang kerja.',
      'Mulai dari nama bisnis dan alamat pendek untuk ruang kerja.',
    ],
    outlet: ['Tambahkan outlet pertama.', 'Transaksi dan stok akan selalu terikat ke outlet.'],
    configure: [
      'Tetapkan aturan dasar.',
      'Pilih cara pajak dan perilaku stok yang sesuai operasionalmu.',
    ],
    products: [
      'Masukkan produk pertama.',
      'Satu produk cukup untuk mencoba alur kasir. Kamu juga bisa melewati langkah ini.',
    ],
    staff: ['Siapkan tim.', 'Undang kasir atau staf inventori sekarang, atau lanjutkan sendiri.'],
    'first-sale': [
      'Coba transaksi pertama.',
      'Buka kasir setelah setup selesai untuk membuat penjualan pertamamu.',
    ],
    complete: ['Ruang kerja siap dipakai.', 'Setup selesai.'],
  };
  return (
    <main className="auth-page">
      <Link className="brand" to="/">
        KASU<span>RO</span>
      </Link>
      <section className="setup-layout">
        <aside className="setup-progress">
          <span className="workspace-kicker">OWNER SETUP</span>
          <strong>{stepIndex + 1} / 6</strong>
          {['Bisnis', 'Outlet', 'Konfigurasi', 'Produk', 'Tim', 'Transaksi'].map((label, index) => (
            <div className={index <= stepIndex ? 'setup-step active' : 'setup-step'} key={label}>
              <b>0{index + 1}</b>
              {label}
            </div>
          ))}
        </aside>
        <form className="auth-card setup-card" onSubmit={submit}>
          <span className="workspace-kicker">LANGKAH {stepIndex + 1} / 6</span>
          <h1>{titles[step][0]}</h1>
          <p className="form-intro">{titles[step][1]}</p>
          {step === 'business' && (
            <>
              <label>
                Nama bisnis
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
              </label>
              <label>
                Slug bisnis
                <input
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={businessSlug}
                  onChange={(event) => setBusinessSlug(event.target.value.toLowerCase())}
                />
              </label>
            </>
          )}
          {step === 'outlet' && (
            <>
              <label>
                Nama outlet
                <input
                  required
                  maxLength={120}
                  value={outletName}
                  onChange={(event) => setOutletName(event.target.value)}
                  placeholder="Outlet utama"
                />
              </label>
              <label>
                Kode outlet
                <input
                  required
                  maxLength={32}
                  value={outletCode}
                  onChange={(event) => setOutletCode(event.target.value.toUpperCase())}
                  placeholder="UTAMA"
                />
              </label>
            </>
          )}
          {step === 'configure' && (
            <>
              <label>
                Mode pajak
                <select
                  value={taxMode}
                  onChange={(event) => setTaxMode(event.target.value as typeof taxMode)}
                >
                  <option value="exclusive">Pajak di luar harga</option>
                  <option value="inclusive">Pajak sudah termasuk</option>
                </select>
              </label>
              <label>
                Pajak default, basis poin
                <input
                  inputMode="numeric"
                  value={taxRate}
                  onChange={(event) => setTaxRate(event.target.value.replace(/\D/g, ''))}
                />
              </label>
              <label>
                Kebijakan stok
                <select
                  value={stockPolicy}
                  onChange={(event) => setStockPolicy(event.target.value as typeof stockPolicy)}
                >
                  <option value="prevent_negative">Cegah stok negatif</option>
                  <option value="allow_negative">Izinkan stok negatif</option>
                </select>
              </label>
            </>
          )}
          {step === 'products' && (
            <>
              <label>
                Nama produk
                <input
                  value={product.name}
                  onChange={(event) => setProduct({ ...product, name: event.target.value })}
                  placeholder="Nama produk"
                />
              </label>
              <label>
                SKU
                <input
                  value={product.sku}
                  onChange={(event) => setProduct({ ...product, sku: event.target.value })}
                  placeholder="SKU-001"
                />
              </label>
              <label>
                Harga jual
                <input
                  inputMode="numeric"
                  value={product.price_minor}
                  onChange={(event) =>
                    setProduct({ ...product, price_minor: event.target.value.replace(/\D/g, '') })
                  }
                  placeholder="0"
                />
              </label>
              <label>
                Harga modal
                <input
                  inputMode="numeric"
                  value={product.cost_minor}
                  onChange={(event) =>
                    setProduct({ ...product, cost_minor: event.target.value.replace(/\D/g, '') })
                  }
                  placeholder="0"
                />
              </label>
            </>
          )}
          {step === 'staff' && (
            <>
              <label>
                Email staf, opsional
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="email@example.com"
                />
              </label>
              <label>
                Peran
                <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                  <option value="cashier">Kasir</option>
                  <option value="inventory_staff">Staf inventori</option>
                  <option value="manager">Manager</option>
                </select>
              </label>
            </>
          )}
          {step === 'first-sale' && (
            <div className="setup-next">
              <strong>Berikutnya: kasir</strong>
              <p>Setup akan selesai dan kamu bisa membuka POS untuk mencoba transaksi pertama.</p>
            </div>
          )}
          {error && <Notice message={error} />}
          {success && (
            <div className="success-notice" role="status">
              {success}
            </div>
          )}
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void skip();
              }}
              type="button"
            >
              Lewati
            </button>
            <button className="button" disabled={saving} type="submit">
              {saving
                ? 'Menyimpan…'
                : step === 'first-sale'
                  ? 'Selesaikan dan buka POS'
                  : 'Lanjutkan'}
            </button>
          </div>
        </form>
      </section>
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
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [cashMovementOpen, setCashMovementOpen] = useState(false);
  const [movementType, setMovementType] = useState<'cash_in' | 'cash_out'>('cash_in');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [actualCash, setActualCash] = useState('');
  const [reconciliation, setReconciliation] = useState<{
    expected_cash_minor: number;
    actual_cash_minor: number;
    difference_minor: number;
  } | null>(null);
  const [completedSale, setCompletedSale] = useState<{
    receipt_number: string;
    total_minor: number;
    change_minor: number;
  } | null>(null);
  const [heldSales, setHeldSales] = useState<
    Array<{ id: string; total_minor: number; created_at: string }>
  >([]);
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const businessId = businesses[0]?.id ?? '';
  const register = registers.find((item) => item.outlet_id === outletId);
  const shiftIsOpen = shift?.status === 'open';
  const grouped = useMemo(
    () =>
      cart.reduce<Record<string, number>>(
        (counts, item) => ({ ...counts, [item.variant_id]: (counts[item.variant_id] ?? 0) + 1 }),
        {},
      ),
    [cart],
  );
  const total = cart.reduce((sum, item) => sum + item.selling_price_minor, 0);
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const cashPaid = Number(payments.find((payment) => payment.method === 'cash')?.amount || 0);
  const nonCashPaid = payments
    .filter((payment) => payment.method !== 'cash')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const change = Math.max(0, cashPaid - Math.max(0, total - nonCashPaid));

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
  const openPayment = () => {
    setPayments([
      { id: crypto.randomUUID(), method: 'cash', amount: String(total), reference: '' },
    ]);
    setPaymentOpen(true);
  };
  const adjustQuantity = (variantId: string, delta: number) => {
    setCart((current) => {
      const item = current.find((entry) => entry.variant_id === variantId);
      if (!item) return current;
      if (delta < 0) {
        const index = current.findIndex((entry) => entry.variant_id === variantId);
        return current.filter((_, itemIndex) => itemIndex !== index);
      }
      return [...current, item];
    });
  };
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
  const complete = async (saleId: string | null, paymentRows: PaymentEntry[]) => {
    if (!businessId || !outletId || !register || !shift) return;
    const payload: OfflineSalePayload = {
      business_id: businessId,
      outlet_id: outletId,
      register_id: register.id,
      shift_id: shift.id,
      client_transaction_id: crypto.randomUUID(),
      lines: Object.entries(grouped).map(([variant_id, quantity]) => ({ variant_id, quantity })),
      payment: { method: 'cash', amount_minor: Number(paymentRows[0]?.amount || 0) },
    };
    const apiPayments = paymentRows.map((payment) => ({
      method: payment.method,
      amount_minor: Number(payment.amount),
      ...(payment.reference.trim() ? { reference: payment.reference.trim() } : {}),
    }));
    setBusy(true);
    try {
      const sale = saleId
        ? await api<typeof completedSale>(
            `/api/v1/businesses/${businessId}/sales/${saleId}/complete`,
            {
              method: 'POST',
              headers: { 'X-CSRF-Token': getCsrf() },
              body: JSON.stringify({ payments: apiPayments }),
            },
          )
        : await api<typeof completedSale>(`/api/v1/businesses/${businessId}/sales`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrf(), 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify({ ...payload, payments: apiPayments }),
          });
      setCompletedSale(sale);
      setCart([]);
      setActiveSaleId(null);
      setPaymentOpen(false);
      setPayments([]);
      setHeldSales((current) => current.filter((held) => held.id !== saleId));
    } catch (err) {
      if (
        !saleId &&
        !navigator.onLine &&
        paymentRows.every((payment) => payment.method === 'cash')
      ) {
        await queueOfflineSale(payload, 'Menunggu koneksi untuk sinkronisasi');
        window.dispatchEvent(new Event('kasuro-offline-queue-changed'));
        setCart([]);
        setPaymentOpen(false);
        setPayments([]);
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
  const addCashMovement = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId || !shift) return;
    setBusy(true);
    try {
      await api(`/api/v1/businesses/${businessId}/shifts/${shift.id}/cash-movements`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          movement_type: movementType,
          amount_minor: Number(movementAmount),
          reason: movementReason,
        }),
      });
      setCashMovementOpen(false);
      setMovementAmount('');
      setMovementReason('');
      setMessage('Pergerakan kas dicatat.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const closeShift = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId || !shift) return;
    setBusy(true);
    try {
      if (shift.status === 'open') {
        await api(`/api/v1/businesses/${businessId}/shifts/${shift.id}/close/begin`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf() },
        });
        setShift({ ...shift, status: 'closing' });
      }
      const result = await api<typeof reconciliation>(
        `/api/v1/businesses/${businessId}/shifts/${shift.id}/close`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf() },
          body: JSON.stringify({ actual_cash_minor: Number(actualCash) }),
        },
      );
      setReconciliation(result);
      setShift(null);
      setCloseOpen(false);
      setActualCash('');
      setMessage('Shift ditutup. Rekonsiliasi kas tersedia.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'F4' && shiftIsOpen && cart.length) {
        event.preventDefault();
        openPayment();
      }
      if (event.key === 'F8' && shiftIsOpen && cart.length) {
        event.preventDefault();
        void hold();
      }
      if (event.key === 'Escape') setPaymentOpen(false);
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  });
  return (
    <Layout>
      <section className="pos-heading">
        <div>
          <span className="workspace-kicker">KASIR</span>
          <h1>Siap melayani.</h1>
        </div>
        <span className="shift-pill">
          {shiftIsOpen
            ? 'Shift terbuka'
            : shift?.status === 'closing'
              ? 'Shift ditutup sementara'
              : 'Shift belum dibuka'}
        </span>
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
      {reconciliation && (
        <section className="reconciliation-panel">
          <div>
            <span className="workspace-kicker">REKONSILIASI SHIFT</span>
            <strong>Selisih {money(reconciliation.difference_minor)}</strong>
          </div>
          <span>
            Ekspektasi {money(reconciliation.expected_cash_minor)} · Aktual{' '}
            {money(reconciliation.actual_cash_minor)}
          </span>
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
                <input
                  id="opening-cash"
                  inputMode="numeric"
                  value={openingCash}
                  onChange={(event) => setOpeningCash(event.target.value.replace(/\D/g, ''))}
                />
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
            {shift && (
              <div className="shift-actions">
                <button
                  className="button secondary small"
                  disabled={busy || !shiftIsOpen}
                  onClick={() => setCashMovementOpen(true)}
                >
                  Kas masuk / keluar
                </button>
                <button
                  className="button small"
                  disabled={busy || !!cart.length}
                  onClick={() => setCloseOpen(true)}
                >
                  Tutup shift
                </button>
              </div>
            )}
          </div>
          <div className="search-wrap">
            <label htmlFor="product-search">
              Cari produk <span className="shortcut-hint">F2</span>
            </label>
            <input
              ref={searchRef}
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
                disabled={!shiftIsOpen || busy}
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
                      <small>{money(item.selling_price_minor)} per item</small>
                    </span>
                    <div className="cart-line-controls">
                      <button
                        type="button"
                        aria-label={`Kurangi ${item.name}`}
                        onClick={() => adjustQuantity(variantId, -1)}
                      >
                        −
                      </button>
                      <b>{quantity}</b>
                      <button
                        type="button"
                        aria-label={`Tambah ${item.name}`}
                        onClick={() => adjustQuantity(variantId, 1)}
                      >
                        +
                      </button>
                      <strong>{money(item.selling_price_minor * quantity)}</strong>
                    </div>
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
              disabled={!shiftIsOpen || !cart.length || busy}
              onClick={() => void hold()}
            >
              Tahan <span>F8</span>
            </button>
            <button
              className="button checkout"
              disabled={!shiftIsOpen || !cart.length || busy}
              onClick={openPayment}
            >
              {busy ? 'Memproses...' : 'Bayar'} <span>F4</span>
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
              if (
                !payments.length ||
                payments.some(
                  (payment) =>
                    !Number.isSafeInteger(Number(payment.amount)) || Number(payment.amount) <= 0,
                ) ||
                paidTotal < total ||
                payments.some((payment) => payment.method !== 'cash' && !payment.reference.trim())
              ) {
                setMessage('Pembayaran harus menutup total dan referensi non-tunai wajib diisi.');
                return;
              }
              void complete(activeSaleId, payments);
            }}
          >
            <div className="panel-header">
              <div>
                <span className="workspace-kicker">PEMBAYARAN</span>
                <h2>{money(total)}</h2>
              </div>
              <button type="button" className="text-button" onClick={() => setPaymentOpen(false)}>
                Tutup
              </button>
            </div>
            {payments.map((payment) => (
              <div className="payment-entry" key={payment.id}>
                <select
                  aria-label="Metode pembayaran"
                  value={payment.method}
                  onChange={(event) =>
                    setPayments((current) =>
                      current.map((row) =>
                        row.id === payment.id
                          ? { ...row, method: event.target.value as PaymentMethod }
                          : row,
                      ),
                    )
                  }
                >
                  <option value="cash">Tunai</option>
                  <option value="transfer">Transfer</option>
                  <option value="qris">QRIS</option>
                </select>
                <input
                  aria-label="Nominal pembayaran"
                  inputMode="numeric"
                  value={payment.amount}
                  onChange={(event) =>
                    setPayments((current) =>
                      current.map((row) =>
                        row.id === payment.id
                          ? { ...row, amount: event.target.value.replace(/\D/g, '') }
                          : row,
                      ),
                    )
                  }
                />
                <input
                  aria-label="Referensi pembayaran"
                  placeholder="Referensi untuk non-tunai"
                  value={payment.reference}
                  onChange={(event) =>
                    setPayments((current) =>
                      current.map((row) =>
                        row.id === payment.id ? { ...row, reference: event.target.value } : row,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="text-button"
                  disabled={payments.length === 1}
                  onClick={() =>
                    setPayments((current) => current.filter((row) => row.id !== payment.id))
                  }
                >
                  Hapus
                </button>
              </div>
            ))}
            <div className="payment-methods">
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  setPayments((current) => [
                    ...current,
                    { id: crypto.randomUUID(), method: 'transfer', amount: '', reference: '' },
                  ])
                }
              >
                Tambah transfer
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  setPayments((current) => [
                    ...current,
                    { id: crypto.randomUUID(), method: 'qris', amount: '', reference: '' },
                  ])
                }
              >
                Tambah QRIS
              </button>
            </div>
            <div className="payment-change">
              <span>Dibayar {money(paidTotal)} · Kembalian</span>
              <strong>{money(change)}</strong>
            </div>
            <button className="button" disabled={busy} type="submit">
              {busy ? 'Memproses...' : 'Selesaikan transaksi'}
            </button>
          </form>
        </div>
      )}
      {cashMovementOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="payment-modal" onSubmit={(event) => void addCashMovement(event)}>
            <div className="panel-header">
              <h2>Pergerakan kas</h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setCashMovementOpen(false)}
              >
                Tutup
              </button>
            </div>
            <label>
              Jenis
              <select
                value={movementType}
                onChange={(event) => setMovementType(event.target.value as 'cash_in' | 'cash_out')}
              >
                <option value="cash_in">Kas masuk</option>
                <option value="cash_out">Kas keluar</option>
              </select>
            </label>
            <label>
              Nominal
              <input
                required
                inputMode="numeric"
                value={movementAmount}
                onChange={(event) => setMovementAmount(event.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label>
              Alasan
              <input
                required
                value={movementReason}
                onChange={(event) => setMovementReason(event.target.value)}
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              Simpan pergerakan
            </button>
          </form>
        </div>
      )}
      {closeOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="payment-modal" onSubmit={(event) => void closeShift(event)}>
            <div className="panel-header">
              <h2>Tutup shift</h2>
              <button type="button" className="text-button" onClick={() => setCloseOpen(false)}>
                Batal
              </button>
            </div>
            <p>Hitung uang tunai di laci sebelum menutup shift.</p>
            <label>
              Kas aktual
              <input
                required
                inputMode="numeric"
                value={actualCash}
                onChange={(event) => setActualCash(event.target.value.replace(/\D/g, ''))}
              />
            </label>
            <button className="button" disabled={busy} type="submit">
              Tutup dan rekonsiliasi
            </button>
          </form>
        </div>
      )}
    </Layout>
  );
}

function Products() {
  type CatalogRow = Product & {
    id: string;
    barcode: string | null;
    variant_sku: string;
    variant_barcode: string | null;
    category_name: string | null;
    brand_name: string | null;
    category_id: string | null;
    brand_id: string | null;
    description: string | null;
    unit_key: string;
    cost_minor: number;
    variant_cost_minor: number;
    tax_rate_bp: number;
    reorder_level: number;
    status: 'active' | 'archived';
  };
  type Detail = CatalogRow & {
    variants: Array<{
      id: string;
      label: string;
      sku: string;
      barcode: string | null;
      price_minor: number | null;
      cost_minor: number | null;
      status: 'active' | 'archived';
    }>;
  };
  type Option = { id: string; name: string };
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [products, setProducts] = useState<CatalogRow[]>([]);
  const [options, setOptions] = useState<{ categories: Option[]; brands: Option[] }>({
    categories: [],
    brands: [],
  });
  const [selected, setSelected] = useState<Detail | null>(null);
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const businessId = readActiveBusinessId(businesses);
  const load = async (id: string, search = query, archived = includeArchived) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (archived) params.set('include_archived', '1');
      const [rows, catalogOptions] = await Promise.all([
        api<CatalogRow[]>(`/api/v1/businesses/${id}/products?${params}`),
        api<{ categories: Option[]; brands: Option[] }>(`/api/v1/businesses/${id}/catalog-options`),
      ]);
      setProducts(rows);
      setOptions(catalogOptions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        const id = readActiveBusinessId(items);
        if (id) void load(id);
        else setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);
  const openDetail = async (productId: string) => {
    if (!businessId) return;
    setError('');
    try {
      setSelected(await api<Detail>(`/api/v1/businesses/${businessId}/products/${productId}`));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const archiveProduct = async () => {
    if (!businessId || !selected) return;
    try {
      await api(`/api/v1/businesses/${businessId}/products/${selected.id}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ status: selected.status === 'archived' ? 'active' : 'archived' }),
      });
      setSuccess(selected.status === 'archived' ? 'Produk dipulihkan.' : 'Produk diarsipkan.');
      setSelected(null);
      await load(businessId);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const toggleVariant = async (variant: Detail['variants'][number]) => {
    if (!businessId || !selected) return;
    try {
      await api(`/api/v1/businesses/${businessId}/products/${selected.id}/variants/${variant.id}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ status: variant.status === 'archived' ? 'active' : 'archived' }),
      });
      await openDetail(selected.id);
      setSuccess(variant.status === 'archived' ? 'Varian dipulihkan.' : 'Varian diarsipkan.');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">KATALOG</span>
          <h1>Produk yang siap dijual.</h1>
          <p>Kelola identitas produk, varian, harga, dan status katalog dalam satu ruang kerja.</p>
        </div>
        <div className="heading-actions">
          <Link className="button" to="/app/products/new">
            Tambah produk
          </Link>
          <span className="panel-label">{products.length} BARIS</span>
        </div>
      </section>
      {error && <Notice message={error} />}
      {success && (
        <div className="success-notice inline-notice" role="status">
          {success}
        </div>
      )}
      <section className="catalog-toolbar" aria-label="Filter katalog">
        <form
          className="catalog-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (businessId) void load(businessId);
          }}
        >
          <label htmlFor="catalog-search">Cari nama, SKU, atau barcode</label>
          <div>
            <input
              id="catalog-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Contoh: kopi atau SKU-001"
            />
            <button className="button" type="submit">
              Cari
            </button>
          </div>
        </form>
        <label className="catalog-toggle">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => {
              setIncludeArchived(event.target.checked);
              if (businessId) void load(businessId, query, event.target.checked);
            }}
          />{' '}
          Tampilkan arsip
        </label>
      </section>
      {loading ? (
        <div className="state-card catalog-state" role="status">
          Memuat katalog...
        </div>
      ) : products.length ? (
        <div className="data-list catalog-list">
          {products.map((product) => (
            <button
              className="data-row product-row"
              key={product.variant_id}
              type="button"
              onClick={() => void openDetail(product.id)}
            >
              <span>
                <strong>{product.name}</strong>
                <small>
                  {product.variant_label} · {product.variant_sku} ·{' '}
                  {product.category_name ?? 'Tanpa kategori'}
                  {product.status === 'archived' ? ' · Diarsipkan' : ''}
                </small>
              </span>
              <b>{money(product.selling_price_minor)}</b>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <span className="empty-number">0</span>
          <h2>{query ? 'Produk tidak ditemukan.' : 'Katalog belum berisi produk.'}</h2>
          <p>
            {query
              ? 'Coba kata kunci lain atau tampilkan produk arsip.'
              : 'Tambahkan produk pertama untuk mulai mengisi stok dan berjualan.'}
          </p>
          <Link className="button" to="/app/products/new">
            Buat produk pertama
          </Link>
        </div>
      )}
      {options.categories.length + options.brands.length > 0 && (
        <p className="catalog-option-summary">
          {options.categories.length} kategori · {options.brands.length} brand aktif
        </p>
      )}
      {selected && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="panel catalog-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-detail-title"
          >
            <div className="panel-header">
              <div>
                <span className="workspace-kicker">DETAIL KATALOG</span>
                <h2 id="catalog-detail-title">{selected.name}</h2>
              </div>
              <button className="text-button dark" type="button" onClick={() => setSelected(null)}>
                Tutup
              </button>
            </div>
            <p className="muted-copy">
              {selected.sku} · {selected.category_name ?? 'Tanpa kategori'} ·{' '}
              {selected.brand_name ?? 'Tanpa brand'} · {selected.status}
            </p>
            <div className="metric-grid catalog-metrics">
              <Metric label="Harga jual" value={money(selected.selling_price_minor)} />
              <Metric label="Modal" value={money(selected.variant_cost_minor)} />
              <Metric label="Pajak" value={`${selected.tax_rate_bp / 100}%`} />
              <Metric label="Titik pesan" value={`${selected.reorder_level} unit`} />
            </div>
            <div className="panel-header catalog-variants-heading">
              <h3>Varian</h3>
              <span className="panel-label">{selected.variants.length} VARIAN</span>
            </div>
            <div className="mini-list">
              {selected.variants.map((variant) => (
                <div className="mini-row" key={variant.id}>
                  <span>
                    <strong>{variant.label}</strong>
                    <small>
                      {variant.sku} · {variant.status} ·{' '}
                      {money(variant.price_minor ?? selected.price_minor)}
                    </small>
                  </span>
                  <button
                    className="text-button dark"
                    type="button"
                    onClick={() => void toggleVariant(variant)}
                  >
                    {variant.status === 'archived' ? 'Pulihkan' : 'Arsipkan'}
                  </button>
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void archiveProduct()}
              >
                {selected.status === 'archived' ? 'Pulihkan produk' : 'Arsipkan produk'}
              </button>
              <Link className="button" to={`/app/products/${selected.id}/edit`}>
                Edit detail
              </Link>
            </div>
          </section>
        </div>
      )}
    </Layout>
  );
}

function ProductCreate() {
  type Option = { id: string; name: string };
  const navigate = useNavigate();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [options, setOptions] = useState<{ categories: Option[]; brands: Option[] }>({
    categories: [],
    brands: [],
  });
  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    description: '',
    unit_key: 'pcs',
    price_minor: '',
    cost_minor: '',
    tax_rate_bp: '0',
    reorder_level: '0',
    category_id: '',
    brand_id: '',
    label: 'Default',
  });
  const [optionType, setOptionType] = useState<'category' | 'brand'>('category');
  const [optionName, setOptionName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        const id = readActiveBusinessId(items);
        if (id)
          return api<typeof options>(`/api/v1/businesses/${id}/catalog-options`).then(setOptions);
      })
      .catch((err: Error) => setError(err.message));
  }, []);
  const businessId = readActiveBusinessId(businesses);
  const createOption = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !optionName.trim()) return;
    try {
      const created = await api<Option & { type: string }>(
        `/api/v1/businesses/${businessId}/catalog-options`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf() },
          body: JSON.stringify({ type: optionType, name: optionName }),
        },
      );
      setOptions((current) => ({
        ...current,
        [optionType === 'category' ? 'categories' : 'brands']: [
          ...current[optionType === 'category' ? 'categories' : 'brands'],
          created,
        ],
      }));
      update(optionType === 'category' ? 'category_id' : 'brand_id', created.id);
      setOptionName('');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    setError('');
    try {
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
          <p>Identitas dan harga dasar menjadi sumber data untuk stok, pembelian, dan kasir.</p>
        </div>
        <Link className="button secondary" to="/app/products">
          Batal
        </Link>
      </section>
      <div className="catalog-create-layout">
        <form className="form-panel" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Nama produk
              <input
                required
                maxLength={160}
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
            <label>
              Titik pesan ulang
              <input
                inputMode="numeric"
                min="0"
                value={form.reorder_level}
                onChange={(event) => update('reorder_level', event.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="field-wide">
              Deskripsi
              <textarea
                maxLength={500}
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
              />
            </label>
            <label>
              Kategori
              <select
                value={form.category_id}
                onChange={(event) => update('category_id', event.target.value)}
              >
                <option value="">Tanpa kategori</option>
                {options.categories.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Brand
              <select
                value={form.brand_id}
                onChange={(event) => update('brand_id', event.target.value)}
              >
                <option value="">Tanpa brand</option>
                {options.brands.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <Notice message={error} />}
          <div className="form-actions">
            <Link className="button secondary" to="/app/products">
              Kembali
            </Link>
            <button className="button" disabled={saving} type="submit">
              {saving ? 'Menyimpan...' : 'Simpan produk'}
            </button>
          </div>
        </form>
        <section className="panel option-panel">
          <span className="workspace-kicker">REFERENSI KATALOG</span>
          <h2>Tambah kategori atau brand.</h2>
          <p className="muted-copy">Buat pilihan baru tanpa meninggalkan formulir produk.</p>
          <form className="compact-form" onSubmit={createOption}>
            <label>
              Jenis
              <select
                value={optionType}
                onChange={(event) => setOptionType(event.target.value as 'category' | 'brand')}
              >
                <option value="category">Kategori</option>
                <option value="brand">Brand</option>
              </select>
            </label>
            <label>
              Nama
              <input
                required
                maxLength={120}
                value={optionName}
                onChange={(event) => setOptionName(event.target.value)}
              />
            </label>
            <button className="button secondary" type="submit">
              Tambah pilihan
            </button>
          </form>
        </section>
      </div>
    </Layout>
  );
}

function ProductEdit() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [form, setForm] = useState({
    name: '',
    barcode: '',
    description: '',
    unit_key: 'pcs',
    price_minor: '',
    cost_minor: '',
    tax_rate_bp: '0',
    reorder_level: '0',
    category_id: '',
    brand_id: '',
  });
  const [options, setOptions] = useState<{
    categories: Array<{ id: string; name: string }>;
    brands: Array<{ id: string; name: string }>;
  }>({ categories: [], brands: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!productId) return;
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        setBusinesses(items);
        const id = readActiveBusinessId(items);
        if (!id) throw new Error('Buat ruang kerja terlebih dahulu');
        const [product, catalogOptions] = await Promise.all([
          api<{
            name: string;
            barcode: string | null;
            description: string | null;
            unit_key: string;
            price_minor: number;
            cost_minor: number;
            tax_rate_bp: number;
            reorder_level: number;
            category_id: string | null;
            brand_id: string | null;
          }>(`/api/v1/businesses/${id}/products/${productId}`),
          api<typeof options>(`/api/v1/businesses/${id}/catalog-options`),
        ]);
        setForm({
          name: product.name,
          barcode: product.barcode ?? '',
          description: product.description ?? '',
          unit_key: product.unit_key,
          price_minor: String(product.price_minor),
          cost_minor: String(product.cost_minor),
          tax_rate_bp: String(product.tax_rate_bp),
          reorder_level: String(product.reorder_level),
          category_id: product.category_id ?? '',
          brand_id: product.brand_id ?? '',
        });
        setOptions(catalogOptions);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [productId]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const id = readActiveBusinessId(businesses);
    if (!id || !productId) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/v1/businesses/${id}/products/${productId}`, {
        method: 'PATCH',
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
  if (loading)
    return (
      <Layout>
        <div className="state-card catalog-state">Memuat detail produk...</div>
      </Layout>
    );
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">KATALOG / EDIT PRODUK</span>
          <h1>Perbarui detail.</h1>
          <p>
            Perubahan katalog berlaku untuk transaksi berikutnya. Riwayat penjualan tetap memakai
            snapshotnya.
          </p>
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
              maxLength={160}
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
            />
          </label>
          <label>
            Barcode
            <input
              value={form.barcode}
              onChange={(event) => update('barcode', event.target.value)}
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
            Pajak <span className="field-hint">basis poin</span>
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
              value={form.price_minor}
              onChange={(event) => update('price_minor', event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label>
            Harga modal (rupiah)
            <input
              required
              inputMode="numeric"
              value={form.cost_minor}
              onChange={(event) => update('cost_minor', event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label>
            Titik pesan ulang
            <input
              inputMode="numeric"
              value={form.reorder_level}
              onChange={(event) => update('reorder_level', event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label>
            Kategori
            <select
              value={form.category_id}
              onChange={(event) => update('category_id', event.target.value)}
            >
              <option value="">Tanpa kategori</option>
              {options.categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Brand
            <select
              value={form.brand_id}
              onChange={(event) => update('brand_id', event.target.value)}
            >
              <option value="">Tanpa brand</option>
              {options.brands.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-wide">
            Deskripsi
            <textarea
              maxLength={500}
              value={form.description}
              onChange={(event) => update('description', event.target.value)}
            />
          </label>
        </div>
        {error && <Notice message={error} />}
        <div className="form-actions">
          <Link className="button secondary" to="/app/products">
            Kembali
          </Link>
          <button className="button" disabled={saving} type="submit">
            {saving ? 'Menyimpan...' : 'Simpan perubahan'}
          </button>
        </div>
      </form>
    </Layout>
  );
}

function Inventory() {
  type InventoryRow = {
    outlet_id: string;
    variant_id: string;
    name: string;
    sku: string;
    label: string;
    quantity_on_hand: number;
    average_cost_minor: number;
    updated_at: string;
  };
  type Movement = InventoryRow & {
    id: string;
    movement_type: string;
    quantity_delta: number;
    unit_cost_minor: number;
    source_type: string;
    source_id: string;
    created_at: string;
  };
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [outletId, setOutletId] = useState('');
  const load = async (id: string, selectedOutlet = outletId) => {
    const query = selectedOutlet ? `?outlet_id=${encodeURIComponent(selectedOutlet)}` : '';
    const [balances, history] = await Promise.all([
      api<InventoryRow[]>(`/api/v1/businesses/${id}/inventory${query}`),
      api<Movement[]>(`/api/v1/businesses/${id}/inventory/movements${query}`),
    ]);
    setRows(balances);
    setMovements(history);
  };
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then(async (items) => {
        setBusinesses(items);
        if (items[0]) await load(items[0].id);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);
  const businessId = businesses[0]?.id ?? '';
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">INVENTORI</span>
          <h1>Stok yang dapat dipercaya.</h1>
          <p>Saldo terkini dan jejak perubahannya, per outlet.</p>
        </div>
        <div className="heading-actions">
          <Link className="button" to="/app/inventory/adjustments">
            Catat penyesuaian
          </Link>
          <Link className="button secondary" to="/app/inventory/workflows">
            Opname dan transfer
          </Link>
        </div>
      </section>
      <section className="inventory-controls">
        <label>
          <span>Outlet</span>
          <select
            aria-label="Filter outlet"
            value={outletId}
            onChange={(event) => {
              setOutletId(event.target.value);
              if (businessId)
                void load(businessId, event.target.value).catch((err: Error) =>
                  setError(err.message),
                );
            }}
          >
            <option value="">Semua outlet yang dapat diakses</option>
          </select>
        </label>
      </section>
      {loading && (
        <div className="state-card catalog-state" role="status">
          Memuat saldo dan riwayat stok...
        </div>
      )}
      {error && <Notice message={error} />}
      {!loading && !error && !rows.length && (
        <div className="empty-panel">
          <span className="empty-number">STOK</span>
          <h2>Belum ada saldo stok.</h2>
          <p>Buat produk lalu catat penerimaan atau penyesuaian pertama.</p>
          <Link className="button" to="/app/inventory/adjustments">
            Catat stok pertama
          </Link>
        </div>
      )}
      {!loading && !error && rows.length > 0 && (
        <>
          <div className="data-list">
            {rows.map((row) => (
              <article className="data-row" key={`${row.outlet_id}-${row.variant_id}`}>
                <span>
                  <strong>{row.name}</strong>
                  <small>
                    {row.label} · {row.sku} · Outlet {row.outlet_id.slice(0, 8)}
                  </small>
                </span>
                <b className={row.quantity_on_hand <= 0 ? 'negative' : ''}>
                  {row.quantity_on_hand} pcs
                </b>
              </article>
            ))}
          </div>
          <section className="movement-panel">
            <div className="panel-header">
              <h2>Riwayat movement</h2>
              <span>{movements.length} catatan terbaru</span>
            </div>
            {!movements.length && (
              <p className="muted-copy">Belum ada movement untuk filter ini.</p>
            )}
            <div className="movement-list">
              {movements.map((movement) => (
                <article className="movement-row" key={movement.id}>
                  <span>
                    <strong>
                      {movement.name} · {movement.label}
                    </strong>
                    <small>
                      {movement.movement_type} · {movement.source_type}:
                      {movement.source_id.slice(0, 8)}
                    </small>
                  </span>
                  <b className={movement.quantity_delta < 0 ? 'negative' : ''}>
                    {movement.quantity_delta > 0 ? '+' : ''}
                    {movement.quantity_delta}
                  </b>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </Layout>
  );
}

function InventoryWorkflows() {
  type OutletOption = { id: string; name: string; code: string };
  type ProductOption = { variant_id: string; name: string; sku: string };
  type Count = { id: string; outlet_id: string; status: string; created_at: string };
  type Transfer = {
    id: string;
    source_outlet_id: string;
    destination_outlet_id: string;
    status: string;
    created_at: string;
  };
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [outletId, setOutletId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [physicalQuantity, setPhysicalQuantity] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const businessId = businesses[0]?.id ?? '';
  const refresh = async (id: string) => {
    const [outletRows, productRows, countRows, transferRows] = await Promise.all([
      api<OutletOption[]>(`/api/v1/businesses/${id}/outlets`),
      api<ProductOption[]>(`/api/v1/businesses/${id}/products`),
      api<Count[]>(`/api/v1/businesses/${id}/stock-counts`),
      api<Transfer[]>(`/api/v1/businesses/${id}/stock-transfers`),
    ]);
    setOutlets(outletRows);
    setProducts(productRows);
    setCounts(countRows);
    setTransfers(transferRows);
    setOutletId((current) => current || outletRows[0]?.id || '');
    setDestinationId((current) => current || outletRows[1]?.id || '');
    setVariantId((current) => current || productRows[0]?.variant_id || '');
  };
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        if (items[0]) return refresh(items[0].id);
        return undefined;
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);
  const createCount = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/businesses/${businessId}/stock-counts`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          outlet_id: outletId,
          lines: [{ variant_id: variantId, physical_quantity: Number(physicalQuantity) }],
        }),
      });
      setPhysicalQuantity('');
      await refresh(businessId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const createTransfer = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/businesses/${businessId}/stock-transfers`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          source_outlet_id: outletId,
          destination_outlet_id: destinationId,
          lines: [{ variant_id: variantId, quantity: Number(quantity) }],
        }),
      });
      setQuantity('');
      await refresh(businessId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runTransfer = async (transferId: string, action: 'send' | 'receive') => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/businesses/${businessId}/stock-transfers/${transferId}/${action}`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
      });
      await refresh(businessId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">INVENTORI / WORKFLOW</span>
          <h1>Opname dan transfer.</h1>
          <p>
            Draft tidak mengubah saldo. Posting dan pengiriman meninggalkan jejak yang bisa diaudit.
          </p>
        </div>
        <Link className="button secondary" to="/app/inventory">
          Kembali ke saldo
        </Link>
      </section>
      {loading && (
        <div className="state-card catalog-state" role="status">
          Memuat workflow stok...
        </div>
      )}
      {error && <Notice message={error} />}
      {!loading && (
        <section className="workflow-grid">
          <form className="panel compact-form" onSubmit={(event) => void createCount(event)}>
            <div className="panel-header">
              <h2>Mulai stock count</h2>
              <span>Draft → posted</span>
            </div>
            <label>
              Outlet
              <select
                required
                value={outletId}
                onChange={(event) => setOutletId(event.target.value)}
              >
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
                {products.map((product) => (
                  <option key={product.variant_id} value={product.variant_id}>
                    {product.name} · {product.sku}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Jumlah fisik
              <input
                required
                min="0"
                type="number"
                value={physicalQuantity}
                onChange={(event) => setPhysicalQuantity(event.target.value)}
              />
            </label>
            <button className="button" disabled={busy || !outlets.length || !products.length}>
              Simpan hitungan
            </button>
          </form>
          <form className="panel compact-form" onSubmit={(event) => void createTransfer(event)}>
            <div className="panel-header">
              <h2>Buat transfer</h2>
              <span>requested → sent</span>
            </div>
            <label>
              Dari
              <select
                required
                value={outletId}
                onChange={(event) => setOutletId(event.target.value)}
              >
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name} · {outlet.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ke
              <select
                required
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                {outlets
                  .filter((outlet) => outlet.id !== outletId)
                  .map((outlet) => (
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
                {products.map((product) => (
                  <option key={product.variant_id} value={product.variant_id}>
                    {product.name} · {product.sku}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Jumlah
              <input
                required
                min="1"
                type="number"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <button className="button" disabled={busy || outlets.length < 2 || !products.length}>
              Buat transfer
            </button>
          </form>
        </section>
      )}
      {!loading && (
        <section className="workflow-history">
          <div className="panel">
            <div className="panel-header">
              <h2>Stock counts</h2>
              <span>{counts.length} terbaru</span>
            </div>
            {counts.length ? (
              counts.map((count) => (
                <div className="mini-row" key={count.id}>
                  <span>
                    <strong>{count.status}</strong>
                    <small>Outlet {count.outlet_id.slice(0, 8)}</small>
                  </span>
                  <small>{count.id.slice(0, 8)}</small>
                </div>
              ))
            ) : (
              <p className="muted-copy">Belum ada stock count.</p>
            )}
          </div>
          <div className="panel">
            <div className="panel-header">
              <h2>Transfers</h2>
              <span>{transfers.length} terbaru</span>
            </div>
            {transfers.length ? (
              transfers.map((transfer) => (
                <div className="mini-row" key={transfer.id}>
                  <span>
                    <strong>{transfer.status}</strong>
                    <small>
                      {transfer.source_outlet_id.slice(0, 8)} →{' '}
                      {transfer.destination_outlet_id.slice(0, 8)}
                    </small>
                  </span>
                  <span className="heading-actions">
                    {transfer.status === 'requested' && (
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => void runTransfer(transfer.id, 'send')}
                      >
                        Kirim
                      </button>
                    )}
                    {transfer.status === 'sent' && (
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => void runTransfer(transfer.id, 'receive')}
                      >
                        Terima
                      </button>
                    )}
                  </span>
                </div>
              ))
            ) : (
              <p className="muted-copy">Belum ada transfer.</p>
            )}
          </div>
        </section>
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
  const requestKey = useRef('');
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
      if (!requestKey.current) requestKey.current = crypto.randomUUID();
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
            idempotency_key: requestKey.current,
          }),
        },
      );
      setSuccess(
        `Stok tersimpan: ${result.quantity_on_hand} pcs · modal rata-rata ${money(result.average_cost_minor)}`,
      );
      setQuantity('');
      requestKey.current = '';
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
function Staff() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('cashier');
  const [drafts, setDrafts] = useState<
    Record<string, { role: string; allOutlets: boolean; outletIds: string[] }>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const load = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const [staffRows, outletRows] = await Promise.all([
        api<StaffMember[]>(`/api/v1/businesses/${id}/staff`),
        api<Outlet[]>(`/api/v1/businesses/${id}/outlets`),
      ]);
      setStaff(staffRows);
      setOutlets(outletRows);
      setDrafts(
        Object.fromEntries(
          staffRows.map((member) => [
            member.id,
            {
              role: member.role_keys?.split(',')[0] ?? 'cashier',
              allOutlets: member.all_outlets === 1,
              outletIds: member.outlet_ids?.split(',').filter(Boolean) ?? [],
            },
          ]),
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        const id = readActiveBusinessId(items);
        setBusinessId(id);
        if (id) return load(id);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);
  const changeBusiness = (id: string) => {
    setBusinessId(id);
    localStorage.setItem(ACTIVE_BUSINESS_KEY, id);
    window.dispatchEvent(new Event('kasuro-business-changed'));
    void load(id);
  };
  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving('invite');
    setError('');
    setSuccess('');
    try {
      const result = await api<{ email: string; role_key: string; invitation_token: string }>(
        `/api/v1/businesses/${businessId}/staff/invitations`,
        {
          method: 'POST',
          headers: { 'X-CSRF-Token': getCsrf() },
          body: JSON.stringify({ email, role_key: inviteRole }),
        },
      );
      setSuccess(`Undangan untuk ${result.email} dibuat. Token: ${result.invitation_token}`);
      setEmail('');
      await load(businessId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving('');
    }
  };
  type StaffDraft = { role: string; allOutlets: boolean; outletIds: string[] };
  const updateDraft = (memberId: string, patch: Partial<StaffDraft>) =>
    setDrafts((current) => {
      const existing = current[memberId];
      return existing ? { ...current, [memberId]: { ...existing, ...patch } } : current;
    });
  const toggleOutlet = (memberId: string, outletId: string) => {
    const draft = drafts[memberId];
    if (!draft) return;
    updateDraft(memberId, {
      outletIds: draft.outletIds.includes(outletId)
        ? draft.outletIds.filter((id) => id !== outletId)
        : [...draft.outletIds, outletId],
    });
  };
  const saveMember = async (memberId: string) => {
    const draft = drafts[memberId];
    if (!draft || !businessId) return;
    setSaving(memberId);
    setError('');
    setSuccess('');
    try {
      await api(`/api/v1/businesses/${businessId}/staff/${memberId}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          role_key: draft.role,
          all_outlets: draft.allOutlets,
          outlet_ids: draft.outletIds,
        }),
      });
      setSuccess('Akses staf diperbarui.');
      await load(businessId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving('');
    }
  };
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">TIM / AKSES</span>
          <h1>Siapa yang boleh masuk.</h1>
          <p>Undang staf, tetapkan peran, lalu batasi pekerjaan mereka ke outlet yang benar.</p>
        </div>
        <label className="context-select">
          Bisnis aktif
          <select value={businessId} onChange={(event) => changeBusiness(event.target.value)}>
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      {error && <Notice message={error} />}
      {success && (
        <div className="success-notice inline-notice" role="status">
          {success}
        </div>
      )}
      <section className="management-grid">
        <form className="form-panel management-form" onSubmit={invite}>
          <div>
            <span className="panel-label">UNDANG STAF</span>
            <h2>Tambahkan orang ke ruang kerja.</h2>
          </div>
          <label>
            Email kerja
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email@example.com"
            />
          </label>
          <label>
            Peran awal
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="cashier">Kasir</option>
              <option value="inventory_staff">Staf inventori</option>
            </select>
          </label>
          <button className="button" disabled={saving === 'invite' || !businessId} type="submit">
            {saving === 'invite' ? 'Membuat…' : 'Buat undangan'}
          </button>
        </form>
        <div className="panel management-note">
          <span className="panel-label">ATURAN AKSES</span>
          <h2>Peran memberi kemampuan. Outlet memberi batas.</h2>
          <p>
            Owner dan admin mengelola akses. Kasir dan staf inventori hanya melihat outlet yang
            ditugaskan.
          </p>
        </div>
      </section>
      <section className="management-list">
        <div className="section-intro">
          <span className="panel-label">ANGGOTA AKTIF</span>
          <h2>Staf dan penugasannya.</h2>
        </div>
        {loading ? (
          <div className="state-card">Memuat anggota dan outlet…</div>
        ) : staff.length === 0 ? (
          <div className="state-card">Belum ada anggota lain. Buat undangan pertama di atas.</div>
        ) : (
          <div className="staff-list">
            {staff.map((member) => {
              const draft = drafts[member.id];
              return (
                <article className="staff-card" key={member.id}>
                  <div className="staff-identity">
                    <strong>{member.display_name || member.email}</strong>
                    <small>
                      {member.email} · {member.status}
                    </small>
                  </div>
                  <div className="staff-controls">
                    <label>
                      Peran
                      <select
                        value={draft?.role ?? 'cashier'}
                        onChange={(event) => updateDraft(member.id, { role: event.target.value })}
                      >
                        <option value="admin">Admin</option>
                        <option value="manager">Manager</option>
                        <option value="cashier">Kasir</option>
                        <option value="inventory_staff">Staf inventori</option>
                      </select>
                    </label>
                    <label className="scope-toggle">
                      <input
                        type="checkbox"
                        checked={draft?.allOutlets ?? false}
                        onChange={(event) =>
                          updateDraft(member.id, { allOutlets: event.target.checked })
                        }
                      />{' '}
                      Semua outlet
                    </label>
                    {!draft?.allOutlets && (
                      <fieldset className="outlet-checks">
                        <legend>Outlet</legend>
                        {outlets.map((outlet) => (
                          <label key={outlet.id}>
                            <input
                              type="checkbox"
                              checked={draft?.outletIds.includes(outlet.id) ?? false}
                              onChange={() => toggleOutlet(member.id, outlet.id)}
                            />{' '}
                            {outlet.name}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <button
                      className="button small"
                      disabled={saving === member.id}
                      onClick={() => void saveMember(member.id)}
                      type="button"
                    >
                      {saving === member.id ? 'Menyimpan…' : 'Simpan akses'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </Layout>
  );
}

function Outlets() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [form, setForm] = useState({
    code: '',
    name: '',
    address: '',
    phone: '',
    timezone: 'Asia/Jakarta',
  });
  const [editing, setEditing] = useState<Outlet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const load = async (id: string) => {
    setLoading(true);
    try {
      setOutlets(await api<Outlet[]>(`/api/v1/businesses/${id}/outlets`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void api<Business[]>('/api/v1/businesses')
      .then((items) => {
        setBusinesses(items);
        const id = readActiveBusinessId(items);
        setBusinessId(id);
        if (id) return load(id);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);
  const changeBusiness = (id: string) => {
    setBusinessId(id);
    localStorage.setItem(ACTIVE_BUSINESS_KEY, id);
    void load(id);
  };
  const createOutlet = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api(`/api/v1/businesses/${businessId}/outlets`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify(form),
      });
      setForm({ code: '', name: '', address: '', phone: '', timezone: 'Asia/Jakarta' });
      setSuccess('Outlet dan register pertamanya dibuat.');
      await load(businessId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const updateOutlet = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId || !editing) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api(`/api/v1/businesses/${businessId}/outlets/${editing.id}`, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify(editing),
      });
      setSuccess('Detail outlet diperbarui.');
      setEditing(null);
      await load(businessId);
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
          <span className="workspace-kicker">RUANG KERJA / OUTLET</span>
          <h1>Tempat transaksi terjadi.</h1>
          <p>Kelola alamat operasional, status outlet, dan register awalnya.</p>
        </div>
        <label className="context-select">
          Bisnis aktif
          <select value={businessId} onChange={(event) => changeBusiness(event.target.value)}>
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      {error && <Notice message={error} />}
      {success && (
        <div className="success-notice inline-notice" role="status">
          {success}
        </div>
      )}
      <section className="management-grid">
        <form className="form-panel management-form" onSubmit={createOutlet}>
          <div>
            <span className="panel-label">OUTLET BARU</span>
            <h2>Buka titik operasional baru.</h2>
          </div>
          <label>
            Kode
            <input
              required
              maxLength={32}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              placeholder="OUTLET-01"
            />
          </label>
          <label>
            Nama
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Nama outlet"
            />
          </label>
          <label>
            Alamat
            <input
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
              placeholder="Alamat operasional"
            />
          </label>
          <label>
            Telepon
            <input
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="Nomor telepon"
            />
          </label>
          <button className="button" disabled={saving || !businessId} type="submit">
            {saving ? 'Menyimpan…' : 'Buat outlet'}
          </button>
        </form>
        <div className="panel management-note">
          <span className="panel-label">OPERASIONAL</span>
          <h2>Setiap outlet mendapat register pertama otomatis.</h2>
          <p>
            Setelah dibuat, tetapkan staf ke outlet ini dari halaman Tim. Outlet nonaktif tidak
            menerima transaksi baru.
          </p>
        </div>
      </section>
      <section className="management-list">
        <div className="section-intro">
          <span className="panel-label">DAFTAR OUTLET</span>
          <h2>Outlet yang bisa dipilih tim.</h2>
        </div>
        {loading ? (
          <div className="state-card">Memuat outlet…</div>
        ) : outlets.length === 0 ? (
          <div className="state-card">Belum ada outlet. Isi formulir untuk memulai.</div>
        ) : (
          <div className="outlet-list">
            {outlets.map((outlet) => (
              <article className="outlet-card" key={outlet.id}>
                <div>
                  <strong>{outlet.name}</strong>
                  <small>
                    {outlet.code} · {outlet.status === 'active' ? 'Aktif' : 'Nonaktif'}
                  </small>
                  <p>
                    {outlet.address || 'Alamat belum diisi'}
                    {outlet.phone ? ` · ${outlet.phone}` : ''}
                  </p>
                </div>
                <div className="heading-actions">
                  <button
                    className="button secondary small"
                    type="button"
                    onClick={() => setEditing(outlet)}
                  >
                    Edit detail
                  </button>
                  <button
                    className="button small"
                    type="button"
                    onClick={() =>
                      void api(`/api/v1/businesses/${businessId}/outlets/${outlet.id}`, {
                        method: 'PATCH',
                        headers: { 'X-CSRF-Token': getCsrf() },
                        body: JSON.stringify({
                          status: outlet.status === 'active' ? 'inactive' : 'active',
                        }),
                      }).then(() => load(businessId))
                    }
                  >
                    {outlet.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {editing && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setEditing(null);
          }}
        >
          <form className="form-panel modal-card" onSubmit={updateOutlet}>
            <div className="panel-header">
              <div>
                <span className="panel-label">EDIT OUTLET</span>
                <h2>{editing.name}</h2>
              </div>
              <button className="text-button dark" onClick={() => setEditing(null)} type="button">
                Tutup
              </button>
            </div>
            <label>
              Nama
              <input
                required
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>
            <label>
              Alamat
              <input
                value={editing.address ?? ''}
                onChange={(event) => setEditing({ ...editing, address: event.target.value })}
              />
            </label>
            <label>
              Telepon
              <input
                value={editing.phone ?? ''}
                onChange={(event) => setEditing({ ...editing, phone: event.target.value })}
              />
            </label>
            <label>
              Zona waktu
              <input
                value={editing.timezone ?? ''}
                onChange={(event) => setEditing({ ...editing, timezone: event.target.value })}
              />
            </label>
            <button className="button" disabled={saving} type="submit">
              {saving ? 'Menyimpan…' : 'Simpan perubahan'}
            </button>
          </form>
        </div>
      )}
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
  const [importType, setImportType] = useState<
    'products' | 'customers' | 'suppliers' | 'opening_stock'
  >('products');
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
                <option value="opening_stock">Stok awal</option>
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
                aria-describedby="import-format-help"
                value={rawRows}
                onChange={(event) => setRawRows(event.target.value)}
                rows={8}
              />
              <small id="import-format-help">
                {importType === 'opening_stock'
                  ? 'Gunakan variant_id atau sku, outlet_id atau outlet_code, quantity, dan unit_cost_minor.'
                  : 'Gunakan array JSON dengan nama dan kode unik untuk setiap baris.'}
              </small>
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

function Shifts() {
  type ShiftRow = {
    id: string;
    outlet_id: string;
    register_name: string;
    cashier_name: string;
    status: string;
    opening_cash_minor: number;
    expected_cash_minor: number | null;
    actual_cash_minor: number | null;
    difference_minor: number | null;
    opened_at: string;
    closed_at: string | null;
  };
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async (id: string, selectedOutlet = outletId) => {
    setLoading(true);
    setError('');
    try {
      const query = selectedOutlet ? `?outlet_id=${encodeURIComponent(selectedOutlet)}` : '';
      setShifts(await api<ShiftRow[]>(`/api/v1/businesses/${id}/shifts${query}`));
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
        const id = readActiveBusinessId(items);
        setBusinessId(id);
        if (!id) return;
        const rows = await api<Outlet[]>(`/api/v1/businesses/${id}/outlets`);
        setOutlets(rows);
        await load(id);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);
  const changeBusiness = async (id: string) => {
    setBusinessId(id);
    setOutletId('');
    localStorage.setItem(ACTIVE_BUSINESS_KEY, id);
    window.dispatchEvent(new Event('kasuro-business-changed'));
    try {
      const rows = await api<Outlet[]>(`/api/v1/businesses/${id}/outlets`);
      setOutlets(rows);
      await load(id, '');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Layout>
      <section className="page-heading">
        <div>
          <span className="workspace-kicker">SHIFT / KAS REGISTER</span>
          <h1>Rekonsiliasi yang bisa ditelusuri.</h1>
          <p>Periksa kas awal, hasil penjualan, pergerakan kas, dan selisih setiap shift.</p>
        </div>
        <div className="heading-actions">
          <label className="context-select">
            Bisnis aktif
            <select
              value={businessId}
              onChange={(event) => void changeBusiness(event.target.value)}
            >
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </label>
          <label className="context-select">
            Outlet
            <select
              value={outletId}
              onChange={(event) => {
                setOutletId(event.target.value);
                if (businessId) void load(businessId, event.target.value);
              }}
            >
              <option value="">Semua outlet</option>
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {error && <Notice message={error} />}
      {loading ? (
        <div className="state-card">Memuat riwayat shift…</div>
      ) : shifts.length ? (
        <section className="shift-history data-list">
          {shifts.map((shift) => (
            <article className="data-row shift-history-row" key={shift.id}>
              <div>
                <strong>
                  {shift.register_name} · {shift.outlet_id.slice(0, 8).toUpperCase()}
                </strong>
                <small>
                  {shift.cashier_name} · {new Date(shift.opened_at).toLocaleString('id-ID')}
                </small>
                <small>
                  {shift.closed_at
                    ? `Ditutup ${new Date(shift.closed_at).toLocaleString('id-ID')}`
                    : 'Masih berjalan'}
                </small>
              </div>
              <div className="shift-history-values">
                <span className={`status-tag ${shift.status}`}>{shift.status}</span>
                <b>
                  {shift.difference_minor === null
                    ? 'Belum direkonsiliasi'
                    : `Selisih ${money(shift.difference_minor)}`}
                </b>
                <small>
                  Ekspektasi{' '}
                  {shift.expected_cash_minor === null ? '—' : money(shift.expected_cash_minor)}
                </small>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="empty-panel">
          <span className="empty-number">—</span>
          <h2>Belum ada riwayat shift.</h2>
          <p>Shift yang dibuka dari kasir akan muncul di sini.</p>
        </div>
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
        <div className="heading-actions">
          <Link className="button secondary" to="/app/refunds">
            Riwayat refund
          </Link>
          <span className="panel-label">{sales.length} TRANSAKSI</span>
        </div>
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
  const [voiding, setVoiding] = useState(false);
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
  const refundTotal = refundableLines.reduce((total, line) => {
    const quantity = Number(quantities[line.id] ?? 0) || 0;
    return (
      total +
      Math.floor((line.line_net_minor * quantity + Math.floor(line.quantity / 2)) / line.quantity)
    );
  }, 0);
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
  const voidSale = async () => {
    if (!businessId || !saleId || !sale || !['draft', 'held'].includes(sale.status)) return;
    if (!window.confirm('Batalkan transaksi yang ditahan ini?')) return;
    setVoiding(true);
    setError('');
    try {
      await api(`/api/v1/businesses/${businessId}/sales/${saleId}/void`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrf() },
      });
      setSale({ ...sale, status: 'void' });
      setRefundMessage('Pesanan ditahan dibatalkan. Tidak ada stok atau pembayaran yang diubah.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVoiding(false);
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
          {sale && ['draft', 'held'].includes(sale.status) && (
            <button
              className="button secondary"
              disabled={voiding}
              onClick={() => void voidSale()}
              type="button"
            >
              {voiding ? 'Membatalkan…' : 'Batalkan pesanan'}
            </button>
          )}
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
    setError('');
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.[A-Za-z]{2,}$/.test(normalizedEmail)) {
      setError('Gunakan email valid, contoh: nama@bisnis.com.');
      return;
    }
    if (password.length < 12) {
      setError('Password minimal 12 karakter.');
      return;
    }
    try {
      const result = await api<{ csrf_token?: string; auth_token?: string }>(
        `/api/v1/auth/${mode}`,
        {
          method: 'POST',
          body: JSON.stringify(
            mode === 'register'
              ? { email: normalizedEmail, password, display_name: name.trim() }
              : { email: normalizedEmail, password },
          ),
        },
      );
      if (result.auth_token) authToken = result.auth_token;
      if (result.csrf_token) csrfToken = result.csrf_token;
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
  return csrfToken;
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
          path="/app/shifts"
          element={
            <RequireAuth>
              <Shifts />
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
          path="/app/inventory/workflows"
          element={
            <RequireAuth>
              <InventoryWorkflows />
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
          path="/app/products/:productId/edit"
          element={
            <RequireAuth>
              <ProductEdit />
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
          path="/app/staff"
          element={
            <RequireAuth>
              <Staff />
            </RequireAuth>
          }
        />
        <Route
          path="/app/outlets"
          element={
            <RequireAuth>
              <Outlets />
            </RequireAuth>
          }
        />
        <Route path="/features" element={<FeaturesPage />} />
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

function FeaturesPage() {
  const features = [
    {
      index: '01',
      eyebrow: 'KASIR',
      title: 'Transaksi yang mengikuti ritme toko.',
      body: 'Pencarian produk yang cepat, shift yang jelas, pesanan yang bisa ditahan, dan pembayaran yang selesai dalam satu alur.',
      points: ['Buka dan tutup shift', 'Hold dan resume pesanan', 'Pembayaran tunai dan split'],
    },
    {
      index: '02',
      eyebrow: 'STOK',
      title: 'Saldo yang punya cerita.',
      body: 'Kasuro menghubungkan stok dengan pergerakannya. Penerimaan, penjualan, penyesuaian, dan modal rata-rata tetap bisa ditelusuri.',
      points: ['Saldo per outlet', 'Movement immutable', 'Weighted-average costing'],
    },
    {
      index: '03',
      eyebrow: 'RUANG KERJA',
      title: 'Satu bisnis. Akses yang tepat.',
      body: 'Kelola outlet, tim, dan izin dalam konteks yang sama. Owner, manager, cashier, dan inventory staff melihat pekerjaan yang memang menjadi tanggung jawabnya.',
      points: ['Role berbasis izin', 'Akses per outlet', 'Audit aktivitas penting'],
    },
  ];

  return (
    <div className="app-shell features-page">
      <header className="topbar landing-topbar">
        <Link className="brand" to="/">
          KASU<span>RO</span>
        </Link>
        <nav aria-label="Navigasi fitur">
          <Link to="/">Beranda</Link>
          <Link to="/pricing">Harga</Link>
          <Link to="/login">Masuk</Link>
        </nav>
      </header>
      <main>
        <section className="features-hero">
          <div>
            <span className="eyebrow">Di dalam Kasuro</span>
            <h1>Semua yang penting, terlihat jelas.</h1>
            <p>
              Bukan kumpulan menu yang berdiri sendiri. Kasuro dibuat supaya transaksi, stok, dan
              tim saling menjelaskan.
            </p>
          </div>
          <div className="features-hero-index">
            03
            <br />
            <span>ALUR UTAMA</span>
          </div>
        </section>

        <section className="features-overview">
          <span className="landing-section-mark">KASURO / CARA KERJA</span>
          <p>
            Mulai dari momen paling sibuk di toko. Lalu lihat bagaimana setiap keputusan
            meninggalkan konteks yang berguna.
          </p>
        </section>

        <section className="features-list">
          {features.map((feature) => (
            <article className="feature-detail" key={feature.index}>
              <div className="feature-detail-meta">
                <span>{feature.index}</span>
                <span>{feature.eyebrow}</span>
              </div>
              <div className="feature-detail-copy">
                <h2>{feature.title}</h2>
                <p>{feature.body}</p>
              </div>
              <ul>
                {feature.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="features-flow">
          <div>
            <span className="eyebrow">Bukan hanya di depan</span>
            <h2>Dari transaksi pertama sampai keputusan berikutnya.</h2>
          </div>
          <div className="features-flow-steps">
            <div>
              <b>01</b>
              <span>Jual</span>
              <small>Kasir tetap fokus pada pelanggan.</small>
            </div>
            <div>
              <b>02</b>
              <span>Catat</span>
              <small>Stok dan pembayaran ikut tercatat.</small>
            </div>
            <div>
              <b>03</b>
              <span>Pahami</span>
              <small>Laporan memberi konteks untuk langkah berikutnya.</small>
            </div>
          </div>
        </section>

        <section className="features-cta">
          <span className="eyebrow">Mulai dengan fondasi yang benar</span>
          <h2>Kasuro siap mengikuti cara bisnismu bekerja.</h2>
          <Link className="button" to="/register">
            Mulai gratis <span>↗</span>
          </Link>
        </section>
      </main>
      <footer className="footer landing-footer">
        <span>KASURO POS</span>
        <span>Jelas di kasir. Terkendali di belakang.</span>
        <span>© 2026</span>
      </footer>
    </div>
  );
}

function PublicHome() {
  const capabilities = [
    {
      index: '01',
      title: 'Kasir yang tidak menghalangi ritme toko.',
      body: 'Cari produk, buka shift, tahan pesanan, dan selesaikan pembayaran tanpa berpindah-pindah konteks.',
      link: 'Buka alur kasir',
    },
    {
      index: '02',
      title: 'Stok dengan jejak yang bisa dijelaskan.',
      body: 'Setiap penerimaan, penyesuaian, dan penjualan membentuk riwayat yang tetap terbaca oleh tim.',
      link: 'Lihat cara stok bekerja',
    },
    {
      index: '03',
      title: 'Outlet dan tim dalam konteks yang sama.',
      body: 'Atur akses berdasarkan bisnis dan outlet. Yang terlihat oleh setiap orang selalu sesuai tanggung jawabnya.',
      link: 'Atur ruang kerja',
    },
  ];

  return (
    <div className="app-shell landing-page">
      <header className="topbar landing-topbar">
        <Link className="brand" to="/">
          KASU<span>RO</span>
        </Link>
        <nav aria-label="Navigasi utama">
          <Link to="/features">Cara kerja</Link>
          <Link to="/pricing">Harga</Link>
          <Link to="/login">Masuk</Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="eyebrow">POS untuk operasional yang nyata</div>
            <h1>Jual lebih jelas. Kelola lebih tenang.</h1>
            <p>
              Kasuro menyatukan kasir, stok, outlet, dan tim dalam satu ruang kerja yang mengikuti
              cara bisnis berjalan setiap hari.
            </p>
            <div className="actions">
              <Link className="button" to="/register">
                Mulai gratis <span>↗</span>
              </Link>
              <Link className="button secondary" to="/features">
                Lihat fitur
              </Link>
            </div>
            <div className="landing-note">
              <span className="landing-note-mark">●</span>
              <span>Mulai dari satu outlet. Siap mengikuti langkah berikutnya.</span>
            </div>
          </div>
          <div className="landing-hero-visual" aria-label="Ringkasan ruang kerja Kasuro">
            <div className="landing-visual-topline">
              <span>RUANG KERJA</span>
              <span className="landing-live">
                <i /> TERHUBUNG
              </span>
            </div>
            <div className="landing-visual-title">
              Hari ini
              <br />
              <b>terkendali.</b>
            </div>
            <div className="landing-visual-grid">
              <div>
                <span>Kasir</span>
                <strong>Siap</strong>
              </div>
              <div>
                <span>Stok</span>
                <strong>Terlihat</strong>
              </div>
              <div>
                <span>Tim</span>
                <strong>Terarah</strong>
              </div>
            </div>
            <div className="landing-visual-line">
              <span>Outlet utama</span>
              <b>Online</b>
            </div>
          </div>
        </section>

        <section className="landing-intent" aria-label="Janji produk">
          <span className="landing-section-mark">KASURO POS</span>
          <p>
            Satu tempat untuk mengetahui apa yang terjadi di depan kasir — dan apa yang perlu
            dilakukan setelahnya.
          </p>
        </section>

        <section className="landing-capabilities">
          <div className="landing-section-heading">
            <div>
              <span className="eyebrow">Cara kerja</span>
              <h2>Yang terjadi di toko, terlihat di satu alur.</h2>
            </div>
            <p>
              Dirancang untuk keputusan kecil yang harus tetap terasa ringan saat toko sedang ramai.
            </p>
          </div>
          <div className="landing-capability-list">
            {capabilities.map((capability) => (
              <article className="landing-capability" key={capability.index}>
                <span className="landing-capability-index">{capability.index}</span>
                <div>
                  <h3>{capability.title}</h3>
                  <p>{capability.body}</p>
                  <span className="landing-capability-link">
                    {capability.link} <b>↗</b>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-operations">
          <div className="landing-operations-copy">
            <span className="eyebrow">Dibuat untuk bergerak</span>
            <h2>Bukan sekadar mencatat transaksi.</h2>
            <p>
              Kasuro menjaga hubungan antara penjualan, stok, dan orang yang menjalankannya. Jadi
              ketika hari selesai, kamu tidak perlu menebak-nebak apa yang berubah.
            </p>
            <Link className="text-link" to="/register">
              Bangun ruang kerja pertama <span>↗</span>
            </Link>
          </div>
          <div className="landing-operations-list">
            <div>
              <span>Penjualan</span>
              <b>Masuk ke laporan</b>
              <i>01</i>
            </div>
            <div>
              <span>Stok</span>
              <b>Berubah dengan jejak</b>
              <i>02</i>
            </div>
            <div>
              <span>Tim</span>
              <b>Bekerja sesuai akses</b>
              <i>03</i>
            </div>
          </div>
        </section>

        <section className="landing-cta">
          <div>
            <span className="eyebrow">Mulai dari yang penting</span>
            <h2>Ruang kerja yang terasa lebih ringan.</h2>
          </div>
          <div>
            <p>
              Siapkan bisnis dan outlet pertama. Sisanya bisa dibangun seiring ritme operasionalmu.
            </p>
            <Link className="button" to="/register">
              Buat ruang kerja <span>↗</span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="footer landing-footer">
        <span>KASURO POS</span>
        <span>Jelas di kasir. Terkendali di belakang.</span>
        <span>© 2026</span>
      </footer>
    </div>
  );
}
