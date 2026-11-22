# 2년 모의투자 — "알림이 올 때마다 100만원씩 샀다면 얼마를 벌었을까?"
# 최근 약 2년치 1시간봉으로, 실시간 알림과 똑같은 안전가·안전도 10점 계산을 돌려요.
# 결과는 돈(만원)으로 바꿔서, 그냥 들고 있었을 때와 비교해 카톡으로만 보내요.
# 공개 실행 기록에는 종목 수만 남겨요.
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
        buys = {k: {"signals": 0, "filled": 0, "rets": []} for k in THRESHOLDS}
        sells = {k: [] for k in THRESHOLDS}
        hold = []                                   # 같은 기간 그냥 들고 있었을 때 수익률
        for t in tickers:
            stats["checked"] += 1
            try:
                if t not in daily or t not in hourly:
                    raise ValueError("데이터 없음")
                d, h = rt.add_daily(daily[t]), prep_hourly(hourly[t], market)
                alerts = find_alerts(market, d, h)
                for k in THRESHOLDS:
                    r = simulate_buys(h, alerts, k, wait=True)
                    b = buys[k]
                    b["signals"] += r["signals"]
                    b["filled"] += r["filled"]
                    b["rets"] += r["rets"]
                    sells[k] += check_sells(h, alerts, k)
                cl = h["Close"].to_numpy()
                if len(cl) > 61:
                    hold.append(cl[-1] / cl[60] - 1 - FEE)   # 알림을 찾기 시작한 때부터 끝까지
            except Exception as e:
                stats["failed"] += 1
                if rt.VERBOSE or preview:
                    print(f"{t}: 실패 ({e})")
        results[market] = {"buys": buys, "sells": sells, "hold": hold}

    messages = build_messages(results)
    if preview:
        print("\n\n".join(messages))
    else:
        token = base.get_access_token()
        for msg in messages:
            base.send_kakao(token, msg)
            time.sleep(1)
    print(f"점검 끝: 종목 {stats['checked']}개 · 실패 {stats['failed']}개")


# ---------- 카톡 메시지 (돈으로 바꿔서 한눈에) ----------

UNIT = 100                  # 알림마다 100만원씩 샀다고 계산 (단위: 만원)


def u16len(s):
    return len(s.encode("utf-16-le")) // 2          # 이모지를 2글자로 세는 경우까지 안전하게


def pack(lines, limit=190):
    """카톡 200자 제한 안에서 줄 단위로 묶기"""
    msgs, cur = [], ""
    for ln in lines:
        joined = f"{cur}\n{ln}" if cur else ln
        if u16len(joined) <= limit:
            cur = joined
        else:
            if cur:
                msgs.append(cur)
            cur = ln
    if cur:
        msgs.append(cur)
    return msgs


def won(manwon, sign=True):
    """만원 단위 숫자를 읽기 쉬운 돈으로: +1,240만원 / -35만원 / -3천원"""
    s = ("+" if manwon > 0 else "-" if manwon < 0 else "") if sign else ("-" if manwon < 0 else "")
    a = abs(manwon)
    if a >= 1 or a == 0:
        return f"{s}{a:,.0f}만원"
    return f"{s}{a * 10:,.0f}천원"


def bar(value, biggest):
    """수익은 빨강, 손실은 파랑 (토스증권과 같은 색)"""
    if biggest <= 0 or abs(value) < 0.5:
        return "▫️"
    n = max(1, round(abs(value) / biggest * 5))
    return ("🟥" if value > 0 else "🟦") * n


def market_result(r):
    """기준별 총손익(만원)과 같은 기간 보유 손익"""
    rows = {}
    for k in THRESHOLDS:
        rets = np.array(r["buys"][k]["rets"])
        if len(rets):
            rows[k] = {"n": len(rets), "win": int((rets > 0).sum()), "total": rets.sum() * UNIT}
    hold = np.array(r["hold"])
    return rows, (hold.sum() * UNIT if len(hold) else None), len(hold)


def build_messages(results):
    cur = rt.MIN_SCORE
    msgs = pack([
        "📊 2년 모의투자 결과",
        "알림이 올 때마다 100만원어치 샀다고 치고 지난 2년을 다시 돌려 봤어요.",
        f"· 안전 매수가에 사서 손절가·안전 매도가·{HOLD_DAYS}일 중 먼저 오는 때 팜",
        f"· 수수료 {FEE * 100:.1f}% 포함 · 지금 알림 기준 {cur}점",
    ])

    verdicts = []
    for market, r in results.items():
        name = rt.MARKET_NAME[market]
        rows, hold_total, n_hold = market_result(r)
        lines = [f"{name} 2년 모의투자", f"종목마다 100만원씩 ({n_hold}종목 = {won(UNIT * n_hold, False)})"]
        now = rows.get(cur)
        if now:
            lines += [f"① 알림({cur}점)대로 사고팔기",
                      f"거래 {now['n']}번 · 이김 {now['win']} · 짐 {now['n'] - now['win']}",
                      f"👉 {won(now['total'])}"]
        else:
            lines += [f"① 알림({cur}점)대로: 2년간 체결된 매수 없음"]
        if hold_total is not None:
            lines += ["② 처음에 사서 그냥 들고 있기", f"👉 {won(hold_total)}"]
        msgs += pack(lines)

        if rows:
            biggest = max(abs(x["total"]) for x in rows.values())
            lines = [f"{name} 알림 기준별 2년 손익"]
            for k in THRESHOLDS:
                if k in rows:
                    x = rows[k]
                    mark = " ← 지금" if k == cur else ""
                    lines.append(f"{k}점 {bar(x['total'], biggest)} {won(x['total'])} ({x['n']}번){mark}")
                else:
                    lines.append(f"{k}점 거래 없음")
            msgs += pack(lines)
        verdicts.append(verdict(name, rows, hold_total, cur))

    lines = [f"🔵 매도 알림 맞았나? ({SELL_CHECK_DAYS}일 뒤 실제로 내렸는지)"]
    for market, r in results.items():
        x = np.array(r["sells"].get(cur, []))
        name = rt.MARKET_NAME[market]
        if len(x):
            hit = round((x < 0).mean() * 10)
            lines.append(f"{name} 10번 중 {hit}번 맞음 ({len(x)}번 중)")
        else:
            lines.append(f"{name} {cur}점 이상 매도 알림 없음")
    lines.append("5번이면 동전 던지기 수준이에요")
    msgs += pack(lines)

    losing = all(r.get(cur) is None or r[cur]["total"] <= 0 for r in (market_result(x)[0] for x in results.values()))
    tail = ["👉 지금은 알림을 참고용으로만 보는 걸 추천"] if losing else []
    msgs += pack(["🧭 결론"] + verdicts + tail + ["과거 성적이 미래 수익을 보장하진 않아요"])
    return msgs


def verdict(name, rows, hold_total, cur):
    """시장마다 두세 줄로 결론: 알림 vs 그냥 보유, 그리고 더 나은 기준이 있는지"""
    now = rows.get(cur)
    if not now:
        return f"{name}: 거래가 없어 판단 보류"
    total = now["total"]
    if hold_total is None:
        line = f"{name}: 알림 {won(total)}"
    else:
        line = f"{name}: 알림 {won(total)} vs 보유 {won(hold_total)}"
    if total > 0 and (hold_total is None or total >= hold_total):
        line += "\n → 알림대로 한 게 더 나음 ✅"
    elif total > 0:
        line += "\n → 벌긴 했지만 그냥 보유가 더 나음"
    elif hold_total is not None and hold_total < total:
        line += "\n → 둘 다 손해, 알림이 덜 잃음"
    else:
        line += "\n → 알림대로 하면 손해, 보유가 나음"

    good = {k: x for k, x in rows.items() if x["n"] >= 15}
    best = max(good, key=lambda q: good[q]["total"]) if good else None
    if best is not None and best != cur and good[best]["total"] > max(total, 0):
        line += f"\n → {best}점으로 바꾸면 {won(good[best]['total'])} ({good[best]['n']}번)"
    else:
        lucky = [k for k, x in rows.items() if x["n"] < 15 and x["total"] > max(total, 0)]
        if lucky:
            k = max(lucky, key=lambda q: rows[q]["total"])
            line += f"\n → {k}점은 {won(rows[k]['total'])}인데 {rows[k]['n']}번뿐이라 아직 몰라요"
    return line


if __name__ == "__main__":
    main()
