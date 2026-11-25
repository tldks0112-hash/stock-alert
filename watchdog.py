"""엔진 멈춤 경보 — GitHub 일정으로 30분마다 따로 돌아요 (엔진과 별개)

- 엔진이 20분 넘게 한 번도 안 돌았으면 → 주인 카톡으로 "멈췄어요" (멈춘 동안 6시간마다 한 번 더)
- 최근 30분 동안 엔진이 3번도 안 돌았으면 (원래 6번) → "5분 실행이 느려졌어요"
- 다시 정상으로 돌아오면 → "다시 돌아가요"

공개 실행 기록에는 상태와 분만 남겨요. 비밀값은 출력하지 않아요.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

import app_bridge as ab

KST = ZoneInfo("Asia/Seoul")
STALE_MIN = 20
SLOW_RUNS = 3
REMIND = timedelta(hours=6)
DEV_URL = "https://tldks0112-hash.github.io/stock-alert/#/dev"


def heartbeat():
    r = ab._check(requests.get(f"{ab.URL}/rest/v1/kv?key=eq.heartbeat&select=updated_at", timeout=15, headers=ab._headers()))
    rows = r.json()
    return datetime.fromisoformat(rows[0]["updated_at"]) if rows else None


def recent_runs(now):
    eng = ab.get_kv("engine") or {}
    n = 0
    for r in eng.get("runs") or []:
        try:
            if not r.get("force") and now - datetime.fromisoformat(r["at"]) <= timedelta(minutes=30):
                n += 1
        except (KeyError, TypeError, ValueError):
            continue
    return n, bool(eng)


def kakao(text):
    import signal_alert as base                # 카톡이 필요할 때만 불러옴 (설정 확인 포함)
    token = base.get_access_token()
    base.send_kakao(token, text, link=DEV_URL, button="개발자 화면")


def judge(now, beat, runs, has_engine):
    """→ (상태, 설명)  상태: ok / down / slow"""
    if beat is None:
        return "down", "엔진 실행 기록이 없어요"
    age = (now - beat).total_seconds() / 60
    if age > STALE_MIN:
        return "down", f"{age:.0f}분째 엔진이 안 돌았어요"
    if has_engine and runs < SLOW_RUNS:
        return "slow", f"최근 30분 동안 엔진이 {runs}번만 돌았어요 (원래 6번)"
    return "ok", f"마지막 실행 {age:.0f}분 전"


def main():
    if not ab.enabled():
        print("앱 서버 설정이 없어 건너뛰어요")
        return
    now = datetime.now(timezone.utc)
    beat = heartbeat()
    runs, has_engine = recent_runs(now)
    status, why = judge(now, beat, runs, has_engine)
    prev = ab.get_kv("watchdog") or {}
    last_note = prev.get("notified")
    msg = None
    if status != "ok":
        first = prev.get("status") != status
        stale_note = not last_note or now - datetime.fromisoformat(last_note) >= REMIND
        if first or stale_note:
            when = beat.astimezone(KST).strftime("%m/%d %H:%M") if beat else "-"
            head = "⚠️ 타점노트 엔진이 멈췄어요" if status == "down" else "⚠️ 타점노트 5분 실행이 느려졌어요"
            msg = f"{head}\n{why}\n마지막 실행: {when} (한국 시간)\n\nGitHub Actions와 개발자 화면에서 확인해 주세요."
    elif prev.get("status") in ("down", "slow"):
        since = prev.get("since")
        mins = int((now - datetime.fromisoformat(since)).total_seconds() // 60) if since else None
        msg = "✅ 타점노트 엔진이 다시 돌아가요" + (f"\n멈춰 있던 시간: 약 {mins}분" if mins is not None else "")
    sent = False
    if msg:
        try:
            kakao(msg)
            sent = True
        except Exception as e:
            print(f"카톡 보내기 실패 ({type(e).__name__})")
    state = {"status": status, "why": why, "checked": now.isoformat(),
             "since": (prev.get("since") if prev.get("status") == status else now.isoformat()) if status != "ok" else None,
             "notified": now.isoformat() if sent else last_note if status != "ok" else None}
    ab.put_kv("watchdog", state)
    print(f"엔진 상태: {status} · {why}" + (" · 카톡 보냄" if sent else ""))


if __name__ == "__main__":
    main()
