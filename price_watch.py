# 가격 알림 (목표가 · 손절가): 사용자가 앱에서 정한 가격에 닿으면 그 휴대폰에만 푸시를 보내요.
# 5분마다 엔진 실행 끝에 돌고, 장이 열린 시장 종목만 봐요 (국장 시세는 15~20분 늦을 수 있어요).
# 공개 실행 기록에는 개수만 남기고, 종목 이름·가격·휴대폰 주소는 찍지 않아요.

from datetime import timedelta

import pandas as pd

import app_bridge as ab

STALE = timedelta(minutes=45)      # 마지막 5분봉이 이보다 오래되면 (거래 정지 등) 판단하지 않음
LOOK = timedelta(minutes=15)       # 마지막 봉 기준 15분 동안 고가·저가가 닿았는지 봄 (5분마다 도니까 놓치지 않게)


def _ts(x):
    t = pd.Timestamp(x)
    return t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")


def touched(df, kind, price, since, now):
    """5분봉에서 알림을 만든 뒤 · 마지막 봉 기준 최근 15분 동안 고가가 목표 이상 / 저가가 손절 이하였나 → 지금 가격 또는 None
    (국장처럼 시세가 늦게 오는 곳도 '마지막 봉' 기준으로 보니까 빈틈이 안 생겨요)"""
    if df is None or df.empty:
        return None
    d = df.dropna(subset=["Close"])
    if d.empty:
        return None
    idx = pd.DatetimeIndex([_ts(t) for t in d.index])
    if pd.Timestamp(now) - idx[-1] > STALE:
        return None
    start = max(_ts(since) - timedelta(minutes=5), idx[-1] - LOOK)
    w = d[idx >= start]
    if w.empty:
        return None
    hi = float(w["High"].max()) if "High" in w else float(w["Close"].max())
    lo = float(w["Low"].min()) if "Low" in w else float(w["Close"].min())
    hit = hi >= price if kind == "up" else lo <= price
    return round(float(d["Close"].iloc[-1]), 6) if hit else None


def money(market, v):
    if market == "us":
        return f"${v:,.2f}"
    return f"{v:,.0f}원" if v >= 100 else f"{v:,.2f}원"


def message(r, last, session_name=""):
    up = r["kind"] == "up"
    name = r.get("name") or r["yt"]
    title = f"{'🎯 목표가' if up else '🛑 손절가'} 도달 · {name}"
    body = f"정해 둔 {money(r['market'], float(r['price']))} {'이상' if up else '이하'}에 닿았어요. 지금 {money(r['market'], last)}"
    if r["market"] == "kr":
        body += " (15~20분 늦은 시세)"
    elif r["market"] == "us" and session_name:
        body += f" ({session_name} 가격)"
    return {"title": title, "body": body, "url": "./#/hold", "tag": f"pa-{r['id']}"}


def us_ext_open(rt, now):
    """미장 프리마켓(04:00) ~ 애프터마켓(20:00, 조기 마감일 17:00) — 미국 동부시간, 거래일만"""
    s = rt.session("us", now)
    if not s:
        return False
    t = now.astimezone(rt.TZ["us"])
    m = t.hour * 60 + t.minute
    return 240 <= m < (1020 if s[1] < 960 else 1200)


def us_name(rt, now):
    t = now.astimezone(rt.TZ["us"])
    m = t.hour * 60 + t.minute
    return "프리마켓" if m < 570 else "애프터마켓" if m >= 960 or rt.session("us", now)[1] <= m else ""


def watching(rt, market, now):
    return us_ext_open(rt, now) if market == "us" else rt.is_open(market, now)


def run(rt, now):
    if not ab.enabled():
        return ""
    rows = ab.get_price_alerts()
    if not rows:
        return ""
    live = [r for r in rows if watching(rt, r["market"], now)]
    if not live:
        return f" · 가격 알림 대기 {len(rows)}개"
    us = sorted({r["yt"] for r in live if r["market"] == "us"})
    other = sorted({r["yt"] for r in live if r["market"] != "us"})
    data = rt.fetch_many(other, "2d", "5m") if other else {}
    if us:                                   # 미장은 프리·애프터마켓 가격까지
        data.update(rt.fetch_many(us, "2d", "5m", prepost=True))
    hits = []
    for r in live:
        try:
            last = touched(data.get(r["yt"]), r["kind"], float(r["price"]), r["created_at"], now)
        except Exception:
            last = None
        if last is not None:
            hits.append((r, last))
    sent = fired = 0
    if hits:
        subs = {s["endpoint"]: s for s in ab.get_subs()}
        k = now.astimezone(rt.KST)
        for r, last in hits:
            if not ab.fire_price_alert(r["id"], last, now):
                continue
            fired += 1
            s = subs.get(r["endpoint"])
            if not s or not ab.VAPID_PRIVATE:
                continue
            push = message(r, last, us_name(rt, now) if r["market"] == "us" else "")
            if (s.get("prefs") or {}).get("quiet") and k.hour < 7:
                push["silent"] = True              # 방해 금지 시간엔 소리·진동 없이
            res = ab.push_one(s["sub"], push)
            if res == "ok":
                sent += 1
            elif res == "gone":
                try:
                    ab.delete_sub(r["endpoint"])   # 알림 목록도 같이 지워짐
                except Exception:
                    pass
    return f" · 가격 알림 {len(rows)}개 중 {fired}개 울림 (푸시 {sent}건)" if fired else f" · 가격 알림 {len(rows)}개 확인"
