"""내 보유 종목 분석 — 앱 '보유' 탭용 (엔진이 5분마다 돌 때 같이 실행)

- 매주 한 번: 종목 검색 목록 (국장: 한국거래소 KIND · 미장: 나스닥 공시 목록 · 코인: 업비트 원화 마켓)
- 15분마다: 앱이 요청한 종목(종목 코드만, 누가 보냈는지는 모름)의 현재가 · 지표 상태 · 부가 데이터
  (새로 요청된 종목은 다음 실행 때 바로)
- 하루 한 번: 지표 8가지 상태 조합별로 '1·5·20거래일 뒤 실제로 오른 비율' 표 (시장별, 최근 5년)

공개 실행 기록에는 종목 이름·코드를 남기지 않고 개수만 남겨요.
"""
import json
import re
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests

import app_bridge as ab

H = (1, 5, 20)                                         # 예상 기간 (거래일)
IND = [("trend", "단기 상승세"), ("mid", "중기 상승세"), ("align", "상승 정렬"), ("mom", "사는 힘 우세"),
       ("macd", "오름 가속"), ("vol", "거래 활발"), ("mkt", "시장 상승세"), ("calm", "덜 흔들림")]
FUND_EVERY = timedelta(hours=20)                       # 재무 정보 (투자 원칙 점검표용) 다시 받는 간격
FUND_PER_RUN = 25                                      # 한 번 실행에 재무 정보를 받는 종목 수
FUND_KEYS = ("trailingPE", "priceToBook", "returnOnEquity", "debtToEquity", "profitMargins", "earningsGrowth",
             "revenueGrowth", "earningsQuarterlyGrowth", "currentRatio", "dividendRate", "trailingAnnualDividendYield",
             "heldPercentInstitutions", "trailingEps", "marketCap")
FULL_EVERY = timedelta(minutes=15)
MAX_REQ = 200                                          # 한 번에 분석할 요청 종목 수
MAX_UNIVERSE = 100                                     # 확률 표에 쓰는 시장별 종목 수
UA = {"User-Agent": "Mozilla/5.0 (tajeom-note symbols)"}

# 검색을 돕는 한글 별칭 (영문 이름 종목)
ALIAS = {
    "AAPL": "애플", "MSFT": "마이크로소프트", "NVDA": "엔비디아", "AMZN": "아마존", "GOOGL": "알파벳 구글",
    "GOOG": "알파벳 구글 C", "META": "메타", "TSLA": "테슬라", "NFLX": "넷플릭스", "AMD": "AMD 에이엠디",
    "AVGO": "브로드컴", "TSM": "TSMC", "INTC": "인텔", "QCOM": "퀄컴", "MU": "마이크론", "PLTR": "팔란티어",
    "COIN": "코인베이스", "MSTR": "마이크로스트래티지 스트래티지", "JPM": "JP모건", "V": "비자", "MA": "마스터카드",
    "KO": "코카콜라", "PEP": "펩시", "MCD": "맥도날드", "SBUX": "스타벅스", "DIS": "디즈니", "NKE": "나이키",
    "BRK-B": "버크셔 해서웨이", "JNJ": "존슨앤드존슨", "LLY": "일라이 릴리", "UNH": "유나이티드헬스",
    "XOM": "엑슨모빌", "WMT": "월마트", "COST": "코스트코", "ORCL": "오라클", "CRM": "세일즈포스", "ADBE": "어도비",
    "UBER": "우버", "ARM": "암홀딩스 ARM", "IONQ": "아이온큐", "QQQ": "나스닥100 ETF", "SPY": "S&P500 ETF",
    "VOO": "S&P500 ETF 뱅가드", "SCHD": "배당 ETF 슈드", "TQQQ": "나스닥 3배", "SOXL": "반도체 3배",
    "005490.KS": "포스코홀딩스", "035420.KS": "네이버", "035900.KQ": "JYP",
}
SKIP_US = re.compile(r"\b(Warrant|Warrants|Unit|Units|Right|Rights|Notes?|Debenture|Depositary Shares? representing .*Preferred)\b", re.I)


def log(rt, msg):
    try:
        rt.log(msg)
    except Exception:
        pass


# ---------- 서버 읽고 쓰기 ----------

def _get(path):
    r = ab._check(requests.get(f"{ab.URL}/rest/v1/{path}", timeout=20, headers=ab._headers()))
    return r.json()


def _get_in(table, cols, yts):
    """yt 목록으로 여러 행 읽기 (80개씩)"""
    from urllib.parse import quote
    out = []
    for i in range(0, len(yts), 80):
        part = ",".join('"' + y.replace('"', "") + '"' for y in yts[i:i + 80])
        out += _get(f"{table}?select={cols}&yt=in.({quote(part, safe=',')})")
    return out


def _upsert(table, rows, key):
    for i in range(0, len(rows), 800):
        ab._check(requests.post(f"{ab.URL}/rest/v1/{table}?on_conflict={key}", timeout=30,
                                data=json.dumps(rows[i:i + 800], ensure_ascii=False, default=str),
                                headers=ab._headers({"Prefer": "resolution=merge-duplicates,return=minimal"})))


# ---------- 종목 검색 목록 ----------

def _kind(market_type, suffix, exch):
    """한국거래소 상장법인 목록 (HTML 표) → 행 목록"""
    url = f"http://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType={market_type}"
    r = requests.get(url, timeout=30, headers=UA)
    r.raise_for_status()
    raw = r.content
    for enc in ("euc-kr", "cp949", "utf-8"):
        try:
            html = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        html = raw.decode("utf-8", "replace")
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        cells = [re.sub(r"<[^>]+>|&nbsp;", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)]
        if len(cells) < 2:
            continue
        name = cells[0]
        code = next((c.zfill(6) for c in cells[1:4] if re.fullmatch(r"[0-9A-Z]{1,6}", c) and re.search(r"\d", c)), None)
        if name and code:
            yt = f"{code}.{suffix}"
            rows.append({"yt": yt, "code": code, "name": name, "alias": ALIAS.get(yt), "market": "kr", "exch": exch})
    return rows


def _nasdaq(fname):
    r = requests.get(f"https://www.nasdaqtrader.com/dynamic/symdir/{fname}", timeout=30, headers=UA)
    r.raise_for_status()
    lines = r.text.splitlines()
    head = lines[0].split("|")
    rows = []
    for ln in lines[1:]:
        if ln.startswith("File Creation Time"):
            continue
        f = dict(zip(head, ln.split("|")))
        sym = f.get("Symbol") or f.get("ACT Symbol") or ""
        name = (f.get("Security Name") or "").strip()
        if not sym or f.get("Test Issue") == "Y" or not re.fullmatch(r"[A-Z][A-Z0-9.]{0,9}", sym) or SKIP_US.search(name):
            continue
        yt = sym.replace(".", "-")
        exch = "NASDAQ" if fname.startswith("nasdaq") else {"N": "NYSE", "A": "NYSE American", "P": "NYSE Arca",
                                                             "Z": "Cboe", "V": "IEX"}.get(f.get("Exchange"), "US")
        short = re.split(r" - | Common Stock| Ordinary Shares| Class [A-C] ", name)[0].strip() or name
        rows.append({"yt": yt, "code": sym, "name": short[:80], "alias": ALIAS.get(yt), "market": "us", "exch": exch})
    return rows


def _upbit():
    r = requests.get("https://api.upbit.com/v1/market/all?isDetails=false", timeout=20, headers=UA)
    r.raise_for_status()
    rows = []
    for x in r.json():
        mk = x.get("market", "")
        if mk.startswith("KRW-"):
            sym = mk[4:]
            rows.append({"yt": f"{sym}-KRW", "code": sym, "name": x.get("korean_name") or sym,
                         "alias": x.get("english_name"), "market": "crypto", "exch": "UPBIT"})
    return rows


def symbols_job(rt, now):
    got, rows = {}, []
    for label, fn in (("국장", lambda: _kind("stockMkt", "KS", "KOSPI") + _kind("kosdaqMkt", "KQ", "KOSDAQ")),
                      ("미장", lambda: _nasdaq("nasdaqlisted.txt") + _nasdaq("otherlisted.txt")),
                      ("코인", _upbit)):
        try:
            part = fn()
            got[label] = len(part)
            rows += part
        except Exception as e:
            got[label] = 0
            log(rt, f"종목 목록 받기 실패: {label} ({type(e).__name__})")
    seen, uniq = set(), []
    for r in rows:
        if r["yt"] not in seen:
            seen.add(r["yt"])
            r["updated_at"] = now.isoformat()
            uniq.append(r)
    if uniq:
        _upsert("symbols", uniq, "yt")
    return got


# ---------- 지표 ----------

def _naive(idx, tz):
    """시간대가 다른 일봉 날짜를 맞추려고 그 시장 날짜(시간대 없음)로"""
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_convert(tz).tz_localize(None)
    return pd.DatetimeIndex(idx).normalize()


def market_series(rt, market, idx_daily):
    """대표 지수 종가가 200일선 위인 날 = True"""
    if idx_daily is None or len(idx_daily) < 210:
        return None
    c = idx_daily["Close"].copy()
    c.index = _naive(c.index, rt.TZ[market])
    return (c > c.rolling(200).mean()).groupby(level=0).last()


def market_stats(rt, market, idx_daily):
    """대표 지수: 200일 평균 대비 위치의 1년 백분위 · 상승 흐름 여부 · 6개월/1년 수익률 (투자 원칙 점검표용)"""
    if idx_daily is None or len(idx_daily) < 210:
        return None
    c = idx_daily["Close"].dropna()
    gap = c / c.rolling(200).mean() - 1
    return {"pct": _pctile(gap), "good": bool(gap.iloc[-1] > 0),
            "r6": float(c.iloc[-1] / c.iloc[-127] - 1) if len(c) > 127 else None,
            "r12": float(c.iloc[-1] / c.iloc[-253] - 1) if len(c) > 253 else None}


def _pctile(sr, n=252):
    """오늘 값이 지난 1년 중 몇 %의 날보다 높은지 (0~100)"""
    x = sr.dropna().iloc[-n:]
    if len(x) < 60 or not np.isfinite(x.iloc[-1]):
        return None
    return int(round((x.iloc[:-1] < x.iloc[-1]).mean() * 100))


def frame(rt, market, df, mkt):
    """일봉 → 지표 8가지 상태(참/거짓) 표 + 계산에 쓴 값"""
    df = df.copy()
    df.index = _naive(df.index, rt.TZ[market])
    df = df[~df.index.duplicated(keep="last")]
    c, v = df["Close"], df["Volume"].fillna(0)
    ma20, ma60 = c.rolling(20).mean(), c.rolling(60).mean()
    r = rt.rsi(c)
    line, sig = rt.macd(c)
    vavg = v.rolling(20).mean()
    vr = (v / vavg).where(vavg > 0)
    sd20 = c.pct_change().rolling(20).std()
    med = sd20.rolling(250, min_periods=120).median()
    mk = (mkt.reindex(c.index, method="ffill") if mkt is not None else pd.Series(True, index=c.index)).fillna(True)
    st = pd.DataFrame({"trend": c > ma20, "mid": c > ma60, "align": ma20 > ma60, "mom": r >= 50,
                       "macd": line > sig, "vol": vr > 1, "mkt": mk.astype(bool), "calm": sd20 < med}, index=c.index)
    valid = ma60.notna() & r.notna() & med.notna() & vr.notna()
    bits = sum(st[k].astype(int) * (1 << i) for i, (k, _) in enumerate(IND))
    return df, bits.astype(int), valid, {"ma20": ma20, "ma60": ma60, "rsi": r, "macd": line - sig, "vr": vr, "sd20": sd20,
                                         "gap20": c / ma20 - 1, "gap60": c / ma60 - 1, "gapal": ma20 / ma60 - 1, "macdn": (line - sig) / c}


def _r(x, n=2):
    return None if x is None or not np.isfinite(x) else round(float(x), n)


def analyze(rt, market, df, mkt, now, mstat=None, fund=None):
    """한 종목: 현재가 · 오늘 등락 · 지표 상태 · 부가 데이터(안정성 등)"""
    if df is None or len(df) < 80:
        return {"ok": False, "err": "데이터가 부족해요"}
    closed = rt.closed_days(df, market, now) if market != "crypto" else df.iloc[:-1]
    if len(closed) < 80:
        return {"ok": False, "err": "데이터가 부족해요"}
    price = float(df["Close"].iloc[-1])
    prev = float(closed["Close"].iloc[-1]) if len(df) > len(closed) else float(df["Close"].iloc[-2])
    d, bits, valid, v = frame(rt, market, closed, mkt)
    if not valid.iloc[-1]:
        return {"ok": False, "err": "지표를 계산할 데이터가 부족해요"}
    c = d["Close"]
    last = c.index[-1]
    try:
        mon = c.resample("ME").last()
    except ValueError:                                 # 예전 pandas
        mon = c.resample("M").last()
    m = mon.pct_change().dropna().iloc[-12:]
    yr = c.iloc[-252:]
    out = {
        "ok": True, "price": _r(price, 4), "prev": _r(prev, 4), "chg": _r((price / prev - 1) * 100),
        "asof": pd.Timestamp(df.index[-1]).isoformat(), "day": last.date().isoformat(),
        "bits": int(bits.iloc[-1]),
        "vals": {"ma20": _r((c.iloc[-1] / v["ma20"].iloc[-1] - 1) * 100, 1), "ma60": _r((c.iloc[-1] / v["ma60"].iloc[-1] - 1) * 100, 1),
                 "rsi": _r(v["rsi"].iloc[-1], 0), "vr": _r(v["vr"].iloc[-1], 2), "vola": _r(v["sd20"].iloc[-1] * np.sqrt(252) * 100, 0)},
        "extra": {"upm": int((m > 0).sum()), "months": int(len(m)),
                  "mdd": _r((yr / yr.cummax() - 1).min() * 100, 1), "hi52": _r((c.iloc[-1] / yr.max() - 1) * 100, 1),
                  "r1m": _r((c.iloc[-1] / c.iloc[-22] - 1) * 100, 1) if len(c) > 22 else None,
                  "r3m": _r((c.iloc[-1] / c.iloc[-64] - 1) * 100, 1) if len(c) > 64 else None,
                  "r1y": _r((c.iloc[-1] / c.iloc[-252] - 1) * 100, 1) if len(c) > 252 else None},
    }
    out["pct"] = {"trend": _pctile(v["gap20"]), "mid": _pctile(v["gap60"]), "align": _pctile(v["gapal"]),
                  "mom": _pctile(v["rsi"]), "macd": _pctile(v["macdn"]), "vol": _pctile(v["vr"]),
                  "calm": (lambda q: None if q is None else 100 - q)(_pctile(v["sd20"])),
                  "mkt": (mstat or {}).get("pct")}
    out["spark"] = [_r(x, 4) for x in c.iloc[-63:].tolist()]           # 최근 3개월 종가 (작은 그래프)
    if market != "crypto":                             # 실적 발표일 · 배당
        dr = _f(fund, "dividendRate")
        out["events"] = {"earn": (fund or {}).get("earn"), "exdiv": (fund or {}).get("exdiv"),
                         "dy": _r(dr / price * 100, 2) if dr and price > 0 else None}
    out["axes"] = axes(market, out["pct"], fund)
    av = [v for v in out["axes"].values() if v is not None]
    out["score"] = int(round(sum(av) / len(av))) if len(av) >= 3 else None
    try:
        out["legend"] = legends(market, d, mstat, fund)
    except Exception as e:                             # 관점 계산이 실패해도 나머지 분석은 보여 줌
        out["legend"] = []
        out["legend_err"] = type(e).__name__
    return out


# ---------- 한눈에 보기: 5가지 축 (0~100) ----------

def _band(x, cuts):
    """cuts: [(기준, 점수), ...] 위에서부터 x >= 기준이면 그 점수"""
    if x is None:
        return None
    for lim, sc in cuts:
        if x >= lim:
            return sc
    return 0


def _avg(xs, need=1):
    xs = [x for x in xs if x is not None]
    return int(round(sum(xs) / len(xs))) if len(xs) >= need else None


def axes(market, pct, fund):
    """상승 힘 · 안정감 (가격) + 가격 매력 · 성장성 · 재무 건강 (재무). 코인은 시장 분위기를 셋째 축으로"""
    power = _avg([pct.get(k) for k in ("trend", "mid", "align", "mom", "macd")], 3)
    calm = pct.get("calm")
    if market == "crypto":
        return {"power": power, "calm": calm, "mkt": pct.get("mkt")}
    pe, pb, eg = _f(fund, "trailingPE"), _f(fund, "priceToBook"), _f(fund, "earningsGrowth")
    peg = pe / (eg * 100) if pe and eg and pe > 0 and eg > 0 else None
    inv = lambda x: None if x is None else (-x if x > 0 else -1e9)       # 낮을수록 좋은 값 (0 이하 = 적자 → 0점)
    value = _avg([_band(inv(pe), [(-10, 100), (-15, 75), (-25, 50), (-40, 25)]),
                  _band(inv(pb), [(-1, 100), (-1.5, 75), (-3, 50), (-6, 25)]),
                  _band(inv(peg), [(-0.5, 100), (-1, 75), (-1.5, 50), (-2.5, 25)])], 2)
    growth = _avg([_band(eg, [(0.3, 100), (0.15, 75), (0.05, 50), (0, 25)]),
                   _band(_f(fund, "earningsQuarterlyGrowth"), [(0.3, 100), (0.15, 75), (0.05, 50), (0, 25)]),
                   _band(_f(fund, "revenueGrowth"), [(0.2, 100), (0.1, 75), (0.03, 50), (0, 25)])], 2)
    de = _f(fund, "debtToEquity")
    health = _avg([_band(_f(fund, "returnOnEquity"), [(0.2, 100), (0.15, 75), (0.08, 50), (0, 25)]),
                   _band(inv(de) if de is not None else None, [(-30, 100), (-60, 75), (-100, 50), (-200, 25)]) if de is None or de >= 0 else None,
                   _band(_f(fund, "currentRatio"), [(2, 100), (1.5, 75), (1, 50), (0, 25)]),
                   _band(_f(fund, "profitMargins"), [(0.2, 100), (0.1, 75), (0.03, 50), (0, 25)])], 2)
    return {"power": power, "calm": calm, "value": value, "growth": growth, "health": health}


# ---------- 투자 원칙 점검표 (널리 알려진 원칙을 단순화, 특정 인물 이름은 쓰지 않음) ----------

LEGENDS = [
    ("trend", "상승 추세", "강한 상승 추세에 올라탄 종목만"),
    ("breakout", "신고가 돌파", "새 고점을 거래량과 함께 뚫을 때"),
    ("leader", "실적 주도주", "실적이 빠르게 느는 주도주의 돌파"),
    ("quality", "우량 기업", "돈 잘 벌고 빚 적은 회사를 적당한 값에"),
    ("value", "안전마진", "회사 가치보다 싸게 사서 안전하게"),
    ("garp", "성장 대비 적정가", "성장에 비해 아직 싼 회사"),
]
PRICE_ONLY = {"trend", "breakout"}


def _f(fund, k):
    try:
        x = (fund or {}).get(k)
        return float(x) if x is not None and np.isfinite(float(x)) else None
    except (TypeError, ValueError):
        return None


def _ck(t, ok, val=None):
    return {"t": t, "ok": None if ok is None else bool(ok), "v": val}


def _both(a, b, fn):
    return None if a is None or b is None else fn(a, b)


def legends(market, d, mstat, fund):
    """종목 하나 → 원칙별 [점검 항목 · 충족률 %]. 확인할 수 없는 항목은 ok=None (계산에서 빠짐)"""
    c, vol = d["Close"], d["Volume"].fillna(0)
    p = float(c.iloc[-1])
    ma = lambda n: float(c.rolling(n).mean().iloc[-1]) if len(c) >= n else None
    ma50, ma150, ma200 = ma(50), ma(150), ma(200)
    ma200_1m = float(c.rolling(200).mean().iloc[-23]) if len(c) >= 223 else None
    yr = c.iloc[-252:]
    hi52, lo52 = float(yr.max()), float(yr.min())
    hi20 = float(c.iloc[-21:-1].max()) if len(c) > 21 else None
    vavg = vol.rolling(20).mean()
    vr = float(vol.iloc[-1] / vavg.iloc[-1]) if vavg.iloc[-1] > 0 else None
    ch = c.diff().iloc[-50:]
    vv = vol.iloc[-50:]
    upv, dnv = vv[ch > 0].mean(), vv[ch < 0].mean()
    updn = float(upv / dnv) if dnv and np.isfinite(upv) and np.isfinite(dnv) and dnv > 0 else None
    r6 = float(p / c.iloc[-127] - 1) if len(c) > 127 else None
    r12 = float(p / c.iloc[-253] - 1) if len(c) > 253 else None
    ms = mstat or {}
    good = ms.get("good")
    pe, pb, roe, de = _f(fund, "trailingPE"), _f(fund, "priceToBook"), _f(fund, "returnOnEquity"), _f(fund, "debtToEquity")
    pm, eg, rg, eq = _f(fund, "profitMargins"), _f(fund, "earningsGrowth"), _f(fund, "revenueGrowth"), _f(fund, "earningsQuarterlyGrowth")
    cr, inst, eps = _f(fund, "currentRatio"), _f(fund, "heldPercentInstitutions"), _f(fund, "trailingEps")
    div = _f(fund, "dividendRate")
    divy = _f(fund, "trailingAnnualDividendYield")
    pc = lambda x: None if x is None else f"{x * 100:+.0f}%"
    pc0 = lambda x: None if x is None else f"{x * 100:.0f}%"
    gap = lambda a, b: None if a is None or b is None else f"{(a / b - 1) * 100:+.1f}%"
    items = {
        "trend": [
            _ck("현재가가 150일·200일 평균보다 위", _both(ma150, ma200, lambda a, b: p > a and p > b)),
            _ck("150일 평균이 200일 평균보다 위", _both(ma150, ma200, lambda a, b: a > b)),
            _ck("200일 평균이 한 달째 오르는 중", _both(ma200, ma200_1m, lambda a, b: a > b)),
            _ck("50일 평균이 150일·200일 평균보다 위", None if ma50 is None else _both(ma150, ma200, lambda a, b: ma50 > a and ma50 > b)),
            _ck("현재가가 50일 평균보다 위", None if ma50 is None else p > ma50, gap(p, ma50)),
            _ck("1년 최저가보다 30% 이상 위", p >= lo52 * 1.3, gap(p, lo52)),
            _ck("1년 최고가와 25% 이내", p >= hi52 * 0.75, gap(p, hi52)),
            _ck("1년 수익률이 시장보다 높음", _both(r12, ms.get("r12"), lambda a, b: a > b), pc(r12)),
        ],
        "breakout": [
            _ck("1년 최고가와 5% 이내 (새 고점 근처)", p >= hi52 * 0.95, gap(p, hi52)),
            _ck("최근 20일 고점을 넘어섬", None if hi20 is None else p >= hi20, gap(p, hi20)),
            _ck("거래량이 평소의 1.3배 이상", None if vr is None else vr >= 1.3, None if vr is None else f"{vr:.1f}배"),
            _ck("큰 흐름이 위로 (50일 평균 > 200일 평균)", _both(ma50, ma200, lambda a, b: a > b)),
            _ck("시장이 상승 흐름", good),
        ],
        "leader": [
            _ck("최근 분기 이익 25% 이상 증가", None if eq is None else eq >= 0.25, pc(eq)),
            _ck("매출 20% 이상 성장", None if rg is None else rg >= 0.20, pc(rg)),
            _ck("1년 최고가와 15% 이내", p >= hi52 * 0.85, gap(p, hi52)),
            _ck("오른 날 거래량이 내린 날보다 많음 (50일)", None if updn is None else updn >= 1, None if updn is None else f"{updn:.2f}배"),
            _ck("6개월 수익률이 시장보다 높음", _both(r6, ms.get("r6"), lambda a, b: a > b), pc(r6)),
            _ck("기관 보유 20% 이상", None if inst is None else inst >= 0.20, pc0(inst)),
            _ck("시장이 상승 흐름", good),
        ],
        "quality": [
            _ck("ROE 15% 이상 (자기 돈으로 잘 범)", None if roe is None else roe >= 0.15, pc0(roe)),
            _ck("부채비율 50% 미만", None if de is None else de < 50, None if de is None else f"{de:.0f}%"),
            _ck("순이익률 15% 이상", None if pm is None else pm >= 0.15, pc0(pm)),
            _ck("이익이 늘고 있음", None if eg is None else eg > 0, pc(eg)),
            _ck("비싸지 않음 (PER 25 이하, 흑자)", None if pe is None else 0 < pe <= 25, None if pe is None else f"PER {pe:.1f}"),
        ],
        "value": [
            _ck("흑자 회사", None if eps is None else eps > 0),
            _ck("PER 15 이하", None if pe is None else 0 < pe <= 15, None if pe is None else f"{pe:.1f}"),
            _ck("PBR 1.5 이하", None if pb is None else 0 < pb <= 1.5, None if pb is None else f"{pb:.2f}"),
            _ck("PER × PBR 22.5 이하", _both(pe, pb, lambda a, b: 0 < a * b <= 22.5), _both(pe, pb, lambda a, b: f"{a * b:.1f}")),
            _ck("유동비율 2 이상 (단기 빚 갚을 힘)", None if cr is None else cr >= 2, None if cr is None else f"{cr:.1f}"),
            _ck("배당을 줌", None if div is None and divy is None else (div or 0) > 0 or (divy or 0) > 0),
        ],
        "garp": [
            _ck("PEG 1 이하 (PER ÷ 이익 성장률)", None if pe is None or eg is None or pe <= 0 or eg <= 0 else pe / (eg * 100) <= 1,
                None if pe is None or eg is None or pe <= 0 or eg <= 0 else f"{pe / (eg * 100):.2f}"),
            _ck("이익 성장 15% 이상", None if eg is None else eg >= 0.15, pc(eg)),
            _ck("부채비율 35% 미만", None if de is None else de < 35, None if de is None else f"{de:.0f}%"),
            _ck("매출도 늘고 있음", None if rg is None else rg > 0, pc(rg)),
            _ck("기관 보유 60% 미만 (아직 덜 알려짐)", None if inst is None else inst < 0.60, pc0(inst)),
        ],
    }
    out = []
    for key, method, idea in LEGENDS:
        its = items[key]
        if market == "crypto" and key not in PRICE_ONLY:
            out.append({"id": key, "m": method, "idea": idea, "na": "코인은 회사 재무 정보가 없어서 볼 수 없어요"})
            continue
        known = [x for x in its if x["ok"] is not None]
        okn = sum(1 for x in known if x["ok"])
        enough = len(known) >= max(2, (len(its) + 1) // 2)
        out.append({"id": key, "m": method, "idea": idea, "items": its, "n": len(known), "pass": okn,
                    "pct": int(round(okn / len(known) * 100)) if enough else None,
                    "na": None if enough else "확인할 수 있는 정보가 부족해요"})
    return out


def prob_tables(rt, universe, now):
    """시장별: 지표 상태 조합(2^8칸)마다 [표본 수, 오른 수] × 1·5·20거래일"""
    out = {"made": now.isoformat(), "h": list(H), "ind": [k for k, _ in IND], "names": [n for _, n in IND], "markets": {}}
    for market, tickers in universe.items():
        tickers = sorted(set(tickers))[:MAX_UNIVERSE]
        if not tickers:
            continue
        idx = rt.fetch_many([rt.INDEX[market]], "5y", "1d").get(rt.INDEX[market])
        mkt = market_series(rt, market, idx)
        cells = np.zeros((256, len(H), 2), dtype=np.int64)
        used = 0
        for i in range(0, len(tickers), 40):
            data = rt.fetch_many(tickers[i:i + 40], "5y", "1d")
            for t, df in data.items():
                closed = rt.closed_days(df, market, now) if market != "crypto" else df.iloc[:-1]
                if len(closed) < 320:
                    continue
                d, bits, valid, _ = frame(rt, market, closed, mkt)
                c = d["Close"]
                used += 1
                for j, h in enumerate(H):
                    fwd = c.shift(-h) / c - 1
                    ok = (valid & fwd.notna()).values
                    b = bits.values[ok]
                    np.add.at(cells[:, j, 0], b, 1)
                    np.add.at(cells[:, j, 1], b, (fwd.values[ok] > 0).astype(np.int64))
        if used:
            out["markets"][market] = {"tickers": used, "base": cells.sum(axis=0).tolist(),
                                      "cells": {str(k): cells[k].tolist() for k in range(256) if cells[k, :, 0].sum()}}
    return out


# ---------- 실행 ----------

def _epoch_day(x):
    try:
        x = float(x)
        return datetime.fromtimestamp(x, tz=timezone.utc).date().isoformat() if x > 0 else None
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def fetch_info(rt, t, today=None):
    """야후 파이낸스 재무 요약 → 숫자 항목 + 다음 실적 발표일(earn) · 배당락일(exdiv)"""
    info = rt.yf.Ticker(t).info or {}
    out = {}
    for k in FUND_KEYS:
        x = info.get(k)
        if isinstance(x, (int, float)) and not isinstance(x, bool) and np.isfinite(x):
            out[k] = float(x)
    for k in ("earningsTimestampStart", "earningsTimestamp"):
        d = _epoch_day(info.get(k))
        if d:
            out["earn"] = d
            break
    ex = _epoch_day(info.get("exDividendDate"))
    if ex:
        out["exdiv"] = ex
    today = today or datetime.now(timezone.utc).date().isoformat()
    if (not out.get("earn") or out["earn"] < today) and not t.endswith((".KS", ".KQ")) and hasattr(rt, "earnings_dates"):
        try:                                           # 미장: 실적 일정 표에서 다음 날짜
            nxt = [d for d in rt.earnings_dates(t) if d >= today]
            if nxt:
                out["earn"] = nxt[0]
        except Exception:
            pass
    return out


def fund_job(rt, reqs, now):
    """요청 종목(코인 빼고)의 재무 정보: 20시간 지난 것만, 실행마다 최대 FUND_PER_RUN개 → (yt→재무, 새로 받은 수)"""
    stocks = [r["yt"] for r in reqs if r["market"] != "crypto"]
    if not stocks:
        return {}, 0
    have = {x["yt"]: x for x in _get_in("fund", "yt,data,updated_at", stocks)}
    stale = [t for t in stocks if t not in have or _old(have[t].get("updated_at"), now, FUND_EVERY)]
    rows, fails = [], 0
    for t in stale[:FUND_PER_RUN]:
        try:
            d = fetch_info(rt, t, now.date().isoformat())
        except Exception:
            fails += 1
            if fails >= 3:                             # 막히면 이번 실행은 그만 (다음 실행에 다시)
                break
            continue
        rows.append({"yt": t, "data": d, "updated_at": now.isoformat()})
        have[t] = {"data": d}
        time.sleep(0.3)
    if rows:
        _upsert("fund", rows, "yt")
    return {t: (have.get(t) or {}).get("data") for t in stocks}, len(rows)


def _old(flag, now, gap):
    try:
        return now - datetime.fromisoformat(flag) >= gap
    except (TypeError, ValueError):
        return True


def run(rt, book, now):
    """엔진 실행 끝에 호출 → 공개 기록용 짧은 요약 (개수만)"""
    if not ab.enabled():
        return ""
    flags, notes = book["flags"], []
    if _old(flags.get("symbols"), now, timedelta(days=7)):
        flags["symbols"] = now.isoformat()
        got = symbols_job(rt, now)
        notes.append("종목 목록 " + "·".join(f"{k} {v}" for k, v in got.items()))

    since = (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    reqs = _get(f"hold_req?select=yt,market&last_at=gte.{since}&order=last_at.desc&limit={MAX_REQ}")
    fund, nf = {}, 0
    try:                                               # 재무 정보 (투자 원칙 점검표) — 하루 한 번, 실행마다 조금씩
        fund, nf = fund_job(rt, reqs, now)
        if nf:
            notes.append(f"재무 {nf}개")
    except Exception as e:
        notes.append(f"재무 실패 ({type(e).__name__})")
    full = _old(flags.get("hold_an"), now, FULL_EVERY)
    if not full:
        have = {x["yt"] for x in _get("hold_an?select=yt")}
        reqs = [r for r in reqs if r["yt"] not in have]
    if reqs:
        if full:
            flags["hold_an"] = now.isoformat()
        by = {}
        for r in reqs:
            by.setdefault(r["market"], []).append(r["yt"])
        rows = []
        for market, tickers in by.items():
            idx = rt.fetch_many([rt.INDEX[market]], "2y", "1d").get(rt.INDEX[market])
            mkt = market_series(rt, market, idx)
            mstat = market_stats(rt, market, idx)
            for i in range(0, len(tickers), 40):
                data = rt.fetch_many(tickers[i:i + 40], "2y", "1d")
                for t in tickers[i:i + 40]:
                    try:
                        res = analyze(rt, market, data.get(t), mkt, now, mstat, fund.get(t))
                    except Exception as e:
                        res = {"ok": False, "err": "계산 오류", "why": type(e).__name__}
                    rows.append({"yt": t, "market": market, "data": res, "updated_at": now.isoformat()})
        _upsert("hold_an", rows, "yt")
        notes.append(f"보유 분석 {len(rows)}개" + ("" if full else " (새 종목)"))

    k = now.astimezone(rt.KST)
    if flags.get("hold_prob") != k.date().isoformat() and k.hour >= 7:
        flags["hold_prob"] = k.date().isoformat()
        universe = {m: [t for cats in (rt.MARKETS.get(m) or {}).values() for t in cats] for m in ("kr", "us", "crypto")}
        for r in _get(f"hold_req?select=yt,market&last_at=gte.{since}&order=n.desc&limit=600"):
            universe.setdefault(r["market"], []).append(r["yt"])
        t0 = time.time()
        tab = prob_tables(rt, universe, now)
        ab.put_kv("hold_prob", tab)
        notes.append(f"확률 표 {sum(v['tickers'] for v in tab['markets'].values())}종목 {time.time() - t0:.0f}초")
    return (" · " + " · ".join(notes)) if notes else ""
