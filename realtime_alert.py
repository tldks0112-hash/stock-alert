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
#  5) 손실 방지 장치 (기본은 전부 켬, 비밀값의 "손실_방지"로 끄고 켤 수 있어요)
#     - 시장 필터: 시장 전체(S&P500·KODEX200·비트코인)가 200일선 아래면 매수 알림 안 함
#     - 추세 필수: 그 종목이 200일선 위 + 50일선이 200일선 위일 때만 매수
#     - 눌림 매수: 오르는 종목이 최근 20일선까지 쉬었다가 다시 오를 때만 매수 (이미 많이 오른 뒤엔 X)
#     - 반 매도: 안전 매도가에서 절반 팔고, 나머지는 손절가를 매수가로 올려 큰 상승을 따라감
#     - 하루 한번: 같은 종목 매수 알림은 하루 한 번만
#     - 변동성 필터: 종목이 평소보다 심하게 출렁일 때(1년 중 상위 20%)는 매수 알림 안 함
#     - 성적표: 지난 2년 그 종목의 알림대로 (같은 파는 방법으로) 거래했을 때 평균 수익이 나고(+0.3% 이상)
#               번 돈이 잃은 돈의 1.2배 이상이었던 종목만 매수 알림. 손실 났던 종목은 추천도 안 함
#               (종목 기록이 6번 미만이면 같은 시장 전체 기록으로 판단, 하루 한 번 자동 갱신)
#     - 실적 피하기: 미장 개별주는 실적 발표 10일 전부터 매수 알림 안 함 (발표 다음 날 갭으로 손절이 소용없어서)
#     - 자동 멈춤: 보낸 매수 알림을 실제로 샀다고 치고 1분봉으로 계속 따라가서(점검 작업과 같은 규칙),
#                 3번 연속 손실이면 그 시장 매수 알림을 5일 쉬고 카톡으로 알려줌. 월요일 아침엔 지난주 실전 성적
#  6) 손절 금액 고정: 손절가에 걸려도 정한 금액(기본: 종목 예산의 3%) 이상 안 잃도록 수량을 계산해서 알려줘요.

import hashlib
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
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
MAX_LOSS_USD = float(S.get("손절_최대손실_달러", round(BUDGET_USD * 0.03, 2)))        # 손절 한 번에 최대 손실
MAX_LOSS_KRW = float(S.get("손절_최대손실_원", max(1000, round(BUDGET_KRW * 0.03, -3))))
_SCORE = S.get("안전도_기준", 8)             # 숫자 하나, 또는 {"국장": 8, "미장": 9, "코인": 8}
MIN_SCORE = _SCORE if isinstance(_SCORE, int) else 8     # 안전도 10점 중 몇 점 이상일 때만 알림
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
MARKET_KO = {"kr": "국장", "us": "미장", "crypto": "코인"}
INDEX = {"kr": "069500.KS", "us": "SPY", "crypto": "BTC-KRW"}           # 시장 필터에 쓰는 대표 지수
GUARD_DEFAULT = {"시장_필터": True, "추세_필수": True, "눌림_매수": True, "변동성_필터": True,
                 "실적_피하기": True, "반_매도": True, "하루_한번": True, "성적표": True, "자동_멈춤": True}
TRAIL_ATR = 2.0                                                         # 반 매도 후 나머지: 고점에서 ATR 2배 빠지면 매도
STATE_DIR = ".alert_state"
STATE_FILE = os.path.join(STATE_DIR, "sent.json")
CARD_FILE = os.path.join(STATE_DIR, "card.json")
CARD_MIN_T, CARD_MIN_M = 6, 15        # 성적표: 종목 기록 최소 6번, 모자라면 시장 전체 기록 최소 15번
CARD_AVG, CARD_PF = 0.3, 1.2          # 평균 +0.3% 이상 · 번 돈이 잃은 돈의 1.2배 이상
CARD_HOURS = 20                       # 성적표를 몇 시간마다 새로 만들지
EARN_DAYS = 10                        # 실적 발표 며칠 전부터 매수 알림을 쉴지
TRADES_FILE = os.path.join(STATE_DIR, "trades.json")
PAUSE_LOSSES, PAUSE_DAYS = 3, 5       # 실전 알림이 3번 연속 손실이면 그 시장 매수 알림 5일 쉼
FILL_BARS_H, HOLD_DAYS, RUN_DAYS = 16, 14, 60   # 매수가 기다리는 시간(1시간봉 16개) · 1차 보유 14일 · 나머지 최대 60일
FEE = 0.002                           # 사고팔 때 수수료·세금 합계


def log(msg):
    if VERBOSE:
        print(msg)


def min_score(market):
    if isinstance(_SCORE, dict):
        return int(_SCORE.get(MARKET_KO[market], 8))
    return int(_SCORE)


def guard_on(market, name):
    """손실 방지 장치가 켜져 있는지. {"손실_방지": {"눌림_매수": false}} 또는 시장별 {"미장": {...}}"""
    g = S.get("손실_방지", {})
    if isinstance(g.get(MARKET_KO[market]), dict):
        g = {**g, **g[MARKET_KO[market]]}
    return bool(g.get(name, GUARD_DEFAULT[name]))


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
    df["RSI2"] = rsi(c, 2)
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
    df["ATRP"] = df["ATR"] / c
    df["ATRP80"] = df["ATRP"].rolling(252, min_periods=120).quantile(0.8)      # 1년 중 상위 20% 변동폭
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


# ---------- 손실 방지 장치 ----------

def closed_days(d, market, now):
    """오늘 아직 안 끝난 일봉은 빼고 (어제까지)"""
    tz = TZ[market]
    dates = d.index.tz_convert(tz).date if d.index.tz is not None else d.index.date
    return d[dates < now.astimezone(tz).date()]


def market_ok(market, idx_daily, now):
    """시장 필터: 대표 지수의 어제 종가가 200일선 위면 OK. 데이터를 못 받으면 막지 않음"""
    if idx_daily is None:
        return True
    d = closed_days(add_daily(idx_daily), market, now)
    if len(d) < 210 or not np.isfinite(d["MA200"].iloc[-1]):
        return True
    return bool(d["Close"].iloc[-1] > d["MA200"].iloc[-1])


def guard_flags(d, price, mkt_ok, earn_ok=True):
    """매수 전에 보는 것: 시장 · 추세 · 눌림 · 변동성 · 실적"""
    t, recent = d.iloc[-1], d.iloc[-5:]
    trend = bool(t["Close"] > t["MA200"] and t["MA50"] > t["MA200"])
    dipped = bool((recent["Low"] <= recent["MA20"] * 1.01).any() or (d["RSI2"].iloc[-3:] < 15).any())
    not_run = bool(price <= t["MA20"] + t["ATR"])
    calm = not (np.isfinite(t["ATRP80"]) and t["ATRP"] > t["ATRP80"])
    return {"시장": bool(mkt_ok), "추세": trend, "눌림": dipped and not_run, "변동성": bool(calm),
            "실적": bool(earn_ok)}


GUARD_KEY = {"시장": "시장_필터", "추세": "추세_필수", "눌림": "눌림_매수", "변동성": "변동성_필터",
             "실적": "실적_피하기"}
GUARD_WHY = {"시장": "시장 하락장", "추세": "종목 추세 약함", "눌림": "눌림 아님(이미 오름)",
             "변동성": "변동성 너무 큼", "실적": "실적 발표 임박"}


def guard_block(market, flags):
    """켜진 장치 중 통과 못 한 것"""
    return [GUARD_WHY[k] for k, ok in flags.items() if guard_on(market, GUARD_KEY[k]) and not ok]


def earnings_dates(t):
    """실적 발표일 목록 (지난 몇 년 + 예정, 'YYYY-MM-DD'). 미장 개별주만 있고, 못 받으면 빈 목록 → 막지 않음"""
    days = set()
    try:
        tk = yf.Ticker(t)
        with base.quiet():
            try:
                df = tk.get_earnings_dates(limit=16)
            except Exception:
                df = None
            if df is not None and len(df):
                for x in df.index:
                    days.add(pd.Timestamp(x).date().isoformat())
            if not days:
                cal = tk.calendar
                vals = []
                if isinstance(cal, dict):
                    vals = cal.get("Earnings Date", [])
                elif cal is not None and hasattr(cal, "loc"):
                    try:
                        vals = list(cal.loc["Earnings Date"])
                    except Exception:
                        vals = []
                for x in (vals if isinstance(vals, (list, tuple)) else [vals]):
                    try:
                        days.add(pd.Timestamp(x).date().isoformat())
                    except Exception:
                        pass
    except Exception:
        pass
    return sorted(days)


def earn_near(dates, day):
    """day부터 EARN_DAYS일 안에 실적 발표가 있으면 True"""
    for s_ in dates or []:
        try:
            gap = (date.fromisoformat(s_) - day).days
        except ValueError:
            continue
        if 0 <= gap <= EARN_DAYS:
            return True
    return False


# ---------- 성적표 (과거에 수익 난 자리만) ----------

def hid(t):
    """기록 파일에는 종목 이름 대신 알아볼 수 없는 짧은 코드로 저장"""
    return hashlib.sha1(("sa|" + t).encode()).hexdigest()[:10]


def card_stats(rets):
    if not len(rets):
        return None
    r = np.asarray(rets, float)
    gain, loss = r[r > 0].sum(), -r[r <= 0].sum()
    return {"n": int(len(r)), "win": float((r > 0).mean() * 100), "avg": float(r.mean() * 100),
            "pf": float(gain / loss) if loss > 0 else 99.0}


def card_judge(t_stats, m_stats):
    """(통과?, 쓴 기록, 막은 이유) — 종목 기록이 충분하면 그걸로, 아니면 같은 시장 전체 기록으로"""
    if t_stats and t_stats["n"] >= CARD_MIN_T:
        s, src = t_stats, "종목"
    elif m_stats and m_stats["n"] >= CARD_MIN_M:
        s, src = m_stats, "시장"
    else:
        return False, None, "과거 기록 부족"
    ok = s["avg"] >= CARD_AVG and s["pf"] >= CARD_PF
    return ok, {**s, "src": src}, None if ok else "과거 이 종목 알림 손실"


def rule_sig():
    """설정(종목·기준·장치)이 바뀌면 성적표를 새로 만들기 위한 표시"""
    parts = {mk: [min_score(mk), [guard_on(mk, g) for g in GUARD_DEFAULT if g != "성적표"],
                  sorted(t for grp in cats.values() for t in grp)] for mk, cats in MARKETS.items()}
    return hashlib.sha1(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:12]


def _age(card, key, now):
    try:
        return now - datetime.fromisoformat(card[key])
    except (KeyError, TypeError, ValueError):
        return timedelta(days=999)


def ensure_card(now):
    """성적표가 없거나 오래됐으면 지난 2년 데이터로 새로 만듦 (하루 한 번쯤, 1~2분 걸림)"""
    if not any(cats and (guard_on(mk, "성적표") or (mk == "us" and guard_on(mk, "실적_피하기")))
               for mk, cats in MARKETS.items()):
        return None
    try:
        with open(CARD_FILE, encoding="utf-8") as f:
            card = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        card = {}
    sig = rule_sig()
    usable = card if card.get("sig") == sig else None
    if usable and _age(card, "made", now) < timedelta(hours=CARD_HOURS):
        return usable
    if card.get("tried_sig") == sig and _age(card, "tried", now) < timedelta(hours=1):
        return usable                                   # 방금 실패했으면 1시간 뒤 다시
    try:
        import backtest_check                           # 점검 작업과 똑같은 계산을 씀
        new = backtest_check.make_card()
        new.update(sig=sig, made=now.isoformat())
        card = new
        log("성적표 새로 만듦")
    except Exception as e:
        log(f"성적표 만들기 실패 ({e})")
        card.update(tried=now.isoformat(), tried_sig=sig)
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(CARD_FILE, "w", encoding="utf-8") as f:
        json.dump(card, f, ensure_ascii=False)
    return card if card.get("sig") == sig else None


def card_check(card, market, t):
    mc = (card or {}).get("markets", {}).get(market, {})
    return card_judge(mc.get("tickers", {}).get(hid(t)), mc.get("pool"))


# ---------- 메시지 ----------

def u16len(s):
    return len(s.encode("utf-16-le")) // 2      # 카톡이 이모지를 2글자로 세도 200자를 안 넘게

def money(market, x):
    if market == "us":
        return f"${x:,.2f}"
    return f"{x:,.0f}원" if x >= 100 else f"{x:,.2f}원"


def position(market, buy, stop):
    """예산 안에서, 손절가에 걸려도 정한 금액(손절_최대손실) 넘게 안 잃는 수량 → (설명, 손절 시 손실액)"""
    risk = max(buy - stop, 1e-9)
    if market == "us":
        amt = min(BUDGET_USD, MAX_LOSS_USD / risk * buy)          # 살 금액($)
        q = int(amt // buy)
        if q >= 1:
            return f"{q}주", q * risk
        return f"${amt:,.0f}어치(소수점)", amt / buy * risk
    if market == "kr":
        if BUDGET_KRW < buy:
            return "예산 부족", 0.0
        q = int(min(BUDGET_KRW // buy, MAX_LOSS_KRW // risk))
        return (f"{q}주", q * risk) if q >= 1 else ("손절폭 큼", 0.0)
    amt = min(BUDGET_KRW, MAX_LOSS_KRW / risk * buy)
    amt = amt // 10000 * 10000 if amt >= 10000 else amt // 1000 * 1000
    if amt <= 0:
        return "손절폭 큼", 0.0
    return (f"{amt / 10000:,.0f}만원어치" if amt >= 10000 else f"{amt:,.0f}원어치"), amt / buy * risk


def label(market, ticker, names):
    return f"{names[ticker]} {ticker}" if market == "us" else names[ticker]


def build_message(market, category, ticker, names, side, trig, score, checks, lv, hist=None, rebuy=True):
    when = trig["time"].astimezone(KST).strftime("%H:%M")
    p = lv["price"]
    head = "🔴 매수" if side == "buy" else "🔵 매도"
    why = trig["reasons"][0] + (" 외" if len(trig["reasons"]) > 1 else "")
    lines = [f"{head} · {label(market, ticker, names)} ({score}/10)",
             f"{MARKET_NAME[market]} › {category} · {when} {why}"]
    if side == "buy":
        if hist:
            where = "" if hist["src"] == "종목" else f"({MARKET_KO[market]})"
            lines.append(f"📈 과거{where} {hist['n']}번 승률{hist['win']:.0f}% 평균{hist['avg']:+.1f}%")
        gap = (p / lv["buy"] - 1) * 100
        qty, loss = position(market, lv["buy"], lv["stop"])
        lines += [f"🔴 안전 매수가 {money(market, lv['buy'])} · {qty}" + (f" ({gap:.1f}% 위 대기)" if gap > 1 else " (지금 가능)"),
                  f"⛔ 손절가 {money(market, lv['stop'])}" + (f" → -{money(market, loss)}" if loss > 0 else "")]
        if guard_on(market, "반_매도"):
            trail = money(market, tick_round(market, TRAIL_ATR * lv["atr"]))
            lines += [f"🔵 {money(market, lv['sell'])}에서 절반 매도",
                      f"남은 절반: ⛔→매수가, 고점-{trail}면 매도"]
        else:
            lines += [f"🔵 안전 매도가 {money(market, lv['sell'])} (손익비 {lv['rr']:.1f})"]
    else:
        res = lv["res"] if lv["res"] else p
        lines += [f"현재가 {money(market, p)}",
                  f"🔵 안전 매도가 {money(market, res)} (반등 시)",
                  f"🔴 재매수 안전가 {money(market, lv['buy'])}" if rebuy else "재매수는 🔴 매수 알림 올 때만",
                  "보유 중이면 지금 또는 반등 때 매도"]
    optional = [f"현재가 {money(market, p)}"] if side == "buy" else []   # 200자를 넘으면 아래쪽 줄부터 뺌
    if market == "kr":
        optional.append("⚠️ 국장 시세 지연 가능")
    missed = [n for n, ok in checks if not ok]
    if missed:
        optional.append("부족: " + ", ".join(missed))
    while optional and u16len("\n".join(lines + optional)) > 200:
        optional.pop()
    text = "\n".join(lines + optional)
    while u16len(text) > 200:                 # 그래도 길면 끝에서부터 자름 (이모지가 깨지지 않게)
        text = text[:-1]
    return text


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


def in_cooldown(state, key, now, market=None, once_a_day=False):
    try:
        last = datetime.fromisoformat(state[key])
    except (KeyError, TypeError, ValueError):
        return False
    if now - last < timedelta(minutes=COOLDOWN_MIN):
        return True
    if once_a_day:                                   # 하루 한번: 같은 날(현지 기준, 코인은 한국 날짜)이면 막음
        tz = KST if market == "crypto" else TZ[market]
        return last.astimezone(tz).date() == now.astimezone(tz).date()
    return False


# ---------- 실전 기록 (보낸 매수 알림을 실제로 샀다고 치고 따라가기) ----------
# 점검 작업의 모의투자(backtest_check.simulate_buys)와 똑같은 규칙을 1분봉에 적용해요.
#  wait: 안전 매수가까지 내려오길 기다림 (1시간봉 16개 = 960분 안에 안 오면 없던 일)
#  p1  : 손절가 / 안전 매도가 / 14일 중 먼저 오는 것
#  p2  : (반 매도) 절반 판 뒤 나머지는 손절을 매수가로 올리고 고점-ATR×2 에서 매도 (최대 60일)

def load_book():
    try:
        with open(TRADES_FILE, encoding="utf-8") as f:
            book = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        book = {}
    book = {"open": book.get("open", []), "closed": book.get("closed", []), "flags": book.get("flags", {})}
    for tr in book["open"]:
        for k in ("ta", "te", "last"):
            if tr.get(k):
                tr[k] = pd.Timestamp(tr[k])
    for c in book["closed"]:
        c["tx"] = pd.Timestamp(c["tx"])
    return book


def save_book(book, now):
    def enc(row):
        return {k: (v.isoformat() if isinstance(v, (pd.Timestamp, datetime)) else v) for k, v in row.items()}
    cut = pd.Timestamp(now) - pd.Timedelta(days=120)
    out = {"open": [enc(tr) for tr in book["open"]],
           "closed": [enc(c) for c in book["closed"] if c["tx"] >= cut][-300:],
           "flags": book["flags"]}
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(TRADES_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f)


def track_start(book, market, t, lv, last_bar, now):
    book["open"].append({"id": hid(t), "m": market, "ta": pd.Timestamp(now), "last": pd.Timestamp(last_bar),
                         "st": "wait", "seen": 0, "wait": FILL_BARS_H * 60,
                         "buy": float(lv["buy"]), "stop": float(lv["stop"]), "sell": float(lv["sell"]),
                         "atr": float(lv["atr"]), "half": guard_on(market, "반_매도")})


def _done(tr, exit_price):
    first = tr.get("first")
    r = exit_price / tr["entry"] - 1 if first is None else (0.5 * first + 0.5 * exit_price) / tr["entry"] - 1
    tr.update(st="done", ret=r - FEE)


def track_step(tr, ts, o, hi, lo, cl):
    """봉 하나만큼 진행. 끝나면 st가 done(ret 기록) / skip / expired"""
    st = tr["st"]
    if st == "wait":
        tr["seen"] += 1
        if tr["seen"] > tr["wait"]:
            tr["st"] = "expired"
        elif lo <= tr["buy"]:
            entry = min(o, tr["buy"])
            if entry <= tr["stop"]:
                tr["st"] = "skip"                       # 이미 손절가 아래로 열림 → 안 삼
            else:
                tr.update(st="p1", entry=entry, te=ts)
                if lo <= tr["stop"]:                    # 산 봉에서 바로 손절가도 닿으면 손절로 (보수적으로)
                    _done(tr, tr["stop"])
    elif st == "p1":
        if ts > tr["te"] + pd.Timedelta(days=HOLD_DAYS):
            _done(tr, tr["prev"])
        elif lo <= tr["stop"]:
            _done(tr, min(o, tr["stop"]))
        elif hi >= tr["sell"]:
            hit = max(o, tr["sell"])
            if tr["half"]:
                tr.update(st="p2", first=hit, peak=hi)
            else:
                _done(tr, hit)
    elif st == "p2":
        trail = max(tr["entry"], tr["peak"] - TRAIL_ATR * tr["atr"])
        if ts > tr["te"] + pd.Timedelta(days=RUN_DAYS):
            _done(tr, tr["prev"])
        elif lo <= trail:
            _done(tr, min(o, trail))
        else:
            tr["peak"] = max(tr["peak"], hi)
    tr["prev"] = cl


def track_update(book, market, t, m_raw):
    """이번에 받은 1분봉으로 그 종목의 기록을 앞으로 진행"""
    mine = [tr for tr in book["open"] if tr["m"] == market and tr["id"] == hid(t)]
    if not mine or m_raw is None:
        return
    m_raw = m_raw.dropna(subset=["Open", "High", "Low", "Close"])
    for tr in mine:
        new = m_raw[m_raw.index > tr["last"]]
        for ts, (o, hi, lo, cl) in zip(new.index, new[["Open", "High", "Low", "Close"]].to_numpy(float)):
            track_step(tr, ts, o, hi, lo, cl)
            tr["last"] = ts
            if tr["st"] == "done":
                book["closed"].append({"m": market, "tx": ts, "ret": float(tr["ret"])})
            if tr["st"] in ("done", "skip", "expired"):
                break
    book["open"] = [tr for tr in book["open"] if tr["st"] not in ("done", "skip", "expired")]


def pause_until(closed, now):
    """연속 손실 PAUSE_LOSSES번이면 그때부터 PAUSE_DAYS일 멈춤 (멈춘 동안 끝난 거래는 안 셈).
    지금 멈춤 중이면 끝나는 시각, 아니면 None — 점검 작업도 같은 함수를 씀"""
    end, streak = None, 0
    for c in sorted((c for c in closed if c["tx"] < now), key=lambda c: c["tx"]):
        if end is not None and c["tx"] < end:
            continue
        streak = streak + 1 if c["ret"] <= 0 else 0
        if streak >= PAUSE_LOSSES:
            end, streak = c["tx"] + pd.Timedelta(days=PAUSE_DAYS), 0
    return end if end is not None and now < end else None


def pause_notice(market, end):
    return (f"🛑 {MARKET_NAME[market]} 매수 알림 {PAUSE_DAYS}일 쉼\n"
            f"실전 알림이 {PAUSE_LOSSES}번 연속 손실이 났어요.\n"
            f"{end.astimezone(KST):%m/%d %H:%M}에 다시 시작해요.\n"
            "🔵 매도 알림은 계속 와요.")


def weekly_report(book, now):
    """월요일 아침(한국 8시 이후 첫 실행)에 지난주 실전 성적 한 번"""
    k = now.astimezone(KST)
    week = f"{k.isocalendar()[0]}-{k.isocalendar()[1]}"
    if k.weekday() != 0 or k.hour < 8 or book["flags"].get("report") == week:
        return []
    book["flags"]["report"] = week
    since = pd.Timestamp(now) - pd.Timedelta(days=7)
    lines = [f"📒 지난주 실전 알림 성적 ({k - timedelta(days=7):%m/%d}~{k - timedelta(days=1):%m/%d})",
             "알림대로 안전 매수가에 샀다고 치고 계산"]
    for market, cats in MARKETS.items():
        if not cats:
            continue
        xs = [c["ret"] for c in book["closed"] if c["m"] == market and c["tx"] >= since]
        if xs:
            win = sum(r > 0 for r in xs)
            lines.append(f"{MARKET_NAME[market]} {len(xs)}번 · 이익 {win} · 손실 {len(xs) - win}"
                         f" → 100만원씩 {sum(xs) * 100:+.1f}만원")
        else:
            lines.append(f"{MARKET_NAME[market]} 끝난 거래 없음")
    held = sum(tr["st"] in ("p1", "p2") for tr in book["open"])
    waiting = sum(tr["st"] == "wait" for tr in book["open"])
    lines.append(f"보유 중 {held}개 · 매수가 기다리는 중 {waiting}개")
    stopped = [MARKET_KO[mk] for mk in MARKETS
               if guard_on(mk, "자동_멈춤") and pause_until([c for c in book["closed"] if c["m"] == mk],
                                                          pd.Timestamp(now))]
    lines.append("🛑 쉬는 시장: " + ", ".join(stopped) if stopped else "쉬는 시장 없음")
    return base.chunk(lines)


# ---------- 실행 ----------

def scan_market(market, cats, now, force, state, alerts, stats, card=None, book=None, notices=None):
    names = {t: n for group in cats.values() for t, n in group.items()}
    category = {t: c for c, group in cats.items() for t in group}
    tickers = list(names)
    idx = INDEX[market]
    need_idx = guard_on(market, "시장_필터")
    daily = fetch_many(list(dict.fromkeys(tickers + ([idx] if need_idx else []))), "2y", "1d")
    mkt_ok = market_ok(market, daily.get(idx), now) if need_idx else True
    log(f"[{market}] 시장 필터: {'통과' if mkt_ok else '하락장 → 매수 알림 멈춤'}")
    hourly = fetch_many(tickers, "60d", "60m")
    minute = fetch_many(tickers, "2d", "1m")
    paused = False
    if book is not None:
        for t in tickers:
            try:
                track_update(book, market, t, minute.get(t))
            except Exception as e:
                log(f"{t}: 실전 기록 진행 실패 ({e})")
        if guard_on(market, "자동_멈춤"):
            end = pause_until([c for c in book["closed"] if c["m"] == market], pd.Timestamp(now))
            paused = end is not None
            if paused and book["flags"].get(f"pause|{market}") != end.isoformat():
                book["flags"][f"pause|{market}"] = end.isoformat()
                if notices is not None:
                    notices.append(pause_notice(market, end))
            log(f"[{market}] 자동 멈춤: {'쉬는 중' if paused else '아님'}")
    for t in tickers:
        stats["checked"] += 1
        try:
            check_ticker(market, t, names, category, daily, hourly, minute, now, force, state, alerts, mkt_ok, card,
                         paused)
        except Exception as e:
            stats["failed"] += 1
            log(f"{t}: 확인 실패 ({e})")


def check_ticker(market, t, names, category, daily, hourly, minute, now, force, state, alerts, mkt_ok=True,
                 card=None, paused=False):
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

    use_card = guard_on(market, "성적표")
    card_ok, hist, card_why = card_check(card, market, t) if use_card else (True, None, None)
    earn_ok = True
    if market == "us" and guard_on(market, "실적_피하기"):
        earn_ok = not earn_near((card or {}).get("earn", {}).get(hid(t), []), last_time.astimezone(tz).date())
    found = False
    for side in ("buy", "sell"):
        trig = find_trigger(m, side, since, market)
        if not trig:
            continue
        found = True
        checks = safety_checks(side, d, h, m, trig, lv, prev_close)
        score = sum(bool(ok) for _, ok in checks)
        key = f"tajum|{hid(t)}|{side}"
        word = "매수" if side == "buy" else "매도"
        blocked = guard_block(market, guard_flags(d, lv["price"], mkt_ok, earn_ok)) if side == "buy" else []
        if side == "buy" and not card_ok:
            blocked.append(card_why)
        if side == "buy" and paused:
            blocked.append("실전 연속 손실로 쉬는 중")
        if side == "buy" and position(market, lv["buy"], lv["stop"])[0] == "손절폭 큼":
            blocked.append("손절폭이 손실 한도보다 큼")
        once = side == "buy" and guard_on(market, "하루_한번")
        if in_cooldown(state, key, now, market, once):
            log(f"{t}: {word} 타점 (최근에 이미 알림)")
        elif score < min_score(market):
            log(f"{t}: {word} 타점 있지만 안전도 {score}/10 → 알림 안 함")
        elif blocked:
            log(f"{t}: {word} 타점 {score}/10 이지만 손실 방지로 막음 ({', '.join(blocked)})")
        else:
            alerts.append({"key": key, "market": market, "category": category[t], "name": names[t],
                           "side": side, "price": lv["price"], "ticker": t, "lv": lv, "bar": m.index[-1],
                           "msg": build_message(market, category[t], t, names, side, trig, score, checks, lv,
                                                hist, rebuy=card_ok)})
    if not found:
        log(f"{t}: 확정된 타점 없음")


def main():
    force = os.environ.get("FORCE") == "1" or "force" in sys.argv
    if not any(MARKETS.values()):
        sys.exit("❗ 비밀값 ALERT_SETTINGS에 종목이 없어요. 설정 방법을 다시 확인해 주세요.")
    now = datetime.now(timezone.utc)
    state = load_state()
    card = ensure_card(now)
    book = load_book()
    alerts, notices = [], []
    stats = {"markets": 0, "checked": 0, "failed": 0}
    for market, cats in MARKETS.items():
        if not cats:
            continue
        if not is_open(market, now) and not force:
            log(f"[{market}] 장 시간이 아니라 건너뜀")
            continue
        log(f"[{market}] 확인 중...")
        stats["markets"] += 1
        scan_market(market, cats, now, force, state, alerts, stats, card, book, notices)

    # 주인 없는 오래된 기록 정리 (종목을 설정에서 뺀 경우 등)
    old = pd.Timestamp(now) - pd.Timedelta(days=RUN_DAYS + 20)
    book["open"] = [tr for tr in book["open"] if tr["ta"] >= old]
    notices += weekly_report(book, now)

    if alerts or notices:
        token = base.get_access_token()
        for msg in notices:
            base.send_kakao(token, msg)
            time.sleep(1)
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
                if a["side"] == "buy":
                    track_start(book, market, a["ticker"], a["lv"], a["bar"], now)
                log(f"알림 보냄 → {a['key']}")
                time.sleep(1)
    save_state(state, now)
    save_book(book, now)
    # 공개 기록에는 종목 이름 없이 숫자만 남김
    print(f"확인 끝: 시장 {stats['markets']}곳 · 종목 {stats['checked']}개 · 실패 {stats['failed']}개")


if __name__ == "__main__":
    main()
