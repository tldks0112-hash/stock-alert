# 매수 알림 전에 한 번 더 보는 것들 (2026-11-28 추가)
#   1) 시장 전체 추세: S&P500 · 나스닥 · SOX(국장은 코스피 · 코스닥 · SOX, 코인은 비트코인) → 상승장 · 횡보장 · 하락장
#   2) 기관 · 외국인 수급 (국장): 순매수 · 순매도 · 거래량 급증 · 주가와 같은 방향인지
#   3) 가짜 돌파: 저항선 돌파 때 거래량 · 돌파 뒤 다시 하락 · 지지선 이탈
#   4) 경제 일정: CPI · PCE · FOMC · 고용보고서 · 엔비디아 · 반도체 실적 발표 전후
#   5) 레버리지 ETF: SOXL · TQQQ · TECL 등은 일반 주식과 따로 (변동성 · 최대 손실 · 분할매수 제한 · 급락 때 차단)
# 데이터를 못 받으면 막지 않고 지나가요 (기존 알림이 갑자기 끊기지 않게).
# 공개 실행 기록에는 종목 이름을 남기지 않아요.

import re
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
KST = ZoneInfo("Asia/Seoul")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

# ---------- 1. 시장 전체 추세 ----------

REGIME_IDX = {
    "us": [("S&P500", "^GSPC"), ("나스닥", "^IXIC"), ("SOX", "^SOX")],
    "kr": [("코스피", "^KS11"), ("코스닥", "^KQ11"), ("SOX", "^SOX")],
    "crypto": [("비트코인", "BTC-KRW")],
}
MAIN = {"us": ["S&P500", "나스닥"], "kr": ["코스피", "코스닥"], "crypto": ["비트코인"]}
SEMI_MAIN = {"us": ["S&P500", "나스닥", "SOX"], "kr": ["코스피", "SOX"], "crypto": ["비트코인"]}
IDX_TZ = {"^GSPC": ET, "^IXIC": ET, "^SOX": ET, "^KS11": KST, "^KQ11": KST, "BTC-KRW": timezone.utc}
STATE_KO = {"up": "상승장", "side": "횡보장", "down": "하락장"}
STATE_N = {"up": 1, "side": 0, "down": -1}
CRASH = {"us": (-3.0, -8.0), "kr": (-3.0, -8.0), "crypto": (-6.0, -15.0)}   # 급락: (하루 %, 20일 고점 대비 %)
DOWN_MIN_SCORE = 8                                                       # 하락장에서 앱에 남기는 매수 신호 점수

SEMI_US = {"NVDA", "AMD", "AVGO", "TSM", "MU", "INTC", "QCOM", "AMAT", "LRCX", "KLAC", "ASML", "ARM", "MRVL", "TXN",
           "ADI", "ON", "MCHP", "NXPI", "MPWR", "TER", "SMCI", "SOXX", "SMH", "SOXL", "SOXS", "USD", "NVDL"}
SEMI_KR = {"005930", "000660", "042700", "000990", "058470", "240810", "403870", "039030", "095340", "357780",
           "319660", "036930", "084370", "005290"}


def regime_tickers(market):
    return [t for _, t in REGIME_IDX.get(market, [])]


def is_semi(ticker, category=""):
    code = ticker.split(".")[0]
    return ticker in SEMI_US or code in SEMI_KR or "반도체" in (category or "")


def _loc_dates(index, tz):
    loc = index.tz_convert(tz) if index.tz is not None else index
    return pd.Index(loc.date)


def index_state(df, tz, now, crash):
    """지수 하나: 어제까지 일봉으로 추세(상승·횡보·하락) + 오늘 포함 급락 여부"""
    if df is None or len(df) < 120:
        return None
    df = df.dropna(subset=["Close"])
    today = now.astimezone(tz).date()
    closed = df[_loc_dates(df.index, tz) < today]
    if len(closed) < 210:
        return None
    c = closed["Close"]
    ma50, ma200 = c.rolling(50).mean(), c.rolling(200).mean()
    last, m50, m200 = float(c.iloc[-1]), float(ma50.iloc[-1]), float(ma200.iloc[-1])
    if not (np.isfinite(m50) and np.isfinite(m200)):
        return None
    slope = float(ma50.iloc[-1] / ma50.iloc[-11] - 1)
    above, gold = last > m200, m50 > m200
    if above and gold and slope > 0:
        st = "up"
    elif not above and (not gold or slope < 0):
        st = "down"
    else:
        st = "side"
    cur = float(df["Close"].iloc[-1])
    live = len(df) > len(closed)
    d1 = (cur / last - 1) * 100 if live else (last / float(c.iloc[-2]) - 1) * 100
    hi20 = float(df["High"].iloc[-20:].max()) if "High" in df else float(df["Close"].iloc[-20:].max())
    dd20 = (cur / hi20 - 1) * 100
    return {"st": st, "gap": round((last / m200 - 1) * 100, 1), "slope": round(slope * 100, 2),
            "r20": round((last / float(c.iloc[-21]) - 1) * 100, 1), "d1": round(d1, 2), "dd20": round(dd20, 1),
            "crash": bool(d1 <= crash[0] or dd20 <= crash[1]), "day": str(closed.index[-1].date())}


def combine(states):
    xs = [STATE_N[s] for s in states if s]
    if not xs:
        return None
    a = sum(xs) / len(xs)
    return "up" if a >= 0.5 else ("down" if a <= -0.5 else "side")


def regime(daily, market, now):
    """시장 하나 → {st, semi, crash, semi_crash, items:[{n, st, gap, d1, ...}]} (지수를 못 받으면 None)"""
    items = {}
    for name, t in REGIME_IDX.get(market, []):
        try:
            x = index_state(daily.get(t), IDX_TZ.get(t, timezone.utc), now, CRASH[market])
        except Exception:
            x = None
        if x:
            items[name] = x
    if not items:
        return None
    main = [items[n] for n in MAIN[market] if n in items]
    semi = [items[n] for n in SEMI_MAIN[market] if n in items]
    st = combine([x["st"] for x in main]) or combine([x["st"] for x in items.values()])
    return {"st": st, "semi": combine([x["st"] for x in semi]) or st,
            "crash": any(x["crash"] for x in main), "semi_crash": any(x["crash"] for x in semi),
            "items": [{"n": n, **x} for n, x in items.items()]}


def state_for(R, semi):
    """종목에 맞는 시장 상태: 반도체 종목은 SOX까지 함께 봄 → (상태, 급락?)"""
    if not R:
        return None, False
    return (R["semi"], R["semi_crash"]) if semi else (R["st"], R["crash"])


# ---------- 2. 기관 · 외국인 수급 (국장) ----------

AGREE_KO = {"up_ok": "주가 상승 + 외국인·기관 매수 (방향 일치)",
            "up_weak": "주가는 오르는데 외국인·기관은 순매도 (방향 불일치)",
            "dn_buy": "주가는 내렸는데 외국인·기관은 순매수 (모으는 중일 수 있음)",
            "dn_ok": "주가 하락 + 외국인·기관 매도 (방향 일치 · 약세)"}


def _num(s):
    if s is None:
        return None
    s = re.sub(r"[^\d.\-+]", "", str(s))
    try:
        return float(s)
    except ValueError:
        return None


def _flow_api(code):
    """네이버 증권 모바일 (JSON) — 필드 이름이 조금 바뀌어도 찾도록"""
    r = requests.get(f"https://m.stock.naver.com/api/stock/{code}/trend", params={"pageSize": 30}, headers=UA, timeout=10)
    r.raise_for_status()
    js = r.json()
    items = js if isinstance(js, list) else next((v for v in (js or {}).values() if isinstance(v, list)), [])
    rows = []
    for it in items:
        if not isinstance(it, dict):
            continue
        low = {k.lower(): k for k in it}
        fk = next((low[k] for k in low if "foreign" in k and "purebuy" in k), None)
        ok_ = next((low[k] for k in low if "organ" in k and "purebuy" in k), None)
        dk = next((low[k] for k in ("bizdate", "localtradeddate", "tradedate", "date") if k in low), None)
        if not (fk and ok_ and dk):
            continue
        ck = low.get("closeprice")
        vk = next((low[k] for k in low if "accumulatedtradingvolume" in k), None)
        f, i = _num(it[fk]), _num(it[ok_])
        d = re.sub(r"\D", "", str(it[dk]))[:8]
        if f is None or i is None or len(d) != 8:
            continue
        rows.append({"d": d, "f": f, "i": i, "c": _num(it.get(ck)) if ck else None, "v": _num(it.get(vk)) if vk else None})
    return rows


def _flow_html(code):
    """네이버 증권 '외국인·기관' 표 (예비): 날짜 · 종가 · 전일비 · 등락률 · 거래량 · 기관 · 외국인 · ..."""
    r = requests.get("https://finance.naver.com/item/frgn.naver", params={"code": code, "page": 1}, headers=UA, timeout=10)
    r.raise_for_status()
    html = r.content.decode("euc-kr", "replace")
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>|&nbsp;|\s+", "", td) for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) < 7 or not re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", cells[0]):
            continue
        f, i = _num(cells[6]), _num(cells[5])
        if f is None or i is None:
            continue
        rows.append({"d": cells[0].replace(".", ""), "c": _num(cells[1]), "v": _num(cells[4]), "i": i, "f": f})
    return rows


def flow_rows(code):
    for fn in (_flow_api, _flow_html):
        try:
            rows = fn(code)
        except Exception:
            rows = []
        if len(rows) >= 6:
            return sorted(rows, key=lambda x: x["d"], reverse=True)
    return []


def flow_eval(rows, price=None):
    """최근 일별 순매매(주) → 요약 (억원 단위, 5일 합, 연속 일수, 거래량 급증, 주가와 같은 방향인지)"""
    rows = [r for r in rows if r.get("f") is not None and r.get("i") is not None][:30]
    if len(rows) < 6:
        return None
    px = rows[0].get("c") or price
    if not px:
        return None
    eok = lambda q: round(q * px / 1e8, 1)

    def streak(k):
        s0 = np.sign(rows[0][k])
        if not s0:
            return 0
        n = 0
        for r in rows:
            if np.sign(r[k]) != s0:
                break
            n += 1
        return int(n * s0)

    f5, i5 = sum(r["f"] for r in rows[:5]), sum(r["i"] for r in rows[:5])
    c0, c5 = rows[0].get("c"), rows[5].get("c")
    pr5 = (c0 / c5 - 1) if c0 and c5 else None
    vols = [r["v"] for r in rows if r.get("v")]
    vr = vols[0] / (sum(vols[1:21]) / len(vols[1:21])) if len(vols) >= 11 and sum(vols[1:21]) > 0 else None
    net = f5 + i5
    agree = None
    if pr5 is not None:
        agree = ("up_ok" if net > 0 else "up_weak") if pr5 >= 0 else ("dn_buy" if net > 0 else "dn_ok")
    return {"day": rows[0]["d"], "f1": eok(rows[0]["f"]), "i1": eok(rows[0]["i"]), "f5": eok(f5), "i5": eok(i5),
            "fs": streak("f"), "is": streak("i"), "pr5": round(pr5 * 100, 1) if pr5 is not None else None,
            "vr": round(vr, 2) if vr else None, "spike": bool(vr and vr >= 2), "agree": agree,
            "ok": not (f5 < 0 and i5 < 0)}


def get_flow(code, cache, now, price=None, key=None):
    """하루 한 번만 받음 (실패해도 1시간 뒤 다시). cache: book['flags']['flow'] (key: 알아볼 수 없는 짧은 코드)"""
    day = now.astimezone(KST).date().isoformat()
    key = key or code
    c = cache.get(key)
    if c and c.get("day") == day and (c.get("x") or (time.time() - c.get("t", 0) < 3600)):
        return c.get("x")
    x = flow_eval(flow_rows(code), price)
    cache[key] = {"day": day, "t": time.time(), "x": x}
    return x


def flow_line(x):
    """카톡 한 줄 (짧게)"""
    if not x:
        return ""
    sgn = lambda v: f"{v:+,.0f}억" if abs(v) >= 1 else f"{v:+.1f}억"
    return f"수급 5일 외국인{sgn(x['f5'])}·기관{sgn(x['i5'])}" + (" · 거래량 급증" if x.get("spike") else "")


def prune_flow(cache, now):
    day = now.astimezone(KST).date().isoformat()
    for k in [k for k, v in cache.items() if not isinstance(v, dict) or v.get("day") != day]:
        cache.pop(k, None)


# ---------- 3. 가짜 돌파 ----------

SESSION_MIN = {"kr": 390, "us": 390, "crypto": 1440}


def day_pace(market, m_today, avg_vol, now_ts):
    """오늘 거래량이 평소 하루 거래량의 몇 배 속도인지 (장 시작 뒤 지난 시간 비율로 나눔)"""
    if m_today is None or not len(m_today) or not avg_vol or avg_vol <= 0:
        return None
    vol = float(m_today["Volume"].fillna(0).sum())
    mins = max((now_ts - m_today.index[0]).total_seconds() / 60, 1)
    frac = min(max(mins / SESSION_MIN.get(market, 390), 0.05), 1.0)
    return vol / (avg_vol * frac)


def breakout(closed, m_today, price, volr, pace):
    """closed: 어제까지 일봉, m_today: 오늘 1분봉 → {st: none|ok|weak|fail, why, res, sup}
    - 20일 고점(저항선)을 오늘 넘었는데 거래량이 약하면 weak, 다시 그 아래로 내려오면 fail
    - 10일 저점(지지선) 아래면 fail"""
    if closed is None or len(closed) < 25 or m_today is None or not len(m_today):
        return {"st": "none"}
    res = float(closed["High"].iloc[-20:].max())
    sup = float(closed["Low"].iloc[-10:].min())
    out = {"res": res, "sup": sup}
    if price < sup:
        return {**out, "st": "fail", "why": "지지선(10일 저점) 이탈"}
    hi = float(m_today["High"].max())
    if hi > res * 1.002:
        if price < res * 0.998:
            return {**out, "st": "fail", "why": "저항선 돌파 뒤 다시 아래로"}
        if (volr or 0) < 1.5 and (pace is None or pace < 1.2):
            return {**out, "st": "weak", "why": "거래량 없는 돌파"}
        return {**out, "st": "ok", "why": "거래량 동반 돌파"}
    return {**out, "st": "none"}


# ---------- 4. 경제 일정 · 실적 발표 ----------
# 미국 동부 시각. 출처: 연준 FOMC 일정(2026-11-12 수정본), BLS CPI · 고용보고서 일정, BEA 개인소득·지출(PCE) 일정
MACRO = (
    [("FOMC", d + " 14:00") for d in ("2026-12-09", "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
                                       "2027-07-28", "2027-09-15", "2027-11-17")]
    + [("CPI", d + " 08:30") for d in ("2026-12-10", "2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13",
                                        "2027-05-12", "2027-06-10", "2027-07-14", "2027-08-11", "2027-09-14",
                                        "2027-10-14", "2027-11-10", "2027-12-10")]
    + [("PCE", d + " 08:30") for d in ("2026-12-18", "2027-01-28", "2027-02-25", "2027-03-31", "2027-04-29",
                                        "2027-05-27", "2027-06-25", "2027-07-29", "2027-08-25", "2027-09-30",
                                        "2027-10-28", "2027-11-24", "2027-12-22")]
    + [("고용", d + " 08:30") for d in ("2026-12-04", "2027-01-08", "2027-02-05", "2027-03-05", "2027-04-02",
                                       "2027-05-07", "2027-06-04", "2027-07-02", "2027-08-06", "2027-09-03",
                                       "2027-10-08", "2027-11-05", "2027-12-03")])
EV_NAME = {"FOMC": "FOMC 금리 결정", "CPI": "미국 소비자물가(CPI)", "PCE": "미국 PCE 물가", "고용": "미국 고용보고서"}
EV_LVL = {"FOMC": 2, "CPI": 2, "PCE": 2, "고용": 1}       # 2: 매수 쉬기 · 1: 주의만
EV_BEFORE, EV_AFTER = timedelta(hours=20), timedelta(hours=2)
SEMI_EARN = {"NVDA": "엔비디아", "AMD": "AMD", "AVGO": "브로드컴", "TSM": "TSMC", "MU": "마이크론", "ASML": "ASML",
             "AMAT": "어플라이드", "LRCX": "램리서치", "KLAC": "KLA", "QCOM": "퀄컴", "INTC": "인텔", "ARM": "ARM",
             "MRVL": "마벨", "005930.KS": "삼성전자", "000660.KS": "SK하이닉스"}
NASDAQ_LEV = {"TQQQ", "SQQQ", "QLD", "TECL", "TECS", "SOXL", "SOXS", "USD", "NVDL"}


def macro_events(extra=None):
    out = []
    for k, s in list(MACRO) + list(extra or []):
        try:
            t = datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=ET).astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        out.append({"k": k, "n": EV_NAME.get(k, k), "t": t, "lvl": EV_LVL.get(k, 1)})
    return out


def earn_events(semi_earn):
    """semi_earn: {티커: 'YYYY-MM-DD'} → 발표일 (미장은 장 마감 뒤라 가정 · 한국 종목은 장 전 발표라 가정)"""
    out = []
    for t, d in (semi_earn or {}).items():
        try:
            day = datetime.strptime(d, "%Y-%m-%d")
        except (TypeError, ValueError):
            continue
        if t.endswith(".KS"):
            at = day.replace(hour=8, tzinfo=KST).astimezone(timezone.utc)
        else:
            at = day.replace(hour=16, minute=10, tzinfo=ET).astimezone(timezone.utc)
        out.append({"k": "실적", "tk": t, "n": SEMI_EARN.get(t, t) + " 실적 발표", "t": at, "lvl": 2})
    return out


def event_check(market, ticker, semi, now, semi_earn=None, extra=None):
    """→ {lvl: 0 없음 · 1 주의 · 2 매수 쉬기, items: [{n, t, lvl}]}"""
    hits = []
    for e in macro_events(extra):
        if e["t"] - EV_BEFORE <= now <= e["t"] + EV_AFTER:
            hits.append(e)
    for e in earn_events(semi_earn):
        own = e["tk"] == ticker
        nv = e["tk"] == "NVDA"
        if not (own or semi or (nv and (market == "us" or ticker in NASDAQ_LEV))):
            continue
        before = timedelta(days=3) if own else timedelta(hours=30)
        if e["t"] - before <= now <= e["t"] + timedelta(hours=20):
            lvl = 2 if (own or (semi and nv) or (semi and e["tk"] in ("005930.KS", "000660.KS") and market == "kr")) else 1
            hits.append({**e, "lvl": lvl})
    lvl = max([h["lvl"] for h in hits], default=0)
    return {"lvl": lvl, "items": [{"n": h["n"], "t": h["t"].isoformat(), "lvl": h["lvl"]} for h in sorted(hits, key=lambda h: h["t"])]}


def upcoming(now, semi_earn=None, days=10, extra=None):
    """앱 표시용: 앞으로 days일 안의 일정"""
    xs = [e for e in macro_events(extra) + earn_events(semi_earn) if now - EV_AFTER <= e["t"] <= now + timedelta(days=days)]
    return [{"k": e["k"], "n": e["n"], "t": e["t"].isoformat(), "lvl": e["lvl"]} for e in sorted(xs, key=lambda e: e["t"])]


def next_earn(t, earnings_dates_fn, today):
    """다음 실적 발표일 하나 (못 찾으면 None)"""
    for d in earnings_dates_fn(t):
        if d >= today:
            return d
    return None


def semi_earn_job(flags, now, earnings_dates_fn, log=print):
    """하루 한 번: 반도체 주요 기업 다음 실적 발표일 → flags['semi_earn'] = {day, ev:{티커: 날짜}}"""
    day = now.astimezone(KST).date().isoformat()
    cur = flags.get("semi_earn") or {}
    if cur.get("day") == day:
        return cur.get("ev") or {}
    ev = {}
    today = (now - timedelta(days=2)).astimezone(ET).date().isoformat()
    for t in SEMI_EARN:
        try:
            d = next_earn(t, earnings_dates_fn, today)
        except Exception:
            d = None
        if d:
            ev[t] = d
    if not ev and cur.get("ev"):
        ev = {t: d for t, d in cur["ev"].items() if d >= today}       # 못 받으면 어제 것 유지
    flags["semi_earn"] = {"day": day, "ev": ev}
    log(f"반도체 실적 일정 {len(ev)}개")
    return ev


# ---------- 5. 레버리지 ETF ----------
# 티커: (배수, 기초 지수 티커, 기초 이름). 배수가 음수면 인버스(하락에 거는 ETF)
LEV = {
    "SOXL": (3, "^SOX", "SOX 반도체"), "SOXS": (-3, "^SOX", "SOX 반도체"), "USD": (2, "^SOX", "SOX 반도체"),
    "TQQQ": (3, "^NDX", "나스닥100"), "SQQQ": (-3, "^NDX", "나스닥100"), "QLD": (2, "^NDX", "나스닥100"),
    "TECL": (3, "XLK", "미국 기술주"), "TECS": (-3, "XLK", "미국 기술주"),
    "UPRO": (3, "^GSPC", "S&P500"), "SPXL": (3, "^GSPC", "S&P500"), "SPXU": (-3, "^GSPC", "S&P500"),
    "SPXS": (-3, "^GSPC", "S&P500"), "SSO": (2, "^GSPC", "S&P500"), "TNA": (3, "^RUT", "러셀2000"),
    "LABU": (3, "XBI", "바이오"), "FAS": (3, "XLF", "금융"), "NVDL": (2, "NVDA", "엔비디아"), "TSLL": (2, "TSLA", "테슬라"),
    "122630.KS": (2, "069500.KS", "코스피200"), "252670.KS": (-2, "069500.KS", "코스피200"),
    "233740.KS": (2, "229200.KS", "코스닥150"), "251340.KS": (-2, "229200.KS", "코스닥150"),
}
LEV_SPLIT_MAX = 2          # 분할 매수 최대 횟수
LEV_ETF_CRASH = -9.0       # ETF 자체가 하루 -9% 넘게 빠지면 신규 매수 차단


def lev_of(ticker):
    return LEV.get(ticker)


def lev_bases(tickers):
    return sorted({LEV[t][1] for t in tickers if t in LEV})


def _rets(df, n):
    c = df["Close"].dropna()
    return c.pct_change().dropna().iloc[-n:]


def lev_info(L, etf, base):
    """일일 변동성 · 최대 손실 추정 · 변동성 손실(지수가 제자리여도 생기는 손실) 추정"""
    if etf is None or len(etf) < 60:
        return None
    r = _rets(etf, 252)
    sd = float(r.iloc[-20:].std() * 100)
    sd_med = float(r.rolling(20).std().dropna().median() * 100) if len(r) > 60 else sd
    rb = _rets(base, 252) if base is not None and len(base) > 60 else None
    sdb = float(rb.iloc[-20:].std() * 100) if rb is not None else sd / max(abs(L), 1)
    drag = (L * L - L) / 2 * (sdb / 100) ** 2 * 21 * 100          # 한 달(21거래일) 변동성 손실 %
    d1 = float(r.iloc[-1] * 100) if len(r) else 0.0
    return {"x": L, "sd": round(sd, 2), "sd_hi": bool(sd > sd_med * 1.3), "var99": round(-2.33 * sd, 1),
            "worst": round(float(r.min() * 100), 1), "drag": round(drag, 1), "d1": round(d1, 2),
            "move5": round(-5 * abs(L), 0)}


def lev_check(L, info, base_state, base_crash, ev_lvl, score, need_score):
    """레버리지 전용 기준 → (통과?, 이유들, 무조건 차단?)"""
    whys, hard = [], False
    want = "up" if L > 0 else "down"
    if base_state and base_state != want:
        whys.append(f"기초 지수 {STATE_KO.get(base_state, base_state)}" + ("" if L > 0 else " (인버스는 하락장만)"))
    if L > 0 and base_crash:
        whys.append("시장 급락 중 신규 매수 차단")
        hard = True
    if info and info["d1"] <= LEV_ETF_CRASH:
        whys.append(f"ETF 하루 {info['d1']:.0f}% 급락")
        hard = True
    if info and info["sd_hi"]:
        whys.append("평소보다 변동성 큼")
    if ev_lvl >= 1:
        whys.append("주요 일정 앞")
    if score < need_score:
        whys.append(f"신호 점수 {need_score}점 이상 필요")
    return not whys, whys, hard


def lev_line(L, info):
    if not info:
        return f"⚡ 레버리지 {abs(L)}배{' 인버스' if L < 0 else ''} · 분할 최대 {LEV_SPLIT_MAX}번"
    return (f"⚡ {abs(L)}배{' 인버스' if L < 0 else ''} · 하루 ±{info['sd']:.1f}% · 최악 {info['worst']:.0f}%"
            f" · 분할 최대 {LEV_SPLIT_MAX}번")
