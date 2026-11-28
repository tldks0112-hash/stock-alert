# 매수 신호 실제 성적 (2026-11-28 추가)
# 앱에 저장된 매수 알림을 하루 한 번 다시 확인해서 → kv 'sig_stats'
#   - 신호 뒤 1 · 3 · 5 · 20거래일 수익률 (알림 때 가격 기준, 수수료 · 세금 전)
#   - 20거래일 안에 목표가(매도 기준가)와 손절가 중 어디에 먼저 닿았는지 (같은 날 둘 다면 손절로 셈)
#   - 시장별 · '추천' 조건 통과 알림만 · 종목별 승률
# 공개 실행 기록에는 개수만 남겨요.

from datetime import timedelta
from zoneinfo import ZoneInfo

import pandas as pd
import requests

import app_bridge as ab

H = (1, 3, 5, 20)
WINDOW = 20
DAYS_BACK = 200
KST = ZoneInfo("Asia/Seoul")


def fetch_alerts(since):
    r = ab._check(requests.get(f"{ab.URL}/rest/v1/alerts", timeout=20, headers=ab._headers(), params={
        "select": "id,created_at,market,yt,name,price,buy,stop,sell,score,grade,misses,flags",
        "side": "eq.buy", "created_at": f"gte.{since.isoformat()}", "order": "created_at.asc", "limit": "5000"}))
    return [x for x in r.json() if x.get("yt") and x.get("price")]


def outcome(a, df, tz):
    """알림 하나 → {r1, r3, r5, r20, hit: target|stop|None, days, done, win}"""
    price = float(a["price"])
    if df is None or not len(df) or price <= 0:
        return None
    df = df.dropna(subset=["Close"])
    t0 = pd.Timestamp(a["created_at"])
    loc = df.index.tz_convert(tz) if df.index.tz is not None else df.index
    dates = pd.Index(loc.date)
    if len(dates) == 0 or dates[0] > t0.tz_convert(tz).date():
        return None
    after = df[dates > t0.tz_convert(tz).date()]
    out = {}
    for h in H:
        if len(after) >= h:
            out[f"r{h}"] = round((float(after["Close"].iloc[h - 1]) / price - 1) * 100, 2)
    tgt, stp = a.get("sell"), a.get("stop")
    hit, days = None, None
    if tgt and stp:
        for k in range(min(len(after), WINDOW)):
            lo, hi = float(after["Low"].iloc[k]), float(after["High"].iloc[k])
            if lo <= stp:
                hit, days = "stop", k + 1
                break
            if hi >= tgt:
                hit, days = "target", k + 1
                break
    done = hit is not None or len(after) >= WINDOW
    win = (hit == "target") if hit else (out.get("r20", 0) > 0 if len(after) >= WINDOW else None)
    return {**out, "hit": hit, "days": days, "done": done, "win": win, "n_after": int(len(after))}


def agg(rows):
    out = {"n": len(rows)}
    for h in H:
        xs = [x[f"r{h}"] for x in rows if f"r{h}" in x]
        out[f"r{h}"] = {"n": len(xs), "avg": round(sum(xs) / len(xs), 2) if xs else None,
                        "up": round(sum(v > 0 for v in xs) / len(xs) * 100) if xs else None}
    done = [x for x in rows if x["done"]]
    out["done"] = len(done)
    if done:
        out["tgt"] = round(sum(x["hit"] == "target" for x in done) / len(done) * 100)
        out["stp"] = round(sum(x["hit"] == "stop" for x in done) / len(done) * 100)
        w = [x for x in done if x["win"] is not None]
        out["win"] = round(sum(bool(x["win"]) for x in w) / len(w) * 100) if w else None
    return out


def rec_rules():
    try:
        for p in (ab.get_kv("presets") or {}).get("list", []):
            if p.get("id") == "추천" and isinstance(p.get("rules"), dict):
                return p["rules"]
    except Exception:
        pass
    return None


def build(rt, now):
    alerts = fetch_alerts(now - timedelta(days=DAYS_BACK))
    if not alerts:
        return {"at": now.isoformat(), "h": list(H), "all": {"n": 0}, "mk": {}, "rec": None, "tk": {}, "recent": []}
    by = {}
    for a in alerts:
        by.setdefault(a["market"], set()).add(a["yt"])
    data = {}
    for mk, ts in by.items():
        ts = sorted(ts)
        for i in range(0, len(ts), 40):
            data.update(rt.fetch_many(ts[i:i + 40], "1y", "1d"))
    rules = rec_rules()
    rows = []
    for a in alerts:
        try:
            o = outcome(a, data.get(a["yt"]), rt.TZ.get(a["market"], rt.KST))
        except Exception:
            o = None
        if o is None:
            continue
        rec = bool(rules and rules.get(a["market"]) and ab.passes({**a, "side": "buy"}, rules[a["market"]]))
        rows.append({**o, "id": a["id"], "yt": a["yt"], "name": a.get("name"), "m": a["market"], "at": a["created_at"],
                     "score": a.get("score"), "rec": rec, "cancel": bool((a.get("flags") or {}).get("cancel"))})
    mks = sorted({x["m"] for x in rows})
    tk = {}
    for x in rows:
        tk.setdefault(x["yt"], []).append(x)
    tks = {}
    for yt, xs in sorted(tk.items(), key=lambda kv: -len(kv[1]))[:80]:
        g = agg(xs)
        tks[yt] = {"name": xs[-1]["name"], "m": xs[-1]["m"], "n": g["n"], "done": g["done"], "win": g.get("win"),
                   "tgt": g.get("tgt"), "stp": g.get("stp"), "r5": g["r5"]["avg"], "r20": g["r20"]["avg"]}
    recent = [{k: x.get(k) for k in ("id", "yt", "name", "m", "at", "score", "rec", "r1", "r5", "r20", "hit", "days", "cancel")}
              for x in sorted(rows, key=lambda x: x["at"], reverse=True)[:30]]
    recs = [x for x in rows if x["rec"]]
    return {"at": now.isoformat(), "from": rows[0]["at"] if rows else None, "h": list(H), "window": WINDOW,
            "all": agg(rows), "mk": {m: agg([x for x in rows if x["m"] == m]) for m in mks},
            "rec": {"all": agg(recs), "mk": {m: agg([x for x in recs if x["m"] == m]) for m in mks}} if rules else None,
            "tk": tks, "recent": recent}


def run(rt, book, now):
    """하루 한 번 (한국 시간 아침 7시 반 이후, 미장 마감 뒤)"""
    if not ab.enabled():
        return ""
    k = now.astimezone(KST)
    flags = book["flags"]
    if flags.get("sig_stats") == k.date().isoformat() or (k.hour, k.minute) < (7, 30):
        return ""
    flags["sig_stats"] = k.date().isoformat()
    out = build(rt, now)
    ab.put_kv("sig_stats", out)
    return f" · 신호 성적 {out['all'].get('n', 0)}건"
