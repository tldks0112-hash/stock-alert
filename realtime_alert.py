# 실시간 타점 알림 — 미국 주식 · 국내 주식 · 코인
# GitHub Actions가 장중엔 15분마다, 그 밖의 시간(코인)엔 30분마다 실행해요.
# 매번 '1분봉'을 다시 훑어서, 그사이 생긴 매수·매도 타점을 분 단위로 찾아내고
# 확실도가 높은 것만 카톡으로 보내요.

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

# ======================= 설정 (여기만 고치면 돼요) =======================

US_STOCKS = {"AAPL": "애플", "MSFT": "마이크로소프트", "NVDA": "엔비디아", "AMZN": "아마존",
             "TSLA": "테슬라", "META": "메타", "GOOGL": "구글", "SPY": "S&P500", "QQQ": "나스닥100"}
KR_STOCKS = {"005930.KS": "삼성전자", "000660.KS": "SK하이닉스", "005380.KS": "현대차",
             "035420.KS": "NAVER", "035720.KS": "카카오", "373220.KS": "LG에너지솔루션",
             "069500.KS": "KODEX 200"}            # 코스닥 종목은 뒤에 .KQ (예: "247540.KQ": "에코프로비엠")
COINS = {"BTC-KRW": "비트코인", "ETH-KRW": "이더리움", "XRP-KRW": "리플", "SOL-KRW": "솔라나"}

BUDGET_USD = 300            # 미국 주식 한 종목에 쓸 돈 ($)
BUDGET_KRW = 400_000        # 국내 주식·코인 한 종목에 쓸 돈 (원)

MIN_SCORE = 6               # 타점 알림: 확실도 8점 중 몇 점 이상일 때만 보낼지 (7~8로 올리면 더 깐깐)
STOP_PCT = 0.03             # 단타 손절폭 3% (목표가는 손절폭의 2배 위)
VOL_SURGE = 2.0             # 1분 거래량이 평소의 몇 배 이상이면 '거래량 급증'
COOLDOWN_MIN = 120          # 같은 종목·같은 방향 타점은 몇 분 동안 다시 안 보낼지
LOOKBACK_MIN = 20           # 최근 몇 분 안에 생긴 타점을 찾을지 (확인 간격보다 조금 넉넉하게)
SWING_ALERTS = True         # 골든크로스 같은 스윙 강한 신호도 받기 (종목·방향별 하루 한 번)

# ======================= 여기부터는 고칠 필요 없어요 =======================

NY = ZoneInfo("America/New_York")
KST = ZoneInfo("Asia/Seoul")
MARKETS = {"us": US_STOCKS, "kr": KR_STOCKS, "crypto": COINS}
TZ = {"us": NY, "kr": KST, "crypto": timezone.utc}
STATE_DIR = ".alert_state"
STATE_FILE = os.path.join(STATE_DIR, "sent.json")


# ---------- 시장 시간 ----------

def is_open(market, now):
    if market == "crypto":
        return True
    t = now.astimezone(TZ[market])
    if t.weekday() >= 5:
        return False
    hm = t.hour * 60 + t.minute
    if market == "us":
        return 9 * 60 + 30 <= hm <= 16 * 60
    return 9 * 60 <= hm <= 15 * 60 + 30


def day_fraction(market, ts):
    """그날 거래시간 중 몇 %가 지났는지 (거래량을 하루치로 환산할 때 씀)"""
    t = ts.astimezone(TZ[market])
    hm = t.hour * 60 + t.minute
    if market == "crypto":
        return max(hm / 1440, 0.01)
    start, length = (9 * 60 + 30, 390) if market == "us" else (9 * 60, 390)
    return min(max((hm - start) / length, 0.01), 1.0)


# ---------- 데이터 ----------

def fetch_many(tickers, period, interval):
    for attempt in range(3):
        try:
            raw = yf.download(tickers, period=period, interval=interval, group_by="ticker",
                              auto_adjust=True, progress=False, threads=True)
            break
        except Exception as e:
            print(f"데이터 받기 재시도 ({e})")
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


def add_daily(df):
    df = df.copy()
    c = df["Close"]
    df["MA20"] = c.rolling(20).mean()
    df["MA50"] = c.rolling(50).mean()
    df["MA200"] = c.rolling(200).mean()
    change = c.diff()
    gain = change.clip(lower=0).rolling(14).mean()
    loss = (-change.clip(upper=0)).rolling(14).mean()
    df["RSI"] = 100 - 100 / (1 + gain / loss)
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    df["MACD"], df["MACD_SIG"] = macd, macd.ewm(span=9, adjust=False).mean()
    df["VOL20"] = df["Volume"].shift(1).rolling(20).mean()
    df["HIGH20"] = df["High"].shift(1).rolling(20).max()
    return df


def add_intraday(m1, market):
    """1분봉에 VWAP(그날 평균 체결가), 단기·중기 이동평균, 거래량 배수를 붙임"""
    m1 = m1.dropna(subset=["Close"])
    if market == "crypto":
        m1 = m1.iloc[-240:]                       # 코인은 최근 4시간
    else:
        local_days = m1.index.tz_convert(TZ[market]).date
        m1 = m1[local_days == local_days[-1]]      # 주식은 그날 장중만
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


# ---------- 타점 찾기 ----------

def find_trigger(m, side, since):
    events = []
    for i in range(1, len(m)):
        if m.index[i] < since:
            continue
        p, c = m.iloc[i - 1], m.iloc[i]
        if side == "buy":
            if p["Close"] <= p["VWAP"] and c["Close"] > c["VWAP"]:
                events.append((i, "VWAP 위로 돌파"))
            if p["EMA9"] <= p["EMA21"] and c["EMA9"] > c["EMA21"] and c["Close"] > c["VWAP"]:
                events.append((i, "1분봉 단기선 상향 돌파"))
        else:
            if p["Close"] >= p["VWAP"] and c["Close"] < c["VWAP"]:
                events.append((i, "VWAP 아래로 이탈"))
            if p["EMA9"] >= p["EMA21"] and c["EMA9"] < c["EMA21"] and c["Close"] < c["VWAP"]:
                events.append((i, "1분봉 단기선 하향 돌파"))
    if not events:
        return None
    i = events[-1][0]
    reasons = list(dict.fromkeys(r for j, r in events if j >= i - 3))
    return {"time": m.index[i], "price": float(m["Close"].iloc[i]), "reasons": reasons,
            "volr": float(m["VOLR"].iloc[max(0, i - 2): i + 1].max())}


def score_setup(side, d, m, trig, prev_close):
    """확실도 8점 = 일봉 4점(큰 흐름) + 1분봉 4점(지금 흐름)"""
    t, last = d.iloc[-1], m.iloc[-1]
    price = float(last["Close"])
    chg = (price / prev_close - 1) * 100 if prev_close else 0.0
    vol = f"거래량 {trig['volr']:.1f}배"
    if side == "buy":
        checks = [("장기 상승", t["Close"] > t["MA200"]), ("정배열", t["MA20"] > t["MA50"]),
                  ("MACD 상승", t["MACD"] > t["MACD_SIG"]), ("RSI 적정", 40 <= t["RSI"] < 70),
                  ("VWAP 위", price > last["VWAP"]), ("1분 단기선 위", last["EMA9"] > last["EMA21"]),
                  (vol, trig["volr"] >= VOL_SURGE), (f"오늘 {chg:+.1f}%", chg > 0)]
    else:
        checks = [("50일선 아래", t["Close"] < t["MA50"]), ("역배열", t["MA20"] < t["MA50"]),
                  ("MACD 하락", t["MACD"] < t["MACD_SIG"]), ("RSI 약세", t["RSI"] < 50),
                  ("VWAP 아래", price < last["VWAP"]), ("1분 단기선 아래", last["EMA9"] < last["EMA21"]),
                  (vol, trig["volr"] >= VOL_SURGE), (f"오늘 {chg:+.1f}%", chg < 0)]
    passed = [name for name, ok in checks if bool(ok)]
    return len(passed), passed


def swing_signals(d, frac):
    """일봉 기준 강한 신호 (골든크로스 등). 장중이면 지금 가격 기준"""
    t, y = d.iloc[-1], d.iloc[-2]
    vol_ratio = (t["Volume"] / frac) / t["VOL20"] if frac >= 0.1 and t["VOL20"] else 0.0
    vol_label = f"거래량 평소 {vol_ratio:.1f}배"
    out = []
    buy = []
    if y["MA20"] <= y["MA50"] and t["MA20"] > t["MA50"]:
        buy.append("골든크로스 발생")
    if y["RSI"] < 30 <= t["RSI"]:
        buy.append("과매도 반등 (RSI 30 회복)")
    if y["Close"] <= y["HIGH20"] and t["Close"] > t["HIGH20"]:
        buy.append("20일 최고가 돌파")
    if buy:
        checks = {"200일선 위": t["Close"] > t["MA200"], "MACD 상승": t["MACD"] > t["MACD_SIG"],
                  vol_label: vol_ratio >= 1.5, "과열 아님": t["RSI"] < 70}
        out.append(("buy", buy, [k for k, v in checks.items() if bool(v)], 3, 4))
    sell = []
    if y["MA20"] >= y["MA50"] and t["MA20"] < t["MA50"]:
        sell.append("데드크로스 발생")
    if y["RSI"] > 70 >= t["RSI"]:
        sell.append("과열 꺾임 (RSI 70 아래로)")
    if y["Close"] >= y["MA50"] and t["Close"] < t["MA50"]:
        sell.append("50일선 이탈")
    if sell:
        checks = {"MACD 하락": t["MACD"] < t["MACD_SIG"], vol_label: vol_ratio >= 1.5,
                  "20일선 아래": t["Close"] < t["MA20"]}
        out.append(("sell", sell, [k for k, v in checks.items() if bool(v)], 2, 3))
    return out


# ---------- 메시지 ----------

def money(market, x):
    return f"${x:,.2f}" if market == "us" else f"{x:,.0f}원"


def size(market, price):
    if market == "us":
        q = int(BUDGET_USD // price)
        return f"{q}주" if q else f"${BUDGET_USD}어치(소수점)"
    if market == "kr":
        q = int(BUDGET_KRW // price)
        return f"{q}주" if q else "1주 가격이 예산보다 커요"
    return f"{BUDGET_KRW:,}원어치"


def label(market, ticker, names):
    name = names[ticker]
    return f"{name} {ticker}" if market == "us" else name


def tajum_message(market, ticker, names, side, trig, score, passed, price):
    buy = side == "buy"
    when = trig["time"].astimezone(KST).strftime("%H:%M")
    lines = [f"🎯 {'매수' if buy else '매도'} 타점 · {label(market, ticker, names)} (확실도 {score}/8)",
             f"{when} {' + '.join(trig['reasons'])}",
             f"현재가 {money(market, price)}"]
    if buy:
        stop = price * (1 - STOP_PCT)
        target = price * (1 + 2 * STOP_PCT)
        lines.append(f"손절 {money(market, stop)} · 목표 {money(market, target)} · {size(market, price)}")
    else:
        lines.append("보유 중이면 매도 검토")
    if market == "kr":
        lines.append("⚠️ 국장 시세는 늦게 들어올 수 있어요")
    lines.append("✔ " + " · ".join(passed))
    return "\n".join(lines)[:200]


def swing_message(market, ticker, names, side, triggers, passed, need, total, price, intraday):
    buy = side == "buy"
    lines = [f"🚨 스윙 {'매수' if buy else '매도'} 신호 · {label(market, ticker, names)}",
             f"현재가 {money(market, price)}"]
    lines += [f"✔ {x}" for x in triggers]
    lines.append(f"✔ {' · '.join(passed)} ({len(passed)}/{total})")
    if buy:
        lines.append(f"손절 {money(market, price * (1 - base.RULE['sl']))} · {size(market, price)}")
    else:
        lines.append("보유 중이면 매도 검토")
    if intraday:
        lines.append("⚠️ 장중 신호라 마감 전에 바뀔 수 있어요")
    return "\n".join(lines)[:200]


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

def scan_market(market, names, now, force, state, alerts):
    tickers = list(names)
    daily = fetch_many(tickers, "2y", "1d")
    minute = fetch_many(tickers, "2d", "1m")
    for t in tickers:
        d, m = daily.get(t), minute.get(t)
        if d is None or len(d) < 60 or m is None:
            print(f"{t}: 데이터 부족 → 건너뜀")
            continue
        d, m = add_daily(d), add_intraday(m, market)
        if m is None:
            print(f"{t}: 1분봉이 부족해요 → 건너뜀")
            continue
        last_time = m.index[-1].to_pydatetime()
        if not force and now - last_time > timedelta(minutes=45):
            print(f"{t}: 최신 1분봉이 없어요 (휴장 또는 지연) → 건너뜀")
            continue

        tz = TZ[market]
        same_day = d.index[-1].tz_convert(tz).date() == last_time.astimezone(tz).date() \
            if d.index.tz is not None else d.index[-1].date() == last_time.astimezone(tz).date()
        prev_close = float(d["Close"].iloc[-2] if same_day else d["Close"].iloc[-1])
        price = float(m["Close"].iloc[-1])
        since = m.index[-1] - pd.Timedelta(minutes=LOOKBACK_MIN)

        found = False
        for side in ("buy", "sell"):
            trig = find_trigger(m, side, since)
            if not trig:
                continue
            found = True
            score, passed = score_setup(side, d, m, trig, prev_close)
            key = f"tajum|{t}|{side}"
            word = "매수" if side == "buy" else "매도"
            if in_cooldown(state, key, now):
                print(f"{t}: {word} 타점 (최근에 이미 알림)")
            elif score < MIN_SCORE:
                print(f"{t}: {word} 타점 있지만 확실도 {score}/8 → 알림 안 함")
            else:
                alerts.append((key, tajum_message(market, t, names, side, trig, score, passed, price)))

        if SWING_ALERTS and same_day:
            frac = day_fraction(market, last_time)
            for side, trg, passed, need, total in swing_signals(d, frac):
                found = True
                key = f"swing|{d.index[-1].date()}|{t}|{side}"
                if key in state or len(passed) < need:
                    continue
                alerts.append((key, swing_message(market, t, names, side, trg, passed, need, total,
                                                  price, is_open(market, now))))
        if not found:
            print(f"{t}: 신호 없음")


def main():
    force = os.environ.get("FORCE") == "1" or "force" in sys.argv
    now = datetime.now(timezone.utc)
    state = load_state()
    alerts = []
    for market, names in MARKETS.items():
        if not names:
            continue
        if not is_open(market, now) and not force:
            print(f"[{market}] 장 시간이 아니라 건너뜀")
            continue
        print(f"[{market}] 확인 중...")
        scan_market(market, names, now, force, state, alerts)

    if alerts:
        token = base.get_access_token()
        for key, msg in alerts:
            base.send_kakao(token, msg)
            state[key] = now.isoformat()
            print(f"알림 보냄 → {key}")
            time.sleep(1)
    else:
        print("지금 보낼 타점이 없어요.")
    save_state(state, now)


if __name__ == "__main__":
    main()
