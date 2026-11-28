# 증권사 · 거래소 보유 → 앱 '보유' 자동 반영 — 시안님 계좌 하나만 (개발자 화면에서 카톡 받기로 연결한 계정)
#
# - 토스증권(국장 · 미장) · 업비트(코인, 평단 포함) · 바이낸스(코인, 수량만)
# - 셋 다 허용한 IP에서만 받아 주거나(토스 · 업비트) 미국 IP를 막아서(바이낸스)
#   고정 IP 중계(Fixie)를 거쳐 보내요. 중계는 암호화된 통로만 이어 줘서 내용은 못 봐요.
# - 조회만 해요. 주문 API는 부르지 않아요.
# - 하루 4번 (장 전 · 국장 마감 · 미장 열린 뒤 · 미장 마감 뒤) + 앱에서 '지금 가져오기' (하루 3번까지)
#   토스는 주말엔 건너뛰고, 토스 접근 토큰은 하루 짜리라 서버 kv(앱에서 못 읽는 곳)에 두고 다시 써요.
# - 무료 중계는 한 달 500번이라 한 달 450번에서 멈춰요.
# - 키 · 토큰 · 계좌번호 · 종목 이름은 기록에 남기지 않아요 (공개 기록엔 개수만).
#
# GitHub 비밀값 (있는 곳만 켜짐): FIXIE_URL + TOSS_CLIENT_ID · TOSS_CLIENT_SECRET
#                                   / UPBIT_ACCESS_KEY · UPBIT_SECRET_KEY / BINANCE_API_KEY · BINANCE_API_SECRET

import base64
import hashlib
import hmac
import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

import requests

import app_bridge as ab

TOSS = "https://openapi.tossinvest.com"
UPBIT = "https://api.upbit.com"
BINANCE = "https://api.binance.com"
CID = ab._clean(os.environ.get("TOSS_CLIENT_ID"))
SECRET = ab._clean(os.environ.get("TOSS_CLIENT_SECRET"))
UP_AK = ab._clean(os.environ.get("UPBIT_ACCESS_KEY"))
UP_SK = ab._clean(os.environ.get("UPBIT_SECRET_KEY"))
BN_AK = ab._clean(os.environ.get("BINANCE_API_KEY"))
BN_SK = ab._clean(os.environ.get("BINANCE_API_SECRET"))
PROXY = ab._clean(os.environ.get("FIXIE_URL"))
KST = ZoneInfo("Asia/Seoul")
SLOTS = [(6, 20), (8, 40), (15, 45), (23, 50)]   # 한국 시간
SLOT_GRACE = timedelta(hours=3)                  # 이 시간 안에 못 돌았으면 그 회차는 건너뜀
MONTH_CAP = 450                                   # 중계로 보내는 요청 수 (토큰 + 조회)
MANUAL_PER_DAY = 3
SAFE_ID = re.compile(r"[^A-Za-z0-9.\-]")
STABLE = {"USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "USDP", "KRW"}
SRC_NAME = {"toss": "토스증권", "upbit": "업비트", "binance": "바이낸스"}


def sources():
    out = []
    if CID and SECRET:
        out.append("toss")
    if UP_AK and UP_SK:
        out.append("upbit")
    if BN_AK and BN_SK:
        out.append("binance")
    return out


def enabled():
    return bool(PROXY and ab.enabled() and sources())


def _px():
    return {"https": PROXY, "http": PROXY}


class SyncError(Exception):
    pass


def _why(src, r):
    nm = SRC_NAME.get(src, src)
    if r.status_code == 451:
        return f"{nm}: 중계 IP가 막힌 지역이에요 (Fixie 지역을 미국이 아닌 곳으로)"
    if r.status_code == 403:
        return f"{nm}: 허용 IP가 아니에요 (중계 IP 2개를 허용 IP에 넣어 주세요)"
    if r.status_code == 401:
        return f"{nm}: 키가 맞지 않아요"
    if r.status_code == 429 or r.status_code == 418:
        return f"{nm}: 호출이 너무 많아요 (잠시 뒤 다시)"
    if r.status_code == 407:
        return "중계 접속이 안 돼요 (FIXIE_URL 확인)"
    try:
        code = (r.json() or {}).get("code")
        if src == "binance" and code == -2015:
            return f"{nm}: 키 · IP 제한 · 권한을 확인해 주세요"
    except Exception:
        pass
    return f"{nm}: 응답 {r.status_code}"


def _num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


# ---------- 토스증권 ----------

def toss_token(now, count, force=False):
    tk = {} if force else (ab.get_kv("toss_tok") or {})
    try:
        if tk.get("t") and datetime.fromisoformat(tk["exp"]) > now + timedelta(minutes=30):
            return tk["t"]
    except (TypeError, ValueError, KeyError):
        pass
    count()
    r = requests.post(f"{TOSS}/oauth2/token", timeout=20, proxies=_px(),
                      data={"grant_type": "client_credentials", "client_id": CID, "client_secret": SECRET},
                      headers={"Content-Type": "application/x-www-form-urlencoded"})
    if r.status_code != 200:
        raise SyncError(_why("toss", r))
    j = r.json() or {}
    t = j.get("access_token")
    if not t:
        raise SyncError("토스증권: 토큰을 받지 못했어요")
    exp = now + timedelta(seconds=int(j.get("expires_in") or 86400) - 120)
    ab.put_kv("toss_tok", {"t": t, "exp": exp.isoformat()})
    return t


def _toss_get(path, tok, count, acct=None):
    count()
    h = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}
    if acct is not None:
        h["X-Tossinvest-Account"] = str(acct)
    return requests.get(f"{TOSS}{path}", timeout=20, proxies=_px(), headers=h)


def toss_items(now, flags, count):
    """토스 보유 → [{symbol, name, market, qty, avg}]"""
    tok = toss_token(now, count)
    acct = flags.get("bsync_acct")
    for attempt in (0, 1):
        if not isinstance(acct, int):
            r = _toss_get("/api/v1/accounts", tok, count)
            if r.status_code == 401 and attempt == 0:
                tok = toss_token(now, count, force=True)
                continue
            if r.status_code != 200:
                raise SyncError(_why("toss", r))
            accts = [a for a in ((r.json() or {}).get("result") or []) if isinstance(a, dict) and a.get("accountSeq") is not None]
            if not accts:
                raise SyncError("토스증권: 계좌를 찾지 못했어요")
            acct = int(accts[0]["accountSeq"])
            flags["bsync_acct"] = acct
        r = _toss_get("/api/v1/holdings", tok, count, acct)
        if r.status_code == 401 and attempt == 0:          # 토큰이 바뀌었으면 한 번 새로
            tok = toss_token(now, count, force=True)
            continue
        if r.status_code != 200:
            flags.pop("bsync_acct", None)
            raise SyncError(_why("toss", r))
        res = (r.json() or {}).get("result")
        items = (res or {}).get("items") if isinstance(res, dict) else res
        out = []
        for i in items or []:
            ctry = str(i.get("marketCountry") or "").upper()
            m = "kr" if ctry in ("KR", "KOR") else "us" if ctry in ("US", "USA") else None
            qty = _num(i.get("quantity"))
            sym = str(i.get("symbol") or "").strip()
            if not sym or not m or qty <= 0:
                continue
            avg = _num(i.get("averagePurchasePrice"))
            if m == "us" and str(i.get("currency") or "USD").upper() != "USD":
                avg = 0.0                                   # 달러가 아닌 값이면 평균가는 비워 둠 (앱은 달러 기준)
            out.append({"symbol": sym, "name": str(i.get("name") or sym), "market": m, "qty": qty, "avg": avg})
        return out
    raise SyncError("토스증권: 다시 시도해 주세요")


# ---------- 업비트 ----------

def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def upbit_jwt():
    head = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = _b64(json.dumps({"access_key": UP_AK, "nonce": str(uuid.uuid4())}, separators=(",", ":")).encode())
    sig = _b64(hmac.new(UP_SK.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"


def upbit_items(count):
    """업비트 잔고 → 코인 [{symbol, name, market, qty, avg}] (원화 평단)"""
    count()
    r = requests.get(f"{UPBIT}/v1/accounts", timeout=20, proxies=_px(), headers={"Authorization": f"Bearer {upbit_jwt()}"})
    if r.status_code != 200:
        raise SyncError(_why("upbit", r))
    out = []
    for a in r.json() or []:
        cur = str(a.get("currency") or "").upper()
        if not cur or cur in STABLE or str(a.get("unit_currency") or "KRW").upper() != "KRW":
            continue
        qty = _num(a.get("balance")) + _num(a.get("locked"))
        if qty <= 0:
            continue
        out.append({"symbol": cur, "name": cur, "market": "crypto", "qty": qty, "avg": _num(a.get("avg_buy_price"))})
    return out


# ---------- 바이낸스 ----------

def binance_items(count):
    """바이낸스 현물 잔고 → 코인 [{symbol, name, market, qty, avg=0}] (평단은 바이낸스가 주지 않아요)"""
    q = urlencode({"omitZeroBalances": "true", "recvWindow": 10000, "timestamp": int(time.time() * 1000)})
    sig = hmac.new(BN_SK.encode(), q.encode(), hashlib.sha256).hexdigest()
    count()
    r = requests.get(f"{BINANCE}/api/v3/account?{q}&signature={sig}", timeout=20, proxies=_px(), headers={"X-MBX-APIKEY": BN_AK})
    if r.status_code != 200:
        raise SyncError(_why("binance", r))
    agg = {}
    for b in (r.json() or {}).get("balances") or []:
        asset = str(b.get("asset") or "").upper()
        if asset.startswith("LD") and len(asset) > 3:      # 간편 적립(Flexible Earn) 표시 'LDBTC' → BTC
            asset = asset[2:]
        if not asset or asset in STABLE:
            continue
        qty = _num(b.get("free")) + _num(b.get("locked"))
        if qty > 0:
            agg[asset] = agg.get(asset, 0.0) + qty
    return [{"symbol": a, "name": a, "market": "crypto", "qty": q2, "avg": 0.0} for a, q2 in agg.items()]


# ---------- 합치기 ----------

def _yts(items):
    """(코드, 시장) → (야후 코드, 이름) — 앱 종목 목록에서 찾음"""
    found = {}
    keys = sorted({(i["symbol"] if i["market"] != "crypto" else i["symbol"] + "-KRW") for i in items})
    for k in range(0, len(keys), 80):
        part = ",".join('"' + c.replace('"', "") + '"' for c in keys[k:k + 80])
        for col in ("code", "yt"):
            try:
                r = ab._check(requests.get(f"{ab.URL}/rest/v1/symbols?select=yt,code,name,market&{col}=in.({quote(part, safe=',')})",
                                           timeout=15, headers=ab._headers()))
                for s in r.json():
                    found.setdefault((s["code"], s["market"]), (s["yt"], s.get("name")))
                    found.setdefault((s["yt"], s["market"]), (s["yt"], s.get("name")))
            except Exception:
                pass
    return found


def to_fresh(by_src, found):
    """출처별 목록 → {yt: {yt, code, name, market, qty, avg, src}} — 같은 코인이 두 거래소에 있으면 수량을 더하고 평단은 업비트 것"""
    out = {}
    for src, items in by_src.items():
        for i in items:
            sym, m = i["symbol"], i["market"]
            if m == "crypto":
                yt = sym + "-KRW"
                hit = found.get((yt, m)) or found.get((sym, m))
                code = sym
            else:
                hit = found.get((sym, m))
                yt = hit[0] if hit else ((sym + ".KS") if m == "kr" else sym.replace(".", "-"))
                code = sym
            nm = (hit[1] if hit and hit[1] else i["name"])[:40]
            avg = round(i["avg"], 4 if m == "us" else 2) if i["avg"] > 0 else 0
            if yt in out:
                o = out[yt]
                o["qty"] = round(o["qty"] + i["qty"], 8)
                if not o["avg"] and avg:
                    o["avg"] = avg
                o["src"] = "coin" if o["src"] != src else src
            else:
                out[yt] = {"yt": yt, "code": code, "name": nm, "market": m, "qty": round(i["qty"], 8), "avg": avg, "src": src}
    return out


AUTO = ("toss", "upbit", "binance", "coin")


def _owner_of(h, done):
    """이 항목을 맞추는 출처가 이번에 성공했는지 (실패한 곳 항목은 건드리지 않음)"""
    s = h.get("src")
    if s == "coin":
        return "upbit" in done and "binance" in done
    return s in done


def merge(hold, fresh, now_iso, gone=None, done=None):
    """앱 보유 목록에 증권사 · 거래소 보유를 맞춤 → (새 목록, 바뀐 개수)
    - 같은 종목이 있으면 수량 · 평균가를 가져온 값으로 (표시 src)
    - 없으면 새로 넣음 (앱에서 지운 종목 gone 은 다시 안 넣음)
    - 예전에 자동으로 가져왔는데 지금은 없는 종목은 수량 0 (관심 종목으로 남김) — 이번에 성공한 출처 것만
    - 직접 넣은 다른 종목은 그대로 · 바꾼 종목엔 바꾼 시각 u(ms)"""
    hold = [dict(h) for h in (hold if isinstance(hold, list) else []) if isinstance(h, dict)]
    gone = gone if isinstance(gone, dict) else {}
    done = set(done if done is not None else ("toss",))
    now_ms = int(datetime.fromisoformat(now_iso).timestamp() * 1000)
    changed, seen = 0, set()
    for h in hold:
        f = fresh.get(h.get("yt"))
        if h.get("src") in AUTO and not _owner_of(h, done):   # 이번에 실패한(또는 안 돈) 출처 항목은 그대로 둠
            if f:
                seen.add(f["yt"])
            continue
        if f:
            seen.add(f["yt"])
            avg = f["avg"] if f["avg"] else (_num(h.get("avg")) if f["src"] in ("binance", "coin") else 0)
            if abs(_num(h.get("qty")) - f["qty"]) > 1e-9 or abs(_num(h.get("avg")) - avg) > 1e-6 or h.get("src") != f["src"]:
                h["qty"], h["avg"], h["src"], h["u"] = f["qty"], avg, f["src"], now_ms
                changed += 1
        elif h.get("src") in AUTO and _owner_of(h, done):
            if _num(h.get("qty")) > 0:
                h["qty"], h["avg"] = 0, 0
                changed += 1
            h.pop("src", None)
            h["u"] = now_ms
    for yt, f in fresh.items():
        if yt in seen or yt in gone:
            continue
        hold.append({"id": "auto-" + SAFE_ID.sub("", yt)[:24], "yt": yt, "code": f["code"], "name": f["name"], "market": f["market"],
                     "qty": f["qty"], "avg": f["avg"], "at": now_iso, "src": f["src"], "u": now_ms})
        changed += 1
    return hold, changed


def _slot_due(now, flags):
    """지금 돌 회차가 있으면 그 회차 이름 (아직 안 돈 것 중 가장 최근, 3시간 안)"""
    k = now.astimezone(KST)
    best = None
    for d in (0, -1):
        day = (k + timedelta(days=d)).date()
        for hh, mm in SLOTS:
            t = datetime(day.year, day.month, day.day, hh, mm, tzinfo=KST)
            if t <= k and k - t <= SLOT_GRACE and (best is None or t > best):
                best = t
    if best is None:
        return None
    sid = best.strftime("%Y-%m-%d %H:%M")
    return sid if sid > str(flags.get("bsync_slot") or "") else None


def _status(v):
    try:
        ab.put_kv("broker_status", v)
    except Exception:
        pass


def run(book, now):
    """엔진 실행마다 호출 → 공개 기록용 짧은 문구 (개수만) 또는 None"""
    if not enabled():
        return None
    flags = book["flags"]
    owner = (ab.get_kv("kakao_owner") or {}).get("uid")
    if not owner or not ab.UUID.fullmatch(str(owner)):
        return None
    k = now.astimezone(KST)
    manual = False
    try:
        req = ab.get_kv("broker_sync_now") or {}
        if req.get("go") is True:
            day = k.date().isoformat()
            if flags.get("bsync_mday") != day:
                flags["bsync_mday"], flags["bsync_mn"] = day, 0
            if flags.get("bsync_mn", 0) < MANUAL_PER_DAY:
                manual = True
                flags["bsync_mn"] = flags.get("bsync_mn", 0) + 1
            ab.put_kv("broker_sync_now", {"go": False, "at": now.isoformat()})
    except Exception:
        pass
    slot = _slot_due(now, flags)
    if not manual and not slot:
        return None
    if slot:
        flags["bsync_slot"] = slot
    month = k.strftime("%Y-%m")
    if flags.get("bsync_month") != month:
        flags["bsync_month"], flags["bsync_n"] = month, 0
    if flags.get("bsync_n", 0) >= MONTH_CAP:
        _status({"at": now.isoformat(), "ok": False, "err": "이번 달 무료 호출 한도에 가까워 다음 달까지 쉬어요"})
        return "증권사 보유 반영 쉼 (이번 달 한도)"

    def count():
        flags["bsync_n"] = flags.get("bsync_n", 0) + 1

    want = sources()
    if "toss" in want and k.weekday() >= 5 and not manual:   # 주말엔 주식 보유가 안 바뀜
        want = [s for s in want if s != "toss"]
    by_src, per = {}, {}
    for src in want:
        try:
            if src == "toss":
                by_src[src] = toss_items(now, flags, count)
            elif src == "upbit":
                by_src[src] = upbit_items(count)
            elif src == "binance":
                by_src[src] = binance_items(count)
            per[src] = {"ok": True, "n": len(by_src[src])}
        except SyncError as e:
            per[src] = {"ok": False, "err": str(e)[:120]}
        except Exception as e:
            per[src] = {"ok": False, "err": f"{SRC_NAME.get(src, src)}: 연결하지 못했어요 ({type(e).__name__})"}
    if not by_src:
        errs = [v["err"] for v in per.values() if not v.get("ok")]
        _status({"at": now.isoformat(), "ok": False, "err": " · ".join(errs)[:200] or "가져올 곳이 없어요", "src": per})
        return "증권사 보유 반영 실패"
    try:
        allitems = [i for v in by_src.values() for i in v]
        fresh = to_fresh(by_src, _yts(allitems))
        r = ab._check(requests.get(f"{ab.URL}/rest/v1/user_data", timeout=15, headers=ab._headers(),
                                   params={"select": "data", "user_id": f"eq.{owner}"}))
        rows = r.json()
        data = (rows[0].get("data") if rows else None) or {}
        hold, changed = merge(data.get("tn_hold"), fresh, now.isoformat(), data.get("tn_hold_del"), set(by_src))
        if changed:
            data["tn_hold"] = hold
            ab.upsert("user_data", [{"user_id": owner, "data": data, "updated_at": now.isoformat()}], "user_id")
    except Exception as e:
        _status({"at": now.isoformat(), "ok": False, "err": "앱 기록에 저장하지 못했어요 (" + type(e).__name__ + ")", "src": per})
        return "증권사 보유 반영 실패"
    bad = [v["err"] for v in per.values() if not v.get("ok")]
    _status({"at": now.isoformat(), "ok": not bad, "n": len(fresh), "changed": changed, "err": " · ".join(bad)[:200] if bad else None,
             "used": flags.get("bsync_n", 0), "cap": MONTH_CAP, "manual": manual, "src": per})
    return f"증권사 보유 반영 {len(fresh)}종목" + (f" (바뀜 {changed})" if changed else "") + (f" · 실패 {len(bad)}곳" if bad else "")
