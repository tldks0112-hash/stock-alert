# 미국 장중 실시간 '강한 신호' 카톡 알림
# GitHub Actions가 미국 정규장 동안 15분마다 실행해요.
# 여러 조건이 한꺼번에 맞는 강한 신호만 골라서, 생기는 즉시 카톡으로 보내요.
# (같은 종목·같은 방향 신호는 하루에 한 번만 보내요)

import json
import os
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import yfinance as yf

import signal_alert as base     # 카톡 보내기, 종목 목록, 예산, 손절 설정을 같이 씀

# ======================= 설정 =======================

TICKERS = base.TICKERS          # 아침 알림과 같은 종목. 따로 하려면 ["AAPL", "TSLA"]처럼 직접 적기
MIN_BUY_SCORE = 3               # 매수: 확인 조건 4개 중 몇 개 이상 맞아야 알림 (4로 올리면 더 깐깐)
MIN_SELL_SCORE = 2              # 매도: 확인 조건 3개 중 몇 개 이상 맞아야 알림
VOLUME_SURGE = 1.5              # 오늘 거래량이 평소의 몇 배 이상이면 '거래량 강함'으로 볼지

# ======================= 여기부터는 고칠 필요 없어요 =======================

NY = ZoneInfo("America/New_York")
KST = ZoneInfo("Asia/Seoul")
STATE_DIR = ".alert_state"
STATE_FILE = os.path.join(STATE_DIR, "sent.json")


def session_fraction(now):
    """정규장(9:30~16:00) 중 몇 %가 지났는지. 장 시간이 아니면 None"""
    if now.weekday() >= 5:
        return None
    minutes = (now.hour * 60 + now.minute) - (9 * 60 + 30)
    if minutes < 0 or minutes > 390:
        return None
    return minutes / 390


def add_indicators(df):
    df = df.copy()
    c = df["Close"]
    df["MA20"] = c.rolling(20).mean()
    df["MA50"] = c.rolling(50).mean()
    df["MA200"] = c.rolling(200).mean()
    change = c.diff()
    gain = change.clip(lower=0).rolling(14).mean()
    loss = (-change.clip(upper=0)).rolling(14).mean()
    df["RSI"] = 100 - 100 / (1 + gain / loss)
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    df["MACD"] = ema12 - ema26
    df["MACD_SIG"] = df["MACD"].ewm(span=9, adjust=False).mean()
    df["VOL20"] = df["Volume"].shift(1).rolling(20).mean()     # 오늘을 뺀 최근 20일 평균 거래량
    df["HIGH20"] = df["High"].shift(1).rolling(20).max()       # 오늘을 뺀 최근 20일 최고가
    return df


def evaluate(df, frac):
    """오늘(장중이면 지금 가격 기준) 생긴 신호와 그 강도를 계산"""
    t, y = df.iloc[-1], df.iloc[-2]

    # 장중이면 지금까지 거래량으로 하루 거래량을 추정. 장 초반 10%(약 40분)는 추정이 부정확해서 안 씀
    if frac is None:
        vol_ratio = t["Volume"] / t["VOL20"]
    elif frac >= 0.1:
        vol_ratio = (t["Volume"] / frac) / t["VOL20"]
    else:
        vol_ratio = 0.0
    vol_label = f"거래량 평소 {vol_ratio:.1f}배"

    signals = []

    buy_triggers = []
    if y["MA20"] <= y["MA50"] and t["MA20"] > t["MA50"]:
        buy_triggers.append("골든크로스 발생 (20일선이 50일선 위로)")
    if y["RSI"] < 30 <= t["RSI"]:
        buy_triggers.append("과매도 반등 (RSI 30 회복)")
    if y["Close"] <= y["HIGH20"] and t["Close"] > t["HIGH20"]:
        buy_triggers.append("20일 최고가 돌파")
    if buy_triggers:
        checks = {"200일선 위": t["Close"] > t["MA200"],
                  "MACD 상승": t["MACD"] > t["MACD_SIG"],
                  vol_label: vol_ratio >= VOLUME_SURGE,
                  "과열 아님": t["RSI"] < 70}
        signals.append(("buy", buy_triggers, checks))

    sell_triggers = []
    if y["MA20"] >= y["MA50"] and t["MA20"] < t["MA50"]:
        sell_triggers.append("데드크로스 발생 (20일선이 50일선 아래로)")
    if y["RSI"] > 70 >= t["RSI"]:
        sell_triggers.append("과열 꺾임 (RSI 70 아래로)")
    if y["Close"] >= y["MA50"] and t["Close"] < t["MA50"]:
        sell_triggers.append("50일선 이탈")
    if sell_triggers:
        checks = {"MACD 하락": t["MACD"] < t["MACD_SIG"],
                  vol_label: vol_ratio >= VOLUME_SURGE,
                  "20일선 아래": t["Close"] < t["MA20"]}
        signals.append(("sell", sell_triggers, checks))

    result = []
    for side, triggers, checks in signals:
        passed = [name for name, ok in checks.items() if bool(ok)]
        result.append({"side": side, "triggers": triggers, "passed": passed,
                       "score": len(passed), "total": len(checks)})
    return result


def format_message(ticker, sig, last, now, frac):
    price = float(last["Close"])
    buy = sig["side"] == "buy"
    if frac is not None:
        when = f"뉴욕 {now:%H:%M} · 한국 {now.astimezone(KST):%H:%M}"
    else:
        when = f"{last.name:%m/%d} 종가"
    lines = [f"🚨 강한 {'매수' if buy else '매도'} 신호 · {ticker}",
             f"현재가 ${price:,.2f} ({when})"]
    lines += [f"✔ {x}" for x in sig["triggers"]]
    lines.append(f"✔ {' · '.join(sig['passed'])} ({sig['score']}/{sig['total']})")
    if buy:
        stop = price * (1 - base.RULE["sl"])
        qty = int(base.BUDGET_PER_STOCK_USD // price)
        how = f"{qty}주" if qty >= 1 else f"${base.BUDGET_PER_STOCK_USD}어치 소수점"
        lines.append(f"손절가 ${stop:,.2f} · {how}")
    else:
        lines.append("보유 중이면 매도를 검토하세요")
    if frac is not None:
        lines.append("⚠️ 장중 신호라 마감 전에 바뀔 수 있어요")
    return "\n".join(lines)[:200]


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state):
    os.makedirs(STATE_DIR, exist_ok=True)
    keep = sorted(state.items(), key=lambda kv: kv[1])[-300:]    # 오래된 기록은 정리
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(dict(keep), f, ensure_ascii=False)


def fetch(ticker):
    for attempt in range(3):
        try:
            df = yf.Ticker(ticker).history(period="2y")
            if df is not None and len(df) >= 210:
                return add_indicators(df)
        except Exception:
            pass
        time.sleep(5 * (attempt + 1))
    return None


def main():
    force = os.environ.get("FORCE") == "1" or "force" in sys.argv
    now = datetime.now(NY)
    frac = session_fraction(now)
    if frac is None and not force:
        print("미국 정규장 시간이 아니라 건너뛰어요.")
        save_state(load_state())
        return

    state = load_state()
    alerts = []     # (기록용 키, 메시지)
    for t in TICKERS:
        df = fetch(t)
        if df is None:
            print(f"{t}: 데이터를 못 받았어요")
            continue
        last = df.iloc[-1]
        bar_day = last.name.date()
        if frac is not None and bar_day != now.date():
            print(f"{t}: 오늘 장중 데이터가 아직 없어요")
            continue
        sigs = evaluate(df, frac)
        if not sigs:
            print(f"{t}: 신호 없음")
        for sig in sigs:
            key = f"{bar_day}|{t}|{sig['side']}"
            need = MIN_BUY_SCORE if sig["side"] == "buy" else MIN_SELL_SCORE
            label = "매수" if sig["side"] == "buy" else "매도"
            if key in state:
                print(f"{t}: {label} 신호 (오늘 이미 알림 보냄)")
            elif sig["score"] < need:
                print(f"{t}: {label} 신호 있지만 약함 {sig['score']}/{sig['total']} → 알림 안 함")
            else:
                alerts.append((key, format_message(t, sig, last, now, frac)))

    if alerts:
        token = base.get_access_token()
        for key, msg in alerts:
            base.send_kakao(token, msg)
            state[key] = now.isoformat()       # 보낸 것만 기록 (실패하면 다음 확인 때 다시 시도)
            print(f"알림 보냄 → {key}")
            time.sleep(1)
    else:
        print("지금 강한 신호는 없어요.")
    save_state(state)


if __name__ == "__main__":
    main()
