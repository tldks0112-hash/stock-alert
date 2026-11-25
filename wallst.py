# 월가 픽: 미국 큰 기관들이 SEC에 낸 13F 보유 공시(분기 말 기준, 45일 안에 공시)를 30분마다 확인해서
# 새 공시가 올라오면 '새로 산 · 늘린 · 줄인 · 다 판' 종목을 계산해 앱에 올려요.
# 데이터: SEC EDGAR(공개 자료, 키 없음) · 종목 코드 변환: OpenFIGI(무료).
# 공개 실행 기록에는 개수만 남겨요.

import json
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import requests

import app_bridge as ab
import holdings

EVERY = timedelta(minutes=30)
MAX_NEW = 3                         # 한 번 실행에 새로 처리하는 기관 수 (처음 채울 때 오래 걸리지 않게)
MAX_XML = 15 * 1024 * 1024          # 너무 큰 보유표는 건너뜀
SHOW = 15                           # 목록마다 보여 줄 종목 수
# (CIK, SEC 등록 이름에 들어 있어야 하는 말, 앱에 보일 이름) — 이름이 안 맞으면 그 기관은 건너뜀
FUNDS = [
    ("1067983", "BERKSHIRE", "버크셔 해서웨이"),
    ("1336528", "PERSHING", "퍼싱 스퀘어"),
    ("1350694", "BRIDGEWATER", "브리지워터"),
    ("1649339", "SCION", "사이언 에셋"),
    ("1697748", "ARK INVEST", "ARK 인베스트"),
    ("1037389", "RENAISSANCE", "르네상스 테크놀로지"),
    ("1029160", "SOROS", "소로스 펀드 매니지먼트"),
    ("1167483", "TIGER", "타이거 글로벌"),
    ("1536411", "DUQUESNE", "듀케인 패밀리 오피스"),
    ("1656456", "APPALOOSA", "아팔루사"),
    ("1040273", "THIRD POINT", "서드 포인트"),
    ("1061768", "BAUPOST", "바우포스트"),
]
CONTACT = ab._clean(os.environ.get("SEC_CONTACT") or os.environ.get("GMAIL_USER")) or "github.com/tldks0112-hash/stock-alert"
UA = {"User-Agent": f"TajeomNote {CONTACT}", "Accept-Encoding": "gzip, deflate"}


def _get(url, **kw):
    time.sleep(0.15)                 # SEC 요청은 초당 10번 아래로
    r = requests.get(url, headers=UA, timeout=30, **kw)
    r.raise_for_status()
    return r


def filings(cik):
    """→ (SEC 등록 이름, [13F-HR 공시: {acc, filed, period}] 최신순)"""
    d = _get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json").json()
    rec = (d.get("filings") or {}).get("recent") or {}
    out = []
    for i, form in enumerate(rec.get("form") or []):
        if form != "13F-HR":
            continue
        out.append({"acc": rec["accessionNumber"][i], "filed": rec["filingDate"][i], "period": rec["reportDate"][i]})
    out.sort(key=lambda x: (x["period"], x["filed"]), reverse=True)
    seen, uniq = set(), []
    for f in out:                    # 같은 분기는 가장 최근 공시 하나만
        if f["period"] not in seen:
            seen.add(f["period"])
            uniq.append(f)
    return d.get("name") or "", uniq


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_table(xml_bytes):
    """13F 보유표 XML → {cusip: [주식 수, 금액($), 회사 이름, 종류]} (풋·콜 옵션은 뺌)"""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:                # 가끔 &를 그대로 쓴 공시가 있음
        root = ET.fromstring(re.sub(rb"&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)", b"&amp;", xml_bytes))
    out = {}
    for it in root.iter():
        if _local(it.tag) != "infoTable":
            continue
        f = {}
        for ch in it.iter():
            name = _local(ch.tag)
            if name in ("nameOfIssuer", "titleOfClass", "cusip", "value", "sshPrnamt", "sshPrnamtType", "putCall"):
                f[name] = (ch.text or "").strip()
        if f.get("putCall") or not f.get("cusip"):
            continue
        cu = f["cusip"].upper()
        try:
            sh, val = float(f.get("sshPrnamt") or 0), float(f.get("value") or 0)
        except ValueError:
            continue
        x = out.setdefault(cu, [0.0, 0.0, f.get("nameOfIssuer", ""), f.get("titleOfClass", "")])
        x[0] += sh
        x[1] += val
    return out


def holdings_of(cik, acc):
    """공시 하나의 보유표 받기 (파일 이름이 공시마다 달라서 목록에서 찾음)"""
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}"
    items = (_get(base + "/index.json").json().get("directory") or {}).get("item") or []
    xmls = [i for i in items if i.get("name", "").lower().endswith(".xml") and i.get("name", "").lower() != "primary_doc.xml"]
    xmls.sort(key=lambda i: -int(i.get("size") or 0))
    for it in xmls:
        if int(it.get("size") or 0) > MAX_XML:
            return None
        body = _get(f"{base}/{it['name']}").content
        if b"informationTable" in body[:4000] or b"infoTable" in body[:20000]:
            return parse_table(body)
    return None


def diff(now, prev):
    """→ 새로 산 · 늘린 · 줄인 · 다 판 (금액 변화가 큰 순)"""
    new, add, cut, exit_ = [], [], [], []
    for cu, (sh, val, nm, cls) in now.items():
        p = prev.get(cu)
        if not p or p[0] <= 0:
            new.append((cu, val, None))
        elif sh > p[0] * 1.02:
            add.append((cu, val - p[1], (sh / p[0] - 1) * 100))
        elif sh < p[0] * 0.98:
            cut.append((cu, p[1] - val, (sh / p[0] - 1) * 100))
    for cu, p in prev.items():
        if cu not in now and p[0] > 0:
            exit_.append((cu, p[1], -100.0))
    key = lambda x: -abs(x[1])
    return sorted(new, key=key), sorted(add, key=key), sorted(cut, key=key), sorted(exit_, key=key)


def map_tickers(cusips):
    """CUSIP → 미국 종목 코드 (DB에 저장해 두고, 없는 것만 OpenFIGI에 물어봄)"""
    cusips = sorted(set(cusips))
    have = {}
    for i in range(0, len(cusips), 80):
        part = ",".join(cusips[i:i + 80])
        for r in holdings._get(f"cusip_map?select=cusip,ticker&cusip=in.({part})"):
            have[r["cusip"]] = r["ticker"]
    need = [c for c in cusips if c not in have][:60]
    rows = []
    for i in range(0, len(need), 10):
        jobs = [{"idType": "ID_CUSIP", "idValue": c, "exchCode": "US"} for c in need[i:i + 10]]
        try:
            time.sleep(2.5)          # 키 없이 분당 25번까지
            r = requests.post("https://api.openfigi.com/v3/mapping", json=jobs, timeout=20)
            if r.status_code == 429:
                break
            r.raise_for_status()
            for c, res in zip(need[i:i + 10], r.json()):
                d = (res.get("data") or [{}])[0]
                t = (d.get("ticker") or "").replace("/", "-") or None
                have[c] = t
                rows.append({"cusip": c, "ticker": t, "name": d.get("name"), "updated_at": datetime.now(timezone.utc).isoformat()})
        except Exception:
            break
    if rows:
        holdings._upsert("cusip_map", rows, "cusip")
    return have


def _item(cu, now, prev, tick, ko, chg=None, delta=None):
    n = now.get(cu) or prev.get(cu)
    t = tick.get(cu)
    x = {"c": cu, "n": n[2][:40], "t": t, "v": round((now.get(cu) or [0, 0])[1]), "pv": round((prev.get(cu) or [0, 0])[1])}
    if t and ko.get(t):
        x["k"] = ko[t]
    if chg is not None:
        x["chg"] = round(chg, 1)
    return x


def _ko_names(tickers):
    """미국 종목 코드 → 한글 별칭 (종목 검색 목록에 있으면)"""
    out = {}
    ts = sorted({t for t in tickers if t})
    for i in range(0, len(ts), 80):
        part = ",".join('"' + t.replace('"', "") + '"' for t in ts[i:i + 80])
        for s in holdings._get(f"symbols?select=yt,alias&yt=in.({part})"):
            if s.get("alias"):
                out[s["yt"]] = s["alias"].split()[0]
    return out


def summarize(ko_label, sec_name, cur, prev_f, now, prev):
    total = sum(v[1] for v in now.values()) or 1
    top = sorted(now.items(), key=lambda kv: -kv[1][1])[:20]
    new, add, cut, exit_ = diff(now, prev)
    show = [c for c, _ in top] + [x[0] for x in new[:SHOW] + add[:SHOW] + cut[:SHOW] + exit_[:SHOW]]
    tick = map_tickers(show)
    ko = _ko_names(tick.values())
    return {
        "name": sec_name, "ko": ko_label, "period": cur["period"], "filed": cur["filed"], "acc": cur["acc"],
        "prev_period": prev_f["period"] if prev_f else None,
        "total": round(total), "count": len(now),
        "top": [dict(_item(c, now, prev, tick, ko), w=round(v[1] / total * 100, 2)) for c, v in top],
        "new": [_item(c, now, prev, tick, ko) for c, _, _ in new[:SHOW]],
        "add": [_item(c, now, prev, tick, ko, chg) for c, _, chg in add[:SHOW]],
        "cut": [_item(c, now, prev, tick, ko, chg) for c, _, chg in cut[:SHOW]],
        "exit": [_item(c, now, prev, tick, ko, -100) for c, _, _ in exit_[:SHOW]],
        "n_new": len(new), "n_add": len(add), "n_cut": len(cut), "n_exit": len(exit_),
    }


def run(rt, book, now):
    """30분마다: 기관별 최신 13F 확인 → 새 공시면 계산해서 저장 → 새로 나온 공시는 푸시 (처음 채울 때는 안 보냄)"""
    if not ab.enabled():
        return ""
    flags = book["flags"]
    if not holdings._old(flags.get("wallst"), now, EVERY):
        return ""
    flags["wallst"] = now.isoformat()
    stored = {r["cik"]: r for r in holdings._get("wallst?select=cik,acc,period")}
    done, fresh, skipped = 0, [], 0
    for cik, key, ko in FUNDS:
        if done >= MAX_NEW:
            break
        try:
            sec_name, fl = filings(cik)
            if key.lower() not in sec_name.lower() or not fl:
                skipped += 1
                continue
            cur = fl[0]
            st = stored.get(cik) or {}
            if st.get("acc") == cur["acc"]:
                continue
            now_h = holdings_of(cik, cur["acc"])
            if now_h is None:
                skipped += 1
                continue
            prev_f = fl[1] if len(fl) > 1 else None
            old = holdings._get(f"wallst?select=hold&cik=eq.{cik}") if st.get("period") and prev_f and st["period"] == prev_f["period"] else []
            if old and old[0].get("hold"):
                prev_h = old[0]["hold"]
            else:
                prev_h = holdings_of(cik, prev_f["acc"]) if prev_f else {}
                prev_h = prev_h or {}
            s = summarize(ko, sec_name, cur, prev_f, now_h, prev_h)
            holdings._upsert("wallst", [{"cik": cik, "name": sec_name, "ko": ko, "period": cur["period"], "filed": cur["filed"],
                                         "acc": cur["acc"], "summary": s, "hold": now_h, "updated_at": now.isoformat()}], "cik")
            done += 1
            if st.get("acc"):          # 예전에 저장한 적이 있는 기관의 새 공시만 '새 소식'
                fresh.append(s)
        except Exception:
            skipped += 1
    if fresh:
        try:
            names = ", ".join(s["ko"] for s in fresh[:3]) + (f" 외 {len(fresh) - 3}곳" if len(fresh) > 3 else "")
            s0 = fresh[0]
            body = f"새로 산 종목 {s0['n_new']} · 늘린 {s0['n_add']} · 줄인 {s0['n_cut']} · 다 판 {s0['n_exit']} ({s0['ko']})"
            ab.push_brief({"title": f"🏦 월가 픽: {names} 새 보유 공시", "body": body, "url": "./#/wall", "tag": "wallst-" + now.strftime("%Y%m%d%H")},
                          now, pref="wallst")
        except Exception:
            pass
    if not (done or skipped):
        return ""
    return f" · 월가 픽 {done}곳 갱신" + (f" (건너뜀 {skipped})" if skipped else "")
