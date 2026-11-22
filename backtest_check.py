# 안전도 기준 검증 — "과거에 이 기준대로 알림이 왔다면 어땠을까?"
# 최근 약 2년치 1시간봉으로, 실시간 알림과 똑같은 안전가·안전도 10점 계산을 돌려요.
# 결과는 카톡으로만 보내고, 공개 실행 기록에는 숫자 몇 개만 남겨요.
#
#   python backtest_check.py           → 계산 + 카톡 보내기 ('점검 작업'이 씀)
#   python backtest_check.py preview   → 카톡 없이 화면에 출력

import os
import sys
import time
from datetime import timedelta

import numpy as np
import pandas as pd

import realtime_alert as rt
import signal_alert as base

THRESHOLDS = [6, 7, 8, 9]   # 비교할 안전도 기준
HOLD_DAYS = 14              # 손절가·목표가 둘 다 안 닿으면 며칠 뒤 정리할지
FILL_BARS = 16              # 안전 매수가를 기다리는 시간 (1시간봉 개수)
FEE = 0.002                 # 사고팔 때 수수료·세금 합계 (0.2%)
SELL_CHECK_DAYS = 3         # 매도 신호 후 며칠 뒤 가격으로 정확도를 볼지


# ---------- 데이터 준비 ----------

def local_dates(index, tz):
    idx = index.tz_convert(tz) if index.tz is not None else index
    return np.array([d.toordinal() for d in idx.date])


def prep_hourly(h, market):
    h = h.dropna(subset=["Close"]).copy()
    tz = rt.TZ[market]
    vol = h["Volume"].fillna(0).clip(lower=0).astype(float)
    tp = (h["High"] + h["Low"] + h["Close"]) / 3
    if market == "crypto":                      # 코인: 최근 24시간 평균 체결가
        pv, vv = (tp * vol).rolling(24, min_periods=6).sum(), vol.rolling(24, min_periods=6).sum()
    else:                                       # 주식: 그날 장 시작부터의 평균 체결가
        day = pd.Series(local_dates(h.index, tz), index=h.index)
        pv, vv = (tp * vol).groupby(day).cumsum(), vol.groupby(day).cumsum()
    h["VWAP"] = (pv / vv.replace(0, np.nan)).fillna(tp)
    h["EMA9"] = h["Close"].ewm(span=9, adjust=False).mean()
    h["EMA21"] = h["Close"].ewm(span=21, adjust=False).mean()
    h = rt.add_hourly(h)
    h["VOLR"] = (vol / vol.shift(1).rolling(20, min_periods=5).mean()).replace([np.inf, -np.inf], np.nan).fillna(0)
    h["DAY"] = local_dates(h.index, tz)
    h["FIRST"] = h["DAY"] != h["DAY"].shift(1)          # 그날 첫 봉 (장 시작 직후는 건너뜀)
    return h


# ---------- 과거 알림 찾기 ----------

def find_alerts(market, d, h):
    """실시간 알림과 같은 계산으로, 과거 1시간봉마다 생겼을 알림을 모두 찾음"""
    c, v, e9, e21 = h["Close"], h["VWAP"], h["EMA9"], h["EMA21"]
    buy = ((c.shift(1) <= v.shift(1)) & (c > v)) | ((e9.shift(1) <= e21.shift(1)) & (e9 > e21) & (c > v))
    sell = ((c.shift(1) >= v.shift(1)) & (c < v)) | ((e9.shift(1) >= e21.shift(1)) & (e9 < e21) & (c < v))
    if market != "crypto":
        buy, sell = buy & ~h["FIRST"], sell & ~h["FIRST"]

    d_days = local_dates(d.index, rt.TZ[market])
    alerts = []
    for side, mask in (("buy", buy), ("sell", sell)):
        for i in np.flatnonzero(mask.to_numpy()):
            if i < 60:
                continue
            j = int(np.searchsorted(d_days, h["DAY"].iloc[i])) - 1     # 전날까지의 일봉만 씀 (미래 정보 X)
            if j < 220:
                continue
            d_sub, h_sub = d.iloc[:j + 1], h.iloc[:i + 1]
            price = float(h["Close"].iloc[i])
            m = pd.DataFrame({"Close": [price], "VWAP": [float(v.iloc[i])]})
            lv = rt.safe_levels(market, d_sub, h_sub, m, same_day=False)
            trig = {"volr": float(h["VOLR"].iloc[max(0, i - 1): i + 1].max())}
            checks = rt.safety_checks(side, d_sub, h_sub, m, trig, lv, float(d_sub["Close"].iloc[-1]))
            alerts.append({"i": int(i), "side": side, "score": sum(bool(ok) for _, ok in checks), **lv})
    return alerts


# ---------- 결과 계산 ----------

def simulate_buys(h, alerts, min_score, wait):
    """wait=True: 안전 매수가까지 내려오면 삼 / False: 다음 봉 시가에 바로 삼"""
    idx = h.index
    o, hi, lo, cl = h["Open"].to_numpy(), h["High"].to_numpy(), h["Low"].to_numpy(), h["Close"].to_numpy()
    n, busy, rets, signals, filled = len(h), -1, [], 0, 0
    for a in sorted((x for x in alerts if x["side"] == "buy" and x["score"] >= min_score), key=lambda x: x["i"]):
        i = a["i"]
        if i <= busy or i + 1 >= n:
            continue
        signals += 1
        stop, target = a["stop"], a["sell"]
        if wait:
            e = next((k for k in range(i + 1, min(n, i + 1 + FILL_BARS)) if lo[k] <= a["buy"]), None)
            if e is None:
                busy = i + FILL_BARS
                continue
            entry = min(o[e], a["buy"])
        else:
            e, entry = i + 1, o[i + 1]
        if entry <= stop:
            busy = e
            continue
        filled += 1
        end_time, exit_price, k = idx[e] + timedelta(days=HOLD_DAYS), None, e
        for k in range(e, n):
            if idx[k] > end_time:
                exit_price = cl[k - 1]
                break
            if lo[k] <= stop:                                    # 같은 봉에서 둘 다 닿으면 손절로 (보수적으로)
                exit_price = stop if k == e else min(o[k], stop)
                break
            if hi[k] >= target and (k > e or not wait):
                exit_price = target if k == e else max(o[k], target)
                break
        if exit_price is None:
            exit_price = cl[-1]
        rets.append(exit_price / entry - 1 - FEE)
        busy = k
    return {"signals": signals, "filled": filled, "rets": rets}


def check_sells(h, alerts, min_score):
    """매도 신호 후 SELL_CHECK_DAYS일 뒤 가격이 실제로 내려갔는지"""
    idx, cl = h.index, h["Close"].to_numpy()
    out, last = [], -10 ** 9
    for a in sorted((x for x in alerts if x["side"] == "sell" and x["score"] >= min_score), key=lambda x: x["i"]):
        i = a["i"]
        if i - last < 24:                       # 하루 안의 중복 신호는 하나로
            continue
        k = int(np.searchsorted(idx, idx[i] + timedelta(days=SELL_CHECK_DAYS)))
        if k >= len(h):
            continue
        out.append(cl[k] / cl[i] - 1)
        last = i
    return out


def summarize(rets):
    if not rets:
        return None
    r = np.array(rets)
    streak = best = 0
    for x in r:
        streak = streak + 1 if x <= 0 else 0
        best = max(best, streak)
    return {"n": len(r), "win": (r > 0).mean() * 100, "avg": r.mean() * 100, "worst_streak": best}


# ---------- 실행 ----------

def main():
    preview = len(sys.argv) > 1 and sys.argv[1] == "preview"
    if not any(rt.MARKETS.values()):
        sys.exit("❗ 비밀값 ALERT_SETTINGS에 종목이 없어요.")

    results, stats = {}, {"checked": 0, "failed": 0}
    for market, cats in rt.MARKETS.items():
        tickers = [t for group in cats.values() for t in group]
        if not tickers:
            continue
        daily = rt.fetch_many(tickers, "5y", "1d")
        hourly = rt.fetch_many(tickers, "730d", "60m")
        buys = {(k, w): {"signals": 0, "filled": 0, "rets": []} for k in THRESHOLDS for w in (True, False)}
        sells = {k: [] for k in THRESHOLDS}
        for t in tickers:
            stats["checked"] += 1
            try:
                if t not in daily or t not in hourly:
                    raise ValueError("데이터 없음")
                d, h = rt.add_daily(daily[t]), prep_hourly(hourly[t], market)
                alerts = find_alerts(market, d, h)
                for k in THRESHOLDS:
                    for w in (True, False):
                        r = simulate_buys(h, alerts, k, w)
                        b = buys[(k, w)]
                        b["signals"] += r["signals"]
                        b["filled"] += r["filled"]
                        b["rets"] += r["rets"]
                    sells[k] += check_sells(h, alerts, k)
            except Exception as e:
                stats["failed"] += 1
                if rt.VERBOSE or preview:
                    print(f"{t}: 실패 ({e})")
        results[market] = {"buys": buys, "sells": sells}

    messages = build_messages(results)
    if preview:
        print("\n\n".join(messages))
    else:
        token = base.get_access_token()
        for msg in messages:
            base.send_kakao(token, msg)
            time.sleep(1)
    print(f"점검 끝: 종목 {stats['checked']}개 · 실패 {stats['failed']}개")


def build_messages(results):
    cur = rt.MIN_SCORE
    msgs = [("📊 안전도 기준 검증 (최근 약 2년, 1시간봉)\n"
             "알림이 왔을 때 안전 매수가에 사서, 손절가·안전 매도가·"
             f"{HOLD_DAYS}일 중 먼저 오는 때 판 것으로 계산했어요.\n"
             f"수수료 {FEE * 100:.1f}% 반영 · 지금 기준 {cur}점")]
    best = {}
    for market, r in results.items():
        lines = [f"{rt.MARKET_NAME[market]} 매수 검증 (안전가 대기)"]
        for k in THRESHOLDS:
            b = r["buys"][(k, True)]
            s = summarize(b["rets"])
            if s:
                fill = b["filled"] / b["signals"] * 100 if b["signals"] else 0
                lines.append(f"{k}점 {s['n']}회 승률{s['win']:.0f}% 평균{s['avg']:+.1f}% 체결{fill:.0f}%")
                if s["n"] >= 15 and (market not in best or s["avg"] > best[market][1]):
                    best[market] = (k, s["avg"])
            else:
                lines.append(f"{k}점 신호 없음")
        now = summarize(r["buys"][(cur, False)]["rets"])
        if now:
            lines.append(f"참고: {cur}점 바로 매수 시 승률{now['win']:.0f}% 평균{now['avg']:+.1f}%")
        msgs += base.chunk(lines)

    lines = [f"🔵 매도 신호 정확도 ({SELL_CHECK_DAYS}일 뒤 실제로 내렸나)"]
    for market, r in results.items():
        x = np.array(r["sells"].get(cur, []))
        if len(x):
            lines.append(f"{rt.MARKET_NAME[market]} {len(x)}회 · 하락 {(x < 0).mean() * 100:.0f}% · 평균 {x.mean() * 100:+.1f}%")
        else:
            lines.append(f"{rt.MARKET_NAME[market]} {cur}점 이상 신호 없음")
    msgs += base.chunk(lines)

    lines = ["🧭 정리 (15회 이상 나온 기준 중 평균이 가장 좋은 것)"]
    for market in results:
        if market in best and best[market][1] > 0:
            k, avg = best[market]
            mark = "← 지금과 같음" if k == cur else f"(지금 {cur}점)"
            lines.append(f"{rt.MARKET_NAME[market]}: {k}점 평균{avg:+.1f}% {mark}")
        elif market in best:
            lines.append(f"{rt.MARKET_NAME[market]}: 모든 기준이 평균 손실 → 매수 알림 신뢰 낮음")
        else:
            lines.append(f"{rt.MARKET_NAME[market]}: 표본 부족 (판단 보류)")
    lines.append("과거 성적은 미래 수익을 보장하지 않아요")
    msgs += base.chunk(lines)
    return msgs


if __name__ == "__main__":
    main()
