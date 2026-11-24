# 지표 조합 연구 — "어떤 지표를 켜야 알림이 덜 잃고 더 벌까?"
# 지난 약 2년 1시간봉에서 생겼을 매수 알림 후보를 모두 찾고(실시간과 같은 계산),
# 후보마다 지표 통과 여부 · 신호 점수 · 과거 성적(그 시점 이전 기록만) · 실제 결과를 계산해요.
# 그다음 신호 점수 기준 × 지표 조합 × 과거 성적 × 파는 방법 × 연속 손실 멈춤을 모두 바꿔 가며
# 성적을 비교하고, 결과를 앱 서버(Supabase)의 연구용 표에만 저장해요. 카톡은 보내지 않아요.
# 공개 실행 기록에는 개수만 남겨요 (종목 이름 X).
#
#   python research.py

import heapq
import json
import os
import sys
import time
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import requests

import app_bridge
import backtest_check as bt
import realtime_alert as rt

GUARDS = ["시장", "추세", "눌림", "변동성", "실적"]
SCORES = [5, 6, 7, 8]
FLOOR = 4                      # 이 점수 이상 후보만 저장
UNIT = 100                     # 알림마다 100만원 (결과 단위: 만원)
CARD_SCORE = 6                 # 과거 성적(성적표)을 만들 때 쓰는 기준 (지금 실전과 같음)
RUN = datetime.now(rt.KST).strftime("%Y%m%d-%H%M")


def sim_one(h_arr, idx, a, half):
    """후보 하나를 실제로 샀다면 (backtest_check.simulate_buys와 같은 규칙)
    → (산 여부, 수익률, 다음 알림을 받을 수 있는 봉 위치, 끝난 시각, 아직 안 끝남)"""
    o, hi, lo, cl = h_arr
    n, i = len(cl), a["i"]
    if i + 1 >= n:
        return False, None, i, None, False
    stop, target = a["stop"], a["sell"]
    e = next((k for k in range(i + 1, min(n, i + 1 + bt.FILL_BARS)) if lo[k] <= a["buy"]), None)
    if e is None:
        return False, None, i + bt.FILL_BARS, None, False
    entry = min(o[e], a["buy"])
    if entry <= stop:
        return False, None, e, None, False
    end1, end2 = idx[e] + timedelta(days=bt.HOLD_DAYS), idx[e] + timedelta(days=bt.RUN_DAYS)
    first, exit_price, peak, k = None, None, None, e
    for k in range(e, n):
        if first is None:
            if idx[k] > end1:
                exit_price = cl[k - 1]
                break
            if lo[k] <= stop:
                exit_price = stop if k == e else min(o[k], stop)
                break
            if hi[k] >= target and k > e:
                hit = max(o[k], target)
                if not half:
                    exit_price = hit
                    break
                first, peak = hit, hi[k]
                continue
        else:
            trail = max(entry, peak - rt.TRAIL_ATR * a["atr"])
            if idx[k] > end2:
                exit_price = cl[k - 1]
                break
            if lo[k] <= trail:
                exit_price = min(o[k], trail)
                break
            peak = max(peak, hi[k])
    still_open = exit_price is None
    if still_open:
        exit_price = cl[-1]
    r = (exit_price / entry - 1) if first is None else (0.5 * first + 0.5 * exit_price) / entry - 1
    return True, float(r - bt.FEE), k, idx[k], still_open


def market_candidates(market, tickers):
    daily, hourly, idx = bt.load_market(market, tickers)
    earn = {}
    if market == "us":
        earn = {t: rt.earnings_dates(t) for t in tickers}
    cands, hold, sells, span, failed = [], [], [], [None, None], 0
    hist = {}                                   # 성적표용: 실전과 같은 규칙으로 차례대로 산 기록
    for t in tickers:
        try:
            h, alerts = bt.ticker_alerts(market, t, daily, hourly, idx, earn.get(t, ()))
        except Exception:
            failed += 1
            continue
        if len(h) > 61:
            span[0] = min(span[0] or h.index[60], h.index[60])
            span[1] = max(span[1] or h.index[-1], h.index[-1])
            cl = h["Close"].to_numpy()
            hold.append(cl[-1] / cl[60] - 1 - bt.FEE)
        arr = (h["Open"].to_numpy(), h["High"].to_numpy(), h["Low"].to_numpy(), h["Close"].to_numpy())
        hist[t] = bt.simulate_buys(h, alerts, CARD_SCORE, half=True, once=True)["trades"]
        for a in alerts:
            if a["side"] != "buy" or a["score"] < FLOOR:
                continue
            x = {"t": t, "i": a["i"], "day": a["day"], "ta": h.index[a["i"]], "score": a["score"],
                 "g": {g: bool(a[g]) for g in GUARDS},
                 "risk": (a["buy"] - a["stop"]) / a["buy"] if a["buy"] else None}
            for mode, half in (("half", True), ("fixed", False)):
                filled, ret, busy, tx, op = sim_one(arr, h.index, a, half)
                x[mode] = {"filled": filled, "ret": ret, "busy": busy, "tx": tx, "open": op}
            cands.append(x)
        # 매도 알림 정확도 (점수별): 3일 뒤 가격이 내려갔나
        idx_h, cl_h = h.index, h["Close"].to_numpy()
        last = -10 ** 9
        for a in sorted((x for x in alerts if x["side"] == "sell"), key=lambda x: x["i"]):
            i = a["i"]
            if i - last < 24:
                continue
            k = int(np.searchsorted(idx_h, idx_h[i] + timedelta(days=bt.SELL_CHECK_DAYS)))
            if k >= len(h):
                continue
            sells.append((a["score"], cl_h[k] / cl_h[i] - 1))
            last = i
    # 과거 성적(성적표): 그 알림 시각보다 먼저 끝난 기록만 봄 (미래 정보 X)
    pool = [(t, y["tx"], y["ret"]) for t, ys in hist.items() for y in ys if not y["open"]]
    pool.sort(key=lambda z: z[1])
    for x in cands:
        hist_t = [r for tt, tx, r in pool if tt == x["t"] and tx < x["ta"]]
        hist_m = [r for _, tx, r in pool if tx < x["ta"]]
        ok, s, why = rt.card_judge(rt.card_stats(hist_t), rt.card_stats(hist_m))
        x["card"] = {"ok": bool(ok), "why": why, "n": s["n"] if s else None,
                     "win": s["win"] if s else None, "avg": s["avg"] if s else None}
    return cands, hold, sells, span, failed


def evaluate(cands, min_score, need, card, mode, pause):
    """조건에 맞는 알림만, 실전처럼 차례대로 (같은 종목은 앞 거래가 끝나야 다음, 하루 한 번)"""
    taken = []
    by_t = {}
    for x in cands:
        if x["score"] < min_score or not all(x["g"][g] for g in need) or (card and not x["card"]["ok"]):
            continue
        by_t.setdefault(x["t"], []).append(x)
    for t, xs in by_t.items():
        busy, last_day = -1, None
        for x in sorted(xs, key=lambda z: z["i"]):
            if x["i"] <= busy or x["day"] == last_day:
                continue
            last_day = x["day"]
            res = x[mode]
            busy = res["busy"]
            if res["filled"]:
                taken.append((x["ta"], res["tx"], res["ret"], res["open"]))
    taken.sort(key=lambda z: z[0])
    if pause:                                   # 연속 3번 손실이면 5일 쉼 (rt.pause_until과 같은 규칙)
        kept, heap, end, streak = [], [], None, 0
        for ta, tx, r, op in taken:
            while heap and heap[0][0] < ta:
                ctx, cr = heapq.heappop(heap)
                if end is not None and ctx < end:
                    continue
                streak = streak + 1 if cr <= 0 else 0
                if streak >= rt.PAUSE_LOSSES:
                    end, streak = ctx + pd.Timedelta(days=rt.PAUSE_DAYS), 0
            if end is not None and ta < end:
                continue
            kept.append((ta, tx, r, op))
            if not op:
                heapq.heappush(heap, (tx, r))
        taken = kept
    return taken


def metrics(taken, mid):
    rets = np.array([r for _, _, r, _ in taken], float)
    if not len(rets):
        return {"n": 0, "wins": 0, "total": 0.0, "avg": 0.0, "pf": 0.0, "dd": 0.0, "h1": 0.0, "h2": 0.0}
    cum = np.cumsum(rets * UNIT)
    dd = float((np.maximum.accumulate(np.concatenate([[0], cum])) - np.concatenate([[0], cum])).max())
    gain, loss = rets[rets > 0].sum(), -rets[rets <= 0].sum()
    h1 = sum(r for ta, _, r, _ in taken if ta < mid) * UNIT
    return {"n": int(len(rets)), "wins": int((rets > 0).sum()), "total": round(float(cum[-1]), 2),
            "avg": round(float(rets.mean() * 100), 3), "pf": round(float(gain / loss), 3) if loss > 0 else 99.0,
            "dd": round(dd, 2), "h1": round(float(h1), 2), "h2": round(float(cum[-1] - h1), 2)}


def post_rows(table, rows):
    url = f"{app_bridge.URL}/rest/v1/{table}"
    for i in range(0, len(rows), 500):
        r = requests.post(url, timeout=30, data=json.dumps(rows[i:i + 500], ensure_ascii=False, default=str),
                          headers=app_bridge._headers({"Prefer": "return=minimal"}))
        app_bridge._check(r)


def main():
    if not app_bridge.enabled():
        sys.exit("앱 서버 연결 설정이 없어요")
    started = time.time()
    summary = {"run": RUN, "made": datetime.now(rt.KST).isoformat(), "markets": {}}
    combos = []
    for k in range(1 << len(GUARDS)):
        combos.append(tuple(g for b, g in enumerate(GUARDS) if k >> b & 1))
    for market, cats in rt.MARKETS.items():
        tickers = [t for group in cats.values() for t in group]
        if not tickers:
            continue
        cands, hold, sells, span, failed = market_candidates(market, tickers)
        if not cands or span[0] is None:
            continue
        mid = span[0] + (span[1] - span[0]) / 2
        trade_rows = [{"run": RUN, "market": market, "tk": rt.hid(x["t"]), "ta": x["ta"].isoformat(),
                       "score": x["score"], "g_market": x["g"]["시장"], "g_trend": x["g"]["추세"],
                       "g_dip": x["g"]["눌림"], "g_calm": x["g"]["변동성"], "g_earn": x["g"]["실적"],
                       "card_ok": x["card"]["ok"], "card_why": x["card"]["why"], "hist_n": x["card"]["n"],
                       "hist_win": x["card"]["win"], "hist_avg": x["card"]["avg"],
                       "filled": x["half"]["filled"], "ret_half": x["half"]["ret"], "ret_fixed": x["fixed"]["ret"],
                       "risk": x["risk"]} for x in cands]
        post_rows("research_trades", trade_rows)
        grid = []
        for s in SCORES:
            for need in combos:
                if market != "us" and "실적" in need:          # 실적 발표일은 미장만 있음
                    continue
                for card in (False, True):
                    for mode in ("half", "fixed"):
                        for pause in (False, True):
                            m = metrics(evaluate(cands, s, need, card, mode, pause), mid)
                            grid.append({"run": RUN, "market": market, "min_score": s, "need": ",".join(need),
                                         "card": card, "half": mode == "half", "pause": pause, **m})
        post_rows("research_grid", grid)
        sell_stats = {}
        for s in range(4, 11):
            xs = [r for sc, r in sells if sc >= s]
            if xs:
                sell_stats[s] = {"n": len(xs), "hit": round(float(np.mean(np.array(xs) < 0)) * 100, 1)}
        summary["markets"][market] = {
            "tickers": len(tickers), "failed": failed, "cands": len(cands),
            "hold": round(float(sum(hold)) * UNIT, 1), "span": [span[0].isoformat(), span[1].isoformat()],
            "sell": sell_stats, "configs": len(grid)}
        print(f"[{market}] 종목 {len(tickers)}개 · 후보 {len(cands)}개 · 조합 {len(grid)}개")
    app_bridge.put_kv("research", summary)
    print(f"연구 끝: {time.time() - started:.0f}초 · 기록 {RUN}")


if __name__ == "__main__":
    main()
