'use strict';
(() => {
  /* ================= utilities ================= */
  const $ = id => document.getElementById(id);
  const WARN_AT = 0.8;
  const KEY = 'spending-ledger-app-v1';
  const APP_VERSION = '10';
  const SNAP_KEY = 'spending-ledger-safety-copy';
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
    if (d.carryOver === undefined) d.carryOver = true;
    if (d.rollover === undefined) d.rollover = true;
    // Limits set before rollover existed count from last month, so last month's unspent budget carries in.
    d.categories.forEach(c => { if (c.limitCents != null && !c.limitSince) c.limitSince = shiftMonth(monthOf(todayISO()), -1); });
    return d;
  }
  let data;
  try { data = normalize(JSON.parse(lsGet(KEY)) || fresh()); } catch { data = fresh(); }
  // Before a new version runs for the first time, keep a safety copy of the data it found.
  let justUpdated = false, pendingWhatsNew = false;
  if (data.appVersion !== APP_VERSION) {
    const raw = lsGet(KEY);
    if (raw && data.onboarded) { lsSet(SNAP_KEY, JSON.stringify({ from: data.appVersion || '3 or earlier', at: Date.now(), raw })); justUpdated = true; }
    data.appVersion = APP_VERSION;
    lsSet(KEY, JSON.stringify(data));
  }
  let persistAsked = false;
  const memo = new Map();
  let afterSave = null;
  function save(quiet) {
    memo.clear();
    if (!quiet && data.cloud) data.cloud.dirty = true;
    if (!lsSet(KEY, JSON.stringify(data))) toast("Couldn't save on this device. Storage may be full or blocked.", 'over');
    if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
    if (afterSave) afterSave(quiet);
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
  /* ---------- month to month ---------- */
  const memoGet = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
  // Money brought into month m: what was left (income minus spending) at the end of every earlier month.
  function carryIn(m) {
    if (data.carryOver === false) return 0;
    return memoGet(`carry|${m}`, () => data.txs.reduce((s, t) => t.month >= m ? s : s + (t.type === 'income' ? t.amountCents : t.type === 'expense' ? -t.amountCents : 0), 0));
  }
  // A category's limit in month m: its monthly limit plus whatever it left unspent the month before.
  function limitFor(c, m) {
    if (!c || c.limitCents == null) return null;
    if (data.rollover === false || !c.limitSince || m <= c.limitSince) return c.limitCents;
    return memoGet(`lim|${c.id}|${m}`, () => { const p = shiftMonth(m, -1); return c.limitCents + Math.max(0, limitFor(c, p) - spentIn(monthTxs(p), c.id)); });
  }
  const rolledIn = (c, m) => { const l = limitFor(c, m); return l == null ? 0 : l - c.limitCents; };
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
    const heroOn = ui.tab === 'trans' && sub !== 'monthly';
    $('period').hidden = !((ui.tab === 'trans' && !heroOn) || (ui.tab === 'stats' && sub === 'categories'));
    const list = yearView ? data.txs.filter(t => t.month.startsWith(ui.month.slice(0, 4))) : monthTxs();
    const t = totals(list);
    $('pInc').dataset.cents = t.inc; $('pExp').dataset.cents = t.exp; $('pTot').dataset.cents = t.tot;
    countUp($('period'));
    renderHero(heroOn);
    $('fab').hidden = ui.tab === 'more';
    $('fab').classList.toggle('pulse', !data.txs.length && data.onboarded);
    renderAlerts(); renderBanner();
    const view = ui.tab === 'trans' ? { daily: viewDaily, calendar: viewCalendar, monthly: viewMonthly }[sub]()
      : ui.tab === 'stats' ? (sub === 'insights' ? viewInsights() : viewStats())
      : ui.tab === 'budget' ? viewBudget() : ui.tab === 'goals' ? viewGoals() : viewMore();
    const main = $('main'); main.replaceChildren(view);
    const key = `${ui.tab}:${sub || ''}:${ui.month}`;
    if (key !== lastViewKey) {
      lastViewKey = key;
      main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
      [...(view.classList.contains('stack') ? view.children : [view])].slice(0, 12).forEach((c, i) => c.style.setProperty('--i', i));
    }
  }
  let lastViewKey = '';

  /* ---------- lively bits: counting numbers, summary card, bursts ---------- */
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const shown = new Map();
  function countUp(root) {
    root.querySelectorAll('[data-cents]').forEach(node => {
      const key = node.id || node.dataset.k, to = +node.dataset.cents, from = shown.has(key) ? shown.get(key) : 0;
      shown.set(key, to);
      node.classList.toggle('neg', node.dataset.signed === '1' && to < 0);
      if (reduceMotion.matches || from === to) { node.textContent = money(to); return; }
      const t0 = performance.now(), dur = 650;
      const tick = now => {
        const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        node.textContent = money(Math.round(from + (to - from) * e));
        if (p < 1 && node.isConnected) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  function renderHero(show) {
    const h = $('hero'); h.hidden = !show; if (!show) return;
    const mt = monthTxs(), t = totals(mt), isCur = ui.month === monthOf(todayISO()), carry = carryIn(ui.month);
    const capped = data.categories.filter(c => c.limitCents != null);
    const budget = capped.reduce((s, c) => s + limitFor(c, ui.month), 0), used = capped.reduce((s, c) => s + spentIn(mt, c.id), 0);
    const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const today = data.txs.reduce((s, x) => s + (x.type === 'expense' && x.date === todayISO() ? x.amountCents : 0), 0);
    const pct = budget ? Math.min(100, used / budget * 100) : null;
    const prevName = monthName(shiftMonth(ui.month, -1), { month: 'short' });
    h.replaceChildren(...[
      el('div', { class: 'hero-top' }, el('span', { class: 'hero-greet', text: isCur ? greet : monthName(ui.month) }), isCur ? el('span', { class: 'hero-chip num', text: `Today ${money(today)}` }) : null),
      el('div', { class: 'hero-label', text: data.carryOver === false ? 'Net this month' : 'Money left this month' }),
      el('div', { class: 'hero-big num', 'data-k': 'heroBig', 'data-cents': carry + t.tot, 'data-signed': '1' }),
      el('div', { class: 'hero-row' },
        carry ? el('span', {}, el('i', { class: 'arrow', text: '↪' }), `From ${prevName} `, el('b', { class: 'num', 'data-k': 'heroCarry', 'data-cents': carry })) : null,
        el('span', {}, el('i', { class: 'arrow', text: '↑' }), 'In ', el('b', { class: 'num', 'data-k': 'heroInc', 'data-cents': t.inc })),
        el('span', {}, el('i', { class: 'arrow', text: '↓' }), 'Out ', el('b', { class: 'num', 'data-k': 'heroExp', 'data-cents': t.exp }))),
      pct != null ? el('div', { class: 'hero-meter', role: 'img', 'aria-label': `${Math.round(pct)}% of budget used` }, el('i', { class: levelOf(used, budget), style: `width:${pct}%` })) : null,
      el('div', { class: 'hero-foot', text: pct != null ? `${money(budget - used)} of your ${money(budget)} budget left to spend` : 'Set limits in Budget to see how much is left to spend.' })].filter(Boolean));
    countUp(h);
  }
  function burst(type) {
    if (reduceMotion.matches) return;
    const b = el('div', { class: `burst ${type}`, 'aria-hidden': 'true' }, svgEl('<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>'));
    document.body.append(b); setTimeout(() => b.remove(), 900);
  }
  function confetti() {
    if (reduceMotion.matches) return;
    const box = el('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 36; i++) box.append(el('i', { style: `left:${Math.random() * 100}%;background:var(${SW[i % SW.length]});animation-delay:${Math.random() * .4}s;animation-duration:${1.1 + Math.random() * .9}s;transform:rotate(${Math.random() * 360}deg)` }));
    document.body.append(box); setTimeout(() => box.remove(), 2600);
  }

  function renderAlerts() {
    const box = $('alerts'); box.replaceChildren();
    if (!['trans', 'budget'].includes(ui.tab)) return;
    const mt = monthTxs();
    data.categories.forEach(c => {
      const lim = limitFor(c, ui.month); if (lim == null) return;
      const spent = spentIn(mt, c.id), lvl = levelOf(spent, lim);
      if (lvl !== 'over' && lvl !== 'warn') return;
      box.append(el('div', { class: `alert ${lvl}`, role: 'status' },
        el('span', { class: 'sign', text: lvl === 'over' ? '!' : '≈' }),
        el('div', {}, el('strong', { text: lvl === 'over' ? `${c.name} is over budget by ${money(spent - lim)}` : `${c.name} is at ${Math.round(spent / lim * 100)}% of its budget` }),
          el('span', { class: 'hint', text: `${money(spent)} of ${money(lim)} in ${monthName(ui.month)}` }))));
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
          el('button', { class: 'btn small', text: 'Import CSV', onclick: () => { data.currency = cur.value; data.onboarded = true; save(); pickFile(); } }),
          cloudOn() ? el('button', { class: 'btn small', text: 'Restore from Google', onclick: () => { data.currency = cur.value; connectGoogle('restore'); } }) : null))));
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
    let laterBk = false; try { laterBk = !!sessionStorage.getItem('ledger-bk-dismiss'); } catch {}
    const later = el('button', { class: 'icon-btn', text: 'Later', onclick: () => { try { sessionStorage.setItem('ledger-bk-dismiss', '1'); } catch {} render(); } });
    if (cloudOn() && data.cloud) {
      if (data.cloud.dirty && !tokenValid() && !laterBk && (!data.cloud.lastAt || Date.now() - data.cloud.lastAt > 864e5))
        box.append(el('div', { class: 'alert info' }, el('span', { class: 'sign', text: '↑' }), el('div', { class: 'grow' },
          el('strong', { text: 'Back up to Google' }),
          el('span', { class: 'hint', text: `Last backup ${agoText(data.cloud.lastAt)}. One tap saves your changes to ${data.cloud.email || 'your Google account'}.` }),
          el('div', { class: 'acts', style: 'justify-content:flex-start' }, el('button', { class: 'btn primary small', text: 'Back up now', onclick: backupNow }), later))));
      return;
    }
    if (cloudOn() && data.txs.length >= 5 && !lsGet('ledger-cloud-dismissed')) {
      box.append(el('div', { class: 'alert info' }, el('span', { class: 'sign', text: '↑' }), el('div', { class: 'grow' },
        el('strong', { text: 'Keep a backup in your Google account' }),
        el('span', { class: 'hint', text: 'Sign in with Google and Ledger backs up to your Google Drive, like WhatsApp. A new phone can restore everything.' }),
        el('div', { class: 'acts', style: 'justify-content:flex-start' }, el('button', { class: 'btn primary small', text: 'Sign in with Google', onclick: () => connectGoogle('connect') }),
          el('button', { class: 'icon-btn', text: 'Not now', onclick: () => { lsSet('ledger-cloud-dismissed', '1'); render(); } })))));
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
    const color = x.type === 'transfer' ? 'var(--xfer)' : c ? `var(${c.color})` : 'var(--muted)';
    const title = x.note || (sub ? sub.name : catName);
    const line2 = [x.type === 'transfer' ? null : sub ? `${catName} · ${sub.name}` : catName, accText].filter(Boolean).join(' · ');
    return el('button', { class: 'tx', type: 'button', onclick: () => openTxSheet(x) },
      el('span', { class: 'avatar', style: `--c:${color}`, 'aria-hidden': 'true', text: x.type === 'transfer' ? '⇄' : (catName.trim()[0] || '?').toUpperCase() }),
      el('span', { class: 'what' }, el('div', { class: 't1' }, title, x.recurringId ? el('span', { class: 'rep', text: '↻', title: 'Repeats' }) : null, x.receiptId ? svgEl('<svg class="rc-ico" viewBox="0 0 24 24" role="img" aria-label="Receipt photo attached"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l8-8"/></svg>') : null), line2 ? el('div', { class: 'acc', text: line2 }) : null),
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
    const carry = q ? 0 : carryIn(ui.month);
    const carryCard = carry ? el('section', { class: 'day carry' }, el('div', { class: 'carry-row' },
      el('span', { class: 'avatar', style: '--c:var(--accent)', 'aria-hidden': 'true', text: '↪' }),
      el('span', { class: 'what' }, el('div', { class: 't1', text: `Brought forward from ${monthName(shiftMonth(ui.month, -1), { month: 'long' })}` }), el('div', { class: 'acc', text: 'What was left at the end of last month' })),
      el('span', { class: `amt num ${carry < 0 ? 'exp' : 'inc'}`, text: money(carry) }))) : null;
    if (!list.length) {
      if (carryCard) dailyList.append(carryCard);
      dailyList.append(el('div', { class: 'empty-state center' }, q ? null : el('img', { src: 'icons/icon-192.png', alt: '', width: 56, height: 56, class: 'empty-ico' }), el('div', { text: q ? 'Nothing matches that search.' : `No transactions in ${monthName(ui.month)} yet. Tap + to add your first one.` })));
      return;
    }
    groupByDay(list).forEach(([d, l], i) => { const card = dayCard(d, l); card.style.setProperty('--d', Math.min(i, 8)); dailyList.append(card); });
    if (carryCard) { carryCard.style.setProperty('--d', 8); dailyList.append(carryCard); }
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
    const y = ui.month.slice(0, 4), cur = monthOf(todayISO()), tbody = el('tbody'), all = { inc: 0, exp: 0 }, carryCol = data.carryOver !== false;
    const go = key => { ui.month = key; ui.sub.trans = 'daily'; render(); };
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${pad(m)}`, t = totals(monthTxs(key)); all.inc += t.inc; all.exp += t.exp;
      tbody.append(el('tr', { class: `row${key === cur ? ' cur' : ''}`, tabindex: 0, onclick: () => go(key), onkeydown: e => { if (e.key === 'Enter') go(key); } },
        el('td', { text: monthName(key, { month: 'short' }) }), el('td', { class: 'inc', text: t.inc ? money(t.inc) : '–' }), el('td', { class: 'exp', text: t.exp ? money(t.exp) : '–' }), el('td', { text: t.inc || t.exp ? money(t.tot) : '–' }),
        carryCol ? el('td', { class: 'bal', text: key <= cur || t.inc || t.exp ? money(carryIn(shiftMonth(key, 1))) : '–' }) : null));
    }
    return el('div', { class: 'panel' }, el('div', { class: 'scroll-x' }, el('table', { class: 'mtable' },
      el('thead', {}, el('tr', {}, ['Month', 'Income', 'Expenses', 'Total', ...(carryCol ? ['Left at month end'] : [])].map(h => el('th', { text: h })))), tbody,
      el('tfoot', {}, el('tr', {}, el('td', { text: y }), el('td', { class: 'inc', text: money(all.inc) }), el('td', { class: 'exp', text: money(all.exp) }), el('td', { text: money(all.inc - all.exp) }), carryCol ? el('td') : null)))));
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
    const budget = data.categories.reduce((s, c) => s + (limitFor(c, m) || 0), 0);
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
    const budget = capped.reduce((s, c) => s + limitFor(c, ui.month), 0), spent = capped.reduce((s, c) => s + spentIn(mt, c.id), 0);
    const rolled = capped.reduce((s, c) => s + rolledIn(c, ui.month), 0);
    const isCur = ui.month === monthOf(todayISO()), daysLeft = isCur ? daysIn(ui.month) - new Date().getDate() + 1 : 0, left = budget - spent;
    const head = el('div', { class: 'panel' },
      el('div', { class: 'figs3' },
        el('div', {}, el('span', { class: 'label', text: 'Budgeted' }), el('span', { class: 'big num', text: budget ? money(budget) : '–' })),
        el('div', {}, el('span', { class: 'label', text: 'Left' }), el('span', { class: `big num${left < 0 ? ' exp' : ''}`, text: budget ? money(left) : '–' })),
        el('div', {}, el('span', { class: 'label', text: 'Per day' }), el('span', { class: 'big num', text: budget && isCur ? money(Math.max(0, Math.floor(left / daysLeft))) : '–' }))),
      budget ? el('div', { class: 'bar' }, el('i', { class: levelOf(spent, budget), style: `width:${Math.min(100, spent / budget * 100)}%` }))
        : el('div', { class: 'hint', text: 'Tap Edit on a category to give it a monthly limit. You get a warning at 80% and a prompt before anything takes it over.' }),
      rolled ? el('div', { class: 'hint', text: `Includes ${money(rolled)} of unspent budget rolled over from ${monthName(shiftMonth(ui.month, -1), { month: 'long' })}.` }) : null);
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
    const lim = limitFor(c, ui.month), extra = rolledIn(c, ui.month);
    const spent = spentIn(mt, c.id), lvl = levelOf(spent, lim), rest = (lim || 0) - spent;
    return el('div', { class: 'budget' },
      el('div', { class: 'b-row' },
        el('div', { class: 'b-name' }, el('span', { class: 'swatch', style: `background:var(${c.color})` }), el('span', { text: c.name })),
        el('span', { class: `pill ${lvl}`, text: { ok: 'On track', warn: 'Near limit', over: 'Over budget', none: 'No limit' }[lvl] }),
        el('button', { class: 'icon-btn', text: 'Edit', 'aria-label': `Edit ${c.name}`, onclick: () => { ui.editBudget = c.id; render(); focusFirst(); } })),
      subSplit(c, mt),
      el('div', { class: 'b-fig num' }, el('b', { text: money(spent) }), lim == null ? ' spent' : ` of ${money(lim)} · ${rest >= 0 ? money(rest) + ' left' : money(-rest) + ' over'}`),
      extra ? el('div', { class: 'rollover', text: `↪ ${money(c.limitCents)} limit + ${money(extra)} rolled over from ${monthName(shiftMonth(ui.month, -1), { month: 'short' })}` }) : null,
      lim != null ? el('div', { class: 'bar' }, el('i', { class: lvl, style: `width:${Math.min(100, lim ? spent / lim * 100 : 100)}%` })) : null);
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
      const since = lc == null ? null : c && c.limitCents != null && c.limitSince ? c.limitSince : ui.month;
      if (c) Object.assign(c, { name: n, limitCents: lc, limitSince: since, subs: subs.collect() }); else data.categories.push({ id: uid(), name: n, limitCents: lc, limitSince: since, subs: subs.collect(), color: SW[data.categories.length % SW.length] });
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
        if (sign > 0 && before < g.targetCents && before + a >= g.targetCents) { toast(`You reached ${g.name}. Nice work.`); confetti(); }
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
    box.append(el('div', { class: 'panel' }, el('div', { class: 'panel-head' }, el('h2', { text: 'App updates' }), el('span', { class: 'pill ok', text: `v${APP_VERSION}` })),
      el('p', { class: 'hint', text: 'New versions install by themselves when you open Ledger with internet. Your data is never touched by an update.' }),
      el('div', { class: 'acts', style: 'justify-content:flex-start' }, el('button', { class: 'btn small', type: 'button', text: 'Check for updates now', onclick: () => checkForUpdate(true) }),
        el('button', { class: 'btn small', type: 'button', text: "What's new", onclick: whatsNew }))));
    const th = getTheme();
    box.append(el('div', { class: 'panel' }, el('h2', { text: 'Appearance' }),
      el('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' }, [['system', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']].map(([k, label]) =>
        el('button', { type: 'button', 'aria-pressed': String(th === k), text: label, onclick: () => { applyTheme(k); render(); } }))),
      el('p', { class: 'hint', text: th === 'system' ? `Following your phone's setting (currently ${darkMQ.matches ? 'dark' : 'light'}).` : `Always ${th}. The sun/moon button at the top switches quickly.` })));
    const toggle = (label, desc, on, fn) => el('div', { class: 'row-item' }, el('span', { class: 'grow' }, label, el('div', { class: 'sub', text: desc })),
      el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: fn }));
    box.append(el('div', { class: 'panel' }, el('h2', { text: 'Month to month' }), el('div', { class: 'row-list' },
      toggle('Carry money forward', 'What is left at the end of a month (income minus spending) starts the next month.', data.carryOver !== false, () => { data.carryOver = data.carryOver === false; save(); render(); toast(data.carryOver ? 'Leftover money now carries into the next month.' : 'Each month now starts from zero.'); }),
      toggle('Roll over unspent budget', 'Budget a category did not use is added to its limit next month.', data.rollover !== false, () => { data.rollover = data.rollover === false; save(); render(); toast(data.rollover ? 'Unspent budget now rolls over.' : 'Budgets now reset each month.'); }))));
    box.append(viewRecurring());
    // security
    const pinRow = (label, value, btnLabel, fn) => el('div', { class: 'row-item' }, el('span', { class: 'grow' }, label, el('div', { class: 'sub', text: value })), el('button', { class: 'btn small', type: 'button', text: btnLabel, onclick: fn }));
    box.append(el('div', { class: 'panel' }, el('h2', { text: 'PIN lock' }),
      el('p', { class: 'hint', text: data.pin ? 'Ledger asks for your PIN when it opens and after a minute in the background. Changing or removing it needs your current PIN.' : 'Lock the app with a 4 to 6 digit PIN so nobody who picks up your phone can open it.' }),
      el('div', { class: 'acts', style: 'justify-content:flex-start' },
        el('button', { class: 'btn primary small', type: 'button', text: data.pin ? 'Change PIN' : 'Set a PIN', onclick: setOrChangePin }),
        data.pin ? el('button', { class: 'btn small', type: 'button', text: 'Lock now', onclick: () => showLock('unlock') }) : null,
        data.pin ? el('button', { class: 'btn danger small', type: 'button', text: 'Remove PIN', onclick: removePin }) : null),
      data.pin ? el('div', { class: 'row-list' },
        pinRow('Recovery code', data.pin.rec ? `Set up on ${new Date(data.pin.rec.created).toLocaleDateString()}` : 'Not set up. You need it to reset a forgotten PIN.', data.pin.rec ? 'New code' : 'Create', newRecoveryCodeFlow),
        pinRow('Security question', data.pin.q ? data.pin.q.question : 'Optional second way to reset your PIN.', data.pin.q ? 'Change' : 'Add', securityQuestionFlow)) : null));
    const gp = googlePanel(); if (gp) box.append(gp);
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
        if (data.pin && !(await requirePin())) return;
        if (await ask({ title: 'Erase all data?', body: 'This deletes every transaction, budget, goal and account on this phone. Back up first if you might need it.', ok: 'Erase everything', danger: true })) { const cl = data.cloud; data = fresh(); data.onboarded = false; data.cloud = cl; save(); receipts.clear().catch(() => {}); ui.tab = 'trans'; render(); toast('All data erased from this phone.'); }
      } }))));
    box.append(behindTheScenes());
    box.append(el('p', { class: 'hint', style: 'text-align:center', text: `Spending Ledger v${APP_VERSION} · works offline · ${data.cloud ? `backed up to ${data.cloud.email || 'Google'}` : 'your data never leaves this device'}` }));
    box.append(el('p', { class: 'hint', style: 'text-align:center' }, el('a', { href: 'about.html', text: 'About Ledger' }), ' · ', el('a', { href: 'privacy.html', text: 'Privacy policy' })));
    return box;
  }

  const fmtBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  function behindTheScenes() {
    const rows = el('dl', { class: 'kv' });
    const add = (k, v, id) => rows.append(el('dt', { text: k }), el('dd', { id: id || null, text: v }));
    const raw = lsGet(KEY) || '';
    const dates = data.txs.map(t => t.date).sort();
    const subs = [...data.categories, ...data.incomeCategories].reduce((n, c) => n + (c.subs || []).length, 0);
    add('Where your data lives', `This phone's browser storage, under "${KEY}"`);
    add('Size of your data', fmtBytes(new Blob([raw]).size));
    add('Device storage used / available', 'Checking…', 'bsQuota');
    add('Protected from automatic clean-up', 'Checking…', 'bsPersist');
    add('Transactions', `${data.txs.length}${dates.length ? ` (${niceDate(dates[0])} to ${niceDate(dates[dates.length - 1])})` : ''}`);
    add('Categories', `${data.categories.length} expense, ${data.incomeCategories.length} income, ${subs} subcategories`);
    add('Accounts · repeating · goals', `${data.accounts.length} · ${data.recurring.length} · ${data.goals.length}`);
    add('PIN', data.pin ? `On (${data.pin.len} digits, stored only as a salted SHA-256 hash). Recovery: ${[data.pin.rec && 'code', data.pin.q && 'security question'].filter(Boolean).join(' and ') || 'none'}` : 'Off');
    add('App version', `v${APP_VERSION}`);
    let snap = null; try { snap = JSON.parse(lsGet(SNAP_KEY)); } catch {}
    add('Safety copy from last update', snap ? `Saved ${new Date(snap.at).toLocaleString()} (from v${snap.from})` : 'None yet');
    add('Last backup', data.lastBackup ? new Date(data.lastBackup).toLocaleString() : 'Never');
    add('Running as', isStandalone() ? 'Installed app' : 'Web page in the browser');
    add('Offline copy of the app', 'Checking…', 'bsCache');
    add('Internet', navigator.onLine ? 'Online' : 'Offline (still works)');
    add('Receipt photos', 'Checking…', 'bsRc');
    add('Google backup', data.cloud ? `${data.cloud.email || 'Connected'} · last backup ${agoText(data.cloud.lastAt)}` : cloudOn() ? 'Not connected' : 'Not set up');
    add('Server it talks to', data.cloud ? 'Only Google Drive, to back up into your own account. GitHub Pages delivers the app files.' : 'None. GitHub Pages only delivers the app files.');
    setTimeout(async () => {
      try {
        const ks = await receipts.keys(); let size = 0;
        for (const k of ks) { const b = await receipts.get(k); size += b ? b.size : 0; }
        $('bsRc').textContent = ks.length ? `${ks.length} photo${ks.length === 1 ? '' : 's'}, ${fmtBytes(size)}` : 'None';
      } catch { $('bsRc') && ($('bsRc').textContent = 'Not available'); }
      try { const e = await navigator.storage.estimate(); $('bsQuota').textContent = `${fmtBytes(e.usage || 0)} of ${fmtBytes(e.quota || 0)}`; } catch { $('bsQuota') && ($('bsQuota').textContent = 'Not reported by this browser'); }
      try { const p = await navigator.storage.persisted(); $('bsPersist').textContent = p ? 'Yes' : isStandalone() ? 'Not granted, but installed apps are kept' : 'Not yet. Installing the app helps.'; } catch { $('bsPersist') && ($('bsPersist').textContent = 'Not reported by this browser'); }
      try {
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        const keys = window.caches ? await caches.keys() : [];
        $('bsCache').textContent = reg && reg.active ? `Ready (${keys.filter(k => k.startsWith('ledger')).join(', ') || 'no cache yet'})` : 'Not set up yet. Open the app online once.';
      } catch { $('bsCache') && ($('bsCache').textContent = 'Not available'); }
    }, 0);
    return el('div', { class: 'panel' }, el('h2', { text: 'Behind the scenes' }),
      el('p', { class: 'hint', text: 'Ledger has no server. Everything below is read live from this phone.' }), rows,
      el('div', { class: 'acts', style: 'justify-content:flex-start' }, el('button', { class: 'btn small', text: 'View stored data', onclick: showRawData }),
        snap ? el('button', { class: 'btn small', text: 'Restore safety copy', onclick: () => restoreSnapshot(snap) }) : null));
  }
  async function restoreSnapshot(snap) {
    if (data.pin && !(await requirePin())) return;
    let old; try { old = JSON.parse(snap.raw); } catch { toast("The safety copy couldn't be read.", 'over'); return; }
    if (!(await ask({ title: 'Restore the safety copy?', body: `It holds ${(old.txs || []).length} transactions as they were on ${new Date(snap.at).toLocaleDateString()}, before the update. What's on the phone now (${data.txs.length} transactions) will be replaced.`, ok: 'Restore', danger: true }))) return;
    const pin = data.pin; data = normalize(old); data.pin = pin; data.appVersion = APP_VERSION; save(); render(); toast('Safety copy restored.');
  }
  function showRawData() {
    const { pin, ...rest } = data;
    const text = JSON.stringify({ ...rest, pin: pin ? '(hidden)' : null }, null, 2);
    const pre = el('pre', { class: 'raw', text });
    const copy = el('button', { class: 'btn small', type: 'button', text: 'Copy', onclick: async () => {
      try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected. Use your phone\'s Copy.'); }
    } });
    openInfo('Stored data', [el('p', { class: 'hint', text: `Exactly what is saved on this phone (${fmtBytes(new Blob([text]).size)}). The PIN hash is hidden here.` }), pre, el('div', {}, copy)]);
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
    pickLabel();
  }
  function setType(t) {
    sheet.type = t;
    $('typeSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
    $('fCat').hidden = t === 'transfer'; $('fPick').hidden = t === 'transfer'; $('fReceipt').hidden = t !== 'expense'; $('fTo').hidden = t !== 'transfer';
    $('tAccLabel').textContent = t === 'transfer' ? 'From account' : 'Account';
    const cats = (t === 'income' ? data.incomeCategories : data.categories).map(c => [c.id, c.name]);
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
    rcLoadFor(tx || null);
    $('sheet').hidden = false; sheetHint();
    setTimeout(() => $('tAmount').focus(), 60);
  }
  const closeSheet = () => { $('sheet').hidden = true; sheet.editing = null; closePicker(); rcReset(); };
  $('sheetClose').onclick = closeSheet;
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
  $('fab').onclick = () => openTxSheet(null, ui.tab === 'trans' && ui.sub.trans === 'calendar' && ui.calDay ? ui.calDay : null);

  function sheetHint() {
    const h = $('tHint'); h.className = 'hint'; h.textContent = ''; pickLabel();
    if (sheet.editing && sheet.editing.recurringId) h.textContent = 'Part of a repeating entry. Changes apply to this one only; manage the schedule under More.';
    if (sheet.type !== 'expense') return;
    const c = expCat($('tCat').value), m = monthOf($('tDate').value || todayISO()), lim = limitFor(c, m); if (lim == null) return;
    const before = spentIn(monthTxs(m), c.id, sheet.editing && sheet.editing.id), after = before + (parseAmount($('tAmount').value) || 0);
    if (after > lim) { h.className = 'hint over'; h.textContent = `This puts ${c.name} ${money(after - lim)} over its ${monthName(m)} limit.`; }
    else { h.className = after >= lim * WARN_AT ? 'hint warn' : 'hint'; h.textContent = `${money(lim - after)} left in ${c.name} for ${monthName(m)} after this.`; }
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
    const before = c ? spentIn(monthTxs(month), c.id, tx.id) : 0, after = before + amountCents, lim = limitFor(c, month);
    if (lim != null && after > lim) {
      const extra = rolledIn(c, month);
      const ok = await ask({ title: `This will put ${c.name} over budget`, body: `Your ${c.name} limit for ${monthName(month)} is ${money(lim)}${extra ? `, including ${money(extra)} rolled over` : ''}. This expense takes you past it.`, danger: true, ok: 'Add anyway', cancel: "Don't add it",
        facts: [['Already spent', money(before)], ['This expense', money(amountCents)], ['Limit this month', money(lim)], ['Over by', money(after - lim), true]] });
      if (!ok) { toast('Not saved. Change the amount or category, or close the form.'); return; }
    }
    if (type === 'expense' && rcState.blob) {
      const rid = (ed && ed.receiptId) || uid();
      try { await receipts.put(rid, rcState.blob); tx.receiptId = rid; } catch { toast("The photo couldn't be stored on this phone. The expense was saved without it.", 'warn'); }
    } else if (tx.receiptId && (rcState.removed || type !== 'expense')) { receipts.del(tx.receiptId).catch(() => {}); tx.receiptId = null; }
    if (freq) {
      const r = { id: uid(), type, amountCents, categoryId, subId, accountId, toAccountId, note: tx.note, freq, anchorDay: +date.slice(8), next: nextDate(date, freq, +date.slice(8)), paused: false };
      data.recurring.push(r); tx.recurringId = r.id;
    }
    const i = data.txs.findIndex(t => t.id === tx.id);
    if (i >= 0) data.txs[i] = tx; else data.txs.push(tx);
    save(); buzz(); burst(type);
    lsSet('ledger-last-type', type); if (accountId) lsSet('ledger-last-acc', accountId);
    const caught = freq ? runRecurring(true) : 0;
    if (lim != null && after > lim) toast(`Saved. ${c.name} is now ${money(after - lim)} over budget.`, 'over');
    else if (lim != null && after >= lim * WARN_AT && before < lim * WARN_AT) toast(`Heads up: ${c.name} is at ${Math.round(after / lim * 100)}% of its budget.`, 'warn');
    else {
      const where = month !== ui.month ? ` to ${monthName(month)}` : '';
      toast(ed ? `Transaction updated${where}.` : freq ? `Saved${where}. Repeats ${FREQS[freq].toLowerCase()}${caught ? `; ${caught} past ${caught === 1 ? 'entry' : 'entries'} filled in` : ''}.` : `Saved ${money(amountCents)} ${type}${where}.`);
    }
    if (more) { $('tAmount').value = ''; $('tNote').value = ''; $('tRepeat').value = ''; rcReset(); $('tAmount').focus(); sheetHint(); }
    else closeSheet();
    render();
  }
  $('sheetForm').addEventListener('submit', e => { e.preventDefault(); submitSheet(false); });
  $('tMore').onclick = () => submitSheet(true);
  armDelete($('tDelete'), () => { const id = sheet.editing.id; if (sheet.editing.receiptId) receipts.del(sheet.editing.receiptId).catch(() => {}); data.txs = data.txs.filter(t => t.id !== id); save(); closeSheet(); render(); toast('Transaction deleted.'); });

  /* ================= receipt photos ================= */
  // Photos live in IndexedDB (far more room than localStorage), keyed by the receiptId on the transaction.
  const receipts = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('ledger-receipts', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('r');
      r.onsuccess = () => res(r.result); r.onerror = () => { dbp = null; rej(r.error); };
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => { const t = db.transaction('r', mode), req = fn(t.objectStore('r')); t.oncomplete = () => res(req ? req.result : undefined); t.onerror = t.onabort = () => rej(t.error); });
    };
    return { get: k => run('readonly', s => s.get(k)), put: (k, b) => run('readwrite', s => s.put(b, k)), del: k => run('readwrite', s => s.delete(k)), keys: () => run('readonly', s => s.getAllKeys()), clear: () => run('readwrite', s => s.clear()) };
  })();
  // Shrink a camera photo to at most 1400px on its long side, as a JPEG of roughly 100-250 KB.
  function compressPhoto(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(b => b ? res(b) : rej(new Error('the photo could not be processed')), 'image/jpeg', 0.72);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('that file is not a photo this phone can open')); };
      img.src = url;
    });
  }
  const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const dataURLToBlob = async u => (await fetch(u)).blob();
  async function receiptsAsData() {
    const out = {};
    for (const t of data.txs) if (t.receiptId && !out[t.receiptId]) { const b = await receipts.get(t.receiptId).catch(() => null); if (b) out[t.receiptId] = await blobToDataURL(b); }
    return out;
  }
  const rcState = { blob: null, url: null, removed: false };
  function rcReset() { if (rcState.url) URL.revokeObjectURL(rcState.url); Object.assign(rcState, { blob: null, url: null, removed: false }); rcShow(null); }
  function rcShow(url, info) {
    $('rcActions').hidden = !!url; $('rcPreview').hidden = !url;
    if (url) { $('rcImg').src = url; $('rcInfo').textContent = info || 'Receipt attached'; } else $('rcImg').removeAttribute('src');
  }
  async function rcLoadFor(tx) {
    rcReset();
    if (!tx || !tx.receiptId) return;
    try {
      const b = await receipts.get(tx.receiptId);
      if (b && sheet.editing === tx) { rcState.url = URL.createObjectURL(b); rcShow(rcState.url, `Receipt photo · ${fmtBytes(b.size)}`); }
    } catch {}
  }
  async function rcUseFile(file) {
    if (!file) return;
    try {
      const b = await compressPhoto(file);
      if (rcState.url) URL.revokeObjectURL(rcState.url);
      Object.assign(rcState, { blob: b, url: URL.createObjectURL(b), removed: false });
      rcShow(rcState.url, `New photo · ${fmtBytes(b.size)}`); buzz();
    } catch (e) { toast(`Couldn't add the photo: ${e.message}.`, 'warn'); }
  }
  $('rcTake').onclick = () => { $('rcCam').value = ''; $('rcCam').click(); };
  $('rcChoose').onclick = $('rcReplace').onclick = () => { $('rcPick').value = ''; $('rcPick').click(); };
  $('rcCam').onchange = e => rcUseFile(e.target.files[0]);
  $('rcPick').onchange = e => rcUseFile(e.target.files[0]);
  $('rcRemove').onclick = () => { if (rcState.url) URL.revokeObjectURL(rcState.url); Object.assign(rcState, { blob: null, url: null, removed: true }); rcShow(null); };
  $('rcThumb').onclick = () => { if (rcState.url) { $('viewerImg').src = rcState.url; $('viewer').hidden = false; } };
  $('viewerClose').onclick = () => { $('viewer').hidden = true; };
  $('viewer').addEventListener('click', e => { if (e.target === $('viewer')) $('viewer').hidden = true; });

  /* ================= Google Drive backup ================= */
  // Backs up to the hidden app folder in the person's own Google Drive (where WhatsApp keeps its backups).
  // Only this app can see that folder. Needs a Google OAuth client ID registered for this site's address.
  const GOOGLE_CLIENT_ID = '85347082512-cfheoibqoi2vuo9antti8cq3ilq15kv9.apps.googleusercontent.com';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const DRIVE = 'https://www.googleapis.com/drive/v3/files', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files', MAIN_FILE = 'ledger-backup.json';
  const cloud = { token: null, expires: 0, busy: false, timer: null };
  const cloudOn = () => !!GOOGLE_CLIENT_ID;
  const gisReady = () => !!(window.google && google.accounts && google.accounts.oauth2);
  const tokenValid = () => !!cloud.token && Date.now() < cloud.expires - 60000;
  let gisLoading = null;
  function loadGis() {
    if (gisReady()) return Promise.resolve();
    return gisLoading || (gisLoading = new Promise((res, rej) => {
      const s = el('script', { src: 'https://accounts.google.com/gsi/client', async: true });
      s.onload = () => res(); s.onerror = () => { gisLoading = null; s.remove(); rej(new Error('offline')); };
      document.head.append(s);
    }));
  }
  // Call straight from a tap: Google shows its own small sign-in window.
  function signIn() {
    if (tokenValid()) return Promise.resolve(cloud.token);
    if (!gisReady()) { loadGis().catch(() => {}); return Promise.reject(new Error(navigator.onLine ? 'loading' : 'offline')); }
    return new Promise((res, rej) => {
      google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID, scope: `${DRIVE_SCOPE} openid email`, login_hint: (data.cloud && data.cloud.email) || undefined,
        callback: r => {
          if (r.error) return rej(new Error(r.error === 'access_denied' ? 'cancelled' : r.error_description || r.error));
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) return rej(new Error('drive-denied'));
          cloud.token = r.access_token; cloud.expires = Date.now() + (+r.expires_in || 3600) * 1000; res(cloud.token);
        },
        error_callback: e => rej(new Error(e && e.type === 'popup_closed' ? 'cancelled' : e && e.type === 'popup_failed_to_open' ? 'popup' : (e && e.message) || 'failed')),
      }).requestAccessToken({ prompt: data.cloud ? '' : 'consent' });
    });
  }
  async function gfetch(url, opts = {}) {
    if (!tokenValid()) throw new Error('expired');
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${cloud.token}` } });
    if (r.status === 401) { cloud.token = null; throw new Error('expired'); }
    if (!r.ok) throw new Error(`Google Drive answered ${r.status}`);
    return r;
  }
  async function listFiles() {
    let out = [], page = '';
    do {
      const r = await (await gfetch(`${DRIVE}?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,modifiedTime,size)${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`)).json();
      out = out.concat(r.files || []); page = r.nextPageToken;
    } while (page);
    return out;
  }
  async function uploadFile(name, blob, id) {
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify(id ? {} : { name, parents: ['appDataFolder'] })], { type: 'application/json' }));
    body.append('file', blob);
    return (await gfetch(`${UPLOAD}${id ? `/${id}` : ''}?uploadType=multipart&fields=id,modifiedTime`, { method: id ? 'PATCH' : 'POST', body })).json();
  }
  async function cloudBackup() {
    if (cloud.busy || !data.cloud || !tokenValid()) return false;
    cloud.busy = true;
    try {
      const files = await listFiles(), byName = new Map(files.map(f => [f.name, f]));
      const used = new Set(data.txs.map(t => t.receiptId).filter(Boolean));
      for (const id of used) {
        if (byName.has(`receipt-${id}.jpg`)) continue;
        const b = await receipts.get(id).catch(() => null);
        if (b) await uploadFile(`receipt-${id}.jpg`, b);
      }
      for (const f of files) if (f.name.startsWith('receipt-') && !used.has(f.name.slice(8, -4))) await gfetch(`${DRIVE}/${f.id}`, { method: 'DELETE' }).catch(() => {});
      const { pin, cloud: _c, ...rest } = data;
      const main = byName.get(MAIN_FILE);
      await uploadFile(MAIN_FILE, new Blob([JSON.stringify({ app: 'spending-ledger', savedAt: Date.now(), ...rest })], { type: 'application/json' }), main && main.id);
      data.cloud.lastAt = Date.now(); data.cloud.dirty = false; data.lastBackup = Date.now(); save(true);
      return true;
    } finally { cloud.busy = false; }
  }
  async function cloudRestore(files, askFirst) {
    const main = files.find(f => f.name === MAIN_FILE);
    if (!main) { toast('No Ledger backup was found in this Google account yet.', 'warn'); return false; }
    showUpdating('Reading your backup…');
    const obj = await (await gfetch(`${DRIVE}/${main.id}?alt=media`)).json();
    $('updating').hidden = true;
    if (!obj || !Array.isArray(obj.txs)) throw new Error('the backup file is damaged');
    if (askFirst && !(await ask({ title: 'Restore from Google?', body: `Found a backup from ${new Date(main.modifiedTime).toLocaleString()} with ${obj.txs.length} transactions. It replaces what is on this phone now (${data.txs.length} transactions).`, ok: 'Restore', danger: data.txs.length > 0 }))) return false;
    showUpdating('Restoring from Google…');
    try {
      const byName = new Map(files.map(f => [f.name, f]));
      await receipts.clear().catch(() => {});
      let got = 0;
      for (const id of new Set(obj.txs.map(t => t.receiptId).filter(Boolean))) {
        const f = byName.get(`receipt-${id}.jpg`); if (!f) continue;
        await receipts.put(id, await (await gfetch(`${DRIVE}/${f.id}?alt=media`)).blob()); got++;
      }
      const pin = data.pin, cl = data.cloud; delete obj.app; delete obj.savedAt;
      data = normalize(obj); data.pin = pin; data.onboarded = true; data.appVersion = APP_VERSION;
      data.cloud = { ...cl, lastAt: Date.parse(main.modifiedTime) || Date.now(), dirty: false };
      save(true); runRecurring(true); ui.tab = 'trans';
      toast(`Restored ${data.txs.length} transactions${got ? ` and ${got} receipt photo${got === 1 ? '' : 's'}` : ''} from Google.`); buzz();
      return true;
    } finally { $('updating').hidden = true; }
  }
  function cloudError(e) {
    $('updating').hidden = true;
    const m = e && e.message;
    if (m === 'cancelled') toast('Google sign-in was cancelled.');
    else if (m === 'loading') toast('Connecting to Google. Tap again in a moment.', 'warn');
    else if (m === 'popup') toast('The Google window was blocked. Allow pop-ups for this site and tap again.', 'warn');
    else if (m === 'drive-denied') toast('Ledger needs permission to use its own folder in your Google Drive. Tap again and allow it.', 'warn');
    else if (m === 'offline' || !navigator.onLine) toast('No internet connection. Your data is safe on this phone; back up when you are online.', 'warn');
    else if (m === 'expired') toast('Your Google session ended. Tap again to continue.', 'warn');
    else toast(`Google backup didn't work (${m || 'unknown error'}). Try again.`, 'over');
  }
  // mode 'connect' from More, 'restore' from the welcome card or More.
  function connectGoogle(mode) {
    signIn().then(async () => {
      showUpdating('Connecting to Google…');
      let email = '';
      try { email = (await (await gfetch('https://www.googleapis.com/oauth2/v3/userinfo')).json()).email || ''; } catch {}
      data.cloud = { email, lastAt: data.cloud ? data.cloud.lastAt : null, dirty: true }; save(true);
      const files = await listFiles(); $('updating').hidden = true;
      const main = files.find(f => f.name === MAIN_FILE);
      if (main && (mode === 'restore' || !data.txs.length)) { await cloudRestore(files, data.txs.length > 0); return; }
      if (main && await ask({ title: 'This account already has a backup', body: `There is a Ledger backup from ${new Date(main.modifiedTime).toLocaleString()} in ${email || 'this Google account'}. Restore it here, or replace it with what is on this phone?`, ok: 'Restore it here', cancel: "Keep this phone's data" })) { await cloudRestore(files, false); return; }
      if (!main && mode === 'restore') toast('No backup in this Google account yet, so this phone\'s data will be backed up to it.', 'warn');
      data.onboarded = true;
      showUpdating('Backing up to Google…'); await cloudBackup();
      toast(`Connected to ${email || 'your Google account'}. Backup saved.`); buzz();
    }).catch(cloudError).finally(() => { $('updating').hidden = true; render(); });
  }
  function backupNow() {
    signIn().then(async () => { showUpdating('Backing up to Google…'); await cloudBackup(); toast('Backed up to Google.'); buzz(); })
      .catch(cloudError).finally(() => { $('updating').hidden = true; render(); });
  }
  function restoreFromGoogle() {
    signIn().then(async () => { showUpdating('Looking for your backup…'); const files = await listFiles(); $('updating').hidden = true; await cloudRestore(files, true); })
      .catch(cloudError).finally(() => { $('updating').hidden = true; render(); });
  }
  async function disconnectGoogle() {
    if (!(await ask({ title: 'Disconnect Google backup?', body: 'Automatic backups stop. Your last backup stays in your Google account, and nothing on this phone is deleted.', ok: 'Disconnect' }))) return;
    if (cloud.token && gisReady()) try { google.accounts.oauth2.revoke(cloud.token, () => {}); } catch {}
    cloud.token = null; data.cloud = null; save(true); render(); toast('Google backup disconnected.');
  }
  const agoText = t => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  // While signed in, a change is backed up 15 seconds later; leaving the app backs up straight away.
  afterSave = quiet => {
    if (quiet || !data.cloud || !tokenValid()) return;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(() => cloudBackup().catch(() => {}), 15000);
  };
  function googlePanel() {
    if (!cloudOn()) return null;
    loadGis().catch(() => {});
    const c = data.cloud;
    if (!c) return el('div', { class: 'panel' }, el('div', { class: 'panel-head' }, el('h2', { text: 'Google backup' }), el('span', { class: 'pill muted', text: 'Off' })),
      el('p', { class: 'hint' }, 'Sign in with Google and Ledger backs up to a private folder in your Google Drive, like WhatsApp does. On a new phone, sign in and restore everything, receipts included. ', el('a', { href: 'privacy.html', text: 'How your data is handled' })),
      el('div', {}, el('button', { class: 'btn primary', type: 'button', text: 'Sign in with Google', onclick: () => connectGoogle('connect') })));
    return el('div', { class: 'panel' }, el('div', { class: 'panel-head' }, el('h2', { text: 'Google backup' }), el('span', { class: 'pill ok', text: 'On' })),
      el('div', { class: 'row-list' },
        el('div', { class: 'row-item' }, el('span', { class: 'grow' }, 'Account', el('div', { class: 'sub', text: c.email || 'Google account' }))),
        el('div', { class: 'row-item' }, el('span', { class: 'grow' }, 'Last backup', el('div', { class: 'sub', text: `${agoText(c.lastAt)}${c.dirty ? ' · new changes waiting' : ' · up to date'}` })))),
      el('p', { class: 'hint', text: tokenValid() ? 'Connected now: changes back up by themselves a few seconds after you make them.' : 'Tap Back up now to connect for this session; after that, changes back up by themselves.' }),
      el('div', { class: 'acts', style: 'justify-content:flex-start' },
        el('button', { class: 'btn primary small', type: 'button', text: 'Back up now', onclick: backupNow }),
        el('button', { class: 'btn small', type: 'button', text: 'Restore from Google', onclick: restoreFromGoogle }),
        el('button', { class: 'btn danger small', type: 'button', text: 'Disconnect', onclick: disconnectGoogle })));
  }

  /* ================= category picker ================= */
  // Replaces the plain dropdown: tiles for each category, a second step for subcategories,
  // and forms to add a category or subcategory on the spot. It drives the hidden #tCat/#tSub selects.
  const pick = { step: 'cat', catId: null, adding: false };
  const catList = () => sheet.type === 'income' ? data.incomeCategories : data.categories;
  const findCat = id => (sheet.type === 'income' ? incCat : expCat)(id);
  const sheetMonth = () => monthOf($('tDate').value || todayISO());
  const initial = name => (name.trim()[0] || '?').toUpperCase();
  function leftText(c) {
    if (sheet.type !== 'expense') return '';
    const m = sheetMonth(), lim = limitFor(c, m); if (lim == null) return '';
    const left = lim - spentIn(monthTxs(m), c.id, sheet.editing && sheet.editing.id);
    return left >= 0 ? `${money(left)} left` : `${money(-left)} over`;
  }
  function pickLabel() {
    const c = findCat($('tCat').value), sb = c && $('tSub').value ? (c.subs || []).find(x => x.id === $('tSub').value) : null;
    $('pickAv').textContent = c ? initial(c.name) : '+';
    $('pickAv').style.setProperty('--c', c ? `var(${c.color})` : 'var(--muted)');
    $('pickName').textContent = c ? (sb ? `${c.name} · ${sb.name}` : c.name) : 'Choose a category';
    $('pickSub').textContent = c ? (leftText(c) || ((c.subs || []).length && !sb ? 'Tap to add a subcategory' : '')) : 'Tap to choose';
    $('pickSub').classList.toggle('over', !!c && leftText(c).endsWith('over'));
  }
  function choose(catId, subId) { $('tCat').value = catId; fillSubs(subId || ''); sheetHint(); }
  function openPicker() { pick.step = 'cat'; pick.adding = false; $('picker').hidden = false; drawPicker(); }
  function closePicker() { $('picker').hidden = true; pick.adding = false; }
  function drawPicker() {
    const body = $('pickBody'), isInc = sheet.type === 'income'; body.replaceChildren();
    $('pickBack').hidden = pick.step !== 'sub';
    if (pick.step === 'cat') {
      $('pickTitle').textContent = isInc ? 'Income category' : 'Expense category';
      const grid = el('div', { class: 'pick-grid' });
      catList().forEach((c, i) => {
        const lt = leftText(c), subsN = (c.subs || []).length;
        grid.append(el('button', { type: 'button', class: `tile${$('tCat').value === c.id ? ' on' : ''}`, style: `--c:var(${c.color});--i:${Math.min(i, 14)}`, 'aria-label': `${c.name}${lt ? `, ${lt}` : ''}`, onclick: () => {
          choose(c.id, '');
          if (subsN) { pick.step = 'sub'; pick.catId = c.id; pick.adding = false; drawPicker(); } else { closePicker(); buzz(); }
        } }, el('span', { class: 'avatar', text: initial(c.name) }), el('span', { class: 'tile-name', text: c.name }),
          lt ? el('span', { class: `tile-meta${lt.endsWith('over') ? ' over' : ''}`, text: lt }) : subsN ? el('span', { class: 'tile-meta', text: `${subsN} sub${subsN === 1 ? '' : 's'}` }) : null));
      });
      grid.append(el('button', { type: 'button', class: `tile add${pick.adding ? ' on' : ''}`, style: `--i:${Math.min(catList().length, 14)}`, onclick: () => { pick.adding = !pick.adding; drawPicker(); } },
        el('span', { class: 'avatar', text: '+' }), el('span', { class: 'tile-name', text: 'New category' })));
      if (pick.adding) body.append(newCatForm());
      body.append(grid);
    } else {
      const c = findCat(pick.catId); if (!c) { pick.step = 'cat'; drawPicker(); return; }
      $('pickTitle').textContent = c.name;
      body.append(el('p', { class: 'hint', text: 'Pick a subcategory, or keep it general.' }),
        el('div', { class: 'pick-chips' },
          el('button', { type: 'button', class: `pchip${!$('tSub').value ? ' on' : ''}`, text: `Just ${c.name}`, onclick: () => { choose(c.id, ''); closePicker(); buzz(); } }),
          (c.subs || []).map((sb, i) => el('button', { type: 'button', class: `pchip${$('tSub').value === sb.id ? ' on' : ''}`, style: `--i:${Math.min(i + 1, 14)}`, text: sb.name, onclick: () => { choose(c.id, sb.id); closePicker(); buzz(); } })),
          el('button', { type: 'button', class: 'pchip add', text: '+ New subcategory', onclick: () => { pick.adding = !pick.adding; drawPicker(); } })));
      if (pick.adding) body.append(newSubForm(c));
    }
  }
  function newCatForm() {
    const isInc = sheet.type === 'income';
    const name = el('input', { id: 'ncName', maxlength: 40, required: true, placeholder: isInc ? 'e.g. Freelance' : 'e.g. Hair & beauty', autocomplete: 'off' });
    const lim = isInc ? null : el('input', { id: 'ncLimit', class: 'num', inputmode: 'decimal', placeholder: 'No limit' });
    setTimeout(() => name.focus(), 60);
    return el('form', { class: 'new-form', onsubmit: e => {
      e.preventDefault(); const n = name.value.trim(); if (!n) return;
      if (catList().some(c => c.name.toLowerCase() === n.toLowerCase())) { toast(`You already have a category called ${n}.`, 'warn'); return; }
      let lc = null;
      if (lim && lim.value.trim()) { lc = parseAmount(lim.value); if (lc == null) { toast('Enter the limit as a number, like 250.', 'warn'); return; } }
      const list = catList(), c = { id: uid(), name: n, color: SW[list.length % SW.length], subs: [] };
      if (!isInc) Object.assign(c, { limitCents: lc, limitSince: lc == null ? null : sheetMonth() });
      list.push(c); save();
      setType(sheet.type); choose(c.id, ''); closePicker(); buzz();
      toast(`${n} saved as a new ${isInc ? 'income' : 'expense'} category.`);
    } },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'ncName', text: 'New category name' }), name),
      lim ? el('div', { class: 'field' }, el('label', { class: 'label', for: 'ncLimit', text: 'Monthly limit (optional)' }), lim) : null,
      el('div', { class: 'acts' }, el('button', { type: 'button', class: 'btn small', text: 'Cancel', onclick: () => { pick.adding = false; drawPicker(); } }),
        el('button', { type: 'submit', class: 'btn primary small', text: 'Save category' })));
  }
  function newSubForm(c) {
    const name = el('input', { id: 'nsName', maxlength: 40, required: true, placeholder: 'e.g. Breakfast', autocomplete: 'off' });
    setTimeout(() => name.focus(), 60);
    return el('form', { class: 'new-form', onsubmit: e => {
      e.preventDefault(); const n = name.value.trim(); if (!n) return;
      c.subs = c.subs || [];
      if (c.subs.some(x => x.name.toLowerCase() === n.toLowerCase())) { toast(`${c.name} already has ${n}.`, 'warn'); return; }
      const sb = { id: uid(), name: n }; c.subs.push(sb); save();
      choose(c.id, sb.id); closePicker(); buzz(); toast(`${n} added under ${c.name}.`);
    } },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'nsName', text: `New subcategory in ${c.name}` }), name),
      el('div', { class: 'acts' }, el('button', { type: 'button', class: 'btn small', text: 'Cancel', onclick: () => { pick.adding = false; drawPicker(); } }),
        el('button', { type: 'submit', class: 'btn primary small', text: 'Save subcategory' })));
  }
  $('pickBtn').onclick = openPicker;
  $('pickClose').onclick = closePicker;
  $('pickBack').onclick = () => { pick.step = 'cat'; pick.adding = false; drawPicker(); };
  $('picker').addEventListener('click', e => { if (e.target === $('picker')) closePicker(); });
  $('tDate').addEventListener('change', pickLabel);

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
  function openInfo(title, nodes, doneLabel = 'Done') {
    formCfg = null; $('genTitle').textContent = title;
    $('genBody').replaceChildren(...nodes);
    $('genActs').replaceChildren(el('button', { type: 'button', class: 'btn primary', text: doneLabel, onclick: closeForm }));
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
    if (!$('picker').hidden) closePicker(); else if (!$('formSheet').hidden) closeForm(); else if (!$('sheet').hidden) closeSheet();
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
    const { pin, cloud: _c, ...rest } = data;
    const photos = await receiptsAsData();
    if (await saveFile(`ledger-backup-${todayISO()}.json`, JSON.stringify({ app: 'spending-ledger', ...rest, receipts: photos }), 'application/json')) {
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
    if (forgotRestore && !/^\s*[{[]/.test(text)) { forgotRestore = false; toast('Choose a Ledger backup file (.json) to restore.', 'warn'); return; }
    try {
      if (/^\s*[{[]/.test(text)) await restoreJSON(JSON.parse(text)); else await importCSV(text);
    } catch (err) { toast(`That file couldn't be read (${err.message}).`, 'over'); }
  });
  async function restoreJSON(obj) {
    if (!obj || !Array.isArray(obj.txs)) throw new Error('not a Ledger backup');
    if (!(await ask({ title: 'Restore this backup?', body: `It has ${obj.txs.length} transactions, ${(obj.goals || []).length} goals and ${(obj.categories || []).length} categories. Everything currently on this phone will be replaced.`, ok: 'Replace and restore', danger: true }))) return;
    const viaForgot = forgotRestore; forgotRestore = false;
    const pin = viaForgot ? null : data.pin, cl = data.cloud, photos = obj.receipts || {}; delete obj.app; delete obj.receipts;
    try { await receipts.clear(); for (const [k, u] of Object.entries(photos)) await receipts.put(k, await dataURLToBlob(u)); } catch { toast('Some receipt photos could not be restored.', 'warn'); }
    data = normalize(obj); data.pin = pin; data.cloud = cl; data.onboarded = true; data.appVersion = APP_VERSION; save(); runRecurring(true); ui.tab = 'trans';
    if (viaForgot) { hideLock(); render(); toast('Backup restored. The old PIN was removed; set a new one under More.'); } else { render(); toast('Backup restored.'); }
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
  const lock = { mode: 'unlock', entry: '', first: '', fails: 0, until: 0, resolve: null };
  const LOCK_TITLES = { unlock: 'Enter your PIN', verify: 'Enter your current PIN', set1: 'Choose a new 4 to 6 digit PIN', set2: 'Enter the new PIN again' };
  const QUESTIONS = ['What was the name of your first school?', 'What was your childhood nickname?', 'In what town was your mother born?', 'What was the name of your first pet?', 'What was the make of your first phone?', 'Who was your best friend as a child?'];
  let forgotRestore = false, suggestedRecovery = false;
  async function sha(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const hashPin = (pin, salt) => sha(`${salt}:${pin}`);
  const normCode = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normAnswer = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  function newRecoveryCode() {
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = new Uint8Array(12); crypto.getRandomValues(b);
    const c = [...b].map(x => A[x % A.length]).join('');
    return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
  }
  const checking = () => lock.mode === 'unlock' || lock.mode === 'verify';
  function drawDots() {
    const d = $('pinDots'); d.replaceChildren();
    const n = checking() ? data.pin.len : Math.max(4, lock.entry.length);
    for (let i = 0; i < n; i++) d.append(el('i', { class: i < lock.entry.length ? 'on' : '' }));
  }
  function buildPad() {
    const p = $('pad'); p.replaceChildren();
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', lock.mode === 'unlock' ? '' : 'Cancel', '0', '⌫'].forEach(k => {
      const ghost = k === '' || k === 'Cancel' || k === '⌫';
      p.append(el('button', { type: 'button', class: ghost ? 'ghost' : '', text: k, 'aria-label': k === '⌫' ? 'Delete digit' : k || null, disabled: k === '' || null, onclick: () => pinKey(k) }));
    });
    if (!checking()) p.append(el('span'), el('button', { type: 'button', class: 'ghost', text: 'Done', onclick: () => pinKey('done') }), el('span'));
    $('forgot').hidden = !checking();
  }
  function showLock(mode, msg) {
    if (mode === 'unlock') {
      closeSheet(); closeForm(); $('confirm').hidden = true;
      const pending = lock.resolve; lock.resolve = null; if (pending) pending(lock.mode.startsWith('set') ? null : false);
    }
    lock.mode = mode; lock.entry = ''; $('lock').hidden = false;
    $('lockTitle').textContent = LOCK_TITLES[mode];
    $('lockMsg').textContent = msg || (mode === 'set1' ? 'Tap Done when finished.' : mode === 'verify' ? 'This keeps your PIN safe if someone else has your phone.' : ' ');
    buildPad(); drawDots();
  }
  function hideLock() { $('lock').hidden = true; lock.entry = ''; }
  const finish = v => { const r = lock.resolve; lock.resolve = null; if (r) r(v); };
  // Ask for the current PIN. Resolves true when it is right, false on cancel.
  const requirePin = () => data.pin ? new Promise(res => { lock.resolve = res; showLock('verify'); }) : Promise.resolve(true);
  // Ask for a new PIN twice. Resolves the PIN, or null on cancel.
  const choosePin = () => new Promise(res => { lock.resolve = res; lock.first = ''; showLock('set1'); });
  async function pinKey(k) {
    if (k === 'Cancel') { const wasSet = lock.mode.startsWith('set'); hideLock(); finish(wasSet ? null : false); return; }
    if (k === '⌫') { lock.entry = lock.entry.slice(0, -1); drawDots(); return; }
    if (k === 'done') return finishSet();
    if (!/^\d$/.test(k)) return;
    if (checking() && Date.now() < lock.until) { $('lockMsg').textContent = `Too many tries. Wait ${Math.ceil((lock.until - Date.now()) / 1000)} seconds.`; return; }
    if (lock.entry.length >= 6) return;
    lock.entry += k; drawDots();
    if (checking() && lock.entry.length === data.pin.len) {
      if (await hashPin(lock.entry, data.pin.salt) === data.pin.hash) {
        lock.fails = 0; const mode = lock.mode; hideLock();
        if (mode === 'verify') finish(true); else afterUnlock();
        return;
      }
      lock.fails++; lock.entry = '';
      if (lock.fails >= 5) { lock.until = Date.now() + 30000; lock.fails = 0; }
      const d = $('pinDots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
      $('lockMsg').textContent = Date.now() < lock.until ? 'Too many tries. Wait 30 seconds.' : 'Wrong PIN. Try again.'; buzz(); drawDots();
    }
    if (lock.mode === 'set2' && lock.entry.length === lock.first.length) finishSet();
  }
  function finishSet() {
    if (lock.entry.length < 4) { $('lockMsg').textContent = 'Use at least 4 digits.'; return; }
    if (lock.mode === 'set1') { lock.first = lock.entry; showLock('set2'); return; }
    if (lock.entry !== lock.first) { lock.first = ''; showLock('set1', "Those didn't match. Start again."); return; }
    const pin = lock.entry; hideLock(); finish(pin);
  }
  async function storePin(pin) {
    const salt = uid(), keep = data.pin || {};
    data.pin = { salt, len: pin.length, hash: await hashPin(pin, salt), rec: keep.rec || null, q: keep.q || null };
    save();
  }
  async function setOrChangePin() {
    const had = !!data.pin;
    if (had && !(await requirePin())) return;
    const pin = await choosePin();
    if (!pin) { toast(had ? 'PIN not changed.' : 'No PIN was set.'); return; }
    await storePin(pin); buzz(); render();
    toast(had ? 'PIN changed.' : 'PIN set. Ledger locks after a minute in the background.');
    if (!data.pin.rec) makeRecoveryCode();
  }
  async function removePin() {
    if (!(await requirePin())) return;
    if (await ask({ title: 'Remove the PIN?', body: 'Anyone with your phone will be able to open Ledger. Your recovery code and security question are removed too.', ok: 'Remove PIN', danger: true })) {
      data.pin = null; save(); render(); toast('PIN removed.');
    }
  }
  async function makeRecoveryCode() {
    const code = newRecoveryCode(), salt = uid();
    data.pin.rec = { salt, hash: await sha(`${salt}:${normCode(code)}`), created: Date.now() };
    save(); render();
    const box = el('div', { class: 'rcode', text: code });
    const copy = el('button', { class: 'btn small', type: 'button', text: 'Copy code', onclick: async () => {
      try { await navigator.clipboard.writeText(code); toast('Code copied. Paste it somewhere safe.'); }
      catch { const r = document.createRange(); r.selectNodeContents(box); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Selected. Use your phone's Copy."); }
    } });
    openInfo('Your recovery code', [
      el('p', { text: 'If you ever forget your PIN, this code lets you set a new one without losing anything.' }), box,
      el('div', { class: 'acts', style: 'justify-content:flex-start' }, copy),
      el('p', { class: 'hint', text: 'Write it down, screenshot it, or keep it in your notes or email. Ledger shows it only this once and stores only a scrambled version of it.' })], "I've saved it");
  }
  async function newRecoveryCodeFlow() {
    if (!(await requirePin())) return;
    if (data.pin.rec && !(await ask({ title: 'Make a new recovery code?', body: 'Your old code will stop working.', ok: 'Make new code' }))) return;
    makeRecoveryCode();
  }
  async function securityQuestionFlow() {
    if (!(await requirePin())) return;
    openForm({
      title: 'Security question',
      fields: [
        { id: 'sqQ', label: 'Question', type: 'select', options: QUESTIONS.map(q => [q, q]), value: data.pin.q ? data.pin.q.question : QUESTIONS[0] },
        { id: 'sqA', label: 'Answer', required: true, placeholder: 'Capitals and spaces do not matter' },
        { id: 'sqA2', label: 'Type the answer again', required: true },
      ],
      submit: 'Save',
      onSubmit: v => {
        if (normAnswer(v.sqA).length < 2) { toast('Use an answer with at least 2 letters.', 'warn'); return false; }
        if (normAnswer(v.sqA) !== normAnswer(v.sqA2)) { toast("The two answers don't match.", 'warn'); return false; }
        const salt = uid();
        sha(`${salt}:${normAnswer(v.sqA)}`).then(hash => { data.pin.q = { question: v.sqQ, salt, hash }; save(); render(); toast('Security question saved.'); });
        return true;
      },
      onDelete: data.pin.q ? () => { data.pin.q = null; save(); render(); toast('Security question removed.'); } : null,
      deleteLabel: 'Remove question',
    });
  }
  function forgotPin() {
    forgotRestore = false;
    const p = data.pin || {}, hasWay = p.rec || p.q;
    const opts = [];
    if (p.rec) opts.push(el('button', { class: 'btn primary', type: 'button', text: 'Use my recovery code', onclick: () => recoverWith('code') }));
    if (p.q) opts.push(el('button', { class: p.rec ? 'btn' : 'btn primary', type: 'button', text: 'Answer my security question', onclick: () => recoverWith('q') }));
    opts.push(el('button', { class: 'btn', type: 'button', text: 'Restore from a backup file', onclick: () => { forgotRestore = true; closeForm(); pickFile(); } }));
    opts.push(armDelete(el('button', { class: 'btn danger', type: 'button', text: 'Erase everything and start over' }), () => {
      finish(false); const cl = data.cloud; data = fresh(); data.cloud = cl; save(true); receipts.clear().catch(() => {}); closeForm(); hideLock(); ui.tab = 'trans'; render(); toast('Ledger was reset. You can restore a backup under More.');
    }));
    openInfo('Forgot your PIN?', [
      el('p', { class: 'hint', text: hasWay ? 'Prove it is you with one of these, then choose a new PIN. Your transactions stay exactly as they are.' : "This PIN was set before recovery options existed, so Ledger can't confirm it's you. You can replace what's on this phone with a backup file, or erase it and start again. Keep trying your PIN first if you can." }),
      el('div', { class: 'stack-sm' }, opts)], 'Back');
  }
  function recoverWith(kind) {
    openForm({
      title: kind === 'code' ? 'Enter your recovery code' : 'Answer your security question',
      fields: [kind === 'code' ? { id: 'rcCode', label: 'Recovery code', placeholder: 'XXXX-XXXX-XXXX', required: true } : { id: 'rcAns', label: data.pin.q.question, required: true }],
      submit: 'Continue',
      onSubmit: v => { verifyRecovery(kind, v); return false; },
    });
  }
  async function verifyRecovery(kind, v) {
    if (Date.now() < lock.until) { toast(`Too many tries. Wait ${Math.ceil((lock.until - Date.now()) / 1000)} seconds.`, 'warn'); return; }
    const ok = kind === 'code'
      ? await sha(`${data.pin.rec.salt}:${normCode(v.rcCode)}`) === data.pin.rec.hash
      : await sha(`${data.pin.q.salt}:${normAnswer(v.rcAns)}`) === data.pin.q.hash;
    if (!ok) {
      lock.fails++; if (lock.fails >= 5) { lock.until = Date.now() + 60000; lock.fails = 0; }
      toast(kind === 'code' ? "That code doesn't match. Check for typos." : "That answer doesn't match.", 'warn'); buzz(); return;
    }
    lock.fails = 0; closeForm(); finish(false);
    const pin = await choosePin();
    if (!pin) { showLock('unlock'); return; }
    await storePin(pin); buzz(); render(); toast('New PIN set. All your data is still here.');
    afterUnlock();
  }
  function afterUnlock() {
    forgotRestore = false;
    if (pendingWhatsNew) { pendingWhatsNew = false; setTimeout(whatsNew, 350); return; }
    if (data.pin && !data.pin.rec && !data.pin.q && !suggestedRecovery) {
      suggestedRecovery = true;
      setTimeout(() => openInfo('Add a way back in', [
        el('p', { text: 'If you forget your PIN, a recovery code lets you set a new one without losing your data. It takes a few seconds.' }),
        el('div', {}, el('button', { class: 'btn primary', type: 'button', text: 'Create recovery code', onclick: () => { closeForm(); makeRecoveryCode(); } }))], 'Later'), 400);
    }
  }
  $('forgot').onclick = forgotPin;
  document.addEventListener('keydown', e => {
    if ($('lock').hidden || !$('formSheet').hidden || !$('confirm').hidden) return;
    if (/^\d$/.test(e.key)) pinKey(e.key); else if (e.key === 'Backspace') pinKey('⌫'); else if (e.key === 'Enter' && !checking()) pinKey('done');
  });
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); if (data.cloud && data.cloud.dirty && tokenValid()) cloudBackup().catch(() => {}); return; }
    if (data.pin && hiddenAt && Date.now() - hiddenAt > 60000 && ($('lock').hidden || lock.mode !== 'unlock')) showLock('unlock');
    runRecurring();
    if (swReg) swReg.update().catch(() => {});
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

  /* ================= updates ================= */
  // A new version installs in the background; it is applied straight away when the app has just opened
  // (or when asked), otherwise a notice offers it. Updates only replace app files, never the stored data.
  const bootAt = Date.now();
  let swReg = null, wantReload = false, forcing = false;
  function showUpdating(text) { $('updMsg').textContent = text || 'Updating Ledger…'; $('updating').hidden = false; }
  function applyUpdate(worker) {
    wantReload = true; showUpdating('Installing the new version…');
    worker.postMessage('skip-waiting');
    setTimeout(() => location.reload(), 5000);
  }
  function offerUpdate(worker) {
    const idle = Date.now() - bootAt < 15000 && $('sheet').hidden && $('formSheet').hidden && !editingInline();
    if (forcing || idle) applyUpdate(worker);
    else toast('A new version of Ledger is ready.', '', { label: 'Update', fn: () => applyUpdate(worker) }, 20000);
  }
  function watchRegistration(reg) {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(nw); });
    });
  }
  async function checkForUpdate(manual) {
    if (!swReg) { if (manual) toast('Updates need the app opened from its link with internet.', 'warn'); return; }
    forcing = true; showUpdating('Checking for updates…');
    try { await swReg.update(); } catch { forcing = false; $('updating').hidden = true; toast("Couldn't reach the update server. Check your internet and try again.", 'warn'); return; }
    if (swReg.waiting) { applyUpdate(swReg.waiting); return; }
    const started = Date.now();
    const wait = () => {
      if (wantReload) return;
      if (swReg.installing && Date.now() - started < 20000) { setTimeout(wait, 500); return; }
      forcing = false; $('updating').hidden = true;
      if (manual) toast(`You have the latest version (v${APP_VERSION}). Your data is safe.`);
    };
    setTimeout(wait, 1500);
  }
  function whatsNew() {
    const li = t => el('li', { text: t });
    openInfo(`What's new in v${APP_VERSION}`, [
      el('p', { class: 'hint', text: 'All your transactions, budgets, goals and settings carried over.' }),
      el('ul', { class: 'steps' },
        li('Google backup is on: sign in with Google under More and Ledger backs up to a private folder in your Google Drive. A new phone can restore everything, receipts included.'),
        li('Receipt photos: take or choose a photo when adding an expense. A paperclip marks entries that have one; tap the photo to see it full size.'),
        li('Backup files now include your receipt photos.'),
        li('Leftover money now carries into the next month. You will see "Brought forward" at the start of each month and on the summary card.'),
        li('Unspent budget rolls over: what a category did not use is added to its limit next month.'),
        li('New category picker: colourful tiles showing how much each budget has left, and a "+ New category" tile to add one on the spot.'),
        li('Both carry-overs can be switched off under More → Month to month.'),
        li('Changing or removing your PIN now asks for your current PIN first.'),
        li('Forgot PIN works: reset it with a recovery code or a security question, without losing any data.'),
        li('A livelier look: summary card with what is left to spend, category badges, animated totals and bars.'),
        li('Updates install by themselves when you open Ledger. A safety copy of your data is kept before each one.')),
      data.pin && !data.pin.rec ? el('div', {}, el('button', { class: 'btn primary', type: 'button', text: 'Create a recovery code now', onclick: async () => { closeForm(); if (await requirePin()) makeRecoveryCode(); } })) : null], 'Got it');
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      swReg = reg; watchRegistration(reg);
      if (location.hash === '#update') { try { history.replaceState(null, '', location.pathname); } catch {} checkForUpdate(true); }
      else reg.update().catch(() => {});
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload) location.reload(); });
  }

  /* ================= boot ================= */
  const h = location.hash.slice(1); if (TITLES[h]) ui.tab = h;
  document.querySelectorAll('#bottomNav button svg').forEach(svg => { const w = el('span', { class: 'ico' }); svg.replaceWith(w); w.append(svg); });
  if (cloudOn() && navigator.onLine && (data.cloud || !data.onboarded)) loadGis().catch(() => {});
  runRecurring(true);
  themeUI();
  render();
  if (justUpdated) pendingWhatsNew = true;
  if (data.pin) showLock('unlock'); else afterUnlock();
})();
