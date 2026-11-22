# 2년 모의투자 — "알림이 올 때마다 100만원씩 샀다면 얼마를 벌었을까?"
# 최근 약 2년치 1시간봉으로, 실시간 알림과 똑같은 안전가·안전도 10점 계산을 돌려요.
# 손실 방지 장치(시장 필터·추세 필수·눌림 매수·반 매도)를 하나씩 켰을 때, 전부 켰을 때,
# 그리고 '성적표'(과거에 수익 난 자리만)와 '연속 손실 자동 멈춤'까지 켰을 때를 비교하고,
# 새 알림 설정이 앞 1년·뒤 1년 모두 통했는지(안정성)도 같이 봐요. 결과는
# 돈(만원)으로 바꾸고, 그냥 들고 있었을 때와 나란히 카톡으로만 보내요.
# 공개 실행 기록에는 종목 수만 남겨요.
# 표·그래프로 된 결과 페이지도 만들어요 (카톡 '가상 시뮬레이션' 버튼이 여는 숨은 주소의 페이지).
# 페이지에는 종목 이름 없이 시장별 결과만 들어가요.
#
#   python backtest_check.py           → 계산 + 카톡 보내기 ('점검 작업'이 씀)
#   python backtest_check.py preview   → 카톡 없이 화면에 출력

import bisect
import html
import os
import sys
import time
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

import realtime_alert as rt
import signal_alert as base

THRESHOLDS = [7, 8, 9]      # 비교할 안전도 기준
HOLD_DAYS = rt.HOLD_DAYS    # 손절가·목표가 둘 다 안 닿으면 며칠 뒤 정리할지 (실전 기록과 같은 값)
RUN_DAYS = rt.RUN_DAYS      # 반 매도 후 나머지를 최대 며칠까지 들고 갈지
FILL_BARS = rt.FILL_BARS_H  # 안전 매수가를 기다리는 시간 (1시간봉 개수)
FEE = rt.FEE                # 사고팔 때 수수료·세금 합계 (0.2%)
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

def find_alerts(market, d, h, idx=None, earn=()):
    """실시간 알림과 같은 계산으로, 과거 1시간봉마다 생겼을 알림을 모두 찾음
    idx: (지수 날짜들, 그날 지수가 200일선 위였는지) — 시장 필터용
    earn: 실적 발표일 목록 ('YYYY-MM-DD') — 실적 피하기용"""
    earn_ord = sorted(date.fromisoformat(x).toordinal() for x in earn)
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
            mkt_ok = True
            if idx is not None:
                k = int(np.searchsorted(idx[0], h["DAY"].iloc[i])) - 1   # 어제까지의 지수
                mkt_ok = bool(idx[1][k]) if k >= 0 else True
            day = int(h["DAY"].iloc[i])
            e = bisect.bisect_left(earn_ord, day)                          # 오늘~10일 안에 발표가 있나
            earn_ok = not (e < len(earn_ord) and earn_ord[e] - day <= rt.EARN_DAYS)
            flags = rt.guard_flags(d_sub, price, mkt_ok, earn_ok)
            alerts.append({"i": int(i), "side": side, "score": sum(bool(ok) for _, ok in checks),
                           "day": int(h["DAY"].iloc[i]), **flags, **lv})
    return alerts


# ---------- 결과 계산 ----------

def simulate_buys(h, alerts, min_score, need=(), half=False, once=False):
    """안전 매수가까지 내려오면 사고(16시간 안에), 손절가·안전 매도가·14일 중 먼저 오는 때 팜
    need: 꼭 통과해야 하는 장치 ("시장", "추세", "눌림")
    half: 안전 매도가에서 절반만 팔고, 나머지는 손절가를 매수가로 올려 고점-ATR×2 까지 따라감 (최대 60일)
    once: 같은 종목 매수는 하루 한 번만"""
    idx = h.index
    o, hi, lo, cl = h["Open"].to_numpy(), h["High"].to_numpy(), h["Low"].to_numpy(), h["Close"].to_numpy()
    n, busy, last_day, rets, trades, signals, filled = len(h), -1, None, [], [], 0, 0
    pick = (x for x in alerts if x["side"] == "buy" and x["score"] >= min_score and all(x[g] for g in need))
    for a in sorted(pick, key=lambda x: x["i"]):
        i = a["i"]
        if i <= busy or i + 1 >= n or (once and a["day"] == last_day):
            continue
        signals += 1
        last_day = a["day"]
        stop, target = a["stop"], a["sell"]
        e = next((k for k in range(i + 1, min(n, i + 1 + FILL_BARS)) if lo[k] <= a["buy"]), None)
        if e is None:
            busy = i + FILL_BARS
            continue
        entry = min(o[e], a["buy"])
        if entry <= stop:
            busy = e
            continue
        filled += 1
        end1, end2 = idx[e] + timedelta(days=HOLD_DAYS), idx[e] + timedelta(days=RUN_DAYS)
        first, exit_price, peak, k = None, None, None, e
        for k in range(e, n):
            if first is None:                                   # 1단계: 손절 / 목표 / 14일
                if idx[k] > end1:
                    exit_price = cl[k - 1]
                    break
                if lo[k] <= stop:                               # 같은 봉에서 둘 다 닿으면 손절로 (보수적으로)
                    exit_price = stop if k == e else min(o[k], stop)
                    break
                if hi[k] >= target and k > e:
                    hit = max(o[k], target)
                    if not half:
                        exit_price = hit
                        break
                    first, peak = hit, hi[k]                     # 절반 매도, 나머지는 다음 봉부터 따라감
                    continue
            else:                                               # 2단계: 나머지 절반
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
        rets.append(r - FEE)
        trades.append({"ta": idx[i], "tx": idx[k], "ret": r - FEE, "open": still_open,
                       "risk": (entry - stop) / entry})
        busy = k
    return {"signals": signals, "filled": filled, "rets": rets, "trades": trades}


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


# ---------- 실행 ----------

def live_opt(market):
    """지금 실시간 알림에 켜진 장치 그대로 (성적표 빼고)"""
    need = tuple(g for g, key in rt.GUARD_KEY.items() if rt.guard_on(market, key))
    return {"need": need, "half": rt.guard_on(market, "반_매도"), "once": rt.guard_on(market, "하루_한번")}


def card_opt(market):
    """성적표용 기록: 그 종목의 (필터 전) 알림 전부를 지금과 같은 파는 방법으로 거래했을 때"""
    return {"half": rt.guard_on(market, "반_매도"), "once": rt.guard_on(market, "하루_한번")}


def strategies(market):
    return [("①", "예전 알림", {}),
            ("②", "시장필터", {"need": ("시장",)}),
            ("③", "추세필수", {"need": ("추세",)}),
            ("④", "눌림매수", {"need": ("눌림",)}),
            ("⑤", "반매도", {"half": True}),
            ("⑥", "장치전부", live_opt(market)),
            ("⑦", "⑥+성적표" + ("·멈춤" if rt.guard_on(market, "자동_멈춤") else ""), None)]  # 아래 card_gate


def live_sid(market):
    return "⑦" if rt.guard_on(market, "성적표") else "⑥"


def load_market(market, tickers):
    index_t = rt.INDEX[market]
    daily = rt.fetch_many(list(dict.fromkeys(tickers + [index_t])), "5y", "1d")
    hourly = rt.fetch_many(tickers, "730d", "60m")
    idx = None
    if index_t in daily:                                    # 시장 필터: 그날 지수가 200일선 위였나
        di = rt.add_daily(daily[index_t])
        idx = (local_dates(di.index, rt.TZ[market]), (di["Close"] > di["MA200"]).to_numpy())
    return daily, hourly, idx


def ticker_alerts(market, t, daily, hourly, idx, earn=()):
    if t not in daily or t not in hourly:
        raise ValueError("데이터 없음")
    d, h = rt.add_daily(daily[t]), prep_hourly(hourly[t], market)
    return h, find_alerts(market, d, h, idx, earn)


def card_gate(cands, history):
    """⑥ 거래(cands) 중 성적표를 통과한 것만. 성적표는 '그 거래 시점보다 먼저 끝난' 기록(history)만 봄
    → 미래 정보 없이 정직하게 검증"""
    pool = [(t, y) for t, ys in history.items() for y in ys if not y["open"]]
    taken = []
    for t, xs in cands.items():
        for x in xs:
            hist_t = [y["ret"] for tt, y in pool if tt == t and y["tx"] < x["ta"]]
            hist_m = [y["ret"] for _, y in pool if y["tx"] < x["ta"]]
            ok, _, _ = rt.card_judge(rt.card_stats(hist_t), rt.card_stats(hist_m))
            if ok:
                taken.append(x)
    return taken


def apply_pause(trades):
    """실전처럼: 앞선 거래가 연속 손실 3번이면 그 시장 매수를 5일 쉼 (실시간과 같은 pause_until 사용)"""
    taken = []
    for x in sorted(trades, key=lambda x: x["ta"]):
        closed = [y for y in taken if not y["open"]]
        if rt.pause_until(closed, x["ta"]) is None:
            taken.append(x)
    return taken


def make_card():
    """실시간 알림용 성적표: 종목별·시장 전체의 지난 2년 거래 성적 (종목 이름은 코드로)"""
    out, done, wanted = {"markets": {}, "earn": {}}, 0, 0
    for market, cats in rt.MARKETS.items():
        tickers = [t for group in cats.values() for t in group]
        if tickers and market == "us" and rt.guard_on(market, "실적_피하기"):
            for t in tickers:
                out["earn"][rt.hid(t)] = rt.earnings_dates(t)
        if not tickers or not rt.guard_on(market, "성적표"):
            continue
        wanted += 1
        daily, hourly, idx = load_market(market, tickers)
        cur, opt = rt.min_score(market), card_opt(market)
        per, pool = {}, []
        for t in tickers:
            try:
                h, alerts = ticker_alerts(market, t, daily, hourly, idx)
            except Exception:
                continue
            rets = [x["ret"] for x in simulate_buys(h, alerts, cur, **opt)["trades"] if not x["open"]]
            done += 1
            if rets:
                per[rt.hid(t)] = rt.card_stats(rets)
                pool += rets
        out["markets"][market] = {"tickers": per, "pool": rt.card_stats(pool)}
    if wanted and not done:
        raise ValueError("데이터를 하나도 못 받음")
    return out


def main():
    preview = len(sys.argv) > 1 and sys.argv[1] == "preview"
    if not any(rt.MARKETS.values()):
        sys.exit("❗ 비밀값 ALERT_SETTINGS에 종목이 없어요.")

    results, stats = {}, {"checked": 0, "failed": 0}
    for market, cats in rt.MARKETS.items():
        tickers = [t for group in cats.values() for t in group]
        if not tickers:
            continue
        daily, hourly, idx = load_market(market, tickers)
        strats = strategies(market)
        cur = rt.min_score(market)
        ks = sorted(set(THRESHOLDS) | {cur})                    # 지금 기준이 목록에 없어도 같이 계산
        earn = {}
        if market == "us" and rt.guard_on(market, "실적_피하기"):
            earn = {t: rt.earnings_dates(t) for t in tickers}
        span = [None, None]
        buys = {(sid, k): [] for sid, _, _ in strats for k in ks}
        six = {k: {} for k in ks}                       # ⑥ 거래 기록 (⑦ 계산용)
        hist = {k: {} for k in ks}                      # 성적표용 기록 (필터 전 알림 전부)
        sells, hold, old_trades = [], [], []                    # hold: 같은 기간 그냥 들고 있었을 때 수익률
        for t in tickers:
            stats["checked"] += 1
            try:
                h, alerts = ticker_alerts(market, t, daily, hourly, idx, earn.get(t, ()))
                if len(h) > 61:
                    span[0] = min(span[0] or h.index[60], h.index[60])
                    span[1] = max(span[1] or h.index[-1], h.index[-1])
                for sid, _, opt in strats:
                    if opt is None:
                        continue
                    for k in ks:
                        r = simulate_buys(h, alerts, k, **opt)
                        buys[(sid, k)] += r["rets"]
                        if sid == "①" and k == cur:
                            old_trades += r["trades"]
                        if sid == "⑥":
                            six[k][t] = r["trades"]
                for k in ks:
                    hist[k][t] = simulate_buys(h, alerts, k, **card_opt(market))["trades"]
                sells += check_sells(h, alerts, cur)
                cl = h["Close"].to_numpy()
                if len(cl) > 61:
                    hold.append(cl[-1] / cl[60] - 1 - FEE)       # 알림을 찾기 시작한 때부터 끝까지
            except Exception as e:
                stats["failed"] += 1
                if rt.VERBOSE or preview:
                    print(f"{t}: 실패 ({e})")
        seven = {}
        for k in ks:
            taken = card_gate(six[k], hist[k])
            if rt.guard_on(market, "자동_멈춤"):
                taken = apply_pause(taken)
            seven[k] = taken
            buys[("⑦", k)] = [x["ret"] for x in taken]
        live = live_sid(market)
        live_trades = seven.get(cur, []) if live == "⑦" else [x for ts in six.get(cur, {}).values() for x in ts]
        results[market] = {"buys": buys, "sells": sells, "hold": hold, "strats": strats, "cur": cur,
                           "live": live, "live_trades": live_trades, "span": span, "ks": ks,
                           "earn_ok": any(earn.values()) if earn else None, "old_trades": old_trades}

    made = datetime.now(rt.KST)
    out_dir = os.environ.get("REPORT_DIR", "_site")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{base.report_key()}.html"), "w", encoding="utf-8") as f:
        f.write(build_report(results, made))
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>.</title>')

    full = base.SETTINGS.get("점검_카톡_전체", False)                # true면 예전처럼 카톡으로 전부 받기
    messages = build_messages(results) if full else build_short(results)
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
MIN_N = 15                  # 이보다 거래가 적으면 운일 수 있어서 '최고'로 안 뽑음


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
    if a < 0.1:                                       # 1천원 미만은 0으로
        return "0원"
    if a >= 1:
        return f"{s}{a:,.0f}만원"
    return f"{s}{a * 10:,.0f}천원"


def bar(value, biggest):
    """수익은 빨강, 손실은 파랑 (토스증권과 같은 색)"""
    if biggest <= 0 or abs(value) < 0.5:
        return "▫️"
    n = max(1, round(abs(value) / biggest * 5))
    return ("🟥" if value > 0 else "🟦") * n


def market_result(r):
    """(방법, 기준)별 거래 수·이긴 수·총손익(만원)과 같은 기간 보유 손익"""
    rows = {}
    for key, rets in r["buys"].items():
        x = np.array(rets)
        if len(x):
            rows[key] = {"n": len(x), "win": int((x > 0).sum()), "total": x.sum() * UNIT}
    hold = np.array(r["hold"])
    return rows, (hold.sum() * UNIT if len(hold) else None), len(hold)


def build_messages(results):
    msgs = pack([
        "📊 손실 방지 2년 모의투자",
        "알림마다 100만원씩 샀다고 치고 방법별로 비교했어요.",
        "① 예전 알림 (장치 없음)",
        "②~⑤ 장치를 하나씩만 켬",
        "⑥ 장치 전부 (+변동성·실적·하루1번)",
        "⑦ ⑥ + 성적표 + 연속손실 멈춤",
        "⭐ = 지금 새 알림 설정",
        f"수수료 {FEE * 100:.1f}% 포함 · 괄호는 승률·거래 횟수",
    ])

    verdicts = []
    for market, r in results.items():
        name, cur = rt.MARKET_NAME[market], r["cur"]
        rows, hold_total, n_hold = market_result(r)
        lines = [f"{name} 2년 손익 ({cur}점·{n_hold}종목)"]
        if hold_total is not None:
            lines.append(f"그냥 보유 {won(hold_total)}")
        for sid, title, _ in r["strats"]:
            x = rows.get((sid, cur))
            star = "⭐" if sid == r["live"] else ""
            if x:
                lines.append(f"{sid} {title}{star} {won(x['total'])} ({x['win'] / x['n'] * 100:.0f}%·{x['n']}번)")
            else:
                lines.append(f"{sid} {title}{star} 거래 없음")
        msgs += pack(lines, 200)

        live = {k: rows[(r["live"], k)] for k in r["ks"] if (r["live"], k) in rows}
        if live:
            biggest = max(abs(x["total"]) for x in live.values())
            lines = [f"{name} ⭐ 새 알림 기준별"]
            for k in r["ks"]:
                x = live.get(k)
                mark = " ← 지금" if k == cur else ""
                if x:
                    lines.append(f"{k}점 {bar(x['total'], biggest)} {won(x['total'])} ({x['n']}번){mark}")
                else:
                    lines.append(f"{k}점 거래 없음{mark}")
            msgs += pack(lines, 200)
        verdicts.append(verdict(name, rows, hold_total, cur, r["strats"], r["live"]))

    blocks = ["🧪 ⭐ 안정성 검사 (100만원씩)\n앞1년·뒤1년 둘 다 수익이면 ✅"]
    blocks += ["\n".join(stability_lines(market, r)) for market, r in results.items()]
    msgs += pack(blocks, 200)                     # 시장별 묶음은 쪼개지지 않게

    lines = [f"🔵 매도 알림 맞았나? ({SELL_CHECK_DAYS}일 뒤 실제로 내렸는지)"]
    for market, r in results.items():
        x = np.array(r["sells"])
        name = rt.MARKET_NAME[market]
        if len(x):
            lines.append(f"{name} 10번 중 {round((x < 0).mean() * 10)}번 맞음 ({len(x)}번 중)")
        else:
            lines.append(f"{name} 매도 알림 없음")
    lines.append("5번이면 동전 던지기 수준이에요")
    msgs += pack(lines)

    msgs += pack(["🧭 결론"] + verdicts + notes(results))
    return msgs


def notes(results):
    out = []
    if any(r.get("earn_ok") is False for r in results.values()):
        out.append("⚠️ 실적 발표일을 못 받아서 실적 피하기는 빠진 결과예요")
    return out + ["과거 성적이 미래 수익을 보장하진 않아요"]


def all_verdicts(results):
    out = []
    for market, r in results.items():
        rows, hold_total, _ = market_result(r)
        out.append(verdict(rt.MARKET_NAME[market], rows, hold_total, r["cur"], r["strats"], r["live"]))
    return out


def build_short(results):
    """카톡엔 요약만: 시장별 한 줄 + 결론. 표·그래프는 '가상 시뮬레이션' 버튼 페이지에서"""
    lines = ["📊 2년 가상 시뮬레이션 업데이트", "알림마다 100만원씩 샀다고 치면"]
    for market, r in results.items():
        rows, hold_total, _ = market_result(r)
        new, old = rows.get((r["live"], r["cur"])), rows.get(("①", r["cur"]))
        part = [f"⭐ {won(new['total'])}" if new else "⭐ 거래 없음"]
        if old:
            part.append(f"예전 {won(old['total'])}")
        if hold_total is not None:
            part.append(f"보유 {won(hold_total)}")
        lines.append(f"{rt.MARKET_NAME[market]} " + " · ".join(part))
    lines.append("👇 '가상 시뮬레이션'을 누르면 표·그래프로 봐요")
    return pack(lines, 200) + pack(["🧭 결론"] + all_verdicts(results) + notes(results))


# ---------- 표·그래프 페이지 ----------

def _cls(v):
    return "pos" if v > 0.05 else ("neg" if v < -0.05 else "")


def cum_chart(series, span):
    """누적 손익(만원) 선 그래프. series: [(이름, 색, 점선?, [(시각, 거래 손익)])]"""
    W, H, L, R, T, B = 640, 220, 46, 12, 12, 26
    pts_all = []
    lines_xy = []
    for name, color, dash, trades in series:
        cum, pts = 0.0, [(span[0], 0.0)]
        for t, v in sorted(trades, key=lambda x: x[0]):
            cum += v
            pts.append((t, cum))
        pts.append((span[1], cum))
        lines_xy.append((name, color, dash, pts))
        pts_all += [y for _, y in pts]
    lo, hi = min(pts_all + [0.0]), max(pts_all + [0.0])
    if hi - lo < 1:
        hi, lo = hi + 1, lo - 1
    t0, t1 = span[0].timestamp(), span[1].timestamp()

    def X(t):
        return L + (t.timestamp() - t0) / max(t1 - t0, 1) * (W - L - R)

    def Y(v):
        return T + (hi - v) / (hi - lo) * (H - T - B)

    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="누적 손익 그래프">']
    for v in (hi, (hi + lo) / 2, lo):
        out.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" class="grid"/>'
                   f'<text x="{L - 6}" y="{Y(v) + 4:.1f}" text-anchor="end" class="ax">{v:,.0f}</text>')
    out.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(0):.1f}" y2="{Y(0):.1f}" class="zero"/>')
    mid = span[0] + (span[1] - span[0]) / 2
    for t, anchor in ((span[0], "start"), (mid, "middle"), (span[1], "end")):
        out.append(f'<text x="{X(t):.1f}" y="{H - 6}" text-anchor="{anchor}" class="ax">{t:%y.%m}</text>')
    for name, color, dash, pts in lines_xy:
        d = " ".join(f"{X(t):.1f},{Y(v):.1f}" for t, v in pts)
        style = ' stroke-dasharray="5 4"' if dash else ""
        out.append(f'<polyline points="{d}" fill="none" stroke="{color}" stroke-width="2.2"{style}/>')
    out.append("</svg>")
    legend = "".join(f'<span><i style="background:{c}"></i>{html.escape(n)}</span>' for n, c, _, _ in series)
    return "".join(out) + f'<div class="legend">{legend}</div>'


def market_section(market, r):
    name, cur, live = rt.MARKET_NAME[market], r["cur"], r["live"]
    rows, hold_total, n_hold = market_result(r)
    new, old = rows.get((live, cur)), rows.get(("①", cur))
    e = html.escape

    def kpi(title, x, sub):
        if x is None:
            return f'<div class="kpi"><span>{title}</span><b>거래 없음</b><em>{sub}</em></div>'
        return f'<div class="kpi"><span>{title}</span><b class="{_cls(x)}">{won(x)}</b><em>{sub}</em></div>'

    out = [f'<section><h2>{e(name)} <small>{n_hold}종목 · 기준 {cur}점</small></h2><div class="kpis">']
    out.append(kpi("⭐ 새 알림", new["total"] if new else None,
                   f'{new["n"]}번 · 승률 {new["win"] / new["n"] * 100:.0f}%' if new else "2년간 매수 없음"))
    out.append(kpi("예전 알림", old["total"] if old else None,
                   f'{old["n"]}번 · 승률 {old["win"] / old["n"] * 100:.0f}%' if old else ""))
    out.append(kpi("그냥 보유", hold_total, f"{n_hold}종목 100만원씩"))
    out.append("</div>")

    if r["span"][0] is not None:
        series = [("⭐ 새 알림", "var(--star)", False, [(x["tx"], x["ret"] * UNIT) for x in r["live_trades"]]),
                  ("예전 알림", "var(--old)", True, [(x["tx"], x["ret"] * UNIT) for x in r["old_trades"]])]
        out.append('<h3>2년 동안 쌓인 손익 (만원)</h3>' + cum_chart(series, r["span"]))

    biggest = max([abs(x["total"]) for x in rows.values()] + [1])
    out.append('<h3>방법별 비교</h3><table><tr><th>방법</th><th>2년 손익</th><th>승률</th><th>거래</th></tr>')
    for sid, title, _ in r["strats"]:
        x = rows.get((sid, cur))
        star = " ⭐" if sid == live else ""
        if not x:
            out.append(f'<tr><td>{sid} {e(title)}{star}</td><td colspan="3" class="mut">거래 없음</td></tr>')
            continue
        w = abs(x["total"]) / biggest * 100
        out.append(f'<tr{" class=hl" if sid == live else ""}><td>{sid} {e(title)}{star}</td>'
                   f'<td><div class="bar {_cls(x["total"])}" style="width:{w:.0f}%"></div>'
                   f'<span class="{_cls(x["total"])}">{won(x["total"])}</span></td>'
                   f'<td>{x["win"] / x["n"] * 100:.0f}%</td><td>{x["n"]}번</td></tr>')
    out.append("</table>")

    out.append('<h3>⭐ 새 알림 안전도 기준별</h3><table><tr><th>기준</th><th>2년 손익</th><th>승률</th><th>거래</th></tr>')
    for k in r["ks"]:
        x = rows.get((live, k))
        mark = " ← 지금" if k == cur else ""
        if x:
            out.append(f'<tr><td>{k}점{mark}</td><td class="{_cls(x["total"])}">{won(x["total"])}</td>'
                       f'<td>{x["win"] / x["n"] * 100:.0f}%</td><td>{x["n"]}번</td></tr>')
        else:
            out.append(f'<tr><td>{k}점{mark}</td><td colspan="3" class="mut">거래 없음</td></tr>')
    out.append("</table>")

    st = stability_lines(market, r)
    out.append('<h3>🧪 안정성 검사</h3><ul class="st">' + "".join(f"<li>{e(x.strip())}</li>" for x in st) + "</ul>")
    v = verdict(name, rows, hold_total, cur, r["strats"], live).split("\n")
    out.append('<div class="verdict">' + "<br>".join(e(x.strip()) for x in v) + "</div></section>")
    return "".join(out)


def build_report(results, made):
    e = html.escape
    sells = []
    for market, r in results.items():
        x = np.array(r["sells"])
        txt = f"10번 중 {round((x < 0).mean() * 10)}번 맞음 ({len(x)}번 중)" if len(x) else "매도 알림 없음"
        sells.append(f"<tr><td>{e(rt.MARKET_NAME[market])}</td><td>{txt}</td></tr>")
    body = "".join(market_section(m, r) for m, r in results.items())
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>2년 가상 시뮬레이션</title>
<style>
:root{{--bg:#f6f7f9;--card:#fff;--ink:#191f28;--mut:#8b95a1;--line:#e5e8eb;--pos:#f04452;--neg:#3182f6;
--star:#f04452;--old:#8b95a1;--hl:#fff7e6}}
@media (prefers-color-scheme:dark){{:root{{--bg:#101215;--card:#1b1e23;--ink:#e9ecef;--mut:#8b95a1;
--line:#2b3036;--hl:#2a2416}}}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.5 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}}
main{{max-width:720px;margin:0 auto;padding:16px}}
header h1{{font-size:21px;margin:8px 0 2px}}header p{{margin:0;color:var(--mut);font-size:13px}}
section{{background:var(--card);border-radius:16px;padding:16px;margin:14px 0}}
h2{{font-size:18px;margin:0 0 10px}}h2 small{{color:var(--mut);font-weight:400;font-size:13px}}
h3{{font-size:14px;margin:18px 0 6px;color:var(--mut)}}
.kpis{{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}}
.kpi{{border:1px solid var(--line);border-radius:12px;padding:10px}}
.kpi span{{display:block;font-size:12px;color:var(--mut)}}.kpi b{{display:block;font-size:18px;margin:2px 0}}
.kpi em{{font-style:normal;font-size:11px;color:var(--mut)}}
.pos{{color:var(--pos)}}.neg{{color:var(--neg)}}.mut{{color:var(--mut)}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th{{text-align:left;color:var(--mut);font-weight:500;border-bottom:1px solid var(--line);padding:6px 4px}}
td{{border-bottom:1px solid var(--line);padding:7px 4px;position:relative}}
tr.hl td{{background:var(--hl)}}
td .bar{{position:absolute;left:0;top:6px;bottom:6px;opacity:.15;border-radius:4px}}
td .bar.pos{{background:var(--pos)}}td .bar.neg{{background:var(--neg)}}td span{{position:relative}}
svg{{width:100%;height:auto;display:block}}
svg .grid{{stroke:var(--line)}}svg .zero{{stroke:var(--mut);stroke-width:1}}
svg .ax{{fill:var(--mut);font-size:11px}}
.legend{{display:flex;gap:14px;font-size:12px;color:var(--mut);margin-top:4px}}
.legend i{{display:inline-block;width:14px;height:3px;margin-right:5px;vertical-align:middle}}
ul.st{{margin:0;padding-left:18px;font-size:13px}}
.verdict{{margin-top:12px;padding:10px 12px;border-radius:10px;background:var(--bg);font-size:13px}}
footer{{color:var(--mut);font-size:12px;padding:8px 4px 30px}}
</style></head><body><main>
<header><h1>📊 2년 가상 시뮬레이션</h1>
<p>{made:%Y-%m-%d %H:%M} 기준 · 알림이 올 때마다 100만원씩 안전 매수가에 샀다고 치고 지난 2년을 다시 돌려 봤어요.
수수료 {FEE * 100:.1f}% 포함 · 수익은 빨강, 손실은 파랑</p></header>
{body}
<section><h2>🔵 매도 알림이 맞았나?</h2><p class="mut" style="margin:0 0 6px;font-size:13px">
매도 알림 {SELL_CHECK_DAYS}일 뒤 실제로 내렸는지 · 10번 중 5번이면 동전 던지기 수준</p>
<table>{"".join(sells)}</table></section>
<section><h2>방법 설명</h2><ul class="st">
<li>① 예전 알림: 손실 방지 장치 없이 안전도만 보고 알림</li>
<li>② 시장필터 ③ 추세필수 ④ 눌림매수 ⑤ 반매도: 장치를 하나씩만 켠 경우</li>
<li>⑥ 장치전부: ②~⑤ + 변동성·실적 발표 피하기·하루 한 번</li>
<li>⑦ ⑥ + 성적표(과거 수익 난 종목만) + 연속 손실 자동 멈춤</li>
<li>⭐ 지금 실제로 쓰고 있는 새 알림 설정</li></ul></section>
<footer>{"<br>".join(e(x) for x in notes(results))}</footer>
</main></body></html>"""





def drawdown(vals):
    """누적 손익이 가장 높았던 때에서 가장 많이 빠졌던 폭 (음수)"""
    peak = cum = worst = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        worst = min(worst, cum - peak)
    return worst


def stability_lines(market, r):
    name, trades, span = rt.MARKET_NAME[market], r["live_trades"], r["span"]
    if not trades or span[0] is None:
        return [f"{name} 거래 없음"]
    mid = span[0] + (span[1] - span[0]) / 2
    a = sum(x["ret"] for x in trades if x["ta"] < mid) * UNIT
    b = sum(x["ret"] for x in trades if x["ta"] >= mid) * UNIT
    mark = "✅" if a > 0 and b > 0 else ("❌" if a <= 0 and b <= 0 else "⚠️")
    seq = sorted(trades, key=lambda x: x["tx"])
    streak = longest = 0
    for x in seq:
        streak = streak + 1 if x["ret"] <= 0 else 0
        longest = max(longest, streak)
    cap = (rt.MAX_LOSS_USD / rt.BUDGET_USD) if market == "us" else (rt.MAX_LOSS_KRW / rt.BUDGET_KRW)
    full = [x["ret"] * UNIT for x in seq]
    sized = [x["ret"] * UNIT * min(1.0, cap / max(x.get("risk", cap), 1e-9)) for x in seq]
    return [f"{name} 앞1년 {won(a)} · 뒤1년 {won(b)} {mark}",
            f" 최대낙폭 {won(drawdown(full))} · 연속손실 최대 {longest}번",
            f" 손절 {cap * UNIT:.0f}만원 제한 시 {won(sum(sized))} · 낙폭 {won(drawdown(sized))}"]


def verdict(name, rows, hold_total, cur, strats, live):
    """시장마다 몇 줄로: 새 설정 vs 예전, 더 좋은 조합, 그냥 보유와 비교"""
    titles = {sid: title for sid, title, _ in strats}
    new, old = rows.get((live, cur)), rows.get(("①", cur))
    if not new:
        line = f"{name}: 새 설정은 2년간 매수 0번 (손실도 0)"
    else:
        line = f"{name}: 새 설정 {won(new['total'])}" + (f" (예전 {won(old['total'])})" if old else "")
        if old and abs(new["total"] - old["total"]) < 1:
            line += "\n → 예전과 거의 같음"
        elif old and new["total"] > old["total"]:
            diff = won(new["total"] - old["total"], False)
            line += f"\n → 예전보다 {diff} {'덜 잃음' if new['total'] <= 0 else '더 벎'} ✅"
        elif old:
            line += "\n → 예전보다 나빠짐 ⚠️"
        if new["n"] < MIN_N:
            line += f"\n → 거래 {new['n']}번뿐이라 판단은 일러요"

    good = {key: x for key, x in rows.items() if x["n"] >= MIN_N}
    if good:
        best = max(good, key=lambda q: good[q]["total"])
        b = good[best]
        if b["total"] < 1:
            line += "\n → 어떤 방법도 수익 거의 없음, 매수 알림은 참고만"
        elif best != (live, cur) and (not new or b["total"] > new["total"]):
            line += f"\n → 최고: {best[0]} {titles[best[0]]} {best[1]}점 {won(b['total'])} ({b['n']}번)"
    if hold_total is not None and hold_total > max(new["total"] if new else 0, 0):
        line += f"\n → 새 설정보다 그냥 보유({won(hold_total)})가 나음"
    return line


if __name__ == "__main__":
    main()
