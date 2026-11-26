# 앱 연결: 엔진이 만든 알림을 앱 데이터베이스(Supabase)에 저장하고, 베타 사용자 휴대폰에 푸시 알림을 보내요.
# 비밀값 SUPABASE_URL · SUPABASE_SECRET_KEY 가 없으면 아무것도 하지 않아요 (카톡 알림은 그대로).
# 푸시는 VAPID_PRIVATE_KEY 까지 있어야 보내요.
# 공개 실행 기록에는 개수만 남기고, 종목 이름이나 주소는 찍지 않아요.

import json
import os
import re
import urllib.parse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

def _clean(v):
    """복사·붙여넣기 때 끼어든 줄바꿈·띄어쓰기·한글 같은 글자를 빼요 (주소와 키에는 원래 없는 글자)"""
    return re.sub(r"[^\x21-\x7e]", "", v or "")


URL = _clean(os.environ.get("SUPABASE_URL")).rstrip("/")
KEY = _clean(os.environ.get("SUPABASE_SECRET_KEY"))
VAPID_PRIVATE = _clean(os.environ.get("VAPID_PRIVATE_KEY"))
KST = ZoneInfo("Asia/Seoul")
GRADE_RANK = {"낮음": 0, "보통": 1, "높음": 2}
DEFAULT_PREFS = {"markets": ["kr", "us", "crypto"], "minGrade": "보통", "sell": True, "sellAll": False, "quiet": False}


def enabled():
    return bool(URL and KEY)


def setup_problem():
    """비밀값 모양이 이상하면 이유를 짧게 (값 자체는 절대 찍지 않음)"""
    if not re.fullmatch(r"https://[a-z0-9]+\.supabase\.co", URL):
        return "SUPABASE_URL 모양이 이상해요"
    if KEY.startswith("sb_publishable_"):
        return "SUPABASE_SECRET_KEY에 공개 키(publishable)가 들어 있어요"
    if not (KEY.startswith("sb_secret_") or KEY.startswith("eyJ")):
        return "SUPABASE_SECRET_KEY 모양이 이상해요"
    return ""


def why(e):
    """실패 이유를 공개 기록에 남겨도 안전한 말로"""
    if isinstance(e, RuntimeError) and str(e).startswith("앱 DB 오류"):
        code = str(e).split()[-1]
        hint = {"401": "키가 틀렸어요", "403": "권한이 없어요", "404": "표나 주소가 없어요"}.get(code, "")
        return f"서버 응답 {code}" + (f", {hint}" if hint else "")
    if isinstance(e, (requests.exceptions.ConnectionError, requests.exceptions.Timeout)):
        return "서버에 접속하지 못했어요"
    if isinstance(e, (requests.exceptions.MissingSchema, requests.exceptions.InvalidURL)):
        return "SUPABASE_URL 모양이 이상해요"
    if isinstance(e, (requests.exceptions.InvalidHeader, UnicodeError)):
        return "SUPABASE_SECRET_KEY에 이상한 글자가 있어요"
    return type(e).__name__


def _headers(extra=None):
    h = {"apikey": KEY, "Content-Type": "application/json"}
    if KEY.startswith("eyJ"):                 # 예전 형식(JWT) 키일 때만 Authorization도 붙임
        h["Authorization"] = f"Bearer {KEY}"
    h.update(extra or {})
    return h


def _check(r):
    if r.status_code >= 300:
        raise RuntimeError(f"앱 DB 오류 {r.status_code}")      # 응답 내용은 찍지 않음
    return r


def insert_alerts(rows):
    """알림 저장 → 저장된 id 목록"""
    if not rows:
        return []
    r = _check(requests.post(f"{URL}/rest/v1/alerts", timeout=15, data=json.dumps(rows, ensure_ascii=False),
                             headers=_headers({"Prefer": "return=representation"})))
    return [x.get("id") for x in r.json()]


def put_kv(key, value):
    body = {"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()}
    _check(requests.post(f"{URL}/rest/v1/kv?on_conflict=key", timeout=15, data=json.dumps(body, ensure_ascii=False),
                         headers=_headers({"Prefer": "resolution=merge-duplicates,return=minimal"})))


def upsert(table, rows, on):
    """여러 줄 저장 (같은 키는 덮어씀)"""
    if not rows:
        return
    _check(requests.post(f"{URL}/rest/v1/{table}?on_conflict={on}", timeout=20, data=json.dumps(rows, ensure_ascii=False),
                         headers=_headers({"Prefer": "resolution=merge-duplicates,return=minimal"})))


def recent_alerts(since):
    """since 이후 앱 알림 (차트·알림 결과 갱신용): id · 종목 · 매수/매도 · 알림 때 가격 · 시각"""
    r = _check(requests.get(f"{URL}/rest/v1/alerts", timeout=15, headers=_headers(),
                            params={"select": "id,yt,market,side,price,created_at", "created_at": f"gte.{since.isoformat()}",
                                    "order": "created_at.desc", "limit": "1000"}))
    return [x for x in r.json() if x.get("yt")]


def recent_alert_yts(since):
    """since 이후 앱 알림이 나온 종목 코드들 (차트 갱신 대상)"""
    return {x["yt"] for x in recent_alerts(since)}


def rpc(fn, args):
    """서버 함수 호출 (엔진 전용 함수는 비밀 키로만 됨)"""
    r = _check(requests.post(f"{URL}/rest/v1/rpc/{fn}", timeout=20, data=json.dumps(args, ensure_ascii=False), headers=_headers()))
    try:
        return r.json()
    except ValueError:
        return None

def get_kv(key):
    """앱 서버에 저장된 값 하나 (없으면 None)"""
    q = urllib.parse.quote(key, safe="")
    r = _check(requests.get(f"{URL}/rest/v1/kv?key=eq.{q}&select=value", timeout=15, headers=_headers()))
    rows = r.json()
    return rows[0]["value"] if rows else None


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
MKS = ("kr", "us", "crypto")
OWNER_POS = []                                   # owner_holds()가 채움: [{yt, name, market, qty, avg}] (마감 요약용)


def owner_holds():
    """개발자 카톡용: 개발자 화면에서 '이 계정 보유로 카톡 받기'를 누른 계정의 '보유' 종목
    → {"kr": {야후코드: 이름}, "us": {...}, "crypto": {...}} · 아직 안 정했으면 None
    (다른 이용자의 보유는 읽지 않음: kv 'kakao_owner'에 적힌 계정 하나만)"""
    if not enabled():
        return None
    o = get_kv("kakao_owner") or {}
    uid = str(o.get("uid") or "")
    if not UUID.fullmatch(uid):
        return None
    r = _check(requests.get(f"{URL}/rest/v1/user_data", timeout=15, headers=_headers(),
                            params={"select": "data", "user_id": f"eq.{uid}"}))
    rows = r.json()
    hold = ((rows[0].get("data") or {}).get("tn_hold") if rows else None) or []
    out = {m: {} for m in MKS}
    OWNER_POS.clear()
    for h in hold if isinstance(hold, list) else []:
        if not isinstance(h, dict):
            continue
        m, yt = h.get("market"), str(h.get("yt") or "")
        try:
            qty, avg = float(h.get("qty") or 0), float(h.get("avg") or 0)
        except (TypeError, ValueError):
            continue
        if qty <= 0:                                   # 수량 없이 넣은 '관심' 종목은 빼고 '보유'만
            continue
        if m in out and yt and len(yt) <= 20:
            out[m][yt] = str(h.get("name") or yt)[:40]
            OWNER_POS.append({"yt": yt, "name": out[m][yt], "market": m, "qty": qty, "avg": avg})
    return out

def count_alerts(market, since):
    """since 이후 그 시장 알림 수 {buy, sell} (요약 카드용, 종목 이름은 안 읽음)"""
    r = _check(requests.get(f"{URL}/rest/v1/alerts", timeout=15, headers=_headers(),
                            params={"select": "side", "market": f"eq.{market}", "created_at": f"gte.{since.isoformat()}", "limit": "1000"}))
    out = {"buy": 0, "sell": 0}
    for x in r.json():
        if x.get("side") in out:
            out[x["side"]] += 1
    return out


def get_price_alerts():
    """아직 안 울린 가격 알림 (목표가·손절가)"""
    r = _check(requests.get(f"{URL}/rest/v1/price_alerts", timeout=15, headers=_headers(),
                            params={"select": "id,endpoint,yt,market,name,kind,price,created_at", "fired_at": "is.null", "limit": "5000"}))
    return r.json()


def fire_price_alert(i, price, now):
    """울렸다고 표시 (아직 안 울린 것만 바꿔서 두 번 울리지 않게) → 바뀌었으면 True"""
    r = _check(requests.patch(f"{URL}/rest/v1/price_alerts", timeout=15, params={"id": f"eq.{int(i)}", "fired_at": "is.null"},
                              data=json.dumps({"fired_at": now.isoformat(), "fired_price": price}),
                              headers=_headers({"Prefer": "return=representation"})))
    return bool(r.json())


def push_one(sub, push, ttl=3600):
    """휴대폰 한 대에 푸시 → 'ok' / 'gone'(앱을 지웠거나 알림을 끔) / 'fail'"""
    from pywebpush import WebPushException, webpush
    try:
        webpush(subscription_info=sub, data=json.dumps(push, ensure_ascii=False),
                vapid_private_key=VAPID_PRIVATE, vapid_claims={"sub": _subject()}, ttl=ttl, timeout=10)
        return "ok"
    except WebPushException as e:
        return "gone" if getattr(getattr(e, "response", None), "status_code", None) in (404, 410) else "fail"
    except Exception:
        return "fail"


def get_subs():
    r = _check(requests.get(f"{URL}/rest/v1/subs?select=endpoint,sub,prefs", timeout=15, headers=_headers()))
    return r.json()


def delete_sub(endpoint):
    q = urllib.parse.quote(endpoint, safe="")
    _check(requests.delete(f"{URL}/rest/v1/subs?endpoint=eq.{q}", timeout=15, headers=_headers()))


MISS_OF = {"시장": "시장약세", "추세": "추세약세", "눌림": "이미오름", "변동성": "변동큼", "실적": "실적임박"}
LEGACY_SCORE = 6                      # 예전 설정(등급만 고르던 때)을 쓰는 사람은 신호 점수 6점 이상만


def passes(alert, rule):
    """매수 알림이 사용자가 켠 조건(rule)을 모두 통과하나. rule: {"score": 6, "need": ["시장", ...], "card": bool}"""
    if int(alert.get("score") or 0) < int(rule.get("score", LEGACY_SCORE)):
        return False
    if alert["side"] != "buy":
        return True
    flags = alert.get("flags")
    misses = alert.get("misses") or []
    for g in rule.get("need") or []:
        ok = flags.get(g, True) if isinstance(flags, dict) else MISS_OF.get(g) not in misses
        if not ok:
            return False
    if rule.get("card"):
        ok = flags.get("성적", False) if isinstance(flags, dict) else not ({"과거손실", "기록부족"} & set(misses))
        if not ok:
            return False
    return True


def wants(prefs, alert, now):
    """이 사용자가 이 알림을 받고 싶어 하나 (앱 '알림 설정' 그대로)"""
    p = {**DEFAULT_PREFS, **(prefs or {})}
    if alert["market"] not in p["markets"]:
        return False
    if alert["side"] == "sell" and not p["sell"]:
        return False
    if alert["side"] == "sell" and not p.get("sellAll") and not (alert.get("flags") or {}).get("linked"):
        return False                                          # 기본: 최근 매수 알림·실전 보유 종목만
    rule = (p.get("rules") or {}).get(alert["market"])
    if rule:                                                  # 새 설정: 지표 켜고 끄기 / 추천 설정
        if not passes(alert, rule):
            return False
    else:                                                     # 예전 설정: 안정성 등급만
        if int(alert.get("score") or 0) < LEGACY_SCORE:
            return False
        if alert["side"] == "buy":
            need = GRADE_RANK.get(p["minGrade"], 1)
            if GRADE_RANK.get(alert.get("grade") or "높음", 2) < need:
                return False
    if p["quiet"] and now.astimezone(KST).hour < 7:          # 방해 금지: 밤 12시 ~ 아침 7시
        return False
    return True


def _subject():
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" in repo:
        owner, name = repo.split("/", 1)
        return f"https://{owner.lower()}.github.io/{name}/"
    return "mailto:noreply@example.com"


def send_push(subs, items, now):
    """items: [(알림 행, 푸시 내용)] → (보낸 수, 지운 구독 수)"""
    if not VAPID_PRIVATE or not subs or not items:
        return 0, 0
    from pywebpush import WebPushException, webpush        # 푸시를 실제로 보낼 때만 필요
    sent, gone = 0, set()
    for s in subs:
        if s["endpoint"] in gone:
            continue
        for row, push in items:
            if not wants(s.get("prefs"), row, now):
                continue
            try:
                webpush(subscription_info=s["sub"], data=json.dumps(push, ensure_ascii=False),
                        vapid_private_key=VAPID_PRIVATE, vapid_claims={"sub": _subject()}, ttl=3600, timeout=10)
                sent += 1
            except WebPushException as e:
                code = getattr(getattr(e, "response", None), "status_code", None)
                if code in (404, 410):                           # 앱을 지웠거나 알림을 끈 휴대폰
                    gone.add(s["endpoint"])
                    break
            except Exception:
                pass
    for ep in gone:
        try:
            delete_sub(ep)
        except Exception:
            pass
    return sent, len(gone)


def push_brief(push, now, pref="brief", market=None):
    """요약 푸시 (아침 브리핑 · 장중/마감 요약): 알림을 켠 휴대폰 중 그 요약을 끄지 않은 곳만 → 보낸 수
    market을 주면 그 시장을 고른 사람에게만 (밤 7시 전에만 쓰므로 방해 금지와 안 겹침)"""
    if not enabled() or not VAPID_PRIVATE:
        return 0
    from pywebpush import WebPushException, webpush
    if now.astimezone(KST).hour < 7:
        return 0
    sent, gone = 0, []
    for s in get_subs():
        pf = s.get("prefs") or {}
        if pf.get(pref, True) is False:
            continue
        if market and isinstance(pf.get("markets"), list) and market not in pf["markets"]:
            continue
        try:
            webpush(subscription_info=s["sub"], data=json.dumps(push, ensure_ascii=False),
                    vapid_private_key=VAPID_PRIVATE, vapid_claims={"sub": _subject()}, ttl=3 * 3600, timeout=10)
            sent += 1
        except WebPushException as e:
            if getattr(getattr(e, "response", None), "status_code", None) in (404, 410):
                gone.append(s["endpoint"])
        except Exception:
            pass
    for ep in gone:
        try:
            delete_sub(ep)
        except Exception:
            pass
    return sent


def publish(items, now):
    """items: [(알림 행, 푸시 내용)] → 저장하고 푸시 (실패해도 카톡 알림은 계속)"""
    if not enabled() or not items:
        return {"saved": 0, "pushed": 0}
    ids = insert_alerts([row for row, _ in items])
    for (row, push), i in zip(items, ids):
        push["url"] = f"./#/alert/{i}"
        push["tag"] = f"a{i}"
    sent, gone = send_push(get_subs(), items, now) if VAPID_PRIVATE else (0, 0)
    return {"saved": len(ids), "pushed": sent, "removed": gone}
