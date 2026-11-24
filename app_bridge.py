# 앱 연결: 엔진이 만든 알림을 앱 데이터베이스(Supabase)에 저장하고, 베타 사용자 휴대폰에 푸시 알림을 보내요.
# 비밀값 SUPABASE_URL · SUPABASE_SECRET_KEY 가 없으면 아무것도 하지 않아요 (카톡 알림은 그대로).
# 푸시는 VAPID_PRIVATE_KEY 까지 있어야 보내요.
# 공개 실행 기록에는 개수만 남기고, 종목 이름이나 주소는 찍지 않아요.

import json
import os
import urllib.parse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
VAPID_PRIVATE = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
KST = ZoneInfo("Asia/Seoul")
GRADE_RANK = {"낮음": 0, "보통": 1, "높음": 2}
DEFAULT_PREFS = {"markets": ["kr", "us", "crypto"], "minGrade": "보통", "sell": True, "quiet": False}


def enabled():
    return bool(URL and KEY)


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


def wants(prefs, alert, now):
    """이 사용자가 이 알림을 받고 싶어 하나 (앱 '알림 설정' 그대로)"""
    p = {**DEFAULT_PREFS, **(prefs or {})}
    if alert["market"] not in p["markets"]:
        return False
    if alert["side"] == "sell" and not p["sell"]:
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
