// 타점노트 무료 베타 앱 (설치형 웹앱)
// config.js(배포할 때 자동 생성)에 데이터베이스 주소가 있으면 실제 데이터, 없으면 예시 데이터로 보여 줘요.
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var LIVE = !!(CFG.supabaseUrl && CFG.supabaseKey);
  var $app = document.getElementById('app');
  var K = { consent: 'tn_consent_v1', code: 'tn_code', prefs: 'tn_prefs', push: 'tn_push', feed: 'tn_feed' };
  var MARKET = { kr: '국장', us: '미장', crypto: '코인' };
  var MISS = { '시장약세': '시장 흐름 약함', '추세약세': '종목 추세 약함', '이미오름': '이미 많이 오름', '변동큼': '변동성 큼',
    '실적임박': '실적 발표 임박', '기록부족': '과거 기록 부족', '과거손실': '과거 성적 손실', '🟢연속손실': '최근 연속 손실' };
  var GRADE_RANK = { '낮음': 0, '보통': 1, '높음': 2 };
  var DEFAULT_PREFS = { markets: ['kr', 'us', 'crypto'], minGrade: '보통', sell: true, quiet: false, preset: '', rules: null };
  // 매수 알림 조건: 안정성 지표 5가지 + 수익성 지표 1가지 + 신호 점수
  var GUARDS = [
    ['시장', '시장 흐름 좋을 때만', '대표 지수(코스피200·S&P500·비트코인)가 200일선 위일 때만'],
    ['추세', '상승 추세 종목만', '주가와 50일선이 200일선 위에 있을 때만'],
    ['눌림', '눌림에서만', '이미 많이 오른 자리는 빼고, 잠깐 내려왔을 때만'],
    ['변동성', '변동성 클 때 피하기', '평소보다 크게 흔들리는 때는 빼요'],
    ['실적', '실적 발표 앞두고 피하기', '미장만 · 실적 발표 10일 전부터 빼요']];
  var PROFIT = ['성적', '과거 성적 좋은 자리만', '같은 종목(기록이 적으면 같은 시장)의 지난 알림이 평균 +0.3% 이상일 때만'];
  var SCORES = [5, 6, 7, 8];
  var MISS_OF = { '시장': '시장약세', '추세': '추세약세', '눌림': '이미오름', '변동성': '변동큼', '실적': '실적임박' };
  var FALLBACK_PRESETS = [
    { id: '추천', label: '추천', desc: '지난 2년 백테스트에서 가장 고르게 좋았던 조합이에요.',
      rules: { kr: { score: 6, need: ['시장', '추세'], card: false }, us: { score: 6, need: ['시장', '추세'], card: false }, crypto: { score: 6, need: ['시장', '추세'], card: false } } },
    { id: '안정', label: '안정 우선', desc: '손실 위험을 줄이려고 조건을 많이 켰어요. 알림이 드물어요.',
      rules: { kr: { score: 7, need: ['시장', '추세', '눌림', '변동성', '실적'], card: true }, us: { score: 7, need: ['시장', '추세', '눌림', '변동성', '실적'], card: true }, crypto: { score: 7, need: ['시장', '추세', '눌림', '변동성'], card: true } } },
    { id: '기회', label: '기회 많이', desc: '조건을 줄여 알림을 많이 받아요. 손실도 더 자주 나요.',
      rules: { kr: { score: 5, need: [], card: false }, us: { score: 5, need: [], card: false }, crypto: { score: 5, need: [], card: false } } }];
  var NOTICES = [
    ['투자 참고용 정보예요', '이 앱의 타점과 가격은 투자 판단을 돕는 참고 정보이며, 투자자문이나 매매 권유가 아니에요.'],
    ['개별 상담과 자금 운용은 하지 않아요', '종목별 1:1 상담, 계좌 대리 운용, 매매 대행은 제공하지 않아요.'],
    ['원금 손실이 생길 수 있어요', '알림대로 매매해도 손실이 날 수 있으며, 투자 판단과 그 결과의 책임은 본인에게 있어요.'],
    ['과거 성적은 미래 수익을 보장하지 않아요', '성적표와 시뮬레이션은 지난 데이터로 계산한 결과예요. 서비스 제공자는 금융투자업자가 아니에요.']
  ];
  var S = { feed: null, loading: false, error: '', tab: 'all', rec: 'sim', agree: [false, false, false, false],
    codeErr: '', busy: false, pushHelp: false, open: null, agreedNow: false, cm: 'kr' };   // agreedNow: 이번에 앱을 연 뒤 동의했는지 (앱을 열 때마다 안내·동의 화면)
  var OPEN_CODE = 'OPEN';   // 서버에 이 코드가 켜져 있으면 초대 코드 없이 바로 들어가요

  // ---------- 작은 도구 ----------
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (_) {} }
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(m, x) {
    if (x == null || isNaN(x)) return '-';
    x = Number(x);
    if (m === 'us') return '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (x >= 100 ? Math.round(x).toLocaleString('ko-KR')
      : x.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + '원';
  }
  function manwon(v) {
    if (v == null || isNaN(v)) return '-';
    var a = Math.abs(v), s = v > 0 ? '+' : v < 0 ? '-' : '';
    if (a < 0.1) return '0원';
    return a >= 1 ? s + Math.round(a).toLocaleString('ko-KR') + '만원' : s + Math.round(a * 10) + '천원';
  }
  function tone(v) { return v > 0.05 ? 'red' : v < -0.05 ? 'blue' : ''; }
  function kst(d, opt) {
    var o = { timeZone: 'Asia/Seoul' };
    for (var k in opt) o[k] = opt[k];
    return new Intl.DateTimeFormat('ko-KR', o).format(d);
  }
  function dayLabel(iso) {
    var d = new Date(iso), ymd = { year: 'numeric', month: 'numeric', day: 'numeric' };
    return kst(d, ymd) === kst(new Date(), ymd) ? '오늘' : kst(d, { month: 'numeric', day: 'numeric' }).replace(/\s/g, '').replace(/\.$/, '');
  }
  function hm(iso) { return kst(new Date(iso), { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function code() { return store.get(K.code, ''); }
  function prefs() { var p = store.get(K.prefs, {}), o = {}; for (var k in DEFAULT_PREFS) o[k] = k in p ? p[k] : DEFAULT_PREFS[k]; return o; }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  var ICON = {
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="#333D4B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="#333D4B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="#191F28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="#0B6E3F" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="통과"><path d="M5 12l5 5 9-10"/></svg>',
    no: '<svg viewBox="0 0 24 24" fill="none" stroke="#A63F0A" stroke-width="2.6" stroke-linecap="round" role="img" aria-label="부족"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    logo: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="타점노트 로고"><path d="M3 17l5-5 4 4 8-9"/><circle cx="20" cy="7" r="1.6" fill="#FF6B6B" stroke="none"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>'
  };

  // ---------- 데이터 ----------
  function rpc(fn, args) {
    var h = { 'apikey': CFG.supabaseKey, 'Content-Type': 'application/json' };
    if (/^eyJ/.test(CFG.supabaseKey)) h.Authorization = 'Bearer ' + CFG.supabaseKey;   // 예전 형식 키
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn,
      { method: 'POST', headers: h, body: JSON.stringify(args) }).then(function (r) {
      if (r.ok) return r.status === 204 ? null : r.json();
      return r.json().catch(function () { return {}; }).then(function (b) {
        var e = new Error((b && b.message) || ('HTTP ' + r.status));
        e.invalid = /invalid code/.test(e.message);
        throw e;
      });
    });
  }
  function loadFeed() {
    if (!LIVE) { S.feed = DEMO; render(); return Promise.resolve(); }
    if (S.loading || !code()) return Promise.resolve();
    S.loading = true;
    return rpc('app_feed', { p_code: code(), p_days: 3 }).then(function (f) {
      S.feed = f; S.error = ''; S.offline = false;
      if (store.get(K.prefs, null) === null) {                       // 처음 쓰는 사람은 추천 설정으로 시작
        var ps = findPreset('추천');
        if (ps) { var np = prefs(); np.preset = '추천'; np.rules = clone(ps.rules); store.set(K.prefs, np); }
      }
      var keep = {}; for (var k in f) keep[k] = f[k];
      keep.alerts = (f.alerts || []).slice(0, 60); store.set(K.feed, keep);   // 인터넷이 끊겼을 때 보여 줄 마지막 내용
    }).catch(function (e) {
      if (e.invalid) {
        S.open = code() === OPEN_CODE ? false : null;
        store.del(K.code); S.codeErr = '초대 코드가 더 이상 쓸 수 없어요. 새 코드를 넣어 주세요.';
      }
      else {
        var last = S.feed || store.get(K.feed, null);
        if (last) { S.feed = last; S.offline = true; S.error = ''; }
        else S.error = '불러오지 못했어요. 인터넷 연결을 확인하고 새로고침을 눌러 주세요.';
      }
    }).then(function () { S.loading = false; render(); });
  }

  // ---------- 푸시 알림 ----------
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var pushOK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function b64u(s) {
    var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
    var a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function pushOn() { return !!store.get(K.push, false) && pushOK && Notification.permission === 'granted'; }
  function enablePush() {
    if (!LIVE) { toast('앱 연결이 끝나면 쓸 수 있어요'); return; }
    if (!CFG.vapidPublicKey) { toast('푸시 키가 아직 없어요. 관리자에게 알려 주세요'); return; }
    if (isIOS && !standalone) { S.pushHelp = true; render(); return; }
    if (!pushOK) { toast('이 브라우저는 푸시 알림을 지원하지 않아요'); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('알림이 허용되지 않았어요. 휴대폰 설정에서 허용해 주세요'); return; }
      S.busy = true; render();
      return navigator.serviceWorker.ready.then(function (reg) {
        var opts = { userVisibleOnly: true, applicationServerKey: b64u(CFG.vapidPublicKey) };
        return reg.pushManager.subscribe(opts).catch(function () {      // 예전 키로 등록된 경우 다시 등록
          return reg.pushManager.getSubscription().then(function (old) {
            return (old ? old.unsubscribe() : Promise.resolve()).then(function () { return reg.pushManager.subscribe(opts); });
          });
        });
      }).then(function (sub) {
        return rpc('app_subscribe', { p_code: code(), p_sub: sub.toJSON(), p_prefs: prefs() });
      }).then(function () {
        store.set(K.push, true); toast('알림을 켰어요');
      }).catch(function () { toast('알림을 켜지 못했어요. 잠시 뒤 다시 해 주세요'); });
    }).then(function () { S.busy = false; render(); });
  }
  function disablePush() {
    store.set(K.push, false);
    if (pushOK) {
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        if (!sub) return;
        return rpc('app_unsubscribe', { p_code: code(), p_endpoint: sub.endpoint }).catch(function () {}).then(function () { return sub.unsubscribe(); });
      }).catch(function () {});
    }
    toast('알림을 껐어요'); render();
  }
  var saveTimer = null;
  function savePrefs(p) {
    store.set(K.prefs, p); render();
    if (!LIVE || !pushOn()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        if (sub) return rpc('app_subscribe', { p_code: code(), p_sub: sub.toJSON(), p_prefs: prefs() });
      }).catch(function () { toast('설정을 저장하지 못했어요'); });
    }, 600);
  }

  // ---------- 매수 알림 조건 (서버 app_bridge.passes 와 같은 규칙) ----------
  function presetList() { var x = S.feed && S.feed.presets; return (x && x.list && x.list.length) ? x.list : FALLBACK_PRESETS; }
  function findPreset(id) { return presetList().filter(function (x) { return x.id === id; })[0]; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function baseRules(p) {                  // 직접 설정은 지금 쓰던 조건(없으면 추천)에서 시작
    if (p.rules) return clone(p.rules);
    var ps = findPreset('추천');
    return ps ? clone(ps.rules) : { kr: { score: 6, need: [], card: false }, us: { score: 6, need: [], card: false }, crypto: { score: 6, need: [], card: false } };
  }
  function customOf(p) {
    var r = baseRules(p)[S.cm] || { score: 6, need: [], card: false };
    return { score: r.score || 6, need: (r.need || []).slice(), card: !!r.card };
  }
  function passes(a, rule) {
    if ((a.score || 0) < (rule.score || 6)) return false;
    if (a.side !== 'buy') return true;
    var f = a.flags && typeof a.flags === 'object' ? a.flags : null, miss = a.misses || [];
    for (var i = 0; i < (rule.need || []).length; i++) {
      var g = rule.need[i], ok = f ? (g in f ? !!f[g] : true) : miss.indexOf(MISS_OF[g]) < 0;
      if (!ok) return false;
    }
    if (rule.card && !(f ? !!f['성적'] : (miss.indexOf('과거손실') < 0 && miss.indexOf('기록부족') < 0))) return false;
    return true;
  }
  function shown(a, p) {
    if (a.side === 'sell' && !p.sell) return false;
    var rule = p.rules && p.rules[a.market];
    if (rule) return passes(a, rule);
    if ((a.score || 0) < 6) return false;                                       // 예전 설정: 등급만
    return a.side !== 'buy' || GRADE_RANK[a.grade || '높음'] >= GRADE_RANK[p.minGrade || '보통'];
  }
  function ruleText(r, market) {
    var need = (r.need || []).filter(function (g) { return market === 'us' || g !== '실적'; });
    return (need.length ? need.join('·') : '안정성 조건 없음') + (r.card ? ' · 과거 성적' : '') + ' · 신호 ' + r.score + '점 이상';
  }
  function resultLine(mk, x) {
    if (!x || !x.n) return '<div class="line"><span>' + MARKET[mk] + '</span><span class="small">지난 2년 거래 없음</span></div>';
    var win = Math.round(x.wins / x.n * 100);
    return '<div class="line"><span>' + MARKET[mk] + ' <small class="small">' + x.n + '번 · 이긴 비율 ' + win + '%</small></span><b class="' + tone(x.total) + '">' + manwon(x.total) + '</b></div>';
  }
  function halvesLine(x) {
    if (!x || !x.n) return '';
    return '<p class="small" style="margin:0">앞 1년 <b class="' + tone(x.h1) + '">' + manwon(x.h1) + '</b> · 뒤 1년 <b class="' + tone(x.h2) + '">' + manwon(x.h2) + '</b> · 가장 크게 잃은 구간 ' + (x.dd >= 0.1 ? '-' + manwon(x.dd).replace('+', '') : '없음') + '</p>';
  }
  function loadResearch() {
    var c = customOf(prefs()), key = S.cm + JSON.stringify(c);
    if (S.res && S.res.key === key) return;
    S.res = { key: key, data: null, loading: LIVE, mk: S.cm };
    if (!LIVE) return;
    rpc('app_research', { p_code: code(), p_score: c.score, p_need: c.need, p_card: c.card })
      .then(function (d) { if (S.res && S.res.key === key) { S.res.data = d || {}; S.res.loading = false; render(); } })
      .catch(function () { if (S.res && S.res.key === key) { S.res.loading = false; S.res.err = true; render(); } });
  }

  // ---------- 화면 조각 ----------
  function menu(on) {
    function a(id, href, icon, label) { return '<a href="' + href + '" class="' + (on === id ? 'on' : '') + '"' + (on === id ? ' aria-current="page"' : '') + '>' + icon + label + '</a>'; }
    return '<nav class="menu" aria-label="메뉴"><div>' + a('home', '#/', ICON.list, '타점') + a('record', '#/record', ICON.chart, '성적표') + a('settings', '#/settings', ICON.gear, '설정') + '</div></nav>';
  }
  function top(title, right, extra) {
    return '<header class="top"><div class="bar">' + title + (right || '') + '</div>' + (extra || '') + '</header>';
  }
  function demoBar() { return LIVE ? '' : '<p class="demo">예시 데이터예요. 앱 연결을 마치면 실제 타점이 나와요.</p>'; }
  function chip(a) {
    if (a.side !== 'buy') return '<span class="chip sell">매도 알림</span>';
    var g = a.grade || '높음';
    return '<span class="chip g-' + g + '">안정성 ' + g + (a.total ? ' ' + a.passed + '/' + a.total : '') + '</span>';
  }
  function where(a) { return MARKET[a.market] + (a.category ? ' › ' + a.category : '') + ' · ' + dayLabel(a.created_at) + ' ' + (a.reason || hm(a.created_at)); }
  function card(a) {
    var m = a.market, buy = a.side === 'buy', vals, foot;
    if (buy) {
      vals = [['매수 기준가', money(m, a.buy), 'red'], ['손절가', money(m, a.stop), 'blue'], [a.half ? '1차 매도' : '매도 기준가', money(m, a.sell), '']];
      var miss = (a.misses || []).map(function (x) { return MISS[x] || x; });
      foot = '신호 점수 ' + a.score + '/10' + (a.qty ? ' · ' + a.qty : '') + (a.loss ? ' · 손절 시 -' + money(m, a.loss) : '') + (miss.length ? ' · 부족: ' + miss.join(', ') : '');
    } else {
      vals = [['현재가', money(m, a.price), ''], ['반등 매도가', a.rebound ? money(m, a.rebound) : '지금 매도', 'blue'],
        ['반등 폭', a.rebound ? '+' + ((a.rebound / a.price - 1) * 100).toFixed(1) + '%' : '-', '']];
      foot = '신호 점수 ' + a.score + '/10 · 보유 중이면 ' + (a.rebound ? '지금 또는 반등 때 매도' : '지금 매도');
    }
    return '<a class="card" href="#/alert/' + esc(a.id) + '"><div class="head"><div class="title"><div class="name"><span class="side ' + (buy ? 'buy">매수' : 'sell">매도') + '</span>' + esc(a.name) + '</div><span class="small">' + esc(where(a)) + '</span></div>' + chip(a) + '</div>' +
      '<div class="vals">' + vals.map(function (v) { return '<div><span>' + v[0] + '</span><strong class="' + v[2] + '">' + esc(v[1]) + '</strong></div>'; }).join('') + '</div>' +
      '<span class="foot">' + esc(foot) + '</span></a>';
  }

  // ---------- 화면 ----------
  function pageWelcome() {
    var all = S.agree.every(Boolean);
    return '<main class="welcome"><div style="display:flex;flex-direction:column;gap:14px"><div class="logo">' + ICON.logo + '</div>' +
      '<h1>매수·매도 타점을<br>알림으로 받아 보세요</h1><p class="lead">국장·미장·코인에 타점이 생기면 매수 기준가, 손절가, 매도가와 안정성 등급을 함께 알려 드려요.</p>' +
      '<span class="tag" style="align-self:flex-start">무료 베타 · 결제 없음</span></div>' +
      '<section aria-labelledby="nt" style="display:flex;flex-direction:column;gap:12px"><h2 id="nt" style="margin:0;font-size:16px">시작 전에 꼭 확인해 주세요</h2>' +
      NOTICES.map(function (n, i) {
        return '<label class="agree"><input type="checkbox" data-agree="' + i + '"' + (S.agree[i] ? ' checked' : '') + '><span><strong>' + n[0] + '</strong>' + n[1] + '</span></label>';
      }).join('') + '</section></main>' +
      '<footer class="sticky-foot"><label class="all"><input type="checkbox" data-agree="all"' + (all ? ' checked' : '') + '>위 내용을 모두 읽고 동의해요</label>' +
      '<button class="btn" data-act="start"' + (all ? '' : ' disabled') + '>' + (all ? '동의하고 시작하기' : '모두 동의하면 시작할 수 있어요') + '</button></footer>';
  }
  function pageCode() {
    return '<main class="welcome"><div style="display:flex;flex-direction:column;gap:14px"><div class="logo">' + ICON.logo + '</div>' +
      '<h1>초대 코드를<br>넣어 주세요</h1><p class="lead">지금은 초대받은 분만 쓰는 무료 베타예요. 받은 코드를 그대로 넣으면 돼요.</p></div>' +
      '<form data-form="code" class="field" style="gap:10px"><label for="code">초대 코드</label>' +
      '<input id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="예: ABCD-1234-EFGH" maxlength="40" required>' +
      (S.codeErr ? '<p class="err" role="alert">' + esc(S.codeErr) + '</p>' : '') +
      '<button class="btn" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '확인하는 중…' : '확인') + '</button></form></main>';
  }
  function pageWait() {
    return '<main class="welcome"><div style="display:flex;flex-direction:column;gap:14px"><div class="logo">' + ICON.logo + '</div>' +
      '<h1>준비하는 중…</h1><p class="lead">잠시만 기다려 주세요.</p></div></main>';
  }
  function checkOpen() {
    S.open = 'checking';
    rpc('app_check', { p_code: OPEN_CODE }).then(function (ok) {
      if (ok === true) { store.set(K.code, OPEN_CODE); S.open = true; S.feed = null; loadFeed(); }
      else S.open = false;
    }).catch(function () { S.open = false; S.codeErr = '연결하지 못했어요. 인터넷 연결을 확인하고 앱을 다시 열어 주세요.'; })
      .then(function () { render(); });
  }
  function pageHome() {
    var f = S.feed, all = (f && f.alerts) || [], pf = prefs();
    var inTab = all.filter(function (a) { return S.tab === 'all' || a.market === S.tab; });
    var mine = inTab.filter(function (a) { return shown(a, pf); });
    var items = S.showAll ? inTab : mine, hidden = inTab.length - mine.length;
    var tabs = [['all', '전체'], ['kr', '국장'], ['us', '미장'], ['crypto', '코인']].map(function (t) {
      return '<button class="tab' + (S.tab === t[0] ? ' on' : '') + '" data-act="tab" data-v="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + '</button>';
    }).join('');
    var status = !f ? (S.loading ? '불러오는 중…' : '') : hm(f.now) + ' 업데이트';
    if (f && LIVE && !S.offline) {
      var age = f.beat ? Math.round((new Date(f.now) - new Date(f.beat)) / 60000) : null;
      status += age == null ? ' · 엔진 연결 전' : age > 30 ? ' · 엔진 확인 ' + age + '분 전' : ' · 엔진 정상';
    }
    var body = S.error ? '<p class="empty">' + esc(S.error) + '</p>'
      : !f ? '<p class="empty"><span class="spin" style="display:inline-block"></span></p>'
      : items.length ? items.map(card).join('')
      : '<p class="empty">최근 3일 동안 ' + (S.tab === 'all' ? '' : MARKET[S.tab] + ' ') + '내 조건에 맞는 타점이 없어요.<br>타점이 생기면 알림으로 알려 드려요.</p>';
    if (f && !S.error && hidden > 0) body += '<button class="btn ghost" data-act="showall">' + (S.showAll ? '내 조건에 맞는 것만 보기' : '조건에 안 맞아 숨긴 타점 ' + hidden + '건 보기') + '</button>';
    return top('<span class="brand">타점노트<span class="tag">무료 베타</span></span>',
      '<span style="display:flex"><button class="icon-btn" data-act="refresh" aria-label="새로고침">' + ICON.refresh + '</button><a class="icon-btn" href="#/settings" aria-label="알림 설정">' + ICON.bell + '</a></span>',
      '<p class="notice">투자 참고용 정보이며 투자자문이 아니에요. 원금 손실이 생길 수 있고, 투자 판단과 책임은 본인에게 있어요.</p>' + demoBar() + (S.offline ? '<p class="warn" style="margin:0 0 10px">인터넷에 연결되지 않았어요. 마지막으로 받은 내용을 보여 드려요.</p>' : '') + '<div class="tabs" role="group" aria-label="시장">' + tabs + '</div>') +
      '<main class="page"><div class="row-head"><h1>최근 타점 <span>' + items.length + '건</span></h1><span class="small">' + esc(status) + '</span></div>' + body +
      '<p class="foot-note">안정성은 시장 흐름·종목 추세·눌림·변동성·실적 발표·과거 성적 6가지로 매겨요. 최근 3일 알림만 보여요.</p></main>' + menu('home');
  }
  function ladder(a) {
    var m = a.market, pts = a.side === 'buy'
      ? [[a.sell, a.half ? '1차 매도' : '매도 기준가', ''], [a.price, '알림 때 가격', 'now'], [a.buy, '매수 기준가', 'red'], [a.stop, '손절가', 'blue']]
      : [[a.rebound, '반등 매도가', 'blue'], [a.price, '알림 때 가격', 'now']];
    pts = pts.filter(function (p) { return p[0] != null; }).sort(function (x, y) { return y[0] - x[0]; });
    if (pts.length < 2) return '';
    var hi = pts[0][0], lo = pts[pts.length - 1][0], span = hi - lo || 1, GAP = 17;
    var ys = pts.map(function (p) { return 8 + (hi - p[0]) / span * 84; });
    for (var i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + GAP);        // 가까운 가격끼리 글자가 겹치지 않게
    var over = ys[ys.length - 1] - 92;
    if (over > 0) ys = ys.map(function (y, i) { return Math.max(8 + i * GAP, y - over); });
    return '<div class="ladder" role="img" aria-label="가격 위치">' + pts.map(function (p, i) {
      return '<div class="lv ' + p[2] + '" style="top:' + ys[i].toFixed(1) + '%"><span>' + p[1] + '</span><strong>' + money(m, p[0]) + '</strong></div>';
    }).join('') + '</div>';
  }
  function pageDetail(id) {
    var a = ((S.feed && S.feed.alerts) || []).filter(function (x) { return String(x.id) === String(id); })[0];
    var head = top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">' + (a ? (a.side === 'buy' ? '매수 타점' : '매도 타점') : '타점') + '</span></span>');
    if (!a) return head + '<main class="page"><p class="empty">' + (S.feed ? '이 타점은 3일이 지나 목록에서 빠졌어요.' : '불러오는 중…') + '</p><a class="btn ghost" href="#/">목록으로</a></main>' + menu('home');
    var m = a.market, buy = a.side === 'buy', out = [];
    out.push('<section class="card"><div class="name" style="font-size:12px;font-weight:400;color:var(--mut)"><span class="side ' + (buy ? 'buy">매수' : 'sell">매도') + '</span>' + esc(where(a)) + '</div>' +
      '<h1 style="margin:0;font-size:22px">' + esc(a.name) + '</h1><div class="big-price"><strong>' + money(m, a.price) + '</strong><span class="small">알림 때 가격</span></div>' + ladder(a) +
      (m === 'kr' ? '<p class="info" style="margin-top:12px">국장 시세는 늦게 들어올 수 있어요. 주문 전에 증권사 앱에서 현재가를 꼭 확인해 주세요.</p>' : '') + '</section>');
    if (buy) {
      var gap = (a.price / a.buy - 1) * 100;
      var steps = a.half
        ? ['<b>' + money(m, a.sell) + '</b>에서 절반을 팔아요', '남은 절반은 손절가를 <b>산 가격</b>으로 올려요', '오른 뒤 고점에서 <b>' + money(m, a.trail) + '</b> 빠지면 나머지를 팔아요']
        : ['<b>' + money(m, a.sell) + '</b>에서 팔아요', '<b>' + money(m, a.stop) + '</b>에 닿으면 손절해요'];
      out.push('<section class="card"><h2>매매 계획</h2><div class="boxes"><div class="box r"><span>매수 기준가 · ' + (gap > 1 ? gap.toFixed(1) + '% 위, 대기' : '지금 가능') + '</span><strong>' + money(m, a.buy) + '</strong><em>' + esc(a.qty || '') + '</em></div>' +
        '<div class="box b"><span>손절가</span><strong>' + money(m, a.stop) + '</strong><em>' + (a.loss ? '닿으면 손실 -' + money(m, a.loss) : '') + '</em></div></div>' +
        '<ol class="steps">' + steps.map(function (s, i) { return '<li><i>' + (i + 1) + '</i><span>' + s + '</span></li>'; }).join('') + '</ol></section>');
      var miss = a.misses || [], passN = (a.total || 0) - miss.filter(function (x) { return x !== '🟢연속손실'; }).length;
      var hist = a.hist ? '<p class="info">지난 2년 ' + (a.hist.src === '시장' ? '같은 시장 알림 전체' : '이 종목 알림') + '대로 샀다면 <b>' + a.hist.n + '번 · 승률 ' + Math.round(a.hist.win) + '% · 평균 ' + (a.hist.avg > 0 ? '+' : '') + Number(a.hist.avg).toFixed(1) + '%</b></p>' : '';
      out.push('<section class="card"><div class="line"><h2>안정성</h2>' + chip(a) + '</div><ul class="checks">' +
        miss.map(function (x) { return '<li>' + ICON.no + esc(MISS[x] || x) + '</li>'; }).join('') +
        (passN > 0 ? '<li>' + ICON.ok + (miss.length ? '나머지 ' + passN + '개 통과' : passN + '개 모두 통과') + '</li>' : '') + '</ul>' + hist +
        '<div class="line"><span>신호 점수 (지표 10가지)</span><b>' + a.score + '/10</b></div></section>');
    } else {
      out.push('<section class="card"><h2>보유 중이라면</h2><ol class="steps">' +
        (a.rebound ? '<li><i>1</i><span>지금 팔거나, <b>' + money(m, a.rebound) + '</b>까지 반등하면 팔아요</span></li>' : '<li><i>1</i><span>가까운 반등 자리가 없어요. 보유 중이라면 <b>지금 매도</b>를 참고하세요</span></li>') +
        '<li><i>2</i><span>다시 살 때는 🔴 매수 알림이 올 때만 사요</span></li></ol><div class="line"><span>신호 점수 (지표 10가지)</span><b>' + a.score + '/10</b></div></section>');
    }
    out.push('<a class="btn" href="https://tossinvest.com" target="_blank" rel="noopener">증권 앱에서 보기</a>' +
      '<p class="foot-note">투자 참고용 정보이며 투자자문·매매 권유가 아니에요. 개별 상담과 자금 운용은 하지 않아요. 원금 손실이 생길 수 있고, 과거 성적은 미래 수익을 보장하지 않아요.</p>');
    return head + '<main class="page">' + out.join('') + '</main>' + menu('home');
  }
  function simSection(mk) {
    var rows = [['새 알림' + (mk.new ? ' ' + mk.new.n + '번' : ''), mk.new ? mk.new.total : null], ['예전 알림', mk.old ? mk.old.total : null], ['그냥 보유', mk.hold]];
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r[1] || 0); }).concat([1]));
    var bars = rows.map(function (r) {
      var v = r[1], w = v == null ? 0 : Math.max(2, Math.round(Math.abs(v) / max * 100));
      return '<div class="mrow"><span>' + r[0] + '</span><div class="mbar"><div>' + (v < 0 ? '<i class="n" style="width:' + w + '%"></i>' : '') + '</div><div class="axis"></div><div>' + (v > 0 ? '<i class="p" style="width:' + w + '%"></i>' : '') + '</div></div><strong class="' + tone(v) + '">' + (v == null ? '거래 없음' : manwon(v)) + '</strong></div>';
    }).join('');
    var hv = mk.halves, half = hv ? manwon(hv[0]) + ' / ' + manwon(hv[1]) + ' · ' + (hv[0] > 0 && hv[1] > 0 ? '둘 다 수익' : hv[0] <= 0 && hv[1] <= 0 ? '둘 다 손실' : '한쪽만 수익') : '거래 없음';
    var g = mk.grades || {};
    var hasG = ['높음', '보통', '낮음'].some(function (k) { return g[k]; });
    var grades = !hasG ? '' : '<h2 style="font-size:14px;color:var(--mut);margin-top:4px">등급별 (알림 전부 따라 샀다면)</h2>' + ['높음', '보통', '낮음'].map(function (k) {
      var x = g[k];
      return '<div class="grow"><span class="chip g-' + k + '">안정성 ' + k + '</span><span>' + (x ? x.n + '번 · 승률 ' + Math.round(x.win / x.n * 100) + '%' : '거래 없음') + '</span><strong class="' + tone(x && x.total) + '">' + (x ? manwon(x.total) : '-') + '</strong></div>';
    }).join('');
    return '<section class="card"><div class="line"><h2>' + MARKET[mk.market] + '</h2><span class="small">' + mk.tickers + '종목 · 기준 ' + mk.cur + '점</span></div>' + bars +
      '<div class="line" style="border-top:1px solid var(--chip);padding-top:10px"><span>안정성 검사 · 앞 1년 / 뒤 1년</span><b>' + half + '</b></div>' +
      grades +
      (mk.sell ? '<div class="line"><span>매도 알림 적중률 (3일 뒤)</span><b>10번 중 ' + Math.round(mk.sell.hits) + '번</b></div>' : '') + '</section>';
  }
  function liveSection(lv) {
    var span = S.liveSpan || 'week', d = (lv && lv[span]) || {};
    var keys = Object.keys(d);
    var rows = keys.length ? keys.map(function (mk) {
      return '<section class="card"><h2>' + MARKET[mk] + '</h2>' + ['높음', '보통', '낮음'].filter(function (g) { return d[mk][g]; }).map(function (g) {
        var x = d[mk][g];
        return '<div class="grow"><span class="chip g-' + g + '">안정성 ' + g + '</span><span>' + x.n + '번 · 이익 ' + x.win + '</span><strong class="' + tone(x.sum) + '">' + manwon(x.sum) + '</strong></div>';
      }).join('') + '</section>';
    }).join('') : '<p class="empty">' + (span === 'week' ? '지난 7일 동안 끝난 거래가 없어요.' : '아직 끝난 거래가 없어요. 베타 알림 결과가 쌓이면 여기에 나와요.') + '</p>';
    return '<div class="seg" role="group" aria-label="기간"><button data-act="span" data-v="week" class="' + (span === 'week' ? 'on' : '') + '">지난 7일</button><button data-act="span" data-v="all" class="' + (span === 'all' ? 'on' : '') + '">전체</button></div>' +
      '<p class="foot-note" style="margin:0 4px">보낸 매수 알림대로 매수 기준가에 100만원씩 샀다고 치고 계산했어요.</p>' + rows +
      (lv ? '<p class="small" style="margin:0 4px">보유 중 ' + lv.held + '개 · 매수가 기다리는 중 ' + lv.waiting + '개' + (lv.paused && lv.paused.length ? ' · 연속 손실로 🟢를 낮춘 시장: ' + lv.paused.map(function (x) { return MARKET[x]; }).join(', ') : '') + '</p>' : '');
  }
  function pageRecord() {
    var f = S.feed, body;
    if (!f) body = '<p class="empty">' + (S.error ? esc(S.error) : '불러오는 중…') + '</p>';
    else if (S.rec === 'sim') {
      body = f.sim && f.sim.markets && f.sim.markets.length
        ? '<p class="foot-note" style="margin:0 4px">알림이 올 때마다 100만원씩 샀다고 치고 지난 2년을 다시 돌려 본 결과예요. 수수료 0.2% 포함 · ' + kst(new Date(f.sim.made), { month: 'numeric', day: 'numeric' }) + ' 계산</p>' + f.sim.markets.map(simSection).join('')
        : '<p class="empty">아직 계산한 결과가 없어요.<br>점검 작업을 한 번 돌리면 여기에 나와요.</p>';
    } else body = liveSection(f.live);
    return top('<h1 style="margin:0;font-size:20px">성적표</h1>', '', demoBar() + '<div class="seg" role="tablist"><button role="tab" data-act="rec" data-v="sim" class="' + (S.rec === 'sim' ? 'on' : '') + '" aria-selected="' + (S.rec === 'sim') + '">2년 시뮬레이션</button><button role="tab" data-act="rec" data-v="live" class="' + (S.rec === 'live' ? 'on' : '') + '" aria-selected="' + (S.rec === 'live') + '">실전 기록</button></div>') +
      '<main class="page">' + body + '<p class="foot-note">과거 성적은 미래 수익을 보장하지 않아요. 투자 참고용 정보이며 투자자문이 아니에요.</p></main>' + menu('record');
  }
  function sw(act, on, label, hint, disabled) {
    return '<div class="item"><span><b>' + label + '</b><small>' + hint + '</small></span><button class="sw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" aria-label="' + label + '" data-act="' + act + '"' + (disabled ? ' disabled' : '') + '></button></div>';
  }
  function condSection(p) {
    var cur = p.preset || (p.rules ? '직접' : ''), list = presetList();
    var chips = list.map(function (x) {
      return '<button role="radio" aria-checked="' + (cur === x.id) + '" class="' + (cur === x.id ? 'on' : '') + '" data-act="preset" data-v="' + esc(x.id) + '">' + esc(x.label) + '</button>';
    }).join('') + '<button role="radio" aria-checked="' + (cur === '직접') + '" class="' + (cur === '직접' ? 'on' : '') + '" data-act="preset" data-v="직접">직접 설정</button>';
    var body = '';
    if (!cur) {
      body = '<p class="info">아직 조건을 고르지 않았어요. 지금은 안정성 보통 이상 · 신호 6점 이상 매수 알림을 받아요. <b>추천</b>을 눌러 보세요.</p>';
    } else if (cur !== '직접') {
      var ps = findPreset(cur) || { desc: '', rules: p.rules || {} }, res = ps.result || {};
      body = '<p class="small" style="margin:0;line-height:1.6;color:var(--sub)">' + esc(ps.desc || '') + '</p>' +
        '<div class="rules">' + ['kr', 'us', 'crypto'].map(function (mk) {
          var r = (p.rules || ps.rules || {})[mk];
          return r ? '<div class="line"><span>' + MARKET[mk] + '</span><span class="small" style="text-align:right">' + esc(ruleText(r, mk)) + '</span></div>' : '';
        }).join('') + '</div>' +
        (Object.keys(res).length ? '<h3 class="sub-h">이 설정으로 지난 2년 (알림마다 100만원씩)</h3>' + ['kr', 'us', 'crypto'].map(function (mk) { return res[mk] ? resultLine(mk, res[mk]) + halvesLine(res[mk]) : ''; }).join('') : '') +
        '<p class="small" style="margin:0">하나씩 바꾸고 싶으면 <b>직접 설정</b>을 누르세요.</p>';
    } else {
      var c = customOf(p);
      body = '<p class="small" style="margin:0;line-height:1.5">시장마다 잘 맞는 조건이 달라서, 시장별로 따로 정해요.</p>' +
        '<div class="seg three" role="tablist" aria-label="시장">' + ['kr', 'us', 'crypto'].map(function (mk) {
          return '<button role="tab" aria-selected="' + (S.cm === mk) + '" class="' + (S.cm === mk ? 'on' : '') + '" data-act="cm" data-v="' + mk + '">' + MARKET[mk] + '</button>';
        }).join('') + '</div>' +
        '<h3 class="sub-h">안정성 지표 <small>켜면 그 조건을 통과한 알림만 받아요</small></h3><div class="list inner">' +
        GUARDS.filter(function (g) { return g[0] !== '실적' || S.cm === 'us'; }).map(function (g) { return sw('g-' + g[0], c.need.indexOf(g[0]) >= 0, g[1], g[2]); }).join('') + '</div>' +
        '<h3 class="sub-h">수익성 지표</h3><div class="list inner">' + sw('card', !!c.card, PROFIT[1], PROFIT[2]) + '</div>' +
        '<h3 class="sub-h">신호 점수 <small>지표 10가지 중 몇 개 이상 맞을 때 받을지</small></h3><div class="grades four" role="radiogroup" aria-label="신호 점수">' +
        SCORES.map(function (n) { return '<button role="radio" aria-checked="' + (c.score === n) + '" class="' + (c.score === n ? 'on' : '') + '" data-act="score" data-v="' + n + '">' + n + '점 이상</button>'; }).join('') + '</div>';
      var R = S.res && S.res.key === S.cm + JSON.stringify(c) ? S.res : null;
      if (!R) setTimeout(loadResearch, 0);
      body += '<h3 class="sub-h">' + MARKET[S.cm] + '을 이 조건으로 지난 2년 (알림마다 100만원씩)</h3>' +
        (!LIVE ? '<p class="small" style="margin:0">앱 연결 후 지난 2년 성적이 여기에 나와요.</p>'
          : !R || R.loading ? '<p class="small" style="margin:0">계산 중…</p>'
          : R.err || !R.data || !R.data[S.cm] ? '<p class="small" style="margin:0">아직 연구 결과가 없어요.</p>'
          : resultLine(S.cm, R.data[S.cm]) + halvesLine(R.data[S.cm]));
    }
    return '<section class="card"><h2 style="font-size:15px">매수 알림 조건</h2><div class="grades four presets" role="radiogroup" aria-label="추천 설정">' + chips + '</div>' + body +
      '<p class="small" style="margin:0;line-height:1.5">과거 성적은 미래 수익을 보장하지 않아요. 홈 화면 목록과 푸시 알림 모두 이 조건대로 걸러져요.</p></section>';
  }
  function pageSettings() {
    var p = prefs(), on = pushOn(), mk = p.markets;
    var help = S.pushHelp ? '<p class="warn">아이폰은 Safari에서 아래쪽 <b>공유 버튼</b> → <b>홈 화면에 추가</b>를 누른 뒤, 홈 화면의 타점노트 아이콘으로 열어야 알림을 켤 수 있어요.</p>' : '';
    var denied = pushOK && Notification.permission === 'denied' ? '<p class="warn">이 휴대폰에서 알림이 차단돼 있어요. 휴대폰 설정 → 알림에서 타점노트(또는 브라우저)를 허용해 주세요.</p>' : '';
    var c = code();
    return top('<h1 style="margin:0;font-size:20px">알림 설정</h1>', '', demoBar()) + '<main class="page">' + help + denied +
      '<section class="list">' + sw('push', on, '푸시 알림 받기', S.busy ? '켜는 중…' : (on ? '켜져 있어요' : '타점이 생기면 바로 알려 드려요'), S.busy) +
      sw('mk-kr', mk.indexOf('kr') >= 0, '국장', '평일 09:15 ~ 15:20') + sw('mk-us', mk.indexOf('us') >= 0, '미장', '평일 밤 (한국 시간)') +
      sw('mk-crypto', mk.indexOf('crypto') >= 0, '코인', '24시간') + sw('sell', p.sell, '매도 알림', '보유 중인 종목이 약해질 때 · 지난 2년 3일 뒤 실제로 내린 비율은 절반 정도였어요') +
      sw('quiet', p.quiet, '방해 금지', '밤 12시 ~ 아침 7시는 조용히') + '</section>' +
      condSection(p) +
      '<section class="card"><div class="line"><h2 style="font-size:15px">구독</h2><span class="tag">준비 중</span></div><p class="small" style="margin:0;line-height:1.6;color:var(--sub)">지금은 무료 베타예요. 정식 구독은 관련 신고를 마친 뒤에 시작하고, 시작 전에 미리 알려 드려요.</p></section>' +
      '<section class="card"><details><summary style="font-size:14px;font-weight:600;cursor:pointer;min-height:28px">투자 위험 고지</summary><ul style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.6;color:var(--sub)">' + NOTICES.map(function (n) { return '<li><b>' + n[0] + '</b> ' + n[1] + '</li>'; }).join('') + '</ul></details>' +
      '<details><summary style="font-size:14px;font-weight:600;cursor:pointer;min-height:28px">개인정보 안내</summary><p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:var(--sub)">이름·전화번호·이메일은 받지 않아요. 푸시 알림을 켜면 이 휴대폰의 알림 주소와 알림 설정만 저장하고, 알림을 끄면 지워요. 입장 코드는 이 휴대폰에만 저장돼요. <a href="privacy.html" style="color:var(--blue);text-decoration:underline">개인정보처리방침 전체 보기</a></p></details>' +
      (LIVE && c && c !== OPEN_CODE ? '<div class="line"><span>초대 코드 ' + esc(c.slice(0, 4)) + '-••••</span><button class="btn ghost" style="width:auto;min-height:40px;padding:0 14px;font-size:13px" data-act="logout">코드 지우기</button></div>' : '') + '</section>' +
      '<p class="foot-note">투자 참고용 정보이며 투자자문이 아니에요. 서비스 제공자는 금융투자업자가 아니며, 개별 상담과 자금 운용은 하지 않아요.</p></main>' + menu('settings');
  }

  // ---------- 그리기 · 이동 ----------
  function route() { var p = location.hash.replace(/^#\/?/, '').split('/'); return { p: p[0] || 'home', id: p[1] }; }
  function render() {
    var r = route(), html;
    if (!S.agreedNow) html = pageWelcome();
    else if (LIVE && !code()) {
      if (S.open === false) html = pageCode();
      else { html = pageWait(); if (S.open === null) setTimeout(checkOpen, 0); }
    }
    else if (r.p === 'alert') html = pageDetail(r.id);
    else if (r.p === 'record') html = pageRecord();
    else if (r.p === 'settings') html = pageSettings();
    else html = pageHome();
    var y = window.scrollY, same = render.last === location.hash;
    $app.innerHTML = html;
    if (!same) window.scrollTo(0, 0); else window.scrollTo(0, y);
    render.last = location.hash;
  }
  var ACT = {
    start: function () { S.agreedNow = true; S.agree = S.agree.map(function () { return false; }); store.set(K.consent, true); render(); if (!LIVE || code()) loadFeed(); },
    tab: function (t) { S.tab = t.dataset.v; render(); },
    rec: function (t) { S.rec = t.dataset.v; render(); },
    span: function (t) { S.liveSpan = t.dataset.v; render(); },
    refresh: function () { if (!S.loading) { toast('새로 불러와요'); loadFeed(); } },
    push: function () { if (pushOn()) disablePush(); else enablePush(); },
    sell: function () { var p = prefs(); p.sell = !p.sell; savePrefs(p); },
    quiet: function () { var p = prefs(); p.quiet = !p.quiet; savePrefs(p); },
    grade: function (t) { var p = prefs(); p.minGrade = t.dataset.v; savePrefs(p); },
    showall: function () { S.showAll = !S.showAll; render(); },
    cm: function (t) { S.cm = t.dataset.v; render(); loadResearch(); },
    preset: function (t) {
      var p = prefs(), id = t.dataset.v;
      if (id === '직접') { p.rules = baseRules(p); p.preset = '직접'; savePrefs(p); loadResearch(); return; }
      var ps = findPreset(id); if (!ps) return;
      p.preset = id; p.rules = clone(ps.rules); savePrefs(p); toast(ps.label + ' 설정을 적용했어요');
    },
    card: function () { editCustom(function (c) { c.card = !c.card; }); },
    score: function (t) { editCustom(function (c) { c.score = +t.dataset.v; }); },
    logout: function () { if (pushOn()) disablePush(); store.del(K.code); store.del(K.feed); S.feed = null; S.open = false; location.hash = '#/'; render(); }
  };
  function editCustom(fn) { var p = prefs(), c = customOf(p); fn(c); p.rules = baseRules(p); p.rules[S.cm] = c; p.preset = '직접'; savePrefs(p); loadResearch(); }
  GUARDS.forEach(function (g) {
    ACT['g-' + g[0]] = function () { editCustom(function (c) { var i = c.need.indexOf(g[0]); if (i >= 0) c.need.splice(i, 1); else c.need.push(g[0]); c.need.sort(function (x, y) { return GUARDS.map(function (z) { return z[0]; }).indexOf(x) - GUARDS.map(function (z) { return z[0]; }).indexOf(y); }); }); };
  });
  ['kr', 'us', 'crypto'].forEach(function (m) {
    ACT['mk-' + m] = function () {
      var p = prefs(), i = p.markets.indexOf(m);
      if (i >= 0) p.markets.splice(i, 1); else p.markets.push(m);
      savePrefs(p);
    };
  });
  $app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (t && !t.disabled && ACT[t.dataset.act]) { e.preventDefault(); ACT[t.dataset.act](t); }
  });
  $app.addEventListener('change', function (e) {
    var v = e.target.getAttribute('data-agree');
    if (v == null) return;
    if (v === 'all') { var on = e.target.checked; S.agree = S.agree.map(function () { return on; }); }
    else S.agree[+v] = e.target.checked;
    render();
  });
  $app.addEventListener('submit', function (e) {
    if (e.target.getAttribute('data-form') !== 'code') return;
    e.preventDefault();
    var c = (e.target.code.value || '').trim().toUpperCase();
    if (!c) return;
    S.busy = true; S.codeErr = ''; render();
    rpc('app_check', { p_code: c }).then(function (ok) {
      if (ok === true) { store.set(K.code, c); S.feed = null; location.hash = '#/'; loadFeed(); }
      else S.codeErr = '코드를 다시 확인해 주세요. 대소문자와 줄표(-)는 상관없어요.';
    }).catch(function () { S.codeErr = '확인하지 못했어요. 인터넷 연결을 확인해 주세요.'; })
      .then(function () { S.busy = false; render(); });
  });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') loadFeed(); });
  setInterval(function () { if (document.visibilityState === 'visible' && !/settings|alert/.test(location.hash)) loadFeed(); }, 60000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // ---------- 예시 데이터 (앱 연결 전에만) ----------
  var now = new Date(), ago = function (min) { return new Date(now - min * 60000).toISOString(); };
  var DEMO = {
    now: now.toISOString(), beat: now.toISOString(),
    alerts: [
      { id: 4, created_at: ago(3), market: 'us', category: '반도체', name: '엔비디아 NVDA', side: 'buy', grade: '높음', score: 8, passed: 6, total: 6, misses: [],
        reason: '01:51 VWAP 돌파', price: 211.68, buy: 210.71, stop: 208.83, sell: 214.05, trail: 6.12, loss: 1.88, qty: '1주', half: true, hist: { n: 23, win: 52, avg: 1.4, src: '종목' } },
      { id: 3, created_at: ago(40), market: 'kr', category: '반도체', name: '삼성전자', side: 'buy', grade: '보통', score: 7, passed: 4, total: 6, misses: ['변동큼', '이미오름'],
        reason: '10:12 단기선 상향', price: 190500, buy: 189800, stop: 187300, sell: 194500, trail: 9800, loss: 5000, qty: '2주', half: true, hist: { n: 17, win: 47, avg: 0.6, src: '종목' } },
      { id: 2, created_at: ago(95), market: 'us', category: '전기차', name: '테슬라 TSLA', side: 'sell', score: 7, reason: '23:58 VWAP 이탈', price: 408.2, rebound: 412.3 },
      { id: 1, created_at: ago(180), market: 'crypto', category: '알트코인', name: '솔라나', side: 'buy', grade: '보통', score: 7, passed: 5, total: 6, misses: ['기록부족'],
        reason: '09:30 단기선 상향', price: 380190, buy: 377900, stop: 374800, sell: 383300, trail: 9627, loss: 3281, qty: '40만원어치', half: true, hist: { n: 31, win: 48, avg: 0.9, src: '시장' } }
    ],
    sim: { made: now.toISOString(), markets: [
      { market: 'kr', tickers: 7, cur: 8, new: { total: -9, n: 4, win: 0 }, old: { total: -55, n: 224, win: 74 }, hold: 1087, halves: [-7, -8], grades: {}, sell: { hits: 5, n: 297 } },
      { market: 'us', tickers: 9, cur: 8, new: { total: 14, n: 5, win: 3 }, old: { total: -32, n: 344, win: 105 }, hold: 740, halves: [2, 13], grades: {}, sell: { hits: 5, n: 326 } },
      { market: 'crypto', tickers: 4, cur: 8, new: { total: 7, n: 8, win: 2 }, old: { total: -169, n: 148, win: 31 }, hold: -199, halves: [9, -2], grades: {}, sell: { hits: 5, n: 610 } }
    ] },
    live: { week: { us: { '높음': { n: 2, win: 2, sum: 1.2 }, '보통': { n: 3, win: 1, sum: -0.5 } } }, all: {}, held: 1, waiting: 2, paused: [] }
  };

  render();
  if (store.get(K.consent, false)) loadFeed();

  // 시작 화면: 앱을 열 때 1초쯤 보여 주고 사라짐 (처음 쓰는 사람은 그다음 안내·동의 화면)
  var splash = document.getElementById('splash');
  if (splash) {
    setTimeout(function () {
      splash.classList.add('hide');
      setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 400);
    }, 1100);
  }
})();
