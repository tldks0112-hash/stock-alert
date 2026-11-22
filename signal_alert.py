# 매일 아침 카카오톡으로 매매 신호 보내기
# GitHub Actions가 매일 자동으로 실행해요. 매매는 신호를 보고 토스증권 앱에서 직접 하면 돼요.
#
#   python signal_alert.py            → 신호 계산 + 카톡 보내기 (자동 실행이 쓰는 모드)
#   python signal_alert.py preview    → 카톡 없이 화면에만 출력 (확인용)
#   python signal_alert.py connect 코드 → 처음 한 번 카카오 연결 ('카카오 연결' 실행이 씀)

import json
import os
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
import yfinance as yf

# ======================= 설정 (GitHub에서 이 부분만 고치면 돼요) =======================

TICKERS = ["AAPL", "MSFT", "NVDA", "AMZN", "SPY"]   # 신호를 받을 종목
BUDGET_PER_STOCK_USD = 300      # 종목당 살 금액 → 몇 주 살지 계산해서 알려줌
RULE = dict(ma_s=20, ma_l=50, rsi_buy=70, rsi_sell=80, trend=True, sl=0.07)   # 5단계에서 정한 규칙
ONLY_WHEN_SIGNAL = False        # True면 매수/매도 신호가 있는 날만 카톡을 보냄
LINK_URL = "https://tossinvest.com"   # 카톡 버튼을 누르면 열리는 주소

# ======================= 여기부터는 고칠 필요 없어요 =======================

REST_KEY = os.environ.get("KAKAO_REST_KEY", "").strip()
REDIRECT_URI = "https://localhost"
KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"
KAKAO_SEND_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send"
KST = ZoneInfo("Asia/Seoul")


# ---------- 신호 계산 (5단계와 같은 규칙) ----------

def make_signals(df, p):
    df = df.copy()
    close = df["Close"]
    df["MA_S"] = close.rolling(p["ma_s"]).mean()
    df["MA_L"] = close.rolling(p["ma_l"]).mean()
    df["MA200"] = close.rolling(200).mean()
    change = close.diff()
    gain = change.clip(lower=0).rolling(14).mean()
    loss = (-change.clip(upper=0)).rolling(14).mean()
    df["RSI"] = 100 - 100 / (1 + gain / loss)
    above = df["MA_S"] > df["MA_L"]
    cross_up = above & ~above.shift(1, fill_value=False)
    cross_down = ~above & above.shift(1, fill_value=False)
    buy = cross_up & (df["RSI"] < p["rsi_buy"])
    if p["trend"]:
        buy = buy & (close > df["MA200"])
    df["buy"] = buy
    df["sell"] = cross_down | (df["RSI"] > p["rsi_sell"])
    return df


def get_signal(ticker):
    df = None
    for attempt in range(3):            # 데이터 서버가 잠깐 막히면 조금 쉬었다 재시도
        try:
            df = yf.Ticker(ticker).history(period="2y")
            if df is not None and not df.empty:
                break
        except Exception:
            pass
        time.sleep(5 * (attempt + 1))
    if df is None or df.empty or len(df) < 210:
        return None
    last = make_signals(df, RULE).iloc[-1]
    return {"date": df.index[-1].strftime("%m/%d"), "close": float(last["Close"]),
            "rsi": float(last["RSI"]), "buy": bool(last["buy"]), "sell": bool(last["sell"])}


def build_lines():
    buys, sells, waits, errors, base_date = [], [], [], [], "?"
    for t in TICKERS:
        s = get_signal(t)
        if s is None:
            errors.append(t)
            continue
        base_date = s["date"]
        if s["buy"]:
            stop = s["close"] * (1 - RULE["sl"])
            qty = int(BUDGET_PER_STOCK_USD // s["close"])
            how = f"{qty}주" if qty >= 1 else f"${BUDGET_PER_STOCK_USD}어치 소수점"
            buys.append(f"🔴 {t} 매수 ${s['close']:.2f} · {how}\n   손절가 ${stop:.2f}")
        elif s["sell"]:
            sells.append(f"🔵 {t} 매도 ${s['close']:.2f} (보유 중이면)")
        else:
            waits.append(t)

    lines = [f"📈 매매 신호 {datetime.now(KST):%m/%d} (미국 {base_date} 종가)"]
    lines += buys + sells
    if waits:
        lines.append("⚪ 관망: " + ", ".join(waits))
    if errors:
        lines.append("❗ 데이터 오류: " + ", ".join(errors))
    if buys:
        lines.append("👉 토스 앱에서 매수 후 손절가로 조건주문(손절)을 걸어 주세요.")
    return lines, bool(buys or sells)


def chunk(lines, limit=190):
    """카톡 기본 메시지는 200자까지라서, 길면 여러 개로 나눔"""
    msgs, cur = [], ""
    for ln in lines:
        joined = f"{cur}\n{ln}" if cur else ln
        if len(joined) <= limit:
            cur = joined
        else:
            if cur:
                msgs.append(cur)
            cur = ln[:limit]
    if cur:
        msgs.append(cur)
    return msgs


# ---------- 카카오톡 ----------

def kakao_token_request(data):
    secret = os.environ.get("KAKAO_CLIENT_SECRET", "").strip()
    if secret:
        data["client_secret"] = secret
    j = requests.post(KAKAO_TOKEN_URL, data=data, timeout=10).json()
    if "access_token" not in j:
        raise RuntimeError(f"카카오 토큰 오류: {j.get('error_description') or j.get('error') or j}")
    return j


def keep_new_refresh_token(token):
    """카카오가 새 리프레시 토큰을 주면(한 달에 한 번 정도) 파일에 적어 두고,
    다음 단계에서 GitHub 비밀값으로 저장함. 토큰 값은 화면에 절대 출력하지 않음."""
    path = os.environ.get("NEW_REFRESH_TOKEN_FILE")
    if not path:
        print("⚠️ 새 카카오 토큰을 받았지만 저장할 곳이 지정되지 않았어요.")
        return
    with open(path, "w") as f:
        f.write(token)
    print("새 카카오 토큰을 받았어요 → 다음 단계에서 저장합니다.")


def get_access_token():
    refresh = os.environ.get("KAKAO_REFRESH_TOKEN", "").strip()
    if not refresh:
        raise RuntimeError("카카오 연결이 아직 안 됐어요. Actions에서 '카카오 연결'을 먼저 실행해 주세요.")
    j = kakao_token_request({"grant_type": "refresh_token", "client_id": REST_KEY, "refresh_token": refresh})
    if j.get("refresh_token"):
        keep_new_refresh_token(j["refresh_token"])
    return j["access_token"]


def send_kakao(access_token, text):
    template = {"object_type": "text", "text": text,
                "link": {"web_url": LINK_URL, "mobile_web_url": LINK_URL},
                "button_title": "토스증권 열기"}
    r = requests.post(KAKAO_SEND_URL, timeout=10,
                      headers={"Authorization": f"Bearer {access_token}"},
                      data={"template_object": json.dumps(template, ensure_ascii=False)})
    ok = r.status_code == 200 and r.json().get("result_code") == 0
    if not ok:
        raise RuntimeError(f"카톡 보내기 실패 {r.status_code}: {r.text[:300]}")


def connect(code_or_url):
    code = code_or_url.strip()
    if "code=" in code:                      # 주소 전체를 붙여 넣어도 code만 뽑아냄
        code = code.split("code=", 1)[1].split("&", 1)[0]
    j = kakao_token_request({"grant_type": "authorization_code", "client_id": REST_KEY,
                             "redirect_uri": REDIRECT_URI, "code": code})
    if "talk_message" not in j.get("scope", "talk_message"):
        print("⚠️ '카카오톡 메시지 전송' 동의가 빠졌어요. 카카오 동의항목 설정을 확인하세요.")
    # 카카오 연결이 '가입 미완료'로 끊기지 않게 내 정보 한 번 조회
    requests.get("https://kapi.kakao.com/v2/user/me", timeout=10,
                 headers={"Authorization": f"Bearer {j['access_token']}"})
    keep_new_refresh_token(j["refresh_token"])
    send_kakao(j["access_token"], "✅ 매매 신호 알림이 연결됐어요!\n평일 아침 7시 반쯤 신호를 보내 드릴게요.")
    print("카카오 연결 성공! 카톡을 확인해 보세요.")


# ---------- 실행 ----------

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "send"
    if mode != "preview" and not REST_KEY:
        sys.exit("❗ GitHub 비밀값 KAKAO_REST_KEY가 없어요. 설정 방법을 다시 확인해 주세요.")

    if mode == "connect":
        if len(sys.argv) < 3:
            sys.exit("❗ 카카오 코드가 비어 있어요.")
        connect(sys.argv[2])
        return

    lines, has_signal = build_lines()
    print("\n".join(lines))
    if mode == "preview":
        return
    if ONLY_WHEN_SIGNAL and not has_signal:
        print("오늘은 매수/매도 신호가 없어서 카톡을 보내지 않았어요.")
        return
    token = get_access_token()
    for msg in chunk(lines):
        send_kakao(token, msg)
        time.sleep(1)
    print("카톡 전송 완료")


if __name__ == "__main__":
    main()
