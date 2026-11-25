"""종목 뉴스 · 지수 선물 시세 — 앱용 (엔진이 5분마다 돌 때 같이 실행)

- 5분마다: 미국 지수 선물 (S&P500 · 나스닥100 · 다우) 시세 → kv 'futures'
  (야후 파이낸스, 거래소 기준 약 10분 늦은 값)
- 15분마다: 앱 보유 종목 + 최근 3일 알림 종목의 뉴스 제목 (구글 뉴스 검색 RSS) → news 표
  (새로 요청된 종목은 다음 실행 때 바로). 기사 본문은 받지 않고 제목 · 언론사 · 시각 · 링크만.

공개 실행 기록에는 종목 이름 · 코드를 남기지 않고 개수만 남겨요.
"""
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import requests

import app_bridge as ab
import holdings

FUT = [("ES=F", "S&P500 선물"), ("NQ=F", "나스닥100 선물"), ("YM=F", "다우 선물")]
NEWS_EVERY = timedelta(minutes=15)
NEWS_MAX = 150                     # 한 번에 뉴스를 받을 종목 수
NEWS_KEEP = 6                      # 종목당 보관하는 기사 수
BREAK_MIN = 60                     # 이 시간(분) 안의 기사는 '속보'
UA = {"User-Agent": "Mozilla/5.0 (tajeom-note news)"}
# 미장 종목 뉴스 검색어 (한글 이름이 애매한 것)
US_Q = {"GOOGL": "구글", "GOOG": "구글", "SCHD": "SCHD", "TQQQ": "TQQQ", "SOXL": "SOXL", "QQQ": "QQQ",
        "SPY": "S&P500", "VOO": "VOO", "AMD": "AMD", "TSM": "TSMC", "ARM": "ARM 반도체", "V": "비자 카드",
        "MA": "마스터카드", "BRK-B": "버크셔"}
HANGUL = re.compile(r"[가-힣]")
CORP = re.compile(r"\s*(,?\s*(Inc|Incorporated|Corporation|Corp|Co|Company|Ltd|Limited|plc|PLC|Holdings?|Group|N\.V|S\.A|AG|SE)\.?)+$", re.I)


def log(rt, msg):
    try:
        rt.log(msg)
    except Exception:
        pass


# ---------- 선물 ----------

def _iso(ts):
    try:
        t = ts.to_pydatetime()
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.astimezone(timezone.utc).isoformat()
    except Exception:
        return None


def futures(rt, now):
    keys = [k for k, _ in FUT]
    daily = rt.fetch_many(keys, "10d", "1d")
    intra = rt.fetch_many(keys, "2d", "15m")
    items = []
    for k, name in FUT:
        try:
            items.append(_fut_item(k, name, daily.get(k), intra.get(k)))
        except Exception:
            continue
    items = [x for x in items if x]
    return {"at": now.isoformat(), "items": items, "note": "미국 선물은 거래소 기준 약 10분 늦은 값이에요"}


def _fut_item(k, name, d, i):
    if d is None or len(d) < 2 or "Close" not in d:
        return None
    if i is not None and "Close" not in i:
        i = None
    last = float(i["Close"].iloc[-1]) if i is not None and len(i) else float(d["Close"].iloc[-1])
    prev = float(d["Close"].iloc[-2])
    if not (prev > 0 and last > 0):
        return None
    asof = _iso(i.index[-1]) if i is not None and len(i) else None
    spark = []
    if i is not None and len(i):
        cut = i.index[-1] - timedelta(hours=12)
        spark = [round(float(x), 2) for x in i["Close"][i.index >= cut].tolist()][-48:]
    return {"key": k, "name": name, "last": round(last, 2), "chg": round(last - prev, 2),
            "pct": round((last / prev - 1) * 100, 2), "prev": round(prev, 2), "asof": asof, "spark": spark}


# ---------- 뉴스 ----------

def _clean_title(t, src):
    t = (t or "").strip()
    if src and t.endswith(" - " + src):
        t = t[: -len(src) - 3].strip()
    return re.sub(r"\s+", " ", t)[:200]


def parse_rss(text, now):
    root = ET.fromstring(text)
    out, seen = [], set()
    for it in root.iter("item"):
        src_el = it.find("source")
        src = (src_el.text or "").strip() if src_el is not None else ""
        title = _clean_title(it.findtext("title"), src)
        link = (it.findtext("link") or "").strip()
        if not title or not link.startswith("https://"):
            continue
        try:
            at = parsedate_to_datetime(it.findtext("pubDate") or "").astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        if at > now + timedelta(minutes=10) or now - at > timedelta(days=4):
            continue
        key = re.sub(r"[\W_]+", "", title)[:40]
        if key in seen:
            continue
        seen.add(key)
        age = now - at
        brk = age <= timedelta(minutes=BREAK_MIN) or ("속보" in title[:12] and age <= timedelta(hours=6))
        out.append({"t": title, "s": src[:40], "u": link[:600], "at": at.isoformat(), "brk": brk})
        if len(out) >= 12:
            break
    out.sort(key=lambda x: x["at"], reverse=True)
    return out[:NEWS_KEEP]


def query_for(yt, market, name, alias):
    """(검색어, 언어) — 국장 · 코인은 한글 이름, 미장은 한글 별칭이 있으면 한글, 없으면 영어 회사명"""
    if market == "us":
        if yt in US_Q:
            return f'"{US_Q[yt]}" when:3d', "ko"
        if name and HANGUL.search(name):
            return f'"{name.split()[0]}" when:3d', "ko"
        al = (alias or holdings.ALIAS.get(yt) or "").split()
        if al:
            return f'"{al[0]}" when:3d', "ko"
        short = CORP.sub("", re.split(r"\s+-\s+|\s+Class\s+|\s+Common\s+", name or yt)[0]).strip() or yt
        return f'"{short}" when:3d', "en"
    nm = (name or "").strip()
    if not nm:
        return None, None
    if market == "crypto" and "코인" not in nm:
        return f'"{nm}" 코인 when:3d', "ko"
    return f'"{nm}" when:3d', "ko"


def gnews(q, lang, now):
    loc = "hl=ko&gl=KR&ceid=KR:ko" if lang == "ko" else "hl=en-US&gl=US&ceid=US:en"
    r = requests.get(f"https://news.google.com/rss/search?q={quote(q)}&{loc}", headers=UA, timeout=12)
    r.raise_for_status()
    return parse_rss(r.content, now)


def _names(rt, yts):
    """yt → (이름, 별칭): 감시 종목 이름 먼저, 없으면 종목 검색 목록"""
    out = {}
    for m in ("kr", "us", "crypto"):
        for cats in (rt.MARKETS.get(m) or {}).values():
            for t, nm in (cats.items() if isinstance(cats, dict) else []):
                out[t] = (nm, None)
    need = [y for y in yts if y not in out]
    for i in range(0, len(need), 80):
        part = ",".join('"' + y.replace('"', "") + '"' for y in need[i:i + 80])
        for s in holdings._get(f"symbols?select=yt,name,alias&yt=in.({quote(part, safe=',')})"):
            out[s["yt"]] = (s.get("name"), s.get("alias"))
    return out


def news_job(rt, book, now):
    flags = book["flags"]
    since = (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    since3 = (now - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    want = {}
    for a in holdings._get(f"alerts?select=yt,market&created_at=gte.{since3}&yt=not.is.null&order=created_at.desc&limit=300"):
        want.setdefault(a["yt"], a["market"])
    for r in holdings._get(f"hold_req?select=yt,market&last_at=gte.{since}&order=last_at.desc&limit=200"):
        want.setdefault(r["yt"], r["market"])
    if not want:
        return ""
    full = holdings._old(flags.get("news"), now, NEWS_EVERY)
    if not full:
        have = {x["yt"] for x in holdings._get("news?select=yt")}
        want = {y: m for y, m in want.items() if y not in have}
        if not want:
            return ""
    else:
        flags["news"] = now.isoformat()
    pick = list(want.items())[:NEWS_MAX]
    names = _names(rt, [y for y, _ in pick])
    jobs = []
    for yt, m in pick:
        nm, al = names.get(yt, (None, None))
        if m == "crypto" and not nm:
            nm = yt.replace("-KRW", "")
        q, lang = query_for(yt, m, nm or (yt if m == "us" else None), al)
        if q:
            jobs.append((yt, m, q, lang))

    def one(job):
        yt, m, q, lang = job
        try:
            return yt, m, gnews(q, lang, now)
        except Exception:
            return yt, m, None

    rows, fail = [], 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        for yt, m, items in ex.map(one, jobs):
            if items is None:
                fail += 1
                if full:
                    continue          # 전체 갱신 때 실패하면 예전 기사 유지
                items = []            # 새 종목이 실패하면 빈 목록으로 두고 다음 전체 갱신 때 다시
            rows.append({"yt": yt, "market": m, "items": items, "updated_at": now.isoformat()})
    if rows:
        holdings._upsert("news", rows, "yt")
    return f"뉴스 {len(rows)}종목" + (f" (실패 {fail})" if fail else "") + ("" if full else " (새 종목)")


# ---------- 오늘 눈에 띄는 종목 (감시 종목 + 주요 종목만, 사용자가 넣은 종목은 안 씀) ----------

MOVERS_EVERY = timedelta(minutes=15)
MAJOR = {
    "kr": ["005930.KS", "000660.KS", "373220.KS", "207940.KS", "005380.KS", "000270.KS", "068270.KS", "105560.KS", "055550.KS",
           "035420.KS", "035720.KS", "005490.KS", "012330.KS", "051910.KS", "006400.KS", "028260.KS", "066570.KS", "003550.KS",
           "096770.KS", "034020.KS", "012450.KS", "329180.KS", "042660.KS", "086520.KQ", "247540.KQ", "196170.KQ"],
    "us": ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD", "NFLX", "PLTR", "COIN", "MSTR", "MU",
           "INTC", "ORCL", "TSM", "ARM", "IONQ", "QQQ"],
    "crypto": ["BTC-KRW", "ETH-KRW", "XRP-KRW", "SOL-KRW", "DOGE-KRW", "ADA-KRW", "TRX-KRW", "AVAX-KRW", "LINK-KRW", "SUI-KRW"],
}
MOVE_TH = {"kr": 4.0, "us": 4.0, "crypto": 6.0}


def mover(df, market):
    """일봉 → 오늘 등락 · 거래량 배수 · 1년 신고가 여부 · 태그"""
    c, v = df["Close"].dropna(), df["Volume"].fillna(0)
    if len(c) < 30:
        return None
    chg = float(c.iloc[-1] / c.iloc[-2] - 1) * 100
    avg = float(v.iloc[-21:-1].mean())
    vr = float(v.iloc[-1] / avg) if avg > 0 else None
    hi = float(c.iloc[-253:-1].max())
    tags = []
    th = MOVE_TH[market]
    if chg >= th:
        tags.append("급등")
    elif chg <= -th:
        tags.append("급락")
    if vr is not None and vr >= 2.5 and abs(chg) >= 1:
        tags.append("거래량 급증")
    if c.iloc[-1] >= hi * 0.999 and chg > 0 and len(c) >= 200:
        tags.append("1년 신고가")
    day = pd_day(c.index[-1])
    return {"chg": round(chg, 2), "vr": None if vr is None else round(vr, 1), "tags": tags, "day": day,
            "rank": abs(chg) + (3 if "거래량 급증" in tags else 0) + (3 if "1년 신고가" in tags else 0)}


def pd_day(ts):
    try:
        return ts.date().isoformat()
    except Exception:
        return None


def movers_job(rt, book, now):
    flags = book["flags"]
    if not holdings._old(flags.get("movers"), now, MOVERS_EVERY):
        return None
    flags["movers"] = now.isoformat()
    out = {"at": now.isoformat(), "markets": {}}
    for m in ("kr", "us", "crypto"):
        uni = list(dict.fromkeys(MAJOR[m] + [t for cats in (rt.MARKETS.get(m) or {}).values() for t in cats]))
        data = rt.fetch_many(uni, "1y", "1d")
        names = _names(rt, uni)
        rows = []
        for t in uni:
            try:
                x = mover(data.get(t), m) if data.get(t) is not None else None
            except Exception:
                x = None
            if not x or not x["tags"]:
                continue
            nm, al = names.get(t, (None, None))
            if m == "us":
                al = al or holdings.ALIAS.get(t)
                nm = al.split()[0] if al and HANGUL.search(al) else (CORP.sub("", re.split(r"\s+-\s+|\s+Class\s+|\s+Common\s+", nm or t)[0]).strip() or t)
            code = t.split(".")[0] if m == "kr" else t.replace("-KRW", "")
            rows.append({"yt": t, "code": code, "name": nm or code, **x})
        rows.sort(key=lambda r: r["rank"], reverse=True)
        out["markets"][m] = [{k: v for k, v in r.items() if k != "rank"} for r in rows[:6]]
    ab.put_kv("movers", out)
    return sum(len(v) for v in out["markets"].values())


# ---------- 국장 점심 · 마감 요약 (평일 12:30쯤 · 15:40쯤, 앱 푸시 + 첫 화면 카드) ----------

RECAP = [("mid", 12 * 60 + 30, 13 * 60 + 30, "🕧 점심 시장 요약"),
         ("close", 15 * 60 + 40, 17 * 60, "🔔 국장 마감 요약")]
RECAP_IDX = [("코스피", "^KS11"), ("코스닥", "^KQ11"), ("원/달러", "KRW=X")]


def recap_kind(rt, now, flags):
    """지금 보낼 요약 종류 (없으면 None) — 국장 쉬는 날이나 이미 보낸 날은 None"""
    if not rt.S.get("장중_요약", True) or not rt.session("kr", now):
        return None
    k = now.astimezone(rt.KST)
    hm, day = k.hour * 60 + k.minute, k.date().isoformat()
    for kind, a, b, title in RECAP:
        if a <= hm < b and flags.get("recap|" + kind) != day:
            return kind, title, day
    return None


def recap_lines(data):
    """푸시 한 줄: 지수 · 오늘 타점 · 눈에 띄는 종목"""
    parts = []
    for x in data["idx"]:
        parts.append(f"환율 {x['last']:,.0f}원" if x["name"] == "원/달러" else f"{x['name']} {x['chg']:+.1f}%")
    a = data["alerts"]
    if a is not None:
        parts.append(f"오늘 타점 매수 {a['buy']}·매도 {a['sell']}")
    fut = data.get("fut") or []
    if fut:
        parts.append("미국 선물 " + " ".join(f"{x['name'].replace(' 선물', '')} {x['chg']:+.1f}%" for x in fut[:1]))
    mv = data["movers"]
    if mv:
        parts.append("눈에 띔 " + ", ".join(f"{m['name']} {m['chg']:+.1f}%" for m in mv[:2]) + (f" 외 {len(mv) - 2}" if len(mv) > 2 else ""))
    return " · ".join(parts)


def recap_job(rt, book, now):
    flags = book["flags"]
    got = recap_kind(rt, now, flags)
    if not got:
        return None
    kind, title, day = got
    flags["recap|" + kind] = day            # 실패해도 그날 같은 요약을 또 시도하지 않음 (푸시 중복 방지)
    hd = rt.fetch_many([t for _, t in RECAP_IDX], "5d", "60m")
    idx = []
    for name, t in RECAP_IDX:
        x = rt.session_change(hd.get(t), rt.TZ["kr"])
        if not x:
            continue
        if t == "^KS11" and x["date"] != day:   # 오늘 코스피 값이 없으면 갑자기 쉬는 날 → 요약 안 보냄
            return "쉬는 날"
        idx.append({"name": name, "chg": x["chg"], "last": x["last"]})
    if not any(x["name"] == "코스피" for x in idx):
        return "지수 없음"
    k = now.astimezone(rt.KST)
    try:
        alerts = ab.count_alerts("kr", k.replace(hour=0, minute=0, second=0, microsecond=0))
    except Exception:
        alerts = None
    try:
        mv = ((ab.get_kv("movers") or {}).get("markets") or {}).get("kr") or []
        mv = [{"name": m["name"], "yt": m["yt"], "code": m.get("code"), "chg": m["chg"], "tags": m.get("tags", [])}
              for m in mv if m.get("day") == day][:4]
    except Exception:
        mv = []
    data = {"at": now.isoformat(), "day": day, "kind": kind, "title": title, "idx": idx, "alerts": alerts, "movers": mv}
    if kind == "close":                     # 마감 뒤에는 오늘 밤 미국 선물도 같이
        try:
            f = ab.get_kv("futures") or {}
            data["fut"] = [{"name": x["name"], "chg": x["pct"]} for x in (f.get("items") or [])[:2] if x.get("pct") is not None]
        except Exception:
            pass
    ab.put_kv("recap", data)
    body = recap_lines(data)
    sent = ab.push_brief({"title": f"{title} {k:%m/%d}({rt.WEEKDAY_KO[k.weekday()]})", "body": body,
                          "url": "./#/", "tag": f"recap-{kind}-{day}"}, now, pref="recap", market="kr")
    return f"{'점심' if kind == 'mid' else '마감'} 요약 (푸시 {sent}건)"


# ---------- 실행 ----------

def run(rt, book, now):
    """엔진 실행 끝에 호출 → 공개 기록용 짧은 요약 (개수만)"""
    if not ab.enabled():
        return ""
    notes = []
    try:
        f = futures(rt, now)
        ab.put_kv("futures", f)
        notes.append(f"선물 {len(f['items'])}개")
    except Exception as e:
        notes.append(f"선물 실패 ({type(e).__name__})")
    try:
        mv = movers_job(rt, book, now)
        if mv is not None:
            notes.append(f"눈에 띄는 종목 {mv}개")
    except Exception as e:
        notes.append(f"눈에 띄는 종목 실패 ({type(e).__name__})")
    try:
        rc = recap_job(rt, book, now)
        if rc:
            notes.append(rc)
    except Exception as e:
        notes.append(f"요약 실패 ({type(e).__name__})")
    try:
        t0 = time.time()
        n = news_job(rt, book, now)
        if n:
            notes.append(f"{n} {time.time() - t0:.0f}초")
    except Exception as e:
        notes.append(f"뉴스 실패 ({type(e).__name__})")
    return (" · " + " · ".join(notes)) if notes else ""
