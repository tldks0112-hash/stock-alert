# US IPO & earnings calendar posts → English Blogger blog (automatic)
# Data: Finnhub free API (https://finnhub.io) — IPO calendar + earnings calendar
#
# Daily run:
#   - Monday (or WEEKLY=1): "US IPO Calendar This Week" + "Biggest Earnings This Week" roundups
#   - Every day: one post per upcoming IPO (max EN_MAX_NEW per run); updates a post when price/status changes
# State: en_blog_state.json
#
# Secrets: FINNHUB_API_KEY, BLOGGER_BLOG_ID_EN, plus the Blogger OAuth secrets used by blog_post.py
# Test: DRY_RUN=1 python en_blog.py

import html
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

import blog_post as bp

FINNHUB = os.environ.get("FINNHUB_API_KEY", "").strip()
BLOG_ID = os.environ.get("BLOGGER_BLOG_ID_EN", "").strip()
DRY = os.environ.get("DRY_RUN", "") not in ("", "0", "false")
WEEKLY = os.environ.get("WEEKLY", "") not in ("", "0", "false")
STATE_FILE = os.environ.get("EN_STATE_FILE", "en_blog_state.json")
MAX_NEW = int(os.environ.get("EN_MAX_NEW", "2") or 2)
ET = timezone(timedelta(hours=-5))
e = html.escape

DISCLAIMER = ('<p style="color:#777;font-size:13px">This post is for information only and is not investment advice. '
              'IPO dates, price ranges and share counts often change before pricing. Data: Finnhub. '
              'Last updated {d}.</p>')


# ---------------- data ----------------
def fh(path, **params):
    if os.environ.get("FIXTURE_DIR"):                       # offline tests
        with open(os.path.join(os.environ["FIXTURE_DIR"], path.strip("/").replace("/", "_") + ".json")) as f:
            return json.load(f)
    for i in range(3):
        r = requests.get("https://finnhub.io/api/v1" + path, params={**params, "token": FINNHUB}, timeout=30)
        if r.status_code == 429:
            time.sleep(20)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("Finnhub rate limit")


def ipos(start, end):
    rows = fh("/calendar/ipo", **{"from": start.isoformat(), "to": end.isoformat()}).get("ipoCalendar") or []
    out = []
    for r in rows:
        if not r.get("name") or not r.get("date"):
            continue
        out.append({"symbol": (r.get("symbol") or "").strip(), "name": r["name"].strip(), "date": r["date"],
                    "exchange": (r.get("exchange") or "").strip(), "price": (r.get("price") or "").strip(),
                    "shares": r.get("numberOfShares") or 0, "value": r.get("totalSharesValue") or 0,
                    "status": (r.get("status") or "").strip()})
    return out


def earnings(start, end, top=25):
    rows = fh("/calendar/earnings", **{"from": start.isoformat(), "to": end.isoformat()}).get("earningsCalendar") or []
    rows = [r for r in rows if r.get("symbol") and (r.get("revenueEstimate") or 0) > 0]
    rows.sort(key=lambda r: r.get("revenueEstimate") or 0, reverse=True)
    return sorted(rows[:top], key=lambda r: (r["date"], {"bmo": 0, "dmh": 1, "amc": 2}.get(r.get("hour"), 3)))


# ---------------- text helpers ----------------
def money(v):
    v = float(v or 0)
    if v >= 1e9:
        return f"${v / 1e9:.2f} billion"
    if v >= 1e6:
        return f"${v / 1e6:.1f} million"
    return f"${v:,.0f}" if v else "n/a"


def nice_date(d):
    d = date.fromisoformat(d) if isinstance(d, str) else d
    return d.strftime("%A, %B ") + str(d.day) + d.strftime(", %Y")


def short_date(d):
    d = date.fromisoformat(d) if isinstance(d, str) else d
    return d.strftime("%b ") + str(d.day)


def price_range(p):
    nums = [float(x) for x in p.replace("$", "").split("-") if x.strip().replace(".", "", 1).isdigit()]
    return nums


def label(it):
    return f"{it['name']} ({it['symbol']})" if it["symbol"] else it["name"]


STATUS = {"expected": "expected to price", "priced": "priced", "filed": "filed (date not final)", "withdrawn": "withdrawn"}


def table(rows):
    th = "".join(f'<th style="text-align:left;padding:6px 8px;background:#f3f5f8">{h}</th>' for h in rows[0])
    body = "".join("<tr>" + "".join(f'<td style="padding:6px 8px;border-top:1px solid #e4e8ee">{c}</td>' for c in r) + "</tr>"
                   for r in rows[1:])
    return f'<table style="border-collapse:collapse;width:100%;border:1px solid #dde2e8;font-size:14px"><tr>{th}</tr>{body}</table>'


# ---------------- posts ----------------
def ipo_post(it, today):
    nums = price_range(it["price"])
    mid = sum(nums) / len(nums) if nums else 0
    raise_est = (it["value"] or (mid * it["shares"] if mid and it["shares"] else 0))
    title = f"{label(it)} IPO: Date, Price Range and Deal Size ({short_date(it['date'])})"
    status = STATUS.get(it["status"], it["status"] or "scheduled")
    d = date.fromisoformat(it["date"])
    when = ("is scheduled" if d >= today else "was scheduled")
    rows = [["Item", "Details"],
            ["Company", e(it["name"])], ["Ticker", e(it["symbol"] or "TBA")], ["Exchange", e(it["exchange"] or "TBA")],
            ["Expected date", nice_date(it["date"])], ["Status", e(status)],
            ["Price range", f"${e(it['price'])}" if it["price"] else "TBA"],
            ["Shares offered", f"{int(it['shares']):,}" if it["shares"] else "TBA"],
            ["Estimated deal size", money(raise_est) if raise_est else "TBA"]]
    parts = [f"<p>{e(label(it))} {when} to go public on {e(it['exchange'] or 'a US exchange')} on {nice_date(it['date'])}. "
             f"Here is a quick summary of the offering and what to watch before it starts trading.</p>",
             table(rows)]
    if len(nums) == 2 and it["shares"]:
        lo, hi = nums
        parts.append("<h3>What the numbers mean</h3>"
                     f"<p>At the low end of the range (${lo:,.2f}) the company would raise about {money(lo * it['shares'])}; "
                     f"at the top (${hi:,.2f}) about {money(hi * it['shares'])}. "
                     f"Pricing above the range usually signals strong demand, while pricing below it or cutting the share count "
                     f"often means investors pushed back.</p>")
    parts.append("<h3>What to watch</h3><ul>"
                 "<li><b>Final pricing</b>: IPOs usually price the evening before the first trade.</li>"
                 "<li><b>Lock-up period</b>: insiders typically cannot sell for 90–180 days, and the lock-up expiry can move the stock.</li>"
                 "<li><b>Float</b>: a small float can make the first days very volatile.</li>"
                 "<li><b>The S-1 filing</b>: revenue growth, losses and use of proceeds are in the prospectus on "
                 f'<a href="https://www.sec.gov/cgi-bin/browse-edgar?company={e(it["name"].split(",")[0])}&type=S-1&action=getcompany">SEC EDGAR</a>.</li>'
                 "</ul>")
    parts.append(DISCLAIMER.format(d=nice_date(today)))
    return title, "\n".join(parts), ["IPO", "IPO Calendar", it["symbol"] or it["name"]]


def weekly_ipo_post(items, mon):
    fri = mon + timedelta(days=4)
    title = f"US IPO Calendar This Week: {short_date(mon)}–{short_date(fri)}, {fri.year}"
    week = sorted((it for it in items if mon <= date.fromisoformat(it["date"]) <= fri and it["status"] != "withdrawn"),
                  key=lambda x: (x["date"], -(x["value"] or 0)))
    if not week:
        body = f"<p>No US IPOs are currently scheduled for the week of {nice_date(mon)}. Check back as new deals are often added late.</p>"
    else:
        total = sum(it["value"] or 0 for it in week)
        big = max(week, key=lambda x: x["value"] or 0)
        rows = [["Date", "Company", "Ticker", "Exchange", "Price range", "Deal size"]]
        for it in week:
            rows.append([short_date(it["date"]), e(it["name"]), e(it["symbol"] or "TBA"), e(it["exchange"] or "TBA"),
                         f"${e(it['price'])}" if it["price"] else "TBA", money(it["value"]) if it["value"] else "TBA"])
        body = (f"<p>{len(week)} IPO{'s are' if len(week) > 1 else ' is'} scheduled in the US this week"
                + (f", aiming to raise about {money(total)} in total" if total else "")
                + (f". The largest is {e(label(big))} at roughly {money(big['value'])}." if big.get("value") else ".")
                + "</p>" + table(rows))
    body += DISCLAIMER.format(d=nice_date(mon))
    return title, body, ["IPO Calendar", "Weekly"]


def weekly_earnings_post(rows, mon):
    fri = mon + timedelta(days=4)
    title = f"Biggest Earnings This Week: {short_date(mon)}–{short_date(fri)}, {fri.year}"
    if not rows:
        return None
    t = [["Date", "Ticker", "Time", "EPS estimate", "Revenue estimate"]]
    hour = {"bmo": "Before open", "amc": "After close", "dmh": "During market"}
    for r in rows:
        eps = r.get("epsEstimate")
        t.append([short_date(r["date"]), f"<b>{e(r['symbol'])}</b>", hour.get(r.get("hour"), "TBA"),
                  f"${eps:,.2f}" if isinstance(eps, (int, float)) else "n/a", money(r.get("revenueEstimate"))])
    body = (f"<p>These are the {len(rows)} largest US companies (by expected quarterly revenue) reporting earnings this week. "
            "Times are US Eastern; 'Before open' means before 9:30 AM, 'After close' after 4:00 PM.</p>" + table(t)
            + "<p>Big moves after earnings usually come from guidance rather than the headline numbers, so read the outlook section of each release.</p>"
            + DISCLAIMER.format(d=nice_date(mon)))
    return title, body, ["Earnings Calendar", "Weekly"]


# ---------------- run ----------------
def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"posts": {}, "weekly": []}


def publish(tok, title, body, labels, post_id=None):
    if DRY:
        print(("[UPDATE] " if post_id else "[NEW] ") + title + "\n" + body[:1200] + "\n")
        return {"id": post_id or "dry", "url": "dry"}
    if post_id:
        return bp.api("PATCH", f"/blogs/{BLOG_ID}/posts/{post_id}", tok, json={"title": title, "content": body})
    return bp.api("POST", f"/blogs/{BLOG_ID}/posts/", tok, json={"title": title, "content": body, "labels": labels})


def main():
    global DRY
    if not FINNHUB and not os.environ.get("FIXTURE_DIR"):
        print("FINNHUB_API_KEY 가 아직 없어서 건너뛰어요.")
        return
    if not DRY and not (BLOG_ID and bp.REFRESH):
        print("영어 블로그 비밀값이 아직 없어서 글은 화면에만 보여 줄게요.")
        DRY = True
    today = datetime.now(ET).date()
    if os.environ.get("TODAY"):
        today = date.fromisoformat(os.environ["TODAY"])
    state = load_state()
    posts, weekly = state.setdefault("posts", {}), state.setdefault("weekly", [])
    tok = None if DRY else bp.access_token()
    items = ipos(today - timedelta(days=3), today + timedelta(days=30))

    # 1) weekly roundups (Monday)
    mon = today - timedelta(days=today.weekday())
    if (today.weekday() == 0 or WEEKLY) and f"ipo:{mon}" not in weekly:
        t, b, l = weekly_ipo_post(items, mon)
        publish(tok, t, b, l); weekly.append(f"ipo:{mon}"); print("weekly ipo:", t)
        time.sleep(3)
    if (today.weekday() == 0 or WEEKLY) and f"earn:{mon}" not in weekly:
        p = weekly_earnings_post(earnings(mon, mon + timedelta(days=4)), mon)
        if p:
            publish(tok, *p); print("weekly earnings:", p[0])
        weekly.append(f"earn:{mon}")
        time.sleep(3)

    # 2) per-IPO posts: update changed, add new
    for it in items:
        key = it["symbol"] or it["name"]
        rec = posts.get(key)
        sig = [it["date"], it["price"], it["shares"], it["status"]]
        if rec and rec.get("sig") != sig:
            t, b, _ = ipo_post(it, today)
            publish(tok, t, b, None, post_id=rec["id"]); rec["sig"] = sig; print("updated:", key)
            time.sleep(2)
    todo = [it for it in sorted(items, key=lambda x: (x["date"], -(x["value"] or 0)))
            if (it["symbol"] or it["name"]) not in posts and it["status"] in ("expected", "priced", "")
            and date.fromisoformat(it["date"]) >= today][:MAX_NEW]
    for it in todo:
        t, b, l = ipo_post(it, today)
        p = publish(tok, t, b, l)
        posts[it["symbol"] or it["name"]] = {"id": p["id"], "url": p.get("url"), "date": it["date"],
                                             "sig": [it["date"], it["price"], it["shares"], it["status"]]}
        print("new:", t, p.get("url"))
        time.sleep(5)

    print(f"[{today}] IPOs in window {len(items)}, posts tracked {len(posts)}")
    if not DRY:
        keep = (today - timedelta(days=90)).isoformat()
        state["posts"] = {k: v for k, v in posts.items() if v.get("date", "9") >= keep}
        state["weekly"] = weekly[-30:]
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()

# ---- end of file ----
