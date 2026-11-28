# 공모주 종목별 정리 글 → 구글 Blogger 자동 게시
# 데이터: ipo_channel.py 와 같은 38커뮤니케이션 청약 일정
#
# 하루 한 번 실행:
#   - 아직 글이 없는 다가오는 공모주 → 새 글 (한 번에 최대 MAX_NEW개, 천천히 쌓기)
#   - 공모가 확정·경쟁률이 새로 나온 종목 → 그 글을 고쳐서 최신으로
# 올린 글 번호는 blog_state.json 에 적어 둬요.
#
# 처음 한 번 연결: python blog_post.py connect "<동의 후 주소창의 주소>"
# 필요한 비밀값: BLOGGER_CLIENT_ID, BLOGGER_CLIENT_SECRET, BLOGGER_BLOG_ID, BLOGGER_REFRESH_TOKEN
# 시험 실행: DRY_RUN=1 python blog_post.py  (올리지 않고 글만 출력)

import html
import json
import os
import sys
import time
from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import requests

import ipo_channel as ipo

CLIENT_ID = os.environ.get("BLOGGER_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("BLOGGER_CLIENT_SECRET", "").strip()
BLOG_ID = os.environ.get("BLOGGER_BLOG_ID", "").strip()
REFRESH = os.environ.get("BLOGGER_REFRESH_TOKEN", "").strip()
DRY = os.environ.get("DRY_RUN", "") not in ("", "0", "false")
STATE_FILE = os.environ.get("BLOG_STATE_FILE", "blog_state.json")
MAX_NEW = int(os.environ.get("BLOG_MAX_NEW", "2") or 2)
CHANNEL_URL = os.environ.get("CHANNEL_URL", "https://t.me/ipo_alarm_kr").strip()
REDIRECT = "http://localhost"
API = "https://www.googleapis.com/blogger/v3"
WEEK = "월화수목금토일"


# ---------------- 계산 ----------------
def won(n):
    return f"{int(round(n)):,}원"


def nums(s):
    out = []
    for part in (s or "").replace(" ", "").split("~"):
        digits = "".join(ch for ch in part if ch.isdigit())
        if digits:
            out.append(int(digits))
    return out


def biz_after(d, n):
    """주말을 뺀 n영업일 뒤 (공휴일은 반영 못 해서 '약'으로 표시)"""
    while n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def kd(d):
    return f"{d.year}년 {d.month}월 {d.day}일({WEEK[d.weekday()]})"


# ---------------- 글 만들기 ----------------
def title_of(it):
    s = date.fromisoformat(it["start"])
    return f"{it['name']} 공모주 청약 일정·공모가·주간사 정리 ({s.month}월 {s.day}일 청약)"


def content_of(it, today):
    e = html.escape
    s, en = date.fromisoformat(it["start"]), date.fromisoformat(it["end"])
    days = (en - s).days + 1
    refund = biz_after(en, 2)
    band, fixed = nums(it["band"]), nums(it["fixed"])
    brokers = [b.strip() for b in (it["brokers"] or "").split(",") if b.strip()]

    rows = [("청약 기간", f"{kd(s)} ~ {kd(en)} ({days}일간)"),
            ("희망 공모가", f"{e(it['band'])}원" if it["band"] else "미정"),
            ("확정 공모가", f"<b>{e(it['fixed'])}원</b>" if it["fixed"] else "아직 확정 전"),
            ("청약 경쟁률", e(it["ratio"]) if it["ratio"] else "청약 마감 후 발표"),
            ("주간사", e(", ".join(brokers)) if brokers else "미정"),
            ("환불일(예상)", f"약 {kd(refund)}")]
    table = "".join(f'<tr><th style="text-align:left;padding:6px 10px;background:#f3f5f8;white-space:nowrap">{k}</th>'
                    f'<td style="padding:6px 10px">{v}</td></tr>' for k, v in rows)

    # 최소 청약 증거금 (대부분 공모주: 최소 10주, 증거금 50%)
    if fixed:
        p = fixed[0]
        money = (f"확정 공모가 {won(p)} 기준으로 최소 10주를 청약하면 증거금 50%인 "
                 f"<b>{won(p * 10 * 0.5)}</b>이 필요해요.")
    elif band:
        lo, hi = band[0], band[-1]
        money = (f"희망 공모가 기준으로 최소 10주 청약 시 증거금 50%는 "
                 f"<b>{won(lo * 5)} ~ {won(hi * 5)}</b>이에요. 공모가가 확정되면 이 글에 바로 반영돼요.")
    else:
        money = "공모가가 정해지면 최소 청약 증거금을 이 글에 계산해 넣을게요."

    if len(brokers) > 1:
        broker_txt = (f"주간사가 {len(brokers)}곳({e(', '.join(brokers))})이에요. 균등 배정은 증권사마다 따로 나눠서, "
                      "계좌가 여러 곳에 있으면 청약자가 적을 것 같은 증권사를 고르는 것도 방법이에요. "
                      "다만 같은 공모주는 한 증권사에서만 청약할 수 있어요.")
    elif brokers:
        broker_txt = f"{e(brokers[0])} 한 곳에서만 청약할 수 있어요. 계좌가 없다면 청약 전날까지 미리 만들어 두세요."
    else:
        broker_txt = "주간사가 정해지면 이 글에 반영할게요."

    status = ("청약이 끝났어요." if en < today else
              "지금 청약이 진행 중이에요." if s <= today else
              f"청약까지 {(s - today).days}일 남았어요.")

    parts = [
        f"<p>{e(it['name'])} 공모주 청약 일정과 공모가, 주간사를 한눈에 정리했어요. {status}</p>",
        f'<table style="border-collapse:collapse;width:100%;border:1px solid #dde2e8">{table}</table>',
        "<h3>최소 청약 금액</h3>",
        f"<p>{money} 균등 배정을 노린다면 최소 수량만 청약해도 돼요. "
        "증거금 비율과 최소 수량은 증권사 공고에서 한 번 더 확인해 주세요.</p>",
        "<h3>어느 증권사에서 청약할까</h3>",
        f"<p>{broker_txt}</p>",
        "<h3>청약 전에 확인할 것</h3>",
        "<ul>"
        "<li><b>기관 수요예측 경쟁률</b>: 높을수록 기관 관심이 크다는 뜻이에요.</li>"
        "<li><b>의무보유 확약 비율</b>: 기관이 상장 뒤 일정 기간 팔지 않겠다고 약속한 비율이에요. 높을수록 상장 첫날 매도 물량이 적어요.</li>"
        "<li><b>상장일 유통 가능 물량</b>: 낮을수록 상장 직후 가격이 덜 흔들려요.</li>"
        "<li><b>공모가 위치</b>: 희망 범위 상단이나 그 위로 확정되면 수요가 강했다는 신호예요.</li>"
        "</ul>",
        f"<p>환불일은 보통 청약 마감 2영업일 뒤라서 약 {kd(refund)}로 계산했어요. "
        "공휴일이 끼면 늦어질 수 있어요.</p>",
        f'<p>📢 공모주 청약 시작·마감·공모가 확정·경쟁률을 텔레그램으로 바로 받아 보세요: '
        f'<a href="{e(CHANNEL_URL)}">{e(CHANNEL_URL)}</a></p>',
        f"<p style=\"color:#777;font-size:13px\">※ 투자 권유가 아니에요. 일정과 가격은 증권신고서 정정 등으로 바뀔 수 있어요. "
        f"자료 출처: 38커뮤니케이션"
        + (f' (<a href="{e(it["link"])}">원문</a>)' if it.get("link") else "")
        + f", 마지막 업데이트 {kd(today)}</p>",
    ]
    return "\n".join(parts)


# ---------------- Blogger ----------------
def access_token():
    r = requests.post("https://oauth2.googleapis.com/token", timeout=20, data={
        "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
        "refresh_token": REFRESH, "grant_type": "refresh_token"})
    if not r.ok:
        sys.exit(f"구글 연결 오류 {r.status_code}: {r.text[:300]}\n"
                 "블로그 연결(처음 한 번)을 다시 해 주세요.")
    return r.json()["access_token"]


def api(method, path, tok, **kw):
    r = requests.request(method, API + path, timeout=30, headers={"Authorization": f"Bearer {tok}"}, **kw)
    if not r.ok:
        raise RuntimeError(f"Blogger 오류 {r.status_code}: {r.text[:300]}")
    return r.json()


def connect(url_or_code):
    """동의 후 주소창 주소에서 code 를 꺼내 리프레시 토큰으로 바꿔요."""
    v = (url_or_code or "").strip()
    code = parse_qs(urlparse(v).query).get("code", [v])[0] if "code=" in v else v
    if not code:
        sys.exit("주소에 code= 가 없어요. 동의 후 주소창의 주소 전체를 붙여 넣어 주세요.")
    r = requests.post("https://oauth2.googleapis.com/token", timeout=20, data={
        "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "code": code,
        "redirect_uri": REDIRECT, "grant_type": "authorization_code"})
    if not r.ok:
        sys.exit(f"토큰 받기 실패 {r.status_code}: {r.text[:300]}\n"
                 "코드는 몇 분 안에 만료돼요. 연결 주소를 다시 열어서 새로 받아 주세요.")
    j = r.json()
    rt = j.get("refresh_token")
    if not rt:
        sys.exit("리프레시 토큰이 안 왔어요. 연결 주소 끝에 prompt=consent 가 있는지 확인해 주세요.")
    blog = api("GET", f"/blogs/{BLOG_ID}", j["access_token"])
    print(f"연결 완료! 블로그: {blog.get('name')} ({blog.get('url')})")
    with open(os.environ["NEW_REFRESH_TOKEN_FILE"], "w") as f:
        f.write(rt)


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"posts": {}}


def main():
    global DRY
    if not DRY and not all((CLIENT_ID, CLIENT_SECRET, BLOG_ID, REFRESH)):
        print("블로그 비밀값이 아직 다 없어서 글은 화면에만 보여 줄게요.")
        DRY = True
    today = datetime.now(ipo.KST).date()
    if os.environ.get("TODAY"):
        today = date.fromisoformat(os.environ["TODAY"])
    items = ipo.fetch()
    state = load_state()
    posts = state.setdefault("posts", {})
    tok = None if DRY else access_token()

    # 1) 이미 쓴 글: 공모가·경쟁률·일정이 바뀌었으면 고치기
    for it in items:
        rec = posts.get(it["name"])
        if not rec:
            continue
        sig = [it["fixed"], it["ratio"], it["start"], it["end"], it["band"]]
        if rec.get("sig") == sig:
            continue
        if DRY:
            print("[고칠 글]", title_of(it))
        else:
            api("PATCH", f"/blogs/{BLOG_ID}/posts/{rec['id']}", tok,
                json={"title": title_of(it), "content": content_of(it, today)})
            print("고침:", it["name"], rec.get("url"))
        rec["sig"] = sig
        time.sleep(2)

    # 2) 새 글: 청약이 아직 안 끝난 종목 중 가까운 순서로
    todo = sorted((it for it in items if it["name"] not in posts and date.fromisoformat(it["end"]) >= today),
                  key=lambda x: x["start"])[:MAX_NEW]
    for it in todo:
        body = content_of(it, today)
        if DRY:
            print("[새 글]", title_of(it), "\n", body[:1500], "\n")
            continue
        p = api("POST", f"/blogs/{BLOG_ID}/posts/", tok, json={
            "title": title_of(it), "content": body, "labels": ["공모주", "청약일정", it["name"]]})
        posts[it["name"]] = {"id": p["id"], "url": p.get("url"), "end": it["end"],
                             "sig": [it["fixed"], it["ratio"], it["start"], it["end"], it["band"]]}
        print("새 글:", it["name"], p.get("url"))
        time.sleep(5)

    print(f"[{today}] 일정 {len(items)}개, 올린 글 누적 {len(posts)}개, 남은 새 글 후보 "
          f"{sum(1 for it in items if it['name'] not in posts and it['end'] >= today.isoformat())}개")
    if not DRY:
        keep = (today - timedelta(days=60)).isoformat()
        state["posts"] = {k: v for k, v in posts.items() if v.get("end", "9") >= keep}
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "connect":
        connect(sys.argv[2] if len(sys.argv) > 2 else os.environ.get("CODE", ""))
    else:
        main()

# ---- 파일 끝 ----
