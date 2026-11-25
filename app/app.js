// 타점노트 무료 베타 앱 (설치형 웹앱)
// config.js(배포할 때 자동 생성)에 데이터베이스 주소가 있으면 실제 데이터, 없으면 예시 데이터로 보여 줘요.
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var LIVE = !!(CFG.supabaseUrl && CFG.supabaseKey);
  var $app = document.getElementById('app');
  var K = { consent: 'tn_consent_v1', code: 'tn_code', prefs: 'tn_prefs', push: 'tn_push', feed: 'tn_feed', jr: 'tn_journal', briefHide: 'tn_brief_hide', hold: 'tn_hold', hind: 'tn_hold_ind', broker: 'tn_broker', htrack: 'tn_hold_track', nseen: 'tn_notice_seen', devkey: 'tn_dev_key' };
  var MARKET = { kr: '국장', us: '미장', crypto: '코인' };
  var MISS = { '시장약세': '시장 흐름 약함', '추세약세': '종목 추세 약함', '이미오름': '이미 많이 오름', '변동큼': '변동성 큼',
    '실적임박': '실적 발표 임박', '기록부족': '과거 기록 부족', '과거손실': '과거 성적 손실', '🟢연속손실': '최근 연속 손실' };
  var GRADE_RANK = { '낮음': 0, '보통': 1, '높음': 2 };
  var DEFAULT_PREFS = { markets: ['kr', 'us', 'crypto'], minGrade: '보통', sell: true, sellAll: false, quiet: false, brief: true, preset: '', rules: null };
  // 매수 알림 조건: 안전 점검 지표 5가지 + 과거 성적 1가지 + 신호 점수
  var GUARDS = [
    ['시장', '시장 분위기 좋을 때만', '코스피200·S&P500·비트코인이 최근 200일 평균보다 위일 때만 (시장 전체가 오르는 중)'],
    ['추세', '오르는 종목만', '주가가 50일·200일 평균보다 위에 있을 때만 (그 종목이 오르는 흐름)'],
    ['눌림', '잠깐 내렸을 때만', '이미 많이 오른 자리는 빼고, 오르다 잠깐 쉬어 갈 때만'],
    ['변동성', '크게 흔들릴 땐 쉬기', '평소보다 크게 오르내리는 날은 빼요'],
    ['실적', '실적 발표 직전 피하기', '미장만 · 실적 발표 10일 전부터 빼요 (발표 날 급등락 위험)']];
  var PROFIT = ['성적', '과거에 잘 맞던 자리만', '같은 종목(기록이 적으면 같은 시장)의 지난 알림이 평균 +0.3% 이상 벌었을 때만'];
  var SCORES = [5, 6, 7, 8];
  var MISS_OF = { '시장': '시장약세', '추세': '추세약세', '눌림': '이미오름', '변동성': '변동큼', '실적': '실적임박' };
  var FALLBACK_PRESETS = [
    { id: '추천', label: '추천', desc: '과거 백테스트에서 가장 고르게 좋았던 조합이에요.',
      rules: { kr: { score: 6, need: ['시장', '추세'], card: false }, us: { score: 6, need: ['시장', '추세'], card: false }, crypto: { score: 6, need: ['시장', '추세'], card: false } } },
    { id: '안정', label: '신중하게', desc: '조건을 더 엄격하게 켜서 알림이 드물어요.',
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
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 14.5h2"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="#333D4B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="#333D4B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="#191F28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="#0B6E3F" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="통과"><path d="M5 12l5 5 9-10"/></svg>',
    no: '<svg viewBox="0 0 24 24" fill="none" stroke="#A63F0A" stroke-width="2.6" stroke-linecap="round" role="img" aria-label="부족"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    logo: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="타점노트 로고"><path d="M3 17l5-5 4 4 8-9"/><circle cx="20" cy="7" r="1.6" fill="#FF6B6B" stroke="none"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
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
      if (f && f.fut) S.fut = f.fut;
      if (store.get(K.prefs, null) === null) {                       // 처음 쓰는 사람은 추천 설정으로 시작
        var ps = findPreset('추천');
        if (ps) { var np = prefs(); np.preset = '추천'; np.rules = clone(ps.rules); store.set(K.prefs, np); }
      }
      var keep = {}; for (var k in f) keep[k] = f[k];
      keep.alerts = (f.alerts || []).slice(0, 60); store.set(K.feed, keep);   // 인터넷이 끊겼을 때 보여 줄 마지막 내용
    }).catch(function (e) {
      if (e.invalid) {
        S.open = code() === OPEN_CODE ? false : null;
        store.del(K.code); S.codeErr = '이 초대 코드는 더 이상 쓸 수 없어요. 새 코드를 넣어 주세요.';
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
    if (!CFG.vapidPublicKey) { toast('알림 준비가 아직 안 됐어요. 잠시 뒤 다시 해 주세요'); return; }
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
  function linked(a) { return !!(a.flags && a.flags.linked) || !!heldBy(a); }   // 최근 매수 알림·실전 보유·내 매매일지 보유
  function shown(a, p) {
    if (a.side === 'sell' && (!p.sell || (!p.sellAll && !linked(a)))) return false;
    var rule = p.rules && p.rules[a.market];
    if (rule) return passes(a, rule);
    if ((a.score || 0) < 6) return false;                                       // 예전 설정: 등급만
    return a.side !== 'buy' || GRADE_RANK[a.grade || '높음'] >= GRADE_RANK[p.minGrade || '보통'];
  }
  function ruleText(r, market) {
    var need = (r.need || []).filter(function (g) { return market === 'us' || g !== '실적'; });
    return (need.length ? need.join('·') : '점검 조건 없음') + (r.card ? ' · 과거 성적' : '') + ' · 신호 강도 ' + r.score * 10 + '% 이상';
  }
  function statKey(p) { return p.rules ? JSON.stringify(p.rules) : ''; }
  function loadStats() {
    var p = prefs(), key = statKey(p);
    if (!key || (S.st && S.st.key === key)) return;
    S.st = { key: key, data: null, loading: LIVE };
    if (!LIVE) return;
    rpc('app_research_rules', { p_code: code(), p_rules: p.rules })
      .then(function (d) { if (S.st && S.st.key === key) { S.st.data = d || {}; S.st.loading = false; render(); } })
      .catch(function () { if (S.st && S.st.key === key) { S.st.loading = false; S.st.err = true; render(); } });
  }
  function curStats(p) {
    var key = statKey(p);
    if (!key) return null;
    if (!S.st || S.st.key !== key) { setTimeout(loadStats, 0); return { loading: true }; }
    return S.st;
  }
  // 수익성 = 알림마다 100만원씩 샀을 때 한 번 평균 수익률(합계 만원 ÷ 알림 수 = %)
  // 안정성 = 알림이 있었던 달 중 수익 난 달 비율
  function combine(list) {
    var o = { n: 0, wins: 0, total: 0, h1: 0, h2: 0, mon: {}, hasMon: true };
    list.forEach(function (x) {
      o.n += x.n || 0; o.wins += x.wins || 0; o.total += x.total || 0; o.h1 += x.h1 || 0; o.h2 += x.h2 || 0;
      if (!x.mon) { if (x.n) o.hasMon = false; return; }
      for (var k in x.mon) o.mon[k] = (o.mon[k] || 0) + x.mon[k];
    });
    return o;
  }
  function stat(x) {
    var months = x.mon ? Object.keys(x.mon) : [], pos = months.filter(function (k) { return x.mon[k] > 0; }).length;
    return { profit: x.n ? x.total / x.n : null, stable: x.n && x.mon && x.hasMon !== false && months.length ? pos / months.length * 100 : null,
      months: months.length, pos: pos, win: x.n ? x.wins / x.n * 100 : null };
  }
  function pct(v) {
    if (v == null || isNaN(v)) return '-';
    var a = Math.abs(v);
    return (v > 0.004 ? '+' : v < -0.004 ? '-' : '') + (a < 1 ? a.toFixed(2) : a.toFixed(1)) + '%';
  }
  function perHundred(v) {          // 100만원당 평균 손익 (원)
    if (v == null) return '-';
    var w = Math.round(v * 10000);
    return (w > 0 ? '+' : w < 0 ? '-' : '') + Math.abs(w).toLocaleString('ko-KR') + '원';
  }
  function marketStat(mk, x) {
    if (!x || !x.n) return '<div class="mk-row"><div class="line"><b class="mk">' + MARKET[mk] + '</b><span class="small">이 조건에 맞는 알림 없음</span></div></div>';
    var t = stat(x), sp = x.span ? spanText([x]) : '';
    return '<div class="mk-row"><div class="line"><span><b class="mk">' + MARKET[mk] + '</b> 수익성 <b class="' + tone(t.profit) + '">' + pct(t.profit) + '</b> · 안정성 <b>' + (t.stable == null ? '-' : Math.round(t.stable) + '%') + '</b></span>' +
      '<b class="' + tone(x.total) + '">' + manwon(x.total) + '</b></div>' +
      '<p class="small" style="margin:0">' + (sp ? sp + ' · ' : '') + x.n + '번 · 이긴 비율 ' + Math.round(t.win) + '% · 앞 절반 <b class="' + tone(x.h1) + '">' + manwon(x.h1) + '</b> · 뒤 절반 <b class="' + tone(x.h2) + '">' + manwon(x.h2) + '</b>' +
      (x.dd != null ? ' · 가장 크게 잃은 구간 ' + (x.dd >= 0.1 ? '-' + manwon(x.dd).replace('+', '') : '없음') : '') +
      (x.n < 30 ? '<br><span class="warn-t">알림이 ' + x.n + '번뿐이라 숫자를 믿기 어려워요</span>' : '') + '</p></div>';
  }
  function ym(iso) { var d = new Date(iso); return isNaN(d) ? '' : kst(d, { year: 'numeric' }).replace(/[^0-9]/g, '') + '.' + kst(d, { month: '2-digit' }).replace(/[^0-9]/g, ''); }
  function spanText(list) {         // 실제 백테스트 기간 (국장·미장 약 3년, 코인 2년)
    var st = null, en = null;
    list.forEach(function (x) { if (x && x.span) { if (!st || x.span[0] < st) st = x.span[0]; if (!en || x.span[1] > en) en = x.span[1]; } });
    return st && en ? ym(st) + '~' + ym(en) : '';
  }
  function statSection(p) {
    var R = curStats(p), mks = ['kr', 'us', 'crypto'].filter(function (mk) { return p.markets.indexOf(mk) >= 0; });
    var per = R && R.data ? spanText(mks.map(function (mk) { return R.data[mk]; })) : '';
    var head = '<div class="line"><h2 style="font-size:15px">내 설정 예상 성적</h2><span class="small">' + (per ? per + ' ' : '과거 ') + '백테스트</span></div>';
    var msg = !p.rules ? '아래에서 <b>추천</b>이나 <b>직접 설정</b>을 고르면 수익성과 안정성이 나와요.'
      : !LIVE ? '앱 연결 후 과거 성적이 여기에 나와요.'
      : !mks.length ? '설정에서 국장·미장·코인을 모두 꺼 두었어요.'
      : R.loading ? '계산 중…'
      : R.err || !R.data ? '성적을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.' : '';
    if (msg) return '<section class="card mystat">' + head + '<p class="small" style="margin:0">' + msg + '</p></section>';
    var list = mks.map(function (mk) { return R.data[mk] || { n: 0, wins: 0, total: 0, h1: 0, h2: 0, mon: {} }; });
    var all = combine(list), t = stat(all);
    var big = !all.n ? '<p class="info">백테스트 기간 동안 이 조건에 맞는 매수 알림이 없었어요. 조건을 조금 풀어 보세요.</p>'
      : '<div class="big2"><div><span>수익성</span><strong class="' + tone(t.profit) + '">' + pct(t.profit) + '</strong><em>한 번 살 때 평균<br>100만원당 ' + perHundred(t.profit) + '</em></div>' +
        '<div><span>안정성</span><strong>' + (t.stable == null ? '-' : Math.round(t.stable) + '%') + '</strong><em>' + (t.stable == null ? '곧 계산돼요' : '수익 난 달 비율<br>' + t.months + '달 중 ' + t.pos + '달') + '</em>' +
        (t.stable == null ? '' : '<div class="meter" aria-hidden="true"><i style="width:' + Math.round(t.stable) + '%"></i></div>') + '</div></div>' +
        '<div class="kv"><div class="line"><span>알림 수</span><b>' + all.n + '번</b></div>' +
        '<div class="line"><span>이긴 비율</span><b>' + Math.round(t.win) + '%</b></div>' +
        '<div class="line"><span>합계 (알림마다 100만원)</span><b class="' + tone(all.total) + '">' + manwon(all.total) + '</b></div>' +
        '<div class="line"><span>기간 앞 절반 / 뒤 절반</span><b><span class="' + tone(all.h1) + '">' + manwon(all.h1) + '</span> / <span class="' + tone(all.h2) + '">' + manwon(all.h2) + '</span></b></div></div>';
    var off = ['kr', 'us', 'crypto'].filter(function (mk) { return mks.indexOf(mk) < 0; }).map(function (mk) { return MARKET[mk]; });
    return '<section class="card mystat">' + head + big +
      '<h3 class="sub-h">시장별</h3>' + mks.map(function (mk) { return marketStat(mk, R.data[mk]); }).join('') +
      (off.length ? '<p class="small" style="margin:0">설정에서 끈 ' + off.join('·') + '은 빼고 계산했어요.</p>' : '') + '</section>';
  }

    // ---------- 장 시간 · 휴장일 ----------
  // 미장: NYSE 공식 발표(2026·2027) / 국장: 2026년 남은 휴장일 + 2027년 관공서 공휴일 기준(거래소 공식 발표 전)
  var SESS = { kr: { tz: 'Asia/Seoul', open: 540, close: 930 }, us: { tz: 'America/New_York', open: 570, close: 960 } };
  var HOLI = {
    us: { '2026-11-26': '추수감사절', '2026-12-25': '크리스마스', '2027-01-01': '새해', '2027-01-18': '마틴 루서 킹 데이', '2027-02-15': '대통령의 날',
      '2027-03-26': '성금요일', '2027-05-31': '메모리얼 데이', '2027-06-18': '준틴스', '2027-07-05': '독립기념일', '2027-09-06': '노동절',
      '2027-11-25': '추수감사절', '2027-12-24': '크리스마스' },
    kr: { '2026-12-25': '성탄절', '2026-12-31': '연말 휴장', '2027-01-01': '신정', '2027-02-08': '설 연휴', '2027-02-09': '설 대체휴일',
      '2027-03-01': '삼일절', '2027-05-03': '노동절 대체휴일', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날', '2027-07-19': '제헌절 대체휴일',
      '2027-08-16': '광복절 대체휴일', '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴', '2027-10-04': '개천절 대체휴일',
      '2027-10-11': '한글날 대체휴일', '2027-12-27': '성탄절 대체휴일', '2027-12-31': '연말 휴장' }
  };
  var EARLY = { us: { '2026-11-27': 780, '2026-12-24': 780, '2027-11-26': 780 } };   // 오후 1시 조기 마감
  function ymd(y, m, d) { return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; }
  function tzParts(d, tz) {
    var o = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d).forEach(function (x) { o[x.type] = x.value; });
    return { y: +o.year, m: +o.month, d: +o.day, min: (+o.hour % 24) * 60 + (+o.minute) };
  }
  function tzOffset(d, tz) { var o = tzParts(d, tz); return Math.round((Date.UTC(o.y, o.m - 1, o.d, 0, o.min) - d.getTime()) / 60000); }
  function at(tz, y, m, d, min) {                  // 그 시장 시간대의 y-m-d hh:mm → 실제 시각
    var guess = Date.UTC(y, m - 1, d, 0, min);
    return new Date(guess - tzOffset(new Date(guess), tz) * 60000);
  }
  function marketHours(mk, now) {
    if (mk === 'crypto') return { open: true, text: '24시간' };
    var ss = SESS[mk], p = tzParts(now, ss.tz), key = ymd(p.y, p.m, p.d);
    var wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(), holi = HOLI[mk][key];
    var close = (EARLY[mk] || {})[key] || ss.close;
    if (wd > 0 && wd < 6 && !holi && p.min >= ss.open && p.min < close)
      return { open: true, text: hm(at(ss.tz, p.y, p.m, p.d, close).toISOString()) + (close !== ss.close ? ' 조기 마감' : ' 마감') };
    for (var i = 0; i < 12; i++) {
      var dd = new Date(Date.UTC(p.y, p.m - 1, p.d + i)), w = dd.getUTCDay(), y = dd.getUTCFullYear(), m = dd.getUTCMonth() + 1, d = dd.getUTCDate();
      if (w === 0 || w === 6 || HOLI[mk][ymd(y, m, d)] || (i === 0 && p.min >= ss.open)) continue;
      var t = at(ss.tz, y, m, d, ss.open);
      var sameDay = kst(t, { day: 'numeric' }) === kst(now, { day: 'numeric' });
      var tomorrow = kst(t, { day: 'numeric' }) === kst(new Date(now.getTime() + 864e5), { day: 'numeric' });
      var early = (EARLY[mk] || {})[ymd(y, m, d)];
      return { open: false, holi: holi && wd > 0 && wd < 6 ? holi : '',
        text: (holi && wd > 0 && wd < 6 ? '휴장(' + holi + ') · ' : '') + (sameDay ? '' : tomorrow ? '내일 ' : kst(t, { weekday: 'short' }) + ' ') + hm(t.toISOString()) + ' 개장' + (early ? ' · ' + hm(at(ss.tz, y, m, d, early).toISOString()) + ' 조기 마감' : '') };
    }
    return { open: false, text: '휴장' };
  }
  function hoursLine(p) {
    var now = new Date();
    return '<p class="hours" aria-label="장 시간 (한국 시간)">' + ['kr', 'us', 'crypto'].filter(function (mk) { return p.markets.indexOf(mk) >= 0; }).map(function (mk) {
      var h = marketHours(mk, now);
      return '<span><i class="' + (h.open ? 'on' : '') + '"></i>' + MARKET[mk] + ' ' + (h.open ? '장중 · ' : '') + h.text + '</span>';
    }).join('') + '</p>';
  }

  // ---------- 아침 브리핑 ----------
  function briefCard(b) {
    if (!b || !b.day) return '';
    var age = (Date.now() - new Date(b.at).getTime()) / 36e5;
    if (!(age < 20) || store.get(K.briefHide, '') === b.day) return '';
    var d = new Date(b.at), wd = '일월화수목금토'.charAt(new Date(b.day + 'T12:00:00+09:00').getDay());
    var idx = (b.idx || []).map(function (x) {
      var val = x.name === '원/달러' ? Math.round(x.last).toLocaleString('ko-KR') + '원' : (x.chg > 0 ? '+' : '') + Number(x.chg).toFixed(1) + '%';
      return '<div><span>' + esc(x.name) + (x.h24 ? ' <small>24시간</small>' : '') + '</span><b class="' + (x.name === '원/달러' ? '' : tone(x.chg)) + '">' + val + '</b></div>';
    }).join('');
    var flow = Object.keys(b.flow || {}).map(function (m) { return MARKET[m] + ' ' + (b.flow[m] ? '<b class="fl-ok">좋음</b>' : '<b class="fl-weak">약함</b>'); }).join(' · ');
    var a = b.alerts || {}, c = b.closed || {};
    var rows = [];
    if (flow) rows.push('<div class="line"><span>시장 흐름</span><span>' + flow + '</span></div>');
    rows.push('<div class="line"><span>새 타점 (24시간)</span><b>매수 ' + (a.buy || 0) + ' · 매도 ' + (a.sell || 0) + '</b></div>');
    rows.push('<div class="line"><span>알림 실전 기록 <small class="small">100만원씩 가정</small></span><b>보유 ' + (b.held || 0) + ' · 대기 ' + (b.waiting || 0) +
      (c.n ? ' · 끝남 ' + c.n + '번 <span class="' + tone(c.sum) + '">' + manwon(c.sum) + '</span>' : '') + '</b></div>');
    if (b.earn && b.earn.length) rows.push('<div class="line"><span>실적 예정</span><b style="text-align:right">' + b.earn.slice(0, 4).map(function (e) { return esc(e.name) + ' ' + e.day.slice(5).replace('-', '/'); }).join(', ') + '</b></div>');
    return '<section class="card brief"><div class="line"><h2 style="font-size:15px">☀️ 아침 브리핑</h2><span class="small">' + kst(d, { month: 'numeric', day: 'numeric' }).replace(/\.\s*/g, '/').replace(/\/$/, '') + '(' + wd + ') ' + hm(b.at) +
      ' <button class="x" data-act="briefhide" aria-label="오늘 브리핑 닫기">' + ICON.x + '</button></span></div>' +
      (idx ? '<div class="idx">' + idx + '</div>' : '') + rows.join('') + '</section>';
  }

  // ---------- 내 매매일지 (이 휴대폰에만 저장) ----------
  function jr() { var x = store.get(K.jr, []); return Array.isArray(x) ? x : []; }
  function jrSave(x) { store.set(K.jr, x); }
  function amt(m, v) {
    if (v == null || isNaN(v)) return '-';
    var s = v > 0 ? '+' : v < 0 ? '-' : '', a = Math.abs(v);
    return m === 'us' ? s + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 2 }) : s + Math.round(a).toLocaleString('ko-KR') + '원';
  }
  function jret(e) { return e.out ? e.out.price / e.buy - 1 : null; }
  function heldBy(a) { return jr().filter(function (e) { return !e.out && e.market === a.market && e.name === a.name; })[0]; }
  function jForm(kind, e, a) {          // kind: buy(샀어요) / sell(팔았어요)
    var m = e ? e.market : a.market;
    if (kind === 'buy') {
      var dflt = m === 'us' ? 1000 : 1000000;
      return '<form data-form="jbuy" class="jform" data-id="' + esc(a.id) + '"><label>산 가격 (' + (m === 'us' ? '달러' : '원') + ')<input name="price" type="number" inputmode="decimal" step="any" min="0" required value="' + esc(a.buy || a.price) + '"></label>' +
        '<label>투자 금액 (' + (m === 'us' ? '달러' : '원') + ')<input name="amount" type="number" inputmode="decimal" step="any" min="0" required value="' + dflt + '"></label>' +
        '<div class="two"><button type="button" class="btn ghost" data-act="jcancel">취소</button><button class="btn" type="submit">기록하기</button></div></form>';
    }
    return '<form data-form="jsell" class="jform" data-id="' + esc(e.id) + '"><label>판 가격 (' + (m === 'us' ? '달러' : '원') + ')<input name="price" type="number" inputmode="decimal" step="any" min="0" required value="' + esc(e.sell || e.buy) + '"></label>' +
      '<div class="two"><button type="button" class="btn ghost" data-act="jcancel">취소</button><button class="btn" type="submit">팔았어요</button></div></form>';
  }
  function jRow(e) {
    var m = e.market, r = jret(e);
    if (!e.out) {
      var plan = (e.stop ? '손절가 <b class="blue">' + money(m, e.stop) + '</b>' : '') + (e.sell ? ' · ' + (e.half ? '1차 매도' : '매도') + ' <b class="red">' + money(m, e.sell) + '</b>' : '');
      return '<section class="card jrow"><div class="line"><b class="name">' + esc(e.name) + '</b><span class="small">' + MARKET[m] + ' · ' + dayLabel(e.at) + ' 매수</span></div>' +
        '<div class="line"><span>산 가격 ' + money(m, e.buy) + '</span><span>' + amt(m, e.amount).replace('+', '') + '</span></div>' +
        (plan ? '<p class="small" style="margin:0">' + plan + '</p>' : '') +
        (S.jsell === e.id ? jForm('sell', e) : '<div class="two"><button class="btn ghost" data-act="jdel" data-v="' + esc(e.id) + '">' + (S.jdel === e.id ? '정말 지울까요?' : '지우기') + '</button><button class="btn" data-act="jsellopen" data-v="' + esc(e.id) + '">팔았어요</button></div>') + '</section>';
    }
    return '<div class="jdone"><span><b>' + esc(e.name) + '</b><small>' + MARKET[m] + ' · ' + money(m, e.buy) + ' → ' + money(m, e.out.price) + ' · ' + dayLabel(e.out.at) + '</small></span>' +
      '<span style="text-align:right"><b class="' + tone(r * 100) + '">' + (r > 0 ? '+' : '') + (r * 100).toFixed(1) + '%</b><small class="' + tone(r) + '">' + amt(m, e.amount * r) + '</small></span>' +
      '<button class="x" data-act="jdel" data-v="' + esc(e.id) + '" aria-label="기록 지우기">' + (S.jdel === e.id ? '<small>지울까요?</small>' : ICON.x) + '</button></div>';
  }
  var JBACKUP = '<section class="card"><div class="line"><h2 style="font-size:15px">백업</h2><span class="small">휴대폰을 바꾸거나 앱 데이터를 지우기 전에</span></div>' +
    '<div class="two"><button class="btn ghost" data-act="jexport">내보내기</button><label class="btn ghost" style="cursor:pointer">가져오기<input type="file" accept="application/json,.json" data-imp hidden></label></div></section>';
  function journalSection() {
    var all = jr(), open = all.filter(function (e) { return !e.out; }), done = all.filter(function (e) { return e.out; }).sort(function (x, y) { return x.out.at < y.out.at ? 1 : -1; });
    var head = '<p class="foot-note" style="margin:0 4px">타점에서 <b>샀어요</b>를 누르면 여기에 적혀요. 판 다음 <b>팔았어요</b>를 누르면 손익·승률을 자동으로 계산해요. 기록은 이 휴대폰에만 저장돼요.</p>';
    if (!all.length) return head + '<p class="empty">아직 기록이 없어요.<br>타점을 눌러 <b>샀어요 · 매매일지에 적기</b>를 눌러 보세요.</p>' + JBACKUP;
    var rets = done.map(jret), wins = rets.filter(function (r) { return r > 0; }).length;
    var sum = { kr: 0, us: 0 }; done.forEach(function (e) { sum[e.market === 'us' ? 'us' : 'kr'] += e.amount * jret(e); });
    var avg = rets.length ? rets.reduce(function (x, y) { return x + y; }, 0) / rets.length * 100 : null;
    var summary = '<section class="card"><h2 style="font-size:15px">내 성적</h2>' + (done.length ?
      '<div class="big2"><div><span>평균 수익률</span><strong class="' + tone(avg) + '">' + pct(avg) + '</strong><em>판 거래 ' + done.length + '번</em></div><div><span>이긴 비율</span><strong>' + Math.round(wins / done.length * 100) + '%</strong><em>' + done.length + '번 중 ' + wins + '번 이익</em></div></div>' +
      (done.some(function (e) { return e.market !== 'us'; }) ? '<div class="line"><span>원화 손익 합계</span><b class="' + tone(sum.kr) + '">' + amt('kr', sum.kr) + '</b></div>' : '') +
      (done.some(function (e) { return e.market === 'us'; }) ? '<div class="line"><span>달러 손익 합계</span><b class="' + tone(sum.us) + '">' + amt('us', sum.us) + '</b></div>' : '')
      : '<p class="small" style="margin:0">아직 판 거래가 없어요. 팔면 손익과 이긴 비율이 나와요.</p>') + '</section>';
    return head + summary + (open.length ? '<h3 class="sub-h" style="margin:6px 4px 0">보유 중 ' + open.length + '</h3>' + open.map(jRow).join('') : '') +
      (done.length ? '<h3 class="sub-h" style="margin:6px 4px 0">끝난 거래</h3><section class="card" style="gap:0">' + done.map(jRow).join('') + '</section>' : '') + JBACKUP;
  }
  function jValid(e) {
    return e && typeof e.id === 'string' && typeof e.name === 'string' && e.name.length <= 80 && ['kr', 'us', 'crypto'].indexOf(e.market) >= 0 &&
      e.buy > 0 && e.amount > 0 && typeof e.at === 'string' && (!e.out || e.out.price > 0);
  }
  function jImport(file) {
    if (!file || file.size > 1e6) { toast('파일을 확인해 주세요'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result), items = Array.isArray(d) ? d : d.items;
        if (!Array.isArray(items)) throw 0;
        var list = jr(), have = {}, add = 0;
        list.forEach(function (e) { have[e.id] = 1; });
        items.forEach(function (e) {
          if (!jValid(e) || have[e.id]) return;
          list.push({ id: e.id, aid: e.aid, name: e.name, market: e.market, buy: +e.buy, amount: +e.amount, stop: e.stop, sell: e.sell, half: !!e.half, at: e.at,
            out: e.out ? { price: +e.out.price, at: String(e.out.at || e.at) } : null });
          have[e.id] = 1; add++;
        });
        jrSave(list); toast(add ? add + '건 가져왔어요' : '새로 가져올 기록이 없어요'); render();
      } catch (_) { toast('타점노트 백업 파일이 아니에요'); }
    };
    rd.readAsText(file);
  }
  function journalBox(a) {              // 타점 상세 화면 아래
    var mine = jr().filter(function (e) { return e.aid === a.id; })[0], held = heldBy(a);
    if (a.side === 'buy') {
      if (mine) return '<section class="card"><div class="line"><h2 style="font-size:15px">내 매매일지</h2><span class="tag">' + (mine.out ? '판 거래' : '보유 중') + '</span></div><p class="small" style="margin:0">' + money(a.market, mine.buy) + '에 ' + amt(a.market, mine.amount).replace('+', '') + ' 샀다고 적었어요.</p><a class="link-row" href="#/record/mine">매매일지에서 보기 →</a></section>';
      return '<section class="card"><h2 style="font-size:15px">내 매매일지</h2>' + (S.jbuy === String(a.id) ? jForm('buy', null, a) : '<button class="btn ghost" data-act="jbuyopen" data-v="' + esc(a.id) + '">샀어요 · 매매일지에 적기</button>') + '</section>';
    }
    if (!held) return '';
    var r = a.price / held.buy - 1;
    return '<section class="card held"><div class="line"><h2 style="font-size:15px">내가 보유 중이에요</h2><span class="tag">매매일지</span></div><p class="small" style="margin:0">' + money(a.market, held.buy) + '에 샀어요 · 알림 때 가격 기준 <b class="' + tone(r) + '">' + (r > 0 ? '+' : '') + (r * 100).toFixed(1) + '%</b></p>' +
      (S.jsell === held.id ? jForm('sell', held) : '<button class="btn" data-act="jsellopen" data-v="' + esc(held.id) + '">팔았어요</button>') + '</section>';
  }

  // ---------- 내 보유 (수량·단가는 이 휴대폰에만, 서버에는 종목 코드만) ----------
  var HIND = [['trend', '단기 상승세'], ['mid', '중기 상승세'], ['align', '상승 정렬'], ['mom', '사는 힘 우세'],
    ['macd', '오름 가속'], ['vol', '거래 활발'], ['mkt', '시장 좋음'], ['calm', '덜 흔들림']];
  var HIND_HELP = { trend: '최근 20일 평균 가격보다 위 (20일선)', mid: '최근 60일 평균 가격보다 위 (60일선)', align: '20일 평균이 60일 평균보다 위 · 오르는 쪽으로 정렬',
    mom: '사려는 힘이 파는 힘보다 셈 (RSI 50 이상)', macd: '오르는 속도가 빨라지는 중 (MACD)', vol: '오늘 거래량이 최근 20일 평균보다 많음',
    mkt: '시장 대표 지수가 200일 평균보다 위', calm: '최근 가격 흔들림이 평소보다 작음 (변동성)' };
  var HIND_DEF = ['trend', 'align', 'mom', 'macd', 'mkt'];
  // 증권사·거래소 앱 (패키지 이름은 구글 플레이에서 확인한 값)
  var BROKERS = {
    toss: { name: '토스증권', pkg: 'viva.republica.toss', url: function (h) { return h.market === 'kr' ? 'https://tossinvest.com/stocks/A' + h.code : null; }, web: 'https://tossinvest.com' },
    kiwoom: { name: '키움증권', pkg: 'com.kiwoom.heromts' },
    mirae: { name: '미래에셋', full: '미래에셋증권', pkg: 'com.miraeasset.trade' },
    samsung: { name: '삼성증권', pkg: 'com.samsungpop.android.mpop' },
    kis: { name: '한국투자', full: '한국투자증권', pkg: 'com.truefriend.neosmartarenewal' },
    nh: { name: '나무증권', full: 'NH 나무증권', pkg: 'com.wooriwm.txsmart' },
    kb: { name: 'KB증권', full: 'KB증권 M-able', pkg: 'com.kbsec.mts.iplustarngm2' },
    shinhan: { name: '신한증권', full: '신한 SOL증권', pkg: 'com.shinhaninvest.smtdesk' },
    kakaopay: { name: '카카오페이', full: '카카오페이증권', pkg: 'com.kakaopay.app' },
    hana: { name: '하나증권', pkg: 'com.hanasec.stock', q: '하나증권' },
    upbit: { name: '업비트', pkg: 'com.dunamu.exchange', url: function (h) { return 'https://upbit.com/exchange?code=CRIX.UPBIT.KRW-' + h.code; } },
    bithumb: { name: '빗썸', pkg: 'com.btckorea.bithumb', web: 'https://www.bithumb.com' },
    coinone: { name: '코인원', pkg: 'coinone.co.kr.official', web: 'https://coinone.co.kr' },
    korbit: { name: '코빗', pkg: 'com.korbit.exchange', web: 'https://www.korbit.co.kr' }
  };
  var STOCK_APPS = ['toss', 'kiwoom', 'mirae', 'samsung', 'kis', 'nh', 'kb', 'shinhan', 'kakaopay', 'hana'];
  var COIN_APPS = ['upbit', 'bithumb', 'coinone', 'korbit'];
  function holds() { var x = store.get(K.hold, []); return Array.isArray(x) ? x : []; }
  function holdSave(x) { store.set(K.hold, x); S.han = null; }
  function hind() { var x = store.get(K.hind, null); return Array.isArray(x) ? x : HIND_DEF.slice(); }
  function broker() { var b = store.get(K.broker, {}) || {}; return { stock: STOCK_APPS.indexOf(b.stock) >= 0 ? b.stock : 'toss', coin: COIN_APPS.indexOf(b.coin) >= 0 ? b.coin : 'upbit' }; }
  function loadHold(force) {
    var list = holds();
    if (!LIVE || !list.length) return;
    if (S.han && (S.han.loading || (!force && Date.now() - S.han.at < 60000))) return;
    S.han = { loading: true, at: Date.now(), data: S.han && S.han.data };
    var key = list.map(function (h) { return h.yt; }).sort().join(','), tr = store.get(K.htrack, {}) || {};
    var track = tr.key === key && Date.now() - tr.at < 6 * 36e5 ? Promise.resolve()
      : rpc('app_hold_track', { p_code: code(), p_list: list.map(function (h) { return { yt: h.yt, market: h.market }; }) })
        .then(function () { store.set(K.htrack, { key: key, at: Date.now() }); }).catch(function () {});
    track.then(function () { return rpc('app_hold_analysis', { p_code: code(), p_list: list.map(function (h) { return h.yt; }) }); })
      .then(function (d) { S.han = { at: Date.now(), data: d || {} }; render(); })
      .catch(function () { S.han = { at: Date.now(), err: true, data: S.han && S.han.data }; render(); });
  }
  function probFor(prob, h, an) {             // 고른 지표가 지금과 같았던 과거 날들 → 1·5·20거래일 뒤 오른 비율
    var P = prob && prob.markets && prob.markets[h.market];
    if (!P || !an || !an.ok) return null;
    var keys = prob.ind || [], sel = hind().map(function (k) { return keys.indexOf(k); }).filter(function (i) { return i >= 0; });
    var res = (prob.h || [1, 5, 20]).map(function () { return [0, 0]; });
    Object.keys(P.cells).forEach(function (k) {
      var c = +k;
      for (var i = 0; i < sel.length; i++) if (((c >> sel[i]) & 1) !== ((an.bits >> sel[i]) & 1)) return;
      P.cells[k].forEach(function (v, j) { res[j][0] += v[0]; res[j][1] += v[1]; });
    });
    return { h: prob.h || [1, 5, 20], res: res, base: P.base };
  }
  function probRows(pr) {
    if (!pr) return '<p class="small" style="margin:0">오른 비율을 계산하고 있어요. 하루 한 번 새로 계산해요.</p>';
    return '<div class="prob">' + pr.h.map(function (d, j) {
      var n = pr.res[j][0], up = n ? Math.round(pr.res[j][1] / n * 100) : null, b = pr.base[j][0] ? Math.round(pr.base[j][1] / pr.base[j][0] * 100) : null;
      if (!n) return '<div class="pr"><span>' + d + '거래일 뒤</span><em class="small">같은 상태가 과거에 없었어요</em></div>';
      return '<div class="pr"><span>' + d + '거래일 뒤</span><div class="pbar" role="img" aria-label="상승 ' + up + '% 하락 ' + (100 - up) + '%"><i class="up" style="width:' + up + '%"></i><i class="dn" style="width:' + (100 - up) + '%"></i></div>' +
        '<b class="red">상승 ' + up + '%</b><b class="blue">하락 ' + (100 - up) + '%</b>' +
        '<small>표본 ' + n.toLocaleString('ko-KR') + '일 · 평소 상승 ' + b + '%' + (n < 300 ? ' · <span class="warn-t">표본 적음</span>' : '') + '</small></div>';
    }).join('') + '</div>';
  }
  function gword(v, kind) {
    if (v == null) return '';
    if (kind === 'calm') return v >= 67 ? '안정' : v >= 34 ? '보통' : '불안';
    return v >= 67 ? '강함' : v >= 34 ? '보통' : '약함';
  }
  function gbar(v, cls) { return '<div class="gbar ' + (cls || '') + '" aria-hidden="true"><i style="width:' + (v == null ? 0 : Math.max(3, v)) + '%"></i></div>'; }
  function powerOf(P) {
    var xs = ['trend', 'mid', 'align', 'mom', 'macd'].map(function (k) { return P[k]; }).filter(function (v) { return v != null; });
    return xs.length >= 3 ? Math.round(xs.reduce(function (a, b) { return a + b; }, 0) / xs.length) : null;
  }
  function gaugeRow(an) {
    var P = an.pct || {};
    var G = [['상승 힘', powerOf(P), ''], ['안정감', P.calm, 'calm'], ['거래 관심', P.vol, ''], ['시장 분위기', P.mkt, '']];
    if (G.every(function (g) { return g[1] == null; })) return '';
    return '<div class="gauges">' + G.map(function (g) {
      return '<div class="gauge"><span>' + g[0] + '</span><b>' + (g[1] == null ? '-' : g[1] + '%') + '</b>' + gbar(g[1], g[2] === 'calm' ? 'calm' : '') + '<em>' + gword(g[1], g[2]) + '</em></div>';
    }).join('') + '</div><p class="small gnote">지난 1년 중 오늘보다 약했던 날의 비율이에요. 80%면 1년 중 상위 20% 수준이에요.</p>';
  }
  function legendTop(an) {
    var L = (an.legend || []).filter(function (x) { return x.pct != null; });
    if (!L.length) return '';
    L.sort(function (a, b) { return b.pct - a.pct; });
    var x = L[0];
    return '<div class="line ltop"><span>가장 잘 맞는 관점</span><b>' + esc(x.who) + ' · ' + esc(x.m) + ' <span class="' + (x.pct >= 70 ? 'red' : '') + '">' + x.pct + '%</span></b></div>';
  }
  function legendBox(h, an) {
    var L = an.legend || [];
    if (!L.length) return '';
    return '<h3 class="sub-h">투자 대가의 눈으로 보기 <small>원칙을 몇 % 충족하는지</small></h3><div class="legends">' + L.map(function (x) {
      var key = h.id + ':' + x.id, open = S.lgopen === key;
      var right = x.pct != null ? '<b class="' + (x.pct >= 70 ? 'red' : x.pct < 40 ? 'blue' : '') + '">' + x.pct + '%</b>' : '<small>-</small>';
      var head = '<button class="lg" data-act="lgopen" data-v="' + esc(key) + '" aria-expanded="' + open + '"><span><b>' + esc(x.who) + '</b> <small>' + esc(x.m) + '</small><em>' + esc(x.na || x.idea) + '</em></span>' + right + '</button>' +
        (x.pct != null ? gbar(x.pct) : '');
      var body = open && x.items ? '<ul class="lgitems">' + x.items.map(function (it) {
        return '<li>' + (it.ok == null ? '<i class="na">?</i>' : it.ok ? ICON.ok : ICON.no) + '<span>' + esc(it.t) + '</span><small>' + (it.ok == null ? '정보 없음' : esc(it.v || '')) + '</small></li>';
      }).join('') + '</ul><p class="small" style="margin:4px 0 0">' + x.n + '개 확인 중 ' + x.pass + '개 충족' + (x.items.length > x.n ? ' · 정보가 없는 ' + (x.items.length - x.n) + '개는 빼고 계산했어요' : '') + '</p>' : '';
      return '<div class="lgrow">' + head + body + '</div>';
    }).join('') + '</div><p class="small" style="margin:6px 0 0">책과 인터뷰로 알려진 원칙을 단순하게 옮긴 점검표예요. 그 투자자가 이 종목을 직접 평가하거나 추천한 것이 아니에요.</p>';
  }
  var AXES = { power: '상승 힘', calm: '안정감', value: '가격 매력', growth: '성장성', health: '재무 건강', mkt: '시장 분위기' };
  var AX_SAY = { power: ['오르는 힘이 강해요', '오르는 힘이 약해요'], calm: ['가격이 덜 흔들려요', '가격이 많이 흔들려요'],
    value: ['가격이 싼 편이에요', '가격은 비싼 편이에요'], growth: ['이익과 매출이 잘 늘어요', '성장이 더뎌요'],
    health: ['재무가 튼튼해요', '재무가 약한 편이에요'], mkt: ['시장 분위기가 좋아요', '시장 분위기가 약해요'] };
  function axList(an) {
    var A = an.axes || {}, order = h_isCoin(an) ? ['power', 'calm', 'mkt'] : ['power', 'calm', 'value', 'growth', 'health'];
    return order.map(function (k) { return [k, A[k]]; });
  }
  function h_isCoin(an) { return an.axes && 'mkt' in an.axes; }
  function radar(list, score) {
    var n = list.length, R = 46, cx = 60, cy = 58, pt = function (i, r) { var a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    var ring = function (f) { return list.map(function (_, i) { return pt(i, R * f).map(function (x) { return x.toFixed(1); }).join(','); }).join(' '); };
    var poly = list.map(function (q, i) { return pt(i, R * Math.max(0.06, (q[1] || 0) / 100)).map(function (x) { return x.toFixed(1); }).join(','); }).join(' ');
    var lab = list.map(function (q, i) { var p = pt(i, R + 11); return '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 3).toFixed(1) + '" text-anchor="middle">' + AXES[q[0]].replace(' ', '') + '</text>'; }).join('');
    return '<svg class="radar" viewBox="-14 -6 148 128" role="img" aria-label="' + esc(list.map(function (q) { return AXES[q[0]] + ' ' + (q[1] == null ? '정보 없음' : q[1] + '%'); }).join(', ')) + '">' +
      '<polygon class="rg" points="' + ring(1) + '"/><polygon class="rg" points="' + ring(0.66) + '"/><polygon class="rg" points="' + ring(0.33) + '"/>' +
      '<polygon class="rv ' + (score == null ? '' : score >= 70 ? 'good' : score < 40 ? 'weak' : 'mid') + '" points="' + poly + '"/>' + lab +
      '<text class="rs" x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle">' + (score == null ? '-' : score) + '</text></svg>';
  }
  function sayOf(list) {
    var got = list.filter(function (q) { return q[1] != null; });
    var good = got.filter(function (q) { return q[1] >= 67; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 2);
    var bad = got.filter(function (q) { return q[1] <= 33; }).sort(function (a, b) { return a[1] - b[1]; }).slice(0, 1);
    if (!got.length) return '';
    var t = good.length ? good.map(function (q) { return AX_SAY[q[0]][0]; }).join(' · ') : '뚜렷한 강점은 아직 없어요';
    return t + (bad.length ? '. 다만 ' + AX_SAY[bad[0][0]][1].replace('요', '요') : '') + '.';
  }
  function sparkBig(xs) {
    if (!xs || xs.length < 5) return '';
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs), w = 300, h = 44, r = hi - lo || 1, up = xs[xs.length - 1] >= xs[0];
    var pts = xs.map(function (v, i) { return (i / (xs.length - 1) * w).toFixed(1) + ',' + (h - 3 - (v - lo) / r * (h - 6)).toFixed(1); }).join(' ');
    var ch = (xs[xs.length - 1] / xs[0] - 1) * 100;
    return '<div class="hspark"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><polyline class="' + (up ? 'red' : 'blue') + '" points="' + pts + '"/></svg>' +
      '<span>3개월 <b class="' + tone(ch) + '">' + pct(ch) + '</b></span></div>';
  }
  function probLine(pr) {
    if (!pr) return '';
    var j = pr.h.indexOf(5); if (j < 0) j = 0;
    var n = pr.res[j][0], up = n ? Math.round(pr.res[j][1] / n * 100) : null, b = pr.base[j][0] ? Math.round(pr.base[j][1] / pr.base[j][0] * 100) : null;
    if (up == null) return '';
    var d = up - b;
    return '<div class="line pline"><span>' + pr.h[j] + '거래일 뒤 오른 비율</span><b><span class="red">' + up + '%</span> <small class="small">평소 ' + b + '% · ' + (Math.abs(d) < 2 ? '평소와 비슷' : d > 0 ? '평소보다 ' + d + '%p 높음' : '평소보다 ' + (-d) + '%p 낮음') + (n < 300 ? ' · 표본 적음' : '') + '</small></b></div>';
  }
  function holdCard(h, an, prob, nws) {
    var m = h.market, ok = an && an.ok, price = ok ? an.price : null;
    var pl = ok && h.avg > 0 ? price / h.avg - 1 : null, val = ok && h.qty > 0 ? price * h.qty : null;
    var open = S.hopen === h.id, B = BROKERS[m === 'crypto' ? broker().coin : broker().stock];
    var name = '<div class="hname"><b class="name">' + esc(h.name) + '</b><span class="small">' + MARKET[m] + ' · ' + esc(h.code) + '</span></div>';
    if (!an) return '<section class="card hcard"><div class="hhead">' + name + '</div><p class="small" style="margin:0">분석을 준비하고 있어요. 새 종목은 5분쯤 걸려요.</p>' + hButtons(h, B, open) + '</section>';
    if (!ok) return '<section class="card hcard"><div class="hhead">' + name + '</div><p class="small" style="margin:0">' + esc(an.err || '분석할 수 없어요') + '. 종목 코드를 확인해 주세요.</p>' + hButtons(h, B, open) + '</section>';
    var x = an.extra || {}, v = an.vals || {};
    var head = '<div class="hhead">' + name + '<div class="hprice"><b>' + money(m, price) + '</b><span class="' + tone(an.chg) + '">' + pct(an.chg) + '</span></div></div>';
    var mine = pl != null ? '<div class="line hpl"><span>내 손익' + (h.qty > 0 ? ' <small class="small">' + (+h.qty).toLocaleString('ko-KR', { maximumFractionDigits: 6 }) + (m === 'crypto' ? '개' : '주') + '</small>' : '') + '</span><b class="' + tone(pl * 100) + '">' +
      (val != null ? amt(m === 'us' ? 'us' : 'kr', (price - h.avg) * h.qty) + ' ' : '') + '(' + pct(pl * 100) + ')</b></div>' : '';
    var list = axList(an), say = sayOf(list), score = an.score;
    var glance = (an.axes ? '<div class="glance">' + radar(list, score) + '<div class="gtext"><span class="small">종합 점수 <small>' + list.length + '가지 평균 · 참고용</small></span>' +
      '<b class="' + (score == null ? '' : score >= 70 ? 'red' : score < 40 ? 'blue' : '') + '">' + (score == null ? '정보 부족' : score + '점 · ' + (score >= 70 ? '좋음' : score >= 40 ? '보통' : '약함')) + '</b>' +
      (say ? '<p>' + esc(say) + '</p>' : '') + legendTop(an) + '</div></div>' : '');
    var ni = nws && nws.items;
    var body = sparkBig(an.spark) + mine + glance + probLine(probFor(prob, h, an)) + (ni && ni.length && !open ? newsList(ni, 1) : '');
    var more = '';
    if (open) {
      var bits = an.bits, keys = (prob && prob.ind) || HIND.map(function (q) { return q[0]; });
      var vtxt = { trend: v.ma20 != null ? '20일선 대비 ' + pct(v.ma20) : '', mid: v.ma60 != null ? '60일선 대비 ' + pct(v.ma60) : '', mom: v.rsi != null ? 'RSI ' + v.rsi : '',
        vol: v.vr != null ? '평소의 ' + v.vr + '배' : '', calm: v.vola != null ? '연 변동성 ' + v.vola + '%' : '' };
      var P = an.pct || {};
      more = '<h3 class="sub-h">5가지 축 <small>0~100 · 높을수록 좋아요</small></h3><div class="axrows">' + list.map(function (q) {
          return '<div class="axrow"><span>' + AXES[q[0]] + '</span>' + gbar(q[1], q[0] === 'calm' ? 'calm' : '') + '<b>' + (q[1] == null ? '정보 없음' : q[1]) + '</b></div>';
        }).join('') + '</div><p class="small gnote">상승 힘·안정감은 지난 1년 가격 흐름, 가격 매력·성장성·재무 건강은 PER·PBR·이익 성장·ROE·부채 같은 재무 숫자로 계산해요.</p>' +
        '<h3 class="sub-h">지금 상태 <small>어제 종가 기준</small></h3>' + gaugeRow(an) +
        '<h3 class="sub-h">지표가 지금과 같았을 때</h3>' + probRows(probFor(prob, h, an)) +
        '<h3 class="sub-h">지표 8가지 <small>✓ 맞음 · % 지난 1년 중 위치</small></h3><div class="ilist2">' + HIND.map(function (q) {
        var i = keys.indexOf(q[0]), on = i >= 0 && ((bits >> i) & 1) === 1, pv = P[q[0]];
        return '<div class="irow"><div class="ih">' + (on ? ICON.ok : ICON.no) + '<span><b>' + q[1] + '</b><small>' + HIND_HELP[q[0]] + (vtxt[q[0]] ? ' · ' + vtxt[q[0]] : '') + '</small></span>' +
          '<em>' + (pv == null ? '-' : pv + '%') + '</em></div>' + gbar(pv, q[0] === 'calm' ? 'calm' : '') + '</div>';
      }).join('') + '</div>' + legendBox(h, an) +
        '<h3 class="sub-h">부가 데이터</h3><div class="ilist">' +
        '<div class="line"><span>꾸준함 <small class="small">최근 12달 중 오른 달</small></span><b>' + (x.months ? Math.round(x.upm / x.months * 100) + '% (' + x.months + '달 중 ' + x.upm + '달)' : '-') + '</b></div>' +
        '<div class="line"><span>1년 최대 하락폭</span><b class="blue">' + (x.mdd != null ? x.mdd + '%' : '-') + '</b></div>' +
        '<div class="line"><span>1년 최고가 대비</span><b>' + (x.hi52 != null ? pct(x.hi52) : '-') + '</b></div>' +
        '<div class="line"><span>연 변동성</span><b>' + (v.vola != null ? v.vola + '%' : '-') + '</b></div>' +
        '<div class="line"><span>수익률 1개월 · 3개월 · 1년</span><b>' + [x.r1m, x.r3m, x.r1y].map(function (r) { return r == null ? '-' : '<span class="' + tone(r) + '">' + pct(r) + '</span>'; }).join(' · ') + '</b></div></div>' +
        (ni && ni.length ? '<h3 class="sub-h">뉴스 <small>구글 뉴스 · 누르면 기사로 가요</small></h3>' + newsList(ni, 6) : '') +
        '<p class="small" style="margin:8px 0 0">' + hm(an.updated || an.asof) + ' 기준 · 국장 시세는 15~20분 늦을 수 있어요.</p>';
    }
    return '<section class="card hcard">' + head + body + more + hButtons(h, B, open) + '</section>';
  }
  function hButtons(h, B, open) {
    if (S.hedit === h.id) return hForm(h);
    return '<div class="hbtns"><button class="btn" data-act="hopenapp" data-v="' + esc(h.id) + '">' + esc(B.name) + '에서 보기</button>' +
      '<button class="btn ghost" data-act="hmore" data-v="' + esc(h.id) + '">' + (open ? '접기' : '자세히') + '</button>' +
      '<button class="btn ghost" data-act="hedit" data-v="' + esc(h.id) + '">수정</button></div>';
  }
  function hForm(h) {
    var unit = h.market === 'us' ? '달러' : '원';
    return '<form data-form="hsave" class="jform" data-id="' + esc(h.id || '') + '">' + (h.id ? '' : '<p class="small" style="margin:0">살펴보기만 하려면 수량과 단가를 비워 두고 저장하세요.</p>') +
      '<label>수량 (' + (h.market === 'crypto' ? '개' : '주') + ', 선택)<input name="qty" type="number" inputmode="decimal" step="any" min="0" value="' + esc(h.qty || '') + '"></label>' +
      '<label>평균 단가 (' + unit + ', 선택)<input name="avg" type="number" inputmode="decimal" step="any" min="0" value="' + esc(h.avg || '') + '"></label>' +
      '<div class="two"><button type="button" class="btn ghost" data-act="' + (h.id ? 'hdel' : 'hcancel') + '" data-v="' + esc(h.id || '') + '">' + (h.id ? (S.hdel === h.id ? '정말 지울까요?' : '지우기') : '취소') + '</button>' +
      '<button class="btn" type="submit">저장</button></div>' + (h.id ? '<button type="button" class="btn ghost" data-act="hcancel">닫기</button>' : '') + '</form>';
  }
  function pageHold() {
    var list = holds(), D = S.han && S.han.data, an = (D && D.an) || {}, prob = D && D.prob, NW = (D && D.news) || {};
    if (list.length) setTimeout(function () { loadHold(false); }, 0);
    var sel = hind();
    var chips = '<div class="picks">' + HIND.map(function (q) {
      var on = sel.indexOf(q[0]) >= 0;
      return '<button class="' + (on ? 'on' : '') + '" data-act="hind" data-v="' + q[0] + '" aria-pressed="' + on + '">' + q[1] + '</button>';
    }).join('') + '</div>';
    var held = list.filter(function (h) { return +h.qty > 0; }), watch = list.filter(function (h) { return !(+h.qty > 0); });
    var tot = { kr: [0, 0, 0], us: [0, 0, 0] };
    held.forEach(function (h) { var a = an[h.yt]; if (a && a.ok && h.avg > 0) { var k = h.market === 'us' ? 'us' : 'kr'; tot[k][0] += a.price * h.qty; tot[k][1] += (a.price - h.avg) * h.qty; tot[k][2] += h.avg * h.qty; } });
    var sumRow = function (k, label) {
      var t = tot[k]; if (!t[0]) return '';
      return '<div class="sumrow"><span>' + label + '</span><strong>' + amt(k, t[0]).replace('+', '') + '</strong><b class="' + tone(t[1]) + '">' + amt(k, t[1]) + ' (' + pct(t[2] ? t[1] / t[2] * 100 : 0) + ')</b></div>';
    };
    var sum = tot.kr[0] || tot.us[0] ? '<section class="card sumcard"><h2 style="font-size:15px">내 평가 금액</h2>' + sumRow('kr', '원화') + sumRow('us', '달러') + '</section>' : '';
    var card = function (h) { return holdCard(h, an[h.yt], prob, NW[h.yt]); };
    var body = !list.length ? '<p class="empty">아직 넣은 종목이 없어요.<br><b>+ 종목 추가</b>로 가진 종목이나 궁금한 종목을 넣어 보세요.</p>'
      : (S.han && S.han.err && !D ? '<p class="info">분석을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>' : '') + sum +
        (held.length ? '<h2 class="grp">보유 <span>' + held.length + '</span></h2>' + held.map(card).join('') : '') +
        (watch.length ? '<h2 class="grp">관심 <span>' + watch.length + '</span><small>수량 없이 넣은 종목</small></h2>' + watch.map(card).join('') : '') +
        '<section class="card"><details' + (S.hindOpen ? ' open' : '') + '><summary class="dsum">확률 계산에 쓸 지표 <small>' + sel.length + '개 선택</small></summary>' +
        '<p class="small" style="margin:8px 0 0">고른 지표가 지금과 같았던 날을 과거에서 찾아, 며칠 뒤 실제로 오른 비율을 보여 줘요. 많이 고를수록 비슷한 날이 줄어요.</p>' + chips + '</details></section>';
    return top('<span style="font-size:18px;font-weight:700">내 보유</span>', '<a class="btn small-btn" href="#/hold/add">+ 종목 추가</a>') + demoBar() +
      '<main class="page">' + body +
      '<p class="foot-note">국장 시세는 15~20분 늦을 수 있어요. 오른 비율은 같은 시장 종목들의 최근 5년 일봉에서 지표 상태가 지금과 같았던 날 이후의 실제 결과이고, 앞으로를 보장하지 않아요. 수량과 단가는 이 휴대폰에만 저장되고, 서버에는 종목 코드만 보내요.</p></main>' + menu('hold');
  }
  function pageHoldAdd() {
    var s = S.hsel;
    var form = s ? '<section class="card"><div class="line"><b class="name">' + esc(s.name) + '</b><span class="small">' + MARKET[s.market] + ' · ' + esc(s.code) + '</span></div>' + hForm({ market: s.market }) + '</section>'
      : '<section class="card"><label class="search"><span class="sr">종목 검색</span><input data-hq type="search" placeholder="종목 이름이나 코드 (예: 삼성전자, AAPL, 비트코인)" value="' + esc(S.hq || '') + '" autocomplete="off"></label>' +
        '<div id="hres">' + hResults() + '</div></section>' +
        '<details class="card"><summary>목록에 없나요? 직접 넣기</summary><form data-form="hmanual" class="jform">' +
        '<label>시장<select name="market"><option value="KS">국장 코스피</option><option value="KQ">국장 코스닥</option><option value="us">미장</option><option value="crypto">코인</option></select></label>' +
        '<label>종목 코드 (예: 005930, AAPL, BTC)<input name="code" required maxlength="12" autocomplete="off"></label>' +
        '<label>이름<input name="name" required maxlength="40"></label><button class="btn" type="submit">다음</button></form></details>';
    return top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/hold" aria-label="뒤로" data-act="hback">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">종목 추가</span></span>') +
      '<main class="page">' + form + '</main>' + menu('hold');
  }
  function hResults() {
    if (!S.hq) return '<p class="small" style="margin:8px 0 0">두 글자 이상 입력하면 찾아 드려요.</p>';
    if (S.hres == null) return '<p class="small" style="margin:8px 0 0">찾는 중…</p>';
    if (!S.hres.length) return '<p class="small" style="margin:8px 0 0">찾는 종목이 없어요. 아래 <b>직접 넣기</b>를 써 보세요.</p>';
    return '<div class="hres">' + S.hres.map(function (r, i) {
      return '<button data-act="hpick" data-v="' + i + '"><b>' + esc(r.name) + '</b><small>' + MARKET[r.market] + ' · ' + esc(r.code) + (r.alias ? ' · ' + esc(r.alias) : '') + '</small></button>';
    }).join('') + '</div>';
  }
  var hqTimer = null;
  function hSearch(q) {
    S.hq = q; S.hres = null;
    clearTimeout(hqTimer);
    var box = document.getElementById('hres');
    if (q.length < 2 && !/^[A-Za-z]{1,5}$/.test(q)) { S.hq = q.length ? q : ''; if (box) box.innerHTML = hResults(); return; }
    if (box) box.innerHTML = hResults();
    hqTimer = setTimeout(function () {
      if (!LIVE) { S.hres = []; if (document.getElementById('hres')) document.getElementById('hres').innerHTML = hResults(); return; }
      rpc('app_symbols', { p_code: code(), p_q: q }).then(function (r) {
        if (S.hq !== q) return;
        S.hres = Array.isArray(r) ? r : [];
        var b = document.getElementById('hres'); if (b) b.innerHTML = hResults();
      }).catch(function () { S.hres = []; var b = document.getElementById('hres'); if (b) b.innerHTML = hResults(); });
    }, 250);
  }
  function bchip(k, kind) { var on = broker()[kind] === k; return '<button class="' + (on ? 'on' : '') + '" data-act="b' + kind + '" data-v="' + k + '" aria-pressed="' + on + '">' + esc(BROKERS[k].full || BROKERS[k].name) + '</button>'; }
  function openBroker(h) {
    var B = BROKERS[h.market === 'crypto' ? broker().coin : broker().stock], page = B.url && !h.byName ? B.url(h) : null;
    var copy = h.code, msg = (h.byName ? '종목 이름' : '종목 코드') + '를 복사했어요 (' + copy + '). ' + B.name + ' 검색창에 붙여 넣으세요';
    try { if (navigator.clipboard) navigator.clipboard.writeText(copy).catch(function () {}); } catch (_) {}
    if (page) { window.open(page, '_blank', 'noopener'); return; }          // 종목 화면으로 바로 가는 곳 (토스 국장 · 업비트)
    if (/Android/i.test(navigator.userAgent)) {
      toast(msg);
      var fb = B.q ? 'https://play.google.com/store/search?q=' + encodeURIComponent(B.q) + '&c=apps' : 'https://play.google.com/store/apps/details?id=' + B.pkg;
      location.href = 'intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=' + B.pkg +
        ';S.browser_fallback_url=' + encodeURIComponent(fb) + ';end';
    } else if (B.web) { toast(msg); window.open(B.web, '_blank', 'noopener'); }
    else toast(msg);
  }
  function addHolding(s, qty, avg, extra) {
    var list = holds(), same = list.filter(function (h) { return h.yt === s.yt; })[0];
    if (same) {
      if (qty > 0 && avg > 0) {
        var q0 = +same.qty || 0, a0 = +same.avg || 0;
        same.avg = q0 > 0 && a0 > 0 ? (a0 * q0 + avg * qty) / (q0 + qty) : avg;
        same.qty = q0 + qty;
      }
    } else {
      same = { id: 'h' + Date.now(), yt: s.yt, code: s.code, name: s.name, market: s.market, qty: qty || 0, avg: avg || 0, at: new Date().toISOString() };
      list.push(same);
    }
    if (extra && extra.jid && qty > 0) { same.jq = same.jq || {}; same.jq[extra.jid] = qty; }   // 매매일지에서 온 수량 (팔면 그만큼만 뺌)
    holdSave(list);
  }

  // ---------- 뉴스 · 선물 ----------
  function since(iso) {
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!(m >= 0)) return '';
    if (m < 2) return '방금';
    if (m < 60) return m + '분 전';
    if (m < 60 * 24) return Math.floor(m / 60) + '시간 전';
    if (m < 60 * 48) return '어제';
    return kst(new Date(iso), { month: 'numeric', day: 'numeric' });
  }
  function newsList(items, n) {
    var xs = (items || []).filter(function (x) { return x && /^https:\/\//.test(x.u || '') && x.t; }).slice(0, n || 6);
    if (!xs.length) return '';
    return '<div class="news">' + xs.map(function (x) {
      var fresh = x.brk && Date.now() - new Date(x.at).getTime() < 6 * 3600 * 1000;
      return '<a class="nw" href="' + esc(x.u) + '" target="_blank" rel="noopener"><span class="nt">' + (fresh ? '<b class="brk">속보</b>' + esc(x.t.replace(/^\s*[\[【(]\s*속보\s*[\]】)]\s*/, '')) : esc(x.t)) + '</span>' +
        '<span class="nm">' + esc(x.s || '뉴스') + ' · ' + since(x.at) + '</span></a>';
    }).join('') + '</div>';
  }
  function loadNews(yt) {
    S.anews = S.anews || {};
    if (!LIVE || !yt || S.anews[yt]) return;
    S.anews[yt] = { loading: true };
    rpc('app_news', { p_code: code(), p_list: [yt] }).then(function (r) { S.anews[yt] = (r && r[yt]) || { items: [] }; })
      .catch(function () { S.anews[yt] = { items: [], err: true }; }).then(function () { if (/alert/.test(location.hash)) render(); });
  }
  var FUT_SHORT = { 'ES=F': 'S&P500', 'NQ=F': '나스닥', 'YM=F': '다우', 'K200N': '코스피200' };
  function futNight() { var h = +kst(new Date(), { hour: '2-digit', hour12: false }).replace(/\D/g, ''); return h >= 18 || h < 6; }
  function futNum(v) { return (+v).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function spark(xs, up) {
    if (!xs || xs.length < 2) return '';
    var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs), w = 96, h = 28, r = hi - lo || 1;
    var pts = xs.map(function (v, i) { return (i / (xs.length - 1) * w).toFixed(1) + ',' + (h - 2 - (v - lo) / r * (h - 4)).toFixed(1); }).join(' ');
    return '<svg class="spark ' + (up ? 'red' : 'blue') + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline points="' + pts + '"/></svg>';
  }
  function futInner() {
    var F = S.fut && S.fut.items;
    if (!F || !F.length) return '';
    var stale = function (x) { return !x.asof || Date.now() - new Date(x.asof).getTime() > 90 * 60000; };
    var bar = '<button class="futbar" data-act="futopen" aria-expanded="' + !!S.futOpen + '"><span class="fl">' + (futNight() ? '야간 선물' : '지수 선물') + '</span><span class="fs">' +
      F.map(function (x) { return '<span class="fi">' + esc(FUT_SHORT[x.key] || x.name) + ' <i class="' + tone(x.pct) + '">' + pct(x.pct) + '</i></span>'; }).join('') +
      '</span><span class="fa" aria-hidden="true">' + (S.futOpen ? '▾' : '▴') + '</span></button>';
    if (!S.futOpen) return bar;
    var rows = F.map(function (x) {
      return '<div class="frow"><div><b>' + esc(x.name) + '</b><small>' + (stale(x) ? '휴장 중 · 마지막 값 ' : '') + (x.asof ? hm(x.asof) + ' 기준' : '') + '</small></div>' +
        spark(x.spark, x.pct >= 0) + '<div class="fv"><b>' + futNum(x.last) + '</b><small class="' + tone(x.pct) + '">' + (x.chg > 0 ? '+' : '') + futNum(x.chg) + ' (' + pct(x.pct) + ')</small></div></div>';
    }).join('');
    var hasK = F.some(function (x) { return x.key === 'K200N'; });
    return '<div class="futpanel">' + rows + (hasK ? '' : '<p class="small">코스피200 야간선물은 준비 중이에요.</p>') +
      '<p class="small">' + esc(S.fut.note || '') + ' · 5분마다 새로 받아요. 투자 판단은 증권사 앱 시세로 확인하세요.</p></div>' + bar;
  }
  function loadFut() {
    if (!LIVE || !code() || document.visibilityState !== 'visible') return;
    rpc('app_fut', { p_code: code() }).then(function (r) {
      if (r && r.fut) { S.fut = r.fut; document.querySelectorAll('.futwrap').forEach(function (el) { el.innerHTML = futInner(); }); }
    }).catch(function () {});
  }

  // ---------- 공지사항 (app/notices.json) ----------
  function loadNotices() {
    if (!window.fetch) return;
    fetch('notices.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var xs = d && Array.isArray(d.items) ? d.items.filter(function (x) { return x && x.id && x.title; }) : [];
      if (xs.length) { S.ann = xs; render(); }
    }).catch(function () {});
  }
  function unread() {
    var xs = S.ann || [], seen = store.get(K.nseen, '');
    if (!xs.length) return 0;
    var i = xs.map(function (x) { return x.id; }).indexOf(seen);
    return i < 0 ? Math.min(xs.length, seen ? xs.length : 1) : i;
  }
  function markSeen() { if (S.ann && S.ann.length) store.set(K.nseen, S.ann[0].id); }
  function annBar() {
    var n = unread();
    if (!n) return '';
    var x = S.ann[0];
    return '<div class="annbar"><a href="#/notice"><b>새 소식</b><span>' + esc(x.title) + '</span></a><button class="x" data-act="anndis" aria-label="새 소식 닫기">' + ICON.x + '</button></div>';
  }
  function pageNotice() {
    var xs = S.ann || [], seen = store.get(K.nseen, ''), cut = xs.map(function (x) { return x.id; }).indexOf(seen);
    var list = !xs.length ? '<p class="empty">공지사항을 불러오는 중이에요.</p>' : xs.map(function (x, i) {
      var fresh = cut < 0 ? i === 0 : i < cut;
      return '<section class="card ann"><div class="line"><h2 style="font-size:15px">' + esc(x.title) + '</h2>' + (fresh ? '<span class="tag new">새 글</span>' : '') + '</div>' +
        '<p class="small" style="margin:0">' + esc(x.date || '') + '</p>' +
        (Array.isArray(x.body) ? '<ul>' + x.body.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' : '') + '</section>';
    }).join('');
    setTimeout(function () { if (unread()) { markSeen(); document.querySelectorAll('nav.menu .dot').forEach(function (d) { d.remove(); }); } }, 600);
    return top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/settings" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">공지사항</span></span>') +
      '<main class="page">' + list + '</main>' + menu('settings');
  }

  // ---------- 개발자 통계 (숨은 화면 #/dev) ----------
  // 이 휴대폰에서 만든 무작위 열쇠는 휴대폰에만 있고, 서버에는 열쇠의 지문(SHA-256)만 등록해요.
  function devKey() {
    var k = store.get(K.devkey, '');
    if (!k && window.crypto && crypto.getRandomValues) {
      var b = new Uint8Array(32); crypto.getRandomValues(b);
      k = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      store.set(K.devkey, k);
    }
    return k;
  }
  function devPrint(k) {
    if (S.devfp || !k || !(window.crypto && crypto.subtle)) return;
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(k)).then(function (h) {
      S.devfp = Array.prototype.map.call(new Uint8Array(h), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); render();
    });
  }
  function loadDev(force) {
    var k = devKey();
    if (!LIVE || !k || (S.dev && (S.dev.loading || (!force && Date.now() - S.dev.at < 30000)))) return;
    S.dev = { loading: true, at: Date.now(), data: S.dev && S.dev.data };
    rpc('app_dev_stats', { p_key: k }).then(function (d) { S.dev = { at: Date.now(), data: d }; })
      .catch(function (e) { S.dev = { at: Date.now(), denied: !!(e && e.invalid), err: true }; }).then(function () { if (/dev/.test(location.hash)) render(); });
  }
  function devEngine(D) {
    var E = D.engine || null, C = D.cron || {}, P = D.dispatch || {}, X = D.data || {}, MK = { kr: '국장', us: '미장', crypto: '코인' };
    var runs = (E && E.runs) || [], last = runs[0];
    var ok = function (b) { return b ? '<i class="st ok">정상</i>' : '<i class="st bad">확인 필요</i>'; };
    var sum = function (k) { return runs.slice(0, 12).reduce(function (a, r) { return a + (+r[k] || 0); }, 0); };
    var avgSec = runs.length ? Math.round(runs.slice(0, 12).reduce(function (a, r) { return a + (+r.sec || 0); }, 0) / Math.min(12, runs.length)) : null;
    var disp = Object.keys(P).map(function (k) { return k + ' × ' + P[k]; }).join(', ') || '-';
    var engAge = last ? (Date.now() - new Date(last.at).getTime()) / 60000 : null;
    var flow = '<section class="card"><h2 style="font-size:15px">매매 프로그램이 돌아가는 흐름</h2><ol class="flow">' +
      '<li><b>① 5분 시계 (Supabase)</b><span>최근 3시간 ' + (C.ok || 0) + '번 성공 · ' + (C.fail || 0) + '번 실패</span>' + ok(C.ok && !C.fail) + '</li>' +
      '<li><b>② 실행 요청 (GitHub)</b><span>응답 ' + esc(disp) + ' · 204면 정상 접수</span>' + ok(P['204'] && Object.keys(P).length === 1) + '</li>' +
      '<li><b>③ 엔진 실행</b><span>' + (last ? '마지막 ' + since(last.at) + ' · 평균 ' + avgSec + '초 걸림' : '아직 기록이 없어요') + '</span>' + ok(engAge != null && engAge < 20) + '</li>' +
      '<li><b>④ 알림 보내기</b><span>최근 1시간 매수 ' + sum('b') + ' · 매도 ' + sum('s') + ' · 카톡 ' + sum('k') + ' · 푸시 ' + sum('p') + '</span>' + ok(!(last && last.e)) + '</li>' +
      '<li><b>⑤ 앱 데이터</b><span>선물 ' + (X.futures_at ? since(X.futures_at) : '-') + ' · 뉴스 ' + (X.news || 0) + '종목 · 재무 ' + (X.fund || 0) + '종목 · 확률 표 ' + (X.prob_at ? since(X.prob_at) : '-') + '</span>' + ok(!!X.futures_at) + '</li>' +
      '</ol><p class="small" style="margin:6px 0 0">시세는 야후 파이낸스, 백테스트는 ' + esc(X.research_run || '-') + ' 실행분을 써요.</p></section>';
    var hist = '<section class="card"><h2 style="font-size:15px">최근 실행 기록 <small class="small">5분마다 · 최근 12번</small></h2>' + (runs.length ? runs.slice(0, 12).map(function (r) {
      var mk = (r.m || []).map(function (m) { return MK[m] || m; }).join('·') || '장 닫힘';
      return '<div class="drow"><span class="rk" style="width:44px">' + hm(r.at) + '</span><span class="dn"><b>' + mk + ' · 종목 ' + r.c + (r.f ? ' · 실패 ' + r.f : '') + '</b><small>' +
        '매수 ' + r.b + ' · 매도 ' + r.s + ' · 푸시 ' + r.p + (r.force ? ' · 수동 실행' : '') + (r.e ? ' · 앱 오류: ' + esc(r.e) : '') + (r.note ? '<br>' + esc(r.note) : '') + '</small></span><b>' + r.sec + '초</b></div>';
    }).join('') : '<p class="small" style="margin:0">엔진이 새 버전으로 한 번 돌면 여기에 나와요.</p>') + '</section>';
    if (!E || !E.cfg) return flow + hist;
    var c = E.cfg, L = E.live || {};
    var won = function (v) { return (+v).toLocaleString('ko-KR') + '원'; };
    var row = function (k, v) { return '<div class="line"><span>' + k + '</span><b>' + v + '</b></div>'; };
    var watch = Object.keys(c.watch || {}).map(function (mk) {
      var cs = c.watch[mk] || {}, n = Object.keys(cs).reduce(function (a, k) { return a + cs[k]; }, 0);
      return row(MK[mk] || mk, n + '종목 <small class="small">' + esc(Object.keys(cs).map(function (k) { return k + ' ' + cs[k]; }).join(' · ')) + '</small>');
    }).join('');
    var GN = { '시장_필터': '시장', '추세_필수': '추세', '눌림_매수': '눌림', '변동성_필터': '변동성', '실적_피하기': '실적', '반_매도': '반 매도', '하루_한번': '하루 한 번', '성적표': '성적표', '자동_멈춤': '자동 멈춤' };
    var guards = Object.keys(c.guards || {}).map(function (mk) {
      var g = c.guards[mk] || {};
      return '<div class="gline"><span>' + (MK[mk] || mk) + ' <small class="small">' + ((c.score_by_market || {})[mk] != null ? (c.score_by_market[mk] * 10) + '%↑' : '') + '</small></span><div class="gchips">' +
        Object.keys(g).map(function (k) { return '<i class="' + (g[k] ? 'on' : '') + '">' + (GN[k] || k) + '</i>'; }).join('') + '</div></div>';
    }).join('');
    var kr = c.kakao_rules ? Object.keys(c.kakao_rules).map(function (mk) { return (MK[mk] || mk) + ' ' + ruleText(c.kakao_rules[mk], mk); }).join(' / ') : '예전 방식';
    return flow + hist + '<section class="card"><h2 style="font-size:15px">매매 프로그램 설정 <small class="small">' + since(E.at) + ' 기준</small></h2>' +
      '<h3 class="sub-h">감시 종목</h3>' + watch +
      '<h3 class="sub-h">돈 · 손절</h3>' + row('종목당 금액', won(c.budget_krw) + ' · $' + c.budget_usd) + row('한 번 손절 최대', won(c.max_loss_krw) + ' · $' + c.max_loss_usd) +
        row('최소 손익비', c.min_rr + '배') + row('손절 여유', 'ATR ' + c.stop_atr + '배') + row('나머지 매도', '고점에서 ATR ' + c.trail_atr + '배 빠지면') + row('수수료·세금', (c.fee * 100).toFixed(1) + '%') +
      '<h3 class="sub-h">신호 · 점검</h3>' + row('돌파 유지 확인', c.confirm_min + '분') + row('같은 알림 간격', c.cooldown_min + '분') + row('실적 발표 전 쉬기', c.earn_days + '일') +
        row('앱에 올리는 최소 신호', (c.app_floor * 10) + '%') + row('카톡 최소 안정성', esc(c.min_grade)) + guards +
      '<h3 class="sub-h">카톡 · 알림</h3>' + row('카톡 조건', esc(c.kakao_preset)) + '<p class="small" style="margin:0 0 4px">' + esc(kr) + '</p>' +
        row('카톡 짧게', c.kakao_short ? '켜짐' : '꺼짐') + row('매도 알림', c.sell_all ? '모든 종목' : '최근 ' + c.sell_link_days + '일 매수·보유 종목만') + row('아침 브리핑', c.brief ? '켜짐' : '꺼짐') +
      '<h3 class="sub-h">실전 기록</h3>' + row('보유 중', (L.open || 0) + '건') + row('끝난 거래', (L.closed || 0) + '건') + row('자동 멈춤 중인 시장', (L.paused || []).map(function (m) { return MK[m] || m; }).join(', ') || '없음') +
      '<p class="small" style="margin:6px 0 0">이 값들은 GitHub 비밀값 ALERT_SETTINGS와 엔진 코드에서 읽은 거예요. 바꾸려면 Claude에게 말해 주세요.</p></section>';
  }
  function pageDev() {
    var k = devKey(); devPrint(k); setTimeout(function () { loadDev(false); }, 0);
    var D = S.dev && S.dev.data, MK = { kr: '국장', us: '미장', crypto: '코인' };
    var kv = function (o, f) { return Object.keys(o || {}).sort(function (a, b) { return o[b] - o[a]; }).map(function (x) { return '<div class="line"><span>' + esc(f ? f(x) : x) + '</span><b>' + o[x] + '</b></div>'; }).join('') || '<p class="small" style="margin:0">아직 없어요</p>'; };
    var body;
    if (!D) {
      body = '<section class="card"><h2 style="font-size:15px">이 휴대폰 등록하기</h2>' +
        (S.dev && S.dev.loading ? '<p class="small">확인하는 중…</p>' : '') +
        '<p class="small" style="margin:0;line-height:1.6">아래 <b>등록 코드</b>를 복사해서 Claude에게 보내 주세요. 등록이 끝나면 이 화면에 통계가 나와요.<br>등록 코드는 열쇠가 아니라 열쇠의 지문이라 보내도 안전해요. 열쇠는 이 휴대폰에만 있어요. 앱 데이터를 지우면 다시 등록해야 해요.</p>' +
        '<p class="devfp">' + esc(S.devfp || '만드는 중…') + '</p><div class="two"><button class="btn ghost" data-act="devcopy">등록 코드 복사</button><button class="btn" data-act="devreload">다시 확인</button></div></section>';
    } else {
      var H = D.hold || {}, U = D.subs || {}, A = D.alerts || {}, X = D.data || {};
      var topRows = (H.top || []).map(function (t, i) {
        return '<div class="drow"><span class="rk">' + (i + 1) + '</span><span class="dn"><b>' + esc(t.name || t.yt) + '</b><small>' + (MK[t.market] || '') + ' · ' + esc(t.yt) + ' · 처음 ' + esc(dayLabel(t.first_at)) + '</small></span><b>' + t.n + '</b></div>';
      }).join('') || '<p class="small" style="margin:0">아직 넣은 종목이 없어요</p>';
      var recent = (H.recent || []).map(function (t) { return '<div class="line"><span>' + esc(t.name || t.yt) + ' <small class="small">' + (MK[t.market] || '') + '</small></span><span class="small">' + esc(dayLabel(t.first_at)) + ' ' + hm(t.first_at) + '</span></div>'; }).join('');
      body = '<section class="card"><div class="devnums">' +
          '<div><span>푸시 구독</span><b>' + (U.total || 0) + '</b><em>7일 +' + (U.new7 || 0) + '</em></div>' +
          '<div><span>보유·관심 종목</span><b>' + (H.tickers || 0) + '</b><em>7일 새 +' + (H.new7 || 0) + '</em></div>' +
          '<div><span>엔진</span><b>' + (D.beat ? since(D.beat) : '-') + '</b><em>마지막 실행</em></div></div></section>' +
        devEngine(D) +
        '<section class="card"><h2 style="font-size:15px">많이 넣은 종목 <small class="small">최근 30일 · 숫자는 요청 횟수</small></h2>' + topRows + '</section>' +
        '<section class="card"><h2 style="font-size:15px">새로 들어온 종목</h2><div class="ilist">' + (recent || '<p class="small" style="margin:0">아직 없어요</p>') + '</div></section>' +
        '<section class="card"><h2 style="font-size:15px">시장별 종목 수</h2>' + kv(H.by_market, function (x) { return MK[x] || x; }) + '</section>' +
        '<section class="card"><h2 style="font-size:15px">구독자 설정</h2><h3 class="sub-h">받는 시장</h3>' + kv(U.markets, function (x) { return MK[x] || x; }) +
          '<h3 class="sub-h">알림 조건</h3>' + kv(U.preset) +
          '<h3 class="sub-h">켜 둔 기능</h3><div class="line"><span>매도 알림</span><b>' + (U.sell || 0) + '</b></div><div class="line"><span>모든 종목 매도</span><b>' + (U.sellAll || 0) + '</b></div>' +
          '<div class="line"><span>아침 브리핑</span><b>' + (U.brief || 0) + '</b></div><div class="line"><span>방해 금지</span><b>' + (U.quiet || 0) + '</b></div>' +
          '<h3 class="sub-h">초대 코드별</h3>' + kv(U.by_code, function (x) { return x.length > 4 ? x.slice(0, 4) + '-••••' : x; }) + '</section>' +
        '<section class="card"><h2 style="font-size:15px">최근 7일 알림</h2>' + kv(A, function (x) { var p = x.split(':'); return (MK[p[0]] || p[0]) + ' ' + (p[1] === 'buy' ? '매수' : '매도'); }) + '</section>' +
        '<section class="card"><h2 style="font-size:15px">데이터 상태</h2><div class="line"><span>종목 검색 목록</span><b>' + (X.symbols || 0) + '</b></div><div class="line"><span>뉴스 받은 종목</span><b>' + (X.news || 0) + '</b></div>' +
          '<div class="line"><span>재무 받은 종목</span><b>' + (X.fund || 0) + '</b></div><div class="line"><span>선물 시세</span><b>' + (X.futures_at ? since(X.futures_at) : '-') + '</b></div><div class="line"><span>확률 표</span><b>' + (X.prob_at ? since(X.prob_at) : '-') + '</b></div></section>' +
        '<p class="foot-note">누가 어떤 종목을 넣었는지는 서버에 저장하지 않아서 볼 수 없어요. 개인정보처리방침에서 약속한 대로 종목 코드와 횟수만 모아요. 요청 횟수는 휴대폰마다 6시간에 한 번 정도 늘어서, 사람 수와 정확히 같지는 않아요.</p>';
    }
    return top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/settings" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">개발자 통계</span></span>', D ? '<button class="btn small-btn" data-act="devreload">새로고침</button>' : '') +
      '<main class="page">' + body + '</main>' + menu('settings');
  }

  // ---------- 화면 조각 ----------
  function menu(on) {
    function a(id, href, icon, label) { return '<a href="' + href + '" class="' + (on === id ? 'on' : '') + '"' + (on === id ? ' aria-current="page"' : '') + '>' + icon + label + '</a>'; }
    return '<nav class="menu" aria-label="메뉴"><div class="futwrap">' + futInner() + '</div><div class="tabs">' + a('home', '#/', ICON.list, '타점') + a('hold', '#/hold', ICON.wallet, '보유') + a('ind', '#/ind', ICON.sliders, '지표 설정') + a('record', '#/record', ICON.chart, '성적표') + a('settings', '#/settings', ICON.gear, '설정' + (unread() ? '<i class="dot" aria-label="새 공지"></i>' : '')) + '</div></nav>';
  }
  function top(title, right, extra) {
    return '<header class="top"><div class="bar">' + title + (right || '') + '</div>' + (extra || '') + '</header>';
  }
  function demoBar() { return LIVE ? '' : '<p class="demo">예시 데이터예요. 앱 연결을 마치면 실제 타점이 나와요.</p>'; }
  function chip(a) {
    if (a.side !== 'buy') return '<span class="chip sell">매도 알림</span>';
    var g = a.grade || '높음';
    return '<span class="chip g-' + g + '">점검 ' + g + (a.total ? ' ' + a.passed + '/' + a.total : '') + '</span>';
  }
  var REASON = [[/VWAP 돌파/, '평균 거래가 위로 올라섬'], [/VWAP 이탈/, '평균 거래가 아래로 내려옴'], [/VWAP 위 유지/, '평균 거래가 위 유지'], [/VWAP 아래 유지/, '평균 거래가 아래 유지'],
    [/단기선 상향/, '단기 평균선 위로'], [/단기선 하향/, '단기 평균선 아래로']];
  function plainReason(r) { REASON.forEach(function (x) { r = r.replace(x[0], x[1]); }); return r; }
  function where(a) { return MARKET[a.market] + (a.category ? ' › ' + a.category : '') + ' · ' + dayLabel(a.created_at) + ' ' + (a.reason ? plainReason(a.reason) : hm(a.created_at)); }
  function card(a) {
    var m = a.market, buy = a.side === 'buy', vals, foot;
    if (buy) {
      vals = [['매수 기준가', money(m, a.buy), 'red'], ['손절가', money(m, a.stop), 'blue'], [a.half ? '1차 매도' : '매도 기준가', money(m, a.sell), '']];
      var miss = (a.misses || []).map(function (x) { return MISS[x] || x; });
      foot = '신호 강도 ' + a.score * 10 + '%' + (a.qty ? ' · ' + a.qty : '') + (a.loss ? ' · 손절 시 -' + money(m, a.loss) : '') + (miss.length ? ' · 부족: ' + miss.join(', ') : '');
    } else {
      vals = [['현재가', money(m, a.price), ''], ['반등 매도가', a.rebound ? money(m, a.rebound) : '지금 매도', 'blue'],
        ['반등 폭', a.rebound ? '+' + ((a.rebound / a.price - 1) * 100).toFixed(1) + '%' : '-', '']];
      foot = '신호 강도 ' + a.score * 10 + '% · 보유 중이면 ' + (a.rebound ? '지금 또는 반등 때 매도' : '지금 매도');
    }
    return '<a class="card' + (!buy && heldBy(a) ? ' held' : '') + '" href="#/alert/' + esc(a.id) + '"><div class="head"><div class="title"><div class="name"><span class="side ' + (buy ? 'buy">매수' : 'sell">매도') + '</span>' + esc(a.name) + (heldBy(a) ? '<span class="mine">보유</span>' : '') + '</div><span class="small">' + esc(where(a)) + '</span></div>' + chip(a) + '</div>' +
      '<div class="vals">' + vals.map(function (v) { return '<div><span>' + v[0] + '</span><strong class="' + v[2] + '">' + esc(v[1]) + '</strong></div>'; }).join('') + '</div>' +
      '<span class="foot">' + esc(foot) + '</span></a>';
  }

  // ---------- 화면 ----------
  function pageWelcome() {
    var all = S.agree.every(Boolean);
    return '<main class="welcome"><div style="display:flex;flex-direction:column;gap:14px"><div class="logo">' + ICON.logo + '</div>' +
      '<h1>매수·매도 타점을<br>알림으로 받아 보세요</h1><p class="lead">국장·미장·코인에 타점이 생기면 매수 기준가, 손절가, 매도가와 안전 점검 결과를 함께 알려 드려요.</p>' +
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
  function noBuyNote(f, pf, mine) {        // 매수 알림이 없을 때 이유 설명 (고장 아님)
    if (!f || S.error || mine.some(function (a) { return a.side === 'buy'; })) return '';
    var mks = (S.tab === 'all' ? ['kr', 'us', 'crypto'] : [S.tab]).filter(function (m) { return pf.markets.indexOf(m) >= 0; });
    var flow = (f.brief && f.brief.flow) || {}, weak = mks.filter(function (m) { return flow[m] === false; });
    if (weak.length) return '<p class="info quiet-note"><b>지금은 ' + weak.map(function (m) { return MARKET[m]; }).join('·') + ' 흐름이 약해요.</b> 대표 지수가 200일 평균선 아래라 매수 조건을 통과하는 타점이 드물어요. 흐름이 좋아지면 다시 늘어나요. 무리해서 사지 않는 것도 방법이에요.</p>';
    return '<p class="info quiet-note">최근 3일 동안 내 조건에 맞는 매수 타점이 없었어요. 조건이 엄격할수록 알림이 드물어요. <a href="#/ind">지표 설정</a>에서 바꿀 수 있어요.</p>';
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
      status += age == null ? ' · 알림 서버 연결 전' : age > 30 ? ' · 알림 서버 ' + age + '분 전 확인' : ' · 알림 정상 작동 중';
    }
    var body = S.error ? '<p class="empty">' + esc(S.error) + '</p>'
      : !f ? '<p class="empty"><span class="spin" style="display:inline-block"></span></p>'
      : items.length ? items.map(card).join('')
      : '<p class="empty">최근 3일 동안 ' + (S.tab === 'all' ? '' : MARKET[S.tab] + ' ') + '내 조건에 맞는 타점이 없어요.<br>타점이 생기면 알림으로 알려 드려요.</p>';
    if (f && !S.error && hidden > 0) body += '<button class="btn ghost" data-act="showall">' + (S.showAll ? '내 조건에 맞는 것만 보기' : '조건에 안 맞아 숨긴 타점 ' + hidden + '건 보기') + '</button>';
    if (f && !S.error) body += '<a class="link-row" href="#/ind">받을 알림 조건 바꾸기 · 지표 설정 →</a><a class="link-row" href="#/guide">처음이라면 · 타점노트 사용법 보기 →</a>';
    return top('<span class="brand">타점노트<span class="tag">무료 베타</span></span>',
      '<span style="display:flex"><button class="icon-btn" data-act="refresh" aria-label="새로고침">' + ICON.refresh + '</button><a class="icon-btn" href="#/settings" aria-label="알림 설정">' + ICON.bell + '</a></span>',
      '<p class="notice">투자 참고용 정보이며 투자자문이 아니에요. 원금 손실이 생길 수 있고, 투자 판단과 책임은 본인에게 있어요.</p>' + demoBar() + (S.offline ? '<p class="warn" style="margin:0 0 10px">인터넷에 연결되지 않았어요. 마지막으로 받은 내용을 보여 드려요.</p>' : '') + '<div class="tabs" role="group" aria-label="시장">' + tabs + '</div>' + hoursLine(pf)) +
      '<main class="page">' + annBar() + (f && S.tab === 'all' && !S.error ? briefCard(f.brief) : '') + '<div class="row-head"><h1>최근 타점 <span>' + items.length + '건</span></h1><span class="small">' + esc(status) + '</span></div>' + noBuyNote(f, pf, mine) + body +
      '<p class="foot-note">안전 점검은 시장 흐름·종목 추세·눌림·변동성·실적 발표·과거 성적 6가지예요. 최근 3일 알림만 보여요.</p></main>' + menu('home');
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
      var hist = a.hist ? '<p class="info">과거 ' + (a.hist.src === '시장' ? '같은 시장 알림 전체' : '이 종목 알림') + '대로 샀다면 <b>' + a.hist.n + '번 · 승률 ' + Math.round(a.hist.win) + '% · 평균 ' + (a.hist.avg > 0 ? '+' : '') + Number(a.hist.avg).toFixed(1) + '%</b></p>' : '';
      out.push('<section class="card"><div class="line"><h2>안전 점검</h2>' + chip(a) + '</div><ul class="checks">' +
        miss.map(function (x) { return '<li>' + ICON.no + esc(MISS[x] || x) + '</li>'; }).join('') +
        (passN > 0 ? '<li>' + ICON.ok + (miss.length ? '나머지 ' + passN + '개 통과' : passN + '개 모두 통과') + '</li>' : '') + '</ul>' + hist +
        '<div class="line"><span>신호 강도 <small class="small">지표 10가지 중 맞은 비율</small></span><b>' + a.score * 10 + '% (' + a.score + '개)</b></div></section>');
    } else {
      out.push('<section class="card"><h2>보유 중이라면</h2><ol class="steps">' +
        (a.rebound ? '<li><i>1</i><span>지금 팔거나, <b>' + money(m, a.rebound) + '</b>까지 반등하면 팔아요</span></li>' : '<li><i>1</i><span>가까운 반등 자리가 없어요. 보유 중이라면 <b>지금 매도</b>를 참고하세요</span></li>') +
        '<li><i>2</i><span>다시 살 때는 🔴 매수 알림이 올 때만 사요</span></li></ol><div class="line"><span>신호 강도 <small class="small">지표 10가지 중 맞은 비율</small></span><b>' + a.score * 10 + '% (' + a.score + '개)</b></div></section>');
    }
    if (a.yt) {
      loadNews(a.yt);
      var an_ = (S.anews || {})[a.yt], nl = an_ && an_.items ? newsList(an_.items, 6) : '';
      if (nl) out.push('<section class="card"><h2 style="font-size:15px">관련 뉴스</h2><p class="small" style="margin:0 0 4px">구글 뉴스에서 찾은 최근 3일 기사 제목이에요. 누르면 기사로 가요.</p>' + nl + '</section>');
    }
    out.push(journalBox(a));
    var Ba = BROKERS[m === 'crypto' ? broker().coin : broker().stock];
    out.push('<button class="btn" data-act="aopenapp" data-v="' + esc(a.id) + '">' + esc(Ba.name) + '에서 보기</button>' +
      '<p class="foot-note">투자 참고용 정보이며 투자자문·매매 권유가 아니에요. 개별 상담과 자금 운용은 하지 않아요. 원금 손실이 생길 수 있고, 과거 성적은 미래 수익을 보장하지 않아요.</p>');
    return head + '<main class="page">' + out.join('') + '</main>' + menu('home');
  }
  function simSection(mk) {
    var rows = [['새 알림' + (mk.new ? ' ' + mk.new.n + '번' : ''), mk.new ? mk.new.total : null], ['예전 알림', mk.old ? mk.old.total : null]];
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
      return '<div class="grow"><span class="chip g-' + k + '">점검 ' + k + '</span><span>' + (x ? x.n + '번 · 승률 ' + Math.round(x.win / x.n * 100) + '%' : '거래 없음') + '</span><strong class="' + tone(x && x.total) + '">' + (x ? manwon(x.total) : '-') + '</strong></div>';
    }).join('');
    return '<section class="card"><div class="line"><h2>' + MARKET[mk.market] + '</h2><span class="small">' + mk.tickers + '종목 · 기준 ' + mk.cur + '점</span></div>' + bars +
      '<div class="line" style="border-top:1px solid var(--chip);padding-top:10px"><span>기간 검사 · 앞 절반 / 뒤 절반</span><b>' + half + '</b></div>' +
      grades +
      (mk.sell ? '<div class="line"><span>매도 알림 적중률 (3일 뒤)</span><b>10번 중 ' + Math.round(mk.sell.hits) + '번</b></div>' : '') + '</section>';
  }
  function liveSection(lv) {
    var span = S.liveSpan || 'week', d = (lv && lv[span]) || {};
    var keys = Object.keys(d);
    var rows = keys.length ? keys.map(function (mk) {
      return '<section class="card"><h2>' + MARKET[mk] + '</h2>' + ['높음', '보통', '낮음'].filter(function (g) { return d[mk][g]; }).map(function (g) {
        var x = d[mk][g];
        return '<div class="grow"><span class="chip g-' + g + '">점검 ' + g + '</span><span>' + x.n + '번 · 이익 ' + x.win + '</span><strong class="' + tone(x.sum) + '">' + manwon(x.sum) + '</strong></div>';
      }).join('') + '</section>';
    }).join('') : '<p class="empty">' + (span === 'week' ? '지난 7일 동안 끝난 거래가 없어요.' : '아직 끝난 거래가 없어요. 베타 알림 결과가 쌓이면 여기에 나와요.') + '</p>';
    return '<div class="seg" role="group" aria-label="기간"><button data-act="span" data-v="week" class="' + (span === 'week' ? 'on' : '') + '">지난 7일</button><button data-act="span" data-v="all" class="' + (span === 'all' ? 'on' : '') + '">전체</button></div>' +
      '<p class="foot-note" style="margin:0 4px">보낸 매수 알림대로 매수 기준가에 100만원씩 샀다고 치고 계산했어요.</p>' + rows +
      (lv ? '<p class="small" style="margin:0 4px">보유 중 ' + lv.held + '개 · 매수가 기다리는 중 ' + lv.waiting + '개' + (lv.paused && lv.paused.length ? ' · 연속 손실로 🟢를 낮춘 시장: ' + lv.paused.map(function (x) { return MARKET[x]; }).join(', ') : '') + '</p>' : '');
  }
  function pageRecord() {
    var f = S.feed, body;
    if (!f && S.rec !== 'mine') body = '<p class="empty">' + (S.error ? esc(S.error) : '불러오는 중…') + '</p>';
    else if (S.rec === 'mine') body = journalSection();
    else if (S.rec === 'sim') {
      body = f.sim && f.sim.markets && f.sim.markets.length
        ? '<p class="foot-note" style="margin:0 4px">알림이 올 때마다 100만원씩 샀다고 치고 과거(국장·미장 약 3년, 코인 2년)를 다시 돌려 본 결과예요. 수수료 0.2% 포함 · ' + kst(new Date(f.sim.made), { month: 'numeric', day: 'numeric' }) + ' 계산</p>' + f.sim.markets.map(simSection).join('')
        : '<p class="empty">아직 계산한 결과가 없어요.<br>하루 안에 채워져요.</p>';
    } else body = liveSection(f.live);
    return top('<h1 style="margin:0;font-size:20px">성적표</h1>', '', demoBar() + '<div class="seg three rec" role="tablist"><button role="tab" data-act="rec" data-v="sim" class="' + (S.rec === 'sim' ? 'on' : '') + '" aria-selected="' + (S.rec === 'sim') + '">과거 시뮬레이션</button><button role="tab" data-act="rec" data-v="live" class="' + (S.rec === 'live' ? 'on' : '') + '" aria-selected="' + (S.rec === 'live') + '">실전 기록</button><button role="tab" data-act="rec" data-v="mine" class="' + (S.rec === 'mine' ? 'on' : '') + '" aria-selected="' + (S.rec === 'mine') + '">내 매매일지</button></div>') +
      '<main class="page">' + body + '<p class="foot-note">과거 성적은 미래 수익을 보장하지 않아요. 투자 참고용 정보이며 투자자문이 아니에요.</p></main>' + menu('record');
  }
  function sw(act, on, label, hint, disabled) {
    return '<div class="item"><span><b>' + label + '</b><small>' + hint + '</small></span><button class="sw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + on + '" aria-label="' + label + '" data-act="' + act + '"' + (disabled ? ' disabled' : '') + '></button></div>';
  }
  function loadWhatIf(mk, rule) {
    if (!LIVE || !rule) return null;
    var key = mk + JSON.stringify({ s: rule.score, n: (rule.need || []).slice().sort(), c: !!rule.card });
    S.wi = S.wi || {};
    var x = S.wi[key];
    if (x) return x.data || null;
    S.wi[key] = { loading: true };
    rpc('app_research_whatif', { p_code: code(), p_market: mk, p_rule: { score: rule.score, need: rule.need || [], card: !!rule.card } })
      .then(function (d) { S.wi[key] = { data: d || {} }; }).catch(function () { S.wi[key] = { data: {} }; })
      .then(function () { if (/ind/.test(location.hash)) render(); });
    return null;
  }
  function wiLine(W, k, on) {
    var b = W && W.base, x = W && W[k];
    if (!b || !b.n || !x) return '';
    if (!x.n) return '<em class="wi">' + (on ? '끄면' : '켜면') + ' · 과거에 맞는 알림이 없었어요</em>';
    var B = stat(b), X = stat(x), d = x.n / b.n - 1;
    var st = function (v) { return v == null ? '-' : Math.round(v) + '%'; };
    return '<em class="wi">' + (on ? '끄면' : '켜면') + ' · 안정성 ' + st(B.stable) + ' → <b class="' + (X.stable > B.stable ? 'red' : X.stable < B.stable ? 'blue' : '') + '">' + st(X.stable) + '</b>' +
      ' · 수익성 ' + pct(B.profit) + ' → <b class="' + tone(X.profit - B.profit) + '">' + pct(X.profit) + '</b>' +
      ' · 알림 ' + (Math.abs(d) < 0.005 ? '그대로' : Math.round(Math.abs(d) * 100) + '% ' + (d > 0 ? '늘어요' : '줄어요')) + '</em>';
  }
  function condSection(p) {
    var cur = p.preset || (p.rules ? '직접' : ''), list = presetList();
    var chips = list.map(function (x) {
      return '<button role="radio" aria-checked="' + (cur === x.id) + '" class="' + (cur === x.id ? 'on' : '') + '" data-act="preset" data-v="' + esc(x.id) + '">' + esc(x.label) + '</button>';
    }).join('') + '<button role="radio" aria-checked="' + (cur === '직접') + '" class="' + (cur === '직접' ? 'on' : '') + '" data-act="preset" data-v="직접">직접 설정</button>';
    var body = '';
    if (!cur) {
      body = '<p class="info">아직 조건을 고르지 않았어요. 지금은 점검 보통 이상 · 신호 강도 60% 이상 매수 알림을 받아요. <b>추천</b>을 눌러 보세요.</p>';
    } else if (cur !== '직접') {
      var ps = findPreset(cur) || { desc: '', rules: p.rules || {} };
      body = '<p class="small" style="margin:0;line-height:1.6;color:var(--sub)">' + esc(ps.desc || '') + '</p>' +
        '<div class="rules">' + ['kr', 'us', 'crypto'].map(function (mk) {
          var r = (p.rules || ps.rules || {})[mk];
          return r ? '<div class="line"><span>' + MARKET[mk] + '</span><span class="small" style="text-align:right">' + esc(ruleText(r, mk)) + '</span></div>' : '';
        }).join('') + '</div>' +
        '<p class="small" style="margin:0">조건을 하나씩 바꾸려면 <b>직접 설정</b>을 눌러 주세요.</p>';
    } else {
      var c = customOf(p), W = loadWhatIf(S.cm, c);
      body = '<p class="small" style="margin:0;line-height:1.5">시장마다 잘 맞는 조건이 달라서 시장별로 따로 정해요.</p>' +
        '<div class="seg three" role="tablist" aria-label="시장">' + ['kr', 'us', 'crypto'].map(function (mk) {
          return '<button role="tab" aria-selected="' + (S.cm === mk) + '" class="' + (S.cm === mk ? 'on' : '') + '" data-act="cm" data-v="' + mk + '">' + MARKET[mk] + '</button>';
        }).join('') + '</div>' +
        '<h3 class="sub-h">안전 점검 지표 <small>켜면 그 조건을 통과한 알림만 받아요</small></h3><div class="list inner">' +
        GUARDS.filter(function (g) { return g[0] !== '실적' || S.cm === 'us'; }).map(function (g) { var on = c.need.indexOf(g[0]) >= 0; return sw('g-' + g[0], on, g[1], g[2] + wiLine(W, 'g:' + g[0], on)); }).join('') + '</div>' +
        '<h3 class="sub-h">수익성 지표</h3><div class="list inner">' + sw('card', !!c.card, PROFIT[1], PROFIT[2] + wiLine(W, 'card', !!c.card)) + '</div>' +
        '<h3 class="sub-h">신호 강도 <small>지표 10가지 중 몇 % 이상 맞을 때 받을지</small></h3><div class="grades four" role="radiogroup" aria-label="신호 강도">' +
        SCORES.map(function (n) { var x = W && W['s:' + n], t = x && x.n ? stat(x) : null;
          return '<button role="radio" aria-checked="' + (c.score === n) + '" class="' + (c.score === n ? 'on' : '') + '" data-act="score" data-v="' + n + '">' + n * 10 + '%↑' +
            (t ? '<small class="wis">안정성 ' + (t.stable == null ? '-' : Math.round(t.stable) + '%') + '</small>' : '') + '</button>'; }).join('') + '</div>' +
        '<p class="small" style="margin:0">스위치 아래 <b>켜면 / 끄면</b>은 ' + MARKET[S.cm] + ' 과거 백테스트에서 그 조건 하나만 바꿨을 때 달라지는 값이에요.</p>';
      var R = curStats(p);
      body += '<h3 class="sub-h">' + MARKET[S.cm] + '을 이 조건으로 돌려 보면</h3>' +
        (!LIVE ? '<p class="small" style="margin:0">앱 연결 후 과거 성적이 여기에 나와요.</p>'
          : !R || R.loading ? '<p class="small" style="margin:0">계산 중…</p>'
          : R.err || !R.data ? '<p class="small" style="margin:0">성적을 불러오지 못했어요.</p>'
          : marketStat(S.cm, R.data[S.cm])) +
        '<p class="small" style="margin:0">바꿀 때마다 맨 위 <b>내 설정 예상 성적</b>도 같이 바뀌어요.</p>';
    }
    return '<section class="card"><h2 style="font-size:15px">받을 매수 알림</h2><div class="grades four presets" role="radiogroup" aria-label="추천 설정">' + chips + '</div>' + body +
      '</section>';
  }
  function pageInd() {
    var p = prefs();
    return top('<h1 style="margin:0;font-size:20px">지표 설정</h1>', '', demoBar() +
        '<p class="notice">받을 매수 알림을 정해요. 홈 목록과 푸시 알림 모두 이 조건으로 걸러져요.</p>') +
      '<main class="page">' + statSection(p) + condSection(p) +
      '<p class="foot-note">과거 성적은 국장·미장 약 3년, 코인 2년치 1시간봉으로 알림마다 100만원씩 샀다고 치고, 수수료 0.2%를 빼고 계산했어요. 수익성은 한 번 살 때 평균 수익률, 안정성은 알림이 있었던 달 중 수익 난 달의 비율이에요. 과거 성적은 미래 수익을 보장하지 않아요. 투자 참고용 정보이며 투자자문이 아니에요.</p></main>' + menu('ind');
  }
  function pageSettings() {
    var p = prefs(), on = pushOn(), mk = p.markets;
    var help = S.pushHelp ? '<p class="warn">아이폰은 Safari에서 아래쪽 <b>공유 버튼</b> → <b>홈 화면에 추가</b>를 누른 뒤, 홈 화면의 타점노트 아이콘으로 열어야 알림을 켤 수 있어요.</p>' : '';
    var denied = pushOK && Notification.permission === 'denied' ? '<p class="warn">이 휴대폰에서 알림이 차단돼 있어요. 휴대폰 설정 → 알림에서 타점노트(또는 브라우저)를 허용해 주세요.</p>' : '';
    var c = code();
    return top('<h1 style="margin:0;font-size:20px" data-act="devtap">알림 설정</h1>', '', demoBar()) + '<main class="page">' + help + denied +
      '<section class="list">' + sw('push', on, '푸시 알림 받기', S.busy ? '켜는 중…' : (on ? '켜져 있어요' : '타점이 생기면 바로 알려 드려요'), S.busy) +
      sw('mk-kr', mk.indexOf('kr') >= 0, '국장', '평일 09:15 ~ 15:20') + sw('mk-us', mk.indexOf('us') >= 0, '미장', '평일 밤 (한국 시간)') +
      sw('mk-crypto', mk.indexOf('crypto') >= 0, '코인', '24시간') + sw('sell', p.sell, '매도 알림', '최근 7일 안에 매수 알림이 나간 종목이나 보유 중인 종목만 받아요 · 3일 뒤 실제로 내린 건 절반쯤이에요') +
      (p.sell ? sw('sellAll', p.sellAll, '모든 종목 매도 알림', '다른 종목도 갖고 있다면 켜 주세요 · 알림이 많아져요') : '') +
      sw('brief', p.brief, '아침 브리핑', '매일 아침 8시쯤 밤사이 시장 요약 (일요일 쉼)') + sw('quiet', p.quiet, '방해 금지', '밤 12시 ~ 아침 7시는 조용히') + '</section>' +
      '<section class="card"><h2 style="font-size:15px">증권사 · 거래소 앱</h2><p class="small" style="margin:0">내 보유에서 <b>…에서 보기</b>를 누르면 여기서 고른 앱이 열리고 종목 코드가 복사돼요. 토스증권(국장)과 업비트는 종목 화면으로 바로 가요.</p>' +
        '<h3 class="pick-h">주식 (국장 · 미장)</h3><div class="picks">' + STOCK_APPS.map(function (k) { return bchip(k, 'stock'); }).join('') + '</div>' +
        '<h3 class="pick-h">코인</h3><div class="picks">' + COIN_APPS.map(function (k) { return bchip(k, 'coin'); }).join('') + '</div></section>' +
      '<a class="list item-link" href="#/notice"><span><b>공지사항' + (unread() ? ' <span class="tag new">새 글 ' + unread() + '</span>' : '') + '</b><small>' + (S.ann && S.ann[0] ? esc(S.ann[0].date + ' · ' + S.ann[0].title) : '업데이트 소식') + '</small></span><span aria-hidden="true">›</span></a>' +
      '<a class="list item-link" href="#/guide"><span><b>타점노트 사용법</b><small>알림 읽는 법 · 사고파는 순서 · 장 시간</small></span><span aria-hidden="true">›</span></a>' +
      '<section class="card"><div class="line"><h2 style="font-size:15px">구독</h2><span class="tag">준비 중</span></div><p class="small" style="margin:0;line-height:1.6;color:var(--sub)">지금은 무료 베타예요. 정식 구독은 관련 신고를 마친 뒤에 시작하고, 시작 전에 미리 알려 드려요.</p></section>' +
      '<section class="card"><details><summary style="font-size:14px;font-weight:600;cursor:pointer;min-height:28px">투자 위험 고지</summary><ul style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.6;color:var(--sub)">' + NOTICES.map(function (n) { return '<li><b>' + n[0] + '</b> ' + n[1] + '</li>'; }).join('') + '</ul></details>' +
      '<details><summary style="font-size:14px;font-weight:600;cursor:pointer;min-height:28px">개인정보 안내</summary><p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:var(--sub)">이름·전화번호·이메일은 받지 않아요. 푸시 알림을 켜면 이 휴대폰의 알림 주소와 알림 설정만 저장하고, 알림을 끄면 지워요. 입장 코드는 이 휴대폰에만 저장돼요. <a href="privacy.html" style="color:var(--blue);text-decoration:underline">개인정보처리방침 전체 보기</a></p></details>' +
      (LIVE && c && c !== OPEN_CODE ? '<div class="line"><span>초대 코드 ' + esc(c.slice(0, 4)) + '-••••</span><button class="btn ghost" style="width:auto;min-height:40px;padding:0 14px;font-size:13px" data-act="logout">코드 지우기</button></div>' : '') + '</section>' +
      '<p class="foot-note">투자 참고용 정보이며 투자자문이 아니에요. 서비스 제공자는 금융투자업자가 아니며, 개별 상담과 자금 운용은 하지 않아요.</p></main>' + menu('settings');
  }

  function pageGuide() {
    var sec = function (t, body) { return '<section class="card guide"><h2>' + t + '</h2>' + body + '</section>'; };
    var li = function (xs) { return '<ul>' + xs.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; };
    return top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">타점노트 사용법</span></span>') + '<main class="page">' +
      sec('타점노트는 이런 앱이에요', '<p>국장·미장·코인에서 정해진 규칙(지표 10가지 + 안전 점검)에 맞는 자리가 생기면 알려 줘요. 사람이 고르는 추천이 아니라 규칙대로 계산한 <b>참고 정보</b>예요.</p>') +
      sec('🔴 매수 알림 읽는 법', li(['<b>매수 기준가</b>: 이 가격 근처나 아래에서 사요. 지금 가격이 많이 위면 기다려요.', '<b>손절가</b>: 여기에 닿으면 팔아서 손실을 작게 끊어요. 가장 중요해요.', '<b>1차 매도</b>: 여기서 절반을 팔고, 남은 절반은 손절가를 산 가격으로 올려요.', '<b>나머지</b>: 오른 뒤 고점에서 정해진 만큼 빠지면 팔아요.', '<b>안전 점검</b>: 시장 흐름·추세·눌림·변동성·실적·과거 성적 6가지 중 몇 개를 통과했는지예요. 지표 설정의 <b>안정성 %</b>와는 다른 거예요.', '<b>신호 강도</b>: 지표 10가지 중 몇 %가 맞았는지예요. 60%면 10가지 중 6가지가 맞은 거예요.'])) +
      sec('🔵 매도 알림', '<p>이미 갖고 있는 종목이 약해질 때 와요. 기본으로는 <b>최근 7일 안에 매수 알림이 나간 종목</b>과 실전 기록·내 매매일지에 보유 중인 종목만 보여 줘요. 다른 종목도 갖고 있다면 설정에서 <b>모든 종목 매도 알림</b>을 켜세요. 과거 기록에서 3일 뒤 실제로 내린 건 절반 정도라 참고만 하세요.</p>') +
      sec('내 보유 탭', '<ul><li><b>+ 종목 추가</b>로 가진 종목을 넣어요. 국장·미장·코인 아무 종목이나 돼요. 수량과 평균 단가는 이 휴대폰에만 저장돼요.</li><li><b>확률 계산에 쓸 지표</b>를 고르면, 그 지표들이 지금과 같았던 지난 5년의 날들에서 1·5·20거래일 뒤 실제로 오른 비율을 보여 줘요.</li><li><b>표본 적음</b>이 붙으면 비슷한 날이 적어서 숫자가 흔들리기 쉬워요. 지표를 줄여 보세요.</li><li>상승 확률은 대부분 50% 근처예요. 평소 상승 비율과 비교해서 보세요. 미래를 보장하지 않아요.</li><li><b>…에서 보기</b>를 누르면 <b>설정 → 증권사 · 거래소 앱</b>에서 고른 앱이 열리고 종목 코드가 복사돼요. 주식 10곳, 코인 4곳 중에 고를 수 있어요.</li><li>카드 아래에 그 종목의 최근 뉴스 제목이 나와요. 1시간 안에 나온 기사에는 <b>속보</b>가 붙어요.</li><li><b>지금 상태</b>의 %는 지난 1년 중 오늘보다 약했던 날의 비율이에요. 80%면 1년 중 상위 20% 수준이에요.</li><li><b>자세히</b>를 누르면 <b>투자 대가의 눈으로 보기</b>가 나와요. 버핏·그레이엄·린치·오닐·미너비니·리버모어의 공개된 원칙을 몇 % 충족하는지 보여 줘요. 그 사람이 직접 평가한 게 아니에요.</li><li>가진 종목이 아니어도 수량 없이 넣으면 <b>관심</b> 묶음에 들어가요.</li><li>카드의 오각형은 상승 힘·안정감·가격 매력·성장성·재무 건강 5가지를 0~100으로 그린 거예요. 가운데 숫자는 평균(종합 점수)이고 참고용이에요.</li></ul>') +
      sec('메뉴 위 선물 막대', '<ul><li>S&P500 · 나스닥100 · 다우 <b>지수 선물</b>의 등락을 보여 줘요. 밤(오후 6시 ~ 아침 6시)에는 <b>야간 선물</b>로 표시돼요.</li><li>누르면 가격, 오늘 흐름 그래프, 기준 시각이 펼쳐져요. 5분마다 새로 받고, 거래소 기준 약 10분 늦은 값이에요.</li></ul>') +
      sec('알림이 오면 이 순서로', '<ol><li>앱에서 매수 기준가·손절가를 확인해요.</li><li>증권사 앱에서 <b>현재가</b>를 꼭 다시 봐요. 국장 시세는 늦을 수 있어요.</li><li>지정가로 주문해요. 한 종목에 돈을 너무 많이 넣지 않아요.</li><li>손절가에 알림이나 주문을 걸어 둬요.</li><li>타점 화면에서 <b>샀어요</b>를 눌러 매매일지에 적어요.</li></ol>') +
      sec('지표 설정 · 수익성 · 안정성', li(['<b>지표 설정</b> 탭에서 받을 매수 알림 조건을 골라요. 처음이면 <b>추천</b>이 무난해요.', '<b>수익성</b>: 알림대로 100만원씩 샀을 때 한 번 살 때 평균 수익률(수수료 포함)이에요.', '<b>안정성</b>: 알림이 있었던 달 중 수익 난 달의 비율이에요.', '모두 과거 데이터로 계산한 값이라 앞으로도 그렇다는 보장은 없어요.'])) +
      sec('장 시간 (한국 시간)', li(['국장: 평일 09:00 ~ 15:30', '미장: 평일 23:30 ~ 다음 날 06:00 (미국 서머타임에는 22:30 ~ 05:00)', '코인: 24시간', '휴장일과 미장 조기 마감은 첫 화면 장 시간에 반영돼요. 국장 2027년 휴장일은 거래소 공식 발표 전이라 공휴일 기준이에요.'])) +
      sec('꼭 지켜 주세요', li(['손절가는 꼭 지켜요. 버티다 손실이 커지는 경우가 가장 많아요.', '빌린 돈이나 당장 필요한 돈으로 하지 않아요.', '알림은 참고 정보예요. 투자 판단과 책임은 본인에게 있어요.'])) +
      '</main>' + menu('');
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
    else if (r.p === 'record') { if (r.id === 'mine' || r.id === 'sim' || r.id === 'live') S.rec = r.id; html = pageRecord(); }
    else if (r.p === 'guide') html = pageGuide();
    else if (r.p === 'notice') html = pageNotice();
    else if (r.p === 'dev') html = pageDev();
    else if (r.p === 'hold') html = r.id === 'add' ? pageHoldAdd() : pageHold();
    else if (r.p === 'settings') html = pageSettings();
    else if (r.p === 'ind') html = pageInd();
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
    sellAll: function () { var p = prefs(); p.sellAll = !p.sellAll; savePrefs(p); },
    brief: function () { var p = prefs(); p.brief = !p.brief; savePrefs(p); toast(p.brief ? '아침 브리핑을 받아요' : '아침 브리핑을 껐어요'); },
    grade: function (t) { var p = prefs(); p.minGrade = t.dataset.v; savePrefs(p); },
    showall: function () { S.showAll = !S.showAll; render(); },
    briefhide: function () { var b = S.feed && S.feed.brief; if (b) store.set(K.briefHide, b.day); render(); },
    jbuyopen: function (t) { S.jbuy = t.dataset.v; S.jsell = null; render(); },
    jsellopen: function (t) { S.jsell = t.dataset.v; S.jbuy = null; S.jdel = null; render(); },
    jcancel: function () { S.jbuy = S.jsell = null; render(); },
    hind: function (t) {
      var sel = hind(), k = t.dataset.v, i = sel.indexOf(k);
      if (i >= 0) sel.splice(i, 1); else sel.push(k);
      store.set(K.hind, sel); S.hindOpen = true; render();
    },
    hpick: function (t) { S.hsel = (S.hres || [])[+t.dataset.v]; render(); },
    hback: function () { if (S.hsel) { S.hsel = null; render(); } else location.hash = '#/hold'; },
    hmore: function (t) { S.hopen = S.hopen === t.dataset.v ? null : t.dataset.v; render(); },
    hedit: function (t) { S.hedit = t.dataset.v; S.hdel = null; render(); },
    hcancel: function () { S.hedit = null; S.hdel = null; if (location.hash.indexOf('add') >= 0 && S.hsel) { S.hsel = null; } render(); },
    hdel: function (t) {
      var id = t.dataset.v;
      if (S.hdel !== id) { S.hdel = id; render(); return; }
      holdSave(holds().filter(function (h) { return h.id !== id; })); S.hdel = S.hedit = null; toast('보유 종목에서 지웠어요'); render();
    },
    hopenapp: function (t) { var h = holds().filter(function (x) { return x.id === t.dataset.v; })[0]; if (h) openBroker(h); },
    bstock: function (t) { var b = store.get(K.broker, {}) || {}; b.stock = t.dataset.v; store.set(K.broker, b); render(); },
    aopenapp: function (t) {
      var x = ((S.feed && S.feed.alerts) || []).filter(function (y) { return String(y.id) === t.dataset.v; })[0];
      if (!x) return;
      if (x.yt) openBroker({ market: x.market, code: x.market === 'kr' ? x.yt.split('.')[0] : x.market === 'crypto' ? x.yt.replace('-KRW', '') : x.yt });
      else openBroker({ market: x.market, code: x.name, byName: true });   // 예전 알림: 종목 이름을 복사
    },
    devcopy: function () { if (S.devfp) { try { navigator.clipboard.writeText(S.devfp).then(function () { toast('등록 코드를 복사했어요'); }, function () { toast('길게 눌러 직접 복사해 주세요'); }); } catch (_) { toast('길게 눌러 직접 복사해 주세요'); } } },
    devreload: function () { S.dev = null; loadDev(true); render(); },
    devtap: function () { S.devTaps = (S.devTaps || 0) + 1; clearTimeout(S.devTimer); S.devTimer = setTimeout(function () { S.devTaps = 0; }, 2500); if (S.devTaps >= 7) { S.devTaps = 0; location.hash = '#/dev'; } },
    anndis: function () { markSeen(); render(); },
    lgopen: function (t) { S.lgopen = S.lgopen === t.dataset.v ? null : t.dataset.v; render(); },
    futopen: function () { S.futOpen = !S.futOpen; document.querySelectorAll('.futwrap').forEach(function (el) { el.innerHTML = futInner(); }); },
    bcoin: function (t) { var b = store.get(K.broker, {}) || {}; b.coin = t.dataset.v; store.set(K.broker, b); render(); },
    jexport: function () {
      var list = jr();
      if (!list.length) { toast('내보낼 기록이 없어요'); return; }
      var blob = new Blob([JSON.stringify({ app: 'tajeom-note', v: 1, at: new Date().toISOString(), items: list }, null, 1)], { type: 'application/json' });
      var a = document.createElement('a'), d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = 'tajeom-journal-' + d.getFullYear() + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + (d.getDate() < 10 ? '0' : '') + d.getDate() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      toast('백업 파일을 저장했어요');
    },
    jdel: function (t) {
      var id = t.dataset.v;
      if (S.jdel !== id) { S.jdel = id; render(); return; }
      jrSave(jr().filter(function (e) { return e.id !== id; })); S.jdel = null; toast('기록을 지웠어요'); render();
    },
    cm: function (t) { S.cm = t.dataset.v; render(); loadStats(); },
    preset: function (t) {
      var p = prefs(), id = t.dataset.v;
      if (id === '직접') { p.rules = baseRules(p); p.preset = '직접'; savePrefs(p); loadStats(); return; }
      var ps = findPreset(id); if (!ps) return;
      p.preset = id; p.rules = clone(ps.rules); savePrefs(p); toast(ps.label + ' 설정을 적용했어요');
    },
    card: function () { editCustom(function (c) { c.card = !c.card; }); },
    score: function (t) { editCustom(function (c) { c.score = +t.dataset.v; }); },
    logout: function () { if (pushOn()) disablePush(); store.del(K.code); store.del(K.feed); S.feed = null; S.open = false; location.hash = '#/'; render(); }
  };
  function editCustom(fn) { var p = prefs(), c = customOf(p); fn(c); p.rules = baseRules(p); p.rules[S.cm] = c; p.preset = '직접'; savePrefs(p); loadStats(); }
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
  $app.addEventListener('input', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-hq')) hSearch(e.target.value.trim());
  });
  $app.addEventListener('change', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-imp')) { jImport(e.target.files && e.target.files[0]); e.target.value = ''; }
  });
  $app.addEventListener('submit', function (e) {
    var form = e.target.getAttribute('data-form');
    if (form === 'hsave' || form === 'hmanual') {
      e.preventDefault();
      if (form === 'hmanual') {
        var mk = e.target.market.value, cd = e.target.code.value.trim().toUpperCase().replace(/\s/g, ''), nm = e.target.name.value.trim();
        var m2 = mk === 'KS' || mk === 'KQ' ? 'kr' : mk;
        var yt = m2 === 'kr' ? cd + '.' + mk : m2 === 'crypto' ? cd.replace(/-?KRW$/, '') + '-KRW' : cd.replace('.', '-');
        var okc = m2 === 'kr' ? /^[0-9A-Z]{6}\.(KS|KQ)$/.test(yt) : m2 === 'us' ? /^[A-Z][A-Z0-9.\-]{0,9}$/.test(yt) : /^[A-Z0-9]{2,12}-KRW$/.test(yt);
        if (!okc || !nm) { toast('종목 코드를 확인해 주세요'); return; }
        S.hsel = { yt: yt, code: m2 === 'crypto' ? yt.replace('-KRW', '') : cd, name: nm, market: m2 }; render(); return;
      }
      var q = parseFloat(e.target.qty.value) || 0, av = parseFloat(e.target.avg.value) || 0, hid_ = e.target.getAttribute('data-id');
      if (q < 0 || av < 0) { toast('숫자를 확인해 주세요'); return; }
      if (hid_) {
        var L = holds(); L.forEach(function (h) { if (h.id === hid_) { h.qty = q; h.avg = av; } }); holdSave(L); S.hedit = null; toast('저장했어요'); render(); return;
      }
      if (!S.hsel) return;
      addHolding(S.hsel, q, av); S.hsel = null; S.hq = ''; S.hres = null; toast('내 보유에 넣었어요'); location.hash = '#/hold'; return;
    }
    if (form === 'jbuy' || form === 'jsell') {
      e.preventDefault();
      var price = parseFloat(e.target.price.value), id = e.target.getAttribute('data-id'), list = jr();
      if (!(price > 0)) { toast('가격을 확인해 주세요'); return; }
      if (form === 'jbuy') {
        var amount = parseFloat(e.target.amount.value);
        var a = ((S.feed && S.feed.alerts) || []).filter(function (x) { return String(x.id) === id; })[0];
        if (!a || !(amount > 0)) { toast('금액을 확인해 주세요'); return; }
        var jid = 'j' + Date.now();
        list.push({ id: jid, aid: a.id, yt: a.yt || null, name: a.name, market: a.market, buy: price, amount: amount, stop: a.stop, sell: a.sell, half: !!a.half, at: new Date().toISOString(), out: null });
        S.jbuy = null;
        if (a.yt) {
          var cdj = a.market === 'kr' ? a.yt.split('.')[0] : a.market === 'crypto' ? a.yt.replace('-KRW', '') : a.yt;
          addHolding({ yt: a.yt, code: cdj, name: a.name, market: a.market }, Math.round(amount / price * 1e6) / 1e6, price, { jid: jid });
          toast('매매일지와 내 보유에 적었어요');
        } else toast('매매일지에 적었어요');
      } else {
        list.forEach(function (x) { if (x.id === id) x.out = { price: price, at: new Date().toISOString() }; });
        S.jsell = null;
        var hl = holds(), hit = false;
        hl = hl.filter(function (h) {
          if (h.jid === id) { hit = true; return false; }
          if (!h.jq || !(id in h.jq)) return true;
          hit = true;
          h.qty = Math.round(((+h.qty || 0) - h.jq[id]) * 1e6) / 1e6; delete h.jq[id];
          return h.qty > 0;
        });
        if (hit) { holdSave(hl); toast('판 기록을 적고 내 보유에서 뺐어요'); } else toast('판 기록을 적었어요');
      }
      jrSave(list); render(); return;
    }
    if (form !== 'code') return;
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
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { loadFeed(); loadFut(); } });
  setInterval(loadFut, 60000);
  setInterval(function () { if (document.visibilityState === 'visible' && !/settings|alert|ind|guide|hold|notice|dev/.test(location.hash) && !S.jsell && !S.jbuy) loadFeed(); }, 60000);
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
  loadNotices();

  // 시작 화면: 앱을 열 때 1초쯤 보여 주고 사라짐 (처음 쓰는 사람은 그다음 안내·동의 화면)
  var splash = document.getElementById('splash');
  if (splash) {
    setTimeout(function () {
      splash.classList.add('hide');
      setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 400);
    }, 1100);
  }
})();
