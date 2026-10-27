'use strict';
(() => {
  /* ================= utilities ================= */
  const $ = id => document.getElementById(id);
  const WARN_AT = 0.8;
  const KEY = 'spending-ledger-app-v1';
  const SW = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'];
  const GROUPS = ['Cash', 'Bank account', 'Mobile money', 'Card', 'Savings', 'Loan', 'Other'];
  const CURRENCIES = [['USD', 'US dollar'], ['GHS', 'Ghana cedi'], ['NGN', 'Nigerian naira'], ['KES', 'Kenyan shilling'], ['ZAR', 'South African rand'], ['XOF', 'CFA franc (BCEAO)'], ['GBP', 'British pound'], ['EUR', 'Euro'], ['CAD', 'Canadian dollar'], ['INR', 'Indian rupee']];
  const FREQS = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year' };
  const DEF_EXP = [['Food', ['Groceries', 'Eating out', 'Snacks']], ['Transport', ['Fuel', 'Ride-hailing', 'Public transport']], ['Rent & housing', []], ['Utilities', ['Electricity', 'Water', 'Airtime & data', 'Internet']], ['Shopping', ['Clothes', 'Household']], ['Health', []], ['Education', []], ['Entertainment', ['Subscriptions', 'Outings']], ['Gifts & giving', []], ['Other', []]];
  const DEF_INC = [['Salary', []], ['Allowance', []], ['Bonus', []], ['Side income', []], ['Other income', []]];
  const DEF_ACC = [['Cash', 'Cash'], ['Bank account', 'Bank account'], ['Mobile money', 'Mobile money'], ['Card', 'Card']];

  const pad = n => String(n).padStart(2, '0');
  const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => toISO(new Date());
  const monthOf = iso => iso.slice(0, 7);
  const shiftMonth = (m, by) => { const [y, mo] = m.split('-').map(Number); return toISO(new Date(y, mo - 1 + by, 1)).slice(0, 7); };
  const daysIn = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
  const dateObj = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d || 1); };
  const monthName = (m, opt = { month: 'long', year: 'numeric' }) => dateObj(m).toLocaleDateString(undefined, opt);
  const niceDate = iso => dateObj(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(12); } catch {} };

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  }
  const svgEl = html => { const d = el('div'); d.innerHTML = html; return d.firstElementChild; };

  /* ================= data ================= */
  const mkCats = (list, offset = 0) => list.map(([name, subs], i) => ({ id: uid(), name, limitCents: null, color: SW[(i + offset) % SW.length], subs: subs.map(n => ({ id: uid(), name: n })) }));
  function fresh() {
    return {
      v: 1, currency: 'USD', onboarded: false, lastBackup: null,
      categories: mkCats(DEF_EXP), incomeCategories: mkCats(DEF_INC, 1).map(({ limitCents, ...c }) => c),
      accounts: DEF_ACC.map(([name, group]) => ({ id: uid(), name, group, openingCents: 0 })),
      txs: [], recurring: [], goals: [], pin: null,
    };
  }
  function normalize(d) {
    const f = fresh();
    for (const k of ['categories', 'incomeCategories', 'accounts', 'txs', 'recurring', 'goals']) if (!Array.isArray(d[k])) d[k] = f[k];
    d.currency = d.currency || 'USD';
    d.txs.forEach(t => { t.type = t.type || 'expense'; t.month = t.month || monthOf(t.date); });
    return d;
  }
  let data;
  try { data = normalize(JSON.parse(lsGet(KEY)) || fresh()); } catch { data = fresh(); }
  let persistAsked = false;
  function save() {
    if (!lsSet(KEY, JSON.stringify(data))) toast("Couldn't save on this device. Storage may be full or blocked.", 'over');
    if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
  }

  /* ================= derived ================= */
  const ui = { tab: 'trans', sub: { trans: 'daily', stats: 'categories' }, month: monthOf(todayISO()), query: '', statsType: 'expense', statsCat: null, calDay: null, editBudget: null, editIncome: null, editAccount: null };
  const money = c => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: data.currency }).format(c / 100); } catch { return (c / 100).toFixed(2); } };
  const compact = c => { try { return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(c / 100); } catch { return String(Math.round(c / 100)); } };
  const parseAmount = (s, allowNeg) => { const v = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); if (!isFinite(v)) return null; if (!allowNeg && v <= 0) return null; return Math.round(v * 100); };
  const expCat = id => data.categories.find(c => c.id === id);
  const incCat = id => data.incomeCategories.find(c => c.id === id);
  const catOf = t => t.type === 'income' ? incCat(t.categoryId) : expCat(t.categoryId);
  const subOf = t => { const c = catOf(t); return c && t.subId ? (c.subs || []).find(x => x.id === t.subId) : null; };
  const accOf = id => data.accounts.find(a => a.id === id);
  const monthTxs = (m = ui.month) => data.txs.filter(t => t.month === m);
  const totals = list => { let inc = 0, exp = 0; list.forEach(t => { if (t.type === 'income') inc += t.amountCents; else if (t.type === 'expense') exp += t.amountCents; }); return { inc, exp, tot: inc - exp }; };
  const spentIn = (list, catId, skipId) => list.reduce((s, t) => s + (t.type === 'expense' && t.categoryId === catId && t.id !== skipId ? t.amountCents : 0), 0);
  const levelOf = (spent, limit) => limit == null ? 'none' : spent > limit ? 'over' : spent >= limit * WARN_AT ? 'warn' : 'ok';
  function balanceOf(a) {
    let b = a.openingCents || 0;
    data.txs.forEach(t => {
      if (t.type === 'income' && t.accountId === a.id) b += t.amountCents;
      else if (t.type === 'expense' && t.accountId === a.id) b -= t.amountCents;
      else if (t.type === 'transfer') { if (t.accountId === a.id) b -= t.amountCents; if (t.toAccountId === a.id) b += t.amountCents; }
    });
    return b;
  }
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const browserEnv = (() => {
    const ua = navigator.userAgent;
    if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Snapchat|Twitter|MicroMessenger|GSA\/|TikTok|; wv\)/i.test(ua)) return 'inapp';
    if (isIOS) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (/Android/i.test(ua)) return /Firefox/i.test(ua) ? 'firefox-android' : 'android-chrome';
    return 'desktop';
  })();

  /* ================= theme ================= */
  const ICON_SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const getTheme = () => { const t = lsGet('ledger-theme'); return t === 'light' || t === 'dark' ? t : 'system'; };
  const isDark = () => getTheme() === 'dark' || (getTheme() === 'system' && darkMQ.matches);
  function applyTheme(t) {
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    lsSet('ledger-theme', t); themeUI();
  }
  function themeUI() {
    const dark = isDark();
    $('themeBtn').innerHTML = dark ? ICON_SUN : ICON_MOON;
    $('themeBtn').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = getTheme() === 'system' ? (m.media.includes('dark') ? '#0f1513' : '#f3f5f4') : dark ? '#0f1513' : '#f3f5f4'; });
  }
  $('themeBtn').onclick = () => { applyTheme(isDark() ? 'light' : 'dark'); if (ui.tab === 'more') render(); };
  darkMQ.addEventListener && darkMQ.addEventListener('change', themeUI);

  /* ================= recurring ================= */
  function nextDate(iso, freq, anchorDay) {
    const d = dateObj(iso);
    if (freq === 'weekly') { d.setDate(d.getDate() + 7); return toISO(d); }
    if (freq === 'biweekly') { d.setDate(d.getDate() + 14); return toISO(d); }
    const y = d.getFullYear() + (freq === 'yearly' ? 1 : 0), m = d.getMonth() + (freq === 'monthly' ? 1 : 0);
    const last = new Date(y, m + 1, 0).getDate();
    return toISO(new Date(y, m, Math.min(anchorDay || d.getDate(), last)));
  }
  function runRecurring(silent) {
    const today = todayISO(); let n = 0;
    data.recurring.forEach(r => {
      if (r.paused) return;
      let guard = 0;
      while (r.next <= today && guard++ < 400) {
        data.txs.push({ id: uid(), type: r.type, amountCents: r.amountCents, categoryId: r.categoryId || null, subId: r.subId || null, accountId: r.accountId || null, toAccountId: r.toAccountId || null, note: r.note || '', date: r.next, month: monthOf(r.next), createdAt: Date.now(), recurringId: r.id });
        n++; r.next = nextDate(r.next, r.freq, r.anchorDay);
      }
    });
    if (n) { save(); if (!silent) toast(`Added ${n} repeating ${n === 1 ? 'entry' : 'entries'} that came due.`); }
    return n;
  }

  /* ================= render ================= */
  const TITLES = { trans: 'Transactions', stats: 'Stats', budget: 'Budget', goals: 'Goals', more: 'More' };
  const SUBS = { trans: [['daily', 'Daily'], ['calendar', 'Calendar'], ['monthly', 'Monthly']], stats: [['categories', 'Categories'], ['insights', 'Insights']] };
  const editingInline = () => ui.editBudget || ui.editIncome || ui.editAccount;

  function render() {
    const sub = ui.sub[ui.tab], yearView = ui.tab === 'trans' && sub === 'monthly';
    $('viewTitle').textContent = TITLES[ui.tab];
    $('monthSwitch').hidden = !['trans', 'stats', 'budget'].includes(ui.tab);
    $('periodLabel').textContent = yearView ? ui.month.slice(0, 4) : monthName(ui.month);
    document.querySelectorAll('#bottomNav button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
    const st = $('subtabs'); st.replaceChildren();
    (SUBS[ui.tab] || []).forEach(([k, label]) => st.append(el('button', { type: 'button', 'aria-pressed': String(sub === k), text: label, onclick: () => { ui.sub[ui.tab] = k; render(); } })));
    $('period').hidden = !(ui.tab === 'trans' || (ui.tab === 'stats' && sub === 'categories'));
    const list = yearView ? data.txs.filter(t => t.month.startsWith(ui.month.slice(0, 4))) : monthTxs();
    const t = totals(list);
    $('pInc').textContent = money(t.inc); $('pExp').textContent = money(t.exp); $('pTot').textContent = money(t.tot);
    $('fab').hidden = ui.tab === 'more';
    renderAlerts(); renderBanner();
    const view = ui.tab === 'trans' ? { daily: viewDaily, calendar: viewCalendar, monthly: viewMonthly }[sub]()
      : ui.tab === 'stats' ? (sub === 'insights' ? viewInsights() : viewStats())
      : ui.tab === 'budget' ? viewBudget() : ui.tab === 'goals' ? viewGoals() : viewMore();
    $('main').replaceChildren(view);
  }

  function renderAlerts() {
    const box = $('alerts'); box.replaceChildren();
    if (!['trans', 'budget'].includes(ui.tab)) return;
    const mt = monthTxs();
    data.categories.forEach(c => {
      if (c.limitCents == null) return;
      const spent = spentIn(mt, c.id), lvl = levelOf(spent, c.limitCents);
      if (lvl !== 'over' && lvl !== 'warn') return;
      box.append(el('div', { class: `alert ${lvl}`, role: 'status' },
        el('span', { class: 'sign', text: lvl === 'over' ? '!' : '≈' }),
        el('div', {}, el('strong', { text: lvl === 'over' ? `${c.name} is over budget by ${money(spent - c.limitCents)}` : `${c.name} is at ${Math.round(spent / c.limitCents * 100)}% of its budget` }),
          el('span', { class: 'hint', text: `${money(spent)} of ${money(c.limitCents)} in ${monthName(ui.month)}` }))));
    });
  }

  let deferredPrompt = null;
  function renderBanner() {
    const box = $('banner'); box.replaceChildren();
    if (ui.tab !== 'trans') return;
    if (!data.onboarded) {
      const cur = currencySelect('welcomeCur');
      box.append(el('div', { class: 'alert info' }, el('span', { class: 'sign', text: '→' }), el('div', { class: 'grow' },
        el('strong', { text: 'Welcome to your ledger' }),
        el('span', { class: 'hint', text: 'Everything you enter stays on this phone. Pick your currency to start. If you used the claude.ai version, export its CSV there and import it here.' }),
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'welcomeCur', text: 'Currency' }), cur),
        el('div', { class: 'acts', style: 'justify-content:flex-start' },
          el('button', { class: 'btn primary small', text: 'Start', onclick: () => { data.currency = cur.value; data.onboarded = true; save(); render(); } }),
          el('button', { class: 'btn small', text: 'Import CSV', onclick: () => { data.currency = cur.value; data.onboarded = true; save(); pickFile(); } })))));
      return;
    }
    if (!isStandalone() && !lsGet('ledger-install-dismissed')) {
      const dismiss = el('button', { class: 'icon-btn', text: 'Not now', onclick: () => { lsSet('ledger-install-dismissed', '1'); render(); } });
      box.append(el('div', { class: 'alert info' }, el('span', { class: 'sign', text: '↓' }), el('div', { class: 'grow' },
        el('strong', { text: 'Put Ledger on your home screen' }),
        el('span', { class: 'hint', text: 'It gets its own icon, opens full screen like a normal app and works offline.' }),
        el('div', { class: 'acts', style: 'justify-content:flex-start' }, el('button', { class: 'btn primary small', text: 'Install app', onclick: promptInstall }), dismiss))));
      return;
    }
    const since = data.lastBackup ? (Date.now() - data.lastBackup) / 864e5 : Infinity;
    if (data.txs.length >= 15 && since > 30 && !sessionStorage.getItem('ledger-bk-dismiss')) {
      box.append(el('div', { class: 'alert warn' }, el('span', { class: 'sign', text: '!' }), el('div', { class: 'grow' },
        el('strong', { text: data.lastBackup ? `Last backup was ${Math.floor(since)} days ago` : 'You have no backup yet' }),
        el('span', { class: 'hint', text: 'Your data lives only on this phone. Save a backup file so a lost or reset phone does not lose it.' }),
        el('div', { class: 'acts', style: 'justify-content:flex-start' }, el('button', { class: 'btn primary small', text: 'Back up now', onclick: exportJSON }),
          el('button', { class: 'icon-btn', text: 'Later', onclick: () => { try { sessionStorage.setItem('ledger-bk-dismiss', '1'); } catch {} render(); } })))));
    }
  }

  /* ---------- transaction list pieces ---------- */
  function dayCard(date, list) {
    const d = dateObj(date), wd = d.getDay(), t = totals(list);
    const card = el('section', { class: 'day' },
      el('div', { class: 'day-head' },
        el('span', { class: 'd', text: d.getDate() }),
        el('span', { class: 'wd' }, el('b', { class: wd === 0 ? 'sun' : wd === 6 ? 'sat' : '', text: d.toLocaleDateString(undefined, { weekday: 'short' }) }), d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })),
        el('span', { class: 'num inc', text: t.inc ? money(t.inc) : '' }),
        el('span', { class: 'num exp', text: t.exp ? money(t.exp) : '' })));
    list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach(x => card.append(txRow(x)));
    return card;
  }
  function txRow(x) {
    const c = catOf(x), sub = subOf(x), a = accOf(x.accountId), to = accOf(x.toAccountId);
    const catName = x.type === 'transfer' ? 'Transfer' : c ? c.name : 'Uncategorised';
    const accText = x.type === 'transfer' ? `${a ? a.name : '?'} → ${to ? to.name : '?'}` : a ? a.name : '';
    const cls = x.type === 'income' ? 'inc' : x.type === 'expense' ? 'exp' : 'xfer';
    return el('button', { class: 'tx', type: 'button', onclick: () => openTxSheet(x) },
      el('span', { class: 'cat' }, el('span', { class: 'swatch', style: `background:${c ? `var(${c.color})` : 'var(--line)'}` }), sub ? `${catName} · ${sub.name}` : catName),
      el('span', { class: 'what' }, el('div', {}, x.note || (sub ? sub.name : catName), x.recurringId ? el('span', { class: 'rep', text: '↻' }) : null), accText ? el('div', { class: 'acc', text: accText }) : null),
      el('span', { class: `amt num ${cls}`, text: money(x.amountCents) }));
  }
  function groupByDay(list) {
    const m = new Map();
    list.forEach(t => { if (!m.has(t.date)) m.set(t.date, []); m.get(t.date).push(t); });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }

  /* ---------- Trans: daily ---------- */
  const searchInput = el('input', { id: 'search', class: 'search', type: 'search', placeholder: 'Search notes, categories, accounts', 'aria-label': 'Search transactions', enterkeyhint: 'search' });
  const dailyList = el('div', { class: 'stack' });
  searchInput.addEventListener('input', () => { ui.query = searchInput.value; fillDaily(); });
  function fillDaily() {
    const q = ui.query.trim().toLowerCase();
    const list = q ? data.txs.filter(t => {
      const c = catOf(t), a = accOf(t.accountId), to = accOf(t.toAccountId), sb = subOf(t);
      return [t.note, c && c.name, sb && sb.name, a && a.name, to && to.name, t.type === 'transfer' ? 'transfer' : ''].some(s => s && s.toLowerCase().includes(q));
    }) : monthTxs();
    dailyList.replaceChildren();
    if (q) { const t = totals(list); dailyList.append(el('div', { class: 'hint', text: `${list.length} match${list.length === 1 ? '' : 'es'} in all months · ${money(t.exp)} spent · ${money(t.inc)} received` })); }
    if (!list.length) {
      dailyList.append(el('div', { class: 'empty-state' }, el('div', { text: q ? 'Nothing matches that search.' : `No transactions in ${monthName(ui.month)} yet. Tap + to add one.` })));
      return;
    }
    groupByDay(list).forEach(([d, l]) => dailyList.append(dayCard(d, l)));
  }
  function viewDaily() { fillDaily(); return el('div', { class: 'stack' }, searchInput, dailyList); }

  /* ---------- Trans: calendar ---------- */
  function viewCalendar() {
    const box = el('div', { class: 'stack' });
    const mt = monthTxs(), days = daysIn(ui.month), first = dateObj(ui.month + '-01').getDay();
    const byDay = {}; mt.forEach(t => { (byDay[t.date] = byDay[t.date] || []).push(t); });
    const cal = el('div', { class: 'cal' });
    for (let i = 0; i < 7; i++) cal.append(el('div', { class: `wh${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`, text: new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }) }));
    for (let i = 0; i < first; i++) cal.append(el('div', { class: 'cell blank' }));
    const today = todayISO();
    for (let d = 1; d <= days; d++) {
      const iso = `${ui.month}-${pad(d)}`, t = totals(byDay[iso] || []);
      cal.append(el('button', { type: 'button', class: `cell${iso === today ? ' today' : ''}${iso === ui.calDay ? ' sel' : ''}`, 'aria-label': `${d}: income ${money(t.inc)}, expenses ${money(t.exp)}`, onclick: () => { ui.calDay = ui.calDay === iso ? null : iso; render(); } },
        el('span', { class: 'n', text: d }), t.inc ? el('span', { class: 'v inc', text: compact(t.inc) }) : null, t.exp ? el('span', { class: 'v exp', text: compact(t.exp) }) : null));
    }
    for (let i = 0; i < (7 - ((first + days) % 7)) % 7; i++) cal.append(el('div', { class: 'cell blank' }));
    box.append(cal);
    if (ui.calDay && monthOf(ui.calDay) === ui.month) {
      const l = byDay[ui.calDay] || [];
      box.append(l.length ? dayCard(ui.calDay, l) : el('div', { class: 'empty-state', text: `Nothing on ${niceDate(ui.calDay)}.` }));
      box.append(el('div', {}, el('button', { class: 'btn small', text: '+ Add on this day', onclick: () => openTxSheet(null, ui.calDay) })));
    } else box.append(el('div', { class: 'hint', text: 'Tap a day to see its transactions.' }));
    return box;
  }

  /* ---------- Trans: monthly ---------- */
  function viewMonthly() {
    const y = ui.month.slice(0, 4), cur = monthOf(todayISO()), tbody = el('tbody'), all = { inc: 0, exp: 0 };
    const go = key => { ui.month = key; ui.sub.trans = 'daily'; render(); };
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${pad(m)}`, t = totals(monthTxs(key)); all.inc += t.inc; all.exp += t.exp;
      tbody.append(el('tr', { class: `row${key === cur ? ' cur' : ''}`, tabindex: 0, onclick: () => go(key), onkeydown: e => { if (e.key === 'Enter') go(key); } },
        el('td', { text: monthName(key, { month: 'short' }) }), el('td', { class: 'inc', text: t.inc ? money(t.inc) : '–' }), el('td', { class: 'exp', text: t.exp ? money(t.exp) : '–' }), el('td', { text: t.inc || t.exp ? money(t.tot) : '–' })));
    }
    return el('div', { class: 'panel' }, el('div', { class: 'scroll-x' }, el('table', { class: 'mtable' },
      el('thead', {}, el('tr', {}, ['Month', 'Income', 'Expenses', 'Total'].map(h => el('th', { text: h })))), tbody,
      el('tfoot', {}, el('tr', {}, el('td', { text: y }), el('td', { class: 'inc', text: money(all.inc) }), el('td', { class: 'exp', text: money(all.exp) }), el('td', { text: money(all.inc - all.exp) }))))));
  }

  /* ---------- Stats: categories ---------- */
  function viewStats() {
    const type = ui.statsType, list = monthTxs().filter(t => t.type === type);
    const groups = new Map(); list.forEach(t => { const k = t.categoryId || 'none'; groups.set(k, (groups.get(k) || 0) + t.amountCents); });
    const rows = [...groups.entries()].map(([id, v]) => { const c = type === 'income' ? incCat(id) : expCat(id); return { id, v, name: c ? c.name : 'Uncategorised', color: c ? `var(${c.color})` : 'var(--muted)' }; }).sort((a, b) => b.v - a.v);
    const total = rows.reduce((s, r) => s + r.v, 0);
    const seg = el('div', { class: 'seg' }, ['expense', 'income'].map(t => el('button', { type: 'button', 'data-t': t, 'aria-pressed': String(type === t), text: t === 'expense' ? 'Expenses' : 'Income', onclick: () => { ui.statsType = t; ui.statsCat = null; render(); } })));
    const panel = el('div', { class: 'panel' }, seg);
    if (!total) { panel.append(el('div', { class: 'empty-state', text: `No ${type === 'expense' ? 'expenses' : 'income'} in ${monthName(ui.month)}.` })); return panel; }
    const R = 70, C = 2 * Math.PI * R; let off = 0, arcs = '';
    rows.forEach(r => { const len = r.v / total * C; arcs += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${r.color}" stroke-width="30" stroke-dasharray="${Math.max(0, len - (rows.length > 1 ? 1.5 : 0))} ${C}" stroke-dashoffset="${-off}"/>`; off += len; });
    const donut = svgEl(`<svg class="donut" viewBox="0 0 200 200" role="img" aria-label="Share by category"><g transform="rotate(-90 100 100)"><circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--sunk)" stroke-width="30"/>${arcs}</g><text x="100" y="97" text-anchor="middle" font-size="17">${compact(total)}</text><text class="sub" x="100" y="117" text-anchor="middle" font-size="11">${type === 'expense' ? 'spent' : 'received'}</text></svg>`);
    const legend = el('div', { class: 'legend' }, rows.map(r => el('button', { type: 'button', class: 'lg', 'aria-pressed': String(ui.statsCat === r.id), onclick: () => { ui.statsCat = ui.statsCat === r.id ? null : r.id; render(); } },
      el('span', { class: 'pct', style: `background:${r.color}`, text: `${Math.round(r.v / total * 100)}%` }), el('span', { class: 'nm', text: r.name }), el('span', { class: `num ${type === 'income' ? 'inc' : 'exp'}`, text: money(r.v) }))));
    panel.append(el('div', { class: 'stats-top' }, donut, legend));
    const box = el('div', { class: 'stack' }, panel);
    if (ui.statsCat) {
      const sel = list.filter(t => (t.categoryId || 'none') === ui.statsCat);
      const sb = subBreakdown(sel, type); if (sb) box.append(sb);
      groupByDay(sel).forEach(([d, l]) => box.append(dayCard(d, l)));
    } else panel.append(el('div', { class: 'hint', text: 'Tap a category to see its subcategories and transactions.' }));
    return box;
  }
  function subBreakdown(list, type) {
    const parts = new Map();
    list.forEach(t => { const sb = subOf(t); const k = sb ? sb.name : 'No subcategory'; parts.set(k, (parts.get(k) || 0) + t.amountCents); });
    if (parts.size < 2 && parts.has('No subcategory')) return null;
    const total = [...parts.values()].reduce((a, b) => a + b, 0);
    return el('div', { class: 'panel' }, el('h3', { text: 'By subcategory' }), el('div', { class: 'subbars' },
      [...parts.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => el('div', { class: 'subbar' },
        el('div', { class: 'b-row' }, el('span', { text: n }), el('span', { class: `num ${type === 'income' ? 'inc' : 'exp'}`, text: `${money(v)} · ${Math.round(v / total * 100)}%` })),
        el('div', { class: 'bar' }, el('i', { style: `width:${v / total * 100}%;background:var(${type === 'income' ? '--inc' : '--exp'})` }))))));
  }

  /* ---------- Stats: insights ---------- */
  function viewInsights() {
    const m = ui.month, prevM = shiftMonth(m, -1), cur = totals(monthTxs(m)), prev = totals(monthTxs(prevM));
    const todayM = monthOf(todayISO()), isCur = m === todayM, isPast = m < todayM;
    const elapsed = isCur ? new Date().getDate() : isPast ? daysIn(m) : 0;
    const delta = (a, b, upIsBad) => {
      if (!b) return el('span', { class: 'delta hint', text: `nothing in ${monthName(prevM, { month: 'short' })}` });
      const p = Math.round((a - b) / b * 100), bad = upIsBad ? p > 0 : p < 0;
      return el('span', { class: `delta ${p === 0 ? 'hint' : bad ? 'bad' : 'good'}`, text: `${p > 0 ? '▲' : p < 0 ? '▼' : '•'} ${Math.abs(p)}% vs ${monthName(prevM, { month: 'short' })}` });
    };
    const rate = cur.inc ? Math.round((cur.inc - cur.exp) / cur.inc * 100) : null;
    const avg = elapsed ? Math.round(cur.exp / elapsed) : 0;
    const budget = data.categories.reduce((s, c) => s + (c.limitCents || 0), 0);
    const proj = isCur ? avg * daysIn(m) : null;
    const kpis = el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('span', { class: 'label', text: 'Spent' }), el('span', { class: 'big num exp', text: money(cur.exp) }), delta(cur.exp, prev.exp, true)),
      el('div', { class: 'kpi' }, el('span', { class: 'label', text: 'Income' }), el('span', { class: 'big num inc', text: money(cur.inc) }), delta(cur.inc, prev.inc, false)),
      el('div', { class: 'kpi' }, el('span', { class: 'label', text: 'Saved of income' }), el('span', { class: `big num ${rate == null ? '' : rate >= 0 ? 'good' : 'bad'}`, text: rate == null ? '–' : `${rate}%` }), el('span', { class: 'hint', text: rate == null ? 'Add income to see this' : rate >= 20 ? 'Strong month' : rate >= 0 ? 'Aim for 20% or more' : 'Spending more than you earn' })),
      el('div', { class: 'kpi' }, el('span', { class: 'label', text: 'Average per day' }), el('span', { class: 'big num', text: elapsed ? money(avg) : '–' }),
        el('span', { class: `hint${proj != null && budget && proj > budget ? ' over' : ''}`, text: proj != null ? `On pace for ${money(proj)} this month${budget ? ` (budget ${money(budget)})` : ''}` : isPast ? `${daysIn(m)} days` : 'Month not started' })));

    // no-spend days
    const spentDays = new Set(monthTxs(m).filter(t => t.type === 'expense').map(t => +t.date.slice(8)));
    const strip = el('div', { class: 'streak', 'aria-hidden': 'true' });
    let free = 0;
    for (let d = 1; d <= daysIn(m); d++) {
      const future = d > elapsed; if (!future && !spentDays.has(d)) free++;
      strip.append(el('i', { class: future ? 'future' : spentDays.has(d) ? 'spent' : 'free', title: `${d}` }));
    }
    let streak = 0;
    if (isCur) { const d = new Date(); for (;;) { const iso = toISO(d); if (data.txs.some(t => t.type === 'expense' && t.date === iso)) break; streak++; d.setDate(d.getDate() - 1); if (streak > 366) break; } }
    const nospend = el('div', { class: 'panel' }, el('div', { class: 'panel-head' }, el('h2', { text: 'No-spend days' }), el('span', { class: 'num good', text: `${free} of ${elapsed || 0}` })), strip,
      el('div', { class: 'hint', text: isCur ? (streak ? `You're on a ${streak}-day no-spend streak, today included. Keep it going.` : 'You spent something today. Tomorrow is a fresh chance at a no-spend day.') : 'Green squares are days with no expenses.' }));

    // movers
    const movers = data.categories.map(c => ({ c, a: spentIn(monthTxs(m), c.id), b: spentIn(monthTxs(prevM), c.id) })).filter(x => x.a || x.b).map(x => ({ ...x, d: x.a - x.b })).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 5);
    const moverPanel = el('div', { class: 'panel' }, el('h2', { text: `Biggest changes vs ${monthName(prevM, { month: 'long' })}` }),
      movers.length ? el('div', { class: 'row-list' }, movers.map(x => el('div', { class: 'row-item' },
        el('span', { class: 'grow' }, el('span', { class: 'swatch', style: `background:var(${x.c.color});margin-right:8px` }), x.c.name, el('div', { class: 'sub num', text: `${money(x.b)} → ${money(x.a)}` })),
        el('span', { class: `num ${x.d > 0 ? 'bad' : x.d < 0 ? 'good' : 'hint'}`, text: `${x.d > 0 ? '+' : x.d < 0 ? '−' : ''}${money(Math.abs(x.d))}` })))) : el('div', { class: 'hint', text: 'Not enough spending yet to compare.' }));

    // 6-month trend
    const months = []; for (let i = 5; i >= 0; i--) months.push(shiftMonth(m, -i));
    const vals = months.map(k => totals(monthTxs(k)));
    const max = Math.max(1, ...vals.map(v => Math.max(v.inc, v.exp)));
    const raw = max / 100 / 4, mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 0.01))));
    const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw) * 100, top = step * 4;
    const W = 340, H = 180, L = 40, Rr = 6, T = 8, B = 22, y = v => T + (H - T - B) * (1 - v / top), slot = (W - L - Rr) / 6, bw = slot * 0.3;
    let s = '';
    for (let i = 0; i <= 4; i++) s += `<line class="gl" x1="${L}" x2="${W - Rr}" y1="${y(step * i)}" y2="${y(step * i)}"/><text x="${L - 5}" y="${y(step * i) + 3}" text-anchor="end">${compact(step * i)}</text>`;
    vals.forEach((v, i) => {
      const x = L + i * slot + slot / 2;
      s += `<rect x="${x - bw - 1}" y="${y(v.inc)}" width="${bw}" height="${H - B - y(v.inc)}" rx="2" fill="var(--inc)"><title>Income ${money(v.inc)}</title></rect>`;
      s += `<rect x="${x + 1}" y="${y(v.exp)}" width="${bw}" height="${H - B - y(v.exp)}" rx="2" fill="var(--exp)"><title>Expenses ${money(v.exp)}</title></rect>`;
      s += `<text x="${x}" y="${H - 6}" text-anchor="middle"${months[i] === m ? ' style="fill:var(--fg);font-weight:600"' : ''}>${monthName(months[i], { month: 'short' })}</text>`;
    });
    const trend = el('div', { class: 'panel chart' }, el('div', { class: 'panel-head' }, el('h2', { text: 'Last 6 months' }),
      el('div', { class: 'legend-inline' }, el('span', {}, el('i', { class: 'swatch', style: 'background:var(--inc)' }), 'Income'), el('span', {}, el('i', { class: 'swatch', style: 'background:var(--exp)' }), 'Expenses'))),
      svgEl(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and expenses for the last six months">${s}</svg>`));

    const big = monthTxs(m).filter(t => t.type === 'expense').sort((a, b) => b.amountCents - a.amountCents)[0];
    const bigPanel = big ? el('div', { class: 'panel' }, el('span', { class: 'label', text: 'Biggest expense this month' }), txRow(big)) : null;
    return el('div', { class: 'stack' }, kpis, nospend, trend, moverPanel, bigPanel);
  }

  /* ---------- Budget ---------- */
  function viewBudget() {
    const mt = monthTxs(), capped = data.categories.filter(c => c.limitCents != null);
    const budget = capped.reduce((s, c) => s + c.limitCents, 0), spent = capped.reduce((s, c) => s + spentIn(mt, c.id), 0);
    const isCur = ui.month === monthOf(todayISO()), daysLeft = isCur ? daysIn(ui.month) - new Date().getDate() + 1 : 0, left = budget - spent;
    const head = el('div', { class: 'panel' },
      el('div', { class: 'figs3' },
        el('div', {}, el('span', { class: 'label', text: 'Budgeted' }), el('span', { class: 'big num', text: budget ? money(budget) : '–' })),
        el('div', {}, el('span', { class: 'label', text: 'Left' }), el('span', { class: `big num${left < 0 ? ' exp' : ''}`, text: budget ? money(left) : '–' })),
        el('div', {}, el('span', { class: 'label', text: 'Per day' }), el('span', { class: 'big num', text: budget && isCur ? money(Math.max(0, Math.floor(left / daysLeft))) : '–' }))),
      budget ? el('div', { class: 'bar' }, el('i', { class: levelOf(spent, budget), style: `width:${Math.min(100, spent / budget * 100)}%` }))
        : el('div', { class: 'hint', text: 'Tap Edit on a category to give it a monthly limit. You get a warning at 80% and a prompt before anything takes it over.' }));
    const list = el('div', {});
    data.categories.forEach(c => list.append(ui.editBudget === c.id ? budgetEditor(c) : budgetRow(c, mt)));
    if (ui.editBudget === 'new') list.append(budgetEditor(null));
    const exp = el('div', { class: 'panel' }, el('div', { class: 'panel-head' }, el('h2', { text: 'Expense categories' }), el('button', { class: 'linkbtn', text: '+ New', onclick: () => { ui.editBudget = 'new'; render(); focusFirst(); } })), list);
    const chips = el('div', { class: 'chips' });
    data.incomeCategories.forEach(c => chips.append(ui.editIncome === c.id ? incomeEditor(c) : el('button', { class: 'chip', type: 'button', onclick: () => { ui.editIncome = c.id; render(); focusFirst(); } }, el('span', { class: 'swatch', style: `background:var(${c.color})` }), c.name)));
    if (ui.editIncome === 'new') chips.append(incomeEditor(null));
    const inc = el('div', { class: 'panel' }, el('div', { class: 'panel-head' }, el('h2', { text: 'Income categories' }), el('button', { class: 'linkbtn', text: '+ New', onclick: () => { ui.editIncome = 'new'; render(); focusFirst(); } })), chips);
    return el('div', { class: 'stack' }, head, exp, inc);
  }
  const focusFirst = () => setTimeout(() => { const i = $('main').querySelector('form input'); if (i) i.focus(); }, 0);
  function subSplit(c, mt) {
    if (!(c.subs || []).length) return null;
    const parts = new Map(); let any = false;
    mt.forEach(t => { if (t.type === 'expense' && t.categoryId === c.id) { const sb = subOf(t); const k = sb ? sb.name : 'Other'; parts.set(k, (parts.get(k) || 0) + t.amountCents); any = true; } });
    if (!any) return el('div', { class: 'sub-split', text: c.subs.map(x => x.name).join(' · ') });
    return el('div', { class: 'sub-split' }, [...parts.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => el('span', {}, `${n} `, el('b', { class: 'num', text: money(v) }))));
  }
  function budgetRow(c, mt) {
    const spent = spentIn(mt, c.id), lvl = levelOf(spent, c.limitCents), rest = (c.limitCents || 0) - spent;
    return el('div', { class: 'budget' },
      el('div', { class: 'b-row' },
        el('div', { class: 'b-name' }, el('span', { class: 'swatch', style: `background:var(${c.color})` }), el('span', { text: c.name })),
        el('span', { class: `pill ${lvl}`, text: { ok: 'On track', warn: 'Near limit', over: 'Over budget', none: 'No limit' }[lvl] }),
        el('button', { class: 'icon-btn', text: 'Edit', 'aria-label': `Edit ${c.name}`, onclick: () => { ui.editBudget = c.id; render(); focusFirst(); } })),
      subSplit(c, mt),
      el('div', { class: 'b-fig num' }, el('b', { text: money(spent) }), c.limitCents == null ? ' spent' : ` of ${money(c.limitCents)} · ${rest >= 0 ? money(rest) + ' left' : money(-rest) + ' over'}`),
      c.limitCents != null ? el('div', { class: 'bar' }, el('i', { class: lvl, style: `width:${Math.min(100, c.limitCents ? spent / c.limitCents * 100 : 100)}%` })) : null);
  }
  function subsEditor(subs) {
    const list = el('div', { class: 'subs-ed' });
    const addRow = x => {
      const inp = el('input', { maxlength: 40, placeholder: 'e.g. Groceries', 'aria-label': 'Subcategory name' });
      inp.value = x ? x.name : ''; inp.dataset.id = x ? x.id : '';
      const row = el('div', { class: 'sub-row' }, inp, el('button', { type: 'button', class: 'icon-btn', text: 'Remove', onclick: () => row.remove() }));
      list.append(row); return inp;
    };
    (subs || []).forEach(addRow);
    const node = el('div', { class: 'field full' }, el('span', { class: 'label', text: 'Subcategories' }), list, el('div', {}, el('button', { type: 'button', class: 'linkbtn', text: '+ Add subcategory', onclick: () => addRow(null).focus() })));
    return { node, collect: () => [...list.querySelectorAll('input')].map(i => ({ id: i.dataset.id || uid(), name: i.value.trim() })).filter(x => x.name) };
  }
  function armDelete(btn, fn) {
    btn.onclick = () => { if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = 'Tap again to delete'; return; } fn(); };
    return btn;
  }
  function budgetEditor(c) {
    const name = el('input', { id: 'bName', maxlength: 40, required: true }); name.value = c ? c.name : '';
    const lim = el('input', { id: 'bLimit', class: 'num', inputmode: 'decimal', placeholder: 'No limit' }); lim.value = c && c.limitCents != null ? (c.limitCents / 100).toFixed(2) : '';
    const subs = subsEditor(c && c.subs), done = () => { ui.editBudget = null; render(); };
    const f = el('form', { class: 'edit-grid', onsubmit: e => {
      e.preventDefault(); const n = name.value.trim(); if (!n) return;
      const lc = lim.value.trim() ? parseAmount(lim.value) : null;
      if (lim.value.trim() && lc == null) { toast('Enter the limit as a number, like 250 or 250.00.', 'warn'); return; }
      if (c) Object.assign(c, { name: n, limitCents: lc, subs: subs.collect() }); else data.categories.push({ id: uid(), name: n, limitCents: lc, subs: subs.collect(), color: SW[data.categories.length % SW.length] });
      save(); done(); toast(`${n} saved.`);
    } },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'bName', text: 'Category name' }), name),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'bLimit', text: 'Monthly limit' }), lim),
      subs.node,
      el('div', { class: 'acts' }, el('button', { class: 'btn primary small', type: 'submit', text: c ? 'Save' : 'Add category' }), el('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: done }),
        c ? armDelete(el('button', { class: 'btn danger small', type: 'button', text: 'Delete' }), () => { data.categories = data.categories.filter(x => x.id !== c.id); save(); done(); toast(`${c.name} deleted. Its transactions are kept as Uncategorised.`); }) : null));
    return el('div', { class: 'budget' }, f);
  }
  function incomeEditor(c) {
    const name = el('input', { id: 'iName', maxlength: 40, required: true, placeholder: 'e.g. Freelance' }); name.value = c ? c.name : '';
    const subs = subsEditor(c && c.subs), done = () => { ui.editIncome = null; render(); };
    return el('form', { class: 'edit-grid', style: 'width:100%', onsubmit: e => {
      e.preventDefault(); const n = name.value.trim(); if (!n) return;
      if (c) Object.assign(c, { name: n, subs: subs.collect() }); else data.incomeCategories.push({ id: uid(), name: n, subs: subs.collect(), color: SW[(data.incomeCategories.length + 1) % SW.length] });
      save(); done(); toast(`${n} saved.`);
    } },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'iName', text: 'Income category' }), name), subs.node,
      el('div', { class: 'acts' }, el('button', { class: 'btn primary small', type: 'submit', text: 'Save' }), el('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: done }),
        c ? armDelete(el('button', { class: 'btn danger small', type: 'button', text: 'Delete' }), () => { data.incomeCategories = data.incomeCategories.filter(x => x.id !== c.id); save(); done(); }) : null));
  }

  /* ---------- Goals ---------- */
  const goalSaved = g => (g.contribs || []).reduce((s, c) => s + c.amountCents, 0);
  function ring(pct, color) {
    const R = 34, C = 2 * Math.PI * R, p = Math.max(0, Math.min(1, pct));
    return svgEl(`<svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${Math.round(pct * 100)}% saved"><circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--sunk)" stroke-width="9"/><circle cx="42" cy="42" r="${R}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${p * C} ${C}" transform="rotate(-90 42 42)"/><text x="42" y="47" text-anchor="middle">${Math.round(pct * 100)}%</text></svg>`);
  }
  function viewGoals() {
    const box = el('div', { class: 'stack' });
    const totalSaved = data.goals.reduce((s, g) => s + goalSaved(g), 0), totalTarget = data.goals.reduce((s, g) => s + g.targetCents, 0);
    box.append(el('div', { class: 'panel' }, el('div', { class: 'panel-head' },
      el('div', {}, el('span', { class: 'label', text: 'Saved toward goals' }), el('div', { class: 'num', style: 'font-size:1.3rem', text: totalTarget ? `${money(totalSaved)} of ${money(totalTarget)}` : money(0) })),
      el('button', { class: 'btn primary small', text: '+ New goal', onclick: () => goalForm(null) }))));
    if (!data.goals.length) { box.append(el('div', { class: 'empty-state' }, el('div', { text: 'Save toward something specific: an emergency fund, a laptop, rent for next year. Set a target and a date, and Ledger tells you how much to put aside each week.' }), el('button', { class: 'btn small', text: 'Create your first goal', onclick: () => goalForm(null) }))); return box; }
    const grid = el('div', { class: 'goals' });
    data.goals.forEach(g => {
      const saved = goalSaved(g), pct = g.targetCents ? saved / g.targetCents : 0, rest = g.targetCents - saved;
      let plan = '';
      if (rest <= 0) plan = 'Goal reached. Well done.';
      else if (g.deadline) {
        const days = Math.ceil((dateObj(g.deadline) - dateObj(todayISO())) / 864e5);
        plan = days <= 0 ? `Deadline passed. ${money(rest)} still to go.` : `Save ${money(Math.ceil(rest / Math.max(1, days / 7)))} a week to reach it by ${niceDate(g.deadline)}.`;
      } else plan = `${money(rest)} to go. Add a deadline to get a weekly target.`;
      grid.append(el('div', { class: 'goal' },
        el('div', { class: 'goal-top' }, ring(pct, `var(${g.color})`), el('div', {}, el('h3', { text: g.name }), el('div', { class: 'num', text: `${money(saved)} of ${money(g.targetCents)}` }), el('div', { class: `hint${rest <= 0 ? ' good' : ''}`, text: plan }))),
        el('div', { class: 'acts', style: 'justify-content:flex-start' },
          el('button', { class: 'btn primary small', text: 'Add money', onclick: () => contribForm(g, 1) }),
          el('button', { class: 'btn small', text: 'Take out', onclick: () => contribForm(g, -1) }),
          el('button', { class: 'icon-btn', text: 'Edit', onclick: () => goalForm(g) }))));
    });
    box.append(grid);
    return box;
  }
  function goalForm(g) {
    openForm({
      title: g ? 'Edit goal' : 'New savings goal',
      fields: [
        { id: 'gName', label: 'Goal', value: g ? g.name : '', placeholder: 'e.g. Emergency fund', required: true },
        { id: 'gTarget', label: 'Target amount', value: g ? (g.targetCents / 100).toFixed(2) : '', money: true, required: true },
        { id: 'gDeadline', label: 'Target date (optional)', type: 'date', value: g ? g.deadline || '' : '' },
      ],
      submit: g ? 'Save' : 'Create goal',
      onSubmit: v => {
        const t = parseAmount(v.gTarget); if (t == null) { toast('Enter a target amount, like 5000.', 'warn'); return false; }
        if (g) Object.assign(g, { name: v.gName.trim(), targetCents: t, deadline: v.gDeadline || null });
        else data.goals.push({ id: uid(), name: v.gName.trim(), targetCents: t, deadline: v.gDeadline || null, color: SW[(data.goals.length + 2) % SW.length], contribs: [], createdAt: Date.now() });
        save(); render(); toast(g ? 'Goal saved.' : 'Goal created.'); return true;
      },
      onDelete: g ? () => { data.goals = data.goals.filter(x => x.id !== g.id); save(); render(); toast('Goal deleted.'); } : null,
    });
  }
  function contribForm(g, sign) {
    openForm({
      title: sign > 0 ? `Add to ${g.name}` : `Take out of ${g.name}`,
      fields: [{ id: 'cAmt', label: 'Amount', money: true, required: true }, { id: 'cDate', label: 'Date', type: 'date', value: todayISO() }],
      submit: sign > 0 ? 'Add' : 'Take out',
      onSubmit: v => {
        const a = parseAmount(v.cAmt); if (a == null) { toast('Enter an amount greater than zero.', 'warn'); return false; }
        const before = goalSaved(g);
        g.contribs = g.contribs || []; g.contribs.push({ id: uid(), date: v.cDate || todayISO(), amountCents: sign * a });
        save(); render(); buzz();
        if (sign > 0 && before < g.targetCents && before + a >= g.targetCents) toast(`You reached ${g.name}. Nice work.`);
        else toast(sign > 0 ? `${money(a)} added to ${g.name}.` : `${money(a)} taken out of ${g.name}.`);
        return true;
      },
    });
  }

  /* ---------- More ---------- */
  function currencySelect(id) {
    const s = el('select', { id }, CURRENCIES.map(([v, n]) => el('option', { value: v, text: `${v} · ${n}` })));
    s.value = data.currency; return s;
  }
  function viewMore() {
    const box = el('div', { class: 'stack' });
    if (!isStandalone()) box.append(el('div', { class: 'panel' }, el('h2', { text: 'Install the app' }),
      el('p', { class: 'hint', text: 'Adds Ledger to your home screen with its own icon. It opens full screen and works without internet.' }),
      el('div', {}, el('button', { class: 'btn primary', text: 'Install Ledger', onclick: promptInstall }))));
    const th = getTheme();
    box.append(el('div', { class: 'panel' }, el('h2', { text: 'Appearance' }),
      el('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' }, [['system', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']].map(([k, label]) =>
        el('button', { type: 'button', 'aria-pressed': String(th === k), text: label, onclick: () => { applyTheme(k); render(); } }))),
      el('p', { class: 'hint', text: th === 'system' ? `Following your phone's setting (currently ${darkMQ.matches ? 'dark' : 'light'}).` : `Always ${th}. The sun/moon button at the top switches quickly.` })));
    box.append(viewAccounts(), viewRecurring());
    // security
    box.append(el('div', { class: 'panel' }, el('h2', { text: 'PIN lock' }),
      el('p', { class: 'hint', text: data.pin ? 'Ledger asks for your PIN when it opens and after a minute in the background.' : 'Lock the app with a 4 to 6 digit PIN so nobody who picks up your phone can open it.' }),
      el('div', { class: 'acts', style: 'justify-content:flex-start' },
        el('button', { class: 'btn primary small', text: data.pin ? 'Change PIN' : 'Set a PIN', onclick: () => startPinSetup() }),
        data.pin ? el('button', { class: 'btn small', text: 'Lock now', onclick: () => showLock('unlock') }) : null,
        data.pin ? el('button', { class: 'btn danger small', text: 'Remove PIN', onclick: async () => { if (await ask({ title: 'Remove the PIN?', body: 'Anyone with your phone will be able to open Ledger.', ok: 'Remove', danger: true })) { data.pin = null; save(); render(); toast('PIN removed.'); } } }) : null)));
    // data
    const cur = currencySelect('currency');
    cur.onchange = () => { data.currency = cur.value; save(); render(); };
    box.append(el('div', { class: 'panel' }, el('h2', { text: 'Data & backup' }),
      el('div', { class: 'field', style: 'max-width:320px' }, el('label', { class: 'label', for: 'currency', text: 'Currency' }), cur),
      el('p', { class: 'hint', text: `Your ${data.txs.length} transactions are stored only on this device. ${data.lastBackup ? `Last backup: ${new Date(data.lastBackup).toLocaleDateString()}.` : 'No backup yet.'}` }),
      el('div', { class: 'acts', style: 'justify-content:flex-start' },
        el('button', { class: 'btn primary small', text: 'Back up (file)', onclick: exportJSON }),
        el('button', { class: 'btn small', text: 'Restore or import', onclick: pickFile }),
        el('button', { class: 'btn small', text: 'Export CSV', onclick: exportCSV })),
      el('p', { class: 'hint', text: 'Restore accepts a Ledger backup file. Import accepts the CSV exported from the claude.ai version or this app.' }),
      el('div', {}, el('button', { class: 'btn danger small', text: 'Erase everything on this device', onclick: async () => {
        if (await ask({ title: 'Erase all data?', body: 'This deletes every transaction, budget, goal and account on this phone. Back up first if you might need it.', ok: 'Erase everything', danger: true })) { data = fresh(); data.onboarded = false; save(); ui.tab = 'trans'; render(); toast('All data erased.'); }
      } }))));
    box.append(el('p', { class: 'hint', style: 'text-align:center', text: 'Spending Ledger · works offline · your data never leaves this device' }));
    return box;
  }

  function viewAccounts() {
    let assets = 0, liab = 0;
    const bals = new Map(data.accounts.map(a => { const b = balanceOf(a); if (b >= 0) assets += b; else liab += b; return [a.id, b]; }));
    const body = el('div', { class: 'panel' }, el('div', { class: 'panel-head' }, el('h2', { text: 'Accounts' }), el('button', { class: 'linkbtn', text: '+ Add', onclick: () => { ui.editAccount = 'new'; render(); focusFirst(); } })),
      el('div', { class: 'figs3' },
        el('div', {}, el('span', { class: 'label', text: 'Assets' }), el('span', { class: 'big num inc', text: money(assets) })),
        el('div', {}, el('span', { class: 'label', text: 'Owed' }), el('span', { class: 'big num exp', text: money(Math.abs(liab)) })),
        el('div', {}, el('span', { class: 'label', text: 'Net worth' }), el('span', { class: 'big num', text: money(assets + liab) }))));
    GROUPS.forEach(g => {
      const accs = data.accounts.filter(a => (a.group || 'Other') === g); if (!accs.length) return;
      const grp = el('div', { class: 'acc-group' }, el('h3', {}, el('span', { text: g }), el('span', { class: 'num', text: money(accs.reduce((s, a) => s + bals.get(a.id), 0)) })));
      const rows = el('div', { class: 'row-list' });
      accs.forEach(a => rows.append(ui.editAccount === a.id ? accountEditor(a) : el('div', { class: 'row-item' }, el('span', { class: 'grow', text: a.name }),
        el('span', { class: `num ${bals.get(a.id) < 0 ? 'exp' : 'inc'}`, text: money(bals.get(a.id)) }), el('button', { class: 'icon-btn', text: 'Edit', onclick: () => { ui.editAccount = a.id; render(); focusFirst(); } }))));
      grp.append(rows); body.append(grp);
    });
    if (ui.editAccount === 'new') body.append(accountEditor(null));
    return body;
  }
  function accountEditor(a) {
    const name = el('input', { id: 'aName', maxlength: 40, required: true }); name.value = a ? a.name : '';
    const grp = el('select', { id: 'aGroup' }, GROUPS.map(g => el('option', { value: g, text: g }))); grp.value = a ? a.group || 'Other' : 'Bank account';
    const open = el('input', { id: 'aOpen', class: 'num', inputmode: 'decimal', placeholder: '0.00' }); open.value = a ? ((a.openingCents || 0) / 100).toFixed(2) : '';
    const done = () => { ui.editAccount = null; render(); };
    return el('form', { class: 'edit-grid budget', onsubmit: e => {
      e.preventDefault(); const n = name.value.trim(); if (!n) return;
      const oc = open.value.trim() ? parseAmount(open.value, true) : 0;
      if (oc == null) { toast('Enter the starting balance as a number. Use a minus sign for money owed.', 'warn'); return; }
      if (a) Object.assign(a, { name: n, group: grp.value, openingCents: oc }); else data.accounts.push({ id: uid(), name: n, group: grp.value, openingCents: oc });
      save(); done(); toast(`${n} saved.`);
    } },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'aName', text: 'Account name' }), name),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'aGroup', text: 'Group' }), grp),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'aOpen', text: 'Starting balance' }), open),
      el('div', { class: 'acts' }, el('button', { class: 'btn primary small', type: 'submit', text: 'Save' }), el('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: done }),
        a ? armDelete(el('button', { class: 'btn danger small', type: 'button', text: 'Delete' }), () => { data.accounts = data.accounts.filter(x => x.id !== a.id); save(); done(); toast(`${a.name} deleted. Its transactions are kept.`); }) : null));
  }

  function viewRecurring() {
    const panel = el('div', { class: 'panel' }, el('h2', { text: 'Repeating entries' }));
    if (!data.recurring.length) { panel.append(el('p', { class: 'hint', text: 'Rent, salary, subscriptions. When adding a transaction, set "Repeat" and Ledger adds it for you on each due date.' })); return panel; }
    const rows = el('div', { class: 'row-list' });
    data.recurring.slice().sort((a, b) => a.next.localeCompare(b.next)).forEach(r => {
      const c = r.type === 'income' ? incCat(r.categoryId) : expCat(r.categoryId);
      rows.append(el('div', { class: 'row-item' },
        el('span', { class: 'grow' }, r.note || (r.type === 'transfer' ? 'Transfer' : c ? c.name : 'Entry'), el('div', { class: 'sub', text: `${FREQS[r.freq]} · ${r.paused ? 'Paused' : `next ${niceDate(r.next)}`}` })),
        el('span', { class: `num ${r.type === 'income' ? 'inc' : r.type === 'expense' ? 'exp' : 'xfer'}`, text: money(r.amountCents) }),
        el('button', { class: 'icon-btn', text: 'Edit', onclick: () => recurringForm(r) })));
    });
    panel.append(rows);
    return panel;
  }
  function recurringForm(r) {
    openForm({
      title: 'Repeating entry',
      fields: [
        { id: 'rAmt', label: 'Amount', money: true, value: (r.amountCents / 100).toFixed(2), required: true },
        { id: 'rFreq', label: 'Repeats', type: 'select', options: Object.entries(FREQS), value: r.freq },
        { id: 'rNext', label: 'Next date', type: 'date', value: r.next, required: true },
        { id: 'rNote', label: 'Note', value: r.note || '' },
      ],
      submit: 'Save',
      extra: [{ label: r.paused ? 'Resume' : 'Pause', fn: () => { r.paused = !r.paused; save(); render(); toast(r.paused ? 'Paused. No new entries will be added.' : 'Resumed.'); runRecurring(); render(); } }],
      onSubmit: v => {
        const a = parseAmount(v.rAmt); if (a == null) { toast('Enter an amount greater than zero.', 'warn'); return false; }
        Object.assign(r, { amountCents: a, freq: v.rFreq, next: v.rNext, anchorDay: +v.rNext.slice(8), note: v.rNote.trim() });
        save(); runRecurring(); render(); toast('Repeating entry saved. Past entries were not changed.'); return true;
      },
      onDelete: () => { data.recurring = data.recurring.filter(x => x.id !== r.id); save(); render(); toast('Stopped repeating. Entries already added are kept.'); },
      deleteLabel: 'Stop repeating',
    });
  }

  /* ================= transaction sheet ================= */
  const sheet = { editing: null, type: 'expense' };
  function fillSelect(sel, items, keep) {
    const prev = keep ?? sel.value; sel.replaceChildren();
    items.forEach(([v, t]) => sel.append(el('option', { value: v, text: t })));
    if (items.some(i => i[0] === prev)) sel.value = prev;
  }
  function fillSubs(keep) {
    const c = sheet.type === 'income' ? incCat($('tCat').value) : expCat($('tCat').value);
    const subs = sheet.type === 'transfer' || !c ? [] : c.subs || [];
    $('fSub').hidden = !subs.length;
    fillSelect($('tSub'), [['', 'None']].concat(subs.map(x => [x.id, x.name])), keep);
  }
  function setType(t) {
    sheet.type = t;
    $('typeSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
    $('fCat').hidden = t === 'transfer'; $('fTo').hidden = t !== 'transfer';
    $('tAccLabel').textContent = t === 'transfer' ? 'From account' : 'Account';
    const cats = (t === 'income' ? data.incomeCategories : data.categories).map(c => [c.id, c.name + (t === 'expense' && c.limitCents != null ? ` · limit ${money(c.limitCents)}` : '')]);
    fillSelect($('tCat'), cats.length ? cats : [['', 'No categories yet']]);
    fillSubs();
    const accs = data.accounts.map(a => [a.id, a.name]);
    fillSelect($('tAcc'), [['', 'No account']].concat(accs));
    fillSelect($('tTo'), accs.length ? accs : [['', 'Add accounts first']]);
    if (t === 'transfer' && $('tTo').value === $('tAcc').value && accs.length > 1) $('tTo').value = accs.find(a => a[0] !== $('tAcc').value)[0];
    sheetHint();
  }
  $('typeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setType(b.dataset.t); });
  $('tCat').addEventListener('change', () => fillSubs(''));

  function openTxSheet(tx, presetDate) {
    sheet.editing = tx || null;
    $('sheetTitle').textContent = tx ? 'Edit transaction' : 'New transaction';
    $('tDelete').hidden = !tx; $('tMore').hidden = !!tx; $('fRepeat').hidden = !!tx;
    $('tDelete').classList.remove('armed'); $('tDelete').textContent = 'Delete';
    setType(tx ? tx.type : (lsGet('ledger-last-type') || 'expense'));
    $('tDate').value = tx ? tx.date : presetDate || (ui.month === monthOf(todayISO()) ? todayISO() : `${ui.month}-01`);
    $('tAmount').value = tx ? (tx.amountCents / 100).toFixed(2) : '';
    $('tNote').value = tx ? tx.note || '' : '';
    $('tRepeat').value = '';
    if (tx) { if (tx.categoryId) $('tCat').value = tx.categoryId; fillSubs(tx.subId || ''); $('tAcc').value = tx.accountId || ''; if (tx.toAccountId) $('tTo').value = tx.toAccountId; }
    else { const la = lsGet('ledger-last-acc'); if (la && accOf(la)) $('tAcc').value = la; }
    $('sheet').hidden = false; sheetHint();
    setTimeout(() => $('tAmount').focus(), 60);
  }
  const closeSheet = () => { $('sheet').hidden = true; sheet.editing = null; };
  $('sheetClose').onclick = closeSheet;
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
  $('fab').onclick = () => openTxSheet(null, ui.tab === 'trans' && ui.sub.trans === 'calendar' && ui.calDay ? ui.calDay : null);

  function sheetHint() {
    const h = $('tHint'); h.className = 'hint'; h.textContent = '';
    if (sheet.editing && sheet.editing.recurringId) h.textContent = 'Part of a repeating entry. Changes apply to this one only; manage the schedule under More.';
    if (sheet.type !== 'expense') return;
    const c = expCat($('tCat').value); if (!c || c.limitCents == null) return;
    const m = monthOf($('tDate').value || todayISO());
    const before = spentIn(monthTxs(m), c.id, sheet.editing && sheet.editing.id), after = before + (parseAmount($('tAmount').value) || 0);
    if (after > c.limitCents) { h.className = 'hint over'; h.textContent = `This puts ${c.name} ${money(after - c.limitCents)} over its ${monthName(m)} limit.`; }
    else { h.className = after >= c.limitCents * WARN_AT ? 'hint warn' : 'hint'; h.textContent = `${money(c.limitCents - after)} left in ${c.name} for ${monthName(m)} after this.`; }
  }
  ['tAmount', 'tCat', 'tDate'].forEach(id => $(id).addEventListener('input', sheetHint));

  async function submitSheet(more) {
    const type = sheet.type, amountCents = parseAmount($('tAmount').value);
    if (amountCents == null) { toast('Enter an amount greater than zero, like 12.50.', 'warn'); $('tAmount').focus(); return; }
    const date = $('tDate').value || todayISO(), month = monthOf(date);
    const accountId = $('tAcc').value || null, toAccountId = type === 'transfer' ? $('tTo').value || null : null;
    const categoryId = type === 'transfer' ? null : $('tCat').value || null;
    const subId = type !== 'transfer' && !$('fSub').hidden ? $('tSub').value || null : null;
    if (type === 'transfer' && (!accountId || !toAccountId)) { toast('Pick both accounts for a transfer.', 'warn'); return; }
    if (type === 'transfer' && accountId === toAccountId) { toast('Choose two different accounts for a transfer.', 'warn'); return; }
    const ed = sheet.editing, freq = ed ? '' : $('tRepeat').value;
    const tx = { ...(ed || {}), id: ed ? ed.id : uid(), type, amountCents, date, month, note: $('tNote').value.trim(), categoryId, subId, accountId, toAccountId, createdAt: ed ? ed.createdAt || Date.now() : Date.now() };
    const c = type === 'expense' ? expCat(categoryId) : null;
    const before = c ? spentIn(monthTxs(month), c.id, tx.id) : 0, after = before + amountCents;
    if (c && c.limitCents != null && after > c.limitCents) {
      const ok = await ask({ title: `This will put ${c.name} over budget`, body: `Your ${c.name} limit for ${monthName(month)} is ${money(c.limitCents)}. This expense takes you past it.`, danger: true, ok: 'Add anyway', cancel: "Don't add it",
        facts: [['Already spent', money(before)], ['This expense', money(amountCents)], ['Monthly limit', money(c.limitCents)], ['Over by', money(after - c.limitCents), true]] });
      if (!ok) { toast('Not saved. Change the amount or category, or close the form.'); return; }
    }
    if (freq) {
      const r = { id: uid(), type, amountCents, categoryId, subId, accountId, toAccountId, note: tx.note, freq, anchorDay: +date.slice(8), next: nextDate(date, freq, +date.slice(8)), paused: false };
      data.recurring.push(r); tx.recurringId = r.id;
    }
    const i = data.txs.findIndex(t => t.id === tx.id);
    if (i >= 0) data.txs[i] = tx; else data.txs.push(tx);
    save(); buzz();
    lsSet('ledger-last-type', type); if (accountId) lsSet('ledger-last-acc', accountId);
    const caught = freq ? runRecurring(true) : 0;
    if (c && c.limitCents != null && after > c.limitCents) toast(`Saved. ${c.name} is now ${money(after - c.limitCents)} over budget.`, 'over');
    else if (c && c.limitCents != null && after >= c.limitCents * WARN_AT && before < c.limitCents * WARN_AT) toast(`Heads up: ${c.name} is at ${Math.round(after / c.limitCents * 100)}% of its budget.`, 'warn');
    else {
      const where = month !== ui.month ? ` to ${monthName(month)}` : '';
      toast(ed ? `Transaction updated${where}.` : freq ? `Saved${where}. Repeats ${FREQS[freq].toLowerCase()}${caught ? `; ${caught} past ${caught === 1 ? 'entry' : 'entries'} filled in` : ''}.` : `Saved ${money(amountCents)} ${type}${where}.`);
    }
    if (more) { $('tAmount').value = ''; $('tNote').value = ''; $('tRepeat').value = ''; $('tAmount').focus(); sheetHint(); }
    else closeSheet();
    render();
  }
  $('sheetForm').addEventListener('submit', e => { e.preventDefault(); submitSheet(false); });
  $('tMore').onclick = () => submitSheet(true);
  armDelete($('tDelete'), () => { const id = sheet.editing.id; data.txs = data.txs.filter(t => t.id !== id); save(); closeSheet(); render(); toast('Transaction deleted.'); });

  /* ================= generic form sheet ================= */
  let formCfg = null;
  function openForm(cfg) {
    formCfg = cfg;
    $('genTitle').textContent = cfg.title;
    const body = $('genBody'); body.replaceChildren();
    cfg.fields.forEach(f => {
      let input;
      if (f.type === 'select') { input = el('select', { id: f.id }, f.options.map(([v, t]) => el('option', { value: v, text: t }))); input.value = f.value; }
      else { input = el('input', { id: f.id, type: f.type || 'text', inputmode: f.money ? 'decimal' : null, class: f.money ? 'num' : null, placeholder: f.placeholder || (f.money ? '0.00' : null), required: f.required || null, maxlength: f.money ? null : 80 }); input.value = f.value || ''; }
      body.append(el('div', { class: 'field' }, el('label', { class: 'label', for: f.id, text: f.label }), input));
    });
    const acts = $('genActs'); acts.replaceChildren();
    if (cfg.onDelete) acts.append(armDelete(el('button', { type: 'button', class: 'btn danger', text: cfg.deleteLabel || 'Delete' }), () => { closeForm(); cfg.onDelete(); }));
    (cfg.extra || []).forEach(x => acts.append(el('button', { type: 'button', class: 'btn', text: x.label, onclick: () => { closeForm(); x.fn(); } })));
    acts.append(el('span', { class: 'spacer' }), el('button', { type: 'submit', class: 'btn primary', text: cfg.submit || 'Save' }));
    $('formSheet').hidden = false;
    setTimeout(() => { const i = body.querySelector('input'); if (i) i.focus(); }, 60);
  }
  const closeForm = () => { $('formSheet').hidden = true; formCfg = null; };
  function openInfo(title, nodes) {
    formCfg = null; $('genTitle').textContent = title;
    $('genBody').replaceChildren(...nodes);
    $('genActs').replaceChildren(el('button', { type: 'button', class: 'btn primary', text: 'Done', onclick: closeForm }));
    $('formSheet').hidden = false;
  }
  $('genClose').onclick = closeForm;
  $('formSheet').addEventListener('click', e => { if (e.target === $('formSheet')) closeForm(); });
  $('genForm').addEventListener('submit', e => {
    e.preventDefault(); if (!formCfg) return;
    const v = {}; formCfg.fields.forEach(f => { v[f.id] = $(f.id).value; });
    if (formCfg.onSubmit(v) !== false) closeForm();
  });

  /* ================= confirm + toast ================= */
  function ask({ title, body, facts, ok = 'OK', cancel = 'Cancel', danger }) {
    return new Promise(resolve => {
      $('mTitle').textContent = title; $('mBody').textContent = body || '';
      document.querySelector('#confirm .modal').classList.toggle('danger', !!danger);
      const f = $('mFacts'); f.replaceChildren();
      (facts || []).forEach(([k, v, tot]) => f.append(el('span', { class: tot ? 'tot' : '', text: k }), el('span', { class: `num${tot ? ' tot' : ''}`, text: v })));
      $('mConfirm').textContent = ok; $('mCancel').textContent = cancel;
      $('confirm').hidden = false; $('mCancel').focus();
      const done = v => { $('confirm').hidden = true; document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', onKey);
      $('mCancel').onclick = () => done(false); $('mConfirm').onclick = () => done(true);
    });
  }
  function toast(msg, kind = '', action, ms) {
    const t = el('div', { class: `toast ${kind}`, role: 'status' }, el('span', { text: msg }), action ? el('button', { text: action.label, onclick: () => { t.remove(); action.fn(); } }) : null);
    const box = $('toasts'); box.append(t);
    while (box.children.length > 2) box.firstElementChild.remove();
    setTimeout(() => t.remove(), ms || (kind === 'over' ? 6000 : 3200));
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !$('confirm').hidden) return;
    if (!$('formSheet').hidden) closeForm(); else if (!$('sheet').hidden) closeSheet();
  });

  /* ================= backup / import ================= */
  async function saveFile(name, text, type) {
    const blob = new Blob([text], { type });
    try {
      const file = new File([blob], name, { type });
      if (/android|iphone|ipad|ipod/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name }); return true;
      }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return true;
  }
  async function exportJSON() {
    const { pin, ...rest } = data;
    if (await saveFile(`ledger-backup-${todayISO()}.json`, JSON.stringify({ app: 'spending-ledger', ...rest }, null, 1), 'application/json')) {
      data.lastBackup = Date.now(); save(); render(); toast('Backup saved. Keep the file somewhere safe, like Google Drive or iCloud.');
    }
  }
  async function exportCSV() {
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Type', 'Category', 'Subcategory', 'Account', 'To account', 'Amount', 'Currency', 'Note']];
    data.txs.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
      const c = catOf(t), a = accOf(t.accountId), to = accOf(t.toAccountId);
      rows.push([t.date, t.type, t.type === 'transfer' ? '' : c ? c.name : 'Uncategorised', (subOf(t) || {}).name || '', a ? a.name : '', to ? to.name : '', (t.amountCents / 100).toFixed(2), data.currency, t.note || '']);
    });
    if (await saveFile(`ledger-${todayISO()}.csv`, rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv')) toast('CSV exported.');
  }
  const pickFile = () => { $('fileIn').value = ''; $('fileIn').click(); };
  $('fileIn').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const text = await f.text();
    try {
      if (/^\s*[{[]/.test(text)) await restoreJSON(JSON.parse(text)); else await importCSV(text);
    } catch (err) { toast(`That file couldn't be read (${err.message}).`, 'over'); }
  });
  async function restoreJSON(obj) {
    if (!obj || !Array.isArray(obj.txs)) throw new Error('not a Ledger backup');
    if (!(await ask({ title: 'Restore this backup?', body: `It has ${obj.txs.length} transactions, ${(obj.goals || []).length} goals and ${(obj.categories || []).length} categories. Everything currently on this phone will be replaced.`, ok: 'Replace and restore', danger: true }))) return;
    const pin = data.pin; delete obj.app;
    data = normalize(obj); data.pin = pin; data.onboarded = true; save(); runRecurring(true); ui.tab = 'trans'; render(); toast('Backup restored.');
  }
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  async function importCSV(text) {
    const rows = parseCSV(text); if (rows.length < 2) throw new Error('no rows found');
    const h = rows[0].map(x => x.trim().toLowerCase()), col = n => h.indexOf(n);
    const iDate = col('date'), iType = col('type'), iCat = col('category'), iSub = col('subcategory'), iAcc = col('account'), iTo = col('to account'), iAmt = col('amount'), iCur = col('currency'), iNote = col('note');
    if (iDate < 0 || iAmt < 0) throw new Error('needs Date and Amount columns');
    const body = rows.slice(1);
    if (!(await ask({ title: `Import ${body.length} transactions?`, body: 'They are added to what is already here. Missing categories and accounts are created by name.', ok: 'Import' }))) return;
    const findOrMake = (list, name, mk) => { if (!name) return null; let x = list.find(c => c.name.toLowerCase() === name.toLowerCase()); if (!x) { x = mk(name); list.push(x); } return x; };
    let n = 0;
    body.forEach(r => {
      const date = (r[iDate] || '').trim(); const amt = parseAmount(r[iAmt]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || amt == null) return;
      let type = (iType >= 0 ? r[iType] : 'expense').trim().toLowerCase(); if (!['income', 'expense', 'transfer'].includes(type)) type = 'expense';
      const list = type === 'income' ? data.incomeCategories : data.categories;
      const catName = iCat >= 0 ? r[iCat].trim() : '';
      const cat = type === 'transfer' || !catName || catName === 'Uncategorised' ? null : findOrMake(list, catName, nm => ({ id: uid(), name: nm, limitCents: null, color: SW[list.length % SW.length], subs: [] }));
      const subName = iSub >= 0 ? (r[iSub] || '').trim() : '';
      const sub = cat && subName ? findOrMake(cat.subs = cat.subs || [], subName, nm => ({ id: uid(), name: nm })) : null;
      const mkAcc = nm => ({ id: uid(), name: nm, group: 'Other', openingCents: 0 });
      const acc = iAcc >= 0 ? findOrMake(data.accounts, (r[iAcc] || '').trim(), mkAcc) : null;
      const to = iTo >= 0 ? findOrMake(data.accounts, (r[iTo] || '').trim(), mkAcc) : null;
      data.txs.push({ id: uid(), type, amountCents: amt, date, month: monthOf(date), note: iNote >= 0 ? (r[iNote] || '').trim() : '', categoryId: cat ? cat.id : null, subId: sub ? sub.id : null, accountId: acc ? acc.id : null, toAccountId: type === 'transfer' && to ? to.id : null, createdAt: Date.now() + n });
      n++;
    });
    if (iCur >= 0 && body[0] && body[0][iCur] && CURRENCIES.some(c => c[0] === body[0][iCur].trim())) data.currency = body[0][iCur].trim();
    data.onboarded = true; save(); ui.tab = 'trans'; render(); toast(`Imported ${n} transactions.`);
  }

  /* ================= PIN lock ================= */
  const lock = { mode: 'unlock', entry: '', first: '', fails: 0, until: 0, len: 4 };
  async function hashPin(pin, salt) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function drawDots() {
    const d = $('pinDots'); d.replaceChildren();
    const n = lock.mode === 'unlock' ? data.pin.len : Math.max(4, lock.entry.length);
    for (let i = 0; i < n; i++) d.append(el('i', { class: i < lock.entry.length ? 'on' : '' }));
  }
  function buildPad() {
    const p = $('pad'); p.replaceChildren();
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', lock.mode === 'unlock' ? '' : 'Cancel', '0', '⌫'].forEach(k => {
      const ghost = k === '' || k === 'Cancel' || k === '⌫';
      p.append(el('button', { type: 'button', class: ghost ? 'ghost' : '', text: k, 'aria-label': k === '⌫' ? 'Delete digit' : k || null, disabled: k === '' || null, onclick: () => pinKey(k) }));
    });
    if (lock.mode !== 'unlock') p.append(el('span'), el('button', { type: 'button', class: 'ghost', text: 'Done', onclick: () => pinKey('done') }), el('span'));
    $('forgot').hidden = lock.mode !== 'unlock';
  }
  function showLock(mode) {
    lock.mode = mode; lock.entry = ''; $('lock').hidden = false;
    $('lockTitle').textContent = mode === 'unlock' ? 'Enter your PIN' : mode === 'set1' ? 'Choose a 4 to 6 digit PIN' : 'Enter the same PIN again';
    $('lockMsg').textContent = mode === 'set1' ? 'Tap Done when finished.' : ' ';
    buildPad(); drawDots();
  }
  const startPinSetup = () => showLock('set1');
  async function pinKey(k) {
    if (k === 'Cancel') { $('lock').hidden = true; return; }
    if (k === '⌫') { lock.entry = lock.entry.slice(0, -1); drawDots(); return; }
    if (k === 'done') return finishSet();
    if (!/^\d$/.test(k)) return;
    if (lock.mode === 'unlock' && Date.now() < lock.until) { $('lockMsg').textContent = `Too many tries. Wait ${Math.ceil((lock.until - Date.now()) / 1000)} seconds.`; return; }
    if (lock.entry.length >= 6) return;
    lock.entry += k; drawDots();
    if (lock.mode === 'unlock' && lock.entry.length === data.pin.len) {
      if (await hashPin(lock.entry, data.pin.salt) === data.pin.hash) { lock.fails = 0; $('lock').hidden = true; lock.entry = ''; return; }
      lock.fails++; lock.entry = '';
      if (lock.fails >= 5) { lock.until = Date.now() + 30000; lock.fails = 0; }
      const d = $('pinDots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
      $('lockMsg').textContent = Date.now() < lock.until ? 'Too many tries. Wait 30 seconds.' : 'Wrong PIN. Try again.'; buzz(); drawDots();
    }
    if (lock.mode === 'set2' && lock.entry.length === lock.first.length) finishSet();
  }
  async function finishSet() {
    if (lock.entry.length < 4) { $('lockMsg').textContent = 'Use at least 4 digits.'; return; }
    if (lock.mode === 'set1') { lock.first = lock.entry; showLock('set2'); $('lockMsg').textContent = ' '; return; }
    if (lock.entry !== lock.first) { lock.first = ''; showLock('set1'); $('lockMsg').textContent = "Those didn't match. Start again."; return; }
    const salt = uid(); data.pin = { salt, len: lock.entry.length, hash: await hashPin(lock.entry, salt) };
    save(); $('lock').hidden = true; render(); toast('PIN set. Ledger locks after a minute in the background.');
  }
  $('forgot').onclick = async () => {
    if (await ask({ title: 'Forgot your PIN?', body: 'The only way in without the PIN is to erase all data on this phone. You can restore it afterwards from a backup file.', ok: 'Erase and reset', danger: true })) {
      data = fresh(); save(); $('lock').hidden = true; ui.tab = 'trans'; render(); toast('Ledger was reset. Use More → Restore to bring back a backup.');
    }
  };
  document.addEventListener('keydown', e => { if ($('lock').hidden) return; if (/^\d$/.test(e.key)) pinKey(e.key); else if (e.key === 'Backspace') pinKey('⌫'); else if (e.key === 'Enter' && lock.mode !== 'unlock') pinKey('done'); });
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (data.pin && hiddenAt && Date.now() - hiddenAt > 60000 && $('lock').hidden) showLock('unlock');
    runRecurring();
    if (!editingInline() && $('sheet').hidden && $('formSheet').hidden) render();
  });

  /* ================= navigation, install, offline ================= */
  $('bottomNav').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    ui.tab = b.dataset.tab; ui.editBudget = ui.editIncome = ui.editAccount = null;
    try { history.replaceState(null, '', '#' + ui.tab); } catch {}
    render(); window.scrollTo({ top: 0 });
  });
  const step = by => { const yearView = ui.tab === 'trans' && ui.sub.trans === 'monthly'; ui.month = shiftMonth(ui.month, yearView ? by * 12 : by); ui.calDay = null; ui.statsCat = null; render(); };
  $('prev').onclick = () => step(-1); $('next').onclick = () => step(1);

  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; render(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; toast('Ledger is on your home screen.'); render(); });
  async function promptInstall() {
    if (!deferredPrompt) { installHelp(); return; }
    const p = deferredPrompt; deferredPrompt = null;
    try { p.prompt(); const r = await p.userChoice; if (r && r.outcome === 'dismissed') toast('Install cancelled. Tap Install app again any time.'); } catch { installHelp(); }
    render();
  }
  const kbd = (label, svg) => el('span', { class: 'kbd' }, svg ? svgEl(svg) : null, label);
  const SHARE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  function installHelp() {
    const url = location.href.split('#')[0];
    const li = (...k) => el('li', {}, ...k);
    const steps = {
      inapp: [li("You're viewing Ledger inside another app (like WhatsApp or Instagram), and those can't install apps."),
        isIOS ? li('Tap ', kbd('···'), ' or the compass icon, then ', el('b', { text: 'Open in Safari' }), '.') : li('Tap ', kbd('⋮'), ' at the top right, then ', el('b', { text: 'Open in Chrome' }), ' (or "Open in browser").'),
        li('Then tap ', el('b', { text: 'Install app' }), ' again there. Or copy the link below and paste it into ', isIOS ? 'Safari' : 'Chrome', '.')],
      'ios-safari': [li('Tap the Share button ', kbd('', SHARE_SVG), ' at the bottom of Safari (top right on iPad).'), li('Scroll down and tap ', el('b', { text: 'Add to Home Screen' }), '.'), li('Tap ', el('b', { text: 'Add' }), '. Open Ledger from its new icon.')],
      'ios-other': [li('On iPhone, the most reliable way to install is from ', el('b', { text: 'Safari' }), '. Copy the link below, open Safari and paste it.'), li('In Safari tap Share ', kbd('', SHARE_SVG), ' → ', el('b', { text: 'Add to Home Screen' }), ' → ', el('b', { text: 'Add' }), '.'), li('On iOS 16.4 or later you can also tap Share ', kbd('', SHARE_SVG), ' in this browser\'s address bar and choose Add to Home Screen.')],
      'android-chrome': [li('Tap ', kbd('⋮'), ' at the top right of Chrome.'), li('Tap ', el('b', { text: 'Install app' }), ' or ', el('b', { text: 'Add to Home screen' }), ', then ', el('b', { text: 'Install' }), '.'), li('If you opened the link from WhatsApp, Gmail or another app, first tap ', kbd('⋮'), ' → ', el('b', { text: 'Open in Chrome' }), '. Installing only works in Chrome itself.')],
      samsung: [li('Tap the menu ', kbd('≡'), ' at the bottom right.'), li('Tap ', el('b', { text: 'Add page to' }), ' → ', el('b', { text: 'Home screen' }), '.'), li('Or tap the install icon in the address bar if you see one.')],
      'firefox-android': [li('Tap ', kbd('⋮'), ' in Firefox.'), li('Tap ', el('b', { text: 'Install' }), ' or ', el('b', { text: 'Add to Home screen' }), '.')],
      desktop: [li('In Chrome or Edge, click the install icon at the right of the address bar, or the menu → ', el('b', { text: 'Install Ledger' }), '.'), li('To put it on your phone, open the link below on the phone.')],
    }[browserEnv];
    const link = el('input', { readonly: true, value: url, 'aria-label': 'App link' });
    const copy = el('button', { class: 'btn small', type: 'button', text: 'Copy link', onclick: async () => {
      try { await navigator.clipboard.writeText(url); toast('Link copied.'); }
      catch { link.select(); try { document.execCommand('copy'); toast('Link copied.'); } catch { toast('Select the link and copy it.'); } }
    } });
    openInfo('Install Ledger', [el('ol', { class: 'steps' }, steps), el('div', { class: 'field' }, el('span', { class: 'label', text: 'App link' }), el('div', { class: 'linkbox' }, link, copy))]);
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    let wantReload = false;
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version of Ledger is ready.', '', { label: 'Update', fn: () => { wantReload = true; nw.postMessage('skip-waiting'); } }, 20000);
        });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload) location.reload(); });
  }

  /* ================= boot ================= */
  const h = location.hash.slice(1); if (TITLES[h]) ui.tab = h;
  runRecurring(true);
  themeUI();
  render();
  if (data.pin) showLock('unlock');
})();
