// 타점노트 무료 베타 앱 (설치형 웹앱)
// config.js(배포할 때 자동 생성)에 데이터베이스 주소가 있으면 실제 데이터, 없으면 예시 데이터로 보여 줘요.
(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var LIVE = !!(CFG.supabaseUrl && CFG.supabaseKey);
  var $app = document.getElementById('app');
  // 유사투자자문업 신고가 수리되면 신고번호를 넣어요. 비어 있으면 무료 베타 문구가 나와요.
  var LEGAL = { advisorNo: '' };
  function whoAmI() { return LEGAL.advisorNo ? '타점노트는 유사투자자문업자(신고번호 ' + LEGAL.advisorNo + ')이며 정식 금융투자업자가 아니에요' : '서비스 제공자는 금융투자업자가 아니에요'; }
  function topNotice() {
    return LEGAL.advisorNo ? '유사투자자문업자(신고번호 ' + LEGAL.advisorNo + ')로 정식 금융투자업자가 아니에요. 개별 상담과 자금 운용은 하지 않으며, 원금 손실이 생길 수 있어요.'
      : '투자 참고용 정보이며 투자자문이 아니에요. 원금 손실이 생길 수 있고, 투자 판단과 책임은 본인에게 있어요.';
  }
  var K = { consent: 'tn_consent_v1', code: 'tn_code', prefs: 'tn_prefs', push: 'tn_push', feed: 'tn_feed', jr: 'tn_journal', briefHide: 'tn_brief_hide', hold: 'tn_hold', hind: 'tn_hold_ind', broker: 'tn_broker', htrack: 'tn_hold_track', nseen: 'tn_notice_seen', devkey: 'tn_dev_key', moversHide: 'tn_movers_hide', recapHide: 'tn_recap_hide', pa: 'tn_price_alerts', theme: 'tn_theme', wallSeen: 'tn_wall_seen', lping: 'tn_login_ping', onb: 'tn_onboarded', nvre: 'tn_naver_reask' };
  var MARKET = { kr: '국장', us: '미장', crypto: '코인' };
  var MISS = { '시장약세': '시장 흐름 약함', '추세약세': '종목 추세 약함', '이미오름': '이미 많이 오름', '변동큼': '변동성 큼',
    '실적임박': '실적 발표 임박', '기록부족': '과거 기록 부족', '과거손실': '과거 성적 손실', '🟢연속손실': '최근 연속 손실' };
  var GRADE_RANK = { '낮음': 0, '보통': 1, '높음': 2 };
  var DEFAULT_PREFS = { markets: ['kr', 'us', 'crypto'], minGrade: '보통', sell: true, sellAll: false, quiet: false, brief: true, recap: true, wallst: true, hilo: true, preset: '', rules: null };
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
    ['과거 성적은 미래 수익을 보장하지 않아요', '점수·확률·시뮬레이션은 지난 데이터로 계산한 결과예요. ' + whoAmI() + '.']
  ];
  var S = { feed: null, loading: false, error: '', tab: 'all', rec: 'sim', agree: [false, false, false, false],
    codeErr: '', busy: false, pushHelp: false, open: null, agreedNow: false, cm: 'kr' };   // agreedNow: 이번에 앱을 연 뒤 동의했는지 (로그인 안 한 사람은 앱을 열 때마다 안내·동의 화면)
  var OPEN_CODE = 'OPEN';   // 서버에 이 코드가 켜져 있으면 초대 코드 없이 바로 들어가요

  // ---------- 작은 도구 ----------
  var onSet = null;                        // 로그인했을 때 기록이 바뀌면 계정에 저장 (아래 '로그인' 부분)
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} if (onSet) onSet(k); },
    del: function (k) { try { localStorage.removeItem(k); } catch (_) {} }
  };
  // ---------- 화면 테마 (자동 · 밝게 · 어둡게) ----------
  var darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    var t = store.get(K.theme, 'auto'), root = document.documentElement;
    if (t === 'dark' || t === 'light') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    var dark = t === 'dark' || (t !== 'light' && darkMQ && darkMQ.matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#181B21' : '#FFFFFF');
  }
  applyTheme();
  if (darkMQ) { if (darkMQ.addEventListener) darkMQ.addEventListener('change', applyTheme); else if (darkMQ.addListener) darkMQ.addListener(applyTheme); }
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
  function kstDay(iso) { return new Date(new Date(iso).getTime() + 9 * 36e5).toISOString().slice(0, 10); }
  function code() { return store.get(K.code, ''); }
  function prefs() { var p = store.get(K.prefs, {}), o = {}; for (var k in DEFAULT_PREFS) o[k] = k in p ? p[k] : DEFAULT_PREFS[k]; return o; }
  function toast(msg, opt) {               // 아래에서 떠오르는 알림 (최대 3개 겹침, '되돌리기' 같은 버튼 가능)
    opt = opt || {};
    var wrap = document.getElementById('toasts');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toasts'; wrap.className = 'toasts'; wrap.setAttribute('aria-live', 'polite'); document.body.appendChild(wrap); }
    var kind = opt.kind || (/못했|실패|오류|확인해 주세요|없어요/.test(msg) ? 'err' : '');
    var t = document.createElement('div'), sp = document.createElement('span');
    t.className = 'toast' + (kind ? ' ' + kind : ''); t.setAttribute('role', 'status'); sp.textContent = msg; t.appendChild(sp);
    var timer, close = function () { clearTimeout(timer); t.classList.remove('in'); setTimeout(function () { t.remove(); }, 220); };
    if (opt.action) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = opt.action;
      b.addEventListener('click', function () { close(); try { opt.onAction(); } catch (_) {} });
      t.appendChild(b);
    }
    wrap.appendChild(t);
    while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
    requestAnimationFrame(function () { t.classList.add('in'); });
    timer = setTimeout(close, opt.ms || (opt.action ? 5000 : 2600));
  }
  var ICON = {
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 14.5h2"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    chk: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
    empty: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="13" width="34" height="26" rx="5"/><path d="M7 21h34M17 13V9h14v4M20 30h8"/></svg>',
    search: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="21" cy="21" r="12"/><path d="M30 30l9 9M17 21h8"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="#0B6E3F" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="통과"><path d="M5 12l5 5 9-10"/></svg>',
    no: '<svg viewBox="0 0 24 24" fill="none" stroke="#A63F0A" stroke-width="2.6" stroke-linecap="round" role="img" aria-label="부족"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    logo: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="타점노트 로고"><path d="M3 17l5-5 4 4 8-9"/><circle cx="20" cy="7" r="1.6" fill="#FF6B6B" stroke="none"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5L12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/></svg>',
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
  // ---------- 앱 설치 (마켓 없이 홈 화면에 설치) ----------
  var UA = navigator.userAgent || '', isAndroid = /Android/i.test(UA);
  var inApp = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|everytimeApp|BAND\//i.test(UA);   // 카톡 같은 앱 안의 브라우저
  try { if (/^android-app:\/\//.test(document.referrer)) localStorage.setItem('tn_twa', '1'); } catch (_) {}
  var INSTALLED = standalone || (!inApp && /; wv\)/.test(UA)) || (function () { try { return localStorage.getItem('tn_twa') === '1'; } catch (_) { return false; } })();
  var BIP = null;                          // 크롬이 주는 '설치' 창
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); BIP = e; var p = route().p; if (p === 'install' || p === 'settings') render(); });
  window.addEventListener('appinstalled', function () { BIP = null; INSTALLED = true; toast('홈 화면에 타점노트를 설치했어요', { kind: 'ok' }); if (route().p === 'install') location.replace('#/'); else render(); });
  function shareUrl() { return appUrl() + '?i=1'; }   // 받은 사람은 열자마자 설치 안내 화면
  function openOutside() {                 // 카톡 같은 앱 안 브라우저 → 크롬 · 사파리로 열기
    var u = shareUrl();
    if (/KAKAOTALK/i.test(UA)) { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(u); return true; }
    if (isAndroid) { location.href = 'intent://' + u.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end'; return true; }
    return false;
  }
  (function () {                           // ?i=1 로 들어오면 설치 안내로 (카톡 안이면 한 번 바깥 브라우저로)
    var q = new URLSearchParams(location.search);
    if (q.get('i') !== '1') return;
    history.replaceState(null, '', location.pathname + '#/install');
    var once = false; try { once = sessionStorage.getItem('tn_out') === '1'; sessionStorage.setItem('tn_out', '1'); } catch (_) {}
    if (inApp && !once && /KAKAOTALK/i.test(UA)) setTimeout(openOutside, 300);
  })();
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
    if (Notification.permission === 'default' && !S.pushAsked) {    // 휴대폰 허용 창을 띄우기 전에 무엇을 받는지 먼저 알려 줌
      sheet({ title: '알림을 켤까요?', body: '고른 시장에 타점이 생기면 바로 알려 드려요. 설정에서 받을 알림 종류와 방해 금지 시간을 언제든 바꿀 수 있어요. 다음 화면에서 휴대폰이 알림 허용을 물어요.', ok: '알림 켜기', no: '나중에' })
        .then(function (ok) { if (ok) { S.pushAsked = true; enablePush(); } });
      return;
    }
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
  function linked(a) { return !!(a.flags && a.flags.linked) || !!heldBy(a); }   // 최근 매수 알림·실전 보유·내 보유 종목
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
  // 미장 시간대별 거래: 데이마켓(한국 낮, 대체거래소) · 프리마켓 · 정규장 · 애프터마켓 (미국 동부시간 기준으로 계산 → 서머타임 자동 반영)
  function usTradeDay(y, m, d) { var w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return w > 0 && w < 6 && !HOLI.us[ymd(y, m, d)]; }
  function usSession(now) {
    var tz = SESS.us.tz, p = tzParts(now, tz), key = ymd(p.y, p.m, p.d), today = usTradeDay(p.y, p.m, p.d);
    var close = (EARLY.us || {})[key] || SESS.us.close, afterEnd = close < SESS.us.close ? 1020 : 1200;
    var nd = new Date(Date.UTC(p.y, p.m - 1, p.d + 1)), next = usTradeDay(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate());
    var T = function (min, plusDay) { var dd = new Date(Date.UTC(p.y, p.m - 1, p.d + (plusDay ? 1 : 0))); return hm(at(tz, dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate(), min).toISOString()); };
    if (today && p.min >= 240 && p.min < SESS.us.open) return { k: 'pre', name: '프리마켓', text: T(SESS.us.open) + ' 정규장' };
    if (today && p.min >= SESS.us.open && p.min < close) return { k: 'reg', name: '정규장', text: T(close) + (close !== SESS.us.close ? ' 조기 마감' : ' 마감') };
    if (today && p.min >= close && p.min < afterEnd) return { k: 'after', name: '애프터마켓', text: T(afterEnd) + '까지' };
    if (today && p.min < 240) return { k: 'day', name: '데이마켓', text: T(240) + ' 프리마켓' };
    if (next && p.min >= 1200) return { k: 'day', name: '데이마켓', text: T(240, true) + ' 프리마켓' };
    return null;
  }
  function hoursLine(p) {
    var now = new Date();
    return '<p class="hours" aria-label="장 시간 (한국 시간)">' + ['kr', 'us', 'crypto'].filter(function (mk) { return p.markets.indexOf(mk) >= 0; }).map(function (mk) {
      var u = mk === 'us' ? usSession(now) : null;
      if (u) return '<span><i class="' + (u.k === 'reg' ? 'on' : 'ext') + '"></i>' + MARKET[mk] + ' ' + u.name + ' · ' + u.text + '</span>';
      var h = marketHours(mk, now);
      return '<span><i class="' + (h.open ? 'on' : '') + '"></i>' + MARKET[mk] + ' ' + (h.open ? '장중 · ' : '') + h.text + '</span>';
    }).join('') + '</p>';
  }

  // ---------- 아침 브리핑 ----------
  function hiloBlock(HL) {                // 오늘 1년 신고가 · 신저가 (주요 종목 + 감시 종목)
    if (!HL || !HL.markets) return '';
    var mk = (prefs().markets || ['kr', 'us', 'crypto']).filter(function (m) { return ((HL.markets[m] || {}).items || []).length; });
    if (!mk.length) return '';
    return '<div class="hilo"><h3 class="sub-h">1년 신고가 · 신저가 ' + tipBtn('hilo') + '</h3>' + mk.map(function (m) {
      var G = HL.markets[m], xs = G.items || [];
      var chip = function (x) { return '<button class="hl ' + (x.side === 'hi' ? 'up' : 'dn') + '" data-act="mvpick" data-v="' + esc(x.yt) + '" data-m="' + m + '" data-n="' + esc(x.name) + '" data-c="' + esc(x.code) + '">' +
        '<i>' + (x.side === 'hi' ? '신고가' : '신저가') + '</i><b>' + esc(x.name) + '</b><span class="' + tone(x.chg) + '">' + pct(x.chg) + '</span></button>'; };
      return '<div class="hlm"><span class="mvh">' + MARKET[m] + (G.day ? ' <small>' + mmdd(G.day) + (m === 'us' ? ' 미국 날짜' : '') + '</small>' : '') + '</span><div class="hls">' + xs.map(chip).join('') + '</div></div>';
    }).join('') + '</div>';
  }
  function moversCard(M, HL) {
    if (!M || !M.markets || store.get(K.moversHide, '') === (M.at || '').slice(0, 10)) return '';
    var mk = (prefs().markets || ['kr', 'us', 'crypto']).filter(function (m) { return (M.markets[m] || []).length; });
    var hb = hiloBlock(HL);
    if (!mk.length && !hb) return '';
    var rows = mk.map(function (m) {
      var xs = M.markets[m] || [], day = xs[0] && xs[0].day;
      return '<div class="mvm"><span class="mvh">' + MARKET[m] + (day ? ' <small>' + mmdd(day) + (m === 'us' ? ' 미국 날짜' : '') + '</small>' : '') + '</span><div class="mvs">' + xs.map(function (x) {
        return '<button class="mv" data-act="mvpick" data-v="' + esc(x.yt) + '" data-m="' + m + '" data-n="' + esc(x.name) + '" data-c="' + esc(x.code) + '"><b>' + esc(x.name) + '</b><span class="' + tone(x.chg) + '">' + pct(x.chg) + '</span>' +
          '<em>' + x.tags.map(esc).join(' · ') + '</em></button>';
      }).join('') + '</div></div>';
    }).join('');
    return '<section class="card movers"><div class="line"><h2 style="font-size:15px">오늘 눈에 띄는 종목</h2><button class="x" data-act="mvhide" aria-label="오늘 닫기">' + ICON.x + '</button></div>' +
      '<p class="small" style="margin:0 0 6px">주요 종목과 감시 종목 중 급등·급락, 거래량 급증, 1년 신고가·신저가예요. 누르면 관심에 넣을 수 있어요.</p>' + rows + hb + '</section>';
  }
  function recapCard(r) {
    if (!r || !r.day || !r.idx) return '';
    var age = (Date.now() - new Date(r.at).getTime()) / 36e5;
    if (!(age < 8) || store.get(K.recapHide, '') === r.kind + r.day || prefs().markets.indexOf('kr') < 0) return '';
    var idx = r.idx.map(function (x) {
      var fx = x.name === '원/달러';
      return '<div><span>' + esc(fx ? '환율' : x.name) + '</span><b class="' + (fx ? '' : tone(x.chg)) + '">' + (fx ? Math.round(x.last).toLocaleString('ko-KR') + '원' : pct(x.chg)) + '</b></div>';
    }).join('');
    var rows = [];
    if (r.alerts) rows.push('<div class="line"><span>오늘 국장 타점</span><b>매수 ' + (r.alerts.buy || 0) + ' · 매도 ' + (r.alerts.sell || 0) + '</b></div>');
    if (r.fut && r.fut.length) rows.push('<div class="line"><span>오늘 밤 미국 선물</span><b>' + r.fut.map(function (x) { return esc(x.name.replace(' 선물', '')) + ' <span class="' + tone(x.chg) + '">' + pct(x.chg) + '</span>'; }).join(' · ') + '</b></div>');
    var mv = (r.movers || []).map(function (x) {
      return '<button class="mv" data-act="mvpick" data-v="' + esc(x.yt) + '" data-m="kr" data-n="' + esc(x.name) + '" data-c="' + esc(x.code || '') + '"><b>' + esc(x.name) + '</b><span class="' + tone(x.chg) + '">' + pct(x.chg) + '</span>' +
        '<em>' + (x.tags || []).map(esc).join(' · ') + '</em></button>';
    }).join('');
    var title = r.kind === 'close' ? '🔔 국장 마감 요약' : '🕧 점심 시장 요약';
    return '<section class="card brief recap"><div class="line"><h2 style="font-size:15px">' + title + '</h2><span class="small">' + hm(r.at) +
      ' <button class="x" data-act="recaphide" aria-label="요약 닫기">' + ICON.x + '</button></span></div>' +
      '<div class="idx">' + idx + '</div>' + rows.join('') + (mv ? '<div class="mvs" style="margin-top:6px">' + mv + '</div>' : '') + '</section>';
  }
  function briefCard(b) {
    if (!b || !b.day) return '';
    var age = (Date.now() - new Date(b.at).getTime()) / 36e5;
    if (!(age < 20) || store.get(K.briefHide, '') === b.day) return '';
    var d = new Date(b.at), wd = '일월화수목금토'.charAt(new Date(b.day + 'T12:00:00+09:00').getDay());
    var idx = (b.idx || []).map(function (x) {
      var val = x.name === '원/달러' ? Math.round(x.last).toLocaleString('ko-KR') + '원' : (x.chg > 0 ? '+' : '') + Number(x.chg).toFixed(1) + '%';
      return '<div><span>' + esc(x.name) + (x.h24 ? ' <small>24시간</small>' : '') + '</span><b class="' + (x.name === '원/달러' ? '' : tone(x.chg)) + '">' + val + '</b></div>';
    }).join('');
    var flow = Object.keys(b.flow || {}).map(function (m) { return MARKET[m] + ' ' + (b.flow[m] ? '<b class="fl-ok">상승세</b>' : '<b class="fl-weak">약세</b>'); }).join(' · ');
    var a = b.alerts || {}, c = b.closed || {};
    var rows = [];
    if (flow) rows.push('<div class="line"><span>시장 흐름</span><span>' + flow + '</span></div>');
    rows.push('<div class="line"><span>새 타점 (24시간)</span><b>매수 ' + (a.buy || 0) + ' · 매도 ' + (a.sell || 0) + '</b></div>');
    if (b.earn && b.earn.length) rows.push('<div class="line"><span>실적 예정</span><b style="text-align:right">' + b.earn.slice(0, 4).map(function (e) { return esc(e.name) + ' ' + e.day.slice(5).replace('-', '/'); }).join(', ') + '</b></div>');
    return '<section class="card brief"><div class="line"><h2 style="font-size:15px">☀️ 아침 브리핑</h2><span class="small">' + kst(d, { month: 'numeric', day: 'numeric' }).replace(/\.\s*/g, '/').replace(/\/$/, '') + '(' + wd + ') ' + hm(b.at) +
      ' <button class="x" data-act="briefhide" aria-label="오늘 브리핑 닫기">' + ICON.x + '</button></span></div>' +
      (idx ? '<div class="idx">' + idx + '</div>' : '') + rows.join('') + '</section>';
  }


  // ---------- 카드 공유 (이미지 + 글, 안 되면 글만 / 이미지 저장) ----------
  var SHARE_FONT = "'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function fitText(c, t, max, size, weight) {
    var sz = size;
    do { c.font = weight + ' ' + sz + 'px ' + SHARE_FONT; sz -= 2; } while (c.measureText(t).width > max && sz > 24);
    return t;
  }
  function wrapLines(c, t, max) {
    var out = [], line = '';
    String(t).split('').forEach(function (ch) {
      if (c.measureText(line + ch).width > max && line) { out.push(line); line = ch.trim() ? ch : ''; } else line += ch;
    });
    if (line) out.push(line);
    return out;
  }
  var TONE_HEX = { red: '#D93B3B', blue: '#2B6CDF', '': '#191F28' };
  function drawShare(sp) {               // sp: {tag, title, big, bigTone, sub, rows:[[이름, 값, 색]], bars:[[이름, 0~100]], when}
    var W = 1080, H = 1350, P = 72, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = '#F4F5F7'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#FFFFFF'; rr(c, 40, 40, W - 80, H - 80, 44); c.fill();
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#191F28'; c.font = '700 40px ' + SHARE_FONT; c.fillText('타점노트', P + 10, 128);
    c.font = '600 26px ' + SHARE_FONT; c.fillStyle = '#6B7684'; var tw = c.measureText('투자 참고용').width;
    c.fillStyle = '#F2F4F6'; rr(c, W - P - 10 - tw - 28, 94, tw + 28, 44, 10); c.fill(); c.fillStyle = '#4E5968'; c.fillText('투자 참고용', W - P - 10 - tw - 14, 126);
    var y = 210;
    if (sp.badge) {
      c.font = '700 30px ' + SHARE_FONT; var bw = c.measureText(sp.badge[0]).width + 28;
      c.fillStyle = sp.badge[1] === 'blue' ? '#2B6CDF' : '#D93B3B'; rr(c, P + 10, y - 34, bw, 46, 10); c.fill();
      c.fillStyle = '#FFFFFF'; c.fillText(sp.badge[0], P + 24, y); c.font = '500 30px ' + SHARE_FONT; c.fillStyle = '#6B7684'; c.fillText(sp.tag || '', P + 30 + bw, y);
    } else { c.font = '500 30px ' + SHARE_FONT; c.fillStyle = '#6B7684'; c.fillText(sp.tag || '', P + 10, y); }
    y += 96; c.fillStyle = '#191F28'; fitText(c, sp.title, W - 2 * P - 20, 76, 700); c.fillText(sp.title, P + 10, y);
    if (sp.big) {
      y += 92; c.font = '700 64px ' + SHARE_FONT; c.fillStyle = '#191F28'; c.fillText(sp.big, P + 10, y);
      if (sp.sub) { var bw2 = c.measureText(sp.big).width; c.font = '700 40px ' + SHARE_FONT; c.fillStyle = TONE_HEX[sp.subTone || ''] || '#191F28'; c.fillText(sp.sub, P + 34 + bw2, y); }
    }
    y += 50;
    (sp.rows || []).forEach(function (r) {
      y += 74; c.strokeStyle = '#E5E8EB'; c.lineWidth = 2; c.beginPath(); c.moveTo(P + 10, y - 52); c.lineTo(W - P - 10, y - 52); c.stroke();
      c.font = '500 34px ' + SHARE_FONT; c.fillStyle = '#4E5968'; c.fillText(r[0], P + 10, y);
      c.font = '700 36px ' + SHARE_FONT; c.fillStyle = TONE_HEX[r[2] || ''] || '#191F28'; var vw = c.measureText(r[1]).width; c.fillText(r[1], W - P - 10 - vw, y);
    });
    if (sp.bars && sp.bars.length) {
      y += 40;
      sp.bars.forEach(function (b) {
        y += 62; c.font = '500 32px ' + SHARE_FONT; c.fillStyle = '#4E5968'; c.fillText(b[0], P + 10, y);
        var bx = P + 230, bwid = W - 2 * P - 360; c.fillStyle = '#F2F4F6'; rr(c, bx, y - 22, bwid, 18, 9); c.fill();
        if (b[1] != null) { c.fillStyle = b[2] ? '#1BA75B' : '#D93B3B'; rr(c, bx, y - 22, Math.max(18, bwid * b[1] / 100), 18, 9); c.fill(); }
        c.font = '700 34px ' + SHARE_FONT; c.fillStyle = '#191F28'; var t = b[1] == null ? '-' : String(b[1]); c.fillText(t, W - P - 10 - c.measureText(t).width, y);
      });
    }
    c.font = '500 26px ' + SHARE_FONT; c.fillStyle = '#8B95A1';
    var foot = wrapLines(c, (LEGAL.advisorNo ? '유사투자자문업자(신고번호 ' + LEGAL.advisorNo + ') · 개별 상담·자금 운용 불가. ' : '') + '투자 참고용 정보이며 투자자문·매매 권유가 아니에요. 원금 손실이 생길 수 있고, 투자 판단과 책임은 본인에게 있어요.', W - 2 * P - 20);
    var fy = H - 96 - (foot.length - 1) * 38;
    c.fillStyle = '#6B7684'; c.font = '600 26px ' + SHARE_FONT; c.fillText(sp.when || '', P + 10, fy - 54);
    c.font = '500 26px ' + SHARE_FONT; c.fillStyle = '#8B95A1';
    foot.forEach(function (l, i) { c.fillText(l, P + 10, fy + i * 38); });
    return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, 'image/png'); });
  }
  function appUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function shareSpec(sp) {
    var text = sp.text + '\n\n투자 참고용 정보예요 (투자자문 아님) · 타점노트';
    var ready = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('700 40px "IBM Plex Sans KR"'), document.fonts.load('500 30px "IBM Plex Sans KR"')]).catch(function () {}) : Promise.resolve();
    return ready.then(function () { return drawShare(sp); }).then(function (blob) {
      var file = blob && typeof File === 'function' ? new File([blob], 'tajeomnote.png', { type: 'image/png' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: sp.title, text: text });
      if (navigator.share) return navigator.share({ title: sp.title, text: text, url: appUrl() });
      if (blob) {                       // 공유 기능이 없는 컴퓨터 브라우저: 이미지 저장 + 글 복사
        var u = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = u; a.download = 'tajeomnote.png'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      }
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
      toast('이미지를 저장하고 글을 복사했어요');
    }).catch(function (e) { if (!e || e.name !== 'AbortError') toast('공유하지 못했어요'); });
  }
  function nowKst() { var d = new Date(); return kst(d, { month: 'numeric', day: 'numeric' }).replace(/\.\s*/g, '/').replace(/\/$/, '') + ' ' + hm(d.toISOString()); }
  function shareAlert(a) {
    var m = a.market, buy = a.side === 'buy', rows = [];
    if (buy) {
      rows.push(['매수 기준가', money(m, a.buy), 'red'], ['손절가', money(m, a.stop), 'blue'], [a.half ? '1차 매도 (절반)' : '매도 목표', money(m, a.sell), '']);
    } else if (a.rebound) rows.push(['반등하면 팔 자리', money(m, a.rebound), '']);
    rows.push(['신호 강도', a.score * 10 + '%', ''], ['안전 점검', (a.grade || '-') + (a.total ? ' ' + ((a.total || 0) - (a.misses || []).length) + '/' + a.total : ''), '']);
    var when = '알림 ' + kst(new Date(a.created_at), { month: 'numeric', day: 'numeric' }).replace(/\.\s*/g, '/').replace(/\/$/, '') + ' ' + hm(a.created_at);
    return shareSpec({ badge: [buy ? '매수' : '매도', buy ? 'red' : 'blue'], tag: where(a), title: a.name, big: money(m, a.price), sub: '알림 때 가격', subTone: '', rows: rows, when: when,
      text: '[타점노트] ' + a.name + ' ' + (buy ? '매수' : '매도') + ' 타점\n' + rows.slice(0, buy ? 3 : 1).map(function (r) { return r[0] + ' ' + r[1]; }).join(' · ') + '\n' + when });
  }
  function shareHold(h, an) {
    var m = h.market, list = axList(an), L = (an.legend || []).filter(function (x) { return x.pct != null; }).sort(function (a, b) { return b.pct - a.pct; })[0];
    var rows = [['종합 점수 (참고용)', an.score == null ? '정보 부족' : an.score + '점', '']];
    if (L) rows.push(['가장 잘 맞는 원칙', legOf(L)[0] + ' ' + L.pct + '%', '']);
    var x = an.extra || {};
    if (x.r1y != null) rows.push(['1년 수익률', pct(x.r1y), tone(x.r1y)]);
    return shareSpec({ tag: MARKET[m] + ' · ' + h.code, title: h.name, big: money(m, an.price), sub: pct(an.chg), subTone: tone(an.chg), rows: rows,
      bars: list.map(function (q) { return [AXES[q[0]], q[1], q[0] === 'calm']; }), when: nowKst() + ' 기준',
      text: '[타점노트] ' + h.name + ' 한눈에 보기\n종합 점수 ' + (an.score == null ? '정보 부족' : an.score + '점') + ' · ' + list.map(function (q) { return AXES[q[0]] + ' ' + (q[1] == null ? '-' : q[1]); }).join(' · ') });
  }

  function amt(m, v) {
    if (v == null || isNaN(v)) return '-';
    var s = v > 0 ? '+' : v < 0 ? '-' : '', a = Math.abs(v);
    return m === 'us' ? s + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 2 }) : s + Math.round(a).toLocaleString('ko-KR') + '원';
  }
  // 이 타점 종목이 내 보유에 있는지 (수량이 있는 것만)
  function heldBy(a) { return a && a.yt ? holds().filter(function (h) { return h.yt === a.yt && +h.qty > 0; })[0] : null; }
  function holdBox(a) {                 // 타점 상세 화면 아래: 내 보유와 연결
    if (!a.yt) return '';
    var h = holds().filter(function (x) { return x.yt === a.yt; })[0];
    if (h) return '<section class="card' + (+h.qty > 0 ? ' held' : '') + '"><div class="line"><h2 style="font-size:15px">' + (+h.qty > 0 ? '내가 보유 중이에요' : '관심 종목이에요') + '</h2>' +
      (+h.qty > 0 ? '<span class="tag">' + (+h.qty).toLocaleString('ko-KR', { maximumFractionDigits: 6 }) + (a.market === 'crypto' ? '개' : '주') + '</span>' : '') + '</div>' +
      '<a class="btn ghost" href="#/hold">내 보유에서 보기</a></section>';
    var cd = a.market === 'kr' ? a.yt.split('.')[0] : a.market === 'crypto' ? a.yt.replace('-KRW', '') : a.yt;
    return '<section class="card"><h2 style="font-size:15px">내 보유</h2><p class="small" style="margin:0 0 8px">샀다면 수량과 단가를 넣어 두세요. 손익과 종목 분석을 볼 수 있어요.</p>' +
      '<button class="btn ghost" data-act="mvpick" data-v="' + esc(a.yt) + '" data-m="' + a.market + '" data-n="' + esc(a.name) + '" data-c="' + esc(cd) + '">내 보유에 넣기</button></section>';
  }


  // ---------- 내 보유 (수량·단가는 이 휴대폰에만, 서버에는 종목 코드만) ----------
  var HIND = [['trend', '단기 상승세'], ['mid', '중기 상승세'], ['align', '상승 정렬'], ['mom', '사는 힘 우세'],
    ['macd', '오름 가속'], ['vol', '거래 활발'], ['mkt', '시장 상승세'], ['calm', '덜 흔들림']];
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
    korbit: { name: '코빗', pkg: 'com.korbit.exchange', web: 'https://www.korbit.co.kr' },
    // 해외 거래소: 원화 아닌 USDT(코인베이스는 USD) 거래 화면으로 바로 열어요
    binance: { name: '바이낸스', pkg: 'com.binance.dev', abroad: true, url: function (h) { return 'https://www.binance.com/ko/trade/' + h.code + '_USDT?type=spot'; } },
    bybit: { name: '바이비트', pkg: 'com.bybit.app', abroad: true, url: function (h) { return 'https://www.bybit.com/ko-KR/trade/spot/' + h.code + '/USDT'; } },
    okx: { name: 'OKX', pkg: 'com.okinc.okex.gp', abroad: true, url: function (h) { return 'https://www.okx.com/ko/trade-spot/' + h.code.toLowerCase() + '-usdt'; } },
    bitget: { name: '비트겟', pkg: 'com.bitget.exchange', abroad: true, url: function (h) { return 'https://www.bitget.com/ko/spot/' + h.code + 'USDT'; } },
    coinbase: { name: '코인베이스', pkg: 'com.coinbase.android', abroad: true, url: function (h) { return 'https://www.coinbase.com/advanced-trade/spot/' + h.code + '-USD'; } }
  };
  var STOCK_APPS = ['toss', 'kiwoom', 'mirae', 'samsung', 'kis', 'nh', 'kb', 'shinhan', 'kakaopay', 'hana'];
  var COIN_APPS = ['upbit', 'bithumb', 'coinone', 'korbit'];
  var COIN_ABROAD = ['binance', 'bybit', 'okx', 'bitget', 'coinbase'];
  function holds() { var x = store.get(K.hold, []); return Array.isArray(x) ? x : []; }
  function holdSave(x) { store.set(K.hold, x); S.han = null; }
  function hind() { var x = store.get(K.hind, null); return Array.isArray(x) ? x : HIND_DEF.slice(); }
  function broker() { var b = store.get(K.broker, {}) || {}; return { stock: STOCK_APPS.indexOf(b.stock) >= 0 ? b.stock : 'toss', coin: COIN_APPS.concat(COIN_ABROAD).indexOf(b.coin) >= 0 ? b.coin : 'upbit' }; }
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
  // ---------- 가격 알림 (목표가 · 손절가, 이 휴대폰 알림 주소로만 보냄) ----------
  function myEndpoint() {
    if (!pushOK || !pushOn()) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) { return sub ? sub.endpoint : null; });
  }
  function paList() { var x = S.pa ? S.pa.list : store.get(K.pa, []); return Array.isArray(x) ? x : []; }
  function paSet(list) { S.pa = { list: list || [], at: Date.now() }; store.set(K.pa, S.pa.list); }
  function loadPA(force) {
    if (!LIVE || !pushOn() || (S.pa && (S.pa.loading || (!force && Date.now() - S.pa.at < 60000)))) return;
    S.pa = { list: paList(), at: Date.now(), loading: true };
    myEndpoint().then(function (ep) { return ep ? rpc('app_price_list', { p_code: code(), p_endpoint: ep }) : []; })
      .then(function (l) { paSet(l); render(); }).catch(function () { S.pa = { list: paList(), at: Date.now() }; });
  }
  function paErr(e) {
    var m = (e && e.message) || '';
    toast(/too many/.test(m) ? '가격 알림은 20개까지 걸 수 있어요' : /push off/.test(m) ? '알림을 다시 켠 뒤 걸어 주세요' : '가격 알림을 저장하지 못했어요. 잠시 뒤 다시 해 주세요');
  }
  function paMeter() {                    // 가격 알림 사용량 (휴대폰마다 20개까지)
    var n = paList().filter(function (a) { return !a.fired_at; }).length, max = 20;
    if (!n) return '';
    var r = n / max, cls = r >= 1 ? 'full' : r >= 0.8 ? 'near' : '';
    return '<div class="pameter ' + cls + '"><div class="line"><span class="small">가격 알림</span><b>' + n + ' / ' + max + '개</b></div><div class="pmbar"><i style="width:' + Math.round(r * 100) + '%"></i></div>' +
      (r >= 0.8 ? '<p class="small" style="margin:4px 0 0">' + (r >= 1 ? '더 걸려면 울린 알림이나 안 쓰는 알림을 지워 주세요.' : '곧 꽉 차요. 안 쓰는 알림은 지워 주세요.') + '</p>' : '') + '</div>';
  }
  function paRows(h, an) {
    var mine = paList().filter(function (a) { return a.yt === h.yt; }), m = h.market, price = an && an.ok ? an.price : null;
    var chips = mine.map(function (a) {
      var up = a.kind === 'up', gap = price ? (a.price / price - 1) * 100 : null;
      return '<span class="pa ' + (a.fired_at ? 'fired' : up ? 'up' : 'down') + '">' + (up ? '🎯 ' : '🛑 ') + money(m, a.price) + (up ? ' 이상' : ' 이하') +
        (a.fired_at ? ' <small>울림 ' + mmdd(kstDay(a.fired_at)) + ' ' + hm(a.fired_at) + '</small>' : gap != null ? ' <small>' + pct(gap) + '</small>' : '') +
        '<button data-act="padel" data-v="' + a.id + '" aria-label="가격 알림 지우기">' + ICON.x + '</button></span>';
    }).join('');
    if (S.paopen === h.id) return '<div class="parow">' + chips + '</div>' + paForm(h, an);
    var rec = h.avg > 0 && +h.qty > 0 && price && !mine.some(function (a) { return !a.fired_at; }) ? '<button class="pa rec" data-act="parec" data-v="' + esc(h.id) + '">⚡ 평단 기준 손절 -10% · 목표 +20% 한 번에 걸기</button>' : '';
    return '<div class="parow">' + chips + '<button class="pa add" data-act="paopen" data-v="' + esc(h.id) + '">+ 가격 알림</button>' + rec + '</div>';
  }
  function paForm(h, an) {
    if (!LIVE) return '<p class="small pabox">앱 연결이 끝나면 쓸 수 있어요.</p>';
    if (!pushOn()) return '<div class="pabox"><p class="small" style="margin:0 0 8px">가격 알림은 푸시로 보내요. 먼저 알림을 켜 주세요.</p><div class="two"><button class="btn ghost" data-act="paclose">닫기</button><button class="btn" data-act="push">알림 켜기</button></div></div>';
    var m = h.market, price = an && an.ok ? an.price : null, up = S.pakind !== 'down', unit = m === 'us' ? '달러' : '원';
    var steps = up ? [5, 10, 20] : [-5, -10, -20];
    var round = function (v) { return m === 'us' ? Math.round(v * 100) / 100 : v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v * 100) / 100; };
    var quick = price ? steps.map(function (st) { return '<button type="button" data-act="paquick" data-v="' + round(price * (1 + st / 100)) + '">' + (st > 0 ? '+' : '') + st + '%</button>'; }).join('') +
      (h.avg > 0 && !up ? '<button type="button" data-act="paquick" data-v="' + round(h.avg * 0.9) + '">평단 -10%</button>' : '') : '';
    var dflt = S.paval || (price ? round(price * (up ? 1.1 : 0.9)) : '');
    return '<form data-form="paset" class="jform pabox" data-id="' + esc(h.id) + '">' +
      '<div class="seg"><button type="button" class="' + (up ? 'on' : '') + '" data-act="pakind" data-v="up">🎯 목표가 <small>오르면</small></button><button type="button" class="' + (!up ? 'on' : '') + '" data-act="pakind" data-v="down">🛑 손절가 <small>내리면</small></button></div>' +
      '<label>' + (up ? '이 가격 이상이 되면 알려 주세요' : '이 가격 이하가 되면 알려 주세요') + ' (' + unit + ')<input name="price" type="text" inputmode="decimal" autocomplete="off" data-fmt="amt" required value="' + esc(fmtAmt(dflt)) + '"></label>' +
      (quick ? '<div class="picks paq"><span class="small">지금 ' + money(m, price) + ' 기준</span>' + quick + '</div>' : '') +
      '<p class="small" style="margin:0">5분마다 확인해서 한 번 울리고 끝나요. 국장 시세는 15~20분 늦어요. 이 휴대폰 알림 주소와 종목 코드·가격만 서버에 저장되고, 울린 뒤 7일이 지나거나 지우면 바로 없어져요.</p>' +
      '<div class="two"><button type="button" class="btn ghost" data-act="paclose">취소</button><button class="btn" type="submit"' + (S.busy ? ' disabled aria-busy="true"' : '') + '>' + (S.busy ? '<span class="spin" aria-hidden="true"></span>거는 중' : '알림 걸기') + '</button></div></form>';
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
  // 투자 원칙 점검표: 이름은 앱에서 정함 (예전 서버 데이터의 인물 이름은 쓰지 않음)
  var LEG = { trend: ['상승 추세', '강한 상승 추세에 올라탄 종목만'], breakout: ['신고가 돌파', '새 고점을 거래량과 함께 뚫을 때'],
    leader: ['실적 주도주', '실적이 빠르게 느는 주도주의 돌파'], quality: ['우량 기업', '돈 잘 벌고 빚 적은 회사를 적당한 값에'],
    value: ['안전마진', '회사 가치보다 싸게 사서 안전하게'], garp: ['성장 대비 적정가', '성장에 비해 아직 싼 회사'] };
  var LEG_OLD = { minervini: 'trend', livermore: 'breakout', oneil: 'leader', buffett: 'quality', graham: 'value', lynch: 'garp' };
  function legOf(x) { return LEG[LEG_OLD[x.id] || x.id] || [x.m || '', x.idea || '']; }
  function legItem(t) { return String(t || '').replace(/^[A-Z] · /, ''); }
  function legendTop(an) {
    var L = (an.legend || []).filter(function (x) { return x.pct != null; });
    if (!L.length) return '';
    L.sort(function (a, b) { return b.pct - a.pct; });
    var x = L[0];
    return '<div class="line ltop"><span>가장 잘 맞는 원칙</span><b>' + esc(legOf(x)[0]) + ' <span class="' + (x.pct >= 70 ? 'red' : '') + '">' + x.pct + '%</span></b></div>';
  }
  function legendBox(h, an) {
    var L = an.legend || [];
    if (!L.length) return '';
    return '<h3 class="sub-h">투자 원칙으로 보기 <small>널리 알려진 원칙을 몇 % 충족하는지</small></h3><div class="legends">' + L.map(function (x) {
      var key = h.id + ':' + x.id, open = S.lgopen === key;
      var right = x.pct != null ? '<b class="' + (x.pct >= 70 ? 'red' : x.pct < 40 ? 'blue' : '') + '">' + x.pct + '%</b>' : '<small>-</small>';
      var head = '<button class="lg" data-act="lgopen" data-v="' + esc(key) + '" aria-expanded="' + open + '"><span><b>' + esc(legOf(x)[0]) + '</b><em>' + esc(x.na || legOf(x)[1]) + '</em></span>' + right + '</button>' +
        (x.pct != null ? gbar(x.pct) : '');
      var body = open && x.items ? '<ul class="lgitems">' + x.items.map(function (it) {
        return '<li>' + (it.ok == null ? '<i class="na">?</i>' : it.ok ? ICON.ok : ICON.no) + '<span>' + esc(legItem(it.t)) + '</span><small>' + (it.ok == null ? '정보 없음' : esc(it.v || '')) + '</small></li>';
      }).join('') + '</ul><p class="small" style="margin:4px 0 0">' + x.n + '개 확인 중 ' + x.pass + '개 충족' + (x.items.length > x.n ? ' · 정보가 없는 ' + (x.items.length - x.n) + '개는 빼고 계산했어요' : '') + '</p>' : '';
      return '<div class="lgrow">' + head + body + '</div>';
    }).join('') + '</div><p class="small" style="margin:6px 0 0">널리 알려진 투자 원칙을 단순하게 옮긴 점검표예요. 특정 인물이나 단체와 관계가 없고, 이 종목을 추천하는 것이 아니에요.</p>';
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
  function dday(iso) {                         // 오늘(한국 날짜)부터 며칠 남았는지
    if (!iso) return null;
    var t = kst(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\D+/g, '-').replace(/-$/, '');
    var a = Date.UTC.apply(null, t.split('-').map(function (x, i) { return +x - (i === 1 ? 1 : 0); })), b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    return Math.round((b - a) / 86400000);
  }
  function evBadges(an) {
    var E = an.events || {}, out = [], d = dday(E.earn), x = dday(E.exdiv);
    if (d != null && d >= 0 && d <= 21) out.push('<i class="ev hot">실적 ' + (d === 0 ? '오늘' : 'D-' + d) + '</i>');
    else if (d != null && d < 0 && d >= -3) out.push('<i class="ev">실적 발표 ' + (-d) + '일 전</i>');
    if (x != null && x >= 0 && x <= 21) out.push('<i class="ev">배당락 ' + (x === 0 ? '오늘' : 'D-' + x) + '</i>');
    if (E.dy != null && E.dy >= 0.3) out.push('<i class="ev">배당 ' + E.dy.toFixed(1) + '%</i>');
    return out.length ? '<div class="evs">' + out.join('') + '</div>' : '';
  }
  function mmdd(iso) { return iso ? (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)) : '-'; }
  function extRow(h) {                    // 미장 프리·애프터마켓 가격 (서버가 10분마다 받아 둠) · 데이마켓은 자료 없음
    if (h.market !== 'us') return '';
    var E = S.han && S.han.data && S.han.data.ext, q = E && E.px && E.px[h.yt], u = usSession(new Date()), k = u ? u.k : 'day';
    if (!q || k === 'reg') return '';
    var age = (Date.now() - new Date(q[2]).getTime()) / 60000, live = (k === 'pre' || k === 'after') && E.s === k && age < 40;
    var lastAfter = k === 'day' && E.s === 'after' && age < 20 * 60;
    if (!live && !lastAfter) return '';
    var label = live ? (k === 'pre' ? '프리마켓' : '애프터마켓') : '애프터마켓 마지막';
    var pl = h.avg > 0 ? (q[0] / h.avg - 1) * 100 : null;
    return '<div class="line extrow"><span><i class="sdot ext"></i>' + label + ' <small class="small">' + hm(q[2]) + '</small></span><b>' + money('us', q[0]) + ' <span class="' + tone(q[1]) + '">' + pct(q[1]) + '</span>' +
      (pl != null && +h.qty > 0 ? ' <small class="small">손익 <span class="' + tone(pl) + '">' + pct(pl) + '</span></small>' : '') + '</b></div>';
  }
  function holdCard(h, an, prob, nws) {
    var m = h.market, ok = an && an.ok, price = ok ? an.price : null;
    var pl = ok && h.avg > 0 ? price / h.avg - 1 : null, val = ok && h.qty > 0 ? price * h.qty : null;
    var open = S.hopen === h.id, B = BROKERS[m === 'crypto' ? broker().coin : broker().stock];
    var name = '<div class="hname"><b class="name">' + esc(h.name) + '</b><span class="small">' + MARKET[m] + ' · ' + esc(h.code) + '</span></div>';
    if (!an) return '<section class="card hcard"><div class="hhead">' + name + '</div>' + (S.han && S.han.loading && !(S.han.data && S.han.data.an) ? '<div class="sk-lines" aria-hidden="true"><i class="sk w70"></i><i class="sk w40"></i></div>' : '<p class="small" style="margin:0">분석을 준비하고 있어요. 새 종목은 5분쯤 걸려요.</p>') + hButtons(h, B, open) + '</section>';
    if (!ok) return '<section class="card hcard"><div class="hhead">' + name + '</div><p class="small" style="margin:0">' + esc(an.err || '분석할 수 없어요') + '. 종목 코드를 확인해 주세요.</p>' + hButtons(h, B, open) + '</section>';
    var x = an.extra || {}, v = an.vals || {};
    var head = '<div class="hhead">' + name + '<div class="hprice"><b data-roll="hp:' + esc(h.yt) + '">' + money(m, price) + '</b><span class="' + tone(an.chg) + '">' + pct(an.chg) + '</span></div></div>' + evBadges(an);
    var mine = pl != null ? '<div class="line hpl"><span>내 손익' + (h.qty > 0 ? ' <small class="small">' + (+h.qty).toLocaleString('ko-KR', { maximumFractionDigits: 6 }) + (m === 'crypto' ? '개' : '주') + '</small>' : '') + '</span><b class="' + tone(pl * 100) + '">' +
      (val != null ? amt(m === 'us' ? 'us' : 'kr', (price - h.avg) * h.qty) + ' ' : '') + '(' + pct(pl * 100) + ')</b></div>' : '';
    var list = axList(an), say = sayOf(list), score = an.score;
    var glance = (an.axes ? '<div class="glance">' + radar(list, score) + '<div class="gtext"><span class="small">종합 점수 <small>' + list.length + '가지 평균 · 참고용</small></span>' +
      '<b class="' + (score == null ? '' : score >= 70 ? 'red' : score < 40 ? 'blue' : '') + '">' + (score == null ? '정보 부족' : score + '점 · ' + (score >= 70 ? '높은 편' : score >= 40 ? '중간' : '낮은 편')) + '</b>' +
      (say ? '<p>' + esc(say) + '</p>' : '') + legendTop(an) + '</div></div><p class="small gnote" style="margin:6px 2px 0">점수와 원칙 점검은 지난 데이터로 계산한 참고 지표예요. 사거나 팔라는 뜻이 아니에요.</p>' : '');
    var ni = nws && nws.items;
    var body = extRow(h) + sparkBig(an.spark) + mine + glance + probLine(probFor(prob, h, an)) + (ni && ni.length && !open ? newsList(ni, 1) : '');
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
        '<div class="line"><span>수익률 1개월 · 3개월 · 1년</span><b>' + [x.r1m, x.r3m, x.r1y].map(function (r) { return r == null ? '-' : '<span class="' + tone(r) + '">' + pct(r) + '</span>'; }).join(' · ') + '</b></div>' +
        (an.events ? (function (E) { var d = dday(E.earn), xd = dday(E.exdiv);
          return '<div class="line"><span>다음 실적 발표</span><b>' + (E.earn && d >= -3 ? mmdd(E.earn) + (d >= 0 ? ' (D-' + d + ')' : ' (발표됨)') : '정보 없음') + '</b></div>' +
            '<div class="line"><span>배당수익률 <small class="small">1년 배당 ÷ 현재가</small></span><b>' + (E.dy != null ? '연 ' + E.dy.toFixed(2) + '%' : '없음') + '</b></div>' +
            (E.exdiv && xd >= 0 ? '<div class="line"><span>다음 배당락일</span><b>' + mmdd(E.exdiv) + ' (D-' + xd + ')</b></div>' : ''); })(an.events) : '') + '</div>' +
        (ni && ni.length ? '<h3 class="sub-h">뉴스 <small>' + newsSrc(ni) + ' 결과 · 누르면 기사로 가요</small></h3>' + newsList(ni, 6) : '') +
        '<p class="small" style="margin:8px 0 0">' + hm(an.updated || an.asof) + ' 기준 · ' + (m === 'us' ? '위 가격과 점수는 미장 정규장 기준이에요. 프리·애프터마켓 가격은 맨 위에 따로 보여 드려요. 데이마켓(주간거래) 가격은 받을 수 있는 자료가 없어서 증권사 앱에서 확인해 주세요.' : '국장 시세는 15~20분 늦을 수 있어요.') + '</p>' +
        '<button class="btn ghost" style="margin-top:10px" data-act="hshare" data-v="' + esc(h.id) + '">이 카드 이미지로 공유하기</button>';
    }
    return '<section class="card hcard">' + head + body + paRows(h, an) + more + hButtons(h, B, open) + '</section>';
  }
  function hButtons(h, B, open) {
    if (S.hedit === h.id) return hForm(h);
    return '<div class="hbtns"><button class="btn" data-act="hopenapp" data-v="' + esc(h.id) + '">' + esc(B.name) + '에서 보기</button>' +
      '<button class="btn ghost" data-act="hmore" data-v="' + esc(h.id) + '">' + (open ? '분석 접기' : '종목 분석') + '</button>' +
      '<button class="btn ghost" data-act="hedit" data-v="' + esc(h.id) + '">수정</button></div>';
  }
  function hForm(h) {
    var unit = h.market === 'us' ? '달러' : '원';
    return '<form data-form="hsave" class="jform" data-id="' + esc(h.id || '') + '">' + (h.id ? '' : '<p class="small" style="margin:0">살펴보기만 하려면 수량과 단가를 비워 두고 저장하세요.</p>') +
      '<label>수량 (' + (h.market === 'crypto' ? '개' : '주') + ', 선택)<input name="qty" type="text" inputmode="decimal" autocomplete="off" data-fmt="amt" value="' + esc(fmtAmt(h.qty || '')) + '"></label>' +
      '<label>평균 단가 (' + unit + ', 선택)<input name="avg" type="text" inputmode="decimal" autocomplete="off" data-fmt="amt" value="' + esc(fmtAmt(h.avg || '')) + '"></label>' +
      '<div class="two"><button type="button" class="btn ghost" data-act="' + (h.id ? 'hdel' : 'hcancel') + '" data-v="' + esc(h.id || '') + '">' + (h.id ? '지우기' : '취소') + '</button>' +
      '<button class="btn" type="submit">저장</button></div>' + (h.id ? '<button type="button" class="btn ghost" data-act="hcancel">닫기</button>' : '') + '</form>';
  }
  function pageHold() {
    var list = holds(), D = S.han && S.han.data, an = (D && D.an) || {}, prob = D && D.prob, NW = (D && D.news) || {};
    if (list.length) setTimeout(function () { loadHold(false); loadPA(false); }, 0);
    var sel = hind();
    var chips = '<div class="picks">' + HIND.map(function (q) {
      var on = sel.indexOf(q[0]) >= 0;
      return '<button class="' + (on ? 'on' : '') + '" data-act="hind" data-v="' + q[0] + '" aria-pressed="' + on + '">' + q[1] + '</button>';
    }).join('') + '</div>';
    var held = list.filter(function (h) { return +h.qty > 0; }), watch = list.filter(function (h) { return !(+h.qty > 0); });
    var tot = { kr: [0, 0, 0, 0], us: [0, 0, 0, 0] };
    held.forEach(function (h) { var a = an[h.yt]; if (a && a.ok && h.avg > 0) { var k = h.market === 'us' ? 'us' : 'kr'; tot[k][0] += a.price * h.qty; tot[k][1] += (a.price - h.avg) * h.qty; tot[k][2] += h.avg * h.qty;
      if (a.chg != null) tot[k][3] += a.price * h.qty * (1 - 1 / (1 + a.chg / 100)); } });
    var sumRow = function (k, label) {
      var t = tot[k]; if (!t[0]) return '';
      var base = t[0] - t[3];
      return '<div class="sumrow"><span>' + label + '</span><strong data-roll="sum:' + k + '">' + amt(k, t[0]).replace('+', '') + '</strong><b class="' + tone(t[1]) + '" data-roll="sumpl:' + k + '">' + amt(k, t[1]) + ' (' + pct(t[2] ? t[1] / t[2] * 100 : 0) + ')</b></div>' +
        (t[3] ? '<div class="sumday"><span>오늘</span><b class="' + tone(t[3]) + '">' + amt(k, t[3]) + ' (' + pct(base ? t[3] / base * 100 : 0) + ')</b></div>' : '');
    };
    var sum = tot.kr[0] || tot.us[0] ? '<section class="card sumcard"><h2 style="font-size:15px">내 평가 금액</h2>' + sumRow('kr', '원화') + sumRow('us', '달러') + '</section>' : '';
    var card = function (h) { return holdCard(h, an[h.yt], prob, NW[h.yt]); };
    var body = !list.length ? emptyState(ICON.empty, '아직 넣은 종목이 없어요', '가진 종목은 수량과 평균 단가를, 궁금한 종목은 이름만 넣어 보세요. 점수·뉴스·가격 알림을 한곳에서 볼 수 있어요.', '<a class="btn" href="#/hold/add">+ 종목 추가</a>')
      : (S.han && S.han.err && !D ? '<p class="info">분석을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>' : '') + sum +
        (held.length ? '<h2 class="grp">보유 <span>' + held.length + '</span></h2>' + held.map(card).join('') : '') +
        (watch.length ? '<h2 class="grp">관심 <span>' + watch.length + '</span><small>수량 없이 넣은 종목</small></h2>' + watch.map(card).join('') : '') +
        '<section class="card"><details' + (S.hindOpen ? ' open' : '') + '><summary class="dsum">확률 계산에 쓸 지표 <small>' + sel.length + '개 선택</small></summary>' +
        '<p class="small" style="margin:8px 0 0">고른 지표가 지금과 같았던 날을 과거에서 찾아, 며칠 뒤 실제로 오른 비율을 보여 줘요. 많이 고를수록 비슷한 날이 줄어요.</p>' + chips + '</details></section>';
    return top('<span style="font-size:18px;font-weight:700">내 보유</span>', '<a class="btn small-btn" href="#/hold/add">+ 종목 추가</a>') + demoBar() +
      '<main class="page">' + body +
      paMeter() + '<p class="foot-note">국장 시세는 15~20분 늦을 수 있어요. 오른 비율은 같은 시장 종목들의 최근 5년 일봉에서 지표 상태가 지금과 같았던 날 이후의 실제 결과이고, 앞으로를 보장하지 않아요. ' + (session() ? '로그인해서 수량과 단가도 계정에 저장 중이에요.' : '수량과 단가는 이 휴대폰에만 저장되고, 서버에는 종목 코드만 보내요.') + '</p></main>' + menu('hold');
  }
  function pageHoldAdd() {
    var s = S.hsel;
    var form = s ? '<section class="card"><div class="line"><b class="name">' + esc(s.name) + '</b><span class="small">' + MARKET[s.market] + ' · ' + esc(s.code) + '</span></div>' + hForm({ market: s.market }) + '</section>'
      : '<section class="card"><label class="search"><span class="sr">종목 검색</span><input data-hq type="search" placeholder="종목 이름 · 코드 · 초성" value="' + esc(S.hq || '') + '" autocomplete="off"></label>' +
        '<div id="hres">' + hResults() + '</div></section>' +
        '<details class="card"><summary>목록에 없나요? 직접 넣기</summary><form data-form="hmanual" class="jform">' +
        '<label>시장<select name="market"><option value="KS">국장 코스피</option><option value="KQ">국장 코스닥</option><option value="us">미장</option><option value="crypto">코인</option></select></label>' +
        '<label>종목 코드 (예: 005930, AAPL, BTC)<input name="code" required maxlength="12" autocomplete="off"></label>' +
        '<label>이름<input name="name" required maxlength="40"></label><button class="btn" type="submit">다음</button></form></details>';
    return top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/hold" aria-label="뒤로" data-act="hback">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">종목 추가</span></span>') +
      '<main class="page">' + form + '</main>' + menu('hold');
  }
  function hResults() {
    if (!S.hq) return '<p class="small" style="margin:8px 0 0">두 글자 이상 입력하면 찾아 드려요. 초성만 넣어도 돼요 (ㅋㅋㅇ → 카카오).</p>';
    if (S.hres == null) return '<p class="small" style="margin:8px 0 0">찾는 중…</p>';
    if (!S.hres.length) return '<div class="estate sm">' + '<div class="eicon" aria-hidden="true">' + ICON.search + '</div><b>\'' + esc(S.hq) + '\' 종목을 못 찾았어요</b><p>이름 일부나 초성(ㅅㅅㅈㅈ), 종목 코드로도 찾아 보세요. 그래도 없으면 아래 <b>직접 넣기</b>를 써 보세요.</p></div>';
    return '<div class="hres">' + S.hres.map(function (r, i) {
      return '<button data-act="hpick" data-v="' + i + '"><b>' + hlq(r.name, S.hq) + '</b><small>' + MARKET[r.market] + ' · ' + esc(r.code) + (r.alias ? ' · ' + hlq(r.alias, S.hq) : '') + '</small></button>';
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
  function newsSrc(items) { return items && items[0] && items[0].p === 'naver' ? '네이버 뉴스 검색' : '구글 뉴스'; }
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
      F.map(function (x) { return '<span class="fi">' + esc(FUT_SHORT[x.key] || x.name) + ' <i class="' + tone(x.pct) + '" data-roll="fut:' + esc(x.key) + '">' + pct(x.pct) + '</i></span>'; }).join('') +
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

  // ---------- 의견 보내기 (#/feedback) ----------
  // 보낸 의견마다 이 휴대폰이 만든 무작위 번호를 같이 보내고(서버엔 지문만), 그 번호로 내 의견의 답글만 받아 와요.
  K.fbmine = 'tn_fb_mine'; K.fbseen = 'tn_fb_seen';
  function fbMine() { var x = store.get(K.fbmine, []); return Array.isArray(x) ? x : []; }
  function fbLastReply() { var t = ''; ((S.fbm && S.fbm.list) || []).forEach(function (f) { (f.replies || []).forEach(function (r) { if (r.at > t) t = r.at; }); }); return t; }
  function fbUnread() {
    var seen = store.get(K.fbseen, ''), n = 0;
    ((S.fbm && S.fbm.list) || []).forEach(function (f) { (f.replies || []).forEach(function (r) { if (r.at > seen) n++; }); });
    return n;
  }
  function loadFbMine(force, markSeen) {
    var mine = fbMine();
    if (!LIVE || !mine.length || (S.fbm && (S.fbm.loading || (!force && Date.now() - S.fbm.at < 60000)))) { if (markSeen && S.fbm && S.fbm.list) fbMarkSeen(); return; }
    S.fbm = { loading: true, at: Date.now(), list: S.fbm && S.fbm.list };
    rpc('app_feedback_mine', { p_code: code(), p_items: mine.map(function (x) { return { id: x.id, tok: x.tok }; }) })
      .then(function (l) { S.fbm = { at: Date.now(), list: Array.isArray(l) ? l : [] }; if (markSeen) fbMarkSeen(); render(); })
      .catch(function () { S.fbm = { at: Date.now(), list: (S.fbm && S.fbm.list) || [] }; });
  }
  function fbMarkSeen() { var t = fbLastReply(); if (t && t > store.get(K.fbseen, '')) { S.fbNewUntil = store.get(K.fbseen, ''); store.set(K.fbseen, t); setTimeout(render, 0); } }
  function maskMail(e) { var p = String(e || '').split('@'); return p.length === 2 ? p[0].slice(0, 2) + '***@' + p[1] : ''; }
  function fbMailOpt() {
    var x = session();
    if (!x) return '<p class="small" style="margin:0 0 8px">설정에서 로그인하면 답글을 메일로도 받을 수 있어요.</p>';
    if (!x.user.email) return '<p class="small" style="margin:0 0 8px">이 계정은 메일 주소가 없어서 답글은 앱에서만 볼 수 있어요.</p>';
    var on = S.fbMail !== false;
    return '<label class="chk" style="margin:0 0 8px"><input type="checkbox" name="mail"' + (on ? ' checked' : '') + '> 답글이 달리면 메일로도 받기 <small class="small">' + esc(maskMail(x.user.email)) + '</small></label>';
  }
  function rpcAs(fn, args) {             // 로그인했으면 계정으로, 아니면 그냥
    if (!session()) return rpc(fn, args);
    return freshToken().then(function (tok) {
      if (!tok) return rpc(fn, args);
      return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    });
  }
  function fbMineCard() {
    var L = (S.fbm && S.fbm.list) || [];
    if (!fbMine().length) return '';
    if (!L.length) return '<section class="card"><h2 style="font-size:15px">내가 보낸 의견</h2><p class="small" style="margin:0">' + (S.fbm && S.fbm.loading ? '불러오는 중…' : '아직 답글이 없어요. 답글이 달리면 설정 탭에 빨간 점이 생겨요.') + '</p></section>';
    return '<section class="card"><h2 style="font-size:15px">내가 보낸 의견 <small class="small">답글은 이 휴대폰에서만 보여요</small></h2>' + L.map(function (f) {
      return '<div class="fbrow"><div class="line"><span class="tag">' + esc(f.kind) + '</span><span class="small">' + esc(dayLabel(f.at)) + ' ' + hm(f.at) + '</span></div><p>' + esc(f.body) + '</p>' +
        (f.replies || []).map(function (r) {
          var isNew = S.fbNewUntil != null && r.at > S.fbNewUntil;
          return '<div class="fbreply"><div class="line"><b>' + esc(r.by || '0521sa') + (isNew ? ' <i class="newtag">새 답글</i>' : '') + '</b><span class="small">' + esc(dayLabel(r.at)) + ' ' + hm(r.at) + '</span></div><p>' + esc(r.body) + '</p></div>';
        }).join('') + '</div>';
    }).join('') + '</section>';
  }
  var FB_KINDS = ['좋아요', '불편해요', '오류', '제안', '기타'];
  function pageFeedback() {
    var k = S.fbKind || '제안', sent = S.fbSent;
    var body = sent ? '<section class="card"><h2 style="font-size:16px">보내 주셔서 고마워요</h2><p class="small" style="margin:0;line-height:1.6">보내 주신 의견은 하나하나 읽고 다음 업데이트에 반영할게요. 개발자 답글이 달리면 설정 탭에 빨간 점이 생겨요' + (S.fbMail !== false && session() && session().user.email ? ' (메일로도 보내 드려요)' : '') + '.</p>' +
        '<button class="btn ghost" data-act="fbagain" style="margin-top:12px">하나 더 보내기</button></section>'
      : '<section class="card"><h2 style="font-size:16px">어떤 의견인가요?</h2><div class="picks" role="radiogroup" aria-label="의견 종류">' + FB_KINDS.map(function (x) {
          return '<button role="radio" aria-checked="' + (x === k) + '" class="' + (x === k ? 'on' : '') + '" data-act="fbkind" data-v="' + x + '">' + x + '</button>';
        }).join('') + '</div>' +
        '<form data-form="feedback" class="jform" style="margin-top:12px"><label>내용 <small class="small">2~1000자</small><textarea name="body" rows="6" maxlength="1000" placeholder="' +
        (k === '오류' ? '어느 화면에서 무엇을 눌렀을 때 어떻게 됐는지 적어 주세요.' : k === '불편해요' ? '어떤 점이 불편했는지 편하게 적어 주세요.' : '자유롭게 적어 주세요.') + '">' + esc(S.fbDraft || '') + '</textarea></label>' +
        fbMailOpt() +
        '<button class="btn" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '보내는 중…' : '보내기') + '</button></form>' +
        '<p class="small" style="margin:10px 0 0;line-height:1.6">' + (session() ? '로그인한 상태라 의견이 계정과 연결돼요. ' : '이름이나 연락처는 받지 않아요. ') +
        '개발자 답글은 이 화면 아래 \'내가 보낸 의견\'에서 볼 수 있어요. 보낸 의견은 서비스 개선에만 쓰고 1년 뒤 지워요.</p></section>';
    setTimeout(function () { loadFbMine(false, true); }, 0);
    return top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/settings" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">의견 보내기</span></span>') +
      '<main class="page">' + body + fbMineCard() + '</main>' + menu('settings');
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
  function loadDevFb() {
    var k = devKey();
    if (!LIVE || !k || S.devfb) return;
    S.devfb = { loading: true };
    rpc('app_dev_feedback', { p_key: k }).then(function (d) { S.devfb = { data: d }; }).catch(function () { S.devfb = { err: true }; })
      .then(function () { if (/dev/.test(location.hash)) render(); });
  }
  function devFeedback() {
    var F = S.devfb && S.devfb.data;
    if (!F) return '';
    var rec = (F.recent || []).map(function (f) {
      var reps = (f.replies || []).map(function (r) { return '<div class="fbreply"><div class="line"><b>' + esc(r.by || '0521sa') + '</b><span class="small">' + (f.mail ? (r.mailed ? '메일 보냄 · ' : r.mail_err ? '메일 실패 · ' : '메일 보내는 중 · ') : '') + esc(dayLabel(r.at)) + ' ' + hm(r.at) + '</span></div><p>' + esc(r.body) + '</p></div>'; }).join('');
      var form = f.can_reply && f.id != null ? (S.devReply === f.id
        ? '<form data-form="devreply" class="jform" data-id="' + esc(f.id) + '" style="margin-top:8px"><textarea name="body" rows="3" maxlength="1000" placeholder="0521sa 이름으로 답글이 달려요"></textarea>' +
          '<div class="two"><button type="button" class="btn ghost" data-act="devreplyoff">취소</button><button class="btn" type="submit"' + (S.busy ? ' disabled' : '') + '>답글 달기</button></div></form>'
        : '<button class="btn ghost small-btn" style="margin-top:6px" data-act="devreplyon" data-v="' + esc(f.id) + '">답글 쓰기</button>')
        : '<p class="small" style="margin:6px 0 0">예전 방식으로 받은 의견이라 답글을 볼 수 없어요</p>';
      return '<div class="fbrow"><div class="line"><span class="tag">' + esc(f.kind) + (f.mail ? ' · 메일 답글' : '') + '</span><span class="small">' + esc(dayLabel(f.created_at)) + ' ' + hm(f.created_at) + '</span></div><p>' + esc(f.body) + '</p>' + reps + form + '</div>';
    }).join('') || '<p class="small" style="margin:0">아직 받은 의견이 없어요</p>';
    return '<section class="card"><h2 style="font-size:15px">받은 의견 <small class="small">전체 ' + (F.total || 0) + '개</small></h2>' +
      '<p class="small" style="margin:0 0 6px">답글은 보낸 사람 휴대폰에만 보여요. 종목이나 매매에 대한 개별 조언은 답하지 마세요 (1:1 투자 상담은 유사투자자문업으로도 할 수 없어요).</p>' + rec + '</section>';
  }
  function loadDev(force) {
    var k = devKey();
    if (!LIVE || !k || (S.dev && (S.dev.loading || (!force && Date.now() - S.dev.at < 30000)))) return;
    S.dev = { loading: true, at: Date.now(), data: S.dev && S.dev.data };
    rpc('app_dev_stats', { p_key: k }).then(function (d) { S.dev = { at: Date.now(), data: d }; })
      .catch(function (e) { S.dev = { at: Date.now(), denied: !!(e && e.invalid), err: true }; }).then(function () { if (/dev/.test(location.hash)) render(); });
  }
  function devEngine(D) {
    var E = D.engine || null, C = D.cron || {}, P = D.dispatch || {}, X = D.data || {}, W = D.watchdog || null, MK = { kr: '국장', us: '미장', crypto: '코인' };
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
      '<li><b>⑤ 앱 데이터</b><span>선물 ' + (X.futures_at ? since(X.futures_at) : '-') + ' · 눈에 띄는 종목 ' + (X.movers_at ? since(X.movers_at) : '-') + ' · 뉴스 ' + (X.news || 0) + '종목 · 재무 ' + (X.fund || 0) + '종목 · 확률 표 ' + (X.prob_at ? since(X.prob_at) : '-') +
        (X.recap_at ? ' · 점심·마감 요약 ' + since(X.recap_at) : '') + (X.price_pending != null ? ' · 가격 알림 대기 ' + X.price_pending + ' · 7일 울림 ' + (X.price_fired7 || 0) + ' (휴대폰 ' + (X.price_devices || 0) + '대)' : '') + '</span>' + ok(!!X.futures_at) + '</li>' +
      '<li><b>⑥ 멈춤 감시 (30분마다)</b><span>' + (W ? (W.status === 'ok' ? '정상' : W.status === 'down' ? '멈춤' : '느림') + ' · ' + esc(W.why || '') + ' · 확인 ' + since(W.checked || W.updated_at) +
        (W.status !== 'ok' && W.since ? ' · ' + since(W.since) + '부터' : '') : '아직 기록이 없어요 (감시 파일을 올리면 30분 안에 생겨요)') + '<br><small>멈추거나 느려지면 카톡으로 알려 드리고, 다시 돌면 한 번 더 알려 드려요.</small></span>' +
        ok(W && W.status === 'ok' && (Date.now() - new Date(W.checked || W.updated_at).getTime()) < 75 * 60000) + '</li>' +
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
  function loadKakaoOwner(on) {          // 카톡을 '이 계정 보유 종목만' 받게 (개발자 열쇠 + 로그인 계정)
    var k = devKey(); if (!LIVE || !k) return;
    S.kown = Object.assign({}, S.kown || {}, { loading: true });
    var args = { p_key: k }; if (on !== undefined) args.p_on = on;
    rpcAs('app_dev_kakao_owner', args).then(function (d) { S.kown = { at: Date.now(), d: d || {} }; if (on !== undefined) toast(on ? '이제 카톡은 이 계정의 보유 종목 알림만 와요' : '카톡 보유 연결을 풀었어요'); })
      .catch(function () { S.kown = { at: Date.now(), err: true }; if (on !== undefined) toast('바꾸지 못했어요. 로그인했는지 확인해 주세요'); })
      .then(function () { if (/dev/.test(location.hash)) render(); });
  }
  function kakaoOwnerCard() {
    var K2 = S.kown || {}, d = K2.d || {}, x = session();
    if (!K2.at && !K2.loading) setTimeout(function () { loadKakaoOwner(); }, 0);
    var state = K2.loading && !K2.at ? '확인하는 중…' : K2.err ? '상태를 못 불러왔어요' :
      !d.set ? '아직 연결 전이라 카톡 매매 알림이 오지 않아요' : d.mine ? '이 계정과 연결됨 · 보유 ' + (d.n || 0) + '종목' : '다른 계정과 연결됨 · 보유 ' + (d.n || 0) + '종목';
    var btn = !x ? '<a class="btn ghost" href="#/settings">설정에서 먼저 로그인</a>' :
      d.mine ? '<button class="btn ghost" data-act="kownoff">연결 풀기</button>' : '<button class="btn" data-act="kownon">이 계정 보유로 카톡 받기</button>';
    return '<section class="card"><h2 style="font-size:15px">카톡 알림 <small class="small">시안님 카톡</small></h2>' +
      '<p class="small" style="margin:0 0 8px;line-height:1.6">카톡에는 <b>보유 탭에 수량을 넣은 종목</b>의 매수·매도 타점과 1년 신고가·신저가만 와요. 수량 없이 넣은 관심 종목은 빠져요. 아침 브리핑·주간 보고는 앱에서만 봐요.</p>' +
      '<div class="line"><span>' + esc(state) + '</span></div><div style="margin-top:8px">' + btn + '</div></section>';
  }
  function loadDevAcc(force) {
    var k = devKey();
    if (!LIVE || !k || (S.dacc && (S.dacc.loading || (!force && Date.now() - S.dacc.at < 30000)))) return;
    S.dacc = { loading: true, at: Date.now(), data: S.dacc && S.dacc.data };
    rpc('app_dev_accounts', { p_key: k }).then(function (d) { S.dacc = { at: Date.now(), data: d || {} }; })
      .catch(function () { S.dacc = { at: Date.now(), err: true, data: S.dacc && S.dacc.data }; })
      .then(function () { if (/dev/.test(location.hash)) render(); });
  }
  var PV = { kakao: '카카오', google: 'Google', 'custom:naver': '네이버' };
  function devAccounts() {               // 로그인한 계정 · 저장된 보유 종목 · 최근 로그인 기록 (개발자만)
    setTimeout(function () { loadDevAcc(false); }, 0);
    var D = S.dacc && S.dacc.data, A = (D && D.accounts) || [], L = (D && D.logins) || [], MK = { kr: '국장', us: '미장', crypto: '코인' }, DEV = { android: '안드로이드', ios: '아이폰', pc: '컴퓨터', etc: '기타' };
    if (!D) return '<section class="card"><h2 style="font-size:15px">로그인 계정</h2>' + (S.dacc && S.dacc.err ? '<p class="small" style="margin:0">불러오지 못했어요</p>' : '<div class="sk-lines" aria-hidden="true"><i class="sk w70"></i><i class="sk w40"></i></div>') + '</section>';
    var who = function (a) { return esc(a.name || a.mail || ('계정 ' + a.id)); };
    var rows = A.map(function (a) {
      var hold = (a.hold || []).map(function (h) { return '<span class="ahold">' + esc(h.n || '') + ' <b>' + (+h.q).toLocaleString('ko-KR', { maximumFractionDigits: 6 }) + (h.m === 'crypto' ? '개' : '주') + '</b></span>'; }).join('');
      return '<div class="acc"><div class="line"><span class="accn"><i class="pv pv-' + esc((a.provider || '').replace(':', '-')) + '">' + esc(PV[a.provider] || a.provider || '-') + '</i><b>' + who(a) + '</b>' + (a.owner ? '<i class="ev">카톡 연결</i>' : '') + '</span>' +
        '<span class="small">' + (a.last ? since(a.last) : '-') + '</span></div>' +
        '<p class="small" style="margin:2px 0 4px">' + (a.mail ? esc(a.mail) + ' · ' : '') + '가입 ' + esc(dayLabel(a.joined)) + (a.saved ? ' · 기록 저장 ' + since(a.saved) : '') + '</p>' +
        (hold ? '<div class="aholds">' + hold + '</div>' : '<p class="small" style="margin:0">보유 종목 없음</p>') + (a.watch ? '<p class="small" style="margin:4px 0 0">관심 ' + a.watch + '개</p>' : '') + '</div>';
    }).join('') || '<p class="small" style="margin:0">아직 로그인한 계정이 없어요</p>';
    var logs = L.slice(0, 20).map(function (l) {
      return '<div class="line"><span>' + esc(l.name || '-') + ' <small class="small">' + esc(PV[l.provider] || l.provider || '') + ' · ' + (DEV[l.dev] || '') + '</small></span><span class="small">' + (l.kind === 'open' ? '앱 열기 ' : '로그인 ') + esc(dayLabel(l.at)) + ' ' + hm(l.at) + '</span></div>';
    }).join('') || '<p class="small" style="margin:0">아직 기록이 없어요. 이번 업데이트부터 쌓여요.</p>';
    return '<section class="card"><h2 style="font-size:15px">로그인 계정 <small class="small">' + A.length + '개 · 보유는 수량 넣은 종목</small></h2>' + rows + '</section>' +
      '<section class="card"><h2 style="font-size:15px">최근 로그인 기록 <small class="small">90일 보관</small></h2><div class="ilist">' + logs + '</div>' +
      '<p class="small" style="margin:6px 0 0">메일은 가려서 보여요. 이 화면은 등록한 개발자 기기에서만 열려요. 문의 대응과 운영에만 쓰고 밖으로 옮기지 마세요.</p></section>';
  }
  function pageDev() {
    var k = devKey(); devPrint(k); setTimeout(function () { loadDev(false); if (S.dev && S.dev.data) loadDevFb(); }, 0);
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
          '<div><span>엔진</span><b>' + (D.beat ? since(D.beat) : '-') + '</b><em>마지막 실행</em></div>' +
          '<div><span>로그인 계정</span><b>' + ((D.data && D.data.accounts) || 0) + '</b><em>7일 저장 ' + ((D.data && D.data.accounts7) || 0) + '</em></div></div></section>' +
        kakaoOwnerCard() + devAccounts() + devEngine(D) + devFeedback() + recordSection() +
        '<section class="card"><h2 style="font-size:15px">많이 넣은 종목 <small class="small">최근 30일 · 숫자는 요청 횟수</small></h2>' + topRows + '</section>' +
        '<section class="card"><h2 style="font-size:15px">새로 들어온 종목</h2><div class="ilist">' + (recent || '<p class="small" style="margin:0">아직 없어요</p>') + '</div></section>' +
        '<section class="card"><h2 style="font-size:15px">시장별 종목 수</h2>' + kv(H.by_market, function (x) { return MK[x] || x; }) + '</section>' +
        '<section class="card"><h2 style="font-size:15px">구독자 설정</h2><h3 class="sub-h">받는 시장</h3>' + kv(U.markets, function (x) { return MK[x] || x; }) +
          '<h3 class="sub-h">알림 조건</h3>' + kv(U.preset) +
          '<h3 class="sub-h">켜 둔 기능</h3><div class="line"><span>매도 알림</span><b>' + (U.sell || 0) + '</b></div><div class="line"><span>모든 종목 매도</span><b>' + (U.sellAll || 0) + '</b></div>' +
          '<div class="line"><span>아침 브리핑</span><b>' + (U.brief || 0) + '</b></div><div class="line"><span>점심 · 마감 요약</span><b>' + (U.recap || 0) + '</b></div><div class="line"><span>방해 금지</span><b>' + (U.quiet || 0) + '</b></div>' +
          '<h3 class="sub-h">초대 코드별</h3>' + kv(U.by_code, function (x) { return x.length > 4 ? x.slice(0, 4) + '-••••' : x; }) + '</section>' +
        '<section class="card"><h2 style="font-size:15px">최근 7일 알림</h2>' + kv(A, function (x) { var p = x.split(':'); return (MK[p[0]] || p[0]) + ' ' + (p[1] === 'buy' ? '매수' : '매도'); }) + '</section>' +
        '<section class="card"><h2 style="font-size:15px">데이터 상태</h2><div class="line"><span>종목 검색 목록</span><b>' + (X.symbols || 0) + '</b></div><div class="line"><span>뉴스 받은 종목</span><b>' + (X.news || 0) + '</b></div>' +
          '<div class="line"><span>재무 받은 종목</span><b>' + (X.fund || 0) + '</b></div><div class="line"><span>선물 시세</span><b>' + (X.futures_at ? since(X.futures_at) : '-') + '</b></div><div class="line"><span>확률 표</span><b>' + (X.prob_at ? since(X.prob_at) : '-') + '</b></div></section>' +
        '<p class="foot-note">누가 어떤 종목을 넣었는지는 서버에 저장하지 않아서 볼 수 없어요. 개인정보처리방침에서 약속한 대로 종목 코드와 횟수만 모아요. 요청 횟수는 휴대폰마다 6시간에 한 번 정도 늘어서, 사람 수와 정확히 같지는 않아요.</p>';
    }
    return top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/settings" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">개발자 통계</span></span>', D ? '<button class="btn small-btn" data-act="devreload">새로고침</button>' : '') +
      '<main class="page">' + body + '</main>' + menu('settings');
  }


  // ---------- 월가 픽 (미국 기관 13F 보유 공시, SEC 공개 자료) ----------
  function loadWall(force) {
    if (!LIVE || (S.wall && (S.wall.loading || (!force && Date.now() - S.wall.at < 10 * 60000)))) return;
    S.wall = { loading: true, at: Date.now(), data: S.wall && S.wall.data };
    rpc('app_wallst', { p_code: code() }).then(function (d) { S.wall = { at: Date.now(), data: d || {} }; render(); })
      .catch(function () { S.wall = { at: Date.now(), err: true, data: S.wall && S.wall.data }; render(); });
  }
  function wallFunds() { return ((S.wall && S.wall.data && S.wall.data.funds) || []); }
  function wallLatest() { var t = ''; wallFunds().forEach(function (f) { if (f.filed > t) t = f.filed; }); return t; }
  function wallNew() { var t = wallLatest(); return !!t && t > store.get(K.wallSeen, ''); }
  function qLabel(d) { if (!d) return '-'; var y = d.slice(0, 4), m = +d.slice(5, 7); return y + '년 ' + Math.ceil(m / 3) + '분기'; }
  function usdKo(v) {
    v = +v || 0; var a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(1) + '조 달러';
    if (a >= 1e8) return Math.round(v / 1e8).toLocaleString('ko-KR') + '억 달러';
    if (a >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만 달러';
    return Math.round(v).toLocaleString('ko-KR') + '달러';
  }
  function wName(x) { return x.k || x.t || x.n; }
  function wRow(x, kind) {
    var right = kind === 'top' ? '<span class="wbar" aria-hidden="true"><i style="width:' + Math.min(100, Math.max(2, x.w * 2.5)) + '%"></i></span><b>' + x.w + '%</b>' : kind === 'new' ? '<b class="red">새로 삼</b>' : kind === 'exit' ? '<b class="blue">다 팖</b>' :
      '<b class="' + (x.chg > 0 ? 'red' : 'blue') + '">주식 수 ' + (x.chg > 0 ? '+' : '') + x.chg + '%</b>';
    var sub = (x.t ? x.t + ' · ' : '') + (kind === 'exit' ? '전 분기 ' + usdKo(x.pv) : usdKo(x.v));
    var inner = '<span class="dn"><b>' + esc(wName(x)) + '</b><small>' + esc(sub) + '</small></span>' + right;
    return x.t ? '<button class="drow wrow" data-act="mvpick" data-v="' + esc(x.t) + '" data-m="us" data-n="' + esc(wName(x)) + '" data-c="' + esc(x.t) + '">' + inner + '</button>'
      : '<div class="drow wrow">' + inner + '</div>';
  }
  function wallConsensus(kinds) {         // 여러 기관이 같은 방향으로 움직인 종목
    var m = {};
    wallFunds().forEach(function (f) {
      kinds.forEach(function (k) { (f[k] || []).forEach(function (x) { var id = x.t || x.c; if (!m[id]) m[id] = { x: x, n: 0, who: [] }; if (m[id].who.indexOf(f.ko) < 0) { m[id].n++; m[id].who.push(f.ko); } }); });
    });
    return Object.keys(m).map(function (k) { return m[k]; }).filter(function (o) { return o.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
  }
  var WALL_NOTE = '13F는 미국 기관이 분기 말 기준 보유 주식을 45일 안에 내는 SEC 공시예요. 그래서 최대 4달 늦은 정보이고, 지금도 갖고 있다는 뜻은 아니에요. 공매도·현금·미국 밖 주식과 옵션은 빠져 있어요. 기관이 추천한 종목이 아니며 투자 참고용이에요.';
  function pageWall() {
    setTimeout(function () { loadWall(false); var t = wallLatest(); if (t && t > store.get(K.wallSeen, '')) { store.set(K.wallSeen, t); } var d = document.querySelector("nav.menu a[href='#/wall'] .dot"); if (d && !wallNew()) d.remove(); }, 0);
    var F = wallFunds(), body;
    if (!LIVE) body = '<p class="empty">앱 연결이 끝나면 볼 수 있어요.</p>';
    else if (!F.length) body = S.wall && S.wall.err ? '<p class="empty">불러오지 못했어요. 아래로 당기거나 잠시 뒤 다시 열어 주세요.</p>' : S.wall && !S.wall.loading ? '<p class="empty">공시를 모으는 중이에요. 처음엔 1~2시간쯤 걸려요.</p>' : skel(3);
    else {
      var chip = function (o, cls) { return '<button class="wchip ' + cls + '"' + (o.x.t ? ' data-act="mvpick" data-v="' + esc(o.x.t) + '" data-m="us" data-n="' + esc(wName(o.x)) + '" data-c="' + esc(o.x.t) + '"' : '') + '><b>' + esc(wName(o.x)) + '</b><span>' + o.n + '곳</span></button>'; };
      var buys = wallConsensus(['new', 'add']), sells = wallConsensus(['exit', 'cut']);
      var cons = (buys.length || sells.length) ? '<section class="card"><h2 style="font-size:15px">여러 기관이 같이 움직인 종목 <small class="small">최근 공시 기준</small></h2>' +
        (buys.length ? '<h3 class="sub-h">산 종목 (새로 사거나 늘림)</h3><div class="wchips">' + buys.map(function (o) { return chip(o, 'buy'); }).join('') + '</div>' : '') +
        (sells.length ? '<h3 class="sub-h">판 종목 (줄이거나 다 팖)</h3><div class="wchips">' + sells.map(function (o) { return chip(o, 'sell'); }).join('') + '</div>' : '') +
        '<p class="small" style="margin:6px 0 0">누르면 관심 종목에 넣을 수 있어요.</p></section>' : '';
      body = cons + F.map(function (f) {
        var top3 = (f.top || []).slice(0, 3).map(function (x) { return esc(wName(x)) + ' ' + x.w + '%'; }).join(' · ');
        var stale = f.period && (Date.now() - new Date(f.period + 'T00:00:00Z').getTime()) > 200 * 864e5;
        return '<a class="card wfund' + (stale ? ' stale' : '') + '" href="#/wall/' + esc(f.cik) + '"><div class="line"><b class="name">' + esc(f.ko || f.name) + (stale ? ' <i class="ev">공시 멈춤</i>' : '') + '</b><span class="small">' + qLabel(f.period) + ' · ' + mmdd(f.filed) + ' 공시</span></div>' +
          '<p class="small" style="margin:2px 0 6px">' + usdKo(f.total) + ' · ' + (f.count || 0) + '종목 · ' + esc(top3) + '</p>' +
          '<div class="wcnt"><span class="red">새로 산 ' + (f.n_new || 0) + '</span><span class="red">늘린 ' + (f.n_add || 0) + '</span><span class="blue">줄인 ' + (f.n_cut || 0) + '</span><span class="blue">다 판 ' + (f.n_exit || 0) + '</span></div></a>';
      }).join('');
    }
    return top('<span style="font-size:18px;font-weight:700">월가 픽</span>', '<span class="small">SEC 13F 공시 ' + tipBtn('f13') + '</span>') + demoBar() +
      '<main class="page"><p class="info" style="margin:0">미국 큰 기관들이 분기마다 SEC에 내는 보유 공시예요. 새 공시가 올라오면 30분 안에 반영해요.</p>' + body +
      '<p class="foot-note">' + WALL_NOTE + ' 자료: 미국 SEC EDGAR · 종목 코드: OpenFIGI</p></main>' + menu('wall');
  }
  function pageWallFund(cik) {
    if (!wallFunds().length) setTimeout(function () { loadWall(false); }, 0);
    var f = wallFunds().filter(function (x) { return String(x.cik) === String(cik); })[0];
    var head = top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/wall" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">' + esc(f ? (f.ko || f.name) : '월가 픽') + '</span></span>');
    if (!f) return head + '<main class="page">' + skel(2) + '</main>' + menu('wall');
    var sec = function (title, list, kind, n) {
      return list && list.length ? '<section class="card"><h2 style="font-size:15px">' + title + ' <small class="small">' + (n || list.length) + '종목' + (n > list.length ? ' 중 금액 큰 ' + list.length + '개' : '') + '</small></h2>' + list.map(function (x) { return wRow(x, kind); }).join('') + '</section>' : '';
    };
    return head + '<main class="page"><section class="card"><div class="line"><span>공시한 분기</span><b>' + qLabel(f.period) + ' (' + f.period + ' 기준)</b></div>' +
      '<div class="line"><span>공시한 날</span><b>' + f.filed + '</b></div><div class="line"><span>신고한 주식 전체</span><b>' + usdKo(f.total) + ' · ' + (f.count || 0) + '종목</b></div>' +
      (f.prev_period ? '<div class="line"><span>비교한 분기</span><b>' + qLabel(f.prev_period) + '</b></div>' : '') +
      '<p class="small" style="margin:6px 0 0">SEC 등록 이름: ' + esc(f.name) + '</p></section>' +
      sec('새로 산 종목', f['new'], 'new', f.n_new) + sec('늘린 종목', f.add, 'add', f.n_add) + sec('줄인 종목', f.cut, 'cut', f.n_cut) + sec('다 판 종목', f.exit, 'exit', f.n_exit) +
      sec('많이 가진 종목', f.top, 'top') +
      '<p class="small" style="margin:0 4px">종목 코드가 있는 줄을 누르면 관심 종목에 넣을 수 있어요.</p>' +
      '<p class="foot-note">' + WALL_NOTE + '</p></main>' + menu('wall');
  }
  // ---------- 화면 조각 ----------
  var NAV = ['home', 'hold', 'wall', 'ind', 'settings'];
  function menu(on) {
    var ni = NAV.indexOf(on), prev = menu.prev == null || menu.prev < 0 ? ni : menu.prev; menu.prev = ni;
    var pill = ni >= 0 ? '<span class="npill" data-to="' + ni + '" style="--i:' + prev + '" aria-hidden="true"></span>' : '';
    function a(id, href, icon, label) { return '<a href="' + href + '" class="' + (on === id ? 'on' : '') + '"' + (on === id ? ' aria-current="page"' : '') + '>' + icon + label + '</a>'; }
    return '<nav class="menu" aria-label="메뉴"><div class="futwrap">' + futInner() + '</div><div class="tabs">' + pill + a('home', '#/', ICON.list, '타점') + a('hold', '#/hold', ICON.wallet, '보유') + a('wall', '#/wall', ICON.bank, '월가 픽' + (wallNew() ? '<i class="dot" aria-label="새 공시"></i>' : '')) + a('ind', '#/ind', ICON.sliders, '지표 설정') + a('settings', '#/settings', ICON.gear, '설정' + (unread() || fbUnread() ? '<i class="dot" aria-label="새 소식"></i>' : '')) + '</div></nav>';
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
  var TIPS = {
    grade: '안전 점검: 시장 흐름·종목 추세·눌림·변동성·실적 발표·과거 성적 6가지 중 몇 개를 통과했는지예요. 높음일수록 조건이 좋았다는 뜻이고, 수익을 보장하지 않아요.',
    score: '신호 강도: 지표 10가지 중 지금 맞는 비율이에요. 70%면 10가지 중 7가지가 맞은 거예요.',
    hilo: '1년 신고가·신저가: 지난 1년(약 250거래일) 중 가장 높거나 낮은 가격을 오늘 찍은 종목이에요.',
    f13: '13F: 미국 큰 기관이 분기 말 보유 주식을 45일 안에 SEC에 내는 공시예요. 최대 4달 늦은 정보예요.',
    ext: '시간외(프리·애프터마켓): 정규장 밖 거래라 거래가 적고 가격이 크게 튈 수 있어요. 지정가로 주문하세요.'
  };
  function tipBtn(k) { return '<button type="button" class="tipq" data-tip="' + k + '" aria-label="설명 보기">?</button>'; }
  function showTip(btn) {
    closeTip();
    var t = TIPS[btn.getAttribute('data-tip')]; if (!t) return;
    var b = document.createElement('div'); b.className = 'tipbox'; b.id = 'tipbox'; b.setAttribute('role', 'tooltip'); b.textContent = t;
    document.body.appendChild(b);
    var r = btn.getBoundingClientRect(), w = Math.min(300, window.innerWidth - 24);
    b.style.width = w + 'px'; b.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
    var below = r.bottom + 8 + b.offsetHeight < window.innerHeight - 140;
    b.style.top = (below ? r.bottom + 8 : r.top - b.offsetHeight - 8) + window.scrollY + 'px';
    S.tipY = window.scrollY;
    requestAnimationFrame(function () { b.classList.add('in'); });
  }
  function closeTip() { var b = document.getElementById('tipbox'); if (b) b.remove(); }
  var REASON = [[/VWAP 돌파/, '평균 거래가 위로 올라섬'], [/VWAP 이탈/, '평균 거래가 아래로 내려옴'], [/VWAP 위 유지/, '평균 거래가 위 유지'], [/VWAP 아래 유지/, '평균 거래가 아래 유지'],
    [/단기선 상향/, '단기 평균선 위로'], [/단기선 하향/, '단기 평균선 아래로']];
  function plainReason(r) { REASON.forEach(function (x) { r = r.replace(x[0], x[1]); }); return r; }
  function where(a) { return MARKET[a.market] + (a.category ? ' › ' + a.category : '') + ' · ' + dayLabel(a.created_at) + ' ' + (a.reason ? plainReason(a.reason) : hm(a.created_at)); }
  function extTag(a) { var r = a.market === 'us' && /프리마켓|애프터마켓/.exec(a.reason || ''); return r ? r[0] : ''; }
  function akey(a) { return a.market + '|' + (a.yt || a.name); }
  function groupAlerts(items) {            // 같은 종목은 카드 하나로 (가장 최근 알림이 위)
    var by = {}, order = [];
    items.forEach(function (a) { var k = akey(a); if (!by[k]) { by[k] = []; order.push(k); } by[k].push(a); });
    return order.map(function (k) { return by[k].sort(function (x, y) { return String(y.created_at).localeCompare(String(x.created_at)); }); });
  }
  function tLabel(iso) { var d = dayLabel(iso); return (d === '오늘' ? '' : d + ' ') + hm(iso); }
  function groupCard(g) { return card(g[0], g); }
  function resLine(a, big) {               // 알림 뒤 결과 (알림 때 가격 대비)
    var r = a.res; if (!r || r.now == null) return '';
    var f = function (v) { return '<b class="' + tone(v) + '">' + pct(v) + '</b>'; };
    return '<div class="resl' + (big ? ' big' : '') + '"><span>알림 뒤</span><span>최고 ' + f(r.hi) + '</span><span>최저 ' + f(r.lo) + '</span><span>지금 ' + f(r.now) + '</span></div>';
  }
  function card(a, g) {
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
    var fresh = S.seenReady && S.seen && (g || [a]).some(function (x) { return !S.seen[x.id]; });
    var times = g && g.length > 1 ? '<div class="atimes"><span>이 종목 알림 ' + g.length + '번</span>' + g.slice(0, 5).map(function (x) {
      return '<i class="' + (x.side === 'buy' ? 'b' : 's') + '">' + esc(tLabel(x.created_at)) + ' ' + (x.side === 'buy' ? '매수' : '매도') + '</i>'; }).join('') + (g.length > 5 ? '<i>외 ' + (g.length - 5) + '</i>' : '') + '</div>' : '';
    return '<a class="card' + (!buy && heldBy(a) ? ' held' : '') + (fresh ? ' fresh' : '') + '" href="#/alert/' + esc(a.id) + '"><div class="head"><div class="title"><div class="name"><span class="side ' + (buy ? 'buy">매수' : 'sell">매도') + '</span>' + esc(a.name) + (heldBy(a) ? '<span class="mine">보유</span>' : '') + (extTag(a) ? '<span class="mine ext">' + extTag(a) + '</span>' : '') + '</div><span class="small">' + esc(where(a)) + '</span></div>' + chip(a) + '</div>' +
      '<div class="vals">' + vals.map(function (v) { return '<div><span>' + v[0] + '</span><strong class="' + v[2] + '">' + esc(v[1]) + '</strong></div>'; }).join('') + '</div>' +
      '<span class="foot">' + esc(foot) + '</span>' + resLine(a) + times + '</a>';
  }

  // ---------- 화면 ----------
  function pageWelcome() {
    var all = S.agree.every(Boolean);
    return '<main class="welcome"><div style="display:flex;flex-direction:column;gap:14px"><div class="logo">' + ICON.logo + '</div>' +
      '<h1>매수·매도 타점을<br>알림으로 받아 보세요</h1><p class="lead">국장·미장·코인에 타점이 생기면 매수 기준가, 손절가, 매도가와 안전 점검 결과를 함께 알려 드려요.</p>' +
      '<span class="tag" style="align-self:flex-start">무료 베타 · 결제 없음</span>' + (INSTALLED ? '' : '<a class="inst-link" href="#/install">휴대폰에 앱으로 설치하기 ›</a>') + '</div>' +
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
      : !f ? skel(3)
      : items.length ? groupAlerts(items).map(groupCard).join('')
      : emptyState(ICON.bell, '최근 3일 동안 ' + (S.tab === 'all' ? '' : MARKET[S.tab] + ' ') + '내 조건에 맞는 타점이 없어요', '조건에 맞는 자리가 생기면 알림으로 알려 드려요. 아래로 당기면 새로 불러와요.');
    if (f && !S.error && hidden > 0) body += '<button class="btn ghost" data-act="showall">' + (S.showAll ? '내 조건에 맞는 것만 보기' : '조건에 안 맞아 숨긴 타점 ' + hidden + '건 보기') + '</button>';
    if (f && !S.error) body += '<a class="link-row" href="#/ind">받을 알림 조건 바꾸기 · 지표 설정 →</a><a class="link-row" href="#/guide">처음이라면 · 타점노트 사용법 보기 →</a>';
    return top('<span class="brand">타점노트<span class="tag">무료 베타</span></span>',
      '<span style="display:flex"><button class="icon-btn" data-act="refresh" aria-label="새로고침">' + ICON.refresh + '</button><a class="icon-btn" href="#/settings" aria-label="알림 설정">' + ICON.bell + '</a></span>',
      '<p class="notice">' + topNotice() + '</p>' + demoBar() + (S.offline ? '<p class="warn" style="margin:0 0 10px">인터넷에 연결되지 않았어요. 마지막으로 받은 내용을 보여 드려요.</p>' : '') + '<div class="tabs" role="group" aria-label="시장">' + tabs + '</div>' + hoursLine(pf)) +
      '<main class="page">' + annBar() + '<div class="row-head"><h1>최근 타점 <span>' + (function () { var n = groupAlerts(items).length; return n === items.length ? items.length + '건' : n + '종목 · ' + items.length + '건'; })() + '</span></h1><span class="small">' + esc(status) + '</span></div>' + noBuyNote(f, pf, mine) + body +
      (function () { var sm = f && S.tab === 'all' && !S.error ? recapCard(f.recap) + briefCard(f.brief) + moversCard(f.movers, f.hilo) : ''; return sm ? '<h2 class="grp" style="margin-top:8px">오늘 시장</h2>' + sm : ''; })() +
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
  // ---------- 타점 상세 차트 (분 · 시 · 일 · 월, 알림 지점 표시) ----------
  function loadChart(yt) {
    S.charts = S.charts || {};
    var c = S.charts[yt];
    if (!LIVE || !yt || (c && (c.loading || Date.now() - c.at < 60000))) return;
    S.charts[yt] = { loading: true, at: Date.now(), data: c && c.data, updated: c && c.updated };
    rpc('app_chart', { p_code: code(), p_yt: yt }).then(function (d) { S.charts[yt] = { at: Date.now(), data: (d && d.data) || null, updated: d && d.updated }; })
      .catch(function () { S.charts[yt] = { at: Date.now(), err: true, data: c && c.data }; })
      .then(function () { if (/alert/.test(location.hash)) render(); });
  }
  var TF = [['m', '분'], ['h', '시'], ['d', '일'], ['mo', '월']];
  function tfLabel(tf, sec) {             // 한국 시간 기준 축 글자
    if (tf === 'm') return hm(new Date(sec * 1000).toISOString());
    var k = new Date(sec * 1000 + 9 * 36e5), M = k.getUTCMonth() + 1, D = k.getUTCDate();
    if (tf === 'mo') return (k.getUTCFullYear() % 100) + '년 ' + M + '월';
    return M + '/' + D + (tf === 'h' ? ' ' + k.getUTCHours() + '시' : '');
  }
  function levelsOf(a) {
    var lv = a.side === 'buy' ? [[a.sell, a.half ? '1차 매도' : '매도 기준가', 'ink'], [a.buy, '매수 기준가', 'red'], [a.stop, '손절가', 'blue']] : [[a.rebound, '반등 매도가', 'blue']];
    return lv.filter(function (l) { return l[0] != null && isFinite(l[0]); });
  }
  function chartBox(a, same) {
    var m = a.market, C = a.yt ? (S.charts || {})[a.yt] : null, D = C && C.data, lv = levelsOf(a);
    if (a.yt) setTimeout(function () { loadChart(a.yt); }, 0);
    var legend = '<div class="clegend">' + [[a.price, '알림 때 가격', 'now']].concat(lv).map(function (l) { return '<span class="' + l[2] + '"><i></i>' + l[1] + ' <b>' + money(m, l[0]) + '</b></span>'; }).join('') + '</div>';
    if (!D) return (!LIVE || !a.yt || (C && C.err) ? '' : !C || C.loading ? '<div class="chart sk-chart" aria-hidden="true"><i class="sk"></i></div>' : '<p class="small" style="margin:10px 0 0">차트는 다음 확인(5분 안)부터 보여요.</p>') + legend;
    var at = new Date(a.created_at).getTime() / 1000;
    var pick = (S.ctf || {})[a.id];
    var tf = pick && D[pick] && D[pick].length > 1 ? pick : (D.m && D.m.length > 1 && at >= D.m[0][0] ? 'm' : D.h && D.h.length > 1 && at >= D.h[0][0] ? 'h' : 'd');
    var P = D[tf] || [];
    if (P.length < 2) return legend;
    var W = 340, H = 180, T = 10, B = 22, n = P.length;
    var ys = P.map(function (q) { return q[1]; }).concat(lv.map(function (l) { return l[0]; }), [a.price]);
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), pad = (hi - lo) * 0.08 || hi * 0.01 || 1; lo -= pad; hi += pad;
    var X = function (i) { return (i / (n - 1) * (W - 2) + 1).toFixed(1); }, Y = function (v) { return (T + (hi - v) / (hi - lo) * (H - T - B)).toFixed(1); };
    var near = function (sec) { var b = 0, best = 1e18; for (var i = 0; i < n; i++) { var d0 = Math.abs(P[i][0] - sec); if (d0 < best) { best = d0; b = i; } } return b; };
    var up = P[n - 1][1] >= P[0][1], cls = up ? 'red' : 'blue';
    var line = P.map(function (q, i) { return (i ? 'L' : 'M') + X(i) + ',' + Y(q[1]); }).join('');
    var area = line + 'L' + X(n - 1) + ',' + (H - B) + 'L' + X(0) + ',' + (H - B) + 'Z';
    var span = P[n - 1][0] - P[0][0], tol = span / n * 1.5 + (tf === 'mo' ? 40 * 86400 : tf === 'd' ? 3 * 86400 : 3600);
    var marks = (same || [a]).filter(function (x) { var s = new Date(x.created_at).getTime() / 1000; return s >= P[0][0] - tol && s <= P[n - 1][0] + tol; }).map(function (x) {
      var i = near(new Date(x.created_at).getTime() / 1000), me = String(x.id) === String(a.id);
      return '<circle class="mk ' + (x.side === 'buy' ? 'b' : 's') + (me ? ' me' : '') + '" cx="' + X(i) + '" cy="' + Y(x.price) + '" r="' + (me ? 5.5 : 4) + '"><title>' + esc(tLabel(x.created_at) + ' ' + (x.side === 'buy' ? '매수' : '매도') + ' ' + money(m, x.price)) + '</title></circle>';
    }).join('');
    var lines = lv.map(function (l) { return '<line class="lvl ' + l[2] + '" x1="0" x2="' + W + '" y1="' + Y(l[0]) + '" y2="' + Y(l[0]) + '"/>'; }).join('') +
      '<line class="lvl now" x1="0" x2="' + W + '" y1="' + Y(a.price) + '" y2="' + Y(a.price) + '"/>';
    var xl = [0, Math.floor((n - 1) / 2), n - 1].map(function (i, k) { return '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '">' + esc(tfLabel(tf, P[i][0])) + '</text>'; }).join('');
    var last = P[n - 1][1], vs = (last / a.price - 1) * 100;
    S.chartPts = { pts: P, tf: tf, m: m, W: W, n: n };
    var tabs = '<div class="seg four ctabs" role="tablist" aria-label="차트 기간">' + TF.map(function (q) {
      var ok = D[q[0]] && D[q[0]].length > 1, on = q[0] === tf;
      return '<button role="tab" data-act="ctf" data-id="' + esc(a.id) + '" data-v="' + q[0] + '" class="' + (on ? 'on' : '') + '" aria-selected="' + on + '"' + (ok ? '' : ' disabled') + '>' + q[1] + '</button>';
    }).join('') + '</div>';
    return '<div class="chead"><span class="small">지금</span><b>' + money(m, last) + '</b><span class="' + tone(vs) + '">알림 때보다 ' + pct(vs) + '</span></div>' + resLine(a, true) +
      '<div class="chart" data-chart="1"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(TF.filter(function (q) { return q[0] === tf; })[0][1] + ' 차트, 알림 지점 표시') + '">' +
      '<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="cg0 ' + cls + '"/><stop offset="1" class="cg1"/></linearGradient></defs>' +
      lines + '<path class="carea" d="' + area + '" fill="url(#cg)"/><path class="cline ' + cls + '" d="' + line + '"/>' + marks + '<g class="cx">' + xl + '</g>' +
      '<line class="cscrub" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" style="display:none"/></svg><div class="ctip" style="display:none"></div></div>' +
      tabs + legend + '<p class="small cnote">' + (C.updated ? hm(C.updated) + ' 기준 · ' : '') + '점: 이 종목 알림이 온 곳' + (m === 'kr' ? ' · 국장은 15~20분 늦어요' : '') + '</p>';
  }
  function chartScrub(e) {               // 차트를 누르거나 훑으면 그때 시각 · 가격
    var box = e.target.closest && e.target.closest('.chart[data-chart]');
    if (!box || !S.chartPts) return;
    var sv = box.querySelector('svg'), r = sv.getBoundingClientRect(), C = S.chartPts;
    var i = Math.max(0, Math.min(C.n - 1, Math.round((e.clientX - r.left) / r.width * (C.n - 1))));
    var q = C.pts[i], x = (i / (C.n - 1) * (C.W - 2) + 1), ln = box.querySelector('.cscrub'), tip = box.querySelector('.ctip');
    ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.style.display = '';
    tip.textContent = tfLabel(C.tf, q[0]) + ' · ' + money(C.m, q[1]);
    tip.style.display = ''; var px = (e.clientX - r.left); tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, px - tip.offsetWidth / 2)) + 'px';
  }
  function pageDetail(id) {
    var a = ((S.feed && S.feed.alerts) || []).filter(function (x) { return String(x.id) === String(id); })[0];
    var head = top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">' + (a ? (a.side === 'buy' ? '매수 타점' : '매도 타점') : '타점') + '</span></span>');
    if (!a) return head + '<main class="page"><p class="empty">' + (S.feed ? '이 타점은 3일이 지나 목록에서 빠졌어요.' : '불러오는 중…') + '</p><a class="btn ghost" href="#/">목록으로</a></main>' + menu('home');
    var m = a.market, buy = a.side === 'buy', out = [];
    out.push('<section class="card"><div class="name" style="font-size:12px;font-weight:400;color:var(--mut)"><span class="side ' + (buy ? 'buy">매수' : 'sell">매도') + '</span>' + esc(where(a)) + '</div>' +
      (extTag(a) ? '<p class="info" style="margin:0 0 8px">' + extTag(a) + ' 알림이에요 ' + tipBtn('ext') + '</p>' : '') + '<h1 style="margin:0;font-size:22px">' + esc(a.name) + '</h1><div class="big-price"><strong>' + money(m, a.price) + '</strong><span class="small">알림 때 가격</span></div>' + chartBox(a, ((S.feed && S.feed.alerts) || []).filter(function (x) { return akey(x) === akey(a); })) +
      (m === 'kr' ? '<p class="info" style="margin-top:12px">국장 시세는 늦게 들어올 수 있어요. 주문 전에 증권사 앱에서 현재가를 꼭 확인해 주세요.</p>' : '') + '</section>');
    var same = ((S.feed && S.feed.alerts) || []).filter(function (x) { return akey(x) === akey(a); })
      .sort(function (x, y) { return String(y.created_at).localeCompare(String(x.created_at)); });
    if (same.length > 1) out.push('<section class="card"><h2 style="font-size:15px">이 종목 알림 기록 <small class="small">최근 3일 · ' + same.length + '번 · 누르면 그때 내용</small></h2><div class="tline">' + same.map(function (x) {
      var xb = x.side === 'buy';
      return '<a class="tl' + (String(x.id) === String(a.id) ? ' on' : '') + '" href="#/alert/' + esc(x.id) + '"' + (String(x.id) === String(a.id) ? ' aria-current="true"' : '') + '><i class="dotl ' + (xb ? 'b' : 's') + '"></i><span class="tt">' + esc(tLabel(x.created_at)) + '</span>' +
        '<span class="tr"><b class="' + (xb ? 'red' : 'blue') + '">' + (xb ? '매수' : '매도') + '</b> ' + esc(x.reason ? plainReason(x.reason).replace(/^\d{1,2}:\d{2}\s*/, '') : '') + '</span><b class="tp">' + money(m, x.price) + '</b></a>';
    }).join('') + '</div></section>');
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
      out.push('<section class="card"><div class="line"><h2>안전 점검 ' + tipBtn('grade') + '</h2>' + chip(a) + '</div><ul class="checks">' +
        miss.map(function (x) { return '<li>' + ICON.no + esc(MISS[x] || x) + '</li>'; }).join('') +
        (passN > 0 ? '<li>' + ICON.ok + (miss.length ? '나머지 ' + passN + '개 통과' : passN + '개 모두 통과') + '</li>' : '') + '</ul>' + hist +
        '<div class="line"><span>신호 강도 ' + tipBtn('score') + '</span><b>' + a.score * 10 + '% (' + a.score + '개)</b></div></section>');
    } else {
      out.push('<section class="card"><h2>보유 중이라면</h2><ol class="steps">' +
        (a.rebound ? '<li><i>1</i><span>지금 팔거나, <b>' + money(m, a.rebound) + '</b>까지 반등하면 팔아요</span></li>' : '<li><i>1</i><span>가까운 반등 자리가 없어요. 보유 중이라면 <b>지금 매도</b>를 참고하세요</span></li>') +
        '<li><i>2</i><span>다시 살 때는 🔴 매수 알림이 올 때만 사요</span></li></ol><div class="line"><span>신호 강도 <small class="small">지표 10가지 중 맞은 비율</small></span><b>' + a.score * 10 + '% (' + a.score + '개)</b></div></section>');
    }
    if (a.yt) {
      loadNews(a.yt);
      var an_ = (S.anews || {})[a.yt], nl = an_ && an_.items ? newsList(an_.items, 6) : '';
      if (nl) out.push('<section class="card"><h2 style="font-size:15px">관련 뉴스</h2><p class="small" style="margin:0 0 4px">' + newsSrc(an_.items) + '에서 찾은 최근 기사 제목이에요. 누르면 기사로 가요.</p>' + nl + '</section>');
    }
    out.push(holdBox(a));
    var Ba = BROKERS[m === 'crypto' ? broker().coin : broker().stock];
    out.push('<div class="two"><button class="btn" data-act="aopenapp" data-v="' + esc(a.id) + '">' + esc(Ba.name) + '에서 보기</button><button class="btn ghost" data-act="ashare" data-v="' + esc(a.id) + '">공유하기</button></div>' +
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
  function recordSection() {           // 성적표: 개발자 통계 화면 안에만
    var f = S.feed, body;
    if (!f) body = '<p class="empty">' + (S.error ? esc(S.error) : '불러오는 중…') + '</p>';
    else if (S.rec !== 'live') {
      body = f.sim && f.sim.markets && f.sim.markets.length
        ? '<p class="foot-note" style="margin:0 4px">알림이 올 때마다 100만원씩 샀다고 치고 과거(국장·미장 약 3년, 코인 2년)를 다시 돌려 본 결과예요. 수수료 0.2% 포함 · ' + kst(new Date(f.sim.made), { month: 'numeric', day: 'numeric' }) + ' 계산</p>' + f.sim.markets.map(simSection).join('')
        : '<p class="empty">아직 계산한 결과가 없어요.<br>하루 안에 채워져요.</p>';
    } else body = liveSection(f.live);
    return '<h2 class="grp" style="margin-top:6px">성적표 <small>개발자만 보여요</small></h2><div class="seg rec" role="tablist"><button role="tab" data-act="rec" data-v="sim" class="' + (S.rec !== 'live' ? 'on' : '') + '" aria-selected="' + (S.rec !== 'live') + '">과거 시뮬레이션</button><button role="tab" data-act="rec" data-v="live" class="' + (S.rec === 'live' ? 'on' : '') + '" aria-selected="' + (S.rec === 'live') + '">실전 기록</button></div>' +
      body + '<p class="foot-note">과거 성적은 미래 수익을 보장하지 않아요.</p>';
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
      sw('mk-kr', mk.indexOf('kr') >= 0, '국장', '평일 09:15 ~ 15:20') + sw('mk-us', mk.indexOf('us') >= 0, '미장', '프리마켓 18:00 ~ 애프터마켓 다음 날 10:00 (한국 시간, 서머타임 1시간 빠름)') +
      sw('mk-crypto', mk.indexOf('crypto') >= 0, '코인', '24시간') + sw('quiet', p.quiet, '방해 금지', '밤 12시 ~ 아침 7시는 조용히') + '</section>' +
      (function () {
        var kinds = [p.sell, p.brief, mk.indexOf('kr') >= 0 ? p.recap : null, p.wallst, p.hilo !== false].filter(function (v) { return v !== null; }), onN = kinds.filter(Boolean).length;
        return '<details class="card acc kinds"' + (S.kindsOpen ? ' open' : '') + '><summary data-kinds="1"><span><b>받을 알림 종류</b><small class="small">' + kinds.length + '가지 중 ' + onN + '가지 켬 · 매도 · 브리핑 · 요약 · 월가 픽 · 신고가</small></span><span class="chev" aria-hidden="true"></span></summary><div class="accb list inner">' +
          sw('sell', p.sell, '매도 알림', '최근 7일 안에 매수 알림이 나간 종목이나 보유 중인 종목만 받아요 · 3일 뒤 실제로 내린 건 절반쯤이에요') +
      (p.sell ? sw('sellAll', p.sellAll, '모든 종목 매도 알림', '다른 종목도 갖고 있다면 켜 주세요 · 알림이 많아져요') : '') +
      sw('brief', p.brief, '아침 브리핑', '매일 아침 8시쯤 밤사이 시장 요약 (일요일 쉼)') +
      (mk.indexOf('kr') >= 0 ? sw('recap', p.recap, '점심 · 마감 요약', '국장 여는 날 12:30쯤, 15:40쯤 한 줄 요약') : '') + sw('wallst', p.wallst, '월가 픽 새 공시', '미국 큰 기관의 새 보유 공시(13F)가 올라오면 알려 드려요') + sw('hilo', p.hilo !== false, '1년 신고가 · 신저가', '주요 종목이 1년 중 가장 높거나 낮은 가격을 찍으면 시장별로 한 번에 알려 드려요') + '</div></details>';
      })() +
      shareAppCard() +
      accountCard() +
      '<section class="card"><h2 style="font-size:15px">화면 테마</h2><div class="seg seg3" style="margin:10px 0 0">' + [['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']].map(function (q) {
        var on = store.get(K.theme, 'auto') === q[0];
        return '<button class="' + (on ? 'on' : '') + '" data-act="theme" data-v="' + q[0] + '" aria-pressed="' + on + '">' + q[1] + '</button>';
      }).join('') + '</div><p class="small" style="margin:8px 0 0">자동은 휴대폰의 밝기 설정(다크 모드)을 따라가요.</p></section>' +
      '<section class="card"><h2 style="font-size:15px">증권사 · 거래소 앱</h2><p class="small" style="margin:0">내 보유에서 <b>…에서 보기</b>를 누르면 여기서 고른 앱이 열리고 종목 코드가 복사돼요. 토스증권(국장)과 업비트는 종목 화면으로 바로 가요.</p>' +
        '<h3 class="pick-h">주식 (국장 · 미장)</h3><div class="picks">' + STOCK_APPS.map(function (k) { return bchip(k, 'stock'); }).join('') + '</div>' +
        '<h3 class="pick-h">코인 · 국내</h3><div class="picks">' + COIN_APPS.map(function (k) { return bchip(k, 'coin'); }).join('') + '</div>' +
        '<h3 class="pick-h">코인 · 해외</h3><div class="picks">' + COIN_ABROAD.map(function (k) { return bchip(k, 'coin'); }).join('') + '</div>' +
        (BROKERS[broker().coin].abroad ? '<p class="small pick-note">해외 거래소는 USDT 거래 화면으로 열어요. 앱의 코인 가격은 원화(업비트) 기준이라 조금 다를 수 있어요. 국내에 신고되지 않은 거래소는 이용 전에 금융정보분석원 신고 여부를 확인해 주세요.</p>' : '') + '</section>' +
      '<a class="list item-link" href="#/notice"><span><b>공지사항' + (unread() ? ' <span class="tag new">새 글 ' + unread() + '</span>' : '') + '</b><small>' + (S.ann && S.ann[0] ? esc(S.ann[0].date + ' · ' + S.ann[0].title) : '업데이트 소식') + '</small></span><span aria-hidden="true">›</span></a>' +
      '<a class="list item-link" href="#/feedback"><span><b>의견 보내기' + (fbUnread() ? ' <i class="newtag">새 답글 ' + fbUnread() + '</i>' : '') + '</b><small>불편한 점, 오류, 바라는 기능을 알려 주세요 · 답글도 여기서 봐요</small></span><span aria-hidden="true">›</span></a>' +
      '<a class="list item-link" href="#/guide"><span><b>타점노트 사용법</b><small>알림 읽는 법 · 사고파는 순서 · 장 시간</small></span><span aria-hidden="true">›</span></a>' +
      '<section class="card"><div class="line"><h2 style="font-size:15px">구독</h2><span class="tag">준비 중</span></div><p class="small" style="margin:0;line-height:1.6;color:var(--sub)">지금은 무료 베타예요. 정식 구독은 관련 신고를 마친 뒤에 시작하고, 시작 전에 미리 알려 드려요.</p></section>' +
      '<section class="card"><details><summary style="font-size:14px;font-weight:600;cursor:pointer;min-height:28px">투자 위험 고지</summary><ul style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.6;color:var(--sub)">' + NOTICES.map(function (n) { return '<li><b>' + n[0] + '</b> ' + n[1] + '</li>'; }).join('') + '</ul></details>' +
      '<details><summary style="font-size:14px;font-weight:600;cursor:pointer;min-height:28px">개인정보 안내</summary><p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:var(--sub)">로그인하지 않으면 이름·전화번호·이메일은 받지 않아요. 푸시 알림을 켜면 이 휴대폰의 알림 주소와 알림 설정만 저장하고, 알림을 끄면 지워요. 입장 코드는 이 휴대폰에만 저장돼요. <a href="privacy.html" style="color:var(--blue);text-decoration:underline">개인정보처리방침 전체 보기</a></p></details>' +
      (LIVE && c && c !== OPEN_CODE ? '<div class="line"><span>초대 코드 ' + esc(c.slice(0, 4)) + '-••••</span><button class="btn ghost" style="width:auto;min-height:40px;padding:0 14px;font-size:13px" data-act="logout">코드 지우기</button></div>' : '') + '</section>' +
      '<p class="foot-note">투자 참고용 정보이며 투자자문이 아니에요. ' + whoAmI() + '. 개별 상담과 자금 운용은 하지 않아요.</p></main>' + menu('settings');
  }

  function pageInstall() {
    var steps = function (xs) { return '<ol class="isteps">' + xs.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>'; }, body;
    if (inApp) {
      body = '<p class="warn">' + (/KAKAOTALK/i.test(UA) ? '카카오톡' : '앱') + ' 안에서 열린 화면이라 여기서는 설치가 안 돼요. ' + (isIOS ? '사파리로' : '크롬으로') + ' 열어 주세요.</p>' +
        (isIOS && !/KAKAOTALK/i.test(UA) ? '' : '<button class="btn" data-act="iout">' + (isIOS ? '사파리로 열기' : '크롬으로 열기') + '</button>') +
        '<p class="small" style="margin:12px 0 6px">버튼이 안 되면 직접 열어 주세요</p>' +
        steps(isIOS ? ['오른쪽 아래 <b>⋯</b> 또는 공유 버튼을 눌러요', '<b>Safari로 열기</b> (또는 기본 브라우저로 열기)를 눌러요'] : ['오른쪽 위 <b>⋮</b> 를 눌러요', '<b>다른 브라우저로 열기</b>를 눌러요']) +
        '<button class="btn ghost" data-act="lcopy" style="margin-top:6px">링크 복사하기</button>';
    } else if (BIP) {
      body = '<button class="btn big" data-act="iinstall">홈 화면에 설치하기</button><p class="small" style="margin:10px 0 0;text-align:center">버튼을 누르고 <b>설치</b>를 한 번 더 누르면 끝나요</p>';
    } else if (isIOS) {
      body = steps(['화면 아래(또는 위)의 <b>공유 버튼</b> <span class="ishare" aria-hidden="true">□↑</span> 을 눌러요', '목록을 올려 <b>홈 화면에 추가</b>를 눌러요', '오른쪽 위 <b>추가</b>를 누르면 끝나요']) +
        '<p class="small" style="margin:0">아이폰은 Safari에서 하는 게 가장 확실해요. 홈 화면에 추가해야 알림도 받을 수 있어요.</p>';
    } else if (isAndroid) {
      body = steps(['오른쪽 위 <b>⋮</b> 를 눌러요', '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요', '<b>설치</b>를 누르면 끝나요']) +
        '<p class="small" style="margin:0">삼성 인터넷은 아래 <b>≡</b> → <b>현재 페이지 추가</b> → <b>홈 화면</b>이에요. 메뉴에 설치가 안 보이면 크롬으로 열어 주세요.</p>';
    } else {
      body = '<p class="small" style="margin:0 0 12px">휴대폰에서 이 링크를 열면 바로 설치할 수 있어요. 카카오톡 \'나와의 채팅\'으로 보내 두면 편해요.</p>' +
        '<div class="two"><button class="btn" data-act="lshare">링크 보내기</button><button class="btn ghost" data-act="lcopy">링크 복사</button></div>';
    }
    return top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">휴대폰에 설치</span></span>') +
      '<main class="page install"><section class="card ihero"><div class="logo">' + ICON.logo + '</div><h1>타점노트를<br>휴대폰에 설치하세요</h1>' +
      '<p class="lead">앱 마켓 없이 바로 홈 화면에 설치돼요. 1분이면 끝나고, 무료 베타예요.</p></section>' +
      '<section class="card">' + body + '</section>' +
      '<section class="card"><h2 style="font-size:15px">설치한 뒤에는</h2>' + steps(['홈 화면의 <b>타점노트</b> 아이콘으로 열어요', '안내를 읽고 동의하면 바로 시작돼요', '<b>설정</b>에서 푸시 알림을 켜면 타점이 생길 때 알려 드려요']) + '</section>' +
      '<p class="foot-note">국장·미장·코인 매수·매도 타점을 알려 주는 참고용 정보예요 (투자자문 아님).</p></main>';
  }
  function shareAppCard() {
    return '<section class="card shareapp"><h2 style="font-size:15px">타점노트 같이 쓰기</h2>' +
      '<p class="small" style="margin:4px 0 10px">링크를 받은 사람은 열자마자 설치 안내가 나와요. 앱 마켓 없이 바로 홈 화면에 설치돼요.</p>' +
      '<div class="linkbox"><span>' + esc(shareUrl().replace(/^https?:\/\//, '').replace(/\?i=1$/, '')) + '</span><button type="button" class="namebtn" data-act="lcopy">복사</button></div>' +
      '<div class="two" style="margin-top:10px"><button class="btn" data-act="lshare">링크 보내기</button>' +
      (INSTALLED ? '<span class="btn ghost done" aria-disabled="true">' + ICON.chk + ' 설치돼 있어요</span>' : '<a class="btn ghost" href="#/install">이 휴대폰에 설치</a>') + '</div></section>';
  }
  function pageGuide() {
    var gi = 0, sec = function (t, body) { return '<details class="card guide acc"' + (gi++ === 0 ? ' open' : '') + '><summary><h2>' + t + '</h2><span class="chev" aria-hidden="true"></span></summary><div class="accb">' + body + '</div></details>'; };
    var li = function (xs) { return '<ul>' + xs.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; };
    return top('<span style="display:flex;align-items:center;gap:2px"><a class="icon-btn" href="#/" aria-label="뒤로">' + ICON.back + '</a><span style="font-size:16px;font-weight:700">타점노트 사용법</span></span>') + '<main class="page">' +
      sec('타점노트는 이런 앱이에요', '<p>국장·미장·코인에서 정해진 규칙(지표 10가지 + 안전 점검)에 맞는 자리가 생기면 알려 줘요. 사람이 고르는 추천이 아니라 규칙대로 계산한 <b>참고 정보</b>예요.</p>') +
      sec('🔴 매수 알림 읽는 법', li(['<b>매수 기준가</b>: 이 가격 근처나 아래에서 사요. 지금 가격이 많이 위면 기다려요.', '<b>손절가</b>: 여기에 닿으면 팔아서 손실을 작게 끊어요. 가장 중요해요.', '<b>1차 매도</b>: 여기서 절반을 팔고, 남은 절반은 손절가를 산 가격으로 올려요.', '<b>나머지</b>: 오른 뒤 고점에서 정해진 만큼 빠지면 팔아요.', '<b>안전 점검</b>: 시장 흐름·추세·눌림·변동성·실적·과거 성적 6가지 중 몇 개를 통과했는지예요. 지표 설정의 <b>안정성 %</b>와는 다른 거예요.', '<b>신호 강도</b>: 지표 10가지 중 몇 %가 맞았는지예요. 60%면 10가지 중 6가지가 맞은 거예요.'])) +
      sec('🔵 매도 알림', '<p>이미 갖고 있는 종목이 약해질 때 와요. 기본으로는 <b>최근 7일 안에 매수 알림이 나간 종목</b>과 실전 기록·내 보유에 수량을 넣은 종목만 보여 줘요. 다른 종목도 갖고 있다면 설정에서 <b>모든 종목 매도 알림</b>을 켜세요. 과거 기록에서 3일 뒤 실제로 내린 건 절반 정도라 참고만 하세요.</p>') +
      sec('내 보유 탭', '<ul><li><b>+ 종목 추가</b>로 가진 종목을 넣어요. 국장·미장·코인 아무 종목이나 돼요. 수량과 평균 단가는 이 휴대폰에만 저장돼요 (설정에서 로그인하면 계정에도 저장).</li><li><b>확률 계산에 쓸 지표</b>를 고르면, 그 지표들이 지금과 같았던 지난 5년의 날들에서 1·5·20거래일 뒤 실제로 오른 비율을 보여 줘요.</li><li><b>표본 적음</b>이 붙으면 비슷한 날이 적어서 숫자가 흔들리기 쉬워요. 지표를 줄여 보세요.</li><li>상승 확률은 대부분 50% 근처예요. 평소 상승 비율과 비교해서 보세요. 미래를 보장하지 않아요.</li><li><b>…에서 보기</b>를 누르면 <b>설정 → 증권사 · 거래소 앱</b>에서 고른 앱이 열리고 종목 코드가 복사돼요. 주식 10곳, 코인은 국내 4곳·해외 5곳(바이낸스·바이비트·OKX·비트겟·코인베이스) 중에 고를 수 있어요.</li><li>미장 종목은 프리마켓·애프터마켓 때 시간외 가격을 카드 위에 따로 보여 줘요. 데이마켓(주간거래) 가격은 받을 수 있는 자료가 없어요.</li><li>종목을 지우면 아래에 <b>되돌리기</b>가 5초 동안 떠요. 보유·타점·월가 픽 화면은 맨 위에서 아래로 당기면 새로 불러와요.</li><li>카드 아래에 그 종목의 최근 뉴스 제목이 나와요. 1시간 안에 나온 기사에는 <b>속보</b>가 붙어요.</li><li><b>지금 상태</b>의 %는 지난 1년 중 오늘보다 약했던 날의 비율이에요. 80%면 1년 중 상위 20% 수준이에요.</li><li><b>종목 분석</b>을 누르면 <b>투자 원칙으로 보기</b>가 나와요. 상승 추세·신고가 돌파·실적 주도주·우량 기업·안전마진·성장 대비 적정가, 널리 알려진 6가지 원칙을 몇 % 충족하는지 보여 줘요. 특정 인물이나 단체와 관계없는 점검표예요.</li><li>가진 종목이 아니어도 수량 없이 넣으면 <b>관심</b> 묶음에 들어가요.</li><li>카드의 오각형은 상승 힘·안정감·가격 매력·성장성·재무 건강 5가지를 0~100으로 그린 거예요. 가운데 숫자는 평균(종합 점수)이고 참고용이에요.</li></ul>') +
      sec('메뉴 위 선물 막대', '<ul><li>S&P500 · 나스닥100 · 다우 <b>지수 선물</b>의 등락을 보여 줘요. 밤(오후 6시 ~ 아침 6시)에는 <b>야간 선물</b>로 표시돼요.</li><li>누르면 가격, 오늘 흐름 그래프, 기준 시각이 펼쳐져요. 5분마다 새로 받고, 거래소 기준 약 10분 늦은 값이에요.</li></ul>') +
      sec('알림이 오면 이 순서로', '<ol><li>앱에서 매수 기준가·손절가를 확인해요.</li><li>증권사 앱에서 <b>현재가</b>를 꼭 다시 봐요. 국장 시세는 늦을 수 있어요.</li><li>지정가로 주문해요. 한 종목에 돈을 너무 많이 넣지 않아요.</li><li>손절가에 알림이나 주문을 걸어 둬요.</li><li>샀다면 타점 화면에서 <b>내 보유에 넣기</b>로 수량과 단가를 넣어요.</li></ol>') +
      sec('지표 설정 · 수익성 · 안정성', li(['<b>지표 설정</b> 탭에서 받을 매수 알림 조건을 골라요. 처음이면 <b>추천</b>이 무난해요.', '<b>수익성</b>: 알림대로 100만원씩 샀을 때 한 번 살 때 평균 수익률(수수료 포함)이에요.', '<b>안정성</b>: 알림이 있었던 달 중 수익 난 달의 비율이에요.', '모두 과거 데이터로 계산한 값이라 앞으로도 그렇다는 보장은 없어요.'])) +
      sec('장 시간 (한국 시간)', li(['국장: 평일 09:00 ~ 15:30', '미장 데이마켓(주간거래): 10:00 ~ 18:00 · 서머타임 09:00 ~ 17:00 · 대체거래소라 거래가 적어요', '미장 프리마켓: 18:00 ~ 23:30 · 서머타임 17:00 ~ 22:30',
        '미장 정규장: 23:30 ~ 다음 날 06:00 · 서머타임 22:30 ~ 05:00', '미장 애프터마켓: 06:00 ~ 10:00 · 서머타임 05:00 ~ 09:00 · 증권사마다 끝나는 시간이 달라요', '코인: 24시간',
        '미장 타점 알림은 프리마켓 · 정규장 · 애프터마켓 모두 확인해요. 시간외 알림에는 <b>프리마켓</b> · <b>애프터마켓</b> 표시가 붙고, 거래가 적어 가격이 크게 튈 수 있으니 지정가로 주문하세요. 데이마켓(주간거래)은 무료 시세 자료가 없어서 아직 알림이 없어요.',
        '휴장일과 미장 조기 마감은 첫 화면 장 시간에 반영돼요. 국장 2027년 휴장일은 거래소 공식 발표 전이라 공휴일 기준이에요.'])) +
      sec('꼭 지켜 주세요', li(['손절가는 꼭 지켜요. 버티다 손실이 커지는 경우가 가장 많아요.', '빌린 돈이나 당장 필요한 돈으로 하지 않아요.', '알림은 참고 정보예요. 투자 판단과 책임은 본인에게 있어요.'])) +
      '</main>' + menu('');
  }

  // ---------- 그리기 · 이동 ----------
  function route() { var p = location.hash.replace(/^#\/?/, '').split('/'); return { p: p[0] || 'home', id: p[1] }; }
  function render() {
    var r = route(), html;
    if (r.p === 'install' && INSTALLED) { location.replace('#/'); return; }
    if (r.p === 'install') html = pageInstall();
    else if (!S.agreedNow) html = pageWelcome();
    else if (LIVE && !code()) {
      if (S.open === false) html = pageCode();
      else { html = pageWait(); if (S.open === null) setTimeout(checkOpen, 0); }
    }
    else if (r.p === 'alert') html = pageDetail(r.id);
    else if (r.p === 'record') { location.replace('#/'); return; }
    else if (r.p === 'guide') html = pageGuide();
    else if (r.p === 'notice') html = pageNotice();
    else if (r.p === 'feedback') html = pageFeedback();
    else if (r.p === 'dev') html = pageDev();
    else if (r.p === 'hold') html = r.id === 'add' ? pageHoldAdd() : pageHold();
    else if (r.p === 'wall') html = r.id ? pageWallFund(r.id) : pageWall();
    else if (r.p === 'settings') html = pageSettings();
    else if (r.p === 'ind') html = pageInd();
    else html = pageHome();
    var y = window.scrollY, same = render.last === location.hash;
    $app.innerHTML = html;
    if (!same) window.scrollTo(0, 0); else window.scrollTo(0, y);
    render.last = location.hash;
    try { enhance(!same); } catch (_) {}
  }
  // ---------- 화면 다듬기 (움직임은 휴대폰의 '동작 줄이기' 설정을 따라요) ----------
  var RM = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function calm() { return !!(RM && RM.matches); }
  function num(v) { return parseFloat(String(v == null ? '' : v).replace(/,/g, '')); }
  function fmtAmt(v) {                   // 1234567.5 → 1,234,567.5 (입력칸용)
    if (v === '' || v == null) return '';
    var s0 = String(v).replace(/,/g, ''), neg = s0.charAt(0) === '-'; if (neg) s0 = s0.slice(1);
    var p = s0.split('.'), i = p[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + i + (p.length > 1 ? '.' + p.slice(1).join('').replace(/\D/g, '') : '');
  }
  function liveFmt(el) {                 // 입력하는 동안 천 단위 쉼표 (커서 위치는 그대로)
    var v = el.value, pos = el.selectionStart == null ? v.length : el.selectionStart, before = v.slice(0, pos).replace(/[^\d.]/g, '').length;
    var f = fmtAmt(v.replace(/[^\d.,]/g, ''));
    if (f === v) return;
    el.value = f;
    var n = 0, i = 0; while (i < f.length && n < before) { if (/[\d.]/.test(f.charAt(i))) n++; i++; }
    try { el.setSelectionRange(i, i); } catch (_) {}
  }
  function hlq(text, q) {                // 검색어와 맞는 부분 강조
    var t = String(text || ''), i = q && q.length >= 1 ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
    return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
  }
  function skel(n) {
    var one = '<section class="card skel" aria-hidden="true"><i class="sk w40"></i><i class="sk w70"></i><div class="sk-row"><i class="sk"></i><i class="sk"></i><i class="sk"></i></div></section>';
    return '<div class="skels" role="status" aria-label="불러오는 중">' + new Array((n || 3) + 1).join(one) + '</div>';
  }
  function emptyState(icon, title, text, cta) {
    return '<div class="estate"><div class="eicon" aria-hidden="true">' + icon + '</div><b>' + esc(title) + '</b><p>' + text + '</p>' + (cta || '') + '</div>';
  }
  function copied(btn, label) {
    if (!btn || btn.classList.contains('copied')) return;
    var old = btn.innerHTML; btn.classList.add('copied'); btn.innerHTML = ICON.chk + esc(label || '복사했어요');
    setTimeout(function () { if (btn.isConnected) { btn.classList.remove('copied'); btn.innerHTML = old; } }, 1600);
  }
  function sheet(o) {                    // 아래에서 올라오는 확인 창 → Promise(true/false)
    return new Promise(function (res) {
      var w = document.createElement('div'); w.className = 'sheet-wrap';
      w.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shT"><i class="grab" aria-hidden="true"></i><h2 id="shT">' + esc(o.title) + '</h2><p>' + esc(o.body) + '</p>' +
        (o.input ? '<input class="sheet-in" type="text" autocomplete="nickname" maxlength="' + (o.input.max || 20) + '" placeholder="' + esc(o.input.ph || '') + '" value="' + esc(o.input.value || '') + '" aria-label="' + esc(o.title) + '">' : '') +
        '<div class="two"><button type="button" class="btn ghost" data-v="0">' + esc(o.no || '취소') + '</button><button type="button" class="btn' + (o.danger ? ' danger' : '') + '" data-v="1">' + esc(o.ok || '확인') + '</button></div></div>';
      document.body.appendChild(w);
      requestAnimationFrame(function () { w.classList.add('in'); });
      var key = function (e) { if (e.key === 'Escape') done(false); };
      var inp = w.querySelector('.sheet-in');
      var done = function (v) { var t = inp ? inp.value.trim() : ''; document.removeEventListener('keydown', key); w.classList.remove('in'); setTimeout(function () { w.remove(); }, 220); res(inp ? (v ? t : false) : v); };
      document.addEventListener('keydown', key);
      if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); done(true); } });
      w.addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (b) done(b.getAttribute('data-v') === '1'); else if (e.target === w) done(false); });
      setTimeout(function () { var c = inp || w.querySelector('button[data-v="0"]'); if (c) try { c.focus(); if (inp) inp.select(); } catch (_) {} }, 60);
    });
  }
  function onboarding() {                // 처음 쓰는 사람: 3장짜리 짧은 안내 (넘기거나 건너뛸 수 있음)
    if (document.querySelector('.onb-wrap')) return;
    var P = [
      [ICON.list, '타점이 생기면 알려 드려요', '매수 알림에는 <b>매수 기준가 · 손절가 · 매도가</b>가 같이 와요. 카드를 누르면 분·시·일·월 차트에서 알림이 온 지점을 볼 수 있어요.'],
      [ICON.wallet, '가진 종목을 넣어 두세요', '<b>보유</b> 탭에 종목과 수량을 넣으면 점수·뉴스·가격 알림을 한곳에서 봐요. 로그인하면 휴대폰을 바꿔도 그대로예요.'],
      [ICON.bell, '알림을 켜 주세요', '받을 시장과 알림 종류, 방해 금지 시간은 <b>설정</b>에서 언제든 바꿀 수 있어요.']];
    var w = document.createElement('div'); w.className = 'onb-wrap'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-label', '타점노트 안내');
    w.innerHTML = '<div class="onb"><button type="button" class="onb-skip" data-o="skip">건너뛰기</button><div class="onb-track">' + P.map(function (q) {
      return '<section class="onb-p"><div class="onb-ic" aria-hidden="true">' + q[0] + '</div><h2>' + q[1] + '</h2><p>' + q[2] + '</p></section>'; }).join('') +
      '</div><div class="onb-dots">' + P.map(function (_, i) { return '<i data-i="' + i + '"></i>'; }).join('') + '</div><button type="button" class="btn onb-next" data-o="next">다음</button></div>';
    document.body.appendChild(w);
    var i = 0, tr = w.querySelector('.onb-track'), nx = w.querySelector('.onb-next');
    var go = function (k) {
      i = Math.max(0, Math.min(P.length - 1, k)); tr.style.transform = 'translateX(' + (-i * 100) + '%)';
      [].forEach.call(w.querySelectorAll('.onb-dots i'), function (d, j) { d.classList.toggle('on', j === i); });
      nx.textContent = i === P.length - 1 ? (pushOn() ? '시작하기' : '알림 켜고 시작') : '다음';
    };
    var done = function (push) { store.set(K.onb, true); w.classList.remove('in'); setTimeout(function () { w.remove(); }, 220); if (push && LIVE && !pushOn()) enablePush(); };
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-o],[data-i]'); if (!b) return;
      if (b.getAttribute('data-o') === 'skip') done(false);
      else if (b.getAttribute('data-o') === 'next') { if (i < P.length - 1) go(i + 1); else done(true); }
      else go(+b.getAttribute('data-i'));
    });
    var x0 = null;
    tr.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    tr.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); });
    go(0); requestAnimationFrame(function () { w.classList.add('in'); });
  }
  function netBar() {                    // 인터넷이 끊기면 위에 얇은 띠
    var b = document.getElementById('netbar');
    if (navigator.onLine === false) {
      if (!b) { b = document.createElement('div'); b.id = 'netbar'; b.className = 'netbar'; b.setAttribute('role', 'status'); b.textContent = '인터넷 연결이 끊겼어요. 다시 연결되면 새로 불러올게요.'; document.body.appendChild(b); }
    } else if (b) b.remove();
  }
  window.addEventListener('offline', netBar);
  window.addEventListener('online', function () { var was = !!document.getElementById('netbar'); netBar(); if (was) { toast('다시 연결됐어요', { kind: 'ok' }); loadFeed(); loadFut(); } });
  // 당겨서 새로고침 (타점 · 보유 · 월가 픽)
  var PTR = { y0: null, dy: 0, el: null, busy: false };
  function ptrFn() {
    var r = route();
    if (r.p === 'home') return function () { return loadFeed(); };
    if (r.p === 'hold' && !r.id) return function () { loadHold(true); loadPA(true); return new Promise(function (ok) { setTimeout(ok, 900); }); };
    if (r.p === 'wall' && !r.id) return function () { loadWall(true); return new Promise(function (ok) { setTimeout(ok, 900); }); };
    return null;
  }
  function ptrShow(d, spin) {
    var el = PTR.el;
    if (!el) { el = PTR.el = document.createElement('div'); el.className = 'ptr'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = ICON.refresh; document.body.appendChild(el); }
    el.style.transform = 'translate(-50%,' + Math.round(d - 46) + 'px)';
    el.style.opacity = d > 6 ? Math.min(1, d / 60) : 0;
    if (el.firstChild && !spin) el.firstChild.style.transform = 'rotate(' + Math.round(d * 4) + 'deg)';
    el.classList.toggle('spin', !!spin); el.classList.toggle('ready', d >= 64 && !spin);
  }
  document.addEventListener('touchstart', function (e) {
    PTR.y0 = null;
    if (PTR.busy || window.scrollY > 0 || e.touches.length !== 1 || !ptrFn() || document.querySelector('.sheet-wrap')) return;
    if (e.target.closest && e.target.closest('input,textarea,select,.mvs,.hls,.wchips,.fs')) return;
    PTR.y0 = e.touches[0].clientY; PTR.dy = 0;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (PTR.y0 == null) return;
    PTR.dy = e.touches[0].clientY - PTR.y0;
    ptrShow(PTR.dy > 0 && window.scrollY <= 0 ? Math.min(PTR.dy * 0.5, 96) : 0);
  }, { passive: true });
  document.addEventListener('touchend', function () {
    if (PTR.y0 == null) return;
    PTR.y0 = null;
    var fn = ptrFn();
    if (PTR.dy * 0.5 < 64 || !fn) { ptrShow(0); return; }
    PTR.busy = true; ptrShow(58, true);
    Promise.resolve().then(fn).catch(function () {}).then(function () { PTR.busy = false; ptrShow(0); });
  });
  // 스크롤: 위 머리 그림자 · 내리면 숨고 올리면 돌아옴 · 길면 '맨 위로'
  var lastY = 0, ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY, h = document.querySelector('header.top');
      if (h) {
        h.classList.toggle('scrolled', y > 4);
        if (y > 140 && y - lastY > 6 && !h.contains(document.activeElement)) h.classList.add('hide');
        else if (lastY - y > 6 || y < 140) h.classList.remove('hide');
      }
      var tb = document.getElementById('totop');
      if (y > 1400 && !tb) {
        tb = document.createElement('button'); tb.id = 'totop'; tb.className = 'totop'; tb.type = 'button'; tb.setAttribute('aria-label', '맨 위로'); tb.innerHTML = ICON.up;
        tb.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' }); });
        document.body.appendChild(tb); requestAnimationFrame(function () { tb.classList.add('in'); });
      } else if (y <= 1400 && tb) tb.remove();
      lastY = y;
    });
  }, { passive: true });
  document.addEventListener('click', function (e) {        // 설명 말풍선: ? 를 누르면 열고, 다른 곳을 누르면 닫음
    var q = e.target.closest && e.target.closest('[data-tip]');
    if (q) { e.preventDefault(); e.stopPropagation(); if (document.getElementById('tipbox')) closeTip(); else showTip(q); return; }
    closeTip();
  }, true);
  window.addEventListener('scroll', function () { if (document.getElementById('tipbox') && Math.abs(window.scrollY - (S.tipY || 0)) > 40) closeTip(); }, { passive: true });
  window.addEventListener('hashchange', closeTip);
  document.addEventListener('click', function (e) {        // 지금 탭을 한 번 더 누르면 맨 위로
    var a = e.target.closest && e.target.closest('nav.menu .tabs a.on');
    if (!a) return;
    var href = a.getAttribute('href'), cur = location.hash || '#/';
    if (href === cur || (href === '#/' && (cur === '#' || cur === '#/'))) { e.preventDefault(); window.scrollTo({ top: 0, behavior: calm() ? 'auto' : 'smooth' }); }
  });
  function rollNums() {                  // 바뀐 숫자는 굴러가듯 (같은 부호일 때만)
    S.rollPrev = S.rollPrev || {};
    [].forEach.call(document.querySelectorAll('[data-roll]'), function (el) {
      var k = el.getAttribute('data-roll'), txt = el.textContent, prev = S.rollPrev[k];
      S.rollPrev[k] = txt;
      if (prev == null || prev === txt || calm()) return;
      var re = /\d[\d,]*(\.\d+)?/, m = txt.match(re), pm = prev.match(re);
      if (!m || !pm) return;
      var a = num(pm[0]), b = num(m[0]);
      if (!isFinite(a) || !isFinite(b) || a === b || prev.slice(0, pm.index) !== txt.slice(0, m.index)) return;
      var dec = (m[0].split('.')[1] || '').length, comma = m[0].indexOf(',') >= 0, pre = txt.slice(0, m.index), post = txt.slice(m.index + m[0].length), t0 = null;
      var fmt = function (v) { var x = v.toFixed(dec); return comma ? fmtAmt(x) : x; };
      el.classList.add(b > a ? 'tick-up' : 'tick-down');
      var step = function (ts) {
        if (t0 == null) t0 = ts;
        var q = Math.min(1, (ts - t0) / 480), e = 1 - Math.pow(1 - q, 3);
        if (!el.isConnected) return;
        el.textContent = q < 1 ? pre + fmt(a + (b - a) * e) + post : txt;
        if (q < 1) requestAnimationFrame(step); else setTimeout(function () { el.classList.remove('tick-up', 'tick-down'); }, 300);
      };
      requestAnimationFrame(step);
    });
  }
  function segSlide(key0) {              // 세그먼트: 고른 칸이 미끄러져 옮겨감
    S.segPrev = S.segPrev || {};
    [].forEach.call(document.querySelectorAll('.seg'), function (sg, i) {
      var bs = [].filter.call(sg.children, function (c) { return c.tagName === 'BUTTON'; }), on = -1;
      bs.forEach(function (b, j) { if (b.classList.contains('on')) on = j; });
      var k = key0 + ':' + i + ':' + bs.length, prev = S.segPrev[k];
      S.segPrev[k] = on;
      if (on < 0 || prev == null || prev < 0 || prev === on || !bs[prev] || calm()) return;
      var rs = sg.getBoundingClientRect(), r0 = bs[prev].getBoundingClientRect(), r1 = bs[on].getBoundingClientRect(), th = document.createElement('i');
      th.className = 'segthumb'; th.setAttribute('aria-hidden', 'true');
      th.style.cssText = 'left:' + (r0.left - rs.left) + 'px;top:' + (r0.top - rs.top) + 'px;width:' + r0.width + 'px;height:' + r0.height + 'px';
      sg.classList.add('moving'); sg.insertBefore(th, sg.firstChild);
      requestAnimationFrame(function () { requestAnimationFrame(function () { th.style.left = (r1.left - rs.left) + 'px'; th.style.top = (r1.top - rs.top) + 'px'; th.style.width = r1.width + 'px'; }); });
      setTimeout(function () { sg.classList.remove('moving'); if (th.parentNode) th.remove(); }, 320);
    });
  }
  function enhance(changed) {            // render() 뒤에 한 번: 들어올 때 움직임 · 탭 알약 · 숫자 · 세그먼트
    var r = route(), key0 = r.p + '/' + (r.id || '');
    var pill = document.querySelector('nav.menu .npill');
    if (pill) requestAnimationFrame(function () { requestAnimationFrame(function () { pill.style.setProperty('--i', pill.getAttribute('data-to')); }); });
    if (changed && !calm()) { var mp = document.querySelector('main.page'); if (mp) { mp.classList.add('enter'); setTimeout(function () { mp.classList.remove('enter'); }, 700); } }
    rollNums(); segSlide(key0);
    if (r.p === 'home' && S.feed && S.feed.alerts) {
      S.seen = S.seen || {};
      S.feed.alerts.forEach(function (a) { S.seen[a.id] = 1; });
      if (!S.seenReady) S.seenReady = true;
      [].forEach.call(document.querySelectorAll('a.card.fresh'), function (c) { setTimeout(function () { c.classList.add('fresh-done'); }, 2200); });
    }
  }
  var ACT = {
    start: function () { S.agreedNow = true; S.agree = S.agree.map(function () { return false; }); store.set(K.consent, true); render(); if (!LIVE || code()) loadFeed(); if (!store.get(K.onb, false)) setTimeout(onboarding, 350); },
    tab: function (t) { S.tab = t.dataset.v; render(); },
    rec: function (t) { S.rec = t.dataset.v; render(); },
    span: function (t) { S.liveSpan = t.dataset.v; render(); },
    refresh: function () { if (!S.loading) { toast('새로 불러와요'); loadFeed(); } },
    push: function () { if (pushOn()) disablePush(); else enablePush(); },
    login: function (t) { signIn(t.dataset.v); },
    lshare: function (t) {
      var u = shareUrl(), txt = '타점노트 · 국장·미장·코인 매수·매도 타점 알림 (무료 베타)\n링크를 열면 바로 휴대폰에 설치할 수 있어요.';
      var copyIt = function () {
        try { navigator.clipboard.writeText(txt + '\n' + u).then(function () { copied(t, '복사했어요'); toast('링크를 복사했어요. 카톡에 붙여 넣어 보내 주세요', { kind: 'ok' }); }, function () { toast('길게 눌러 직접 복사해 주세요'); }); } catch (_) { toast('길게 눌러 직접 복사해 주세요'); }
      };
      if (navigator.share) navigator.share({ title: '타점노트', text: txt, url: u }).catch(function (e) { if (!e || e.name !== 'AbortError') copyIt(); });
      else copyIt();
    },
    lcopy: function (t) {
      try { navigator.clipboard.writeText(shareUrl()).then(function () { copied(t, '복사했어요'); toast('링크를 복사했어요', { kind: 'ok' }); }, function () { toast('길게 눌러 직접 복사해 주세요'); }); } catch (_) { toast('길게 눌러 직접 복사해 주세요'); }
    },
    iout: function () { if (!openOutside()) toast(isIOS ? '오른쪽 아래 ⋯ → Safari로 열기를 눌러 주세요' : '오른쪽 위 ⋮ → 다른 브라우저로 열기를 눌러 주세요'); },
    iinstall: function () {
      if (!BIP) { render(); return; }
      var e = BIP; BIP = null;
      e.prompt();
      (e.userChoice || Promise.resolve({})).then(function (c) { if (c && c.outcome === 'dismissed') toast('나중에 설정 → 이 휴대폰에 설치에서 다시 할 수 있어요'); render(); });
    },
    setname: function () {
      var x = session(); if (!x) return;
      sheet({ title: '이름 정하기', body: '개발자 화면과 이 휴대폰에서 계정 이름으로 보여요. 실명이 아니어도 돼요.', ok: '저장', input: { value: x.user.name || '', ph: '예: 시안', max: 20 } })
        .then(function (v) {
          if (v === false) return;
          var n = cleanName(v);
          if (!n) { toast('이름을 한 글자 이상 넣어 주세요'); return; }
          if (n === x.user.name) return;
          saveName(n).then(function () { store.del(K.nvre); toast('이름을 저장했어요'); render(); }).catch(function () { toast('저장하지 못했어요. 잠시 뒤 다시 해 주세요'); });
        });
    },
    signout: function () { signOut(false); toast('로그아웃했어요. 이 휴대폰의 기록은 남아 있어요'); },
    syncnow: function () { pushNow().then(function () { toast(S.syncErr ? '저장하지 못했어요' : '계정에 저장했어요'); render(); }); },
    delacct: function () { sheet({ title: '계정을 지울까요?', body: '계정과 서버에 저장된 보유 종목·설정이 바로 지워지고 되돌릴 수 없어요. 이 휴대폰에 있는 기록은 남아요.', ok: '계정 지우기', danger: true }).then(function (ok) { if (ok) deleteAccount(); }); },
    ashare: function (t) { var a = ((S.feed && S.feed.alerts) || []).filter(function (x) { return String(x.id) === t.dataset.v; })[0]; if (a) shareAlert(a); },
    hshare: function (t) {
      var h = holds().filter(function (x) { return x.id === t.dataset.v; })[0], an = h && S.han && S.han.data && S.han.data.an && S.han.data.an[h.yt];
      if (h && an && an.ok) shareHold(h, an); else toast('분석이 끝나면 공유할 수 있어요');
    },
    theme: function (t) {                // 누른 자리에서 원으로 번지며 바뀜 (지원하는 브라우저만)
      var go = function () { store.set(K.theme, t.dataset.v); applyTheme(); render(); };
      if (!document.startViewTransition || calm()) return go();
      var r = t.getBoundingClientRect(), de = document.documentElement;
      de.style.setProperty('--vx', Math.round(r.left + r.width / 2) + 'px'); de.style.setProperty('--vy', Math.round(r.top + r.height / 2) + 'px');
      de.classList.add('vt-theme');
      var done = function () { de.classList.remove('vt-theme'); };
      try { document.startViewTransition(go).finished.then(done, done); } catch (_) { done(); go(); }
    },
    parec: function (t) {                // 평단 기준 추천 가격 알림 두 개를 한 번에
      var h = holds().filter(function (x) { return x.id === t.dataset.v; })[0], an = h && S.han && S.han.data && S.han.data.an && S.han.data.an[h.yt];
      if (!h || !(h.avg > 0)) return;
      if (!pushOn()) { S.paopen = h.id; render(); return; }
      var m = h.market, cur = an && an.ok ? an.price : null;
      var rd = function (v) { return m === 'us' ? Math.round(v * 100) / 100 : v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v * 100) / 100; };
      var stop = rd(h.avg * 0.9), goal = rd(h.avg * 1.2), sets = [];
      if (!cur || stop < cur) sets.push(['down', stop]);
      if (!cur || goal > cur) sets.push(['up', goal]); else sets.push(['up', rd(cur * 1.1)]);
      if (!sets.length) return;
      t.disabled = true; t.innerHTML = '<span class="spin" aria-hidden="true"></span>거는 중';
      var made = [];
      myEndpoint().then(function (ep) {
        if (!ep) throw new Error('push off');
        return sets.reduce(function (pr, q) {
          return pr.then(function () { return rpc('app_price_set', { p_code: code(), p_endpoint: ep, p_yt: h.yt, p_market: m, p_name: h.name, p_kind: q[0], p_price: q[1] }).then(function (l) { paSet(l); made.push(q); }); });
        }, Promise.resolve()).then(function () { return ep; });
      }).then(function (ep) {
        render();
        toast(made.map(function (q) { return (q[0] === 'up' ? '목표 ' : '손절 ') + money(m, q[1]); }).join(' · ') + ' 알림을 걸었어요', { kind: 'ok', action: '되돌리기', onAction: function () {
          var ids = paList().filter(function (a) { return a.yt === h.yt && !a.fired_at && made.some(function (q) { return q[0] === a.kind && +q[1] === +a.price; }); }).map(function (a) { return a.id; });
          ids.reduce(function (pr, id) { return pr.then(function () { return rpc('app_price_del', { p_code: code(), p_endpoint: ep, p_id: id }).then(paSet); }); }, Promise.resolve())
            .then(function () { render(); toast('되돌렸어요', { kind: 'ok' }); }).catch(paErr);
        } });
      }).catch(function (e) { paErr(e); render(); });
    },
    paopen: function (t) { S.paopen = t.dataset.v; S.pakind = 'up'; S.paval = ''; render(); },
    paclose: function () { S.paopen = null; S.paval = ''; render(); },
    pakind: function (t) { S.pakind = t.dataset.v; S.paval = ''; render(); },
    paquick: function (t) { var f = t.closest('form'); if (f) { f.price.value = fmtAmt(t.dataset.v); S.paval = t.dataset.v; f.price.classList.remove('bump'); void f.price.offsetWidth; f.price.classList.add('bump'); } },
    padel: function (t) {
      var id = +t.dataset.v;
      if (!LIVE) return;
      var a = paList().filter(function (x) { return x.id === id; })[0], ep0;
      myEndpoint().then(function (ep) { if (!ep) throw new Error('push off'); ep0 = ep; return rpc('app_price_del', { p_code: code(), p_endpoint: ep, p_id: id }); })
        .then(function (l) {
          paSet(l); render();
          if (!a || a.fired_at) { toast('가격 알림을 지웠어요'); return; }
          toast('가격 알림을 지웠어요', { action: '되돌리기', onAction: function () {
            rpc('app_price_set', { p_code: code(), p_endpoint: ep0, p_yt: a.yt, p_market: a.market, p_name: a.name, p_kind: a.kind, p_price: a.price })
              .then(function (l2) { paSet(l2); render(); toast('되돌렸어요', { kind: 'ok' }); }).catch(paErr);
          } });
        }).catch(paErr);
    },
    sell: function () { var p = prefs(); p.sell = !p.sell; savePrefs(p); },
    quiet: function () { var p = prefs(); p.quiet = !p.quiet; savePrefs(p); },
    sellAll: function () { var p = prefs(); p.sellAll = !p.sellAll; savePrefs(p); },
    brief: function () { var p = prefs(); p.brief = !p.brief; savePrefs(p); toast(p.brief ? '아침 브리핑을 받아요' : '아침 브리핑을 껐어요'); },
    hilo: function () { var p = prefs(); p.hilo = p.hilo === false; savePrefs(p); toast(p.hilo ? '1년 신고가 · 신저가를 알려 드려요' : '1년 신고가 · 신저가 알림을 껐어요'); },
    wallst: function () { var p = prefs(); p.wallst = !p.wallst; savePrefs(p); toast(p.wallst ? '월가 픽 새 공시를 알려 드려요' : '월가 픽 알림을 껐어요'); },
    kownon: function () { loadKakaoOwner(true); },
    ctf: function (t) { S.ctf = S.ctf || {}; S.ctf[t.dataset.id] = t.dataset.v; render(); },
    kownoff: function () { loadKakaoOwner(false); },
    recap: function () { var p = prefs(); p.recap = !p.recap; savePrefs(p); toast(p.recap ? '점심 · 마감 요약을 받아요' : '점심 · 마감 요약을 껐어요'); },
    recaphide: function () { var r = S.feed && S.feed.recap; if (r) store.set(K.recapHide, r.kind + r.day); render(); },
    grade: function (t) { var p = prefs(); p.minGrade = t.dataset.v; savePrefs(p); },
    showall: function () { S.showAll = !S.showAll; render(); },
    briefhide: function () { var b = S.feed && S.feed.brief; if (b) store.set(K.briefHide, b.day); render(); },
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
    hdel: function (t) {                 // 바로 지우고 5초 동안 '되돌리기'
      var id = t.dataset.v, L = holds(), at = -1;
      L.forEach(function (h, i) { if (h.id === id) at = i; });
      if (at < 0) return;
      var item = L[at];
      holdSave(L.filter(function (h) { return h.id !== id; })); S.hdel = S.hedit = null; render();
      toast(item.name + '을(를) 지웠어요', { action: '되돌리기', onAction: function () {
        var L2 = holds(); if (L2.some(function (h) { return h.id === id; })) return;
        L2.splice(Math.min(at, L2.length), 0, item); holdSave(L2); render(); toast('되돌렸어요', { kind: 'ok' });
      } });
    },
    hopenapp: function (t) { var h = holds().filter(function (x) { return x.id === t.dataset.v; })[0]; if (h) openBroker(h); },
    bstock: function (t) { var b = store.get(K.broker, {}) || {}; b.stock = t.dataset.v; store.set(K.broker, b); render(); },
    aopenapp: function (t) {
      var x = ((S.feed && S.feed.alerts) || []).filter(function (y) { return String(y.id) === t.dataset.v; })[0];
      if (!x) return;
      if (x.yt) openBroker({ market: x.market, code: x.market === 'kr' ? x.yt.split('.')[0] : x.market === 'crypto' ? x.yt.replace('-KRW', '') : x.yt });
      else openBroker({ market: x.market, code: x.name, byName: true });   // 예전 알림: 종목 이름을 복사
    },
    devcopy: function (t) { if (S.devfp) { try { navigator.clipboard.writeText(S.devfp).then(function () { copied(t, '복사했어요'); toast('등록 코드를 복사했어요', { kind: 'ok' }); }, function () { toast('길게 눌러 직접 복사해 주세요'); }); } catch (_) { toast('길게 눌러 직접 복사해 주세요'); } } },
    devreload: function () { S.dev = null; S.devfb = null; S.kown = null; loadDev(true); loadDevAcc(true); render(); },
    devtap: function () { S.devTaps = (S.devTaps || 0) + 1; clearTimeout(S.devTimer); S.devTimer = setTimeout(function () { S.devTaps = 0; }, 2500); if (S.devTaps >= 7) { S.devTaps = 0; location.hash = '#/dev'; } },
    fbkind: function (t) { var ta = document.querySelector('textarea[name=body]'); if (ta) S.fbDraft = ta.value; S.fbKind = t.dataset.v; render(); },
    fbagain: function () { S.fbSent = false; S.fbDraft = ''; render(); },
    devreplyon: function (t) { S.devReply = +t.dataset.v; render(); var ta = document.querySelector('form[data-form=devreply] textarea'); if (ta) ta.focus(); },
    devreplyoff: function () { S.devReply = null; render(); },
    mvhide: function () { var M = S.feed && S.feed.movers; store.set(K.moversHide, ((M && M.at) || '').slice(0, 10)); render(); },
    mvpick: function (t) { S.hsel = { yt: t.dataset.v, code: t.dataset.c, name: t.dataset.n, market: t.dataset.m }; location.hash = '#/hold/add'; },
    anndis: function () { markSeen(); render(); },
    lgopen: function (t) { S.lgopen = S.lgopen === t.dataset.v ? null : t.dataset.v; render(); },
    futopen: function () { S.futOpen = !S.futOpen; document.querySelectorAll('.futwrap').forEach(function (el) { el.innerHTML = futInner(); }); },
    bcoin: function (t) { var b = store.get(K.broker, {}) || {}; b.coin = t.dataset.v; store.set(K.broker, b); render(); },

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
  $app.addEventListener('toggle', function (e) { if (e.target.classList && e.target.classList.contains('kinds')) S.kindsOpen = e.target.open; }, true);
  $app.addEventListener('pointermove', chartScrub);
  $app.addEventListener('pointerdown', chartScrub);
  $app.addEventListener('pointerleave', function (e) { var b = e.target.closest && e.target.closest('.chart[data-chart]'); if (b) { var t = b.querySelector('.ctip'), l = b.querySelector('.cscrub'); if (t) t.style.display = 'none'; if (l) l.style.display = 'none'; } }, true);
  $app.addEventListener('input', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('data-fmt') === 'amt') liveFmt(e.target);
    if (e.target.hasAttribute && e.target.hasAttribute('data-hq')) hSearch(e.target.value.trim());
  });
  $app.addEventListener('change', function (e) {
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
      var q = num(e.target.qty.value) || 0, av = num(e.target.avg.value) || 0, hid_ = e.target.getAttribute('data-id');
      if (q < 0 || av < 0) { toast('숫자를 확인해 주세요'); return; }
      if (hid_) {
        var L = holds(); L.forEach(function (h) { if (h.id === hid_) { h.qty = q; h.avg = av; } }); holdSave(L); S.hedit = null; toast('저장했어요'); render(); return;
      }
      if (!S.hsel) return;
      addHolding(S.hsel, q, av); S.hsel = null; S.hq = ''; S.hres = null; toast('내 보유에 넣었어요'); location.hash = '#/hold'; return;
    }
    if (form === 'paset') {
      e.preventDefault();
      var hp = holds().filter(function (x) { return x.id === e.target.getAttribute('data-id'); })[0];
      var anp = hp && S.han && S.han.data && S.han.data.an && S.han.data.an[hp.yt];
      var pv = num(e.target.price.value), cur = anp && anp.ok ? anp.price : null, upk = S.pakind !== 'down';
      if (!hp || !(pv > 0)) { toast('가격을 확인해 주세요'); return; }
      if (cur && upk && pv <= cur) { toast('목표가는 지금 가격(' + money(hp.market, cur) + ')보다 높게 정해 주세요'); return; }
      if (cur && !upk && pv >= cur) { toast('손절가는 지금 가격(' + money(hp.market, cur) + ')보다 낮게 정해 주세요'); return; }
      S.busy = true; render();
      myEndpoint().then(function (ep) {
        if (!ep) throw new Error('push off');
        return rpc('app_price_set', { p_code: code(), p_endpoint: ep, p_yt: hp.yt, p_market: hp.market, p_name: hp.name, p_kind: upk ? 'up' : 'down', p_price: pv });
      }).then(function (l) { paSet(l); S.paopen = null; S.paval = ''; toast((upk ? '목표가' : '손절가') + ' 알림을 걸었어요'); })
        .catch(paErr).then(function () { S.busy = false; render(); });
      return;
    }
    if (form === 'devreply') {
      e.preventDefault();
      var rb = (e.target.body.value || '').trim(), rid = +e.target.getAttribute('data-id');
      if (!rb) { toast('답글을 적어 주세요'); return; }
      S.busy = true; render();
      rpc('app_dev_reply', { p_key: devKey(), p_id: rid, p_body: rb })
        .then(function (ok) { if (ok === true) { S.devReply = null; toast('답글을 달았어요'); S.devfb = null; loadDevFb(true); } else toast('답글을 달지 못했어요'); })
        .catch(function () { toast('답글을 달지 못했어요'); })
        .then(function () { S.busy = false; render(); });
      return;
    }
    if (form === 'feedback') {
      e.preventDefault();
      var fbody = (e.target.body.value || '').trim();
      if (fbody.length < 2) { toast('내용을 조금 더 적어 주세요'); return; }
      if (!LIVE) { S.fbSent = true; render(); return; }
      S.busy = true; S.fbDraft = fbody; render();
      var ftok = randStr(), wantMail = !!(e.target.mail && e.target.mail.checked);
      S.fbMail = e.target.mail ? wantMail : S.fbMail;
      rpcAs('app_feedback2', { p_code: code(), p_kind: S.fbKind || '제안', p_body: fbody, p_ver: (S.ann && S.ann[0] && S.ann[0].id) || '', p_tok: ftok, p_mail: wantMail })
        .then(function (r) {
          if (r && r.ok) { S.fbSent = true; S.fbDraft = ''; var mine = fbMine(); mine.unshift({ id: r.id, tok: ftok, at: new Date().toISOString() }); store.set(K.fbmine, mine.slice(0, 30)); S.fbm = null; }
          else toast('지금은 보낼 수 없어요. 잠시 뒤 다시 해 주세요');
        })
        .catch(function () { toast('보내지 못했어요. 인터넷 연결을 확인해 주세요'); })
        .then(function () { S.busy = false; render(); });
      return;
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
  setInterval(function () { if (document.visibilityState === 'visible' && !/settings|alert|ind|guide|hold|notice|dev|feedback/.test(location.hash)) loadFeed(); }, 60000);
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


  // ---------- 로그인 (카카오 · 네이버 · Google) — 선택 사항, 로그인하면 기록을 계정에 저장 ----------
  // Supabase Auth의 PKCE 방식: 로그인 화면 → 이 앱 주소?code=... 로 돌아오면 토큰으로 바꿈. 비밀값은 앱에 없음.
  var SYNC_KEYS = [K.hold, K.prefs, K.hind, K.broker, K.theme];
  var PROVIDERS = { kakao: { name: '카카오', id: 'kakao' }, naver: { name: '네이버', id: 'custom:naver' }, google: { name: 'Google', id: 'google' } };
  K.auth = 'tn_auth'; K.sync = 'tn_sync'; K.pkce = 'tn_pkce';
  function authBase() { return (CFG.supabaseUrl || '').replace(/\/$/, '') + '/auth/v1'; }
  function session() { var x = store.get(K.auth, null); return x && x.access_token ? x : null; }
  function b64url(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function randStr() { var a = new Uint8Array(48); crypto.getRandomValues(a); return b64url(a); }
  function signIn(key) {
    var pv = PROVIDERS[key];
    if (!LIVE || !pv) { toast('앱 연결이 끝나면 쓸 수 있어요'); return; }
    if (!(window.crypto && crypto.subtle)) { toast('이 브라우저는 로그인을 지원하지 않아요'); return; }
    var verifier = randStr();
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (h) {
      store.set(K.pkce, { v: verifier, p: key, at: Date.now(), back: location.hash || '#/settings' });
      var q = new URLSearchParams({ provider: pv.id, redirect_to: location.origin + location.pathname, code_challenge: b64url(h), code_challenge_method: 's256' });
      if (key === 'naver' && store.get(K.nvre, false)) { q.set('auth_type', 'reprompt'); store.del(K.nvre); }   // 별명 제공에 다시 동의받기
      location.href = authBase() + '/authorize?' + q.toString();
    });
  }
  function saveSession(t) {
    if (!t || !t.access_token) throw new Error('no token');
    var u = t.user || {}, md = u.user_metadata || {};
    store.set(K.auth, { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at || Math.floor(Date.now() / 1000) + (t.expires_in || 3600),
      user: { id: u.id, provider: (u.app_metadata || {}).provider || '', name: md.name || md.full_name || md.nickname || md.preferred_username || '', email: u.email || '' } });
  }
  function setLocalName(n) { var a = store.get(K.auth, null); if (a && a.user) { a.user.name = n; store.set(K.auth, a); } }
  function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20); }
  function naverName(pt) {               // 네이버는 로그인만으로 이름이 안 와서, 로그인 직후 네이버에서 별명·이름을 한 번 받아 둠
    var x = session();
    if (!x || !pt || x.user.provider !== 'custom:naver') return Promise.resolve('');
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/naver-profile', { method: 'POST',
      headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + x.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ t: pt }) })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { var n = cleanName(j && j.name); if (n) { setLocalName(n); store.del(K.nvre); } else if (j && j.why === 'no_profile') store.set(K.nvre, true); return n; })
      .catch(function () { return ''; });
  }
  function saveName(n) {                 // 내가 직접 정한 이름 (계정 정보에만 저장)
    return freshToken().then(function (tok) {
      if (!tok) throw new Error('signed out');
      return fetch(authBase() + '/user', { method: 'PUT', headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { name: n } }) });
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); setLocalName(n); });
  }
  function authPost(path, body) {
    return fetch(authBase() + path, { method: 'POST', headers: { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error_description || j.msg || j.error || ('HTTP ' + r.status)); return j; }); });
  }
  function freshToken() {                  // 만료 1분 전이면 새로 받음
    var x = session();
    if (!x) return Promise.resolve(null);
    if (x.expires_at - 60 > Date.now() / 1000) return Promise.resolve(x.access_token);
    return authPost('/token?grant_type=refresh_token', { refresh_token: x.refresh_token }).then(function (t) { saveSession(t); return t.access_token; })
      .catch(function () { store.del(K.auth); render(); return null; });
  }
  function userRest(method, path, body, extra) {
    return freshToken().then(function (tok) {
      if (!tok) throw new Error('signed out');
      var h = { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
      for (var k in (extra || {})) h[k] = extra[k];
      return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + path, { method: method, headers: h, body: body == null ? undefined : JSON.stringify(body) })
        .then(function (r) {                // 저장은 내용 없이 200/201/204로 올 수 있음 → 빈 응답도 성공
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text().then(function (t) { if (!t) return null; try { return JSON.parse(t); } catch (_) { return null; } });
        });
    });
  }
  function localBlob() { var d = {}; SYNC_KEYS.forEach(function (k) { var v = store.get(k, undefined); if (v !== undefined) d[k] = v; }); return d; }
  function mergeById(a, b) {             // 같은 id는 이 휴대폰 쪽을 남기고 합침
    var seen = {}, out = [];
    (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []).forEach(function (x) { if (x && x.id != null && !seen[x.id]) { seen[x.id] = 1; out.push(x); } });
    return out;
  }
  var pushTimer = null, syncing = false;
  function pushNow() {
    var x = session();
    if (!x || !LIVE) return Promise.resolve();
    clearTimeout(pushTimer);
    var at = new Date().toISOString();
    return userRest('POST', 'user_data?on_conflict=user_id', { user_id: x.user.id, data: localBlob(), updated_at: at }, { Prefer: 'resolution=merge-duplicates,return=minimal' })
      .then(function () { var sy = store.get(K.sync, {}) || {}; sy.pushed = at; sy.uid = x.user.id; localStorage.setItem(K.sync, JSON.stringify(sy)); S.syncErr = false; })
      .catch(function () { S.syncErr = true; });
  }
  onSet = function (k) {
    if (syncing || SYNC_KEYS.indexOf(k) < 0 || !session()) return;
    clearTimeout(pushTimer); pushTimer = setTimeout(function () { pushNow().then(function () { if (route().p === 'settings') render(); }); }, 1500);
  };
  function pullAndMerge(first) {         // 처음 로그인: 합치기 / 그다음: 서버가 더 최근이면 서버 기록으로
    var x = session();
    if (!x) return Promise.resolve();
    return userRest('GET', 'user_data?select=data,updated_at&user_id=eq.' + encodeURIComponent(x.user.id)).then(function (rows) {
      var row = rows && rows[0], sy = store.get(K.sync, {}) || {};
      if (!row) return pushNow();
      var d = row.data || {}, mine = sy.uid === x.user.id && sy.pushed;
      syncing = true;
      try {
        if (first || !mine) {
          store.set(K.hold, mergeById(store.get(K.hold, []), d[K.hold]));
          [K.prefs, K.hind, K.broker, K.theme].forEach(function (k) { if (d[k] !== undefined && store.get(k, undefined) === undefined) store.set(k, d[k]); });
        } else if (row.updated_at > sy.pushed) {
          SYNC_KEYS.forEach(function (k) { if (d[k] !== undefined) store.set(k, d[k]); });
        }
      } finally { syncing = false; }
      applyTheme(); S.han = null;
      return (first || !mine || row.updated_at <= sy.pushed) ? pushNow() : (function () { var s2 = store.get(K.sync, {}) || {}; s2.pushed = row.updated_at; s2.uid = x.user.id; localStorage.setItem(K.sync, JSON.stringify(s2)); })();
    }).catch(function () { S.syncErr = true; });
  }
  function handleAuthReturn() {          // 로그인 화면에서 돌아온 경우
    var q = new URLSearchParams(location.search), code = q.get('code'), err = q.get('error_description') || q.get('error');
    if (!code && !err) return;
    var pk = store.get(K.pkce, null), back = (pk && pk.back) || '#/settings';
    history.replaceState(null, '', location.pathname + back);
    store.del(K.pkce);
    if (err) { setTimeout(function () { toast('로그인하지 못했어요: ' + String(err).slice(0, 60)); }, 600); return; }
    if (!pk || Date.now() - pk.at > 15 * 60000) { setTimeout(function () { toast('로그인 시간이 지났어요. 다시 해 주세요'); }, 600); return; }
    S.authBusy = true;
    authPost('/token?grant_type=pkce', { auth_code: code, code_verifier: pk.v }).then(function (t) {
      saveSession(t);
      var x = session();
      if (x && x.user.provider === 'custom:naver' && !x.user.name && t.provider_token) naverName(t.provider_token).then(function (n) {
        if (n) { if (route().p === 'settings') render(); return; }
        if (store.get(K.nvre, false)) setTimeout(function () {     // 예전에 별명 없이 동의한 경우: 바로 다시 동의받기
          toast('네이버에서 별명을 받지 못했어요', { action: '다시 동의', onAction: function () { signIn('naver'); } });
        }, 900);
      });
      return pullAndMerge(true);
    }).then(function () { S.authBusy = false; S.agreedNow = S.agreedNow || store.get(K.consent, false); toast('로그인했어요. 기록이 계정에 저장돼요'); render(); loginLog('login'); })
      .catch(function () { S.authBusy = false; store.del(K.auth); toast('로그인하지 못했어요. 잠시 뒤 다시 해 주세요'); render(); });
  }
  function devClass() { var u = navigator.userAgent || ''; return /Android/i.test(u) ? 'android' : /iPhone|iPad|iPod/i.test(u) ? 'ios' : 'pc'; }
  function loginLog(kind) {               // 로그인 · 하루 한 번 앱 열기 기록 (90일 보관, 개발자 화면에서만 봄)
    if (!LIVE || !session()) return;
    if (kind === 'open' && Date.now() - (+store.get(K.lping, 0) || 0) < 12 * 36e5) return;
    store.set(K.lping, Date.now());
    rpcAs('app_login_log', { p_dev: devClass(), p_kind: kind }).catch(function () {});
  }
  function signOut(wipe) {
    var x = session();
    if (x) fetch(authBase() + '/logout', { method: 'POST', headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + x.access_token } }).catch(function () {});
    store.del(K.auth); store.del(K.sync);
    if (wipe) { syncing = true; store.del(K.hold); syncing = false; S.han = null; }
    render();
  }
  function deleteAccount() {
    S.authBusy = true; render();
    freshToken().then(function (tok) {
      return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/app_delete_me', { method: 'POST', headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
    }).then(function () { S.authBusy = false; S.delAcct = 0; store.del(K.auth); store.del(K.sync); toast('계정과 저장된 기록을 지웠어요. 이 휴대폰의 기록은 남아 있어요'); render(); })
      .catch(function () { S.authBusy = false; toast('지우지 못했어요. 잠시 뒤 다시 해 주세요'); render(); });
  }
  function accountCard() {
    var x = session();
    if (!x) {
      return '<section class="card"><h2 style="font-size:15px">내 기록 저장 <small class="small">선택</small></h2>' +
        '<p class="small" style="margin:6px 0 10px">로그인하면 보유 종목과 설정이 계정에 저장돼서, 휴대폰을 바꾸거나 앱을 다시 깔아도 그대로예요. 로그인 없이도 모든 기능을 쓸 수 있어요.</p>' +
        '<div class="logins"><button class="lg-kakao" data-act="login" data-v="kakao"' + (S.authBusy ? ' disabled' : '') + '>카카오로 시작</button>' +
        '<button class="lg-naver" data-act="login" data-v="naver"' + (S.authBusy ? ' disabled' : '') + '>네이버로 시작</button>' +
        '<button class="lg-google" data-act="login" data-v="google"' + (S.authBusy ? ' disabled' : '') + '>Google로 시작</button></div>' +
        '<p class="small" style="margin:8px 0 0">로그인하면 이름(닉네임)·메일과 보유 종목(수량·평균 단가)이 계정과 함께 서버에 저장되고, 로그인 기록(시각·방식·기기 종류)이 90일 동안 남아요. 운영자는 운영과 문의 대응을 위해 계정 이름·가린 메일·로그인 기록·보유 종목을 볼 수 있어요. 전화번호는 받지 않아요.</p></section>';
    }
    var sy = store.get(K.sync, {}) || {}, pv = { kakao: '카카오', google: 'Google', 'custom:naver': '네이버' }[x.user.provider] || x.user.provider || '';
    var del = '계정과 저장된 기록 지우기';
    return '<section class="card"><h2 style="font-size:15px">내 기록 저장</h2>' +
      '<div class="line"><span>' + esc(pv) + '로 로그인</span><b>' + esc(x.user.name || x.user.email || '이름 없음') +
        ' <button type="button" class="namebtn" data-act="setname">' + (x.user.name ? '바꾸기' : '이름 정하기') + '</button></b></div>' +
      '<div class="line"><span>마지막 저장</span><b>' + (S.syncErr ? '<span class="blue">저장 실패 · 다시 시도해요</span>' : sy.pushed ? since(sy.pushed) : '-') + '</b></div>' +
      '<div class="two" style="margin-top:8px"><button class="btn ghost" data-act="syncnow">지금 저장</button><button class="btn ghost" data-act="signout">로그아웃</button></div>' +
      '<button class="btn ghost" style="margin-top:8px;color:var(--red-ink)" data-act="delacct"' + (S.authBusy ? ' disabled' : '') + '>' + del + '</button>' +
      '<p class="small" style="margin:8px 0 0">로그아웃해도 이 휴대폰의 기록은 남아요. 계정을 지우면 서버에 저장된 기록이 바로 지워져요.</p></section>';
  }

  try { localStorage.removeItem('tn_journal'); } catch (_) {}     // 내 매매일지 기능을 없앰
  if (session() && store.get(K.consent, false)) S.agreedNow = true;   // 로그인한 사람은 이미 동의했으니 여는 때마다 다시 묻지 않음
  handleAuthReturn();
  setTimeout(function () { loadWall(false); }, 3000);
  setTimeout(function () { loadFbMine(false, false); }, 2500);
  if (session()) setTimeout(function () { pullAndMerge(false).then(function () { if (route().p === 'hold' || route().p === 'settings') render(); }); loginLog('open'); }, 1500);
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
