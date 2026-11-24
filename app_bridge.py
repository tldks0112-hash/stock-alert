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
DEFAULT_PREFS = {"markets": ["kr", "us", "crypto"], "minGrade": "보통", "sell": True, "quiet": False}


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
