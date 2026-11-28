import sys
sys.path.insert(0, ".")
import ipo_channel as ipo
s = ipo._session()
for o in ("nw",):
    url = f"https://www.38.co.kr/html/fund/index.htm?o={o}"
    for u in (url, url.replace("https://", "http://")):
        try:
            r = s.get(u, timeout=20, headers={"User-Agent": "Mozilla/5.0"}); r.raise_for_status(); break
        except Exception as e:
            print("fail", u, repr(e)[:200])
    page = r.content.decode("cp949", errors="replace")
    p = ipo._Rows(); p.feed(page)
    rows = [c for c, l in p.rows if len(c) >= 6]
    for c in rows[:25]:
        print(" | ".join(c))
