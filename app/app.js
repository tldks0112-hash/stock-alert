// 타점노트 무료 베타 앱 (설치형 웹앱)
// config.js(배포할 때 자동 생성)에 데이터베이스 주소가 있으면 실제 데이터, 없으면 예시 데이터로 보여 줘요.
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var LIVE = !!(CFG.supabaseUrl && CFG.supabaseKey);
  var $app = document.getElementById('app');
  var K = { consent: 'tn_consent_v1', code: 'tn_code', prefs: 'tn_prefs', push: 'tn_push', feed: 'tn_feed', jr: 'tn_journal', briefHide: 'tn_brief_hide' };
  var MARKET = { kr: '국장', us: '미장', crypto: '코인' };
  var MISS = { '시장약세': '시장 흐름 약함', '추세약세': '종목 추세 약함', '이미오름': '이미 많이 오름', '변동큼': '변동성 큼',
    '실적임박': '실적 발표 임박', '기록부족': '과거 기록 부족', '과거손실': '과거 성적 손실', '🟢연속손실': '최근 연속 손실' };
  var GRADE_RANK = { '낮음': 0, '보통': 1, '높음': 2 };
  var DEFAULT_PREFS = { markets: ['kr', 'us', 'crypto'], minGrade: '보통', sell: true, sellAll: false, quiet: false, brief: true, preset: '', rules: null };
  // 매수 알림 조건: 안전 점검 지표 5가지 + 과거 성적 1가지 + 신호 점수
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
    return (need.length ? need.join('·') : '점검 조건 없음') + (r.card ? ' · 과거 성적' : '') + ' · 신호 ' + r.score + '점 이상';
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

  // ---------- 화면 조각 ----------
  function menu(on) {
    function a(id, href, icon, label) { return '<a href="' + href + '" class="' + (on === id ? 'on' : '') + '"' + (on === id ? ' aria-current="page"' : '') + '>' + icon + label + '</a>'; }
    return '<nav class="menu" aria-label="메뉴"><div>' + a('home', '#/', ICON.list, '타점') + a('ind', '#/ind', ICON.sliders, '지표 설정') + a('record', '#/record', ICON.chart, '성적표') + a('settings', '#/settings', ICON.gear, '설정') + '</div></nav>';
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
      status += age == null ? ' · 엔진 연결 전' : age > 30 ? ' · 엔진 확인 ' + age + '분 전' : ' · 엔진 정상';
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
      '<main class="page">' + (f && S.tab === 'all' && !S.error ? briefCard(f.brief) : '') + '<div class="row-head"><h1>최근 타점 <span>' + items.length + '건</span></h1><span class="small">' + esc(status) + '</span></div>' + noBuyNote(f, pf, mine) + body +
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
        '<div class="line"><span>신호 점수 (지표 10가지)</span><b>' + a.score + '/10</b></div></section>');
    } else {
      out.push('<section class="card"><h2>보유 중이라면</h2><ol class="steps">' +
        (a.rebound ? '<li><i>1</i><span>지금 팔거나, <b>' + money(m, a.rebound) + '</b>까지 반등하면 팔아요</span></li>' : '<li><i>1</i><span>가까운 반등 자리가 없어요. 보유 중이라면 <b>지금 매도</b>를 참고하세요</span></li>') +
        '<li><i>2</i><span>다시 살 때는 🔴 매수 알림이 올 때만 사요</span></li></ol><div class="line"><span>신호 점수 (지표 10가지)</span><b>' + a.score + '/10</b></div></section>');
    }
    out.push(journalBox(a));
    out.push('<a class="btn" href="https://tossinvest.com" target="_blank" rel="noopener">증권 앱에서 보기</a>' +
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
        : '<p class="empty">아직 계산한 결과가 없어요.<br>점검 작업을 한 번 돌리면 여기에 나와요.</p>';
    } else body = liveSection(f.live);
    return top('<h1 style="margin:0;font-size:20px">성적표</h1>', '', demoBar() + '<div class="seg three rec" role="tablist"><button role="tab" data-act="rec" data-v="sim" class="' + (S.rec === 'sim' ? 'on' : '') + '" aria-selected="' + (S.rec === 'sim') + '">과거 시뮬레이션</button><button role="tab" data-act="rec" data-v="live" class="' + (S.rec === 'live' ? 'on' : '') + '" aria-selected="' + (S.rec === 'live') + '">실전 기록</button><button role="tab" data-act="rec" data-v="mine" class="' + (S.rec === 'mine' ? 'on' : '') + '" aria-selected="' + (S.rec === 'mine') + '">내 매매일지</button></div>') +
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
      body = '<p class="info">아직 조건을 고르지 않았어요. 지금은 점검 보통 이상 · 신호 6점 이상 매수 알림을 받아요. <b>추천</b>을 눌러 보세요.</p>';
    } else if (cur !== '직접') {
      var ps = findPreset(cur) || { desc: '', rules: p.rules || {} };
      body = '<p class="small" style="margin:0;line-height:1.6;color:var(--sub)">' + esc(ps.desc || '') + '</p>' +
        '<div class="rules">' + ['kr', 'us', 'crypto'].map(function (mk) {
          var r = (p.rules || ps.rules || {})[mk];
          return r ? '<div class="line"><span>' + MARKET[mk] + '</span><span class="small" style="text-align:right">' + esc(ruleText(r, mk)) + '</span></div>' : '';
        }).join('') + '</div>' +
        '<p class="small" style="margin:0">하나씩 바꾸고 싶으면 <b>직접 설정</b>을 누르세요.</p>';
    } else {
      var c = customOf(p);
      body = '<p class="small" style="margin:0;line-height:1.5">시장마다 잘 맞는 조건이 달라서, 시장별로 따로 정해요.</p>' +
        '<div class="seg three" role="tablist" aria-label="시장">' + ['kr', 'us', 'crypto'].map(function (mk) {
          return '<button role="tab" aria-selected="' + (S.cm === mk) + '" class="' + (S.cm === mk ? 'on' : '') + '" data-act="cm" data-v="' + mk + '">' + MARKET[mk] + '</button>';
        }).join('') + '</div>' +
        '<h3 class="sub-h">안전 점검 지표 <small>켜면 그 조건을 통과한 알림만 받아요</small></h3><div class="list inner">' +
        GUARDS.filter(function (g) { return g[0] !== '실적' || S.cm === 'us'; }).map(function (g) { return sw('g-' + g[0], c.need.indexOf(g[0]) >= 0, g[1], g[2]); }).join('') + '</div>' +
        '<h3 class="sub-h">수익성 지표</h3><div class="list inner">' + sw('card', !!c.card, PROFIT[1], PROFIT[2]) + '</div>' +
        '<h3 class="sub-h">신호 점수 <small>지표 10가지 중 몇 개 이상 맞을 때 받을지</small></h3><div class="grades four" role="radiogroup" aria-label="신호 점수">' +
        SCORES.map(function (n) { return '<button role="radio" aria-checked="' + (c.score === n) + '" class="' + (c.score === n ? 'on' : '') + '" data-act="score" data-v="' + n + '">' + n + '점 이상</button>'; }).join('') + '</div>';
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
        '<p class="notice">어떤 매수 알림을 받을지 정해요. 홈 화면 목록과 푸시 알림 모두 이 조건대로 걸러져요.</p>') +
      '<main class="page">' + statSection(p) + condSection(p) +
      '<p class="foot-note">과거 성적은 국장·미장 약 3년, 코인 2년치 1시간봉으로 알림마다 100만원씩 샀다고 치고, 수수료 0.2%를 빼고 계산했어요. 수익성은 한 번 살 때 평균 수익률, 안정성은 알림이 있었던 달 중 수익 난 달의 비율이에요. 과거 성적은 미래 수익을 보장하지 않아요. 투자 참고용 정보이며 투자자문이 아니에요.</p></main>' + menu('ind');
  }
  function pageSettings() {
    var p = prefs(), on = pushOn(), mk = p.markets;
    var help = S.pushHelp ? '<p class="warn">아이폰은 Safari에서 아래쪽 <b>공유 버튼</b> → <b>홈 화면에 추가</b>를 누른 뒤, 홈 화면의 타점노트 아이콘으로 열어야 알림을 켤 수 있어요.</p>' : '';
    var denied = pushOK && Notification.permission === 'denied' ? '<p class="warn">이 휴대폰에서 알림이 차단돼 있어요. 휴대폰 설정 → 알림에서 타점노트(또는 브라우저)를 허용해 주세요.</p>' : '';
    var c = code();
    return top('<h1 style="margin:0;font-size:20px">알림 설정</h1>', '', demoBar()) + '<main class="page">' + help + denied +
      '<section class="list">' + sw('push', on, '푸시 알림 받기', S.busy ? '켜는 중…' : (on ? '켜져 있어요' : '타점이 생기면 바로 알려 드려요'), S.busy) +
      sw('mk-kr', mk.indexOf('kr') >= 0, '국장', '평일 09:15 ~ 15:20') + sw('mk-us', mk.indexOf('us') >= 0, '미장', '평일 밤 (한국 시간)') +
      sw('mk-crypto', mk.indexOf('crypto') >= 0, '코인', '24시간') + sw('sell', p.sell, '매도 알림', '최근 7일 안에 매수 알림이 나갔거나 보유 중인 종목만 · 3일 뒤 실제로 내린 건 절반 정도예요') +
      (p.sell ? sw('sellAll', p.sellAll, '모든 종목 매도 알림', '다른 종목도 갖고 있다면 켜세요 · 알림이 많아져요') : '') +
      sw('brief', p.brief, '아침 브리핑', '매일 아침 8시쯤 밤사이 시장 요약 (일요일 쉼)') + sw('quiet', p.quiet, '방해 금지', '밤 12시 ~ 아침 7시는 조용히') + '</section>' +
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
      sec('🔴 매수 알림 읽는 법', li(['<b>매수 기준가</b>: 이 가격 근처나 아래에서 사요. 지금 가격이 많이 위면 기다려요.', '<b>손절가</b>: 여기에 닿으면 팔아서 손실을 작게 끊어요. 가장 중요해요.', '<b>1차 매도</b>: 여기서 절반을 팔고, 남은 절반은 손절가를 산 가격으로 올려요.', '<b>나머지</b>: 오른 뒤 고점에서 정해진 만큼 빠지면 팔아요.', '<b>안전 점검</b>: 시장 흐름·추세·눌림·변동성·실적·과거 성적 6가지 중 몇 개를 통과했는지예요. 지표 설정의 <b>안정성 %</b>와는 다른 거예요.', '<b>신호 점수</b>: 지표 10가지 중 몇 개가 맞았는지예요.'])) +
      sec('🔵 매도 알림', '<p>이미 갖고 있는 종목이 약해질 때 와요. 기본으로는 <b>최근 7일 안에 매수 알림이 나간 종목</b>과 실전 기록·내 매매일지에 보유 중인 종목만 보여 줘요. 다른 종목도 갖고 있다면 설정에서 <b>모든 종목 매도 알림</b>을 켜세요. 과거 기록에서 3일 뒤 실제로 내린 건 절반 정도라 참고만 하세요.</p>') +
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
  $app.addEventListener('change', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-imp')) { jImport(e.target.files && e.target.files[0]); e.target.value = ''; }
  });
  $app.addEventListener('submit', function (e) {
    var form = e.target.getAttribute('data-form');
    if (form === 'jbuy' || form === 'jsell') {
      e.preventDefault();
      var price = parseFloat(e.target.price.value), id = e.target.getAttribute('data-id'), list = jr();
      if (!(price > 0)) { toast('가격을 확인해 주세요'); return; }
      if (form === 'jbuy') {
        var amount = parseFloat(e.target.amount.value);
        var a = ((S.feed && S.feed.alerts) || []).filter(function (x) { return String(x.id) === id; })[0];
        if (!a || !(amount > 0)) { toast('금액을 확인해 주세요'); return; }
        list.push({ id: 'j' + Date.now(), aid: a.id, name: a.name, market: a.market, buy: price, amount: amount, stop: a.stop, sell: a.sell, half: !!a.half, at: new Date().toISOString(), out: null });
        S.jbuy = null; toast('매매일지에 적었어요');
      } else {
        list.forEach(function (x) { if (x.id === id) x.out = { price: price, at: new Date().toISOString() }; });
        S.jsell = null; toast('판 기록을 적었어요');
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
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') loadFeed(); });
  setInterval(function () { if (document.visibilityState === 'visible' && !/settings|alert|ind|guide/.test(location.hash) && !S.jsell && !S.jbuy) loadFeed(); }, 60000);
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
