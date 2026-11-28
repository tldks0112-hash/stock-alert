# 공모주 청약 알림 → 텔레그램 채널 자동 게시
# 출처: 38커뮤니케이션 공모주 청약일정 (https://www.38.co.kr/html/fund/index.htm?o=k)
#
# 아침 실행(한국 시간 7~11시): 오늘 청약 시작·마감 종목, 월요일엔 이번 주·다음 주 일정
# 모든 실행: 새로 잡힌 일정, 공모가 확정, 청약 경쟁률 발표를 바뀐 것만 게시
# 이미 올린 내용은 ipo_state.json 에 적어 두고 다시 올리지 않아요.
#
# 필요한 비밀값: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL (예: @my_ipo_channel)
# 시험 실행: DRY_RUN=1 python ipo_channel.py  (보내지 않고 화면에만 출력)

import html
import json
import os
import re
import ssl
import sys
import time
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser

import requests
import requests.adapters

SRC_URL = "https://www.38.co.kr/html/fund/index.htm?o=k"
SRC_BASE = "https://www.38.co.kr"
STATE_FILE = os.environ.get("IPO_STATE_FILE", "ipo_state.json")
KST = timezone(timedelta(hours=9))

BOT = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
CHANNEL = os.environ.get("TELEGRAM_CHANNEL", "").strip()
DRY = os.environ.get("DRY_RUN", "") not in ("", "0", "false")
FORCE_WEEKLY = os.environ.get("FORCE_WEEKLY", "") not in ("", "0", "false")
INTRO = os.environ.get("INTRO_POST", "") not in ("", "0", "false")
PROMO = os.environ.get("PROMO_TEXT", "").strip()   # 월요일 일정 글 아래에 붙일 홍보 한 줄 (비워 두면 안 붙여요)

FOOT = "\n\n<i>※ 투자 권유가 아니에요. 일정·가격은 바뀔 수 있어요. 출처: 38커뮤니케이션</i>"
WEEK = "월화수목금토일"


# ---------------- 페이지 읽기 ----------------
class _Rows(HTMLParser):
    """표의 모든 줄을 [칸 글자, ...] + 첫 링크 로 모아요."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self._row, self._cell, self._link = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row, self._link = [], None
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
        elif tag == "a" and self._row is not None and self._link is None:
            href = dict(attrs).get("href") or ""
            if "o=v" in href and "no=" in href:
                self._link = href

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append((self._row, self._link))
            self._row = None


DATE_RE = re.compile(r"(\d{4})\.(\d{1,2})\.(\d{1,2})\s*~\s*(?:(\d{1,2})\.)?(\d{1,2})")


def parse_period(s):
    m = DATE_RE.search(s or "")
    if not m:
        return None, None
    y, m1, d1, m2, d2 = int(m[1]), int(m[2]), int(m[3]), m[4], int(m[5])
    m2 = int(m2) if m2 else m1
    start = date(y, m1, d1)
    end = date(y + (1 if m2 < m1 else 0), m2, d2)
    return start, end


def parse(page):
    p = _Rows()
    p.feed(page)
    out, cols = [], None
    for cells, link in p.rows:
        if any("공모주일정" in c for c in cells) and any("종목명" in c for c in cells):
            cols = {name: i for i, name in enumerate(cells)}
            continue
        if len(cells) < 6:
            continue
        # 머리줄을 못 찾았으면 순서대로: 종목명, 일정, 확정공모가, 희망공모가, 경쟁률, 주간사
        idx = lambda key, pos: next((i for n, i in (cols or {}).items() if key in n), pos)
        get = lambda key, pos: cells[idx(key, pos)] if idx(key, pos) < len(cells) else ""
        start, end = parse_period(get("공모주일정", 1))
        name = get("종목명", 0)
        if not start or not name:
            continue
        out.append({
            "name": name,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "fixed": clean(get("확정공모가", 2)),
            "band": clean(get("희망공모가", 3)),
            "ratio": clean(get("청약경쟁률", 4)),
            "brokers": clean(get("주간사", 5)),
            "link": (SRC_BASE + link) if link and link.startswith("/") else (link or ""),
        })
    return out


def clean(s):
    s = (s or "").strip()
    return "" if s in ("-", "", "0") else s


class _OldTLS(requests.adapters.HTTPAdapter):
    """38커뮤니케이션은 오래된 보안 방식(TLS)을 써서, 그 사이트에만 낮은 보안 단계를 허용해요."""

    def init_poolmanager(self, *a, **kw):
        ctx = ssl.create_default_context()
        ctx.set_ciphers("DEFAULT:@SECLEVEL=0")
        ctx.minimum_version = ssl.TLSVersion.TLSv1
        ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
        kw["ssl_context"] = ctx
        return super().init_poolmanager(*a, **kw)


def _session():
    s = requests.Session()
    s.mount(SRC_BASE, _OldTLS())
    return s


def fetch():
    last = None
    sess = _session()
    for i in range(4):
        url = SRC_URL if i % 2 == 0 else SRC_URL.replace("https://", "http://")
        try:
            r = sess.get(url, timeout=20, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                "Accept-Language": "ko-KR,ko;q=0.9"})
            r.raise_for_status()
            raw = r.content
            head = raw[:3000].lower()
            enc = "utf-8" if b"charset=utf-8" in head else "cp949"
            items = parse(raw.decode(enc, errors="replace"))
            if items:
                return items
            last = "표를 찾지 못했어요 (페이지 모양이 바뀌었을 수 있어요)"
        except Exception as e:  # noqa: BLE001
            last = f"{url[:5]} {e!r}"
            print("읽기 재시도:", last[:200])
        time.sleep(3 * (i + 1))
    raise RuntimeError(f"공모주 페이지 읽기 실패: {last}")


# ---------------- 글 만들기 ----------------
def md(d):
    d = date.fromisoformat(d) if isinstance(d, str) else d
    return f"{d.month}/{d.day}({WEEK[d.weekday()]})"


def price_line(it):
    if it["fixed"]:
        return f"공모가 <b>{esc(it['fixed'])}원</b> (확정)"
    if it["band"]:
        return f"희망 공모가 {esc(it['band'])}원"
    return "공모가 미정"


def esc(s):
    return html.escape(s or "", quote=False)


def title(it):
    n = f"<b>{esc(it['name'])}</b>"
    return f'<a href="{html.escape(it["link"])}">{n}</a>' if it.get("link") else n


def block(it, with_period=True):
    lines = [f"▪️ {title(it)}"]
    if with_period:
        lines.append(f"   청약 {md(it['start'])} ~ {md(it['end'])}")
    lines.append(f"   {price_line(it)}")
    if it["ratio"]:
        lines.append(f"   경쟁률 {esc(it['ratio'])}")
    if it["brokers"]:
        lines.append(f"   주간사 {esc(it['brokers'])}")
    return "\n".join(lines)


def build_posts(items, state, now):
    today = now.date()
    posts, keys = [], []          # (key, text)
    seen = state.get("seen", {})
    posted = set(state.get("posted", []))
    first_run = not seen

    def add(key, text):
        if key not in posted:
            posts.append((key, text))

    morning = 7 <= now.hour < 11

    # 0) 처음 한 번: 채널 소개 + 앞으로 2주 일정 (시험 실행에서 켜요)
    if INTRO:
        soon = sorted((it for it in items if today <= date.fromisoformat(it["end"])
                       and date.fromisoformat(it["start"]) <= today + timedelta(days=14)),
                      key=lambda x: (x["start"], x["name"]))
        text = ("📌 <b>공모주 청약 알림 채널</b>\n\n"
                "매일 자동으로 알려드려요.\n"
                "• 아침 8시: 오늘 청약 시작·마감 종목\n"
                "• 월요일 아침: 이번 주·다음 주 청약 일정\n"
                "• 수시로: 새 공모주 일정, 공모가 확정, 청약 경쟁률")
        if soon:
            text += "\n\n<b>[앞으로 2주 청약 일정]</b>\n" + "\n\n".join(block(it) for it in soon)
        if PROMO:
            text += f"\n\n{PROMO}"
        add("intro", text + FOOT)

    # 1) 월요일 아침: 이번 주·다음 주 일정
    if (morning and today.weekday() == 0) or FORCE_WEEKLY:
        mon = today - timedelta(days=today.weekday())
        groups = []
        for label, a, b in (("이번 주", mon, mon + timedelta(days=6)),
                            ("다음 주", mon + timedelta(days=7), mon + timedelta(days=13))):
            sel = sorted((it for it in items if a <= date.fromisoformat(it["start"]) <= b
                          or (label == "이번 주" and date.fromisoformat(it["start"]) < a <= date.fromisoformat(it["end"]))),
                         key=lambda x: (x["start"], x["name"]))
            if sel:
                groups.append(f"<b>[{label}]</b>\n" + "\n\n".join(block(it) for it in sel))
        if groups:
            text = f"📅 <b>{md(mon)} 주 공모주 청약 일정</b>\n\n" + "\n\n".join(groups)
            if PROMO:
                text += f"\n\n{PROMO}"
            add(f"weekly:{mon}", text + FOOT)

    # 2) 아침: 오늘 시작 / 오늘 마감
    if morning:
        starts = sorted((it for it in items if it["start"] == today.isoformat()), key=lambda x: x["name"])
        ends = sorted((it for it in items if it["end"] == today.isoformat()), key=lambda x: x["name"])
        if starts:
            add(f"start:{today}", f"🔔 <b>오늘 청약 시작 ({md(today)})</b>\n\n"
                + "\n\n".join(block(it) for it in starts) + FOOT)
        if ends:
            add(f"end:{today}", f"⏰ <b>오늘 청약 마감 ({md(today)})</b>\n보통 오후 4시에 마감돼요.\n\n"
                + "\n\n".join(block(it, with_period=False) for it in ends) + FOOT)

    # 3) 바뀐 것 (첫 실행 때는 기록만 하고 안 올려요)
    if not first_run:
        new = [it for it in items if it["name"] not in seen and date.fromisoformat(it["end"]) >= today]
        if new:
            new.sort(key=lambda x: x["start"])
            add("new:" + "|".join(sorted(it["name"] for it in new)),
                "🆕 <b>새 공모주 일정</b>\n\n" + "\n\n".join(block(it) for it in new) + FOOT)
        for it in items:
            old = seen.get(it["name"])
            if not old:
                continue
            if it["fixed"] and not old.get("fixed"):
                add(f"fixed:{it['name']}", f"💰 <b>공모가 확정</b>\n\n{block(it)}" + FOOT)
            if it["ratio"] and not old.get("ratio"):
                add(f"ratio:{it['name']}", f"📊 <b>청약 경쟁률 나왔어요</b>\n\n{block(it)}" + FOOT)
    return posts


# ---------------- 보내기 ----------------
def send(text):
    if DRY:
        print("----- (보내지 않음) -----\n" + text + "\n")
        return True
    for i in range(3):
        try:
            r = requests.post(f"https://api.telegram.org/bot{BOT}/sendMessage", timeout=20, data={
                "chat_id": CHANNEL, "text": text, "parse_mode": "HTML",
                "disable_web_page_preview": "true"})
            if r.ok:
                return True
            print("텔레그램 오류:", r.status_code, r.text[:300])
            if r.status_code == 429:
                time.sleep(int(r.json().get("parameters", {}).get("retry_after", 5)) + 1)
                continue
            return False
        except Exception as e:  # noqa: BLE001
            print("텔레그램 연결 오류:", repr(e))
            time.sleep(3)
    return False


def chunks(text, limit=3900):
    if len(text) <= limit:
        return [text]
    parts, cur = [], ""
    for para in text.split("\n\n"):
        if cur and len(cur) + len(para) + 2 > limit:
            parts.append(cur)
            cur = para
        else:
            cur = f"{cur}\n\n{para}" if cur else para
    if cur:
        parts.append(cur)
    return parts


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def main():
    global DRY
    if not DRY and not (BOT and CHANNEL):
        print("TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL 비밀값이 아직 없어서 글은 화면에만 보여 줄게요.")
        DRY = True
    now = datetime.now(KST)
    if os.environ.get("NOW_KST"):            # 시험용 시각 바꾸기
        now = datetime.fromisoformat(os.environ["NOW_KST"]).replace(tzinfo=KST)
    items = fetch()
    state = load_state()
    posts = build_posts(items, state, now)
    print(f"[{now:%Y-%m-%d %H:%M} KST] 일정 {len(items)}개, 올릴 글 {len(posts)}개")
    for it in sorted(items, key=lambda x: x["start"], reverse=True)[:5]:
        print(f"  {it['start']}~{it['end']} {it['name']} | 확정 {it['fixed'] or '-'} | 희망 {it['band'] or '-'} | 경쟁률 {it['ratio'] or '-'}")

    posted = list(state.get("posted", []))
    failed = 0
    for key, text in posts:
        if all(send(part) for part in chunks(text)):
            posted.append(key)
            print("올림:", key)
        else:
            failed += 1
        time.sleep(1)

    keep_from = (now.date() - timedelta(days=60)).isoformat()
    state = {
        "updated": now.isoformat(timespec="minutes"),
        # 끝난 지 60일 넘은 종목은 기록에서 빼요 (파일이 커지지 않게)
        "seen": {it["name"]: {"fixed": it["fixed"], "ratio": it["ratio"], "start": it["start"], "end": it["end"]}
                 for it in items if it["end"] >= keep_from}
        | {k: v for k, v in state.get("seen", {}).items()
           if v.get("end", "") >= keep_from and k not in {it["name"] for it in items}},
        "posted": posted[-300:],
    }
    if not DRY or os.environ.get("SAVE_STATE"):
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
    if failed:
        print(f"⚠️ 글 {failed}개를 못 올렸어요. TELEGRAM_CHANNEL 값과 봇 관리자 권한을 확인해 주세요.")
        sys.exit(1)


if __name__ == "__main__":
    main()

# ---- 파일 끝 ----
