"""종목 뉴스 · 지수 선물 시세 — 앱용 (엔진이 5분마다 돌 때 같이 실행)

- 5분마다: 미국 지수 선물 (S&P500 · 나스닥100 · 다우) 시세 → kv 'futures'
  (야후 파이낸스, 거래소 기준 약 10분 늦은 값)
- 15분마다: 앱 보유 종목 + 최근 3일 알림 종목의 뉴스 제목 (구글 뉴스 검색 RSS) → news 표
  (새로 요청된 종목은 다음 실행 때 바로). 기사 본문은 받지 않고 제목 · 언론사 · 시각 · 링크만.

공개 실행 기록에는 종목 이름 · 코드를 남기지 않고 개수만 남겨요.
"""
import html
import os
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote, urlparse

import requests

import app_bridge as ab
import holdings

FUT = [("ES=F", "S&P500 선물"), ("NQ=F", "나스닥100 선물"), ("YM=F", "다우 선물")]
NEWS_EVERY = timedelta(minutes=15)
NEWS_MAX = 150                     # 한 번에 뉴스를 받을 종목 수
NEWS_KEEP = 6                      # 종목당 보관하는 기사 수
BREAK_MIN = 60                     # 이 시간(분) 안의 기사는 '속보'
UA = {"User-Agent": "Mozilla/5.0 (tajeom-note news)"}
# 네이버 뉴스 검색 (NAVER API HUB). 비밀값 두 개가 있으면 구글 뉴스 대신 이것만 씀 — 결과를 순서·내용 그대로 보여 주고 출처·원문 링크를 붙임
NAVER_ID = ab._clean(os.environ.get("NAVER_API_KEY_ID"))
NAVER_KEY = ab._clean(os.environ.get("NAVER_API_KEY"))
NAVER_URL = "https://naverapihub.apigw.ntruss.com/search/v1/news"
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


def naver_query(yt, market, name, alias):
    """네이버 검색어 (따옴표·기간 문법 없이) — 한글 이름 우선"""
    if market == "us":
        if yt in US_Q:
            return US_Q[yt]
        for t in (name, alias or holdings.ALIAS.get(yt)):
            if t and HANGUL.search(t):
                return t.split()[0]
        return CORP.sub("", re.split(r"\s+-\s+|\s+Class\s+|\s+Common\s+", name or yt)[0]).strip() or yt
    nm = (name or "").strip()
    if not nm:
        return None
    return f"{nm} 코인" if market == "crypto" and "코인" not in nm else nm


def _host(u):
    try:
        h = urlparse(u).hostname or ""
        return h[4:] if h.startswith("www.") else h
    except Exception:
        return ""


def parse_naver(data, now):
    """네이버 응답 → 기사 목록 (받은 순서 그대로, 굵게 표시 태그만 빼고 글자는 그대로)"""
    out = []
    for it in data.get("items") or []:
        title = html.unescape(re.sub(r"</?b>", "", it.get("title") or "")).strip()
        orig, nlink = (it.get("originallink") or "").strip(), (it.get("link") or "").strip()
        link = orig if orig.startswith("https://") else nlink if nlink.startswith("https://") else ""
        if not title or not link:
            continue
        try:
            at = parsedate_to_datetime(it.get("pubDate") or "").astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        if at > now + timedelta(minutes=10) or now - at > timedelta(days=4):
            continue
        age = now - at
        brk = age <= timedelta(minutes=BREAK_MIN) or ("속보" in title[:12] and age <= timedelta(hours=6))
        out.append({"t": title[:200], "s": _host(orig or link)[:40], "u": link[:600], "at": at.isoformat(), "brk": brk, "p": "naver"})
        if len(out) >= NEWS_KEEP:
            break
    return out


def nnews(q, now):
    r = requests.get(NAVER_URL, params={"query": q, "display": 10, "sort": "date"}, timeout=12,
                     headers={"X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_KEY})
    r.raise_for_status()
    return parse_naver(r.json(), now)


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
        if NAVER_ID and NAVER_KEY:
            q, lang = naver_query(yt, m, nm or (yt if m == "us" else None), al), "naver"
        else:
            q, lang = query_for(yt, m, nm or (yt if m == "us" else None), al)
        if q:
            jobs.append((yt, m, q, lang))

    def one(job):
        yt, m, q, lang = job
        try:
            return yt, m, (nnews(q, now) if lang == "naver" else gnews(q, lang, now))
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


def disp_name(m, t, names, fallback=None):
    """yt → (코드, 보여 줄 이름)"""
    nm, al = names.get(t, (None, None))
    nm = nm or fallback
    if m == "us":
        al = al or holdings.ALIAS.get(t)
        nm = al.split()[0] if al and HANGUL.search(al) else (CORP.sub("", re.split(r"\s+-\s+|\s+Class\s+|\s+Common\s+", nm or t)[0]).strip() or t)
    code = t.split(".")[0] if m == "kr" else t.replace("-KRW", "")
    return code, nm or code


def hilo(df, market, today):
    """일봉 → 오늘 1년(약 252거래일) 신고가 'hi' · 신저가 'lo' · 아니면 None → (종류, 오늘 등락 %, 현재가)"""
    if df is None or not len(df):
        return None
    c = df["Close"].dropna()
    if len(c) < 200 or pd_day(c.index[-1]) != today:
        return None
    # 종가 기준 (장중 고가·저가는 가끔 튀는 값이 섞여서, 1년 종가 최고·최저를 넘었을 때만)
    prev = c.iloc[-253:-1]
    last = float(c.iloc[-1])
    chg = round(float(c.iloc[-1] / c.iloc[-2] - 1) * 100, 2)
    if last > float(prev.max()):
        return "hi", chg, last
    if last < float(prev.min()):
        return "lo", chg, last
    return None


HILO_TITLE = {"kr": "국장", "us": "미장", "crypto": "코인"}


def hilo_push(rt, book, now, hits):
    """새로 나온 1년 신고가·신저가 → 시장별 앱 푸시 1건 (아침 7시 전이면 7시에 모아서) · 내 보유 종목은 카톡"""
    st = book["flags"].setdefault("hilo", {})
    sent_n = 0
    for m, items in hits.items():
        s = st.get(m) or {}
        day = items[0]["day"] if items else None
        if not day:
            continue
        if s.get("day") != day:
            s = {"day": day, "push": [], "kakao": []}
        new = [x for x in items if x.get("pub") and f"{x['yt']}|{x['side']}" not in s["push"]]
        if new and now.astimezone(rt.KST).hour >= 7:
            his = [x for x in new if x["side"] == "hi"]
            los = [x for x in new if x["side"] == "lo"]
            part = lambda xs, w: (w + ": " + ", ".join(f"{x['name']} {x['chg']:+.1f}%" for x in xs[:3]) + (f" 외 {len(xs) - 3}" if len(xs) > 3 else "")) if xs else ""
            title = " · ".join(t for t in ((f"📈 1년 신고가 {len(his)}" if his else ""), (f"📉 신저가 {len(los)}" if los else "")) if t) + f" ({HILO_TITLE[m]})"
            body = " · ".join(t for t in (part(his, "신고가"), part(los, "신저가")) if t)
            try:
                sent_n += ab.push_brief({"title": title, "body": body, "url": "./#/", "tag": f"hilo-{m}-{day}"}, now, pref="hilo", market=m)
            except Exception:
                pass
            s["push"] += [f"{x['yt']}|{x['side']}" for x in new]
        mine = [x for x in items if x.get("mine") and f"{x['yt']}|{x['side']}" not in s["kakao"]]
        if mine:
            try:
                token = rt.base.get_access_token()
                lines = [("📈 1년 신고가" if x["side"] == "hi" else "📉 1년 신저가") + f" · {x['name']} {x['chg']:+.1f}%" for x in mine[:6]]
                rt.send_short(token, f"[내 보유 · {HILO_TITLE[m]}]\n" + "\n".join(lines))
                s["kakao"] += [f"{x['yt']}|{x['side']}" for x in mine]
            except Exception:
                pass
        st[m] = s
    return sent_n


def movers_job(rt, book, now):
    flags = book["flags"]
    if not holdings._old(flags.get("movers"), now, MOVERS_EVERY):
        return None
    flags["movers"] = now.isoformat()
    out = {"at": now.isoformat(), "markets": {}}
    hl = {"at": now.isoformat(), "markets": {}}
    hits = {}
    my = getattr(rt, "MY_HOLD", None) or {}
    for m in ("kr", "us", "crypto"):
        uni = list(dict.fromkeys(MAJOR[m] + [t for cats in (rt.MARKETS.get(m) or {}).values() for t in cats]))
        mine = my.get(m) or {}
        allx = list(dict.fromkeys(uni + list(mine)))
        data = rt.fetch_many(allx, "1y", "1d")
        names = _names(rt, allx)
        today = now.astimezone(rt.TZ[m]).date().isoformat()
        rows, hrows = [], []
        for t in allx:
            df = data.get(t)
            pub = t in uni
            try:
                h = hilo(df, m, today) if df is not None else None
            except Exception:
                h = None
            if h:
                code, nm = disp_name(m, t, names, mine.get(t))
                hrows.append({"yt": t, "code": code, "name": nm, "side": h[0], "chg": h[1], "day": today, "pub": pub, "mine": t in mine})
            if not pub:
                continue                       # 내 보유에만 있는 종목은 공개 카드(눈에 띄는 종목)에 안 올림
            try:
                x = mover(df, m) if df is not None else None
            except Exception:
                x = None
            if not x or not x["tags"]:
                continue
            code, nm = disp_name(m, t, names)
            rows.append({"yt": t, "code": code, "name": nm, **x})
        rows.sort(key=lambda r: r["rank"], reverse=True)
        out["markets"][m] = [{k: v for k, v in r.items() if k != "rank"} for r in rows[:6]]
        hits[m] = hrows
        pubs = sorted((r for r in hrows if r["pub"]), key=lambda r: -abs(r["chg"]))
        hl["markets"][m] = {"day": today, "items": [{k: r[k] for k in ("yt", "code", "name", "side", "chg")} for r in pubs[:12]]}
    ab.put_kv("movers", out)
    ab.put_kv("hilo", hl)
    try:
        hilo_push(rt, book, now, hits)
    except Exception:
        pass
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

# ---------- 내 보유 마감 요약 (개발자 카톡: 국장 15:40쯤 · 미장 마감 뒤) ----------

def _won(v, usd=False):
    v = float(v)
    return (("+" if v > 0 else "-" if v < 0 else "") + ("$" + f"{abs(v):,.2f}" if usd else f"{abs(v):,.0f}원"))


def mine_lines(rt, pos, cur):
    """보유 종목들 → (오늘 손익 줄, 오른·내린 종목 줄) — cur: 'usd' 또는 'krw'"""
    if not pos:
        return None
    by = {}
    kr_us = [p["yt"] for p in pos if p["market"] in ("kr", "us")]
    coins = [p["yt"] for p in pos if p["market"] == "crypto"]
    d = rt.fetch_many(kr_us, "5d", "1d") if kr_us else {}
    h = rt.fetch_many(coins, "3d", "60m") if coins else {}
    val = day = cost = 0.0
    moves = []
    for p in pos:
        df = (h if p["market"] == "crypto" else d).get(p["yt"])
        if df is None or not len(df):
            continue
        c = df["Close"].dropna()
        if len(c) < 2:
            continue
        last = float(c.iloc[-1])
        prev = float(c.iloc[-25] if p["market"] == "crypto" and len(c) >= 25 else c.iloc[-2])
        chg = (last / prev - 1) * 100 if prev else 0.0
        val += last * p["qty"]
        day += (last - prev) * p["qty"]
        cost += p["avg"] * p["qty"] if p["avg"] > 0 else last * p["qty"]
        moves.append((chg, p["name"]))
    if not moves:
        return None
    usd = cur == "usd"
    base = val - day
    head = f"오늘 {_won(day, usd)} ({(day / base * 100 if base else 0):+.1f}%) · 평가 {_won(val, usd).lstrip('+')}"
    if cost and abs(cost - val) > 1e-9:
        head += f" · 누적 {((val / cost - 1) * 100):+.1f}%"
    moves.sort(reverse=True)
    tail = f"▲ {moves[0][1]} {moves[0][0]:+.1f}%"
    if len(moves) > 1 and moves[-1][0] < moves[0][0]:
        tail += f" ▼ {moves[-1][1]} {moves[-1][0]:+.1f}%"
    return head, tail


def mine_close_job(rt, book, now):
    """시안님 보유(개발자 화면에서 연결한 계정) 마감 요약 → 카톡 한 번 (국장 날 15:40~17:30 · 미장 마감 5분~2시간 뒤)"""
    pos = list(getattr(ab, "OWNER_POS", []) or [])
    if not pos or getattr(rt, "MY_HOLD", None) is None:
        return None
    flags, sent = book["flags"], []
    k = now.astimezone(rt.KST)
    jobs = []
    if rt.session("kr", now) and 15 * 60 + 40 <= k.hour * 60 + k.minute < 17 * 60 + 30:
        jobs.append(("kr", k.date().isoformat(), "국장", [p for p in pos if p["market"] in ("kr", "crypto")], "krw"))
    s = rt.session("us", now)
    e = now.astimezone(rt.NY)
    if s and s[1] + 5 <= e.hour * 60 + e.minute < s[1] + 120:
        jobs.append(("us", e.date().isoformat(), "미장", [p for p in pos if p["market"] == "us"], "usd"))
    for key, day, label, ps, cur in jobs:
        if flags.get("mine_close|" + key) == day or not ps:
            continue
        flags["mine_close|" + key] = day
        try:
            got = mine_lines(rt, ps, cur)
            if not got:
                continue
            msg = f"📊 내 보유 마감 · {label}\n{got[0]}\n{got[1]}"
            rt.send_short(rt.base.get_access_token(), msg[:200])
            sent.append(label)
        except Exception:
            pass
    return sent


# ---------- 어제 보유 종목 핵심 뉴스 → 시안님 카톡 (아침 한 번) ----------
# 기사 제목이 비슷한 것끼리 묶고, 여러 언론사가 같이 다룬 일(묶음이 큰 것) + 실적·수주·공시 같은 말이 들어간 것을 핵심으로 골라요.
# 종목 이름·기사 제목은 카톡에만 가고, 공개 기록에는 개수만 남겨요.
DIGEST_WIN = (7 * 60 + 30, 10 * 60)      # 한국 시간 07:30 ~ 10:00 사이 하루 한 번
DIGEST_MAX = 8                            # 카톡으로 보낼 종목 수 (뉴스 많은 순)
DIGEST_ON = True
NOISE = re.compile(r"(포토|사진|영상|그래픽|인사\]|부고|모집|광고|운세|마감\s?시황|장\s?마감|개장\s?시황|오늘의\s?(증시|공시)|주요\s?공시|특징주\s?모음|증시\s?요약|"
                   r"이\s?시각|랭킹|TOP\s?\d+|순매수\s?상위|거래대금\s?상위|상승률\s?상위|급등주\s?정리|테마주\s?정리|종목\s?정리)", re.I)
KEYS = re.compile(r"(실적|영업이익|영업익|매출|순이익|어닝|가이던스|전망치|수주|계약|공급|인수|합병|M&A|분할|상장|유상증자|무상증자|자사주|소각|배당|목표\s?주?가|"
                  r"투자의견|상향|하향|승인|허가|FDA|임상|특허|소송|제재|규제|관세|리콜|파업|증설|신제품|출시|최대|최초|단독|급등|급락|신고가|신저가|"
                  r"earnings|guidance|upgrade|downgrade|acquir|merger|deal|contract|approv|lawsuit|recall|record|forecast)", re.I)
TAGS = re.compile(r"^\s*(\[[^\]]{0,14}\]|【[^】]{0,14}】|\([^)]{0,8}\))\s*")


def _plain(t):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", t or ""))).strip()


def _when(s):
    try:
        return parsedate_to_datetime(s or "").astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def wide_naver(q, since, now):
    """네이버 뉴스: 관련도순 100개 + 최신순 50개를 합쳐 기간 안 기사만 (요약문 포함)"""
    out, seen = [], set()
    for sort, n in (("sim", 100), ("date", 50)):
        try:
            r = requests.get(NAVER_URL, params={"query": q, "display": n, "sort": sort}, timeout=12,
                             headers={"X-NCP-APIGW-API-KEY-ID": NAVER_ID, "X-NCP-APIGW-API-KEY": NAVER_KEY})
            r.raise_for_status()
            items = r.json().get("items") or []
        except Exception:
            continue
        for it in items:
            orig, nlink = (it.get("originallink") or "").strip(), (it.get("link") or "").strip()
            link = orig if orig.startswith("https://") else nlink if nlink.startswith("https://") else ""
            title, at = _plain(it.get("title")), _when(it.get("pubDate"))
            if not title or not at or not (since <= at <= now + timedelta(minutes=10)):
                continue
            k = re.sub(r"[\W_]+", "", title)[:50]
            if k in seen:
                continue
            seen.add(k)
            out.append({"t": title, "d": _plain(it.get("description")), "s": _host(orig or link), "u": link, "at": at})
    return out


def wide_google(q, lang, since, now):
    """구글 뉴스 (네이버 키가 없거나 영어 이름일 때) — 요약문은 없음"""
    loc = "hl=ko&gl=KR&ceid=KR:ko" if lang == "ko" else "hl=en-US&gl=US&ceid=US:en"
    try:
        r = requests.get(f"https://news.google.com/rss/search?q={quote(q)}&{loc}", headers=UA, timeout=12)
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except Exception:
        return []
    out, seen = [], set()
    for it in root.iter("item"):
        src_el = it.find("source")
        src = (src_el.text or "").strip() if src_el is not None else ""
        title, at = _clean_title(it.findtext("title"), src), _when(it.findtext("pubDate"))
        if not title or not at or not (since <= at <= now + timedelta(minutes=10)):
            continue
        k = re.sub(r"[\W_]+", "", title)[:50]
        if k in seen:
            continue
        seen.add(k)
        out.append({"t": title, "d": "", "s": src[:40] or _host(it.findtext("link") or ""), "u": (it.findtext("link") or "")[:600], "at": at})
        if len(out) >= 80:
            break
    return out


def _bi(t, drop):
    t = TAGS.sub("", t)
    t = re.sub(r"\[[^\]]{0,14}\]|\([^)]{0,14}\)", " ", t).lower()
    for w in drop:
        if w:
            t = t.replace(w.lower(), " ")
    t = re.sub(r"[\W_]+", "", t)
    return {t[i:i + 2] for i in range(len(t) - 1)} or {t}


def _jac(a, b):
    return len(a & b) / max(1, len(a | b))


def _short(t, names, n=44):
    t = TAGS.sub("", TAGS.sub("", t)).strip(" -·,")
    for w in names:                                  # 맨 앞 종목 이름은 머리말에 있으니 뺌 (남는 게 너무 짧으면 둠)
        if w and t.startswith(w):
            rest = re.sub(r"^[\s,·:…\-]+", "", t[len(w):])
            if len(rest) >= 10:
                t = rest
            break
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def key_news(arts, names):
    """기사들 → 핵심 묶음 [(점수, 대표 기사, 언론사 수)] 점수 높은 순"""
    low = [re.sub(r"\s+", "", w).lower() for w in names if w]
    def has(a, field):
        x = re.sub(r"\s+", "", a[field]).lower()
        return any(w in x for w in low)
    arts = [a for a in arts if has(a, "t") or has(a, "d")]          # 이 종목 얘기가 아닌 기사는 뺌
    arts.sort(key=lambda a: a["at"])
    groups = []
    for a in arts:
        g = _bi(a["t"], names)
        for c in groups:
            if _jac(g, c["g"]) >= 0.3:
                c["a"].append(a)
                break
        else:
            groups.append({"g": g, "a": [a]})
    out = []
    for c in groups:
        a = c["a"]
        titled = [x for x in a if has(x, "t")]
        pool = titled or a
        if sum(1 for x in a if NOISE.search(x["t"])) * 2 >= len(a):
            continue
        srcs = len({x["s"] for x in a if x["s"]}) or len(a)
        kw = any(KEYS.search(x["t"]) for x in a)
        listy = max(len(re.findall(r"[·,]", x["t"])) for x in pool) >= 3
        score = srcs + (1.0 if kw else 0) + (0.5 if any("단독" in x["t"][:8] for x in a) else 0) - (1.0 if listy else 0) - (0 if titled else 1.5)
        if score < 1.5:
            continue
        gs = [_bi(x["t"], names) for x in pool]
        cen = [sum(_jac(gs[i], gs[j]) for j in range(len(pool)) if j != i) for i in range(len(pool))]
        top = max(cen)                                  # 묶음 한가운데에 가까운 제목 중 가장 먼저 나온 기사 (보통 첫 보도)
        best = min((i for i in range(len(pool)) if cen[i] >= top * 0.75), key=lambda i: pool[i]["at"])
        out.append((round(score, 2), pool[best], srcs))
    out.sort(key=lambda x: (-x[0], -x[1]["at"].timestamp()))
    return out


def _lead(d, room):
    """기사 요약문 → 첫 문장 (room 글자 안)"""
    d = re.sub(r"^\s*\[[^\]]{0,20}\]\s*", "", d or "").strip()
    m = re.search(r"^(.{12,}?(다|요|음|함)\.)\s", d + " ")
    d = (m.group(1) if m else d).strip()
    if room < 14 or len(d) < 15:
        return ""
    return d if len(d) <= room else d[: room - 1].rstrip() + "…"


def digest_msg(rt, label, name, top):
    """한 종목 카톡 한 통 (200자 안): 핵심 1~2개 + 첫 기사 한 줄 요약"""
    head = f"📰 {label} · {name}"
    nums = ["①", "②"]
    for take, lead in ((2, True), (2, False), (1, True), (1, False)):
        lines = [head]
        for i, (_, a, n) in enumerate(top[:take]):
            lines.append(f"{nums[i]} {_short(a['t'], [name])}" + (f" ({n}곳)" if n >= 2 else ""))
            if i == 0 and lead:
                lines.append("")                        # 자리
        if lead:
            room = 200 - rt.u16len("\n".join(lines)) - 2
            ld = _lead(top[0][1].get("d"), min(room, 70))
            if ld:
                lines[2] = "  " + ld
            else:
                lines.pop(2)
        msg = "\n".join(lines)
        if rt.u16len(msg) <= 200:
            return msg
    return head[:200]


def digest_job(rt, book, now):
    """시안님 보유 종목(개발자 화면에서 연결한 계정)의 어제 핵심 뉴스 → 카톡 (아침 한 번)"""
    if not DIGEST_ON or not rt.S.get("카톡_뉴스요약", True):
        return None
    pos = list(getattr(ab, "OWNER_POS", []) or [])
    if not pos or getattr(rt, "MY_HOLD", None) is None:
        return None
    flags = book["flags"]
    k = now.astimezone(rt.KST)
    try:
        force = (ab.get_kv("news_digest_now") or {}).get("go") is True
    except Exception:
        force = False
    today = k.date().isoformat()
    if not force:
        if not (DIGEST_WIN[0] <= k.hour * 60 + k.minute < DIGEST_WIN[1]) or flags.get("digest_day") == today:
            return None
    flags["digest_day"] = today
    try:
        last = datetime.fromisoformat(flags.get("digest_at")) if flags.get("digest_at") else None
    except (TypeError, ValueError):
        last = None
    since = max(now - timedelta(hours=72), min(now - timedelta(hours=12), last or now - timedelta(hours=26)))
    flags["digest_at"] = now.isoformat()
    if force:
        try:
            ab.put_kv("news_digest_now", {"go": False, "at": now.isoformat()})
        except Exception:
            pass
    seen, uniq = set(), []
    for p in pos:
        if p["yt"] not in seen:
            seen.add(p["yt"])
            uniq.append(p)
    names = _names(rt, [p["yt"] for p in uniq])

    def one(p):
        yt, m = p["yt"], p["market"]
        nm, al = names.get(yt, (None, None))
        nm = nm or p.get("name") or yt
        if m == "crypto":
            nm = nm if HANGUL.search(nm) else yt.replace("-KRW", "")
        words = {nm.split()[0] if m == "us" else nm}
        for w in (al or holdings.ALIAS.get(yt) or "").split()[:2]:
            words.add(w)
        try:
            if NAVER_ID and NAVER_KEY:
                q = naver_query(yt, m, nm, al)
                arts = wide_naver(q, since, now) if q else []
                words.add(q or "")
                if not arts and m == "us":
                    gq, lang = query_for(yt, m, nm, al)
                    arts = wide_google(gq.replace("when:3d", "when:2d"), lang, since, now) if gq else []
                    words.add(re.sub(r'"|when:\S+', "", gq or "").strip())
            else:
                gq, lang = query_for(yt, m, nm, al)
                arts = wide_google(gq.replace("when:3d", "when:2d"), lang, since, now) if gq else []
                words.add(re.sub(r'"|when:\S+', "", gq or "").strip())
            if not arts and m == "us" and yt.isalpha() and len(yt) >= 3:     # 영어 이름 ETF 등: 종목 코드로 한 번 더
                arts = wide_google(f'"{yt}" when:2d', "en", since, now)
        except Exception:
            arts = []
        if m == "us" and yt.isalpha() and len(yt) >= 3:
            words.add(yt)
        return p, key_news(arts, [w for w in words if w and len(w) >= 2])

    with ThreadPoolExecutor(max_workers=4) as ex:
        got = list(ex.map(one, uniq))
    got = [(p, top) for p, top in got if top]
    got.sort(key=lambda x: -sum(s for s, _, _ in x[1][:2]))
    label = "어제 핵심 뉴스" if not force else "최근 24시간 핵심 뉴스"
    tok = rt.base.get_access_token()
    if not got:
        rt.send_short(tok, f"📰 {label}\n보유 {len(uniq)}종목에 눈에 띄는 기사가 없었어요.")
        return "뉴스 요약 카톡 0종목"
    sent = 0
    for p, top in got[:DIGEST_MAX]:
        try:
            rt.send_short(tok, digest_msg(rt, label, p.get("name") or p["yt"], top))
            sent += 1
        except Exception:
            pass
    rest = len(got) - DIGEST_MAX
    if rest > 0:
        try:
            rt.send_short(tok, f"📰 그 밖에 {rest}종목 뉴스는 앱 보유 탭에서 볼 수 있어요.")
        except Exception:
            pass
    return f"뉴스 요약 카톡 {sent}종목"


def run(rt, book, now):
    """엔진 실행 끝에 호출 → 공개 기록용 짧은 요약 (개수만)"""
    if not ab.enabled():
        return ""
    notes = []
    try:
        import broker_sync                      # 토스증권 보유 → 앱 보유 (비밀값이 없으면 아무것도 안 함)
        bs = broker_sync.run(book, now)
        if bs:
            notes.append(bs)
    except ImportError:
        pass
    except Exception as e:
        notes.append(f"증권사 보유 반영 실패 ({type(e).__name__})")
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
        mc = mine_close_job(rt, book, now)
        if mc:
            notes.append("보유 마감 요약 카톡 " + "·".join(mc))
    except Exception as e:
        notes.append(f"보유 마감 요약 실패 ({type(e).__name__})")
    try:
        nd = digest_job(rt, book, now)
        if nd:
            notes.append(nd)
    except Exception as e:
        notes.append(f"뉴스 요약 실패 ({type(e).__name__})")
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
