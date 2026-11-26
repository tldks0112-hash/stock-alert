# 증권사(토스증권) 보유 → 앱 '보유' 자동 반영 — 시안님 계좌 하나만 (개발자 화면에서 카톡 받기로 연결한 계정)
#
# - 토스증권 오픈API는 허용한 IP에서만 받아 줘요. GitHub 서버는 IP가 매번 바뀌어서
#   고정 IP 중계(Fixie)를 거쳐 보내요. 중계는 암호화된 통로만 이어 줘서 내용은 못 봐요.
# - 조회(보유 주식)만 해요. 주문 API는 부르지 않아요.
# - 하루 4번 (장 전 · 국장 마감 · 미장 열린 뒤 · 미장 마감 뒤) + 앱에서 '지금 가져오기' (하루 3번까지)
# - 무료 중계는 한 달 500번이라 한 달 450번에서 멈춰요.
# - 키 · 토큰 · 계좌번호 · 종목 이름은 기록에 남기지 않아요 (공개 기록엔 개수만).
#
# 필요한 GitHub 비밀값: TOSS_CLIENT_ID, TOSS_CLIENT_SECRET, FIXIE_URL (없으면 아무것도 안 함)

import json
import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests

import app_bridge as ab

TOSS = "https://openapi.tossinvest.com"
CID = ab._clean(os.environ.get("TOSS_CLIENT_ID"))
SECRET = ab._clean(os.environ.get("TOSS_CLIENT_SECRET"))
PROXY = ab._clean(os.environ.get("FIXIE_URL"))
KST = ZoneInfo("Asia/Seoul")
SLOTS = [(6, 20), (8, 40), (15, 45), (23, 50)]   # 한국 시간
SLOT_GRACE = timedelta(hours=3)                  # 이 시간 안에 못 돌았으면 그 회차는 건너뜀
MONTH_CAP = 450                                   # 토스로 보내는 요청 수 (토큰 + 보유 조회)
MANUAL_PER_DAY = 3
SAFE_ID = re.compile(r"[^A-Za-z0-9.\-]")


def enabled():
    return bool(CID and SECRET and PROXY and ab.enabled())


def _px():
    return {"https": PROXY, "http": PROXY}


class TossError(Exception):
    pass


def _why(r):
    if r.status_code == 403:
        return "허용 IP가 아니에요 (토스증권 허용 IP에 중계 IP 2개를 넣어 주세요)"
    if r.status_code == 401:
        return "키가 맞지 않아요 (TOSS_CLIENT_ID · TOSS_CLIENT_SECRET 확인)"
    if r.status_code == 429:
        return "호출이 너무 많아요 (잠시 뒤 다시)"
    if r.status_code == 407:
        return "중계 접속이 안 돼요 (FIXIE_URL 확인)"
    return f"토스증권 응답 {r.status_code}"


def _token(count):
    count()
    r = requests.post(f"{TOSS}/oauth2/token", timeout=20, proxies=_px(),
                      data={"grant_type": "client_credentials", "client_id": CID, "client_secret": SECRET},
                      headers={"Content-Type": "application/x-www-form-urlencoded"})
    if r.status_code != 200:
        raise TossError(_why(r))
    tok = (r.json() or {}).get("access_token")
    if not tok:
        raise TossError("토큰을 받지 못했어요")
    return tok


def _get(path, tok, count, acct=None, params=None):
    count()
    h = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}
    if acct is not None:
        h["X-Tossinvest-Account"] = str(acct)
    r = requests.get(f"{TOSS}{path}", timeout=20, proxies=_px(), headers=h, params=params or {})
    if r.status_code != 200:
        raise TossError(_why(r))
    j = r.json() or {}
    return j.get("result", j)


def _num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def _yts(items):
    """토스 종목 코드 → (야후 코드, 이름, 시장) — 앱 종목 목록에서 찾고, 없으면 규칙대로"""
    codes = sorted({str(i.get("symbol") or "") for i in items if i.get("symbol")})
    found = {}
    for k in range(0, len(codes), 80):
        part = ",".join('"' + c.replace('"', "") + '"' for c in codes[k:k + 80])
        try:
            r = ab._check(requests.get(f"{ab.URL}/rest/v1/symbols?select=yt,code,name,market&code=in.({quote(part, safe=',')})",
                                       timeout=15, headers=ab._headers()))
            for s in r.json():
                found.setdefault((s["code"], s["market"]), (s["yt"], s.get("name")))
        except Exception:
            pass
    return found


def to_holds(items, found):
    """토스 보유 목록 → 앱 보유 항목들 {yt: {...}}"""
    out = {}
    for i in items or []:
        sym = str(i.get("symbol") or "").strip()
        ctry = str(i.get("marketCountry") or "").upper()
        m = "kr" if ctry in ("KR", "KOR") else "us" if ctry in ("US", "USA") else None
        qty = _num(i.get("quantity"))
        if not sym or not m or qty <= 0:
            continue
        hit = found.get((sym, m))
        if hit:
            yt, nm = hit
        else:
            yt = (sym + ".KS") if m == "kr" else sym.replace(".", "-")
            nm = None
        avg = _num(i.get("averagePurchasePrice"))
        if m == "us" and str(i.get("currency") or "USD").upper() != "USD":
            avg = 0.0                                       # 달러가 아닌 값이면 평균가는 비워 둠 (앱은 달러 기준)
        out[yt] = {"yt": yt, "code": sym, "name": (nm or str(i.get("name") or sym))[:40], "market": m,
                   "qty": round(qty, 6), "avg": round(avg, 4 if m == "us" else 2)}
    return out


def merge(hold, fresh, now_iso):
    """앱 보유 목록에 토스 보유를 맞춤 → (새 목록, 바뀐 개수)
    - 같은 종목이 있으면 수량 · 평균가를 토스 값으로 (표시 src='toss')
    - 없으면 새로 넣음
    - 예전에 토스에서 가져왔는데 지금은 없는 종목은 수량 0 (관심 종목으로 남김)
    - 직접 넣은 다른 종목(코인 · 다른 증권사)은 그대로"""
    hold = [dict(h) for h in (hold if isinstance(hold, list) else []) if isinstance(h, dict)]
    changed = 0
    seen = set()
    for h in hold:
        f = fresh.get(h.get("yt"))
        if f:
            seen.add(f["yt"])
            if abs(_num(h.get("qty")) - f["qty"]) > 1e-9 or abs(_num(h.get("avg")) - f["avg"]) > 1e-6 or h.get("src") != "toss":
                h["qty"], h["avg"], h["src"] = f["qty"], f["avg"], "toss"
                changed += 1
        elif h.get("src") == "toss":
            if _num(h.get("qty")) > 0:
                h["qty"], h["avg"] = 0, 0
                changed += 1
            h.pop("src", None)
    for yt, f in fresh.items():
        if yt in seen:
            continue
        hold.append({"id": "toss-" + SAFE_ID.sub("", yt)[:24], "yt": yt, "code": f["code"], "name": f["name"], "market": f["market"],
                     "qty": f["qty"], "avg": f["avg"], "at": now_iso, "src": "toss"})
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
        ab.put_kv("broker_status", {"at": now.isoformat(), "ok": False, "err": "이번 달 무료 호출 한도에 가까워 다음 달까지 쉬어요"})
        return "증권사 보유 반영 쉼 (이번 달 한도)"

    def count():
        flags["bsync_n"] = flags.get("bsync_n", 0) + 1

    try:
        tok = _token(count)
        acct = flags.get("bsync_acct")
        if not isinstance(acct, int):
            accts = _get("/api/v1/accounts", tok, count) or []
            accts = [a for a in accts if isinstance(a, dict) and a.get("accountSeq") is not None]
            if not accts:
                raise TossError("토스증권 계좌를 찾지 못했어요")
            acct = int(accts[0]["accountSeq"])
            flags["bsync_acct"] = acct
        try:
            res = _get("/api/v1/holdings", tok, count, acct)
        except TossError:
            flags.pop("bsync_acct", None)          # 계좌 번호가 바뀌었을 수 있으니 다음엔 다시 찾음
            raise
        items = (res or {}).get("items") if isinstance(res, dict) else res
        fresh = to_holds(items or [], _yts(items or []))
        r = ab._check(requests.get(f"{ab.URL}/rest/v1/user_data", timeout=15, headers=ab._headers(),
                                   params={"select": "data", "user_id": f"eq.{owner}"}))
        rows = r.json()
        data = (rows[0].get("data") if rows else None) or {}
        hold, changed = merge(data.get("tn_hold"), fresh, now.isoformat())
        if changed:
            data["tn_hold"] = hold
            ab.upsert("user_data", [{"user_id": owner, "data": data, "updated_at": now.isoformat()}], "user_id")
        ab.put_kv("broker_status", {"at": now.isoformat(), "ok": True, "n": len(fresh), "changed": changed,
                                    "used": flags.get("bsync_n", 0), "cap": MONTH_CAP, "manual": manual})
        return f"증권사 보유 반영 {len(fresh)}종목" + (f" (바뀜 {changed})" if changed else "")
    except TossError as e:
        ab.put_kv("broker_status", {"at": now.isoformat(), "ok": False, "err": str(e)[:120]})
        return "증권사 보유 반영 실패"
    except Exception as e:
        ab.put_kv("broker_status", {"at": now.isoformat(), "ok": False, "err": "연결하지 못했어요 (" + type(e).__name__ + ")"})
        return "증권사 보유 반영 실패"
