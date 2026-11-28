# 주간 공모주 뉴스레터 → Brevo(무료) 이메일 자동 발송
# 매주 월요일 아침: 이번 주·다음 주 청약 일정 + 지난주 상장 첫날 결과
# 데이터는 ipo_channel.py / listing_result.py 와 같은 38커뮤니케이션 자료
#
# 비밀값: BREVO_API_KEY, BREVO_LIST_ID(숫자), BREVO_SENDER_EMAIL (Brevo에서 인증한 보내는 주소)
# 선택: SUBSCRIBE_URL (구독 신청 폼 주소 — 메일 아래에 '친구에게 공유' 링크로 붙어요)
# 시험: DRY_RUN=1 python newsletter.py  (보내지 않고 newsletter_preview.html 로 저장)
# 시험 발송: TEST_EMAIL=me@example.com 이면 그 주소로만 보내요

import html
import json
import os
import sys
from datetime import date, datetime, timedelta

import requests

import ipo_channel as ipo
import listing_result as lr

KEY = os.environ.get("BREVO_API_KEY", "").strip()
LIST_ID = os.environ.get("BREVO_LIST_ID", "").strip()
SENDER = os.environ.get("BREVO_SENDER_EMAIL", "").strip()
SENDER_NAME = os.environ.get("BREVO_SENDER_NAME", "공모주 청약 알림").strip()
TEST_EMAIL = os.environ.get("TEST_EMAIL", "").strip()
DRY = os.environ.get("DRY_RUN", "") not in ("", "0", "false")
FORCE = os.environ.get("FORCE", "") not in ("", "0", "false")
CHANNEL_URL = os.environ.get("CHANNEL_URL", "https://t.me/ipo_alarm_kr")
BLOG_URL = os.environ.get("BLOG_URL", "https://ipo-alarm-kr.blogspot.com/")
SUBSCRIBE_URL = os.environ.get("SUBSCRIBE_URL", "").strip()
STATE_FILE = os.environ.get("NEWSLETTER_STATE_FILE", "newsletter_state.json")
API = "https://api.brevo.com/v3"
e = lambda s: html.escape(s or "", quote=False)

TD = 'style="padding:8px 10px;border-top:1px solid #e6eaf0;font-size:14px;vertical-align:top"'
TH = 'style="padding:8px 10px;background:#1f3a5f;color:#fff;font-size:13px;text-align:left"'


def table(head, rows):
    return ('<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #dde2e8">'
            "<tr>" + "".join(f"<th {TH}>{h}</th>" for h in head) + "</tr>"
            + "".join("<tr>" + "".join(f"<td {TD}>{c}</td>" for c in r) + "</tr>" for r in rows) + "</table>")


def build(items, listings, today):
    mon = today - timedelta(days=today.weekday())
    weeks = []
    for label, a, b in (("이번 주", mon, mon + timedelta(days=6)), ("다음 주", mon + timedelta(days=7), mon + timedelta(days=13))):
        sel = sorted((it for it in items if a <= date.fromisoformat(it["start"]) <= b
                      or (label == "이번 주" and date.fromisoformat(it["start"]) < a <= date.fromisoformat(it["end"]))),
                     key=lambda x: (x["start"], x["name"]))
        rows = []
        for it in sel:
            price = f"<b>{e(it['fixed'])}원</b> (확정)" if it["fixed"] else (f"{e(it['band'])}원 (희망)" if it["band"] else "미정")
            name = f'<a href="{e(it["link"])}" style="color:#1f3a5f;font-weight:bold">{e(it["name"])}</a>' if it.get("link") else f"<b>{e(it['name'])}</b>"
            rows.append([f"{ipo.md(it['start'])}~{ipo.md(it['end'])}", name, price, e(it["brokers"] or "미정")])
        weeks.append((label, rows))
    last_mon, last_sun = mon - timedelta(days=7), mon - timedelta(days=1)
    res = sorted((r for r in listings if r["close1"] is not None and r["offer"]
                  and last_mon <= date.fromisoformat(r["date"]) <= last_sun), key=lambda r: r["date"])
    res_rows = []
    for r in res:
        c = lr.pct(r["close1"], r["offer"]); col = "#c00000" if (c or 0) < 0 else "#00843d"
        res_rows.append([e(r["name"]), lr.won(r["offer"]), lr.won(r["close1"]), f'<b style="color:{col}">{lr.fp(c)}</b>'])

    subject = f"[공모주 주간 일정] {mon.month}/{mon.day} 주 청약 " + (
        f"{len(weeks[0][1])}건" if weeks[0][1] else "일정") + (f" · 지난주 상장 {len(res)}건 결과" if res else "")
    body = [f'<p style="font-size:15px;margin:0 0 16px">안녕하세요! {mon.month}월 {mon.day}일 주 공모주 소식이에요.</p>']
    for label, rows in weeks:
        body.append(f'<h2 style="font-size:18px;color:#1f3a5f;margin:24px 0 8px">📅 {label} 청약 일정</h2>')
        body.append(table(["청약 기간", "종목", "공모가", "주간사"], rows) if rows else '<p style="color:#666">잡힌 일정이 없어요.</p>')
    if res_rows:
        body.append('<h2 style="font-size:18px;color:#1f3a5f;margin:24px 0 8px">📈 지난주 상장 첫날 결과</h2>')
        body.append(table(["종목", "공모가", "첫날 종가", "공모가 대비"], res_rows))
    body.append('<div style="margin:28px 0;padding:16px;background:#f3f6fa;border-radius:10px;font-size:14px;line-height:1.7">'
                f'🔔 청약 시작·마감, 공모가 확정, 경쟁률은 <a href="{CHANNEL_URL}">텔레그램 채널</a>에서 그때그때 알려 드려요.<br>'
                f'📝 종목별 자세한 정리는 <a href="{BLOG_URL}">블로그</a>에 있어요.'
                + (f'<br>💌 친구에게 이 뉴스레터를 추천하려면 <a href="{SUBSCRIBE_URL}">구독 링크</a>를 보내 주세요.' if SUBSCRIBE_URL else "")
                + "</div>")
    body.append('<p style="color:#888;font-size:12px">※ 투자 권유가 아니에요. 일정·가격은 바뀔 수 있어요. 자료 출처: 38커뮤니케이션<br>'
                '더 받고 싶지 않으시면 <a href="{{ unsubscribe }}" style="color:#888">수신 거부</a>를 눌러 주세요.</p>')
    html_doc = ('<!DOCTYPE html><html><body style="margin:0;background:#ffffff">'
                '<div style="max-width:640px;margin:0 auto;padding:24px 18px;font-family:Apple SD Gothic Neo,Malgun Gothic,sans-serif;color:#1e2837">'
                '<div style="font-size:13px;color:#888;margin-bottom:4px">공모주 청약 알림 · 주간 뉴스레터</div>'
                + "".join(body) + "</div></body></html>")
    return subject, html_doc, bool(weeks[0][1] or weeks[1][1] or res_rows)


def brevo(method, path, **kw):
    r = requests.request(method, API + path, timeout=30, headers={"api-key": KEY, "accept": "application/json"}, **kw)
    if not r.ok:
        raise RuntimeError(f"Brevo 오류 {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else {}


def main():
    now = datetime.now(ipo.KST)
    if os.environ.get("NOW_KST"):
        now = datetime.fromisoformat(os.environ["NOW_KST"]).replace(tzinfo=ipo.KST)
    today = now.date()
    try:
        state = json.load(open(STATE_FILE, encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {"sent": []}
    mon = today - timedelta(days=today.weekday())
    key = f"week:{mon}"
    if key in state["sent"] and not (FORCE or TEST_EMAIL or DRY):
        print("이번 주는 이미 보냈어요."); return
    items = ipo.fetch()
    try:
        listings = lr.fetch()
    except Exception as ex:  # noqa: BLE001
        print("상장 결과 읽기 실패(일정만 보내요):", ex); listings = []
    subject, doc, has = build(items, listings, today)
    print("제목:", subject)
    if DRY or not (KEY and SENDER and (LIST_ID or TEST_EMAIL)):
        open("newsletter_preview.html", "w", encoding="utf-8").write(doc)
        print("미리보기 저장: newsletter_preview.html (보내지 않음)"); return
    if not has and not FORCE:
        print("올릴 일정이 없어 이번 주는 쉬어요."); return
    if TEST_EMAIL:
        brevo("POST", "/smtp/email", json={"sender": {"name": SENDER_NAME, "email": SENDER},
                                            "to": [{"email": TEST_EMAIL}], "subject": "[시험] " + subject, "htmlContent": doc})
        print("시험 메일 보냄:", TEST_EMAIL); return
    camp = brevo("POST", "/emailCampaigns", json={
        "name": f"주간 공모주 {mon}", "subject": subject, "sender": {"name": SENDER_NAME, "email": SENDER},
        "htmlContent": doc, "recipients": {"listIds": [int(LIST_ID)]}})
    brevo("POST", f"/emailCampaigns/{camp['id']}/sendNow")
    print("발송 완료: 캠페인", camp["id"])
    state["sent"] = (state["sent"] + [key])[-60:]
    json.dump(state, open(STATE_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()

# ---- 파일 끝 ----
