# 공모주 상장 결과 → 텔레그램 채널 + 블로그 월간 정리 글
# 출처: 38커뮤니케이션 신규상장 (https://www.38.co.kr/html/fund/index.htm?o=nw)
#
# 아침 실행(한국 시간 7~11시): 오늘 상장하는 종목 알림
# 오후 실행: 상장 첫날 결과(시초가·첫날 종가·공모가 대비 수익률) 알림
#           + 블로그 "○월 공모주 상장 첫날 수익률 정리" 글을 만들거나 최신으로 고침
# 기록: listing_state.json
#
# 시험 실행: DRY_RUN=1 python listing_result.py

import hashlib
import html
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta

import ipo_channel as ipo

URL = "https://www.38.co.kr/html/fund/index.htm?o=nw"
STATE_FILE = os.environ.get("LISTING_STATE_FILE", "listing_state.json")
DRY = os.environ.get("DRY_RUN", "") not in ("", "0", "false")
CHANNEL_URL = os.environ.get("CHANNEL_URL", "https://t.me/ipo_alarm_kr")
FOOT = "\n\n<i>※ 투자 권유가 아니에요. 출처: 38커뮤니케이션</i>"


def num(s):
    s = (s or "").replace(",", "").replace("%", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def parse(page):
    p = ipo._Rows(); p.feed(page)
    cols, out = None, []
    for cells, link in p.rows:
        if any("신규상장일" in c for c in cells) and any("기업명" in c for c in cells):
            cols = {n: i for i, n in enumerate(cells)}
            continue
        if not cols or len(cells) < len(cols) - 1:
            continue
        g = lambda key: next((cells[i] for n, i in cols.items() if key in n and i < len(cells)), "")
        m = re.match(r"(\d{4})/(\d{1,2})/(\d{1,2})", g("신규상장일"))
        if not m or not g("기업명"):
            continue
        out.append({"name": g("기업명").strip(), "date": date(int(m[1]), int(m[2]), int(m[3])).isoformat(),
                    "offer": num(g("공모가")), "open": num(g("시초가")), "close1": num(g("첫날종가")),
                    "now": num(g("현재가")),
                    "link": (ipo.SRC_BASE + link) if link and link.startswith("/") else (link or "")})
    return out


def fetch():
    if os.environ.get("FIXTURE"):
        return parse(open(os.environ["FIXTURE"], encoding="utf-8").read())
    s = ipo._session(); last = None
    for i in range(4):
        u = URL if i % 2 == 0 else URL.replace("https://", "http://")
        try:
            r = s.get(u, timeout=20, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0"})
            r.raise_for_status()
            rows = parse(r.content.decode("cp949", errors="replace"))
            if rows:
                return rows
            last = "표를 못 찾았어요"
        except Exception as e:  # noqa: BLE001
            last = repr(e)
        time.sleep(3 * (i + 1))
    raise RuntimeError(f"신규상장 페이지 읽기 실패: {last}")


def pct(a, b):
    return (a - b) / b if a is not None and b else None


def fp(x):
    return "-" if x is None else f"{x:+.1%}".replace("+-", "-")


def won(x):
    return "-" if x is None else f"{x:,.0f}원"


def esc(s):
    return html.escape(s or "", quote=False)


def is_spac(name):
    return "스팩" in name


# ---------------- 텔레그램 ----------------
def tg_today(rows):
    lines = [f"▪️ <b>{esc(r['name'])}</b> 공모가 {won(r['offer'])}" for r in rows]
    return "🔔 <b>오늘 상장해요</b>\n\n" + "\n".join(lines) + "\n\n장 시작 전 동시호가에서 시초가가 정해져요." + FOOT


def tg_result(r):
    o, c = pct(r["open"], r["offer"]), pct(r["close1"], r["offer"])
    mood = "📈" if (c or 0) > 0 else "📉"
    return (f"{mood} <b>{esc(r['name'])} 상장 첫날 결과</b>\n\n"
            f"공모가 {won(r['offer'])}\n시초가 {won(r['open'])} ({fp(o)})\n첫날 종가 <b>{won(r['close1'])} ({fp(c)})</b>\n\n"
            f"공모가에 10주를 받아 첫날 종가에 팔았다면 약 {won((r['close1'] - r['offer']) * 10) if r['close1'] and r['offer'] else '-'} "
            f"(수수료·세금 전)이에요." + FOOT)


# ---------------- 블로그 월간 정리 ----------------
def month_post(rows, y, m, today):
    sel = sorted((r for r in rows if r["close1"] is not None and r["offer"]
                  and date.fromisoformat(r["date"]).year == y and date.fromisoformat(r["date"]).month == m),
                 key=lambda r: r["date"])
    if not sel:
        return None
    title = f"{y}년 {m}월 공모주 상장 첫날 수익률 정리 (시초가·종가)"
    normal = [r for r in sel if not is_spac(r["name"])]
    rets = [pct(r["close1"], r["offer"]) for r in normal]
    ups = sum(1 for x in rets if x and x > 0)
    best = max(normal, key=lambda r: pct(r["close1"], r["offer"])) if normal else None
    worst = min(normal, key=lambda r: pct(r["close1"], r["offer"])) if normal else None
    th = "".join(f'<th style="padding:6px 8px;background:#f3f5f8;text-align:left">{h}</th>'
                 for h in ("상장일", "종목", "공모가", "시초가", "첫날 종가", "공모가 대비"))
    body_rows = ""
    for r in sel:
        c = pct(r["close1"], r["offer"])
        color = "#c00000" if (c or 0) < 0 else "#00843d"
        d = date.fromisoformat(r["date"])
        body_rows += (f'<tr><td style="padding:6px 8px;border-top:1px solid #e4e8ee">{d.month}/{d.day}</td>'
                      f'<td style="padding:6px 8px;border-top:1px solid #e4e8ee">{esc(r["name"])}</td>'
                      f'<td style="padding:6px 8px;border-top:1px solid #e4e8ee">{won(r["offer"])}</td>'
                      f'<td style="padding:6px 8px;border-top:1px solid #e4e8ee">{won(r["open"])} ({fp(pct(r["open"], r["offer"]))})</td>'
                      f'<td style="padding:6px 8px;border-top:1px solid #e4e8ee">{won(r["close1"])}</td>'
                      f'<td style="padding:6px 8px;border-top:1px solid #e4e8ee;color:{color};font-weight:bold">{fp(c)}</td></tr>')
    table = f'<table style="border-collapse:collapse;width:100%;border:1px solid #dde2e8;font-size:14px"><tr>{th}</tr>{body_rows}</table>'
    summary = f"<p>{y}년 {m}월에 상장한 공모주 {len(sel)}개의 상장 첫날 성적을 정리했어요."
    if normal:
        avg = sum(x for x in rets if x is not None) / len(rets)
        summary += (f" 스팩을 뺀 {len(normal)}개 중 {ups}개가 공모가보다 높게 첫날을 마쳤고, 첫날 종가 기준 평균 수익률은 {fp(avg)}예요.")
    summary += "</p>"
    if best and worst and best is not worst:
        summary += (f"<p>가장 좋았던 종목은 <b>{esc(best['name'])}</b>({fp(pct(best['close1'], best['offer']))}), "
                    f"가장 아쉬웠던 종목은 <b>{esc(worst['name'])}</b>({fp(pct(worst['close1'], worst['offer']))})예요.</p>")
    tips = ("<h3>표 보는 법</h3><ul><li><b>시초가</b>: 상장 첫날 오전 9시에 정해지는 첫 가격이에요. 공모가의 60%~400% 사이에서 정해져요.</li>"
            "<li><b>공모가 대비</b>: 첫날 종가가 공모가보다 몇 % 높거나 낮은지예요. 균등 배정 물량을 첫날 판 경우의 대략적인 수익률이에요.</li>"
            "<li><b>스팩</b>: 기업 인수를 목적으로 만든 회사라 보통 공모가 근처에서 움직여요.</li></ul>")
    cta = (f'<p>📢 공모주 청약 일정과 상장 결과를 텔레그램으로 바로 받아 보세요: <a href="{CHANNEL_URL}">{CHANNEL_URL}</a></p>'
           f'<p style="color:#777;font-size:13px">※ 투자 권유가 아니에요. 수수료·세금은 반영하지 않았어요. '
           f'자료 출처: 38커뮤니케이션, 마지막 업데이트 {today.year}년 {today.month}월 {today.day}일</p>')
    return title, summary + table + tips + cta


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"posted": [], "months": {}}


def main():
    now = datetime.now(ipo.KST)
    if os.environ.get("NOW_KST"):
        now = datetime.fromisoformat(os.environ["NOW_KST"]).replace(tzinfo=ipo.KST)
    today = now.date()
    rows = fetch()
    state = load_state()
    posted = state.setdefault("posted", []); months = state.setdefault("months", {})
    first = not posted and not months
    tg_ok = (ipo.BOT and ipo.CHANNEL) and not DRY

    def send(key, text):
        if key in posted:
            return
        if first and not key.startswith("today:"):      # 첫 실행은 지난 결과를 한꺼번에 올리지 않고 기록만
            posted.append(key); return
        if not tg_ok:
            print("----- (보내지 않음) -----\n" + text + "\n"); posted.append(key); return
        if ipo.send(text):
            posted.append(key); print("올림:", key)

    # 1) 아침: 오늘 상장
    if 7 <= now.hour < 11:
        todays = [r for r in rows if r["date"] == today.isoformat()]
        if todays:
            send(f"today:{today}", tg_today(todays))
    # 2) 오후(15:40 이후): 첫날 결과 (최근 5일 안에 상장한 종목)
    if now.hour * 60 + now.minute >= 15 * 60 + 40:
        for r in rows:
            d = date.fromisoformat(r["date"])
            if r["close1"] is not None and r["offer"] and 0 <= (today - d).days <= 5:
                send(f"result:{r['name']}:{r['date']}", tg_result(r))

    # 3) 블로그 월간 정리 (이번 달 + 지난달 마무리)
    import blog_post as bp
    blog_ok = all((bp.CLIENT_ID, bp.CLIENT_SECRET, bp.BLOG_ID, bp.REFRESH)) and not DRY
    tok = bp.access_token() if blog_ok else None
    targets = {(today.year, today.month)}
    prev = (today.replace(day=1) - timedelta(days=1))
    if today.day <= 5:
        targets.add((prev.year, prev.month))
    for y, m in sorted(targets):
        p = month_post(rows, y, m, today)
        if not p:
            continue
        key = f"{y}-{m:02d}"; title, body = p
        sig = hashlib.md5(body.split("마지막 업데이트")[0].encode()).hexdigest()
        rec = months.get(key)
        if rec and rec.get("sig") == sig:
            continue
        if not blog_ok:
            print(f"[블로그 {'고침' if rec else '새 글'}] {title}\n{body[:800]}\n")
            months[key] = {"id": "dry", "sig": sig}; continue
        if rec and rec.get("id") not in (None, "dry"):
            bp.api("PATCH", f"/blogs/{bp.BLOG_ID}/posts/{rec['id']}", tok, json={"title": title, "content": body})
            rec["sig"] = sig; print("블로그 고침:", title)
        else:
            res = bp.api("POST", f"/blogs/{bp.BLOG_ID}/posts/", tok,
                         json={"title": title, "content": body, "labels": ["공모주", "상장 첫날", "공모주 수익률"]})
            months[key] = {"id": res["id"], "url": res.get("url"), "sig": sig}; print("블로그 새 글:", res.get("url"))

    state["posted"] = posted[-400:]
    state["months"] = dict(sorted(months.items())[-24:])
    if not DRY or os.environ.get("SAVE_STATE"):
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
    print(f"[{now:%Y-%m-%d %H:%M} KST] 신규상장 {len(rows)}개 확인")


if __name__ == "__main__":
    main()

# ---- 파일 끝 ----
