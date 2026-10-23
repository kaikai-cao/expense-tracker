/* 今天又花超了吗 —— 纯前端记账 App（PWA，localStorage 存储） */
(function () {
  'use strict';

  /* ---------- 分类配置 ---------- */
  var EXPENSE = [
    { key: 'food', name: '餐饮', icon: '🍜', color: '#ff9f43', bg: 'rgba(255,159,67,0.16)' },
    { key: 'transport', name: '交通', icon: '🚌', color: '#54a0ff', bg: 'rgba(84,160,255,0.16)' },
    { key: 'shopping', name: '购物', icon: '🛍️', color: '#ff6b81', bg: 'rgba(255,107,129,0.16)' },
    { key: 'study', name: '学习', icon: '📚', color: '#5f27cd', bg: 'rgba(95,39,205,0.14)' },
    { key: 'fun', name: '娱乐', icon: '🎮', color: '#1dd1a1', bg: 'rgba(29,209,161,0.16)' },
    { key: 'housing', name: '住宿', icon: '🏠', color: '#feca57', bg: 'rgba(254,202,87,0.20)' },
    { key: 'medical', name: '医疗', icon: '💊', color: '#ee5253', bg: 'rgba(238,82,83,0.16)' },
    { key: 'other', name: '其他', icon: '📦', color: '#9aa0b4', bg: 'rgba(154,160,180,0.18)' }
  ];
  var INCOME = [
    { key: 'allowance', name: '生活费', icon: '💰', color: '#10ac84', bg: 'rgba(16,172,132,0.16)' },
    { key: 'scholarship', name: '奖学金', icon: '🏆', color: '#f9ca24', bg: 'rgba(249,202,36,0.20)' },
    { key: 'parttime', name: '兼职', icon: '💼', color: '#4834d4', bg: 'rgba(72,52,212,0.14)' },
    { key: 'other_income', name: '其他', icon: '📦', color: '#9aa0b4', bg: 'rgba(154,160,180,0.18)' }
  ];
  function findCat(type, key) {
    var list = type === 'expense' ? EXPENSE : INCOME;
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return {};
  }

  /* ---------- 存储 ---------- */
  var RK = 'ledger_records', BK = 'ledger_budget';
  function getRecords() { try { return JSON.parse(localStorage.getItem(RK)) || []; } catch (e) { return []; } }
  function saveRecords(r) { localStorage.setItem(RK, JSON.stringify(r)); }
  function getBudget() { return parseFloat(localStorage.getItem(BK)) || 0; }
  function setBudget(v) { localStorage.setItem(BK, String(v)); }
  function fmt(d) {
    var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }
  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ---------- 云端同步（免登录，按同步码分区） ---------- */
  var CLOUD = null;
  var SYNC_AVAILABLE = false;
  try {
    if (window.WorkBuddyCloud) {
      var cloudCfg = (window.__CLOUD_PUBLIC_CONFIG__) || {
        endpoint: 'https://expense-tracker-68509.app.workbuddy.host',
        oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
        publishableKey: 'wbpk_H2uCsS4DTh5eemSTGPxy4f_ioLNGV3Rr8mxEEVEPmuD1JqpOVlIkZiu'
      };
      CLOUD = window.WorkBuddyCloud.createWorkBuddyCloud(cloudCfg);
      // 云数据面按确切 Origin 校验，仅在已发布域名下生效，本地/局域网回落本机存储
      SYNC_AVAILABLE = /app\.workbuddy\.host$/.test(location.hostname);
    }
  } catch (e) { CLOUD = null; SYNC_AVAILABLE = false; }

  function syncCode() {
    var c = localStorage.getItem('ledger_sync_code');
    if (!c) { c = makeCode(); localStorage.setItem('ledger_sync_code', c); }
    return c;
  }
  function makeCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function setSyncCode(code) {
    code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) return false;
    localStorage.setItem('ledger_sync_code', code);
    return true;
  }

  async function pushRecord(rec) {
    if (!SYNC_AVAILABLE) return;
    try {
      var res = await CLOUD.database.from('ledger_records').upsert({
        id: rec.id, code: syncCode(), data: rec, deleted: false, updated_at: new Date().toISOString()
      });
      if (res.error) console.warn('[sync] push failed', res.error);
    } catch (e) { console.warn('[sync] push error', e); }
  }
  async function pushDelete(id) {
    if (!SYNC_AVAILABLE) return;
    try {
      // 用 deleted=true 覆盖而非硬删，保证删除也能同步到其他设备
      var res = await CLOUD.database.from('ledger_records').upsert({
        id: id, code: syncCode(), data: {}, deleted: true, updated_at: new Date().toISOString()
      });
      if (res.error) console.warn('[sync] pushDelete failed', res.error);
    } catch (e) { console.warn('[sync] pushDelete error', e); }
  }
  async function pullRecords() {
    if (!SYNC_AVAILABLE) return false;
    try {
      var res = await CLOUD.database.from('ledger_records').select('*').eq('code', syncCode());
      if (res.error) { console.warn('[sync] pull failed', res.error); return false; }
      var local = getRecords(), map = {};
      local.forEach(function (r) { map[r.id] = r; });
      (res.data || []).forEach(function (row) {
        if (row.deleted) { delete map[row.id]; return; }
        var localTime = map[row.id] && map[row.id].updatedAt ? map[row.id].updatedAt : 0;
        var remoteTime = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        if (!map[row.id] || remoteTime >= localTime) map[row.id] = row.data;
      });
      saveRecords(Object.keys(map).map(function (k) { return map[k]; }));
      return true;
    } catch (e) { console.warn('[sync] pull error', e); return false; }
  }
  async function pushAll() {
    if (!SYNC_AVAILABLE) return;
    var recs = getRecords();
    for (var i = 0; i < recs.length; i++) await pushRecord(recs[i]);
  }
  async function doSync(showToast) {
    var ok = await pullRecords();
    if (ok) { await pushAll(); refreshCurrentTab(); }
    updateSyncUI(ok);
    if (showToast) toast(ok ? '已同步' : '同步不可用（请发布后重试）');
  }
  function refreshCurrentTab() {
    if (state.tab === 'home') renderHome();
    else if (state.tab === 'bill') renderBill();
    else if (state.tab === 'stats') renderStats();
    else if (state.tab === 'me') renderMe();
  }
  function updateSyncUI(ok) {
    var el = $('sync-state');
    if (!el) return;
    if (!SYNC_AVAILABLE) { el.textContent = '本机模式（发布后可用）'; el.className = 'sync-state local'; }
    else if (ok === false) { el.textContent = '同步失败'; el.className = 'sync-state fail'; }
    else { el.textContent = '已同步 ☁'; el.className = 'sync-state'; }
    var codeEl = $('sync-code'); if (codeEl) codeEl.textContent = syncCode();
  }

  /* ---------- 全局状态 ---------- */
  var state = {
    tab: 'home',
    sheetType: 'expense',
    sheetCat: 'food',
    billY: 0, billM: 0,
    statsY: 0, statsM: 0
  };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Tab 切换 ---------- */
  function switchTab(tab) {
    state.tab = tab;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].hidden = (tabs[i].id !== 'tab-' + tab);
    var items = document.querySelectorAll('.tab-item');
    for (var j = 0; j < items.length; j++) items[j].classList.toggle('active', items[j].dataset.tab === tab);
    if (tab === 'home') renderHome();
    else if (tab === 'bill') renderBill();
    else if (tab === 'stats') renderStats();
    else if (tab === 'me') renderMe();
  }

  /* ---------- 首页 ---------- */
  function decorate(r) {
    var c = findCat(r.type, r.category);
    return Object.assign({}, r, {
      icon: c.icon || '📦', bg: c.bg || 'rgba(154,160,180,0.18)', categoryName: c.name || r.category
    });
  }
  function renderHome() {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
    var recs = getRecords();
    var exp = 0, inc = 0;
    recs.forEach(function (r) {
      var p = r.date.split('-');
      if (+p[0] === y && +p[1] === m) { if (r.type === 'expense') exp += r.amount; else inc += r.amount; }
    });
    var today = fmt(now);
    var todayList = recs.filter(function (r) { return r.date === today; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; })
      .map(decorate);

    $('home-month').textContent = y + '年' + m + '月';
    $('home-balance').textContent = '¥' + (inc - exp).toFixed(2);
    $('home-expense').textContent = '¥' + exp.toFixed(2);
    $('home-income').textContent = '¥' + inc.toFixed(2);
    $('home-today').textContent = today;

    var qg = $('quick-grid'); qg.innerHTML = '';
    EXPENSE.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'quick-item';
      el.innerHTML = '<div class="quick-icon" style="background:' + c.bg + '">' + c.icon + '</div><div class="quick-name">' + c.name + '</div>';
      el.onclick = function () { openSheet('expense', c.key); };
      qg.appendChild(el);
    });

    var box = $('home-today-list');
    if (todayList.length === 0) { box.innerHTML = '<div class="empty">今天还没有记录，点右下角 ＋ 记一笔吧</div>'; return; }
    box.innerHTML = todayList.map(recordHTML).join('');
  }

  function recordHTML(r) {
    return '<div class="record-item">' +
      '<div class="record-icon" style="background:' + r.bg + '">' + r.icon + '</div>' +
      '<div class="record-main"><div class="record-cat">' + r.categoryName + '</div>' +
      '<div class="record-note">' + (r.note || '无备注') + '</div></div>' +
      '<div class="record-amount ' + (r.type === 'income' ? 'income' : 'expense') + '">' +
      (r.type === 'income' ? '+' : '-') + r.amount.toFixed(2) + '</div></div>';
  }

  /* ---------- 账单 ---------- */
  function renderBill() {
    var recs = getRecords().map(decorate).sort(function (a, b) { return b.createdAt - a.createdAt; });
    var y = state.billY, m = state.billM;
    var filtered = recs.filter(function (r) { var p = r.date.split('-'); return +p[0] === y && +p[1] === m; });
    var exp = 0, inc = 0, map = {};
    filtered.forEach(function (r) {
      if (r.type === 'expense') exp += r.amount; else inc += r.amount;
      if (!map[r.date]) map[r.date] = { date: r.date, weekday: WEEK[new Date(r.date).getDay()], total: 0, items: [] };
      map[r.date].items.push(r);
      map[r.date].total += (r.type === 'expense' ? -r.amount : r.amount);
    });
    var groups = Object.keys(map).sort(function (a, b) { return b.localeCompare(a); })
      .map(function (k) { return map[k]; });

    $('bill-month').textContent = y + '年' + m + '月';
    $('bill-expense').textContent = '¥' + exp.toFixed(2);
    $('bill-income').textContent = '¥' + inc.toFixed(2);

    var box = $('bill-groups');
    if (groups.length === 0) { box.innerHTML = '<div class="empty">本月还没有账单记录</div>'; return; }
    box.innerHTML = groups.map(function (g) {
      var head = '<div class="group-head"><div class="group-date">' + g.date + ' ' + g.weekday + '</div>' +
        '<div class="group-total ' + (g.total >= 0 ? 'income' : 'expense') + '">' +
        (g.total > 0 ? '+' : '') + g.total.toFixed(2) + '</div></div>';
      var items = g.items.map(function (r) {
        return '<div class="record-item" data-del="' + r.id + '">' +
          '<div class="record-icon" style="background:' + r.bg + '">' + r.icon + '</div>' +
          '<div class="record-main"><div class="record-cat">' + r.categoryName + '</div>' +
          '<div class="record-note">' + (r.note || '无备注') + '</div></div>' +
          '<div class="record-amount ' + (r.type === 'income' ? 'income' : 'expense') + '">' +
          (r.type === 'income' ? '+' : '-') + r.amount.toFixed(2) + '</div></div>';
      }).join('');
      return '<div class="group">' + head + items + '</div>';
    }).join('');
  }

  /* ---------- 统计 ---------- */
  function renderStats() {
    var y = state.statsY, m = state.statsM;
    var recs = getRecords().filter(function (r) {
      var p = r.date.split('-'); return +p[0] === y && +p[1] === m && r.type === 'expense';
    });
    var map = {}, total = 0;
    recs.forEach(function (r) { map[r.category] = (map[r.category] || 0) + r.amount; total += r.amount; });
    var ranking = EXPENSE.filter(function (c) { return map[c.key]; })
      .map(function (c) { return { name: c.name, icon: c.icon, color: c.color, bg: c.bg, value: map[c.key], percent: total ? Math.round(map[c.key] / total * 100) : 0 }; })
      .sort(function (a, b) { return b.value - a.value; });

    var daysInMonth = new Date(y, m, 0).getDate(), dayMap = {};
    recs.forEach(function (r) { var d = +r.date.split('-')[2]; dayMap[d] = (dayMap[d] || 0) + r.amount; });
    var maxDay = Math.max(1, 0);
    Object.keys(dayMap).forEach(function (k) { if (dayMap[k] > maxDay) maxDay = dayMap[k]; });
    var bars = '';
    for (var d = 1; d <= daysInMonth; d++) {
      var v = dayMap[d] || 0;
      var h = maxDay ? Math.round(v / maxDay * 100) : 0;
      var label = (d === 1 || d % 5 === 0) ? d : '';
      bars += '<div class="bar-col"><div class="bar" style="height:calc((100% - 15px) * ' + (h / 100).toFixed(2) + ')"></div><div class="bar-day">' + label + '</div></div>';
    }

    var budget = getBudget();
    var bp = budget > 0 ? Math.min(100, Math.round(total / budget * 100)) : 0;
    $('stats-month').textContent = y + '年' + m + '月';
    $('budget-text').textContent = (budget > 0 ? '¥' + budget : '未设置') + ' · 已用 ' + bp + '%';
    $('budget-bar').style.width = bp + '%';
    $('budget-tip').textContent = '总支出 ¥' + total.toFixed(2) + '，去“我的”设置预算';

    var rk = $('stats-ranking');
    if (ranking.length === 0) rk.innerHTML = '<div class="empty">本月暂无支出</div>';
    else rk.innerHTML = ranking.map(function (c) {
      return '<div class="rank-item"><div class="rank-icon" style="background:' + c.bg + '">' + c.icon + '</div>' +
        '<div class="rank-name">' + c.name + '</div>' +
        '<div class="rank-bar-wrap"><div class="rank-bar" style="width:' + c.percent + '%;background:' + c.color + '"></div></div>' +
        '<div class="rank-val">¥' + c.value.toFixed(2) + '<span class="pct">' + c.percent + '%</span></div></div>';
    }).join('');
    $('stats-bars').innerHTML = bars;

    drawPie(ranking, total);
  }

  function drawPie(ranking, total) {
    var canvas = $('pieCanvas');
    if (!canvas || total <= 0) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || 160, h = rect.height || 160;
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 4, r = R * 0.58;
    var start = -Math.PI / 2;
    ranking.forEach(function (item) {
      var ang = item.value / total * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, start, start + ang); ctx.closePath();
      ctx.fillStyle = item.color; ctx.fill(); start += ang;
    });
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = '#9aa0b4'; ctx.font = '500 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('本月支出', cx, cy - 6);
    ctx.fillStyle = '#ff5b6c'; ctx.font = '700 18px sans-serif';
    ctx.fillText('¥' + total.toFixed(0), cx, cy + 16);
  }

  /* ---------- 我的 ---------- */
  function renderMe() {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
    var recs = getRecords(), exp = 0, inc = 0;
    recs.forEach(function (r) { var p = r.date.split('-'); if (+p[0] === y && +p[1] === m) { if (r.type === 'expense') exp += r.amount; else inc += r.amount; } });
    $('me-count').textContent = '共 ' + recs.length + ' 条记录';
    $('me-expense').textContent = '¥' + exp.toFixed(2);
    $('me-income').textContent = '¥' + inc.toFixed(2);
    $('me-balance').textContent = '¥' + (inc - exp).toFixed(2);
    var b = getBudget();
    $('me-budget').textContent = b > 0 ? ('¥' + b) : '去设置 ›';
    updateSyncUI(SYNC_AVAILABLE ? true : null);
  }

  /* ---------- 记一笔 弹层 ---------- */
  function openSheet(type, cat) {
    state.sheetType = type || 'expense';
    var cats = state.sheetType === 'expense' ? EXPENSE : INCOME;
    state.sheetCat = cat || cats[0].key;
    $('amount-label').textContent = state.sheetType === 'expense' ? '支出金额' : '收入金额';
    $('amount-input').value = '';
    $('note-input').value = '';
    $('date-input').value = fmt(new Date());
    document.querySelectorAll('.type-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.type === state.sheetType);
      b.classList.toggle('exp', b.dataset.type === 'expense');
      b.classList.toggle('inc', b.dataset.type === 'income');
    });
    renderCatGrid();
    $('sheet-mask').hidden = false;
    $('add-sheet').hidden = false;
  }
  function closeSheet() { $('sheet-mask').hidden = true; $('add-sheet').hidden = true; }
  function renderCatGrid() {
    var cats = state.sheetType === 'expense' ? EXPENSE : INCOME;
    var box = $('cat-grid'); box.innerHTML = '';
    cats.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'cat-item' + (c.key === state.sheetCat ? ' sel' : '');
      el.innerHTML = '<div class="cat-icon" style="background:' + c.bg + '">' + c.icon + '</div><div class="cat-name">' + c.name + '</div>';
      el.onclick = function () { state.sheetCat = c.key; renderCatGrid(); };
      box.appendChild(el);
    });
  }
  function saveRecord() {
    var amt = parseFloat($('amount-input').value);
    if (!amt || amt <= 0) { alert('请输入金额'); return; }
    var recs = getRecords();
    recs.push({
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      type: state.sheetType,
      amount: Math.round(amt * 100) / 100,
      category: state.sheetCat,
      note: ($('note-input').value || '').trim(),
      date: $('date-input').value,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    saveRecords(recs);
    pushRecord(recs[recs.length - 1]);
    closeSheet();
    if (state.tab === 'home') renderHome();
    else if (state.tab === 'bill') renderBill();
    else if (state.tab === 'me') renderMe();
    toast('记账成功');
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);background:rgba(45,49,66,0.9);color:#fff;padding:9px 16px;border-radius:8px;font-size:14px;z-index:99;transition:opacity .3s';
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 900);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(function () {});
    else {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove();
    }
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    document.getElementById('tabbar').addEventListener('click', function (e) {
      var item = e.target.closest('.tab-item'); if (item) switchTab(item.dataset.tab);
    });
    document.querySelectorAll('.bar-nav').forEach(function (n) {
      n.addEventListener('click', function () {
        var d = +n.dataset.delta;
        if (state.tab === 'bill') { stepMonth('bill', d); renderBill(); }
        else if (state.tab === 'stats') { stepMonth('stats', d); renderStats(); }
      });
    });
    document.getElementById('bill-groups').addEventListener('click', function (e) {
      var it = e.target.closest('[data-del]'); if (!it) return;
      if (confirm('确定删除这条记录吗？')) {
        var recs = getRecords().filter(function (r) { return r.id !== it.dataset.del; });
        saveRecords(recs); pushDelete(it.dataset.del);
        renderBill();
      }
    });
    // 弹层
    document.querySelectorAll('.type-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.sheetType = b.dataset.type;
        var cats = state.sheetType === 'expense' ? EXPENSE : INCOME;
        state.sheetCat = cats[0].key;
        $('amount-label').textContent = state.sheetType === 'expense' ? '支出金额' : '收入金额';
        document.querySelectorAll('.type-btn').forEach(function (x) {
          x.classList.toggle('active', x.dataset.type === state.sheetType);
          x.classList.toggle('exp', x.dataset.type === 'expense');
          x.classList.toggle('inc', x.dataset.type === 'income');
        });
        renderCatGrid();
      });
    });
    $('sheet-mask').addEventListener('click', closeSheet);
    $('save-btn').addEventListener('click', saveRecord);
    // 我的
    $('btn-budget').addEventListener('click', function () {
      var v = prompt('设置每月预算（元），如 2000', getBudget() ? String(getBudget()) : '');
      if (v !== null) { var n = parseFloat(v); setBudget(isNaN(n) ? 0 : n); renderMe(); }
    });
    $('btn-export').addEventListener('click', function () {
      var recs = getRecords();
      if (!recs.length) { alert('暂无数据'); return; }
      var text = JSON.stringify(recs, null, 2);
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板'); }, function () { download(text); });
      else download(text);
    });
    $('btn-clear').addEventListener('click', function () {
      if (confirm('此操作不可恢复，确定清空全部记录吗？')) { localStorage.removeItem(RK); renderMe(); toast('已清空'); }
    });
    // 云端同步
    $('btn-copy-code').addEventListener('click', function () { copyText(syncCode()); toast('同步码已复制'); });
    $('btn-sync').addEventListener('click', function () { doSync(true); });
    $('btn-link').addEventListener('click', function () {
      var code = prompt('输入要关联设备的同步码（与电脑端保持一致）：', '');
      if (code === null) return;
      if (setSyncCode(code)) {
        updateSyncUI(null);
        doSync(false).then(function () { pushAll(); updateSyncUI(true); toast('已关联并上传本机数据'); });
      } else { toast('同步码格式不正确'); }
    });
    $('btn-upload').addEventListener('click', function () { pushAll(); updateSyncUI(true); toast('本机数据已上传'); });
    // 悬浮加号
    var fab = document.createElement('div');
    fab.className = 'fab'; fab.textContent = '＋';
    fab.onclick = function () { openSheet('expense'); };
    document.getElementById('app').appendChild(fab);
  }
  function download(text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'ledger-export.json'; a.click();
  }
  function stepMonth(which, d) {
    var y = which === 'bill' ? state.billY : state.statsY;
    var m = which === 'bill' ? state.billM : state.statsM;
    m += d; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    if (which === 'bill') { state.billY = y; state.billM = m; } else { state.statsY = y; state.statsM = m; }
  }

  /* ---------- 启动 ---------- */
  function init() {
    var now = new Date();
    state.billY = state.statsY = now.getFullYear();
    state.billM = state.statsM = now.getMonth() + 1;
    bind();
    switchTab('home');
    updateSyncUI(null);
    if (SYNC_AVAILABLE) doSync(false);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && SYNC_AVAILABLE) doSync(false); });
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
