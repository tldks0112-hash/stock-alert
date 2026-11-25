# 의견 답글 메일: 개발자(0521sa)가 답글을 달면, 로그인한 상태로 '답글을 메일로 받기'를 켜고 보낸 사람에게 메일을 보내요.
# Gmail 앱 비밀번호(비밀값 GMAIL_USER · GMAIL_APP_PASSWORD)가 있을 때만 동작해요. 없으면 아무것도 하지 않아요.
# 공개 실행 기록에는 보낸 개수만 남기고 메일 주소·내용은 찍지 않아요.

import os
import smtplib
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr
from zoneinfo import ZoneInfo

import json
import requests

import app_bridge as ab

USER = ab._clean(os.environ.get("GMAIL_USER"))
PASS = ab._clean(os.environ.get("GMAIL_APP_PASSWORD"))
APP_URL = "https://tldks0112-hash.github.io/stock-alert/#/feedback"
KST = ZoneInfo("Asia/Seoul")


def enabled():
    return bool(ab.enabled() and USER and PASS)


def _rpc(fn, body=None):
    r = ab._check(requests.post(f"{ab.URL}/rest/v1/rpc/{fn}", timeout=15, headers=ab._headers(), data=json.dumps(body or {})))
    return r.json() if r.text else None


def _when(iso):
    try:
        return datetime.fromisoformat(iso).astimezone(KST).strftime("%m월 %d일 %H:%M")
    except (TypeError, ValueError):
        return ""


def compose(m):
    msg = EmailMessage()
    msg["Subject"] = "[타점노트] 보내 주신 의견에 답글이 달렸어요"
    msg["From"] = formataddr(("타점노트", USER))
    msg["To"] = m["email"]
    msg.set_content(
        "안녕하세요, 타점노트예요.\n"
        f"{_when(m.get('at'))}에 보내 주신 의견에 답글이 달렸어요.\n\n"
        f"■ 보내 주신 의견 ({m.get('kind', '')})\n{m.get('body', '')}\n\n"
        f"■ {m.get('by') or '0521sa'}의 답글 ({_when(m.get('rat'))})\n{m.get('reply', '')}\n\n"
        f"앱에서 보기: {APP_URL}\n\n"
        "이 메일은 로그인한 상태로 의견을 보내면서 '답글을 메일로 받기'를 켠 경우에만 보내요.\n"
        "타점노트의 정보는 투자 참고용이며 투자자문이나 매매 권유가 아니에요.\n")
    return msg


def run():
    """→ 공개 기록용 짧은 문구 (개수만)"""
    if not enabled():
        return ""
    q = _rpc("mail_queue") or []
    if not q:
        return ""
    sent = fail = 0
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as s:
            s.login(USER, PASS)
            for m in q:
                try:
                    s.send_message(compose(m))
                    _rpc("mail_done", {"p_rid": m["rid"]})
                    sent += 1
                except smtplib.SMTPRecipientsRefused:
                    _rpc("mail_done", {"p_rid": m["rid"], "p_err": "받는 주소 거부"})
                    fail += 1
                except Exception:
                    fail += 1
    except smtplib.SMTPAuthenticationError:
        return " · 답글 메일 로그인 실패 (앱 비밀번호 확인)"
    return f" · 답글 메일 {sent}통" + (f" (실패 {fail})" if fail else "")
