# 실시간 '안전 타점' 알림 — 미국 주식 · 국내 주식 · 코인
# GitHub Actions가 장중엔 15분마다, 그 밖의 시간(코인)엔 30분마다 실행해요.
#
# 하는 일
#  1) 일봉 · 1시간봉 · 1분봉 세 가지 시간대를 같이 봐요.
#  2) 추세 · 모멘텀 · 변동성 · 거래량 · 지지/저항 다섯 분류의 지표로 '안전도 10점'을 매겨요.
#  3) 지지선·저항선이 여러 개 겹치는 가격을 찾아서 안전 매수가 / 손절가 / 안전 매도가를 알려줘요.
#  4) 남들(다른 자동매매)이 흔드는 가짜 돌파에 덜 걸리도록
#     - 돌파 후 3분 동안 유지될 때만 인정하고
#     - 장 시작 직후·마감 직전의 출렁임은 건너뛰고
#     - 손절가는 지지선 바로 밑이 아니라 변동폭(ATR)만큼 여유를 두고 잡아요.

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yfinance as yf

import signal_alert as base     # 카톡 보내기 기능을 같이 씀

# ======================= 설정 =======================
# 종목·카테고리·금액·기준은 코드에 적지 않고 GitHub 비밀값 ALERT_SETTINGS(JSON)에서 읽어요.
# 저장소를 공개해도 남들은 무엇을, 얼마로, 어떤 기준으로 보는지 알 수 없어요.

S = base.SETTINGS
KR_STOCKS = S.get("국장", {})      # 카테고리 → {종목코드: 이름}
US_STOCKS = S.get("미장", {})
COINS = S.get("코인", {})

BUDGET_USD = S.get("종목당_달러", 100)
BUDGET_KRW = S.get("종목당_원", 100_000)
MIN_SCORE = S.get("안전도_기준", 8)          # 안전도 10점 중 몇 점 이상일 때만 알림
CONFIRM_MIN = S.get("유지_확인_분", 3)        # 돌파 후 몇 분 유지돼야 인정할지
MIN_RR = S.get("최소_손익비", 2.0)
STOP_ATR = S.get("손절_여유_ATR", 0.5)
COOLDOWN_MIN = S.get("같은_알림_간격_분", 120)
LOOKBACK_MIN = 20
VERBOSE = os.environ.get("VERBOSE") == "1"    # 1이면 종목별 자세한 기록 (공개 저장소에선 끄세요)

# ======================= 여기부터는 고칠 필요 없어요 =======================

NY = ZoneInfo("America/New_York")
KST = ZoneInfo("Asia/Seoul")
MARKETS = {"kr": KR_STOCKS, "us": US_STOCKS, "crypto": COINS}          # 카톡도 이 순서로 와요
MARKET_NAME = {"kr": "🇰🇷 국장", "us": "🇺🇸 미장", "crypto": "🪙 코인"}
TZ = {"us": NY, "kr": KST, "crypto": timezone.utc}
STATE_DIR = ".alert_state"
STATE_FILE = os.path.join(STATE_DIR, "sent.json")


def log(msg):
    if VERBOSE:
        print(msg)


# ---------- 시장 시간 ----------

def _hm(ts, market):
    t = ts.astimezone(TZ[market])
    return t.weekday(), t.hour * 60 + t.minute


def is_open(market, now):
    if market == "crypto":
        return True
    wd, hm = _hm(now, market)
    if wd >= 5:
        return False
    return (570 <= hm <= 960) if market == "us" else (540 <= hm <= 930)


def calm_time(market, ts):
    """장 시작 직후 15분, 마감 직전 10분(국장은 동시호가 포함 15분)은 출렁임이 커서 타점으로 안 씀"""
    if market == "crypto":
        return True
    _, hm = _hm(ts, market)
    return (585 <= hm <= 950) if market == "us" else (555 <= hm <= 915)


# ---------- 데이터 ----------

def fetch_many(tickers, period, interval):
    for attempt in range(3):
        try:
            with base.quiet():
                raw = yf.download(tickers, period=period, interval=interval, group_by="ticker",
                                  auto_adjust=True, progress=False, threads=True)
            break
        except Exception as e:
            log(f"데이터 받기 재시도 ({e})")
            time.sleep(5 * (attempt + 1))
    else:
        return {}
    out = {}
    for t in tickers:
        try:
            sub = raw[t] if isinstance(raw.columns, pd.MultiIndex) else raw
        except KeyError:
            continue
        sub = sub.dropna(subset=["Close"])
        if not sub.empty:
            out[t] = sub
    return out


def macd(c):
    line = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    sig = line.ewm(span=9, adjust=False).mean()
    return line, sig


def rsi(c, n=14):
    ch = c.diff()
    gain = ch.clip(lower=0).rolling(n).mean()
    loss = (-ch.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + gain / loss)


def add_daily(df):
    """일봉 지표: 추세(MA·ADX) · 모멘텀(RSI·MACD·스토캐스틱) · 변동성(볼린저·ATR) · 거래량(OBV)"""
    df = df.copy()
    h, l, c, v = df["High"], df["Low"], df["Close"], df["Volume"].fillna(0)
    for n in (20, 50, 200):
        df[f"MA{n}"] = c.rolling(n).mean()
    df["RSI"] = rsi(c)
    df["MACD"], df["MACD_SIG"] = macd(c)
    low14, high14 = l.rolling(14).min(), h.rolling(14).max()
    df["STOCH"] = ((c - low14) / (high14 - low14) * 100).rolling(3).mean()
    std20 = c.rolling(20).std()
    df["BB_UP"], df["BB_LOW"] = df["MA20"] + 2 * std20, df["MA20"] - 2 * std20
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    df["ATR"] = tr.ewm(alpha=1 / 14, adjust=False).mean()
    up, dn = h.diff(), -l.diff()
    plus = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=df.index)
    minus = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=df.index)
    df["PDI"] = 100 * plus.ewm(alpha=1 / 14, adjust=False).mean() / df["ATR"]
    df["MDI"] = 100 * minus.ewm(alpha=1 / 14, adjust=False).mean() / df["ATR"]
    dx = 100 * (df["PDI"] - df["MDI"]).abs() / (df["PDI"] + df["MDI"])
    df["ADX"] = dx.ewm(alpha=1 / 14, adjust=False).mean()
    obv = (np.sign(c.diff()).fillna(0) * v).cumsum()
    df["OBV_UP"] = obv - obv.shift(10)
    return df


def add_hourly(df):
    df = df.copy()
    c = df["Close"]
    df["EMA20"] = c.ewm(span=20, adjust=False).mean()
    df["EMA50"] = c.ewm(span=50, adjust=False).mean()
    line, sig = macd(c)
    df["HIST"] = line - sig
    df["RSI"] = rsi(c)
    return df


def add_minute(m1, market):
    m1 = m1.dropna(subset=["Close"])
    if market == "crypto":
        m1 = m1.iloc[-240:]
    else:
        days = m1.index.tz_convert(TZ[market]).date
        m1 = m1[days == days[-1]]
    if len(m1) < 30:
        return None
    df = m1.copy()
    vol = df["Volume"].fillna(0).clip(lower=0).astype(float)
    tp = (df["High"] + df["Low"] + df["Close"]) / 3
    cum_v = vol.cumsum().replace(0, np.nan)
    df["VWAP"] = ((tp * vol).cumsum() / cum_v).fillna(tp.expanding().mean())
    df["EMA9"] = df["Close"].ewm(span=9, adjust=False).mean()
    df["EMA21"] = df["Close"].ewm(span=21, adjust=False).mean()
    avg = vol.shift(1).rolling(30, min_periods=10).mean()
    df["VOLR"] = (vol / avg).replace([np.inf, -np.inf], np.nan).fillna(0)
    return df


# ---------- 타점 (3분 유지 확인) ----------

def find_trigger(m, side, since, market):
    k, events = CONFIRM_MIN, []
    for i in range(1, len(m) - k + 1):
        j = i + k - 1
        if m.index[j] < since or not calm_time(market, m.index[j]):
            continue
        p, c, seg = m.iloc[i - 1], m.iloc[i], m.iloc[i:j + 1]
        if side == "buy":
            if p["Close"] <= p["VWAP"] and c["Close"] > c["VWAP"] and (seg["Close"] > seg["VWAP"]).all():
                events.append((i, j, "VWAP 돌파"))
            if p["EMA9"] <= p["EMA21"] and c["EMA9"] > c["EMA21"] and (seg["EMA9"] > seg["EMA21"]).all() \
                    and seg["Close"].iloc[-1] > seg["VWAP"].iloc[-1]:
                events.append((i, j, "단기선 상향"))
        else:
            if p["Close"] >= p["VWAP"] and c["Close"] < c["VWAP"] and (seg["Close"] < seg["VWAP"]).all():
                events.append((i, j, "VWAP 이탈"))
            if p["EMA9"] >= p["EMA21"] and c["EMA9"] < c["EMA21"] and (seg["EMA9"] < seg["EMA21"]).all() \
                    and seg["Close"].iloc[-1] < seg["VWAP"].iloc[-1]:
                events.append((i, j, "단기선 하향"))
    if not events:
        return None
    i, j, _ = events[-1]
    reasons = list(dict.fromkeys(r for _, jj, r in events if jj >= j - 3))
    return {"time": m.index[j], "reasons": reasons,
            "volr": float(m["VOLR"].iloc[max(0, i - 1): j + 1].max())}


# ---------- 안전 가격 (지지·저항이 겹치는 곳) ----------

def tick_round(market, x, down=False):
    if market == "us":
        step = 0.01
    elif market == "kr":
        step = next(s for lim, s in [(2000, 1), (5000, 5), (20000, 10), (50000, 50), (200000, 100),
                                      (500000, 500), (float("inf"), 1000)] if x < lim)
    else:
        step = 10 ** max(int(np.floor(np.log10(abs(x)))) - 3, -4) if x > 0 else 1
    f = np.floor if down else np.round
    return round(float(f(x / step) * step), 8)


def cluster(levels, price, atr, below):
    """price 아래(또는 위)의 지지/저항 후보 중, 가장 가까우면서 여러 개가 겹치는 곳"""
    cands = sorted([x for x in levels if np.isfinite(x) and (x < price * 0.999 if below else x > price * 1.001)],
                   reverse=below)
    if not cands:
        return None
    tol = 0.3 * atr
    groups = []
    for x in cands:
        members = [y for y in cands if abs(y - x) <= tol]
        groups.append((x, members))
    strong = [g for g in groups if len(g[1]) >= 2]
    x, members = strong[0] if strong else groups[0]
    return {"price": float(np.mean(members)), "edge": float(min(members) if below else max(members)),
            "n": len(members)}


def safe_levels(market, d, h, m, same_day):
    prior = d.iloc[:-1] if same_day else d
    pv = prior.iloc[-1]
    P = (pv["High"] + pv["Low"] + pv["Close"]) / 3
    rng = pv["High"] - pv["Low"]
    t, price, atr = d.iloc[-1], float(m["Close"].iloc[-1]), float(d["ATR"].iloc[-1])
    levels = [P, 2 * P - pv["High"], P - rng, 2 * P - pv["Low"], P + rng,          # 피벗 P·S1·S2·R1·R2
              prior["Low"].iloc[-20:].min(), prior["High"].iloc[-20:].max(),     # 20일 최저·최고
              prior["Low"].iloc[-60:].min(), prior["High"].iloc[-60:].max(),     # 60일 최저·최고
              t["MA20"], t["MA50"], t["MA200"], t["BB_LOW"], t["BB_UP"],          # 이동평균·볼린저
              float(m["VWAP"].iloc[-1])]                                           # 오늘 평균 체결가
    if h is not None and len(h) >= 24:
        levels += [h["Low"].iloc[-24:].min(), h["High"].iloc[-24:].max()]         # 최근 24시간 최저·최고
    levels = [float(x) for x in levels]

    sup = cluster(levels, price, atr, below=True)
    res = cluster(levels, price, atr, below=False)
    buy = sup["price"] if sup else price - atr
    stop = (sup["edge"] if sup else buy) - STOP_ATR * atr
    risk = max(buy - stop, 1e-9)
    # 안전 매도가: 손익비가 1.5 이상 나오는 첫 저항. 없으면 위험폭의 2배 위
    targets = sorted(x for x in levels if np.isfinite(x) and x > buy + 1.5 * risk)
    near_res = [x for x in targets if any(abs(x - y) <= 0.3 * atr for y in levels if y != x)]
    sell = (near_res or targets or [buy + 2 * risk])[0]
    return {"price": price, "atr": atr,
            "buy": tick_round(market, buy), "buy_n": sup["n"] if sup else 0,
            "stop": tick_round(market, stop, down=True),
            "sell": tick_round(market, sell), "rr": (sell - buy) / risk,
            "res": tick_round(market, res["price"]) if res else None, "res_n": res["n"] if res else 0}


# ---------- 안전도 10점 ----------

def safety_checks(side, d, h, m, trig, lv, prev_close):
    t, last = d.iloc[-1], m.iloc[-1]
    hl = h.iloc[-1] if h is not None and len(h) > 50 else None
    price = lv["price"]
    vol_ok = trig["volr"] >= 1.5 or (t["OBV_UP"] > 0 if side == "buy" else t["OBV_UP"] < 0)
    if side == "buy":
        return [("장기 추세", t["Close"] > t["MA200"]),
                ("정배열", t["MA20"] > t["MA50"]),
                ("추세 강도", t["ADX"] >= 20 and t["PDI"] > t["MDI"]),
                ("MACD", t["MACD"] > t["MACD_SIG"]),
                ("과열 아님", 40 <= t["RSI"] < 68 and t["STOCH"] < 80),
                ("1시간 추세", hl is not None and hl["EMA20"] > hl["EMA50"]),
                ("1시간 모멘텀", hl is not None and hl["HIST"] > 0),
                ("VWAP 위 유지", price > last["VWAP"]),
                ("거래량", vol_ok),
                (f"손익비 {lv['rr']:.1f}", lv["rr"] >= MIN_RR)]
    down_room = (price - lv["buy"]) / max((lv["res"] or price) - price, lv["atr"] * 0.1)
    return [("50일선 아래", t["Close"] < t["MA50"]),
            ("역배열", t["MA20"] < t["MA50"]),
            ("하락 강도", t["ADX"] >= 20 and t["MDI"] > t["PDI"]),
            ("MACD", t["MACD"] < t["MACD_SIG"]),
            ("약세", t["RSI"] < 50 or t["STOCH"] > 80),
            ("1시간 추세", hl is not None and hl["EMA20"] < hl["EMA50"]),
            ("1시간 모멘텀", hl is not None and hl["HIST"] < 0),
            ("VWAP 아래 유지", price < last["VWAP"]),
            ("거래량", vol_ok),
            ("하락 여지", down_room >= 1.5)]


# ---------- 메시지 ----------

def money(market, x):
    if market == "us":
        return f"${x:,.2f}"
    return f"{x:,.0f}원" if x >= 100 else f"{x:,.2f}원"


def size(market, price):
    if market == "us":
        q = int(BUDGET_USD // price)
        return f"{q}주" if q else f"${BUDGET_USD}어치(소수점)"
    if market == "kr":
        q = int(BUDGET_KRW // price)
        return f"{q}주" if q else "예산 부족"
    return f"{BUDGET_KRW // 10000}만원어치"


def label(market, ticker, names):
    return f"{names[ticker]} {ticker}" if market == "us" else names[ticker]


def build_message(market, category, ticker, names, side, trig, score, checks, lv):
    when = trig["time"].astimezone(KST).strftime("%H:%M")
    p = lv["price"]
    head = "🔴 매수 타점" if side == "buy" else "🔵 매도 타점"
    lines = [f"{head} · {label(market, ticker, names)}",
             f"{MARKET_NAME[market]} › {category} · 안전도 {score}/10",
             f"{when} {'+'.join(trig['reasons'])} {CONFIRM_MIN}분 유지",
             f"현재가 {money(market, p)}"]
    if side == "buy":
        gap = (p / lv["buy"] - 1) * 100
        lines += [f"🔴 안전 매수가 {money(market, lv['buy'])} (지지 {lv['buy_n']}개 겹침)",
                  f"⛔ 손절가 {money(market, lv['stop'])}",
                  f"🔵 안전 매도가 {money(market, lv['sell'])} (손익비 {lv['rr']:.1f})",
                  f"{size(market, lv['buy'])}" + (f" · {gap:.1f}% 높음, 눌림 대기" if gap > 1 else " · 지금 매수 가능")]
    else:
        res = lv["res"] if lv["res"] else p
        lines += [f"🔵 안전 매도가 {money(market, res)} (반등 시 저항 {max(lv['res_n'], 1)}개)",
                  f"🔴 재매수 안전가 {money(market, lv['buy'])} (지지 {lv['buy_n']}개 겹침)",
                  "보유 중이면 지금 또는 반등 때 매도"]
    optional = []                         # 200자를 넘으면 아래쪽 줄부터 뺌
    if market == "kr":
        optional.append("⚠️ 국장 시세 지연 가능")
    missed = [n for n, ok in checks if not ok]
    if missed:
        optional.append("부족: " + ", ".join(missed))
    while optional and len("\n".join(lines + optional)) > 200:
        optional.pop()
    return "\n".join(lines + optional)[:200]


def summary_messages(market, items, now):
    """한 번에 같은 시장 알림이 2건 이상이면, 카테고리별로 묶은 요약을 먼저 보냄"""
    lines = [f"{MARKET_NAME[market]} 타점 {len(items)}건 · {now.astimezone(KST):%m/%d %H:%M}"]
    for cat in dict.fromkeys(a["category"] for a in items):
        lines.append(f"[{cat}]")
        for a in (x for x in items if x["category"] == cat):
            word = "🔴 매수" if a["side"] == "buy" else "🔵 매도"
            lines.append(f"{word} {a['name']} {money(market, a['price'])}")
    lines.append("👇 종목별 안전가는 다음 메시지")
    return base.chunk(lines)


# ---------- 알림 기록 ----------

def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state, now):
    os.makedirs(STATE_DIR, exist_ok=True)
    keep = {}
    for k, v in state.items():
        try:
            if now - datetime.fromisoformat(v) < timedelta(days=10):
                keep[k] = v
        except (TypeError, ValueError):
            pass
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(keep, f, ensure_ascii=False)


def in_cooldown(state, key, now):
    try:
        return now - datetime.fromisoformat(state[key]) < timedelta(minutes=COOLDOWN_MIN)
    except (KeyError, TypeError, ValueError):
        return False


# ---------- 실행 ----------

def scan_market(market, cats, now, force, state, alerts, stats):
    names = {t: n for group in cats.values() for t, n in group.items()}
    category = {t: c for c, group in cats.items() for t in group}
    tickers = list(names)
    daily = fetch_many(tickers, "2y", "1d")
    hourly = fetch_many(tickers, "60d", "60m")
    minute = fetch_many(tickers, "2d", "1m")
    for t in tickers:
        stats["checked"] += 1
        try:
            check_ticker(market, t, names, category, daily, hourly, minute, now, force, state, alerts)
        except Exception as e:
            stats["failed"] += 1
            log(f"{t}: 확인 실패 ({e})")


def check_ticker(market, t, names, category, daily, hourly, minute, now, force, state, alerts):
    d, m = daily.get(t), minute.get(t)
    if d is None or len(d) < 220 or m is None:
        log(f"{t}: 데이터 부족 → 건너뜀")
        return
    d, m = add_daily(d), add_minute(m, market)
    h = add_hourly(hourly[t]) if t in hourly else None
    if m is None:
        log(f"{t}: 1분봉 부족 → 건너뜀")
        return
    last_time = m.index[-1].to_pydatetime()
    if not force and now - last_time > timedelta(minutes=45):
        log(f"{t}: 최신 1분봉 없음 (휴장 또는 지연) → 건너뜀")
        return

    tz = TZ[market]
    same_day = d.index[-1].tz_convert(tz).date() == last_time.astimezone(tz).date() \
        if d.index.tz is not None else d.index[-1].date() == last_time.astimezone(tz).date()
    prev_close = float(d["Close"].iloc[-2] if same_day else d["Close"].iloc[-1])
    since = m.index[-1] - pd.Timedelta(minutes=LOOKBACK_MIN)
    lv = safe_levels(market, d, h, m, same_day)

    found = False
    for side in ("buy", "sell"):
        trig = find_trigger(m, side, since, market)
        if not trig:
            continue
        found = True
        checks = safety_checks(side, d, h, m, trig, lv, prev_close)
        score = sum(bool(ok) for _, ok in checks)
        key = f"tajum|{t}|{side}"
        word = "매수" if side == "buy" else "매도"
        if in_cooldown(state, key, now):
            log(f"{t}: {word} 타점 (최근에 이미 알림)")
        elif score < MIN_SCORE:
            log(f"{t}: {word} 타점 있지만 안전도 {score}/10 → 알림 안 함")
        else:
            alerts.append({"key": key, "market": market, "category": category[t], "name": names[t],
                           "side": side, "price": lv["price"],
                           "msg": build_message(market, category[t], t, names, side, trig, score, checks, lv)})
    if not found:
        log(f"{t}: 확정된 타점 없음")


def main():
    force = os.environ.get("FORCE") == "1" or "force" in sys.argv
    if not any(MARKETS.values()):
        sys.exit("❗ 비밀값 ALERT_SETTINGS에 종목이 없어요. 설정 방법을 다시 확인해 주세요.")
    now = datetime.now(timezone.utc)
    state = load_state()
    alerts = []
    stats = {"markets": 0, "checked": 0, "failed": 0}
    for market, cats in MARKETS.items():
        if not cats:
            continue
        if not is_open(market, now) and not force:
            log(f"[{market}] 장 시간이 아니라 건너뜀")
            continue
        log(f"[{market}] 확인 중...")
        stats["markets"] += 1
        scan_market(market, cats, now, force, state, alerts, stats)

    if alerts:
        token = base.get_access_token()
        for market, cats in MARKETS.items():
            order = {c: i for i, c in enumerate(cats)}
            items = sorted((a for a in alerts if a["market"] == market), key=lambda a: order[a["category"]])
            if not items:
                continue
            if len(items) >= 2:
                for msg in summary_messages(market, items, now):
                    base.send_kakao(token, msg)
                    time.sleep(1)
            for a in items:
                base.send_kakao(token, a["msg"])
                state[a["key"]] = now.isoformat()
                log(f"알림 보냄 → {a['key']}")
                time.sleep(1)
    save_state(state, now)
    # 공개 기록에는 종목 이름 없이 숫자만 남김
    print(f"확인 끝: 시장 {stats['markets']}곳 · 종목 {stats['checked']}개 · 실패 {stats['failed']}개")


if __name__ == "__main__":
    main()
