/* ===================== Meu Financeiro — app.js ===================== */

/* ---------- storage keys & defaults ---------- */
const LS = {
  tx: 'mf_transactions',
  categories: 'mf_categories',
  payments: 'mf_payments',
  budgets: 'mf_budgets',
  subs: 'mf_subscriptions',
  goals: 'mf_goals',
  settings: 'mf_settings',
};

const DEFAULT_CATEGORIES = [
  'Luz', 'Saídas / Namoro', 'Investimentos', 'Roupas / Compras', 'Presentes',
  'Mercado', 'Transporte', 'Assinaturas', 'Saúde / Cuidados', 'Outros'
];
const DEFAULT_PAYMENTS = ['PIX', 'Crédito', 'Débito', 'Vale Alimentação', 'Dinheiro'];
const DEFAULT_SETTINGS = { cdiRate: 13.90, theme: 'system' };

/* ---------- storage helpers (local backend) ---------- */
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function uid() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- in-memory cache: the single source of truth the UI reads/writes.
   In local mode it mirrors localStorage; in cloud mode it mirrors Supabase.
   This keeps every render*() function unchanged regardless of backend. ---------- */
function emptyCache() {
  return { tx: [], categories: [], payments: [], budgets: {}, subs: [], goals: [], settings: Object.assign({}, DEFAULT_SETTINGS) };
}
let CACHE = emptyCache();
let cloudMode = false;
let sb = null;
let currentUser = null;

// Each setter returns a promise that resolves once the write actually lands
// (in cloudMode) — callers await it before treating the action as "done" and
// closing a modal, so a background/close right after "saved" can't cancel an
// in-flight request and silently lose the write.
// Getters return a defensive copy, never the live CACHE reference. Callers
// throughout the app do `const x = getTx(); x.push(...); setTx(x)` — if getTx()
// returned the live array, that push() would mutate CACHE.tx in place *before*
// setTx() runs, making its "old" snapshot identical to "new" and making the
// cloud diff (diffArrayById/syncSimpleList/syncBudgets) see no change at all,
// silently skipping the Supabase write while the UI still shows success.
function getTx() { return CACHE.tx.slice(); }
function setTx(v) { const old = CACHE.tx; CACHE.tx = v; return onChange('tx', old, v); }
function getCategories() { return CACHE.categories.slice(); }
function setCategories(v) { const old = CACHE.categories; CACHE.categories = v; return onChange('categories', old, v); }
function getPayments() { return CACHE.payments.slice(); }
function setPayments(v) { const old = CACHE.payments; CACHE.payments = v; return onChange('payments', old, v); }
function getBudgets() { return Object.assign({}, CACHE.budgets); }
function setBudgets(v) { const old = CACHE.budgets; CACHE.budgets = v; return onChange('budgets', old, v); }
function getSubs() { return CACHE.subs.slice(); }
function setSubs(v) { const old = CACHE.subs; CACHE.subs = v; return onChange('subs', old, v); }
function getGoals() { return CACHE.goals.slice(); }
function setGoals(v) { const old = CACHE.goals; CACHE.goals = v; return onChange('goals', old, v); }
function getSettings() { return Object.assign({}, CACHE.settings); }
function setSettings(v) { const old = CACHE.settings; CACHE.settings = v; return onChange('settings', old, v); }

function onChange(key, oldVal, newVal) {
  if (!cloudMode) { save(LS[key], newVal); return Promise.resolve(); }
  return syncCloud(key, oldVal, newVal).catch(err => {
    console.error('Supabase sync error', key, err);
    toast('Erro ao sincronizar com o Supabase: ' + err.message);
    throw err;
  });
}

// For simple (non-modal) mutations: wait for the write, then toast + re-render.
// onChange() already toasted the specific error on failure, so just re-render either way.
async function saveAndToast(promise, successMsg) {
  try {
    await promise;
    if (successMsg) toast(successMsg);
  } catch (e) { /* already toasted by onChange */ }
  render();
}

// For modal saves: disable the button while the write is in flight so the
// modal can't be dismissed mid-save, and only close on confirmed success.
async function saveViaModal(promise, btn, successMsg) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    await promise;
    closeModal();
    toast(successMsg);
    render();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function hydrateFromLocalStorage() {
  CACHE = {
    tx: load(LS.tx, []),
    categories: load(LS.categories, DEFAULT_CATEGORIES.slice()),
    payments: load(LS.payments, DEFAULT_PAYMENTS.slice()),
    budgets: load(LS.budgets, {}),
    subs: load(LS.subs, []),
    goals: load(LS.goals, []),
    settings: Object.assign({}, DEFAULT_SETTINGS, load(LS.settings, {})),
  };
}

/* ---------- cloud backend (Supabase) ---------- */
function setupSupabase() {
  const cfg = window.SUPABASE_CONFIG;
  cloudMode = !!(cfg && cfg.url && cfg.anonKey && !/YOUR-PROJECT|YOUR-ANON/.test(cfg.url + cfg.anonKey));
  if (cloudMode) sb = window.supabase.createClient(cfg.url, cfg.anonKey);
}

function diffArrayById(oldArr, newArr) {
  const oldMap = new Map(oldArr.map(x => [x.id, x]));
  const newMap = new Map(newArr.map(x => [x.id, x]));
  const upserts = newArr.filter(x => {
    const o = oldMap.get(x.id);
    return !o || JSON.stringify(o) !== JSON.stringify(x);
  });
  const deletes = oldArr.filter(x => !newMap.has(x.id)).map(x => x.id);
  return { upserts, deletes };
}

const rowMappers = {
  tx: {
    table: 'transactions',
    toRow: t => ({ id: t.id, user_id: currentUser.id, date: t.date, type: t.type, amount: t.amount, category: t.category, payment: t.payment, description: t.description || '', created_at: new Date(t.createdAt || Date.now()).toISOString() }),
    fromRow: r => ({ id: r.id, date: r.date, type: r.type, amount: Number(r.amount), category: r.category, payment: r.payment, description: r.description || '', createdAt: new Date(r.created_at).getTime() }),
  },
  subs: {
    table: 'subscriptions',
    toRow: s => ({ id: s.id, user_id: currentUser.id, name: s.name, amount: s.amount, category: s.category, payment: s.payment, day: s.day, active: s.active !== false, last_launched_month: s.lastLaunchedMonth || null }),
    fromRow: r => ({ id: r.id, name: r.name, amount: Number(r.amount), category: r.category, payment: r.payment, day: r.day, active: r.active, lastLaunchedMonth: r.last_launched_month }),
  },
  goals: {
    table: 'goals',
    toRow: g => ({ id: g.id, user_id: currentUser.id, name: g.name, target: g.target, current: g.current }),
    fromRow: r => ({ id: r.id, name: r.name, target: Number(r.target), current: Number(r.current) }),
  },
};

async function syncArrayTable(key, oldArr, newArr) {
  const m = rowMappers[key];
  const { upserts, deletes } = diffArrayById(oldArr, newArr);
  if (upserts.length) {
    const { error } = await sb.from(m.table).upsert(upserts.map(m.toRow));
    if (error) throw error;
  }
  if (deletes.length) {
    const { error } = await sb.from(m.table).delete().in('id', deletes);
    if (error) throw error;
  }
}

async function syncSimpleList(table, oldArr, newArr) {
  const removed = oldArr.filter(x => !newArr.includes(x));
  const added = newArr.filter(x => !oldArr.includes(x));
  if (removed.length) {
    const { error } = await sb.from(table).delete().eq('user_id', currentUser.id).in('name', removed);
    if (error) throw error;
  }
  if (added.length) {
    const rows = added.map(name => ({ user_id: currentUser.id, name, position: newArr.indexOf(name) }));
    const { error } = await sb.from(table).upsert(rows, { onConflict: 'user_id,name' });
    if (error) throw error;
  }
}

async function syncBudgets(oldObj, newObj) {
  const oldKeys = Object.keys(oldObj);
  const newKeys = Object.keys(newObj);
  const removed = oldKeys.filter(k => !(k in newObj));
  const changed = newKeys.filter(k => oldObj[k] !== newObj[k]);
  if (removed.length) {
    const { error } = await sb.from('budgets').delete().eq('user_id', currentUser.id).in('category', removed);
    if (error) throw error;
  }
  if (changed.length) {
    const rows = changed.map(cat => ({ user_id: currentUser.id, category: cat, limit_amount: newObj[cat] }));
    const { error } = await sb.from('budgets').upsert(rows, { onConflict: 'user_id,category' });
    if (error) throw error;
  }
}

async function syncSettings(oldObj, newObj) {
  const { error } = await sb.from('user_settings').upsert({ user_id: currentUser.id, cdi_rate: newObj.cdiRate, theme: newObj.theme }, { onConflict: 'user_id' });
  if (error) throw error;
}

async function syncCloud(key, oldVal, newVal) {
  if (key === 'tx' || key === 'subs' || key === 'goals') return syncArrayTable(key, oldVal, newVal);
  if (key === 'categories') return syncSimpleList('categories', oldVal, newVal);
  if (key === 'payments') return syncSimpleList('payment_methods', oldVal, newVal);
  if (key === 'budgets') return syncBudgets(oldVal, newVal);
  if (key === 'settings') return syncSettings(oldVal, newVal);
}

async function hydrateFromSupabase() {
  const uidUser = currentUser.id;
  const [txRes, catRes, payRes, budRes, subRes, goalRes, setRes] = await Promise.all([
    sb.from('transactions').select('*').eq('user_id', uidUser).order('date'),
    sb.from('categories').select('*').eq('user_id', uidUser).order('position'),
    sb.from('payment_methods').select('*').eq('user_id', uidUser).order('position'),
    sb.from('budgets').select('*').eq('user_id', uidUser),
    sb.from('subscriptions').select('*').eq('user_id', uidUser),
    sb.from('goals').select('*').eq('user_id', uidUser),
    sb.from('user_settings').select('*').eq('user_id', uidUser).maybeSingle(),
  ]);
  [txRes, catRes, payRes, budRes, subRes, goalRes, setRes].forEach(r => { if (r.error) throw r.error; });

  CACHE.tx = (txRes.data || []).map(rowMappers.tx.fromRow);
  CACHE.categories = (catRes.data || []).map(r => r.name);
  CACHE.payments = (payRes.data || []).map(r => r.name);
  CACHE.budgets = {};
  (budRes.data || []).forEach(r => { CACHE.budgets[r.category] = Number(r.limit_amount); });
  CACHE.subs = (subRes.data || []).map(rowMappers.subs.fromRow);
  CACHE.goals = (goalRes.data || []).map(rowMappers.goals.fromRow);
  CACHE.settings = setRes.data ? { cdiRate: Number(setRes.data.cdi_rate), theme: setRes.data.theme } : Object.assign({}, DEFAULT_SETTINGS);

  // first login: seed defaults
  if (!CACHE.categories.length) {
    CACHE.categories = DEFAULT_CATEGORIES.slice();
    await sb.from('categories').upsert(CACHE.categories.map((name, i) => ({ user_id: uidUser, name, position: i })), { onConflict: 'user_id,name' });
  }
  if (!CACHE.payments.length) {
    CACHE.payments = DEFAULT_PAYMENTS.slice();
    await sb.from('payment_methods').upsert(CACHE.payments.map((name, i) => ({ user_id: uidUser, name, position: i })), { onConflict: 'user_id,name' });
  }
  if (!setRes.data) {
    await sb.from('user_settings').upsert({ user_id: uidUser, cdi_rate: DEFAULT_SETTINGS.cdiRate, theme: DEFAULT_SETTINGS.theme }, { onConflict: 'user_id' });
    CACHE.settings = Object.assign({}, DEFAULT_SETTINGS);
  }
}

async function resetAllData() {
  if (cloudMode) {
    const tables = ['transactions', 'categories', 'payment_methods', 'budgets', 'subscriptions', 'goals', 'user_settings'];
    await Promise.all(tables.map(t => sb.from(t).delete().eq('user_id', currentUser.id)));
    await hydrateFromSupabase();
  } else {
    Object.values(LS).forEach(k => localStorage.removeItem(k));
    hydrateFromLocalStorage();
  }
}

/* ---------- formatters ---------- */
const currencyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtMoney(n) { return currencyFmt.format(n || 0); }
function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function fmtDateFull(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function monthKey(iso) { return iso.slice(0, 7); } // YYYY-MM
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function shiftMonthKey(key, delta) {
  let [y, m] = key.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return y + '-' + String(m).padStart(2, '0');
}
// For native <input type="number"> values, which are always period-decimal.
function parseNum(str) {
  if (typeof str === 'number') return str;
  if (str === '' || str == null) return 0;
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

// For free-text CSV fields, which may be pt-BR formatted ("1.500,50" or "150,50").
function parseLocaleNum(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  let s = String(str).trim();
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/* ---------- global state ---------- */
const state = {
  tab: 'dashboard',
  dashMonth: monthKey(todayISO()),
  txMonth: monthKey(todayISO()),
  txFilterCategory: '',
  txFilterPayment: '',
  txFilterType: '',
  txSearch: '',
  editingTxId: null,
};

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- theme ---------- */
function applyTheme() {
  const s = getSettings();
  if (s.theme === 'light' || s.theme === 'dark') {
    document.documentElement.setAttribute('data-theme', s.theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/* ===================== rendering root ===================== */
function render() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
  positionTabIndicator();
  const c = document.getElementById('content');
  c.innerHTML = '';
  const renderers = {
    dashboard: renderDashboard,
    transacoes: renderTransacoes,
    orcamentos: renderOrcamentos,
    assinaturas: renderAssinaturas,
    metas: renderMetas,
    cdi: renderCDI,
    config: renderConfig,
  };
  (renderers[state.tab] || renderDashboard)(c);
}

function positionTabIndicator() {
  const nav = document.getElementById('tabs');
  const indicator = document.getElementById('tab-indicator');
  const active = nav && nav.querySelector('.tab.active');
  if (!nav || !indicator || !active) return;
  indicator.style.width = active.offsetWidth + 'px';
  indicator.style.transform = `translateX(${active.offsetLeft - 5}px)`;
}
window.addEventListener('resize', () => requestAnimationFrame(positionTabIndicator));

/* ===================== charts ===================== */
// Single-series ranked bar chart (magnitude comparison) — one hue, direct labels, no legend needed.
function barChart(rows, opts) {
  opts = opts || {};
  const max = Math.max(1, ...rows.map(r => r.value));
  const wrap = document.createElement('div');
  wrap.className = 'bar-chart';
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state">Sem dados neste período.</div>';
    return wrap;
  }
  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const pct = Math.max(2, (r.value / max) * 100);
    row.innerHTML = `
      <div class="bar-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${opts.color || 'var(--series-1)'}"></div></div>
      <div class="bar-value">${fmtMoney(r.value)}</div>`;
    wrap.appendChild(row);
  });
  return wrap;
}

// Fixed 8-slot categorical order (see dataviz palette) — never cycled.
// Beyond 7 real categories, the rest fold into a neutral "Outros" slice
// so no two slices ever share a hue.
const DONUT_SLOTS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)'];
const DONUT_OTHER_COLOR = 'var(--muted)';

// Donut chart showing each category's share of the total — updates live
// off whatever renderDashboard passes in, so it grows the instant a new
// expense is added.
function donutChart(rows, opts) {
  opts = opts || {};
  const wrap = document.createElement('div');
  wrap.className = 'donut-wrap';
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (!rows.length || total <= 0) {
    wrap.innerHTML = '<div class="empty-state">Sem dados neste período.</div>';
    return wrap;
  }

  const sorted = rows.slice().sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 7);
  const restTotal = sorted.slice(7).reduce((a, r) => a + r.value, 0);
  const slices = top.map((r, i) => ({ label: r.label, value: r.value, color: DONUT_SLOTS[i] }));
  if (restTotal > 0) slices.push({ label: 'Outros', value: restTotal, color: DONUT_OTHER_COLOR });

  const size = 200, strokeWidth = 30, r = (size - strokeWidth) / 2, cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const gap = 3; // px arc-length spacer between slices
  let acc = 0;
  const arcs = slices.map(s => {
    const frac = s.value / total;
    const raw = frac * circumference;
    const dash = Math.max(0, raw - (slices.length > 1 ? gap : 0));
    const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${strokeWidth}"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${(-acc).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})" />`;
    acc += raw;
    return circle;
  }).join('');

  const svgBox = document.createElement('div');
  svgBox.className = 'donut-svg-box';
  svgBox.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${opts.label || 'Distribuição por categoria'}">${arcs}</svg>
    <div class="donut-center">
      <div class="stat-label">Total</div>
      <div class="stat-value">${fmtMoney(total)}</div>
    </div>`;

  const legend = document.createElement('div');
  legend.className = 'donut-legend';
  slices.forEach(s => {
    const pct = (s.value / total) * 100;
    const row = document.createElement('div');
    row.className = 'donut-legend-row';
    row.innerHTML = `
      <span class="donut-dot" style="background:${s.color}"></span>
      <span class="donut-legend-label" title="${escapeHtml(s.label)}">${escapeHtml(s.label)}</span>
      <span class="donut-legend-pct">${pct.toFixed(0)}%</span>
      <span class="donut-legend-value">${fmtMoney(s.value)}</span>`;
    legend.appendChild(row);
  });

  wrap.appendChild(svgBox);
  wrap.appendChild(legend);
  return wrap;
}

// Simple SVG line/area chart for CDI projection — single series.
function lineChart(points, opts) {
  opts = opts || {};
  const width = opts.width || 640, height = opts.height || 220;
  const padL = 56, padB = 24, padT = 14, padR = 14;
  const w = width - padL - padR, h = height - padT - padB;
  const maxY = Math.max(1, ...points.map(p => p.y));
  const minY = 0;
  const n = points.length;
  const x = i => padL + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = v => padT + h - ((v - minY) / (maxY - minY || 1)) * h;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ');
  const areaPath = linePath + ` L ${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;

  const gridLines = 4;
  let gridSvg = '';
  for (let i = 0; i <= gridLines; i++) {
    const gy = padT + (h / gridLines) * i;
    const val = maxY - (maxY / gridLines) * i;
    gridSvg += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${width - padR}" y2="${gy.toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>`;
    gridSvg += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${compactMoney(val)}</text>`;
  }

  const seriesColor = opts.color || 'var(--series-1)';
  const wrap = document.createElement('div');
  wrap.className = 'line-chart-wrap';
  wrap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${opts.label || 'Evolução'}">
      ${gridSvg}
      <path d="${areaPath}" fill="${seriesColor}" opacity="0.12" stroke="none"/>
      <path d="${linePath}" fill="none" stroke="${seriesColor}" stroke-width="2"/>
      <line x1="${padL}" y1="${(padT + h).toFixed(1)}" x2="${width - padR}" y2="${(padT + h).toFixed(1)}" stroke="var(--baseline)" stroke-width="1"/>
    </svg>`;
  return wrap;
}
function compactMoney(v) {
  if (Math.abs(v) >= 1000) return 'R$ ' + (v / 1000).toFixed(1).replace('.0', '') + 'k';
  return 'R$ ' + Math.round(v);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ===================== DASHBOARD ===================== */
function renderDashboard(c) {
  const all = getTx();
  const monthTx = all.filter(t => monthKey(t.date) === state.dashMonth);
  const prevKey = shiftMonthKey(state.dashMonth, -1);
  const prevTx = all.filter(t => monthKey(t.date) === prevKey);

  const income = sum(monthTx.filter(t => t.type === 'income'));
  const expense = sum(monthTx.filter(t => t.type === 'expense'));
  const balance = income - expense;
  const prevExpense = sum(prevTx.filter(t => t.type === 'expense'));
  const deltaPct = prevExpense > 0 ? ((expense - prevExpense) / prevExpense) * 100 : null;

  const byCategory = groupSum(monthTx.filter(t => t.type === 'expense'), 'category');
  const byPayment = groupSum(monthTx.filter(t => t.type === 'expense'), 'payment');

  const budgets = getBudgets();
  const budgetRows = Object.keys(budgets).filter(cat => budgets[cat] > 0).map(cat => {
    const spent = byCategory[cat] || 0;
    const limit = budgets[cat];
    return { cat, spent, limit, pct: limit ? (spent / limit) * 100 : 0 };
  }).sort((a, b) => b.pct - a.pct);

  const recent = all.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5);

  const sec = (title, node, sub) => {
    const s = document.createElement('div');
    s.className = 'section';
    s.innerHTML = `<div class="section-title">${title}</div>${sub ? `<div class="section-sub">${sub}</div>` : ''}`;
    s.appendChild(node);
    return s;
  };

  // month switcher
  const switcher = document.createElement('div');
  switcher.className = 'row-between section';
  switcher.innerHTML = `
    <div class="month-switch">
      <button id="dash-prev">‹</button>
      <span>${monthLabel(state.dashMonth)}</span>
      <button id="dash-next">›</button>
    </div>`;
  c.appendChild(switcher);

  // stat cards
  const cards = document.createElement('div');
  cards.className = 'grid grid-cards section';
  cards.innerHTML = `
    <div class="card stat-tile"><div class="stat-label">Receitas</div><div class="stat-value pos">${fmtMoney(income)}</div></div>
    <div class="card stat-tile"><div class="stat-label">Despesas</div><div class="stat-value">${fmtMoney(expense)}</div>
      ${deltaPct !== null ? `<div class="stat-delta ${deltaPct > 0 ? 'up' : 'down'}">${deltaPct > 0 ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(1)}% vs mês anterior</div>` : '<div class="stat-delta">Sem dados do mês anterior</div>'}
    </div>
    <div class="card stat-tile"><div class="stat-label">Saldo do mês</div><div class="stat-value ${balance >= 0 ? 'pos' : 'neg'}">${fmtMoney(balance)}</div></div>`;
  c.appendChild(cards);

  // category share (donut) — recalculated from live data on every render
  const catRows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  c.appendChild(sec('Gastos por categoria', donutChart(catRows)));

  // payment chart
  const payRows = Object.entries(byPayment).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  c.appendChild(sec('Gastos por forma de pagamento', barChart(payRows, { color: 'var(--series-2)' })));

  // budget alerts
  if (budgetRows.length) {
    const box = document.createElement('div');
    box.className = 'card';
    budgetRows.forEach(r => {
      const status = r.pct >= 100 ? 'critical' : r.pct >= 80 ? 'warning' : 'good';
      const row = document.createElement('div');
      row.style.marginBottom = '14px';
      row.innerHTML = `
        <div class="progress-row"><strong style="color:var(--text-primary)">${escapeHtml(r.cat)}</strong><span>${fmtMoney(r.spent)} / ${fmtMoney(r.limit)}</span></div>
        <div class="progress-track"><div class="progress-fill ${status}" style="width:${Math.min(100, r.pct)}%"></div></div>`;
      box.appendChild(row);
    });
    c.appendChild(sec('Orçamentos do mês', box));
  }

  // recent transactions
  const recentList = document.createElement('div');
  recentList.className = 'tx-list';
  if (!recent.length) recentList.innerHTML = '<div class="empty-state">Nenhum lançamento ainda. Clique em "+ Novo lançamento" para começar.</div>';
  recent.forEach(t => recentList.appendChild(txRowEl(t, { readonly: true })));
  const recentSection = sec('Últimos lançamentos', recentList);
  c.appendChild(recentSection);

  document.getElementById('dash-prev').onclick = () => { state.dashMonth = shiftMonthKey(state.dashMonth, -1); render(); };
  document.getElementById('dash-next').onclick = () => { state.dashMonth = shiftMonthKey(state.dashMonth, 1); render(); };
}

function sum(arr) { return arr.reduce((a, t) => a + t.amount, 0); }
function groupSum(arr, key) {
  const out = {};
  arr.forEach(t => { out[t[key]] = (out[t[key]] || 0) + t.amount; });
  return out;
}

/* ===================== TRANSACOES ===================== */
function txRowEl(t, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'tx-row';
  el.innerHTML = `
    <div class="tx-date">${fmtDateShort(t.date)}</div>
    <div class="tx-main">
      <div class="tx-desc">${escapeHtml(t.description || '(sem descrição)')}</div>
      <div class="tx-meta"><span class="badge">${escapeHtml(t.category)}</span> · ${escapeHtml(t.payment)}</div>
    </div>
    <div class="tx-amount ${t.type === 'income' ? 'income' : ''}">${t.type === 'income' ? '+' : '-'} ${fmtMoney(t.amount)}</div>
    ${opts.readonly ? '' : `<div class="tx-actions">
      <button class="icon-btn btn-sm" data-edit="${t.id}" title="Editar">✎</button>
      <button class="icon-btn btn-sm btn-danger" data-del="${t.id}" title="Excluir">✕</button>
    </div>`}`;
  return el;
}

function renderTransacoes(c) {
  const all = getTx();
  const cats = getCategories();
  const pays = getPayments();

  const toolbar = document.createElement('div');
  toolbar.className = 'section';
  toolbar.innerHTML = `
    <div class="row-between" style="margin-bottom:12px">
      <div class="month-switch">
        <button id="tx-prev">‹</button>
        <span>${monthLabel(state.txMonth)}</span>
        <button id="tx-next">›</button>
      </div>
      <div class="row">
        <button class="btn btn-sm" id="btn-export-csv">Exportar CSV</button>
        <label class="btn btn-sm" style="cursor:pointer">Importar CSV<input type="file" id="import-csv" accept=".csv,text/csv" style="display:none"></label>
      </div>
    </div>
    <div class="row">
      <select class="input" id="f-type" style="max-width:165px">
        <option value="">Todos os tipos</option>
        <option value="expense">Gastos</option>
        <option value="income">Receitas</option>
      </select>
      <select class="input" id="f-cat" style="max-width:180px">
        <option value="">Todas categorias</option>
        ${cats.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('')}
      </select>
      <select class="input" id="f-pay" style="max-width:180px">
        <option value="">Todas formas</option>
        ${pays.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}
      </select>
      <input class="input" id="f-search" placeholder="Buscar descrição..." style="max-width:200px">
    </div>`;
  c.appendChild(toolbar);

  document.getElementById('tx-prev').onclick = () => { state.txMonth = shiftMonthKey(state.txMonth, -1); render(); };
  document.getElementById('tx-next').onclick = () => { state.txMonth = shiftMonthKey(state.txMonth, 1); render(); };

  let filtered = all.filter(t => monthKey(t.date) === state.txMonth);
  if (state.txFilterType) filtered = filtered.filter(t => t.type === state.txFilterType);
  if (state.txFilterCategory) filtered = filtered.filter(t => t.category === state.txFilterCategory);
  if (state.txFilterPayment) filtered = filtered.filter(t => t.payment === state.txFilterPayment);
  if (state.txSearch) filtered = filtered.filter(t => (t.description || '').toLowerCase().includes(state.txSearch.toLowerCase()));
  filtered.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  const list = document.createElement('div');
  list.className = 'tx-list section';
  if (!filtered.length) list.innerHTML = '<div class="empty-state">Nenhum lançamento encontrado para este filtro.</div>';
  filtered.forEach(t => list.appendChild(txRowEl(t)));
  c.appendChild(list);

  document.getElementById('f-type').value = state.txFilterType;
  document.getElementById('f-cat').value = state.txFilterCategory;
  document.getElementById('f-pay').value = state.txFilterPayment;
  document.getElementById('f-search').value = state.txSearch;
  document.getElementById('f-type').onchange = e => { state.txFilterType = e.target.value; render(); };
  document.getElementById('f-cat').onchange = e => { state.txFilterCategory = e.target.value; render(); };
  document.getElementById('f-pay').onchange = e => { state.txFilterPayment = e.target.value; render(); };
  document.getElementById('f-search').oninput = e => { state.txSearch = e.target.value; render(); };

  list.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openTxModal(btn.dataset.edit));
  list.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => {
    if (!confirm('Excluir este lançamento?')) return;
    saveAndToast(setTx(getTx().filter(t => t.id !== btn.dataset.del)), 'Lançamento excluído.');
  });

  document.getElementById('btn-export-csv').onclick = exportCSV;
  document.getElementById('import-csv').onchange = e => {
    const file = e.target.files[0];
    if (file) importCSV(file);
    e.target.value = '';
  };
}

/* ---------- CSV export / import (Data;Valor;Categoria;Forma de Pagamento;Descrição;Tipo) ---------- */
function exportCSV() {
  const rows = getTx().slice().sort((a, b) => a.date.localeCompare(b.date));
  const lines = ['Data;Valor;Categoria;Forma de Pagamento;Descricao;Tipo'];
  rows.forEach(t => {
    lines.push([
      t.date,
      String(t.amount).replace('.', ','),
      t.category,
      t.payment,
      (t.description || '').replace(/;/g, ','),
      t.type === 'income' ? 'Receita' : 'Gasto'
    ].join(';'));
  });
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Gastos_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV exportado.');
}

function importCSV(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const text = String(reader.result).replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const cats = getCategories(); const pays = getPayments();
    let added = 0;
    const tx = getTx();
    lines.forEach(line => {
      const parts = line.split(';');
      if (parts.length < 3) return;
      const [dateRaw, valorRaw, categoria, formaPagamento, descricao, tipoRaw] = parts;
      let date = dateRaw.trim();
      // accept DD/MM/YYYY or YYYY-MM-DD; skip header rows
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
        const [d, m, y] = date.split('/');
        date = `${y}-${m}-${d}`;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return; // not a data row (likely header)
      const amount = Math.abs(parseLocaleNum(valorRaw));
      if (!amount) return;
      const category = (categoria || 'Outros').trim() || 'Outros';
      const payment = (formaPagamento || 'Outros').trim() || 'Outros';
      const type = /receita/i.test(tipoRaw || '') ? 'income' : 'expense';
      if (!cats.includes(category)) cats.push(category);
      if (!pays.includes(payment)) pays.push(payment);
      tx.push({ id: uid(), date, amount, category, payment, description: (descricao || '').trim(), type, createdAt: Date.now() });
      added++;
    });
    await saveAndToast(Promise.all([setTx(tx), setCategories(cats), setPayments(pays)]), `${added} lançamento(s) importado(s).`);
  };
  reader.readAsText(file, 'utf-8');
}

/* ---------- add/edit transaction modal ---------- */
function openTxModal(editId) {
  state.editingTxId = editId || null;
  const existing = editId ? getTx().find(t => t.id === editId) : null;
  const cats = getCategories();
  const pays = getPayments();
  const type = existing ? existing.type : 'expense';

  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>${existing ? 'Editar lançamento' : 'Novo lançamento'}</h3>
    <div class="field">
      <label>Tipo</label>
      <div class="segmented" id="m-type">
        <button type="button" data-v="expense" class="${type === 'expense' ? 'active' : ''}">Gasto</button>
        <button type="button" data-v="income" class="${type === 'income' ? 'active' : ''}">Receita</button>
      </div>
    </div>
    <div class="field">
      <label>Quanto foi?</label>
      <input class="input" id="m-amount" type="number" step="0.01" min="0" placeholder="0,00" value="${existing ? existing.amount : ''}">
    </div>
    <div class="field-row">
      <div class="field">
        <label>Categoria</label>
        <select class="input" id="m-category">${cats.map(cat => `<option ${existing && existing.category === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Forma de pagamento</label>
        <select class="input" id="m-payment">${pays.map(p => `<option ${existing && existing.payment === p ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="field">
      <label>O que foi esse gasto?</label>
      <input class="input" id="m-desc" type="text" placeholder="Descrição" value="${existing ? escapeHtml(existing.description || '') : ''}">
    </div>
    <div class="field">
      <label>Data</label>
      <input class="input" id="m-date" type="date" value="${existing ? existing.date : todayISO()}">
    </div>
    <div class="modal-actions">
      <button class="btn" id="m-cancel">Cancelar</button>
      <button class="btn btn-primary" id="m-save">Salvar</button>
    </div>`;

  let curType = type;
  modal.querySelectorAll('#m-type button').forEach(btn => btn.onclick = () => {
    curType = btn.dataset.v;
    modal.querySelectorAll('#m-type button').forEach(b => b.classList.toggle('active', b === btn));
  });

  openModal();
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = (e) => {
    const amount = parseNum(document.getElementById('m-amount').value);
    if (!amount || amount <= 0) { toast('Informe um valor válido.'); return; }
    const category = document.getElementById('m-category').value;
    const payment = document.getElementById('m-payment').value;
    const description = document.getElementById('m-desc').value.trim();
    const date = document.getElementById('m-date').value || todayISO();

    const tx = getTx();
    if (existing) {
      const idx = tx.findIndex(t => t.id === existing.id);
      tx[idx] = Object.assign({}, existing, { amount, category, payment, description, date, type: curType });
    } else {
      tx.push({ id: uid(), amount, category, payment, description, date, type: curType, createdAt: Date.now() });
    }
    saveViaModal(setTx(tx), e.target, 'Lançamento salvo.');
  };
}

function openModal() { document.getElementById('modal-backdrop').classList.add('open'); }
function closeModal() { document.getElementById('modal-backdrop').classList.remove('open'); }

/* ===================== ORCAMENTOS ===================== */
function renderOrcamentos(c) {
  const cats = getCategories();
  const budgets = getBudgets();
  const monthTx = getTx().filter(t => monthKey(t.date) === state.dashMonth && t.type === 'expense');
  const byCategory = groupSum(monthTx, 'category');

  const intro = document.createElement('div');
  intro.className = 'section';
  intro.innerHTML = `<div class="section-title">Orçamentos mensais</div><div class="section-sub">Defina um limite de gasto por categoria e acompanhe o progresso em ${monthLabel(state.dashMonth)}.</div>`;
  c.appendChild(intro);

  const box = document.createElement('div');
  box.className = 'card section';
  cats.forEach(cat => {
    const limit = budgets[cat] || 0;
    const spent = byCategory[cat] || 0;
    const pct = limit ? (spent / limit) * 100 : 0;
    const status = pct >= 100 ? 'critical' : pct >= 80 ? 'warning' : 'good';
    const row = document.createElement('div');
    row.style.marginBottom = '16px';
    row.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(cat)}</strong>
        <div class="row">
          <span class="hint">${fmtMoney(spent)} gasto</span>
          <input class="input" type="number" min="0" step="10" style="max-width:120px" data-budget="${escapeHtml(cat)}" placeholder="Limite" value="${limit || ''}">
        </div>
      </div>
      ${limit ? `<div class="progress-track" style="margin-top:8px"><div class="progress-fill ${status}" style="width:${Math.min(100, pct)}%"></div></div>
      <div class="progress-row"><span>${pct.toFixed(0)}% usado</span><span>${fmtMoney(Math.max(0, limit - spent))} restante</span></div>` : ''}
    `;
    box.appendChild(row);
  });
  c.appendChild(box);

  box.querySelectorAll('[data-budget]').forEach(inp => {
    inp.onchange = () => {
      const b = getBudgets();
      const v = parseNum(inp.value);
      if (v > 0) b[inp.dataset.budget] = v; else delete b[inp.dataset.budget];
      saveAndToast(setBudgets(b), 'Orçamento atualizado.');
    };
  });
}

/* ===================== ASSINATURAS ===================== */
function renderAssinaturas(c) {
  const subs = getSubs();
  const curMonth = monthKey(todayISO());

  const header = document.createElement('div');
  header.className = 'row-between section';
  header.innerHTML = `<div><div class="section-title" style="margin-bottom:2px">Assinaturas e gastos recorrentes</div><div class="section-sub" style="margin:0">Cadastre uma vez e lance com um clique todo mês.</div></div>
    <button class="btn btn-primary btn-sm" id="btn-add-sub">+ Nova assinatura</button>`;
  c.appendChild(header);

  const totalMonthly = sum(subs.filter(s => s.active !== false));
  const totalCard = document.createElement('div');
  totalCard.className = 'card section';
  totalCard.innerHTML = `<div class="stat-tile"><div class="stat-label">Total recorrente mensal</div><div class="stat-value">${fmtMoney(totalMonthly)}</div></div>`;
  c.appendChild(totalCard);

  const list = document.createElement('div');
  list.className = 'tx-list section';
  if (!subs.length) list.innerHTML = '<div class="empty-state">Nenhuma assinatura cadastrada.</div>';
  subs.forEach(s => {
    const launched = s.lastLaunchedMonth === curMonth;
    const row = document.createElement('div');
    row.className = 'tx-row';
    row.innerHTML = `
      <div class="tx-date">Dia ${s.day}</div>
      <div class="tx-main">
        <div class="tx-desc">${escapeHtml(s.name)}</div>
        <div class="tx-meta"><span class="badge">${escapeHtml(s.category)}</span> · ${escapeHtml(s.payment)}</div>
      </div>
      <div class="tx-amount">${fmtMoney(s.amount)}</div>
      <div class="tx-actions">
        <button class="btn btn-sm ${launched ? '' : 'btn-primary'}" data-launch="${s.id}" ${launched ? 'disabled' : ''}>${launched ? 'Lançado ✓' : 'Lançar'}</button>
        <button class="icon-btn btn-sm btn-danger" data-del="${s.id}" title="Excluir">✕</button>
      </div>`;
    list.appendChild(row);
  });
  c.appendChild(list);

  list.querySelectorAll('[data-launch]').forEach(btn => btn.onclick = () => {
    const s = subs.find(x => x.id === btn.dataset.launch);
    const tx = getTx();
    tx.push({ id: uid(), amount: s.amount, category: s.category, payment: s.payment, description: s.name, date: todayISO(), type: 'expense', createdAt: Date.now() });
    // Replace the object rather than mutating it in place — subs came from
    // getSubs(), and mutating a shared element would make the cloud sync's
    // old/new diff see no change (see the getters' comment above).
    const updatedSubs = subs.map(x => x.id === s.id ? Object.assign({}, x, { lastLaunchedMonth: curMonth }) : x);
    saveAndToast(Promise.all([setTx(tx), setSubs(updatedSubs)]), `"${s.name}" lançado neste mês.`);
  });
  list.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => {
    if (!confirm('Excluir esta assinatura?')) return;
    saveAndToast(setSubs(subs.filter(x => x.id !== btn.dataset.del)));
  });

  document.getElementById('btn-add-sub').onclick = () => openSubModal();
}

function openSubModal() {
  const cats = getCategories(); const pays = getPayments();
  const modal = document.getElementById('modal');
  modal.innerHTML = `
    <h3>Nova assinatura</h3>
    <div class="field"><label>Nome</label><input class="input" id="s-name" placeholder="Ex: Netflix"></div>
    <div class="field-row">
      <div class="field"><label>Valor</label><input class="input" id="s-amount" type="number" step="0.01" min="0"></div>
      <div class="field"><label>Dia de cobrança</label><input class="input" id="s-day" type="number" min="1" max="31" value="1"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Categoria</label><select class="input" id="s-category">${cats.map(cat => `<option ${cat === 'Assinaturas' ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}</select></div>
      <div class="field"><label>Forma de pagamento</label><select class="input" id="s-payment">${pays.map(p => `<option>${escapeHtml(p)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="m-cancel">Cancelar</button>
      <button class="btn btn-primary" id="m-save">Salvar</button>
    </div>`;
  openModal();
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = (e) => {
    const name = document.getElementById('s-name').value.trim();
    const amount = parseNum(document.getElementById('s-amount').value);
    if (!name || !amount) { toast('Preencha nome e valor.'); return; }
    const subs = getSubs();
    subs.push({
      id: uid(), name, amount,
      day: parseInt(document.getElementById('s-day').value, 10) || 1,
      category: document.getElementById('s-category').value,
      payment: document.getElementById('s-payment').value,
      active: true, lastLaunchedMonth: null,
    });
    saveViaModal(setSubs(subs), e.target, 'Assinatura cadastrada.');
  };
}

/* ===================== METAS ===================== */
function renderMetas(c) {
  const goals = getGoals();
  const header = document.createElement('div');
  header.className = 'row-between section';
  header.innerHTML = `<div><div class="section-title" style="margin-bottom:2px">Metas de economia</div><div class="section-sub" style="margin:0">Reserva de emergência, viagem, o que você quiser.</div></div>
    <button class="btn btn-primary btn-sm" id="btn-add-goal">+ Nova meta</button>`;
  c.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'grid grid-2 section';
  if (!goals.length) grid.innerHTML = '<div class="empty-state">Nenhuma meta cadastrada.</div>';
  goals.forEach(g => {
    const pct = g.target ? Math.min(100, (g.current / g.target) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="row-between"><strong>${escapeHtml(g.name)}</strong>
        <button class="icon-btn btn-sm btn-danger" data-del="${g.id}" title="Excluir">✕</button></div>
      <div class="progress-track" style="margin-top:10px"><div class="progress-fill good" style="width:${pct}%"></div></div>
      <div class="progress-row"><span>${fmtMoney(g.current)} de ${fmtMoney(g.target)}</span><span>${pct.toFixed(0)}%</span></div>
      <div class="row" style="margin-top:12px">
        <input class="input" type="number" min="0" step="10" placeholder="Adicionar valor" data-contrib="${g.id}" style="max-width:160px">
        <button class="btn btn-sm" data-add="${g.id}">Contribuir</button>
      </div>`;
    grid.appendChild(card);
  });
  c.appendChild(grid);

  grid.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => {
    if (!confirm('Excluir esta meta?')) return;
    saveAndToast(setGoals(getGoals().filter(g => g.id !== btn.dataset.del)));
  });
  grid.querySelectorAll('[data-add]').forEach(btn => btn.onclick = () => {
    const input = grid.querySelector(`[data-contrib="${btn.dataset.add}"]`);
    const v = parseNum(input.value);
    if (!v) return;
    const goals = getGoals();
    const g = goals.find(x => x.id === btn.dataset.add);
    const updatedGoals = goals.map(x => x.id === g.id ? Object.assign({}, x, { current: x.current + v }) : x);
    saveAndToast(setGoals(updatedGoals), 'Contribuição adicionada.');
  });

  document.getElementById('btn-add-goal').onclick = () => {
    const modal = document.getElementById('modal');
    modal.innerHTML = `
      <h3>Nova meta</h3>
      <div class="field"><label>Nome</label><input class="input" id="g-name" placeholder="Ex: Reserva de emergência"></div>
      <div class="field-row">
        <div class="field"><label>Valor alvo</label><input class="input" id="g-target" type="number" min="0" step="10"></div>
        <div class="field"><label>Já tenho</label><input class="input" id="g-current" type="number" min="0" step="10" value="0"></div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary" id="m-save">Salvar</button>
      </div>`;
    openModal();
    document.getElementById('m-cancel').onclick = closeModal;
    document.getElementById('m-save').onclick = (e) => {
      const name = document.getElementById('g-name').value.trim();
      const target = parseNum(document.getElementById('g-target').value);
      if (!name || !target) { toast('Preencha nome e valor alvo.'); return; }
      const goals = getGoals();
      goals.push({ id: uid(), name, target, current: parseNum(document.getElementById('g-current').value) });
      saveViaModal(setGoals(goals), e.target, 'Meta criada.');
    };
  };
}

/* ===================== CDI CALCULATOR ===================== */
function renderCDI(c) {
  const settings = getSettings();

  c.innerHTML = `
    <div class="section">
      <div class="section-title">Quanto seu saldo está rendendo</div>
      <div class="section-sub">Estimativa de rendimento passivo de um valor investido a % do CDI.</div>
      <div class="card">
        <div class="field-row">
          <div class="field"><label>Saldo atual</label><input class="input" id="p-saldo" type="number" min="0" step="10" value="10000"></div>
          <div class="field"><label>% do CDI</label><input class="input" id="p-pct" type="number" min="0" step="1" value="100"></div>
          <div class="field"><label>Taxa CDI anual (%)</label><input class="input" id="p-cdi" type="number" min="0" step="0.01" value="${settings.cdiRate}"></div>
        </div>
        <div id="p-out" class="grid grid-cards"></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Simulador de investimento</div>
      <div class="section-sub">Projete a evolução do seu dinheiro rendendo ao CDI, com ou sem aportes mensais.</div>
      <div class="card">
        <div class="field-row">
          <div class="field"><label>Valor inicial</label><input class="input" id="s-inicial" type="number" min="0" step="10" value="5000"></div>
          <div class="field"><label>Aporte mensal</label><input class="input" id="s-aporte" type="number" min="0" step="10" value="500"></div>
          <div class="field"><label>Período (meses)</label><input class="input" id="s-meses" type="number" min="1" step="1" value="24"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>% do CDI</label><input class="input" id="s-pct" type="number" min="0" step="1" value="100"></div>
          <div class="field"><label>Taxa CDI anual (%)</label><input class="input" id="s-cdi" type="number" min="0" step="0.01" value="${settings.cdiRate}"></div>
          <div class="field"><label>&nbsp;</label><label class="row" style="margin-top:8px"><input type="checkbox" id="s-ir" style="width:auto"> Estimar IR na retirada</label></div>
        </div>
        <div id="s-out" class="grid grid-cards" style="margin-bottom:16px"></div>
        <div id="s-chart"></div>
      </div>
    </div>`;

  const passiveInputs = ['p-saldo', 'p-pct', 'p-cdi'];
  const calcPassive = () => {
    const saldo = parseNum(document.getElementById('p-saldo').value);
    const pct = parseNum(document.getElementById('p-pct').value) / 100;
    const cdi = parseNum(document.getElementById('p-cdi').value) / 100;
    const annualRate = cdi * pct;
    const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
    const dailyRate = Math.pow(1 + annualRate, 1 / 252) - 1;
    document.getElementById('p-out').innerHTML = `
      <div class="card stat-tile"><div class="stat-label">Por dia útil</div><div class="stat-value pos">${fmtMoney(saldo * dailyRate)}</div></div>
      <div class="card stat-tile"><div class="stat-label">Por mês</div><div class="stat-value pos">${fmtMoney(saldo * monthlyRate)}</div></div>
      <div class="card stat-tile"><div class="stat-label">Por ano</div><div class="stat-value pos">${fmtMoney(saldo * annualRate)}</div></div>`;
  };
  passiveInputs.forEach(id => document.getElementById(id).oninput = calcPassive);
  calcPassive();

  const simInputs = ['s-inicial', 's-aporte', 's-meses', 's-pct', 's-cdi', 's-ir'];
  const calcSim = () => {
    const inicial = parseNum(document.getElementById('s-inicial').value);
    const aporte = parseNum(document.getElementById('s-aporte').value);
    const meses = Math.max(1, parseInt(document.getElementById('s-meses').value, 10) || 1);
    const pct = parseNum(document.getElementById('s-pct').value) / 100;
    const cdi = parseNum(document.getElementById('s-cdi').value) / 100;
    const withIR = document.getElementById('s-ir').checked;
    const annualRate = cdi * pct;
    const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;

    let balance = inicial;
    let invested = inicial;
    const points = [{ y: balance }];
    for (let m = 1; m <= meses; m++) {
      balance += balance * monthlyRate;
      balance += aporte;
      invested += aporte;
      points.push({ y: balance });
    }
    const grossProfit = balance - invested;
    let ir = 0;
    if (withIR) {
      const days = meses * 30;
      const rate = days <= 180 ? 0.225 : days <= 360 ? 0.20 : days <= 720 ? 0.175 : 0.15;
      ir = grossProfit * rate;
    }
    const net = balance - ir;

    document.getElementById('s-out').innerHTML = `
      <div class="card stat-tile"><div class="stat-label">Total investido</div><div class="stat-value">${fmtMoney(invested)}</div></div>
      <div class="card stat-tile"><div class="stat-label">Rendimento bruto</div><div class="stat-value pos">${fmtMoney(grossProfit)}</div></div>
      ${withIR ? `<div class="card stat-tile"><div class="stat-label">IR estimado</div><div class="stat-value">${fmtMoney(ir)}</div></div>` : ''}
      <div class="card stat-tile"><div class="stat-label">Valor final ${withIR ? 'líquido' : ''}</div><div class="stat-value pos">${fmtMoney(withIR ? net : balance)}</div></div>`;

    const chartHost = document.getElementById('s-chart');
    chartHost.innerHTML = '';
    chartHost.appendChild(lineChart(points, { label: 'Evolução do investimento' }));
  };
  simInputs.forEach(id => document.getElementById(id).addEventListener('input', calcSim));
  calcSim();
}

/* ===================== CONFIG ===================== */
function renderConfig(c) {
  const cats = getCategories();
  const pays = getPayments();
  const settings = getSettings();

  const editableList = (items, kind) => {
    const box = document.createElement('div');
    box.className = 'editable-list';
    items.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'editable-item';
      row.innerHTML = `<button class="remove-dot" data-kind="${kind}" data-idx="${idx}">−</button><span>${escapeHtml(item)}</span>`;
      box.appendChild(row);
    });
    const addRow = document.createElement('div');
    addRow.className = 'add-item-row';
    addRow.innerHTML = `<button class="add-dot" data-add="${kind}">+</button><input class="input" id="new-${kind}" placeholder="Adicionar item">`;
    box.appendChild(addRow);
    return box;
  };

  const secCats = document.createElement('div');
  secCats.className = 'section';
  secCats.innerHTML = `<div class="section-title">Categorias</div>`;
  secCats.appendChild(editableList(cats, 'cat'));
  c.appendChild(secCats);

  const secPays = document.createElement('div');
  secPays.className = 'section';
  secPays.innerHTML = `<div class="section-title">Formas de pagamento</div>`;
  secPays.appendChild(editableList(pays, 'pay'));
  c.appendChild(secPays);

  const secPrefs = document.createElement('div');
  secPrefs.className = 'section';
  secPrefs.innerHTML = `
    <div class="section-title">Preferências</div>
    <div class="card">
      <div class="field-row">
        <div class="field"><label>Taxa CDI anual padrão (%)</label><input class="input" id="cfg-cdi" type="number" step="0.01" value="${settings.cdiRate}"></div>
        <div class="field"><label>Tema</label>
          <select class="input" id="cfg-theme">
            <option value="system" ${settings.theme === 'system' ? 'selected' : ''}>Automático (sistema)</option>
            <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Claro</option>
            <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Escuro</option>
          </select>
        </div>
      </div>
    </div>`;
  c.appendChild(secPrefs);

  const secSync = document.createElement('div');
  secSync.className = 'section';
  secSync.innerHTML = `
    <div class="section-title">Sincronização</div>
    <div class="card">
      ${cloudMode
        ? `<div class="row-between"><span>☁️ Conectado ao Supabase</span><span class="hint">${escapeHtml(currentUser ? currentUser.email : '')}</span></div>`
        : `<div>💾 Modo local — dados salvos só neste navegador.</div><div class="hint" style="margin-top:6px">Para sincronizar entre dispositivos, configure o Supabase em <code>config.js</code> (veja o README).</div>`}
    </div>`;
  c.appendChild(secSync);

  const secData = document.createElement('div');
  secData.className = 'section';
  secData.innerHTML = `
    <div class="section-title">Dados</div>
    <div class="card row">
      <button class="btn btn-sm" id="cfg-export-backup">Exportar backup (JSON)</button>
      <label class="btn btn-sm" style="cursor:pointer">Importar backup<input type="file" id="cfg-import-backup" accept="application/json" style="display:none"></label>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-danger" id="cfg-reset">Apagar todos os dados</button>
    </div>
    <div class="hint" style="margin-top:8px">${cloudMode ? 'Os dados ficam salvos no seu projeto Supabase.' : 'Os dados ficam salvos apenas neste navegador (localStorage).'} Exporte um backup regularmente.</div>`;
  c.appendChild(secData);

  c.querySelectorAll('.remove-dot').forEach(btn => btn.onclick = () => {
    const kind = btn.dataset.kind, idx = +btn.dataset.idx;
    if (kind === 'cat') {
      const list = getCategories(); list.splice(idx, 1); saveAndToast(setCategories(list));
    } else {
      const list = getPayments(); list.splice(idx, 1); saveAndToast(setPayments(list));
    }
  });
  c.querySelectorAll('.add-dot').forEach(btn => btn.onclick = () => {
    const kind = btn.dataset.add;
    const input = document.getElementById(`new-${kind}`);
    const val = input.value.trim();
    if (!val) return;
    if (kind === 'cat') {
      const list = getCategories(); if (!list.includes(val)) list.push(val); saveAndToast(setCategories(list));
    } else {
      const list = getPayments(); if (!list.includes(val)) list.push(val); saveAndToast(setPayments(list));
    }
  });

  document.getElementById('cfg-cdi').onchange = e => {
    const s = Object.assign({}, getSettings(), { cdiRate: parseNum(e.target.value) });
    saveAndToast(setSettings(s), 'Taxa CDI padrão atualizada.');
  };
  document.getElementById('cfg-theme').onchange = e => {
    const s = Object.assign({}, getSettings(), { theme: e.target.value });
    saveAndToast(setSettings(s));
    applyTheme();
  };
  document.getElementById('cfg-export-backup').onclick = () => {
    const backup = {
      transactions: getTx(), categories: getCategories(), payments: getPayments(),
      budgets: getBudgets(), subscriptions: getSubs(), goals: getGoals(), settings: getSettings(),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meu-financeiro-backup_${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup exportado.');
  };
  document.getElementById('cfg-import-backup').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (err) { toast('Arquivo de backup inválido.'); return; }
      const writes = [];
      if (data.transactions) writes.push(setTx(data.transactions));
      if (data.categories) writes.push(setCategories(data.categories));
      if (data.payments) writes.push(setPayments(data.payments));
      if (data.budgets) writes.push(setBudgets(data.budgets));
      if (data.subscriptions) writes.push(setSubs(data.subscriptions));
      if (data.goals) writes.push(setGoals(data.goals));
      if (data.settings) writes.push(setSettings(data.settings));
      await saveAndToast(Promise.all(writes), 'Backup importado com sucesso.');
      applyTheme();
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };
  document.getElementById('cfg-reset').onclick = async () => {
    if (!confirm('Isso vai apagar TODOS os dados (lançamentos, categorias, orçamentos, metas). Tem certeza?')) return;
    try {
      await resetAllData();
      toast('Dados apagados.');
      render();
    } catch (e) { toast('Erro ao apagar dados: ' + e.message); }
  };
}

/* ===================== auth screen (cloud mode only) ===================== */
function showApp() {
  document.getElementById('tabs').style.display = '';
  document.getElementById('btn-quick-add').style.display = '';
  document.getElementById('btn-logout').style.display = '';
  document.getElementById('user-email').textContent = currentUser ? currentUser.email : '';
}
function hideApp() {
  document.getElementById('tabs').style.display = 'none';
  document.getElementById('btn-quick-add').style.display = 'none';
  document.getElementById('btn-logout').style.display = 'none';
  document.getElementById('user-email').textContent = '';
}

// Email + password. No email step at all, so nothing to tap out of the app,
// and Supabase persists the session locally — no repeated logins once signed in.
function renderAuthScreen(status) {
  hideApp();
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="section-title">Entrar</div>
        <p class="section-sub" id="auth-mode-hint">Digite seu e-mail e senha.</p>
        <div class="field"><label>E-mail</label><input class="input" id="auth-email" type="email" placeholder="voce@email.com" autocomplete="email"></div>
        <div class="field"><label>Senha</label><input class="input" id="auth-password" type="password" placeholder="••••••••" autocomplete="current-password"></div>
        <button class="btn btn-primary" id="auth-signin" style="width:100%">Entrar</button>
        <button class="btn" id="auth-signup" style="width:100%; margin-top:8px">Criar conta (primeiro acesso)</button>
        <div class="hint" id="auth-status" style="margin-top:10px">${status ? escapeHtml(status) : ''}</div>
      </div>
    </div>`;

  const statusEl = document.getElementById('auth-status');
  const getCreds = () => ({
    email: document.getElementById('auth-email').value.trim(),
    password: document.getElementById('auth-password').value,
  });

  document.getElementById('auth-signin').onclick = async () => {
    const { email, password } = getCreds();
    if (!email || !password) { statusEl.textContent = 'Preencha e-mail e senha.'; return; }
    statusEl.textContent = 'Entrando...';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) statusEl.textContent = 'Erro: ' + error.message;
    // on success, onAuthStateChange fires SIGNED_IN and boots the app — nothing else to do here.
  };

  document.getElementById('auth-signup').onclick = async () => {
    const { email, password } = getCreds();
    if (!email || !password) { statusEl.textContent = 'Preencha e-mail e senha.'; return; }
    if (password.length < 6) { statusEl.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
    statusEl.textContent = 'Criando conta...';
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { statusEl.textContent = 'Erro: ' + error.message; return; }
    if (data.session) return; // confirmations disabled: onAuthStateChange signs us in immediately
    statusEl.textContent = 'Conta criada! Se pedir confirmação por e-mail, desative "Confirm email" em Authentication → Providers → Email no Supabase, e tente Entrar novamente.';
  };
}

function renderLoading() {
  hideApp();
  document.getElementById('content').innerHTML = '<div class="empty-state">Carregando seus dados...</div>';
}

/* ===================== init ===================== */
function initTabs() {
  document.getElementById('tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    render();
  });
}

function wireStaticControls() {
  initTabs();
  document.getElementById('btn-quick-add').onclick = () => openTxModal();
  document.getElementById('btn-theme').onclick = () => {
    const s = Object.assign({}, getSettings());
    const order = ['system', 'light', 'dark'];
    s.theme = order[(order.indexOf(s.theme) + 1) % order.length];
    setSettings(s).catch(() => {}); // CACHE updates synchronously; onChange() toasts on failure
    applyTheme();
    toast('Tema: ' + (s.theme === 'system' ? 'Automático' : s.theme === 'light' ? 'Claro' : 'Escuro'));
  };
  document.getElementById('modal-backdrop').addEventListener('click', e => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

function init() {
  setupSupabase();
  wireStaticControls();

  if (!cloudMode) {
    hydrateFromLocalStorage();
    applyTheme();
    render();
    return;
  }

  document.getElementById('btn-logout').onclick = () => sb.auth.signOut();
  renderLoading();
  let hydrated = false;
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      currentUser = session.user;
      // A background token refresh (fires periodically while the app is left
      // open) must not re-fetch and overwrite CACHE — that would clobber any
      // change made in the seconds between an add and its write finishing.
      if (hydrated && (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) return;
      try {
        await hydrateFromSupabase();
      } catch (e) {
        renderAuthScreen('Erro ao carregar dados: ' + e.message);
        return;
      }
      hydrated = true;
      showApp();
      applyTheme();
      render();
    } else {
      hydrated = false;
      currentUser = null;
      CACHE = emptyCache();
      renderAuthScreen();
    }
  });
}

init();
