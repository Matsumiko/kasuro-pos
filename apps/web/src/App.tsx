import { useEffect, useMemo, useState } from 'react';
import { Barcode, Box, ChevronDown, CircleAlert, CircleCheck, CreditCard, LayoutDashboard, Menu, PackageSearch, Plus, Printer, Receipt, Search, Settings2, ShoppingCart, Store, Users, Wifi, WifiOff, X } from 'lucide-react';
import type { CartLine, CheckoutPayload, Product, SaleTotals } from '@kasuro/shared';
import { calculateSaleTotals } from '@kasuro/shared';
import { pendingSales, queueSale, removePendingSale } from './offline';

type View = 'overview' | 'pos' | 'inventory' | 'customers' | 'purchasing';
type Customer = { id: string; name: string; phone: string | null; email: string | null; createdAt?: string };
type Supplier = { id: string; name: string; phone: string | null; email: string | null };
type Dashboard = { salesToday: number; transactionsToday: number; discountToday: number; taxToday: number; lowStock: number };
type ReceiptItem = { name: string; sku: string; quantity: number; unitPrice: number; discount: number; lineTotal: number };
type ReceiptData = { id: string; receiptNumber: string; createdAt: string; subtotal: number; discount: number; tax: number; total: number; status: string; note: string | null; cashierName: string; outletName: string; customerName: string | null; customerPhone: string | null; items: ReceiptItem[]; payments: Array<{ method: string; amount: number; reference: string | null }> };
type PurchaseOrder = { id: string; orderNumber: string; status: 'draft' | 'ordered' | 'received' | 'cancelled'; total: number; createdAt: string; supplierId: string | null; supplierName: string | null; lineCount: number };

const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : 'https://kasuro-pos-api.fadztch12.workers.dev');
const formatIdr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const DEMO_PRODUCTS: Product[] = [
  { id: 'p-001', businessId: 'demo', categoryId: 'grocery', sku: 'GRC-001', barcode: '899999900001', name: 'Beras Pulen 5 kg', unit: 'karung', price: 72500, cost: 64500, stock: 18, reorderPoint: 5, imageUrl: null, isFavorite: true },
  { id: 'p-002', businessId: 'demo', categoryId: 'grocery', sku: 'GRC-002', barcode: '899999900002', name: 'Minyak Goreng 2 L', unit: 'botol', price: 36500, cost: 31200, stock: 24, reorderPoint: 8, imageUrl: null, isFavorite: true },
  { id: 'p-003', businessId: 'demo', categoryId: 'grocery', sku: 'GRC-003', barcode: '899999900003', name: 'Gula Pasir 1 kg', unit: 'pack', price: 17800, cost: 14900, stock: 32, reorderPoint: 10, imageUrl: null, isFavorite: false },
  { id: 'p-004', businessId: 'demo', categoryId: 'beverage', sku: 'MIN-001', barcode: '899999900004', name: 'Teh Melati 25 bags', unit: 'box', price: 12400, cost: 9800, stock: 7, reorderPoint: 8, imageUrl: null, isFavorite: true },
  { id: 'p-005', businessId: 'demo', categoryId: 'beverage', sku: 'MIN-002', barcode: '899999900005', name: 'Kopi Bubuk Arabika', unit: 'pack', price: 28500, cost: 21800, stock: 16, reorderPoint: 4, imageUrl: null, isFavorite: false },
  { id: 'p-006', businessId: 'demo', categoryId: 'household', sku: 'RTG-001', barcode: '899999900006', name: 'Sabun Cuci Piring 800 ml', unit: 'botol', price: 18900, cost: 15100, stock: 12, reorderPoint: 4, imageUrl: null, isFavorite: false },
  { id: 'p-007', businessId: 'demo', categoryId: 'household', sku: 'RTG-002', barcode: '899999900007', name: 'Tisu Wajah 250 sheets', unit: 'box', price: 15900, cost: 12400, stock: 4, reorderPoint: 6, imageUrl: null, isFavorite: false },
  { id: 'p-008', businessId: 'demo', categoryId: 'personal', sku: 'PRB-001', barcode: '899999900008', name: 'Sampo Daily Care 170 ml', unit: 'botol', price: 24600, cost: 19800, stock: 21, reorderPoint: 6, imageUrl: null, isFavorite: true },
];

function productToLine(product: Product): CartLine {
  return { productId: product.id, sku: product.sku, name: product.name, unit: product.unit, price: product.price, quantity: 1, discount: 0 };
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('kasuro.session');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message ?? 'Permintaan gagal');
  return response.json();
}
function Login({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [businessId, setBusinessId] = useState('business-demo');
  const [email, setEmail] = useState('andi@kasuro.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessId, email, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Login gagal');
      onSuccess(result.data.token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Login gagal'); }
    setLoading(false);
  }
  return <main className="login-page"><section className="login-card"><div className="brand login-brand"><span className="brand-mark">K</span><span>KASURO <small>POS</small></span></div><p className="eyebrow">SECURE ACCESS</p><h1>Selamat datang kembali.</h1><p className="login-copy">Masuk untuk melanjutkan operasional toko.</p><form onSubmit={submit}><label className="field-label">Business ID<input value={businessId} onChange={(event) => setBusinessId(event.target.value)} required /></label><label className="field-label">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className="field-label">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="primary-button" disabled={loading}>{loading ? 'Memeriksa...' : 'Masuk ke Kasuro'}</button></form><small className="login-footnote">Akses tercatat dan dibatasi berdasarkan role.</small></section></main>;
}


function App() {
  const [session, setSession] = useState(() => localStorage.getItem('kasuro.session'));
  const [view, setView] = useState<View>('pos');
  const [products, setProducts] = useState<Product[]>(DEMO_PRODUCTS);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({ salesToday: 0, transactionsToday: 0, discountToday: 0, taxToday: 0, lowStock: 0 });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [online, setOnline] = useState(navigator.onLine);
  const [syncCount, setSyncCount] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payment, setPayment] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [lastSale, setLastSale] = useState<ReceiptData | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const totals = useMemo(() => calculateSaleTotals(cart, 0, 0), [cart]);
  const categories = useMemo(() => [...new Set(products.map((product) => product.categoryId).filter(Boolean))] as string[], [products]);
  const filteredProducts = useMemo(() => products.filter((product) => {
    const matchesQuery = `${product.name} ${product.sku} ${product.barcode ?? ''}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (category === 'all' || product.categoryId === category);
  }), [products, query, category]);

  useEffect(() => {
    if (!session) return;
    const goOnline = () => { setOnline(true); void syncPending(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline); window.addEventListener('offline', goOffline);
    void loadRemote(); void syncPending();
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, [session]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'F2') { event.preventDefault(); document.querySelector<HTMLInputElement>('[data-search]')?.focus(); }
      if (event.key === 'F4' && cart.length) { event.preventDefault(); setCheckoutOpen(true); }
      if (event.key === 'Escape') setCheckoutOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart.length]);
  async function loadRemote() {
    const requests = await Promise.allSettled([
      api<{ data: Product[] }>('/api/v1/products'),
      api<{ data: Dashboard }>('/api/v1/dashboard'),
      api<{ data: Customer[] }>('/api/v1/customers'),
      api<{ data: Supplier[] }>('/api/v1/suppliers'),
      api<{ data: PurchaseOrder[] }>('/api/v1/purchase-orders?status=ordered'),
    ]);
    const [productResponse, dashboardResponse, customerResponse, supplierResponse, purchaseOrderResponse] = requests;
    if (productResponse.status === 'fulfilled' && productResponse.value.data.length) setProducts(productResponse.value.data);
    if (dashboardResponse.status === 'fulfilled') setDashboard(dashboardResponse.value.data);
    if (customerResponse.status === 'fulfilled') setCustomers(customerResponse.value.data);
    if (supplierResponse.status === 'fulfilled') setSuppliers(supplierResponse.value.data);
    if (purchaseOrderResponse.status === 'fulfilled') setPurchaseOrders(purchaseOrderResponse.value.data);
    if (requests.some((result) => result.status === 'rejected')) setNotice({ tone: 'error', message: 'Sebagian data belum tersinkron. Data lokal tetap tersedia.' });
  }
  async function refreshCustomers() {
    try { const response = await api<{ data: Customer[] }>('/api/v1/customers'); setCustomers(response.data); } catch { setNotice({ tone: 'error', message: 'Data pelanggan belum dapat dimuat.' }); }
  }
  async function refreshProducts() {
    try { const response = await api<{ data: Product[] }>('/api/v1/products'); if (response.data.length) setProducts(response.data); } catch { setNotice({ tone: 'error', message: 'Data inventory belum dapat dimuat.' }); }
  }
  async function refreshPurchaseOrders() {
    try { const response = await api<{ data: PurchaseOrder[] }>('/api/v1/purchase-orders?status=ordered'); setPurchaseOrders(response.data); } catch { setNotice({ tone: 'error', message: 'Purchase order belum dapat dimuat.' }); }
  }

  async function syncPending() {
    if (!navigator.onLine) return;
    const queued = await pendingSales();
    setSyncCount(queued.length);
    for (const payload of queued) {
      try { await api('/api/v1/sales', { method: 'POST', body: JSON.stringify(payload) }); await removePendingSale(payload.clientTransactionId); } catch { break; }
    }
    setSyncCount((await pendingSales()).length);
  }

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) return current.map((line) => line.productId === product.id ? { ...line, quantity: Math.min(line.quantity + 1, product.stock) } : line);
      return [...current, productToLine(product)];
    });
  }

  function updateQuantity(productId: string, delta: number) {
    setCart((current) => current.flatMap((line) => line.productId !== productId ? [line] : line.quantity + delta <= 0 ? [] : [{ ...line, quantity: line.quantity + delta }]));
  }

  async function submitCheckout() {
    if (!cart.length || Number(cashReceived || 0) < totals.total) return;
    setLoading(true);
    const payload: CheckoutPayload = { clientTransactionId: crypto.randomUUID(), outletId: 'outlet-demo', lines: cart, payments: [{ method: payment as CheckoutPayload['payments'][number]['method'], amount: Number(cashReceived) }], discount: 0, tax: 0 };
    try {
      if (!navigator.onLine) { await queueSale(payload); setSyncCount((await pendingSales()).length); setNotice({ tone: 'success', message: 'Transaksi disimpan. Akan dikirim saat koneksi pulih.' }); }
      else { const result = await api<{ data: { saleId: string } }>('/api/v1/sales', { method: 'POST', body: JSON.stringify(payload) }); const detail = await api<{ data: ReceiptData }>(`/api/v1/sales/${result.data.saleId}`); setLastSale(detail.data); setNotice({ tone: 'success', message: 'Pembayaran berhasil. Stok diperbarui.' }); }
      setCart([]); setCashReceived(''); setCheckoutOpen(false);
    } catch (error) { setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Checkout gagal.' }); }
    setLoading(false);
  }

  if (!session) return <Login onSuccess={(token) => { localStorage.setItem('kasuro.session', token); setSession(token); }} />;
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navigasi utama">
      <div className="brand"><span className="brand-mark">K</span><span>KASURO <small>POS</small></span></div>
      <div className="outlet-switcher"><span className="outlet-dot" /><span><b>Toko Sumber Rejeki</b><small>Outlet Sudirman</small></span><ChevronDown size={16} /></div>
      <nav className="main-nav">
        <NavItem icon={<LayoutDashboard size={18} />} label="Ringkasan" active={view === 'overview'} onClick={() => setView('overview')} />
        <NavItem icon={<Receipt size={18} />} label="Pembelian" active={view === 'purchasing'} onClick={() => setView('purchasing')} />
        <NavItem icon={<Box size={18} />} label="Inventory" active={view === 'inventory'} onClick={() => setView('inventory')} />
        <NavItem icon={<Users size={18} />} label="Pelanggan" active={view === 'customers'} onClick={() => setView('customers')} />
      </nav>
      <div className="sidebar-bottom"><NavItem icon={<Settings2 size={18} />} label="Pengaturan" onClick={() => setNotice({ tone: 'error', message: 'Pengaturan tersedia di modul admin.' })} /><div className="user-chip"><span className="avatar">AR</span><span><b>Andi Rahman</b><small>Owner</small></span><ChevronDown size={15} /></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><p className="eyebrow">{view === 'pos' ? 'OPERASIONAL / KASIR' : view === 'purchasing' ? 'SUPPLY / PEMBELIAN' : 'OPERASIONAL'}</p><h1>{view === 'pos' ? 'Kasir' : view === 'overview' ? 'Ringkasan hari ini' : view === 'inventory' ? 'Inventory' : view === 'purchasing' ? 'Pembelian' : 'Pelanggan'}</h1></div><div className="top-actions"><span className={online ? 'connection is-online' : 'connection'}>{online ? <Wifi size={15} /> : <WifiOff size={15} />} {online ? 'Online' : 'Offline'}{syncCount > 0 && ` · ${syncCount} tertunda`}</span><button className="icon-button" aria-label="Buka menu" onClick={() => setNotice({ tone: 'success', message: 'Semua data terbaru.' })}><Menu size={19} /></button><span className="top-avatar">AR</span></div></header>
      {notice && <div className={`notice ${notice.tone}`} role="status">{notice.tone === 'success' ? <CircleCheck size={17} /> : <CircleAlert size={17} />}<span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Tutup notifikasi"><X size={15} /></button></div>}
      {view === 'pos' && <PosView products={filteredProducts} categories={categories} category={category} setCategory={setCategory} query={query} setQuery={setQuery} cart={cart} totals={totals} addToCart={addToCart} updateQuantity={updateQuantity} openCheckout={() => setCheckoutOpen(true)} />}
      {view === 'overview' && <Overview dashboard={dashboard} products={products} goPos={() => setView('pos')} />}
      {view === 'inventory' && <Inventory products={products} onUpdated={refreshProducts} onNotice={setNotice} />}
      {view === 'customers' && <Customers customers={customers} onCreated={refreshCustomers} onNotice={setNotice} />}
      {view === 'purchasing' && <Purchasing suppliers={suppliers} products={products} purchaseOrders={purchaseOrders} onCreated={refreshPurchaseOrders} onNotice={setNotice} />}
    </main>
    {checkoutOpen && <CheckoutDialog total={totals.total} payment={payment} setPayment={setPayment} cashReceived={cashReceived} setCashReceived={setCashReceived} loading={loading} onClose={() => setCheckoutOpen(false)} onSubmit={submitCheckout} />}
    {lastSale && <ReceiptDialog receipt={lastSale} onClose={() => setLastSale(null)} onRefund={(receipt) => setLastSale(receipt)} onNotice={setNotice} />}
  </div>;
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) { return <button className={`nav-item${active ? ' active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>; }
function PosView({ products, categories, category, setCategory, query, setQuery, cart, totals, addToCart, updateQuantity, openCheckout }: { products: Product[]; categories: string[]; category: string; setCategory: (value: string) => void; query: string; setQuery: (value: string) => void; cart: CartLine[]; totals: SaleTotals; addToCart: (product: Product) => void; updateQuantity: (id: string, delta: number) => void; openCheckout: () => void }) {
  return <section className="pos-layout"><div className="catalog-panel"><div className="panel-head"><div><p className="eyebrow">PRODUK</p><h2>Pilih produk</h2></div><button className="secondary-button"><Barcode size={17} /> Scan barcode</button></div><div className="search-row"><label className="search-box"><Search size={18} /><input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama, SKU, atau barcode..." aria-label="Cari produk" /><kbd>F2</kbd></label><button className="filter-button" aria-label="Filter produk"><PackageSearch size={18} /></button></div><div className="category-tabs"><button className={category === 'all' ? 'selected' : ''} onClick={() => setCategory('all')}>Semua</button>{categories.map((item) => <button key={item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="product-grid">{products.map((product) => <button className="product-tile" key={product.id} onClick={() => addToCart(product)} disabled={product.stock <= 0}><span className={`product-art art-${product.categoryId}`}><Store size={24} /></span><span className="product-copy"><b>{product.name}</b><small>{product.sku} · {product.stock} {product.unit} tersisa</small></span><strong>{formatIdr.format(product.price)}</strong><span className="add-product"><Plus size={16} /></span></button>)}</div></div><CartPanel cart={cart} totals={totals} updateQuantity={updateQuantity} openCheckout={openCheckout} /></section>;
}
function ReceiptDialog({ receipt, onClose, onRefund, onNotice }: { receipt: ReceiptData; onClose: () => void; onRefund: (receipt: ReceiptData) => void; onNotice: (notice: { tone: 'success' | 'error'; message: string }) => void }) {
  const [reason, setReason] = useState(''); const [refundLoading, setRefundLoading] = useState(false);
  async function refund() { if (!reason.trim()) { onNotice({ tone: 'error', message: 'Alasan refund wajib diisi.' }); return; } setRefundLoading(true); try { await api('/api/v1/refunds', { method: 'POST', body: JSON.stringify({ saleId: receipt.id, reason: reason.trim() }) }); onRefund({ ...receipt, status: 'refunded' }); onNotice({ tone: 'success', message: 'Transaksi berhasil direfund dan stok dikembalikan.' }); } catch (error) { onNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Refund gagal.' }); } setRefundLoading(false); }
  return <div className="dialog-backdrop receipt-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="receipt-dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-title"><div className="dialog-head no-print"><div><p className="eyebrow">TRANSAKSI SELESAI</p><h2 id="receipt-title">{receipt.receiptNumber}</h2></div><button className="icon-button" onClick={onClose} aria-label="Tutup struk"><X size={18} /></button></div><div className="receipt-paper"><div className="receipt-brand"><span className="brand-mark">K</span><div><b>KASURO POS</b><small>{receipt.outletName}</small></div></div><div className="receipt-meta"><span>{new Date(receipt.createdAt).toLocaleString('id-ID')}</span><span>Kasir: {receipt.cashierName}</span></div><div className="receipt-items">{receipt.items.map((item) => <div className="receipt-item" key={`${item.sku}-${item.name}`}><span>{item.name}<small>{item.quantity} × {formatIdr.format(item.unitPrice)}</small></span><b>{formatIdr.format(item.lineTotal)}</b></div>)}</div><div className="receipt-totals"><span>Subtotal <b>{formatIdr.format(receipt.subtotal)}</b></span><span>Diskon <b>{formatIdr.format(receipt.discount)}</b></span><span>Pajak <b>{formatIdr.format(receipt.tax)}</b></span><strong>Total <b>{formatIdr.format(receipt.total)}</b></strong></div><div className="receipt-payment"><span>Pembayaran</span>{receipt.payments.map((payment) => <span key={`${payment.method}-${payment.amount}`}>{payment.method} <b>{formatIdr.format(payment.amount)}</b></span>)}</div><p className={`receipt-status ${receipt.status}`}>{receipt.status === 'refunded' ? 'REFUNDED' : 'LUNAS'}</p></div><div className="receipt-actions no-print"><button className="secondary-button" onClick={() => window.print()}><Printer size={17} /> Cetak struk</button>{receipt.status === 'completed' && <div className="refund-action"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Alasan refund" aria-label="Alasan refund" /><button className="danger-button" onClick={() => void refund()} disabled={refundLoading}>{refundLoading ? 'Memproses...' : 'Refund transaksi'}</button></div>}</div></section></div>;
}
function CartPanel({ cart, totals, updateQuantity, openCheckout }: { cart: CartLine[]; totals: SaleTotals; updateQuantity: (id: string, delta: number) => void; openCheckout: () => void }) { return <aside className="cart-panel"><div className="cart-head"><div><p className="eyebrow">TRANSAKSI BARU</p><h2>Keranjang</h2></div><span className="cart-count">{cart.reduce((sum, line) => sum + line.quantity, 0)} item</span></div><div className="cart-body">{cart.length === 0 ? <div className="empty-cart"><ShoppingCart size={28} /><b>Keranjang masih kosong</b><span>Pilih produk untuk memulai transaksi.</span></div> : cart.map((line) => <div className="cart-line" key={line.productId}><div className="line-info"><b>{line.name}</b><small>{formatIdr.format(line.price)} / {line.unit}</small></div><div className="quantity"><button onClick={() => updateQuantity(line.productId, -1)} aria-label={`Kurangi ${line.name}`}>−</button><span>{line.quantity}</span><button onClick={() => updateQuantity(line.productId, 1)} aria-label={`Tambah ${line.name}`}>+</button></div><strong>{formatIdr.format(line.price * line.quantity)}</strong></div>)}</div><div className="cart-footer"><div className="summary-row"><span>Subtotal</span><b>{formatIdr.format(totals.subtotal)}</b></div><div className="summary-row muted"><span>Diskon</span><span>—</span></div><div className="total-row"><span>Total</span><strong>{formatIdr.format(totals.total)}</strong></div><button className="primary-button checkout-button" onClick={openCheckout} disabled={!cart.length}>Bayar sekarang <span>F4</span><CreditCard size={17} /></button></div></aside>; }
function CheckoutDialog({ total, payment, setPayment, cashReceived, setCashReceived, loading, onClose, onSubmit }: { total: number; payment: string; setPayment: (value: string) => void; cashReceived: string; setCashReceived: (value: string) => void; loading: boolean; onClose: () => void; onSubmit: () => void }) { const change = Number(cashReceived || 0) - total; return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title"><div className="dialog-head"><div><p className="eyebrow">LANGKAH TERAKHIR</p><h2 id="checkout-title">Terima pembayaran</h2></div><button className="icon-button" onClick={onClose} aria-label="Tutup pembayaran"><X size={19} /></button></div><div className="amount-due"><span>Total yang harus dibayar</span><strong>{formatIdr.format(total)}</strong></div><label className="field-label">Metode pembayaran<select value={payment} onChange={(event) => setPayment(event.target.value)}><option value="cash">Tunai</option><option value="debit_card">Debit card</option><option value="credit_card">Credit card</option><option value="qris">QRIS</option><option value="bank_transfer">Transfer bank</option></select></label><label className="field-label">Jumlah diterima<input autoFocus inputMode="numeric" value={cashReceived} onChange={(event) => setCashReceived(event.target.value.replace(/\D/g, ''))} placeholder="0" aria-describedby="change-help" /></label><div id="change-help" className={change >= 0 ? 'change-help' : 'change-help error'}>{change >= 0 ? `Kembalian ${formatIdr.format(change)}` : `Kurang ${formatIdr.format(Math.abs(change))}`}</div><button className="primary-button" onClick={onSubmit} disabled={loading || change < 0}>{loading ? 'Memproses...' : 'Selesaikan transaksi'}</button></section></div>; }
function Overview({ dashboard, products, goPos }: { dashboard: Dashboard; products: Product[]; goPos: () => void }) { return <section className="overview"><div className="overview-intro"><div><p className="eyebrow">SELASA, 16 SEPTEMBER 2026</p><h2>Bisnis terkendali.</h2><p>Berikut kondisi operasional Outlet Sudirman hari ini.</p></div><button className="primary-button" onClick={goPos}><ShoppingCart size={17} /> Buka kasir</button></div><div className="metric-grid"><Metric label="Penjualan hari ini" value={formatIdr.format(dashboard.salesToday)} tone="accent" /><Metric label="Transaksi" value={String(dashboard.transactionsToday)} /><Metric label="Diskon diberikan" value={formatIdr.format(dashboard.discountToday)} /><Metric label="Stok perlu dicek" value={String(dashboard.lowStock)} tone="warning" /></div><div className="overview-columns"><section className="surface-card"><div className="card-title"><div><p className="eyebrow">PERHATIAN</p><h3>Stok menipis</h3></div><button className="text-button">Lihat semua</button></div>{products.filter((product) => product.stock <= product.reorderPoint).slice(0, 4).map((product) => <div className="stock-row" key={product.id}><span className="mini-art"><Box size={16} /></span><span><b>{product.name}</b><small>{product.sku}</small></span><strong>{product.stock} {product.unit}</strong></div>)}</section><section className="surface-card activity-card"><div className="card-title"><div><p className="eyebrow">AKTIVITAS</p><h3>Hari ini</h3></div><Receipt size={18} /></div><div className="empty-state"><Receipt size={25} /><span>Belum ada transaksi tersinkron.</span><small>Transaksi baru akan muncul di sini.</small></div></section></div></section>; }
function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) { return <div className={`metric-card ${tone ?? ''}`}><span>{label}</span><strong>{value}</strong><small>{tone === 'warning' ? 'Perlu perhatian' : 'Diperbarui beberapa saat lalu'}</small></div>; }
function Inventory({ products, onUpdated, onNotice }: { products: Product[]; onUpdated: () => Promise<void>; onNotice: (notice: { tone: 'success' | 'error'; message: string }) => void }) { const [open, setOpen] = useState(false); const [productId, setProductId] = useState(products[0]?.id ?? ''); const [delta, setDelta] = useState('1'); const [reason, setReason] = useState('Stock opname'); const [loading, setLoading] = useState(false); async function submit(event: React.FormEvent) { event.preventDefault(); setLoading(true); try { await api('/api/v1/inventory/adjust', { method: 'POST', body: JSON.stringify({ productId, quantityDelta: Number(delta), reason }) }); await onUpdated(); setOpen(false); onNotice({ tone: 'success', message: 'Stok berhasil disesuaikan.' }); } catch (error) { onNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Penyesuaian stok gagal.' }); } setLoading(false); } return <section className="inventory-view"><div className="section-intro"><div><p className="eyebrow">MASTER DATA</p><h2>Inventory</h2><p>Monitor ketersediaan produk di outlet aktif.</p></div><button className="primary-button" onClick={() => setOpen(true)}><Plus size={17} /> Sesuaikan stok</button></div><div className="table-card"><div className="table-toolbar"><label className="search-box compact"><Search size={17} /><input placeholder="Cari inventory..." aria-label="Cari inventory" /></label><span>{products.length} produk aktif</span></div><div className="inventory-table"><div className="table-row table-header"><span>Produk</span><span>SKU</span><span>Stok</span><span>Status</span><span>Harga jual</span></div>{products.map((product) => <div className="table-row" key={product.id}><span><b>{product.name}</b><small>{product.unit}</small></span><span>{product.sku}</span><span>{product.stock}</span><span><em className={product.stock <= product.reorderPoint ? 'status warning' : 'status good'}>{product.stock <= product.reorderPoint ? 'Menipis' : 'Aman'}</em></span><span>{formatIdr.format(product.price)}</span></div>)}</div></div>{open && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section className="checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="adjust-title"><div className="dialog-head"><div><p className="eyebrow">INVENTORY</p><h2 id="adjust-title">Sesuaikan stok</h2></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Tutup penyesuaian"><X size={18} /></button></div><form onSubmit={submit}><label className="field-label">Produk<select value={productId} onChange={(event) => setProductId(event.target.value)} required>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · stok {product.stock}</option>)}</select></label><label className="field-label">Perubahan jumlah<input type="number" step="1" value={delta} onChange={(event) => setDelta(event.target.value)} required /></label><label className="field-label">Alasan<input value={reason} onChange={(event) => setReason(event.target.value)} required /></label><button className="primary-button" disabled={loading}>{loading ? 'Menyimpan...' : 'Simpan penyesuaian'}</button></form></section></div>}</section>; }
function Customers({ customers, onCreated, onNotice }: { customers: Customer[]; onCreated: () => Promise<void>; onNotice: (notice: { tone: 'success' | 'error'; message: string }) => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setLoading(true); try { await api('/api/v1/customers', { method: 'POST', body: JSON.stringify({ name, phone, email }) }); await onCreated(); setName(''); setPhone(''); setEmail(''); setOpen(false); onNotice({ tone: 'success', message: 'Pelanggan berhasil ditambahkan.' }); } catch (error) { onNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Pelanggan gagal ditambahkan.' }); } setLoading(false); }
  return <section className="inventory-view"><div className="section-intro"><div><p className="eyebrow">MASTER DATA</p><h2>Pelanggan</h2><p>Profil pelanggan yang tersimpan di business aktif.</p></div><button className="primary-button" onClick={() => setOpen(true)}><Plus size={17} /> Tambah pelanggan</button></div><div className="table-card"><div className="table-toolbar"><span>{customers.length} pelanggan</span><span>Data tenant aktif</span></div><div className="inventory-table"><div className="table-row table-header"><span>Nama</span><span>Telepon</span><span>Email</span><span>Terdaftar</span></div>{customers.length ? customers.map((customer) => <div className="table-row customer-row" key={customer.id}><span><b>{customer.name}</b></span><span>{customer.phone ?? '—'}</span><span>{customer.email ?? '—'}</span><span>{customer.createdAt ? new Date(customer.createdAt).toLocaleDateString('id-ID') : '—'}</span></div>) : <div className="empty-state"><Users size={25} /><span>Belum ada pelanggan.</span><small>Tambahkan pelanggan saat transaksi atau dari master data.</small></div>}</div></div>{open && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section className="checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-title"><div className="dialog-head"><div><p className="eyebrow">MASTER DATA</p><h2 id="customer-title">Tambah pelanggan</h2></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Tutup pelanggan"><X size={18} /></button></div><form onSubmit={submit}><label className="field-label">Nama<input value={name} onChange={(event) => setName(event.target.value)} required autoFocus /></label><label className="field-label">Telepon<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label className="field-label">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button className="primary-button" disabled={loading}>{loading ? 'Menyimpan...' : 'Simpan pelanggan'}</button></form></section></div>}</section>;
}
function Purchasing({ suppliers, products, purchaseOrders, onCreated, onNotice }: { suppliers: Supplier[]; products: Product[]; purchaseOrders: PurchaseOrder[]; onCreated: () => Promise<void>; onNotice: (notice: { tone: 'success' | 'error'; message: string }) => void }) {
  const [availableSuppliers, setAvailableSuppliers] = useState(suppliers);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('0');
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [receivingId, setReceivingId] = useState('');
  useEffect(() => setAvailableSuppliers(suppliers), [suppliers]);
  async function createOrder(event: React.FormEvent) {
    event.preventDefault(); setLoading(true);
    try { await api('/api/v1/purchase-orders', { method: 'POST', body: JSON.stringify({ supplierId: supplierId || undefined, items: [{ productId, quantity: Number(quantity), unitCost: Number(unitCost) }] }) }); await onCreated(); onNotice({ tone: 'success', message: 'Purchase order dibuat dan menunggu penerimaan.' }); }
    catch (error) { onNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Purchase order gagal dibuat.' }); }
    setLoading(false);
  }
  async function receiveOrder(order: PurchaseOrder) {
    setReceivingId(order.id);
    try { await api(`/api/v1/purchase-orders/${order.id}/receive`, { method: 'POST' }); await onCreated(); onNotice({ tone: 'success', message: `${order.orderNumber} diterima. Stok diperbarui.` }); }
    catch (error) { onNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Penerimaan barang gagal.' }); }
    setReceivingId('');
  }
  async function createSupplier(event: React.FormEvent) {
    event.preventDefault();
    if (!supplierName.trim()) return;
    try { const result = await api<{ data: Supplier }>('/api/v1/suppliers', { method: 'POST', body: JSON.stringify({ name: supplierName, phone: supplierPhone }) }); setAvailableSuppliers((current) => [...current, result.data]); setSupplierId(result.data.id); setSupplierName(''); setSupplierPhone(''); onNotice({ tone: 'success', message: 'Supplier ditambahkan.' }); }
    catch (error) { onNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Supplier gagal ditambahkan.' }); }
  }
  return <section className="purchasing-view"><div className="section-intro"><div><p className="eyebrow">SUPPLY / PEMBELIAN</p><h2>Purchase order</h2><p>Buat, pantau, dan terima pesanan supplier.</p></div><span className="connection is-online"><Receipt size={15} /> {availableSuppliers.length} supplier</span></div><div className="purchasing-grid"><section className="surface-card"><div className="card-title"><div><p className="eyebrow">PESAN BARANG</p><h3>Purchase order baru</h3></div></div><form className="purchase-form" onSubmit={createOrder}><label className="field-label">Supplier<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Tanpa supplier</option>{availableSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label className="field-label">Produk<select value={productId} onChange={(event) => setProductId(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><div className="form-split"><label className="field-label">Jumlah<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label className="field-label">Harga modal<input type="number" min="0" step="1" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /></label></div><button className="primary-button" disabled={loading || !productId}>{loading ? 'Menyimpan...' : 'Buat purchase order'}</button></form></section><section className="surface-card"><div className="card-title"><div><p className="eyebrow">SUPPLIER BARU</p><h3>Tambah supplier</h3></div></div><form className="purchase-form" onSubmit={createSupplier}><label className="field-label">Nama supplier<input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required /></label><label className="field-label">Telepon<input value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} /></label><button className="secondary-button" disabled={!supplierName.trim()}><Plus size={17} /> Simpan supplier</button></form></section></div><section className="surface-card purchase-orders-card"><div className="card-title"><div><p className="eyebrow">PENERIMAAN BARANG</p><h3>PO menunggu diterima</h3></div><span>{purchaseOrders.length} order</span></div>{purchaseOrders.length ? <div className="purchase-order-list">{purchaseOrders.map((order) => <div className="purchase-order-row" key={order.id}><span><b>{order.orderNumber}</b><small>{order.supplierName ?? 'Tanpa supplier'} · {order.lineCount} item · {new Date(order.createdAt).toLocaleDateString('id-ID')}</small></span><strong>{formatIdr.format(order.total)}</strong><button className="secondary-button" onClick={() => void receiveOrder(order)} disabled={receivingId === order.id}>{receivingId === order.id ? 'Menerima...' : 'Terima barang'}</button></div>)}</div> : <div className="empty-state"><Box size={25} /><span>Tidak ada purchase order terbuka.</span><small>PO baru akan muncul di sini sampai seluruh barang diterima.</small></div>}</section></section>;
}

export default App;
