# 실시간 타점 알림 — 미국 주식 · 국내 주식 · 코인
# GitHub Actions가 장중엔 15분마다, 그 밖의 시간(코인)엔 30분마다 실행해요.
#
# 하는 일
#  1) 일봉 · 1시간봉 · 1분봉 세 가지 시간대를 같이 봐요.
#  2) 추세 · 모멘텀 · 변동성 · 거래량 · 지지/저항 다섯 분류의 지표로 '안전도 10점'을 매겨요.
#  3) 지지선·저항선이 여러 개 겹치는 가격을 찾아서 안전 매수가 / 손절가 / 안전 매도가를 알려줘요.
#  4) 남들(다른 자동매매)이 흔드는 가짜 돌파에 덜 걸리도록
#     - 돌파 후 3분 동안 유지될 때만 인정하고
#     - 장 시작 직후·마감 직전의 출렁임은 건너뛰고
#     - 손절가는 지지선 바로 밑이 아니라 변동폭(ATR)만큼 여유를 두고 잡아요.
#  5) 손실 방지 장치 (기본은 전부 켬, 비밀값의 "손실_방지"로 끄고 켤 수 있어요)
#     - 시장 필터: 시장 전체(S&P500·KODEX200·비트코인)가 200일선 아래면 매수 알림 안 함
#     - 추세 필수: 그 종목이 200일선 위 + 50일선이 200일선 위일 때만 매수
#     - 눌림 매수: 오르는 종목이 최근 20일선까지 쉬었다가 다시 오를 때만 매수 (이미 많이 오른 뒤엔 X)
#     - 반 매도: 안전 매도가에서 절반 팔고, 나머지는 손절가를 매수가로 올려 큰 상승을 따라감
#     - 하루 한번: 같은 종목 매수 알림은 하루 한 번만
#     - 변동성 필터: 종목이 평소보다 심하게 출렁일 때(1년 중 상위 20%)는 매수 알림 안 함
#     - 성적표: 과거 그 종목의 알림대로 (같은 파는 방법으로) 거래했을 때 평균 수익이 나고(+0.3% 이상)
#               번 돈이 잃은 돈의 1.2배 이상이었던 종목만 매수 알림. 손실 났던 종목은 추천도 안 함
#               (종목 기록이 6번 미만이면 같은 시장 전체 기록으로 판단, 하루 한 번 자동 갱신)
#     - 실적 피하기: 미장 개별주는 실적 발표 10일 전부터 매수 알림 안 함 (발표 다음 날 갭으로 손절이 소용없어서)
#     - 자동 멈춤: 보낸 매수 알림을 실제로 샀다고 치고 1분봉으로 계속 따라가서(점검 작업과 같은 규칙),
#                 3번 연속 손실이면 그 시장 매수 알림을 5일 쉬고 카톡으로 알려줌. 월요일 아침엔 지난주 실전 성적
#  6) 손절 금액 고정: 손절가에 걸려도 정한 금액(기본: 종목 예산의 3%) 이상 안 잃도록 수량을 계산해서 알려줘요.
#  7) 안전 점검 등급: 위 장치(시장·추세·눌림·변동성·실적·성적표)는 매수를 막지 않고 등급으로 붙여요.
#     전부 통과 🟢높음 · 1~2개 부족 🟡보통 · 3개 이상 부족 🟠낮음. 🟢 알림이 3번 연속 손실이면 5일간 🟢→🟡.
#     비밀값 "안정성_최소": "보통" 처럼 정하면 그보다 낮은 등급은 안 보내요. (막는 건 안전도 기준·하루 한 번·손절 한도만)

import hashlib
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yfinance as yf

import app_bridge
import holdings
import market_ctx as mc
try:
    import signal_stats
except ImportError:                               # 파일을 아직 안 올렸으면 건너뜀
    signal_stats = None
import news_fut
try:                                   # 가격 알림 파일을 아직 안 올렸어도 엔진은 그대로 돌게
    import price_watch
except ImportError:
    price_watch = None
try:                                   # 의견 답글 메일 (파일이 없어도 엔진은 그대로)
    import mailer
except ImportError:
    mailer = None
try:                                   # 월가 픽 (미국 기관 13F 공시)
    import wallst
except ImportError:
    wallst = None
import signal_alert as base     # 카톡 보내기 기능을 같이 씀

# ======================= 설정 =======================
# 종목·카테고리·금액·기준은 코드에 적지 않고 GitHub 비밀값 ALERT_SETTINGS(JSON)에서 읽어요.
# 저장소를 공개해도 남들은 무엇을, 얼마로, 어떤 기준으로 보는지 알 수 없어요.

S = base.SETTINGS
KR_STOCKS = S.get("국장", {})      # 카테고리 → {종목코드: 이름}
US_STOCKS = S.get("미장", {})
COINS = S.get("코인", {})

BUDGET_USD = S.get("종목당_달러", 100)
BUDGET_KRW = S.get("종목당_원", 100_000)
MAX_LOSS_USD = float(S.get("손절_최대손실_달러", round(BUDGET_USD * 0.03, 2)))        # 손절 한 번에 최대 손실
MAX_LOSS_KRW = float(S.get("손절_최대손실_원", max(1000, round(BUDGET_KRW * 0.03, -3))))
_SCORE = S.get("안전도_기준", 8)             # 숫자 하나, 또는 {"국장": 8, "미장": 9, "코인": 8}
MIN_SCORE = _SCORE if isinstance(_SCORE, int) else 8     # 안전도 10점 중 몇 점 이상일 때만 알림
CONFIRM_MIN = S.get("유지_확인_분", 3)        # 돌파 후 몇 분 유지돼야 인정할지
MIN_RR = S.get("최소_손익비", 2.0)
STOP_ATR = S.get("손절_여유_ATR", 0.5)
COOLDOWN_MIN = S.get("같은_알림_간격_분", 120)
SELL_AGAIN_DROP = float(S.get("매도_재알림_추가하락", 3.0))   # 같은 날 같은 종목 매도 알림은 한 번 · 이만큼(%) 더 내리면 한 번 더
LOOKBACK_MIN = 20
VERBOSE = os.environ.get("VERBOSE") == "1"    # 1이면 종목별 자세한 기록 (공개 저장소에선 끄세요)

# ======================= 여기부터는 고칠 필요 없어요 =======================

NY = ZoneInfo("America/New_York")
KST = ZoneInfo("Asia/Seoul")
MARKETS = {"kr": KR_STOCKS, "us": US_STOCKS, "crypto": COINS}          # 카톡도 이 순서로 와요
MARKET_NAME = {"kr": "🇰🇷 국장", "us": "🇺🇸 미장", "crypto": "🪙 코인"}
SELL_ALL = bool(S.get("매도_전부", False))   # 카톡 매도 알림: 기본은 최근 7일 매수 알림·실전 보유 종목만
SELL_LINK_DAYS = 7
BRIEF = S.get("아침_브리핑", True)            # 매일 아침 8시쯤(일요일 빼고) 카톡 한 통 + 앱 첫 화면 카드
KAKAO_SHORT = S.get("카톡_짧게", True)        # True: 카톡은 한 줄 요약만, 자세한 기준가는 앱에서 / False: 예전처럼 종목별 자세히
APP_URL = "https://tldks0112-hash.github.io/stock-alert/"
KAKAO_PRESET = str(S.get("카톡_조건", "추천"))   # 카톡도 앱의 추천 설정대로 ("안정"/"기회"도 가능, "기존"이면 예전 방식)
KAKAO_RULES = None                              # 실행할 때 앱 서버에서 그 설정의 시장별 조건을 받아 옴
KAKAO_HOLD_ONLY = bool(S.get("카톡_보유만", True))  # True: 카톡은 내가 앱 '보유'에 넣은 종목 알림만 (아침 브리핑·주간 보고도 카톡엔 안 보냄)
MY_HOLD = None                                  # 실행할 때 앱 서버에서 받아 옴: {시장: {종목: 이름}} (개발자 화면에서 정한 계정 하나)
KAKAO_ONLY = set()                              # 감시 목록에 없고 내 보유에만 있는 종목 → 카톡만 (앱 피드엔 안 올림)
CHART_SET = set()                               # 최근 3일 안에 앱 알림이 나온 종목 → 타점 상세 화면 차트(분·시·일·월)를 저장
RECENT = []                                      # 최근 3일 앱 알림 (알림 뒤 최고·최저·지금 계산용)
CANCELS = []                                     # 이번 실행에서 '돌파 실패 → 매수 신호 취소'된 알림
APP_FLOOR = 5          # 앱에는 신호 점수 5점 이상 후보를 모두 저장 → 사용자가 앱 설정(지표 켜고 끄기)으로 골라 받음
TZ = {"us": NY, "kr": KST, "crypto": timezone.utc}
MARKET_KO = {"kr": "국장", "us": "미장", "crypto": "코인"}
INDEX = {"kr": "069500.KS", "us": "SPY", "crypto": "BTC-KRW"}           # 시장 필터에 쓰는 대표 지수
GUARD_DEFAULT = {"시장_필터": True, "추세_필수": True, "눌림_매수": True, "변동성_필터": True,
                 "실적_피하기": True, "반_매도": True, "하루_한번": True, "성적표": True, "자동_멈춤": True}
# 2026-11-28 추가 장치 (성적표를 다시 만들지 않게 따로 둠): 가짜 돌파 취소 · 경제 일정 전 쉬기 · 국장 수급 · 레버리지 ETF 전용 기준
GUARD_EXTRA = {"가짜_돌파": True, "일정_피하기": True, "수급_확인": True, "레버_관리": True}
REBOUND_ATR = 1.5                                                       # 매도 알림: 반등해도 ATR 1.5배 안쪽 저항까지만
TRAIL_ATR = 2.0                                                         # 반 매도 후 나머지: 고점에서 ATR 2배 빠지면 매도
STATE_DIR = ".alert_state"
STATE_FILE = os.path.join(STATE_DIR, "sent.json")
CARD_FILE = os.path.join(STATE_DIR, "card.json")
CARD_MIN_T, CARD_MIN_M = 6, 15        # 성적표: 종목 기록 최소 6번, 모자라면 시장 전체 기록 최소 15번
CARD_AVG, CARD_PF = 0.3, 1.2          # 평균 +0.3% 이상 · 번 돈이 잃은 돈의 1.2배 이상
CARD_HOURS = 20                       # 성적표를 몇 시간마다 새로 만들지
EARN_DAYS = 10                        # 실적 발표 며칠 전부터 매수 알림을 쉴지
TRADES_FILE = os.path.join(STATE_DIR, "trades.json")
PAUSE_LOSSES, PAUSE_DAYS = 3, 5       # 실전 알림이 3번 연속 손실이면 그 시장 매수 알림 5일 쉼
FILL_BARS_H, HOLD_DAYS, RUN_DAYS = 16, 14, 60   # 매수가 기다리는 시간(1시간봉 16개) · 1차 보유 14일 · 나머지 최대 60일
FEE = 0.002                           # 사고팔 때 수수료·세금 합계
GRADE_ICON = {"높음": "🟢", "보통": "🟡", "낮음": "🟠"}
GRADE_RANK = {"낮음": 0, "보통": 1, "높음": 2}
MIN_GRADE = S.get("안정성_최소", "낮음") if S.get("안정성_최소") in GRADE_RANK else "낮음"
STAB_KEYS = [("시장", "시장_필터"), ("추세", "추세_필수"), ("눌림", "눌림_매수"), ("변동성", "변동성_필터"),
             ("실적", "실적_피하기")]
STAB_SHORT = {"시장": "시장약세", "추세": "추세약세", "눌림": "이미오름", "변동성": "변동큼", "실적": "실적임박"}


def log(msg):
    if VERBOSE:
        print(msg)


def min_score(market):
    if isinstance(_SCORE, dict):
        return int(_SCORE.get(MARKET_KO[market], 8))
    return int(_SCORE)


def guard_on(market, name):
    """손실 방지 장치가 켜져 있는지. {"손실_방지": {"눌림_매수": false}} 또는 시장별 {"미장": {...}}"""
    g = S.get("손실_방지", {})
    if isinstance(g.get(MARKET_KO[market]), dict):
        g = {**g, **g[MARKET_KO[market]]}
    return bool(g.get(name, GUARD_DEFAULT.get(name, GUARD_EXTRA.get(name, True))))


# ---------- 시장 시간 ----------

def _hm(ts, market):
    t = ts.astimezone(TZ[market])
    return t.weekday(), t.hour * 60 + t.minute


# 휴장일 — 미장: NYSE 공식 발표(2026·2027) / 국장: 2026년 남은 휴장일 + 2027년 관공서 공휴일 기준(거래소 공식 발표 전)
HOLIDAYS = {
    "us": {"2026-11-26": "추수감사절", "2026-12-25": "크리스마스",
           "2027-01-01": "새해", "2027-01-18": "마틴 루서 킹 데이", "2027-02-15": "대통령의 날", "2027-03-26": "성금요일",
           "2027-05-31": "메모리얼 데이", "2027-06-18": "준틴스", "2027-07-05": "독립기념일", "2027-09-06": "노동절",
           "2027-11-25": "추수감사절", "2027-12-24": "크리스마스"},
    "kr": {"2026-12-25": "성탄절", "2026-12-31": "연말 휴장",
           "2027-01-01": "신정", "2027-02-08": "설 연휴", "2027-02-09": "설 대체휴일", "2027-03-01": "삼일절",
           "2027-05-03": "노동절 대체휴일", "2027-05-05": "어린이날", "2027-05-13": "부처님오신날",
           "2027-07-19": "제헌절 대체휴일", "2027-08-16": "광복절 대체휴일", "2027-09-14": "추석 연휴",
           "2027-09-15": "추석", "2027-09-16": "추석 연휴", "2027-10-04": "개천절 대체휴일",
           "2027-10-11": "한글날 대체휴일", "2027-12-27": "성탄절 대체휴일", "2027-12-31": "연말 휴장"},
}
EARLY_CLOSE = {"us": {"2026-11-27": 780, "2026-12-24": 780, "2027-11-26": 780}}   # 오후 1시 조기 마감
NORMAL_HOURS = {"us": (570, 960), "kr": (540, 930)}


def session(market, ts):
    """그날 정규장 (시작 분, 마감 분) — 주말·휴장일이면 None"""
    t = ts.astimezone(TZ[market])
    day = t.date().isoformat()
    if t.weekday() >= 5 or day in HOLIDAYS.get(market, {}):
        return None
    start, close = NORMAL_HOURS[market]
    return start, EARLY_CLOSE.get(market, {}).get(day, close)


US_EXT = bool(S.get("미장_시간외", True))      # True: 미장 프리마켓·애프터마켓에도 타점 확인 (데이마켓은 무료 시세 자료가 없어서 못 봄)
SESS_KO = {"pre": "프리마켓", "after": "애프터마켓"}


def us_window(ts):
    """미장 거래 구간 → (이름, 시작 분, 끝 분) · 프리 04:00~09:30 · 정규 09:30~16:00 · 애프터 16:00~20:00 (미국 동부시간, 조기 마감일은 17:00까지)"""
    s = session("us", ts)
    if not s:
        return None
    o, c = s
    hm = _hm(ts, "us")[1]
    if o <= hm < c:
        return "reg", o, c
    if US_EXT and 240 <= hm < o:
        return "pre", 240, o
    end = 1200 if c >= 960 else 1020
    if US_EXT and c <= hm < end:
        return "after", c, end
    return None


def is_open(market, now):
    if market == "crypto":
        return True
    if market == "us":
        return us_window(now) is not None
    s = session(market, now)
    return bool(s) and s[0] <= _hm(now, market)[1] <= s[1]


def calm_time(market, ts):
    """장(구간) 시작 직후 15분, 마감 직전 10분(국장은 동시호가 포함 15분)은 출렁임이 커서 타점으로 안 씀"""
    if market == "crypto":
        return True
    if market == "us":
        w = us_window(ts)
        if not w:
            return False
        hm = _hm(ts, market)[1]
        return w[1] + 15 <= hm <= w[2] - 10
    s = session(market, ts)
    if not s:
        return False
    hm = _hm(ts, market)[1]
    return s[0] + 15 <= hm <= s[1] - 15


# ---------- 데이터 ----------

def fetch_many(tickers, period, interval, prepost=False):
    for attempt in range(3):
        try:
            with base.quiet():
                raw = yf.download(tickers, period=period, interval=interval, group_by="ticker",
                                  auto_adjust=True, progress=False, threads=True, prepost=prepost)
            break
        except Exception as e:
            log(f"데이터 받기 재시도 ({e})")
            time.sleep(5 * (attempt + 1))
    else:
        return {}
    out = {}
    for t in tickers:
        try:
            sub = raw[t] if isinstance(raw.columns, pd.MultiIndex) else raw
        except KeyError:
            continue
        sub = sub.dropna(subset=["Close"])
        if not sub.empty:
            out[t] = sub
    return out


def macd(c):
    line = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    sig = line.ewm(span=9, adjust=False).mean()
    return line, sig


def rsi(c, n=14):
    ch = c.diff()
    gain = ch.clip(lower=0).rolling(n).mean()
    loss = (-ch.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + gain / loss)


def add_daily(df):
    """일봉 지표: 추세(MA·ADX) · 모멘텀(RSI·MACD·스토캐스틱) · 변동성(볼린저·ATR) · 거래량(OBV)"""
    df = df.copy()
    h, l, c, v = df["High"], df["Low"], df["Close"], df["Volume"].fillna(0)
    for n in (20, 50, 200):
        df[f"MA{n}"] = c.rolling(n).mean()
    df["RSI"] = rsi(c)
    df["RSI2"] = rsi(c, 2)
    df["MACD"], df["MACD_SIG"] = macd(c)
    low14, high14 = l.rolling(14).min(), h.rolling(14).max()
    df["STOCH"] = ((c - low14) / (high14 - low14) * 100).rolling(3).mean()
    std20 = c.rolling(20).std()
    df["BB_UP"], df["BB_LOW"] = df["MA20"] + 2 * std20, df["MA20"] - 2 * std20
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    df["ATR"] = tr.ewm(alpha=1 / 14, adjust=False).mean()
    up, dn = h.diff(), -l.diff()
    plus = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=df.index)
    minus = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=df.index)
    df["PDI"] = 100 * plus.ewm(alpha=1 / 14, adjust=False).mean() / df["ATR"]
    df["MDI"] = 100 * minus.ewm(alpha=1 / 14, adjust=False).mean() / df["ATR"]
    dx = 100 * (df["PDI"] - df["MDI"]).abs() / (df["PDI"] + df["MDI"])
    df["ADX"] = dx.ewm(alpha=1 / 14, adjust=False).mean()
    df["ATRP"] = df["ATR"] / c
    df["ATRP80"] = df["ATRP"].rolling(252, min_periods=120).quantile(0.8)      # 1년 중 상위 20% 변동폭
    obv = (np.sign(c.diff()).fillna(0) * v).cumsum()
    df["OBV_UP"] = obv - obv.shift(10)
    return df


def add_hourly(df):
    df = df.copy()
    c = df["Close"]
    df["EMA20"] = c.ewm(span=20, adjust=False).mean()
    df["EMA50"] = c.ewm(span=50, adjust=False).mean()
    line, sig = macd(c)
    df["HIST"] = line - sig
    df["RSI"] = rsi(c)
    return df


def add_minute(m1, market):
    m1 = m1.dropna(subset=["Close"])
    if market == "crypto":
        m1 = m1.iloc[-240:]
    else:
        loc = m1.index.tz_convert(TZ[market])
        days = loc.date
        m1 = m1[days == days[-1]]
        if market == "us" and len(m1):              # 미장: 마지막 봉이 속한 구간(프리·정규·애프터)만 → 구간마다 평균 거래가(VWAP)를 따로
            w = us_window(m1.index[-1].to_pydatetime())
            if w:
                hm = loc[days == days[-1]].hour * 60 + loc[days == days[-1]].minute
                m1 = m1[(hm >= w[1]) & (hm < w[2])]
    if len(m1) < 30:
        return None
    df = m1.copy()
    vol = df["Volume"].fillna(0).clip(lower=0).astype(float)
    tp = (df["High"] + df["Low"] + df["Close"]) / 3
    cum_v = vol.cumsum().replace(0, np.nan)
    df["VWAP"] = ((tp * vol).cumsum() / cum_v).fillna(tp.expanding().mean())
    df["EMA9"] = df["Close"].ewm(span=9, adjust=False).mean()
    df["EMA21"] = df["Close"].ewm(span=21, adjust=False).mean()
    avg = vol.shift(1).rolling(30, min_periods=10).mean()
    df["VOLR"] = (vol / avg).replace([np.inf, -np.inf], np.nan).fillna(0)
    return df


# ---------- 타점 (3분 유지 확인) ----------

def sess_tag(market, ts):
    """미장 시간외 타점이면 '프리마켓 ' · '애프터마켓 ' (정규장·다른 시장은 빈칸)"""
    if market != "us":
        return ""
    w = us_window(ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts)
    return SESS_KO[w[0]] + " " if w and w[0] in SESS_KO else ""


def find_trigger(m, side, since, market):
    k, events = CONFIRM_MIN, []
    for i in range(1, len(m) - k + 1):
        j = i + k - 1
        if m.index[j] < since or not calm_time(market, m.index[j]):
            continue
        p, c, seg = m.iloc[i - 1], m.iloc[i], m.iloc[i:j + 1]
        if side == "buy":
            if p["Close"] <= p["VWAP"] and c["Close"] > c["VWAP"] and (seg["Close"] > seg["VWAP"]).all():
                events.append((i, j, "VWAP 돌파"))
            if p["EMA9"] <= p["EMA21"] and c["EMA9"] > c["EMA21"] and (seg["EMA9"] > seg["EMA21"]).all() \
                    and seg["Close"].iloc[-1] > seg["VWAP"].iloc[-1]:
                events.append((i, j, "단기선 상향"))
        else:
            if p["Close"] >= p["VWAP"] and c["Close"] < c["VWAP"] and (seg["Close"] < seg["VWAP"]).all():
                events.append((i, j, "VWAP 이탈"))
            if p["EMA9"] >= p["EMA21"] and c["EMA9"] < c["EMA21"] and (seg["EMA9"] < seg["EMA21"]).all() \
                    and seg["Close"].iloc[-1] < seg["VWAP"].iloc[-1]:
                events.append((i, j, "단기선 하향"))
    if not events:
        return None
    i, j, _ = events[-1]
    reasons = list(dict.fromkeys(r for _, jj, r in events if jj >= j - 3))
    return {"time": m.index[j], "reasons": reasons,
            "volr": float(m["VOLR"].iloc[max(0, i - 1): j + 1].max())}


# ---------- 안전 가격 (지지·저항이 겹치는 곳) ----------

def tick_round(market, x, down=False):
    if market == "us":
        step = 0.01
    elif market == "kr":
        step = next(s for lim, s in [(2000, 1), (5000, 5), (20000, 10), (50000, 50), (200000, 100),
                                      (500000, 500), (float("inf"), 1000)] if x < lim)
    else:
        step = 10 ** max(int(np.floor(np.log10(abs(x)))) - 3, -4) if x > 0 else 1
    f = np.floor if down else np.round
    return round(float(f(x / step) * step), 8)


def cluster(levels, price, atr, below, max_dist=None):
    """price 아래(또는 위)의 지지/저항 후보 중, 가장 가까우면서 여러 개가 겹치는 곳
    max_dist: 현재가에서 이만큼(가격) 안에 있는 것만 봄"""
    cands = sorted([x for x in levels if np.isfinite(x) and (x < price * 0.999 if below else x > price * 1.001)
                    and (max_dist is None or abs(x - price) <= max_dist)],
                   reverse=below)
    if not cands:
        return None
    tol = 0.3 * atr
    groups = []
    for x in cands:
        members = [y for y in cands if abs(y - x) <= tol]
        groups.append((x, members))
    strong = [g for g in groups if len(g[1]) >= 2]
    x, members = strong[0] if strong else groups[0]
    return {"price": float(np.mean(members)), "edge": float(min(members) if below else max(members)),
            "n": len(members)}


def safe_levels(market, d, h, m, same_day):
    prior = d.iloc[:-1] if same_day else d
    pv = prior.iloc[-1]
    P = (pv["High"] + pv["Low"] + pv["Close"]) / 3
    rng = pv["High"] - pv["Low"]
    t, price, atr = d.iloc[-1], float(m["Close"].iloc[-1]), float(d["ATR"].iloc[-1])
    levels = [P, 2 * P - pv["High"], P - rng, 2 * P - pv["Low"], P + rng,          # 피벗 P·S1·S2·R1·R2
              prior["Low"].iloc[-20:].min(), prior["High"].iloc[-20:].max(),     # 20일 최저·최고
              prior["Low"].iloc[-60:].min(), prior["High"].iloc[-60:].max(),     # 60일 최저·최고
              t["MA20"], t["MA50"], t["MA200"], t["BB_LOW"], t["BB_UP"],          # 이동평균·볼린저
              float(m["VWAP"].iloc[-1])]                                           # 오늘 평균 체결가
    if h is not None and len(h) >= 24:
        levels += [h["Low"].iloc[-24:].min(), h["High"].iloc[-24:].max()]         # 최근 24시간 최저·최고
    levels = [float(x) for x in levels]

    sup = cluster(levels, price, atr, below=True)
    res = cluster(levels, price, atr, below=False)
    near = cluster(levels, price, atr, below=False, max_dist=REBOUND_ATR * atr)   # 매도 알림의 '반등 시 매도가'
    buy = sup["price"] if sup else price - atr
    stop = (sup["edge"] if sup else buy) - STOP_ATR * atr
    risk = max(buy - stop, 1e-9)
    # 안전 매도가: 손익비가 1.5 이상 나오는 첫 저항. 없으면 위험폭의 2배 위
    targets = sorted(x for x in levels if np.isfinite(x) and x > buy + 1.5 * risk)
    near_res = [x for x in targets if any(abs(x - y) <= 0.3 * atr for y in levels if y != x)]
    sell = (near_res or targets or [buy + 2 * risk])[0]
    return {"price": price, "atr": atr,
            "buy": tick_round(market, buy), "buy_n": sup["n"] if sup else 0,
            "stop": tick_round(market, stop, down=True),
            "sell": tick_round(market, sell), "rr": (sell - buy) / risk,
            "res": tick_round(market, res["price"]) if res else None, "res_n": res["n"] if res else 0,
            "res_near": tick_round(market, near["price"]) if near else None}


# ---------- 안전도 10점 ----------

def safety_checks(side, d, h, m, trig, lv, prev_close):
    t, last = d.iloc[-1], m.iloc[-1]
    hl = h.iloc[-1] if h is not None and len(h) > 50 else None
    price = lv["price"]
    vol_ok = trig["volr"] >= 1.5 or (t["OBV_UP"] > 0 if side == "buy" else t["OBV_UP"] < 0)
    if side == "buy":
        return [("장기 추세", t["Close"] > t["MA200"]),
                ("정배열", t["MA20"] > t["MA50"]),
                ("추세 강도", t["ADX"] >= 20 and t["PDI"] > t["MDI"]),
                ("MACD", t["MACD"] > t["MACD_SIG"]),
                ("과열 아님", 40 <= t["RSI"] < 68 and t["STOCH"] < 80),
                ("1시간 추세", hl is not None and hl["EMA20"] > hl["EMA50"]),
                ("1시간 모멘텀", hl is not None and hl["HIST"] > 0),
                ("VWAP 위 유지", price > last["VWAP"]),
                ("거래량", vol_ok),
                (f"손익비 {lv['rr']:.1f}", lv["rr"] >= MIN_RR)]
    down_room = (price - lv["buy"]) / max((lv["res"] or price) - price, lv["atr"] * 0.1)
    return [("50일선 아래", t["Close"] < t["MA50"]),
            ("역배열", t["MA20"] < t["MA50"]),
            ("하락 강도", t["ADX"] >= 20 and t["MDI"] > t["PDI"]),
            ("MACD", t["MACD"] < t["MACD_SIG"]),
            ("약세", t["RSI"] < 50 or t["STOCH"] > 80),
            ("1시간 추세", hl is not None and hl["EMA20"] < hl["EMA50"]),
            ("1시간 모멘텀", hl is not None and hl["HIST"] < 0),
            ("VWAP 아래 유지", price < last["VWAP"]),
            ("거래량", vol_ok),
            ("하락 여지", down_room >= 1.5)]


# ---------- 손실 방지 장치 ----------

def closed_days(d, market, now):
    """오늘 아직 안 끝난 일봉은 빼고 (어제까지)"""
    tz = TZ[market]
    dates = d.index.tz_convert(tz).date if d.index.tz is not None else d.index.date
    return d[dates < now.astimezone(tz).date()]


def market_ok(market, idx_daily, now):
    """시장 필터: 대표 지수의 어제 종가가 200일선 위면 OK. 데이터를 못 받으면 막지 않음"""
    if idx_daily is None:
        return True
    d = closed_days(add_daily(idx_daily), market, now)
    if len(d) < 210 or not np.isfinite(d["MA200"].iloc[-1]):
        return True
    return bool(d["Close"].iloc[-1] > d["MA200"].iloc[-1])


def guard_flags(d, price, mkt_ok, earn_ok=True):
    """매수 전에 보는 것: 시장 · 추세 · 눌림 · 변동성 · 실적"""
    t, recent = d.iloc[-1], d.iloc[-5:]
    trend = bool(t["Close"] > t["MA200"] and t["MA50"] > t["MA200"])
    dipped = bool((recent["Low"] <= recent["MA20"] * 1.01).any() or (d["RSI2"].iloc[-3:] < 15).any())
    not_run = bool(price <= t["MA20"] + t["ATR"])
    calm = not (np.isfinite(t["ATRP80"]) and t["ATRP"] > t["ATRP80"])
    return {"시장": bool(mkt_ok), "추세": trend, "눌림": dipped and not_run, "변동성": bool(calm),
            "실적": bool(earn_ok)}


GUARD_KEY = {"시장": "시장_필터", "추세": "추세_필수", "눌림": "눌림_매수", "변동성": "변동성_필터",
             "실적": "실적_피하기"}
GUARD_WHY = {"시장": "시장 하락장", "추세": "종목 추세 약함", "눌림": "눌림 아님(이미 오름)",
             "변동성": "변동성 너무 큼", "실적": "실적 발표 임박"}


def guard_block(market, flags):
    """켜진 장치 중 통과 못 한 것"""
    return [GUARD_WHY[k] for k, ok in flags.items() if guard_on(market, GUARD_KEY[k]) and not ok]


def stability(market, flags, card_ok, card_why, paused):
    """안전 점검 등급 → (등급, 통과 수, 전체 수, 부족한 점 목록)"""
    checks = [(STAB_SHORT[k], flags[k]) for k, key in STAB_KEYS if guard_on(market, key)]
    if guard_on(market, "성적표"):
        checks.append(("기록부족" if card_why == "과거 기록 부족" else "과거손실", card_ok))
    misses = [why for why, ok in checks if not ok]
    passed, total = len(checks) - len(misses), len(checks)
    grade = "높음" if not misses else ("보통" if len(misses) <= 2 else "낮음")
    if grade == "높음" and paused:
        grade = "보통"
        misses.append("🟢연속손실")
    return grade, passed, total, misses


def earnings_dates(t):
    """실적 발표일 목록 (지난 몇 년 + 예정, 'YYYY-MM-DD'). 미장 개별주만 있고, 못 받으면 빈 목록 → 막지 않음"""
    days = set()
    try:
        tk = yf.Ticker(t)
        with base.quiet():
            try:
                df = tk.get_earnings_dates(limit=16)
            except Exception:
                df = None
            if df is not None and len(df):
                for x in df.index:
                    days.add(pd.Timestamp(x).date().isoformat())
            if not days:
                cal = tk.calendar
                vals = []
                if isinstance(cal, dict):
                    vals = cal.get("Earnings Date", [])
                elif cal is not None and hasattr(cal, "loc"):
                    try:
                        vals = list(cal.loc["Earnings Date"])
                    except Exception:
                        vals = []
                for x in (vals if isinstance(vals, (list, tuple)) else [vals]):
                    try:
                        days.add(pd.Timestamp(x).date().isoformat())
                    except Exception:
                        pass
    except Exception:
        pass
    return sorted(days)


def earn_near(dates, day):
    """day부터 EARN_DAYS일 안에 실적 발표가 있으면 True"""
    for s_ in dates or []:
        try:
            gap = (date.fromisoformat(s_) - day).days
        except ValueError:
            continue
        if 0 <= gap <= EARN_DAYS:
            return True
    return False


# ---------- 성적표 (과거에 수익 난 자리만) ----------

def hid(t):
    """기록 파일에는 종목 이름 대신 알아볼 수 없는 짧은 코드로 저장"""
    return hashlib.sha1(("sa|" + t).encode()).hexdigest()[:10]


def card_stats(rets):
    if not len(rets):
        return None
    r = np.asarray(rets, float)
    gain, loss = r[r > 0].sum(), -r[r <= 0].sum()
    return {"n": int(len(r)), "win": float((r > 0).mean() * 100), "avg": float(r.mean() * 100),
            "pf": float(gain / loss) if loss > 0 else 99.0}


def card_judge(t_stats, m_stats):
    """(통과?, 쓴 기록, 막은 이유) — 종목 기록이 충분하면 그걸로, 아니면 같은 시장 전체 기록으로"""
    if t_stats and t_stats["n"] >= CARD_MIN_T:
        s, src = t_stats, "종목"
    elif m_stats and m_stats["n"] >= CARD_MIN_M:
        s, src = m_stats, "시장"
    else:
        return False, None, "과거 기록 부족"
    ok = s["avg"] >= CARD_AVG and s["pf"] >= CARD_PF
    return ok, {**s, "src": src}, None if ok else "과거 이 종목 알림 손실"


def rule_sig():
    """설정(종목·기준·장치)이 바뀌면 성적표를 새로 만들기 위한 표시"""
    parts = {mk: [min_score(mk), [guard_on(mk, g) for g in GUARD_DEFAULT if g != "성적표"],
                  sorted(t for grp in cats.values() for t in grp)] for mk, cats in MARKETS.items()}
    return hashlib.sha1(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:12]


def _age(card, key, now):
    try:
        return now - datetime.fromisoformat(card[key])
    except (KeyError, TypeError, ValueError):
        return timedelta(days=999)


def ensure_card(now):
    """성적표가 없거나 오래됐으면 과거 데이터로 새로 만듦 (하루 한 번쯤, 1~2분 걸림)"""
    if not any(cats and (guard_on(mk, "성적표") or (mk == "us" and guard_on(mk, "실적_피하기")))
               for mk, cats in MARKETS.items()):
        return None
    try:
        with open(CARD_FILE, encoding="utf-8") as f:
            card = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        card = {}
    sig = rule_sig()
    usable = card if card.get("sig") == sig else None
    if usable and _age(card, "made", now) < timedelta(hours=CARD_HOURS):
        return usable
    if card.get("tried_sig") == sig and _age(card, "tried", now) < timedelta(hours=1):
        return usable                                   # 방금 실패했으면 1시간 뒤 다시
    try:
        import backtest_check                           # 점검 작업과 똑같은 계산을 씀
        new = backtest_check.make_card()
        new.update(sig=sig, made=now.isoformat())
        card = new
        log("성적표 새로 만듦")
    except Exception as e:
        log(f"성적표 만들기 실패 ({e})")
        card.update(tried=now.isoformat(), tried_sig=sig)
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(CARD_FILE, "w", encoding="utf-8") as f:
        json.dump(card, f, ensure_ascii=False)
    return card if card.get("sig") == sig else None


def card_check(card, market, t):
    mc = (card or {}).get("markets", {}).get(market, {})
    return card_judge(mc.get("tickers", {}).get(hid(t)), mc.get("pool"))


# ---------- 메시지 ----------

def u16len(s):
    return len(s.encode("utf-16-le")) // 2      # 카톡이 이모지를 2글자로 세도 200자를 안 넘게

def money(market, x):
    if market == "us":
        return f"${x:,.2f}"
    return f"{x:,.0f}원" if x >= 100 else f"{x:,.2f}원"


def position(market, buy, stop, scale=1.0):
    """예산 안에서, 손절가에 걸려도 정한 금액(손절_최대손실) 넘게 안 잃는 수량 → (설명, 손절 시 손실액)
    scale: 레버리지 ETF는 예산 · 최대 손실을 배수만큼 줄임 (3배면 1/3)"""
    risk = max(buy - stop, 1e-9)
    b_usd, l_usd, b_krw, l_krw = BUDGET_USD * scale, MAX_LOSS_USD * scale, BUDGET_KRW * scale, MAX_LOSS_KRW * scale
    if market == "us":
        amt = min(b_usd, l_usd / risk * buy)                    # 살 금액($)
        q = int(amt // buy)
        if q >= 1:
            return f"{q}주", q * risk
        return f"${amt:,.0f}어치(소수점)", amt / buy * risk
    if market == "kr":
        if b_krw < buy:
            return "예산 부족", 0.0
        q = int(min(b_krw // buy, l_krw // risk))
        return (f"{q}주", q * risk) if q >= 1 else ("손절폭 큼", 0.0)
    amt = min(b_krw, l_krw / risk * buy)
    amt = amt // 10000 * 10000 if amt >= 10000 else amt // 1000 * 1000
    if amt <= 0:
        return "손절폭 큼", 0.0
    return (f"{amt / 10000:,.0f}만원어치" if amt >= 10000 else f"{amt:,.0f}원어치"), amt / buy * risk


def label(market, ticker, names):
    return f"{names[ticker]} {ticker}" if market == "us" else names[ticker]


def build_message(market, category, ticker, names, side, trig, score, checks, lv, hist=None, stab=None, extra=None):
    """extra: 꼭 보여 줄 경고 (시장 추세 · 일정 · 수급 · 레버리지) — 200자를 넘어도 다른 줄보다 먼저 남김"""
    when = trig["time"].astimezone(KST).strftime("%H:%M")
    p = lv["price"]
    why = trig["reasons"][0] + (" 외" if len(trig["reasons"]) > 1 else "")
    where = f"{MARKET_NAME[market]} › {category} · {when} {why}"
    optional = []                         # 200자를 넘으면 아래쪽 줄부터 뺌
    if side == "buy":
        grade, passed, total, misses = stab or ("높음", 0, 0, [])
        lines = [f"🔴 매수 · {label(market, ticker, names)}", where,
                 f"신호 점수 {score}/10 · 점검 {GRADE_ICON[grade]}{grade}" + (f" ({passed}/{total})" if total else "")]
        gap = (p / lv["buy"] - 1) * 100
        qty, loss = position(market, lv["buy"], lv["stop"], lv.get("scale", 1.0))
        lines += [f"🔴 매수 기준가 {money(market, lv['buy'])} · {qty}" + (f" ({gap:.1f}% 위 대기)" if gap > 1 else " (지금 가능)"),
                  f"⛔ 손절가 {money(market, lv['stop'])}" + (f" → -{money(market, loss)}" if loss > 0 else "")]
        if guard_on(market, "반_매도"):
            trail = money(market, tick_round(market, TRAIL_ATR * lv["atr"]))
            lines += [f"🔵 {money(market, lv['sell'])}에서 절반 매도, ⛔→매수가"]
            (optional if extra else lines).append(f"나머지는 고점-{trail}에 매도")
        else:
            lines += [f"🔵 매도 기준가 {money(market, lv['sell'])} (손익비 {lv['rr']:.1f})"]
        if misses:
            optional.append("⚠️ " + "·".join(misses))
        if hist:
            src = "" if hist["src"] == "종목" else f"({MARKET_KO[market]})"
            optional.append(f"📈 과거{src} {hist['n']}번 승률{hist['win']:.0f}% 평균{hist['avg']:+.1f}%")
        optional.append(f"현재가 {money(market, p)}")
    else:
        lines = [f"🔵 매도 · {label(market, ticker, names)} ({score}/10)", where]
        near = lv.get("res_near")
        lines.append(f"현재가 {money(market, p)}")
        if near:
            lines += [f"🔵 반등하면 {money(market, near)}에서 매도 (+{(near / p - 1) * 100:.1f}%)",
                      "보유 중이면 지금 또는 반등 때 매도"]
        else:
            lines.append("🔵 보유 중이면 지금 매도")
        lines.append("재매수는 🔴 매수 알림 올 때만")
    if market == "kr":
        optional.append("⚠️ 국장 시세 지연 가능")
    if extra and side == "buy":                   # 시장 추세 · 일정 · 수급 · 레버리지 경고는 점수 줄 바로 아래 (최대 2줄)
        lines[3:3] = list(extra)[:2]
        optional = list(extra)[2:] + optional
    missed = [n for n, ok in checks if not ok]
    if missed:
        optional.append("부족: " + ", ".join(missed))
    while optional and u16len("\n".join(lines + optional)) > 200:
        optional.pop()
    text = "\n".join(lines + optional)
    while u16len(text) > 200:                 # 그래도 길면 끝에서부터 자름 (이모지가 깨지지 않게)
        text = text[:-1]
    return text


def summary_messages(market, items, now):
    """한 번에 같은 시장 알림이 2건 이상이면, 카테고리별로 묶은 요약을 먼저 보냄"""
    lines = [f"{MARKET_NAME[market]} 타점 {len(items)}건 · {now.astimezone(KST):%m/%d %H:%M}"]
    for cat in dict.fromkeys(a["category"] for a in items):
        lines.append(f"[{cat}]")
        for a in (x for x in items if x["category"] == cat):
            word = "🔴 매수" if a["side"] == "buy" else "🔵 매도"
            dot = f" {GRADE_ICON[a['grade']]}" if a.get("grade") else ""
            lines.append(f"{word} {a['name']} {money(market, a['price'])}{dot}")
    lines.append("👇 종목별 기준가는 다음 메시지")
    return base.chunk(lines)


def short_messages(items, now):
    """카톡 짧게: 이번에 새로 생긴 타점을 한 줄씩만. 자세한 기준가·손절가는 앱에서"""
    head = f"🔔 새 타점 {len(items)}건 · {now.astimezone(KST):%m/%d %H:%M}"
    rows = []
    for a in items:
        word = "🔴 매수" if a["side"] == "buy" else "🔵 매도"
        dot = f" {GRADE_ICON[a['grade']]}" if a.get("grade") else ""
        rows.append(f"{word} {a['name']} {money(a['market'], a['price'])}{dot}")
    tail = "기준가·손절가는 앱에서 확인"
    msgs, cur = [], [head]
    for r in rows:
        if u16len("\n".join(cur + [r, tail])) > 200:      # 카톡 200자 제한 (이모지는 2자로 셈)
            msgs.append("\n".join(cur))
            cur = [f"🔔 이어서 ({len(msgs) + 1})"]
        cur.append(r)
    msgs.append("\n".join(cur + [tail]))
    return msgs


def send_short(token, text):
    try:
        base.send_kakao(token, text, link=APP_URL, button="앱에서 보기")
    except Exception:
        base.send_kakao(token, text)        # 카카오에 앱 주소가 아직 등록 안 됐으면 기존 '확인' 버튼으로


# ---------- 알림 기록 ----------

def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state, now):
    os.makedirs(STATE_DIR, exist_ok=True)
    keep = {}
    for k, v in state.items():
        try:
            if now - datetime.fromisoformat(v) < timedelta(days=10):
                keep[k] = v
        except (TypeError, ValueError):
            pass
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(keep, f, ensure_ascii=False)


def in_cooldown(state, key, now, market=None, once_a_day=False):
    try:
        last = datetime.fromisoformat(state[key])
    except (KeyError, TypeError, ValueError):
        return False
    if now - last < timedelta(minutes=COOLDOWN_MIN):
        return True
    if once_a_day:                                   # 하루 한번: 같은 날(현지 기준, 코인은 한국 날짜)이면 막음
        tz = KST if market == "crypto" else TZ[market]
        return last.astimezone(tz).date() == now.astimezone(tz).date()
    return False


# ---------- 실전 기록 (보낸 매수 알림을 실제로 샀다고 치고 따라가기) ----------
# 점검 작업의 모의투자(backtest_check.simulate_buys)와 똑같은 규칙을 1분봉에 적용해요.
#  wait: 안전 매수가까지 내려오길 기다림 (1시간봉 16개 = 960분 안에 안 오면 없던 일)
#  p1  : 손절가 / 안전 매도가 / 14일 중 먼저 오는 것
#  p2  : (반 매도) 절반 판 뒤 나머지는 손절을 매수가로 올리고 고점-ATR×2 에서 매도 (최대 60일)

def load_book():
    try:
        with open(TRADES_FILE, encoding="utf-8") as f:
            book = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        book = {}
    book = {"open": book.get("open", []), "closed": book.get("closed", []), "flags": book.get("flags", {})}
    for tr in book["open"]:
        for k in ("ta", "te", "last"):
            if tr.get(k):
                tr[k] = pd.Timestamp(tr[k])
    for c in book["closed"]:
        c["tx"] = pd.Timestamp(c["tx"])
    return book


def save_book(book, now):
    def enc(row):
        return {k: (v.isoformat() if isinstance(v, (pd.Timestamp, datetime)) else v) for k, v in row.items()}
    cut = pd.Timestamp(now) - pd.Timedelta(days=120)
    out = {"open": [enc(tr) for tr in book["open"]],
           "closed": [enc(c) for c in book["closed"] if c["tx"] >= cut][-300:],
           "flags": book["flags"]}
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(TRADES_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f)


def track_start(book, market, t, lv, last_bar, now, grade="높음"):
    book["open"].append({"id": hid(t), "m": market, "gr": grade, "ta": pd.Timestamp(now), "last": pd.Timestamp(last_bar),
                         "st": "wait", "seen": 0, "wait": FILL_BARS_H * 60,
                         "buy": float(lv["buy"]), "stop": float(lv["stop"]), "sell": float(lv["sell"]),
                         "atr": float(lv["atr"]), "half": guard_on(market, "반_매도")})


def _done(tr, exit_price):
    first = tr.get("first")
    r = exit_price / tr["entry"] - 1 if first is None else (0.5 * first + 0.5 * exit_price) / tr["entry"] - 1
    tr.update(st="done", ret=r - FEE)


def track_step(tr, ts, o, hi, lo, cl):
    """봉 하나만큼 진행. 끝나면 st가 done(ret 기록) / skip / expired"""
    st = tr["st"]
    if st == "wait":
        tr["seen"] += 1
        if tr["seen"] > tr["wait"]:
            tr["st"] = "expired"
        elif lo <= tr["buy"]:
            entry = min(o, tr["buy"])
            if entry <= tr["stop"]:
                tr["st"] = "skip"                       # 이미 손절가 아래로 열림 → 안 삼
            else:
                tr.update(st="p1", entry=entry, te=ts)
                if lo <= tr["stop"]:                    # 산 봉에서 바로 손절가도 닿으면 손절로 (보수적으로)
                    _done(tr, tr["stop"])
    elif st == "p1":
        if ts > tr["te"] + pd.Timedelta(days=HOLD_DAYS):
            _done(tr, tr["prev"])
        elif lo <= tr["stop"]:
            _done(tr, min(o, tr["stop"]))
        elif hi >= tr["sell"]:
            hit = max(o, tr["sell"])
            if tr["half"]:
                tr.update(st="p2", first=hit, peak=hi)
            else:
                _done(tr, hit)
    elif st == "p2":
        trail = max(tr["entry"], tr["peak"] - TRAIL_ATR * tr["atr"])
        if ts > tr["te"] + pd.Timedelta(days=RUN_DAYS):
            _done(tr, tr["prev"])
        elif lo <= trail:
            _done(tr, min(o, trail))
        else:
            tr["peak"] = max(tr["peak"], hi)
    tr["prev"] = cl


def track_update(book, market, t, m_raw):
    """이번에 받은 1분봉으로 그 종목의 기록을 앞으로 진행"""
    mine = [tr for tr in book["open"] if tr["m"] == market and tr["id"] == hid(t)]
    if not mine or m_raw is None:
        return
    m_raw = m_raw.dropna(subset=["Open", "High", "Low", "Close"])
    for tr in mine:
        new = m_raw[m_raw.index > tr["last"]]
        for ts, (o, hi, lo, cl) in zip(new.index, new[["Open", "High", "Low", "Close"]].to_numpy(float)):
            track_step(tr, ts, o, hi, lo, cl)
            tr["last"] = ts
            if tr["st"] == "done":
                book["closed"].append({"m": market, "tx": ts, "ret": float(tr["ret"]), "gr": tr.get("gr", "높음")})
            if tr["st"] in ("done", "skip", "expired"):
                break
    book["open"] = [tr for tr in book["open"] if tr["st"] not in ("done", "skip", "expired")]


def pause_until(closed, now):
    """연속 손실 PAUSE_LOSSES번이면 그때부터 PAUSE_DAYS일 멈춤 (멈춘 동안 끝난 거래는 안 셈).
    지금 멈춤 중이면 끝나는 시각, 아니면 None — 점검 작업도 같은 함수를 씀"""
    end, streak = None, 0
    for c in sorted((c for c in closed if c["tx"] < now), key=lambda c: c["tx"]):
        if end is not None and c["tx"] < end:
            continue
        streak = streak + 1 if c["ret"] <= 0 else 0
        if streak >= PAUSE_LOSSES:
            end, streak = c["tx"] + pd.Timedelta(days=PAUSE_DAYS), 0
    return end if end is not None and now < end else None


def green(book, market):
    """자동 멈춤은 🟢(높음) 알림의 실전 결과로만 판단"""
    return [c for c in book["closed"] if c["m"] == market and c.get("gr", "높음") == "높음"]


def pause_notice(market, end):
    return (f"🛑 {MARKET_NAME[market]} 🟢 매수 알림이 {PAUSE_LOSSES}번 연속 손실\n"
            f"{PAUSE_DAYS}일 동안 🟢를 🟡로 낮춰서 보내요.\n"
            f"{end.astimezone(KST):%m/%d %H:%M}에 원래대로 돌아와요.")


def weekly_report(book, now):
    """월요일 아침(한국 8시 이후 첫 실행)에 지난주 실전 성적 한 번"""
    k = now.astimezone(KST)
    week = f"{k.isocalendar()[0]}-{k.isocalendar()[1]}"
    if k.weekday() != 0 or k.hour < 8 or book["flags"].get("report") == week:
        return []
    book["flags"]["report"] = week
    since = pd.Timestamp(now) - pd.Timedelta(days=7)
    lines = [f"📒 지난주 실전 알림 성적 ({k - timedelta(days=7):%m/%d}~{k - timedelta(days=1):%m/%d})",
             "알림대로 100만원씩 매수 기준가에 샀다고 치고 계산"]
    for market, cats in MARKETS.items():
        if not cats:
            continue
        rows = [c for c in book["closed"] if c["m"] == market and c["tx"] >= since]
        if not rows:
            lines.append(f"{MARKET_NAME[market]} 끝난 거래 없음")
            continue
        parts = []
        for g in ("높음", "보통", "낮음"):
            xs = [c["ret"] for c in rows if c.get("gr", "높음") == g]
            if xs:
                win = sum(r > 0 for r in xs)
                parts.append(f"{GRADE_ICON[g]} {len(xs)}번(이익{win}) {sum(xs) * 100:+.1f}만")
        lines.append(f"{MARKET_NAME[market]} " + " · ".join(parts))
    held = sum(tr["st"] in ("p1", "p2") for tr in book["open"])
    waiting = sum(tr["st"] == "wait" for tr in book["open"])
    lines.append(f"보유 중 {held}개 · 매수가 기다리는 중 {waiting}개")
    stopped = [MARKET_KO[mk] for mk in MARKETS
               if guard_on(mk, "자동_멈춤") and pause_until(green(book, mk), pd.Timestamp(now))]
    lines.append("🛑 🟢→🟡 낮춘 시장: " + ", ".join(stopped) if stopped else "🟢 연속 손실 없음")
    return base.chunk(lines)


# ---------- 아침 브리핑 ----------

BRIEF_IDX = [("S&P500", "^GSPC"), ("나스닥", "^IXIC"), ("코스피", "^KS11"), ("원/달러", "KRW=X")]
WEEKDAY_KO = "월화수목금토일"


def last_change(df):
    """일봉 마지막 두 개로 등락률(%) · 마지막 값 · 그날 날짜"""
    c = df["Close"].dropna() if df is not None else None
    if c is None or len(c) < 2:
        return None
    return {"chg": round(float(c.iloc[-1] / c.iloc[-2] - 1) * 100, 2), "last": round(float(c.iloc[-1]), 2),
            "date": pd.Timestamp(c.index[-1]).date().isoformat()}


def session_change(df, tz):
    """1시간봉으로 마지막 거래일 종가 vs 그 전 거래일 종가 (일봉이 늦게 갱신되는 아침 대비)"""
    if df is None or not len(df):
        return None
    c = df["Close"].dropna()
    if len(c) < 2:
        return None
    idx = c.index.tz_convert(tz) if c.index.tz is not None else c.index
    by_day = pd.Series(c.values, index=[t.date() for t in idx]).groupby(level=0).last()
    if len(by_day) < 2:
        return None
    a, b = float(by_day.iloc[-2]), float(by_day.iloc[-1])
    return {"chg": round((b / a - 1) * 100, 2), "last": round(b, 2), "date": by_day.index[-1].isoformat()}


def morning_brief(book, state, card, now):
    """매일 아침(한국 8시 이후 첫 실행, 일요일 빼고) 한 번: 밤사이 시장 · 시장 흐름 · 지난 24시간 타점과 실전 결과 · 이번 주 실적.
    돌려주는 값: (앱에 보낼 내용, 카톡 줄 목록) 또는 None"""
    k = now.astimezone(KST)
    day = k.date().isoformat()
    if not BRIEF or k.hour < 8 or k.weekday() == 6 or book["flags"].get("brief") == day:
        return None
    book["flags"]["brief"] = day
    out = {"at": now.isoformat(), "day": day, "idx": [], "flow": {}, "alerts": {"buy": 0, "sell": 0},
           "closed": {"n": 0, "wins": 0, "sum": 0.0}, "held": 0, "waiting": 0, "earn": []}
    try:
        d = fetch_many([t for _, t in BRIEF_IDX], "10d", "1d")
        hz = {"^GSPC": "us", "^IXIC": "us", "^KS11": "kr"}
        hd = fetch_many(list(hz), "7d", "60m")
        for name, t in BRIEF_IDX:
            x = last_change(d.get(t))
            if t in hz:                                  # 일봉이 하루 늦으면 1시간봉으로 계산한 쪽을 씀
                y = session_change(hd.get(t), TZ[hz[t]])
                if y and (not x or y["date"] > x["date"]):
                    x = y
            if x:
                out["idx"].append({"name": name, **x})
        h = fetch_many(["BTC-KRW"], "3d", "60m").get("BTC-KRW")
        c = h["Close"].dropna() if h is not None else []
        if len(c) > 25:                                  # 코인은 24시간 전과 비교
            out["idx"].append({"name": "비트코인", "chg": round(float(c.iloc[-1] / c.iloc[-25] - 1) * 100, 2),
                               "last": round(float(c.iloc[-1])), "date": day, "h24": True})
    except Exception as e:
        log(f"아침 브리핑: 지수 받기 실패 ({e})")
    try:
        mks = [m for m, cats in MARKETS.items() if cats]
        idx = fetch_many([INDEX[m] for m in mks], "2y", "1d")
        for m in mks:
            if idx.get(INDEX[m]) is not None:
                out["flow"][m] = market_ok(m, idx.get(INDEX[m]), now)
            reg = (book["flags"].get("regime") or {}).get(m) or {}
            if reg.get("st") and reg.get("at", "") >= (now - timedelta(days=4)).isoformat():
                out["flow"][m] = reg["st"] != "down"          # 지수 추세(상승·횡보·하락)를 본 결과가 있으면 그걸로
    except Exception as e:
        log(f"아침 브리핑: 시장 흐름 실패 ({e})")
    since = now - timedelta(hours=24)
    for key, v in state.items():
        if key.startswith("app|"):
            try:
                if datetime.fromisoformat(v) >= since:
                    out["alerts"]["buy" if key.endswith("|buy") else "sell"] += 1
            except (TypeError, ValueError):
                pass
    rows = [c for c in book["closed"] if c["tx"] >= pd.Timestamp(since)]
    out["closed"] = {"n": len(rows), "wins": sum(c["ret"] > 0 for c in rows),
                     "sum": round(sum(c["ret"] for c in rows) * 100, 2)}
    out["held"] = sum(tr["st"] in ("p1", "p2") for tr in book["open"])
    out["waiting"] = sum(tr["st"] == "wait" for tr in book["open"])
    earn = (card or {}).get("earn", {})
    for cat, group in (MARKETS.get("us") or {}).items():
        for t, name in group.items():
            for s_ in earn.get(hid(t), []) or []:
                try:
                    gap = (date.fromisoformat(s_) - k.date()).days
                except ValueError:
                    continue
                if 0 <= gap <= 7:
                    out["earn"].append({"name": name, "day": s_})
                    break
    out["earn"].sort(key=lambda x: x["day"])

    # 카톡 줄
    lines = [f"☀️ 아침 브리핑 {k:%m/%d}({WEEKDAY_KO[k.weekday()]})"]
    by = {x["name"]: x for x in out["idx"]}

    def pc(name):
        x = by.get(name)
        return f"{name} {x['chg']:+.1f}%" if x else None
    for group in (("S&P500", "나스닥"), ("코스피", "비트코인")):
        parts = [p for p in (pc(n) for n in group) if p]
        if parts:
            lines.append(" · ".join(parts))
    if "원/달러" in by:
        lines.append(f"환율 {by['원/달러']['last']:,.0f}원 ({by['원/달러']['chg']:+.1f}%)")
    if out["flow"]:
        lines.append("흐름 " + "·".join(f"{MARKET_KO[m]} {'상승세' if ok else '약세'}" for m, ok in out["flow"].items()))
    a = out["alerts"]
    lines.append(f"새 타점(24시간) 매수 {a['buy']}·매도 {a['sell']}")
    cl = out["closed"]
    rec = f"실전 기록 보유 {out['held']}·대기 {out['waiting']}"
    if cl["n"]:
        rec += f" · 끝남 {cl['n']}번 {cl['sum']:+.1f}만원"
    lines.append(rec)
    if out["earn"]:
        lines.append("실적 예정 " + ", ".join(f"{e['name']} {e['day'][5:].replace('-', '/')}" for e in out["earn"][:4])
                     + (f" 외 {len(out['earn']) - 4}" if len(out["earn"]) > 4 else ""))
    return out, lines


def brief_push(data, lines):
    """아침 브리핑 푸시 한 줄 요약: 지수 등락 + 시장 흐름 + 새 타점 수"""
    by = {x["name"]: x for x in data["idx"]}
    parts = [f"{n} {by[n]['chg']:+.1f}%" for n in ("S&P500", "나스닥", "코스피", "비트코인") if n in by]
    flow = data.get("flow") or {}
    if flow:
        parts.append("흐름 " + "·".join(f"{MARKET_KO[m]} {'상승세' if ok else '약세'}" for m, ok in flow.items()))
    a = data["alerts"]
    parts.append(f"새 타점 매수 {a['buy']}·매도 {a['sell']}")
    return {"title": lines[0], "body": " · ".join(parts), "url": "./#/", "tag": "brief-" + data["day"]}


def kakao_chunks(lines, limit=200):
    """카톡 200자 제한(이모지는 2자로 셈)에 맞춰 줄 단위로 나눔"""
    msgs, cur = [], []
    for ln in lines:
        if cur and u16len("\n".join(cur + [ln])) > limit:
            msgs.append("\n".join(cur))
            cur = []
        cur.append(ln)
    if cur:
        msgs.append("\n".join(cur))
    return msgs


# ---------- 실행 ----------

def scan_market(market, cats, now, force, state, alerts, stats, card=None, book=None, notices=None):
    names = {t: n for group in cats.values() for t, n in group.items()}
    category = {t: c for c, group in cats.items() for t in group}
    tickers = list(names)
    idx = INDEX[market]
    need_idx = guard_on(market, "시장_필터")
    extra_idx = [idx] + mc.regime_tickers(market) + mc.lev_bases(tickers)
    daily = fetch_many(list(dict.fromkeys(tickers + extra_idx)), "2y", "1d")
    mkt_ok = market_ok(market, daily.get(idx), now) if need_idx else True     # 지수 추세를 못 받으면 예전 방식
    ctx = {"R": None, "base": {}, "flow": None, "earn": {}, "brk": None, "daily": daily}
    try:                                           # 시장 전체 추세 (상승장 · 횡보장 · 하락장)
        ctx["R"] = mc.regime(daily, market, now)
    except Exception as e:
        log(f"[{market}] 시장 추세 계산 실패 ({type(e).__name__})")
    if ctx["R"] and book is not None:
        book["flags"].setdefault("regime", {})[market] = {**ctx["R"], "at": now.isoformat()}
    for b in mc.lev_bases(tickers):               # 레버리지 ETF의 기초 지수 상태
        try:
            ctx["base"][b] = mc.index_state(daily.get(b), mc.IDX_TZ.get(b, mc.ET if market != "kr" else mc.KST), now, mc.CRASH[market])
        except Exception:
            ctx["base"][b] = None
    if book is not None:
        ctx["flow"] = book["flags"].setdefault("flow", {})
        mc.prune_flow(ctx["flow"], now)
        ctx["earn"] = (book["flags"].get("semi_earn") or {}).get("ev") or {}
        ctx["brk"] = book["flags"].setdefault("brk", {})
    R = ctx["R"]
    log(f"[{market}] 시장 추세: " + (f"{mc.STATE_KO[R['st']]} (반도체 {mc.STATE_KO[R['semi']]})" + (" · 급락" if R["crash"] else "")
                                if R else ("예전 필터 " + ("통과" if mkt_ok else "하락장"))))
    hourly = fetch_many(tickers, "60d", "60m")
    minute = fetch_many(tickers, "2d", "1m", prepost=(market == "us" and US_EXT))
    paused = False
    if book is not None:
        for t in tickers:
            try:
                track_update(book, market, t, minute.get(t))
            except Exception as e:
                log(f"{t}: 실전 기록 진행 실패 ({e})")
        if guard_on(market, "자동_멈춤"):
            end = pause_until(green(book, market), pd.Timestamp(now))
            paused = end is not None
            if paused and book["flags"].get(f"pause|{market}") != end.isoformat():
                book["flags"][f"pause|{market}"] = end.isoformat()
                if notices is not None:
                    notices.append(pause_notice(market, end))
            log(f"[{market}] 자동 멈춤: {'쉬는 중' if paused else '아님'}")
    for t in tickers:
        stats["checked"] += 1
        try:
            check_ticker(market, t, names, category, daily, hourly, minute, now, force, state, alerts, mkt_ok, card,
                         paused, book, ctx)
        except Exception as e:
            stats["failed"] += 1
            log(f"{t}: 확인 실패 ({e})")
    try:                                           # 돌파 매수 알림 뒤 다시 저항선 아래로 → 매수 신호 취소
        if book is not None:
            breakout_cancels(market, tickers, names, minute, now, book)
    except Exception as e:
        log(f"[{market}] 돌파 취소 확인 실패 ({type(e).__name__})")
    try:
        store_charts(market, tickers, daily, hourly, minute, now, alerts)
    except Exception as e:
        log(f"[{market}] 차트 저장 실패 ({e})")


def _pack(c, cap):
    """종가 시리즈 → [[유닉스 초, 가격], ...] (최대 cap개, 마지막 값은 꼭 남김)"""
    c = c.dropna()
    if not len(c):
        return []
    step = max(1, -(-len(c) // cap))
    c = c.iloc[::-1].iloc[::step].iloc[::-1]
    return [[int(ts.timestamp()), float(f"{float(v):.6g}")] for ts, v in c.items()]


def chart_series(market, d, h, m):
    """타점 상세 차트: 분(마지막 거래일 1분봉) · 시(최근 10거래일 1시간봉) · 일(1년) · 월(2년)"""
    out = {}
    if m is not None and len(m):
        c = m["Close"].dropna()
        if len(c):
            if market == "crypto":
                c = c[c.index >= c.index[-1] - pd.Timedelta(hours=24)]
            else:
                loc = c.index.tz_convert(TZ[market]) if c.index.tz is not None else c.index
                c = c[pd.Index(loc.date) == loc[-1].date()]
            out["m"] = _pack(c, 240)
    if h is not None and len(h):
        c = h["Close"].dropna()
        out["h"] = _pack(c.iloc[-(7 * 24 if market == "crypto" else 70):], 200)
    if d is not None and len(d):
        c = d["Close"].dropna()
        out["d"] = _pack(c.iloc[-260:], 260)
        try:
            mo = c.resample("ME").last()
        except (ValueError, TypeError):
            mo = c.resample("M").last()
        out["mo"] = _pack(mo.iloc[-24:], 24)
    return out


def store_charts(market, tickers, daily, hourly, minute, now, alerts):
    """최근 알림이 나온 종목(이번 실행 포함)만 차트 저장 — 내 보유에만 있는 종목은 안 올림"""
    if not app_bridge.enabled():
        return
    want = (CHART_SET | {a["ticker"] for a in alerts if a.get("app") and a["market"] == market}) - KAKAO_ONLY
    rows = []
    for t in tickers:
        if t not in want:
            continue
        data = chart_series(market, daily.get(t), hourly.get(t), minute.get(t))
        if data:
            rows.append({"yt": t, "market": market, "data": data, "updated_at": now.isoformat()})
    app_bridge.upsert("charts", rows, "yt")
    res = []
    for x in RECENT:
        t = x["yt"]
        if x.get("market") != market or t not in tickers or t in KAKAO_ONLY:
            continue
        r = alert_result(x, minute.get(t), hourly.get(t))
        if r:
            res.append({"id": x["id"], "res": {**r, "at": now.isoformat()}})
    if res:
        app_bridge.rpc("engine_alert_res", {"p": res})


def alert_result(x, m, h):
    """알림 뒤 최고·최저·지금 (알림 때 가격 대비 %) — 1분봉에 알림 시각이 있으면 1분봉, 없으면 1시간봉으로"""
    try:
        t0 = pd.Timestamp(x["created_at"])
        price = float(x["price"])
    except (KeyError, TypeError, ValueError):
        return None
    if price <= 0:
        return None
    for df in (m, h):
        if df is None or not len(df):
            continue
        d = df.dropna(subset=["Close"])
        if not len(d) or d.index[0] > t0:
            continue
        after = d[d.index >= t0]
        if not len(after):
            return None
        pct = lambda v: round((float(v) / price - 1) * 100, 2)
        return {"hi": pct(after["High"].max()), "lo": pct(after["Low"].min()), "now": pct(after["Close"].iloc[-1])}
    return None


def sell_repeat_ok(book, key, price, now, market):
    """매도 알림 반복 줄이기: 같은 날(현지 기준, 코인은 한국 날짜) 같은 종목은 한 번,
    단 마지막 매도 알림 가격보다 SELL_AGAIN_DROP% 넘게 더 내렸으면 다시 알림"""
    if book is None:
        return True
    rec = (book["flags"].get("sellpx") or {}).get(key)
    if not rec:
        return True
    try:
        at, px = datetime.fromisoformat(rec[0]), float(rec[1])
    except (TypeError, ValueError, IndexError):
        return True
    tz = KST if market == "crypto" else TZ[market]
    if at.astimezone(tz).date() != now.astimezone(tz).date():
        return True
    return price <= px * (1 - SELL_AGAIN_DROP / 100)


def sell_mark(book, key, price, now):
    sp = book["flags"].setdefault("sellpx", {})
    sp[key] = [now.isoformat(), float(price)]
    cut = now - timedelta(days=3)
    for k in [k for k, v in sp.items() if not isinstance(v, list) or datetime.fromisoformat(v[0]) < cut]:
        sp.pop(k, None)


def sell_linked(state, book, t, now):
    """매도 알림을 보낼 만한 종목인가: 실전 기록에 보유 중이거나, 최근 7일 안에 매수 알림이 나간 종목"""
    h = hid(t)
    if any(tr.get("id") == h and tr.get("st") in ("p1", "p2") for tr in (book or {}).get("open", [])):
        return True
    for k in (f"app|{h}|buy", f"tajum|{h}|buy"):
        try:
            if state.get(k) and now - datetime.fromisoformat(state[k]) < timedelta(days=SELL_LINK_DAYS):
                return True
        except (TypeError, ValueError):
            pass
    return False


def extra_checks(market, t, cat, d, m, trig, lv, score, now, ctx):
    """2026-11-28 추가 점검 → (flags에 더할 것, 카톡 막는 이유, 앱·카톡 모두 막는 이유, 앱 막는 이유, 카톡 경고 줄, 앱 정보)"""
    add, kblock, hard, ablock, lines, info = {}, [], [], [], [], {}
    R = (ctx or {}).get("R")
    semi = mc.is_semi(t, cat)
    st, crash = mc.state_for(R, semi)
    if st:
        add["장세"] = mc.STATE_KO[st]
        info["mkt"] = {"st": st, "semi": semi, "crash": crash,
                       "idx": [{"n": x["n"], "st": x["st"], "d1": x["d1"]} for x in R["items"] if semi or x["n"] in mc.MAIN[market]]}
        if st == "down" and guard_on(market, "시장_필터"):
            kblock.append("시장 하락장")
            if score < mc.DOWN_MIN_SCORE:
                ablock.append("하락장이라 강한 신호만")
            lines.append("📉 시장 하락장 · 신중하게")
        elif st == "side":
            lines.append("〰️ 시장 횡보장")
    # 가짜 돌파
    tz = TZ[market]
    closed = closed_days(d, market, now) if market != "crypto" else d.iloc[:-1]
    if market == "crypto":
        m_today = m[m.index >= m.index[-1] - pd.Timedelta(hours=24)]
    else:
        loc = m.index.tz_convert(tz) if m.index.tz is not None else m.index
        m_today = m[pd.Index(loc.date) == loc[-1].date()]
    avg_vol = float(closed["Volume"].iloc[-20:].mean()) if len(closed) >= 20 else None
    pace = mc.day_pace(market, m_today, avg_vol, m.index[-1])
    bo = mc.breakout(closed, m_today, lv["price"], trig.get("volr"), pace)
    if bo["st"] != "none":
        add["돌파"] = bo["st"] == "ok"
        info["brk"] = {"st": bo["st"], "why": bo.get("why"), "res": float(tick_round(market, bo["res"])), "pace": round(pace, 2) if pace else None}
        if bo["st"] == "fail" and guard_on(market, "가짜_돌파"):
            hard.append("가짜 돌파 (" + bo["why"] + ")")
        elif bo["st"] == "weak":
            lines.append("⚠️ 거래량 없는 돌파")
    # 경제 일정 · 반도체 실적
    ev = mc.event_check(market, t, semi, now, (ctx or {}).get("earn"), S.get("경제_일정_추가"))
    if ev["items"]:
        add["일정"] = ev["lvl"] < 2
        info["ev"] = ev["items"][:3]
        lines.insert(0, "🗓️ " + ev["items"][0]["n"] + (" 앞 · 매수 주의" if ev["lvl"] >= 2 else " 앞"))
        if ev["lvl"] >= 2 and guard_on(market, "일정_피하기"):
            kblock.append("주요 일정 앞")
    # 국장 수급
    if market == "kr" and (ctx or {}).get("flow") is not None:
        try:
            fl = mc.get_flow(t.split(".")[0], ctx["flow"], now, lv["price"], key=hid(t))
        except Exception:
            fl = None
        if fl:
            add["수급"] = bool(fl["ok"])
            info["flow"] = fl
            lines.append(("⚠️ " if not fl["ok"] else "") + mc.flow_line(fl))
            if not fl["ok"] and guard_on(market, "수급_확인"):
                kblock.append("외국인·기관 동반 순매도")
    # 레버리지 ETF
    L = mc.lev_of(t)
    if L:
        x, base, base_name = L
        try:
            li = mc.lev_info(x, d, (ctx or {}).get("daily", {}).get(base))
        except Exception:
            li = None
        bs = ((ctx or {}).get("base") or {}).get(base)
        ok, whys, hard_l = mc.lev_check(x, li, bs["st"] if bs else st, (bs or {}).get("crash", crash), ev["lvl"],
                                        score, min_score(market) + 1)
        add["레버"] = ok
        info["lev"] = {**(li or {"x": x}), "base": base_name, "base_st": (bs or {}).get("st"), "why": whys, "split": mc.LEV_SPLIT_MAX}
        lv["scale"] = 1 / abs(x)
        lines.insert(0, mc.lev_line(x, li))
        if guard_on(market, "레버_관리"):
            if hard_l:
                hard.append("레버리지: " + ", ".join(w for w in whys if "급락" in w))
            elif not ok:
                kblock.append("레버리지 기준: " + ", ".join(whys))
    return add, kblock, hard, ablock, lines, info


def breakout_cancels(market, tickers, names, minute, now, book):
    """돌파로 매수 알림이 나간 종목이 다시 저항선 아래로 내려오면 → 매수 신호 취소 (카톡 · 앱 푸시)"""
    brk = book["flags"].get("brk") or {}
    by_h = {hid(t): t for t in tickers}
    for key, x in list(brk.items()):
        if x.get("m") != market:
            continue
        if x.get("until", "") < now.isoformat():
            brk.pop(key, None)
            continue
        t = by_h.get(x.get("h"))
        if not t:
            continue
        m = minute.get(t)
        if m is None or not len(m):
            continue
        last = m["Close"].dropna()
        if len(last) < 3:
            continue
        px = float(last.iloc[-3:].mean())                # 마지막 3분 평균 (순간 튀는 값 무시)
        if px < x["lvl"] * 0.995:
            CANCELS.append({**x, "price": px, "t": t, "name": label(market, t, names)})
            brk.pop(key, None)
            log(f"돌파 실패 → 매수 신호 취소 1건 ({market})")


def check_ticker(market, t, names, category, daily, hourly, minute, now, force, state, alerts, mkt_ok=True,
                 card=None, paused=False, book=None, ctx=None):
    d, m = daily.get(t), minute.get(t)
    if d is None or len(d) < 220 or m is None:
        log(f"{t}: 데이터 부족 → 건너뜀")
        return
    d, m = add_daily(d), add_minute(m, market)
    h = add_hourly(hourly[t]) if t in hourly else None
    if m is None:
        log(f"{t}: 1분봉 부족 → 건너뜀")
        return
    last_time = m.index[-1].to_pydatetime()
    if not force and now - last_time > timedelta(minutes=45):
        log(f"{t}: 최신 1분봉 없음 (휴장 또는 지연) → 건너뜀")
        return

    tz = TZ[market]
    same_day = d.index[-1].tz_convert(tz).date() == last_time.astimezone(tz).date() \
        if d.index.tz is not None else d.index[-1].date() == last_time.astimezone(tz).date()
    prev_close = float(d["Close"].iloc[-2] if same_day else d["Close"].iloc[-1])
    since = m.index[-1] - pd.Timedelta(minutes=LOOKBACK_MIN)
    lv = safe_levels(market, d, h, m, same_day)

    use_card = guard_on(market, "성적표")
    card_ok, hist, card_why = card_check(card, market, t) if use_card else (True, None, None)
    earn_ok = True
    if market == "us" and guard_on(market, "실적_피하기"):
        earn_ok = not earn_near((card or {}).get("earn", {}).get(hid(t), []), last_time.astimezone(tz).date())
    found = False
    for side in ("buy", "sell"):
        trig = find_trigger(m, side, since, market)
        if not trig:
            continue
        found = True
        checks = safety_checks(side, d, h, m, trig, lv, prev_close)
        score = sum(bool(ok) for _, ok in checks)
        key = f"tajum|{hid(t)}|{side}"          # 카톡 (시안님 설정)
        akey = f"app|{hid(t)}|{side}"           # 앱 (사용자마다 설정이 달라서 후보를 넓게 저장)
        word = "매수" if side == "buy" else "매도"
        stab, blocked, hard, flags = None, [], [], None
        kblock, ablock, xlines, xinfo = [], [], [], {}
        if side == "buy":
            add = {}
            try:
                add, kblock, xhard, ablock, xlines, xinfo = extra_checks(market, t, category[t], d, m, trig, lv, score, now, ctx)
                hard += xhard
            except Exception as e:
                log(f"추가 점검 실패 ({type(e).__name__})")
            st_ = (xinfo.get("mkt") or {}).get("st")
            m_ok = (st_ != "down") if (st_ and guard_on(market, "시장_필터")) else mkt_ok
            gf = guard_flags(d, lv["price"], m_ok, earn_ok)
            flags = {**gf, "성적": bool(card_ok), **add}
            stab = stability(market, gf, card_ok, card_why, paused)
            if GRADE_RANK[stab[0]] < GRADE_RANK[MIN_GRADE]:
                blocked.append(f"점검 {stab[0]} (설정한 최소 {MIN_GRADE})")
            if position(market, lv["buy"], lv["stop"], lv.get("scale", 1.0))[0] == "손절폭 큼":
                hard.append("손절폭이 손실 한도보다 큼")
        else:
            flags = {"linked": sell_linked(state, book, t, now)}
        once = side == "buy" and guard_on(market, "하루_한번")
        to_kakao, to_app_ = False, False
        k_rule = (KAKAO_RULES or {}).get(market)
        held = t in ((MY_HOLD or {}).get(market) or {})
        if held and side == "sell":
            flags["linked"] = True                 # 내가 보유에 넣은 종목은 매도 알림도 보냄
        if KAKAO_HOLD_ONLY and not held:
            log(f"{t}: {word} 타점 {score}/10 · 내 보유 종목이 아니라 카톡 안 함")
        elif in_cooldown(state, key, now, market, once) or (side == "sell" and not sell_repeat_ok(book, key, lv["price"], now, market)):
            log(f"{t}: {word} 타점 (최근에 이미 알림)")
        elif side == "sell" and not SELL_ALL and not flags["linked"]:
            log(f"{t}: 매도 타점 {score}/10 · 보유·최근 매수 알림 없는 종목이라 카톡 안 함")
        elif k_rule is not None:                 # 카톡도 추천 설정(시장별 지표 조건)대로
            if hard:
                log(f"{t}: {word} 타점 {score}/10 이지만 카톡 막음 ({', '.join(hard)})")
            elif not app_bridge.passes({"score": score, "side": side, "flags": flags,
                                        "misses": stab[3] if stab else []}, k_rule):
                log(f"{t}: {word} 타점 {score}/10 · '{KAKAO_PRESET}' 조건에 안 맞아 카톡 안 함")
            else:
                to_kakao = True
        elif score < min_score(market):
            log(f"{t}: {word} 타점 있지만 신호 점수 {score}/10 → 카톡 안 함")
        elif blocked or hard:
            log(f"{t}: {word} 타점 {score}/10 이지만 카톡 막음 ({', '.join(blocked + hard)})")
        else:
            to_kakao = True
        if to_kakao and side == "buy" and (kblock or hard):
            to_kakao = False
            log(f"{t}: 매수 타점 {score}/10 이지만 카톡 쉼 ({', '.join(hard + kblock)})")
        if app_bridge.enabled() and t not in KAKAO_ONLY and not hard and not ablock and score >= APP_FLOOR \
                and not in_cooldown(state, akey, now, market, once) \
                and (side == "buy" or sell_repeat_ok(book, akey, lv["price"], now, market)):
            to_app_ = True
        if to_kakao or to_app_:
            alerts.append({"key": key, "akey": akey, "kakao": to_kakao, "app": to_app_,
                           "market": market, "category": category[t], "name": names[t],
                           "side": side, "price": lv["price"], "ticker": t, "lv": lv, "bar": m.index[-1],
                           "grade": stab[0] if stab else None, "score": score, "stab": stab, "hist": hist,
                           "flags": flags, "xinfo": xinfo, "xlines": xlines,
                           "why": f"{trig['time'].astimezone(KST):%H:%M} " + sess_tag(market, trig["time"]) + trig["reasons"][0]
                                  + (" 외" if len(trig["reasons"]) > 1 else ""),
                           "msg": build_message(market, category[t], t, names, side, trig, score, checks, lv,
                                                hist, stab, xlines)})
    if not found:
        log(f"{t}: 확정된 타점 없음")


# ---------- 앱으로 보내기 ----------

def app_item(a):
    """카톡 알림 하나 → (앱 DB에 저장할 행, 휴대폰 푸시 내용)"""
    market, lv = a["market"], a["lv"]
    names = {a["ticker"]: a["name"]}
    title = label(market, a["ticker"], names)
    flags = a.get("flags")
    if a["side"] == "buy" and isinstance(flags, dict) and a.get("xinfo"):
        flags = {**flags, "x": a["xinfo"]}                 # 시장 추세 · 수급 · 돌파 · 일정 · 레버리지 정보 (앱 상세 화면용)
    row = {"market": market, "category": a["category"], "name": title, "side": a["side"],
           "score": int(a["score"]), "reason": a["why"], "price": float(lv["price"]),
           "flags": flags, "yt": a["ticker"]}
    if a["side"] == "buy":
        grade, passed, total, misses = a["stab"]
        qty, loss = position(market, lv["buy"], lv["stop"], lv.get("scale", 1.0))
        row.update(grade=grade, passed=passed, total=total, misses=misses, buy=float(lv["buy"]),
                   stop=float(lv["stop"]), sell=float(lv["sell"]), qty=qty, loss=round(float(loss), 4),
                   trail=float(tick_round(market, TRAIL_ATR * lv["atr"])), half=guard_on(market, "반_매도"),
                   hist=a.get("hist"))
        push = {"title": f"🔴 매수 · {title}",
                "body": f"점검 {grade} {passed}/{total} · 매수 {money(market, lv['buy'])} · 손절 {money(market, lv['stop'])}"
                        + (f"\n{a['xlines'][0]}" if a.get("xlines") else "")}
    else:
        near = lv.get("res_near")
        row.update(rebound=float(near) if near else None)
        push = {"title": f"🔵 매도 · {title}",
                "body": f"현재가 {money(market, lv['price'])}" + (f" · 반등 시 {money(market, near)}" if near else " · 보유 중이면 매도")}
    return row, push


def live_stats(book, now):
    """앱 '실전 기록' 화면용: 지난 7일·전체를 시장·등급별로"""
    since = pd.Timestamp(now) - pd.Timedelta(days=7)
    out = {"week": {}, "all": {}, "from": None}
    for c in book["closed"]:
        out["from"] = min(out["from"] or c["tx"].isoformat(), c["tx"].isoformat())
        for span in ("week", "all"):
            if span == "week" and c["tx"] < since:
                continue
            g = out[span].setdefault(c["m"], {}).setdefault(c.get("gr", "높음"), {"n": 0, "win": 0, "sum": 0.0})
            g["n"] += 1
            g["win"] += int(c["ret"] > 0)
            g["sum"] = round(g["sum"] + c["ret"] * 100, 2)           # 100만원씩이면 만원 단위
    out["held"] = sum(tr["st"] in ("p1", "p2") for tr in book["open"])
    out["waiting"] = sum(tr["st"] == "wait" for tr in book["open"])
    out["paused"] = [mk for mk in MARKETS if guard_on(mk, "자동_멈춤")
                     and pause_until(green(book, mk), pd.Timestamp(now))]
    return out


def to_app(alerts, book, now):
    """앱 DB 저장 + 푸시 + 엔진 상태. 실패해도 카톡 알림에는 영향 없음"""
    if not app_bridge.enabled():
        return None
    problem = app_bridge.setup_problem()
    if problem:
        return {"error": problem}
    items, bad, owners = [], 0, []
    for a in alerts:
        try:
            items.append(app_item(a))
            owners.append(a)
        except Exception:
            bad += 1                              # 알림 하나가 이상해도 나머지는 보냄
    step = "알림 저장"
    try:
        res = app_bridge.publish(items, now)
        for a, i, (row, _) in zip(owners, res.pop("ids", None) or [], items):
            a["app_id"], a["app_row"] = i, row
        step = "상태 저장"
        app_bridge.put_kv("heartbeat", {"at": now.isoformat()})
        step = "기록 저장"
        app_bridge.put_kv("live", live_stats(book, now))
        if bad:
            res["bad"] = bad
        return res
    except Exception as e:
        return {"error": f"{step}: {app_bridge.why(e)}"}


def track_breakouts(alerts, book, now):
    """거래량 동반 돌파로 나간 매수 알림은 다음 날까지 지켜봄 (다시 저항선 아래로 오면 취소 알림)"""
    brk = book["flags"].setdefault("brk", {})
    for a in alerts:
        b = (a.get("xinfo") or {}).get("brk") or {}
        if a["side"] != "buy" or b.get("st") != "ok" or not (a.get("kakao") or a.get("app_id")):
            continue
        row = a.get("app_row") or {}
        brk[a["akey"]] = {
            "h": hid(a["ticker"]), "m": a["market"], "lvl": b["res"], "k": bool(a.get("kakao")), "id": a.get("app_id"),
            "row": {k: row.get(k) for k in ("market", "side", "score", "grade", "misses")} | {"flags": {k: v for k, v in (row.get("flags") or {}).items() if k != "x"}},
            "until": (now + timedelta(hours=30)).isoformat()}


def send_cancels(now):
    """CANCELS → 카톡(원래 카톡으로 받은 것만) · 앱(알림에 '취소' 표시 + 푸시)"""
    if not CANCELS:
        return
    token = None
    for c in CANCELS:
        mk = c["m"]
        text = (f"⚠️ 매수 신호 취소 · {c['name']}\n돌파했던 {money(mk, c['lvl'])} 아래로 다시 내려왔어요 (가짜 돌파 가능성).\n"
                f"아직 안 샀다면 사지 마세요. 이미 샀다면 손절가를 꼭 지키세요.\n현재가 {money(mk, tick_round(mk, c['price']))}")
        if c.get("k"):
            try:
                token = token or base.get_access_token()
                base.send_kakao(token, text[:200])
                time.sleep(1)
            except Exception as e:
                log(f"취소 카톡 실패 ({type(e).__name__})")
        if c.get("id") and app_bridge.enabled():
            row = c.get("row") or {}
            try:
                app_bridge.cancel_alert(c["id"], {"why": "돌파 실패", "at": now.isoformat(), "px": float(tick_round(mk, c["price"]))})
                if app_bridge.VAPID_PRIVATE:
                    push = {"title": f"⚠️ 매수 신호 취소 · {c['name']}", "body": f"돌파했던 {money(mk, c['lvl'])} 아래로 다시 내려왔어요",
                            "url": f"./#/alert/{c['id']}", "tag": f"a{c['id']}"}
                    app_bridge.send_push(app_bridge.get_subs(), [(row, push)], now)
            except Exception as e:
                log(f"취소 앱 표시 실패 ({app_bridge.why(e)})")


def market_ctx_kv(book, now):
    """kv 'mkt_ctx': 시장별 추세 (지수 이름 · 상태 · 등락) + 앞으로 10일 경제 일정 · 반도체 실적"""
    ev = (book["flags"].get("semi_earn") or {}).get("ev") or {}
    reg = {mk: r for mk, r in (book["flags"].get("regime") or {}).items() if isinstance(r, dict)}
    return {"at": now.isoformat(), "regime": reg, "events": mc.upcoming(now, ev, 10, S.get("경제_일정_추가")),
            "macro_last": max(t for _, t in mc.MACRO)[:10]}


def with_my_hold(market, cats):
    """감시 목록 + 내 보유 종목 (감시 목록에 없는 보유 종목은 '내 보유' 묶음으로 더해서 카톡용으로만 확인)"""
    mine = (MY_HOLD or {}).get(market) or {}
    have = {t for group in cats.values() for t in group}
    extra = {t: n for t, n in mine.items() if t not in have}
    if not extra:
        return cats
    KAKAO_ONLY.update(extra)
    return {**cats, "내 보유": extra}


def kakao_rules():
    """카톡 조건: 앱 서버의 추천 설정에서 시장별 조건을 받아 옴. 못 받으면 None → 예전 방식"""
    if KAKAO_PRESET in ("기존", "") or not app_bridge.enabled():
        return None
    try:
        presets = app_bridge.get_kv("presets") or {}
        for p in presets.get("list", []):
            if p.get("id") == KAKAO_PRESET and isinstance(p.get("rules"), dict):
                return p["rules"]
    except Exception as e:
        log(f"추천 설정 받기 실패 ({e}) → 예전 방식으로 카톡")
    return None


def main():
    global KAKAO_RULES, MY_HOLD
    force = os.environ.get("FORCE") == "1" or "force" in sys.argv
    KAKAO_RULES = kakao_rules()
    if app_bridge.enabled():
        try:
            RECENT[:] = app_bridge.recent_alerts(datetime.now(timezone.utc) - timedelta(days=3))
            CHART_SET.update(x["yt"] for x in RECENT)
        except Exception as e:
            log(f"최근 알림 종목 받기 실패 ({app_bridge.why(e)})")
    if KAKAO_HOLD_ONLY:
        try:
            MY_HOLD = app_bridge.owner_holds()
        except Exception as e:
            log(f"내 보유 종목 받기 실패 ({app_bridge.why(e)}) → 이번엔 카톡 알림 없음")
    if not any(MARKETS.values()):
        sys.exit("❗ 비밀값 ALERT_SETTINGS에 종목이 없어요. 설정 방법을 다시 확인해 주세요.")
    now = datetime.now(timezone.utc)
    t_start = time.time()
    scanned = []
    state = load_state()
    card = ensure_card(now)
    book = load_book()
    alerts, notices = [], []
    stats = {"markets": 0, "checked": 0, "failed": 0}
    for market, cats in MARKETS.items():
        if not cats and not (MY_HOLD or {}).get(market):
            continue
        if not is_open(market, now) and not force:
            log(f"[{market}] 장 시간이 아니라 건너뜀")
            continue
        log(f"[{market}] 확인 중...")
        stats["markets"] += 1
        scanned.append(market)
        scan_market(market, with_my_hold(market, cats), now, force, state, alerts, stats, card, book, notices)

    # 주인 없는 오래된 기록 정리 (종목을 설정에서 뺀 경우 등)
    old = pd.Timestamp(now) - pd.Timedelta(days=RUN_DAYS + 20)
    book["open"] = [tr for tr in book["open"] if tr["ta"] >= old]
    notices += weekly_report(book, now)
    brief = morning_brief(book, state, card, now)
    brief_pushed = 0
    if brief and app_bridge.enabled():
        try:
            app_bridge.put_kv("brief", brief[0])
            brief_pushed = app_bridge.push_brief(brief_push(brief[0], brief[1]), now)
        except Exception as e:
            log(f"아침 브리핑 앱 저장·푸시 실패 ({app_bridge.why(e)})")

    k_brief, k_notices = (None, []) if KAKAO_HOLD_ONLY else (brief, notices)   # 보유만 받기: 브리핑·주간 보고는 앱에서만
    if any(a["kakao"] for a in alerts) or k_notices or k_brief:
        token = base.get_access_token()
        for msg in kakao_chunks(k_brief[1]) if k_brief else []:
            send_short(token, msg)
            time.sleep(1)
        for msg in k_notices:
            base.send_kakao(token, msg)
            time.sleep(1)
        ordered = []
        for market, cats in MARKETS.items():
            order = {c: i for i, c in enumerate(cats)}
            ordered += sorted((a for a in alerts if a["market"] == market and a["kakao"]),
                              key=lambda a: order.get(a["category"], len(order)))
        if KAKAO_SHORT and ordered:
            for msg in short_messages(ordered, now):
                send_short(token, msg)
                time.sleep(1)
        for market in MARKETS:
            items = [a for a in ordered if a["market"] == market]
            if not items:
                continue
            if not KAKAO_SHORT and len(items) >= 2:
                for msg in summary_messages(market, items, now):
                    base.send_kakao(token, msg)
                    time.sleep(1)
            for a in items:
                if not KAKAO_SHORT:
                    base.send_kakao(token, a["msg"])
                    time.sleep(1)
                state[a["key"]] = now.isoformat()
                if a["side"] == "sell":
                    sell_mark(book, a["key"], a["price"], now)
                if a["side"] == "buy":
                    track_start(book, market, a["ticker"], a["lv"], a["bar"], now, a.get("grade") or "높음")
                log(f"알림 보냄 → {a['key']}")
    app_items = [a for a in alerts if a["app"]]
    app = to_app(app_items, book, now)
    if app and not app.get("error"):
        for a in app_items:                       # 앱에 저장된 것만 '보냄'으로 기록 (실패하면 다음에 다시)
            state[a["akey"]] = now.isoformat()
            if a["side"] == "sell":
                sell_mark(book, a["akey"], a["price"], now)
    try:
        track_breakouts(alerts, book, now)
        send_cancels(now)
    except Exception as e:
        log(f"돌파 취소 처리 실패 ({app_bridge.why(e)})")
    try:                                          # 앱 '시장 분위기' · '다가오는 일정' 카드
        if app_bridge.enabled():
            app_bridge.put_kv("mkt_ctx", market_ctx_kv(book, now))
    except Exception as e:
        log(f"시장 분위기 저장 실패 ({app_bridge.why(e)})")
    save_state(state, now)
    hold_note = ""
    try:                                          # 앱 '보유' 탭 분석 (알림을 다 보낸 뒤)
        hold_note = holdings.run(sys.modules[__name__], book, now)
    except Exception as e:
        log(f"보유 분석 실패 ({app_bridge.why(e)})")
        hold_note = " · 보유 분석 실패"
    try:                                          # 앱 종목 뉴스 · 지수 선물 시세
        hold_note += news_fut.run(sys.modules[__name__], book, now)
    except Exception as e:
        log(f"뉴스·선물 실패 ({app_bridge.why(e)})")
        hold_note += " · 뉴스·선물 실패"
    try:                                          # 사용자가 정한 목표가 · 손절가 알림
        if price_watch:
            hold_note += price_watch.run(sys.modules[__name__], now)
    except Exception as e:
        log(f"가격 알림 실패 ({app_bridge.why(e)})")
        hold_note += " · 가격 알림 실패"
    try:                                          # 월가 픽: 30분마다 새 13F 공시 확인
        if wallst:
            hold_note += wallst.run(sys.modules[__name__], book, now)
    except Exception as e:
        log(f"월가 픽 실패 ({app_bridge.why(e)})")
        hold_note += " · 월가 픽 실패"
    try:                                          # 의견 답글을 메일로
        if mailer:
            hold_note += mailer.run()
    except Exception as e:
        log(f"답글 메일 실패 ({app_bridge.why(e)})")
        hold_note += " · 답글 메일 실패"
    try:                                          # 반도체 주요 기업 다음 실적 발표일 (하루 한 번, 알림을 다 보낸 뒤)
        mc.semi_earn_job(book["flags"], now, earnings_dates, log)
    except Exception as e:
        log(f"반도체 실적 일정 실패 ({type(e).__name__})")
    try:                                          # 매수 신호 실제 성적 (하루 한 번)
        if signal_stats:
            hold_note += signal_stats.run(sys.modules[__name__], book, now)
    except Exception as e:
        log(f"신호 성적 실패 ({app_bridge.why(e)})")
        hold_note += " · 신호 성적 실패"
    save_book(book, now)
    # 공개 기록에는 종목 이름 없이 숫자만 남김
    tail = ""
    if app:
        if app.get("error"):
            tail = f" · 앱 연결 실패 ({app['error']})"
        else:
            tail = f" · 앱 {app['saved']}개 · 푸시 {app['pushed']}건" + (f" · 앱 제외 {app['bad']}개" if app.get("bad") else "")
    mode = f" · 카톡 {KAKAO_PRESET}" if KAKAO_RULES else " · 카톡 기존 방식"
    if KAKAO_HOLD_ONLY:
        mode += f" · 보유만 {sum(len(v) for v in MY_HOLD.values())}종목" if MY_HOLD is not None else " · 보유만 (계정 연결 전)"
    mode += f" · 아침 브리핑 (푸시 {brief_pushed}건)" if brief else ""
    mode += hold_note
    print(f"확인 끝: 시장 {stats['markets']}곳 · 종목 {stats['checked']}개 · 실패 {stats['failed']}개{tail}{mode}")
    try:                                          # 개발자 화면용: 엔진 설정 · 최근 실행 기록 (공개 기록에는 안 남김)
        engine_status(now, t_start, scanned, stats, alerts, app, mode, book, force)
    except Exception as e:
        log(f"엔진 상태 저장 실패 ({app_bridge.why(e)})")


def engine_status(now, t_start, scanned, stats, alerts, app, mode, book, force):
    """앱 서버 kv 'engine': 지금 설정 요약 + 최근 실행 48번 (약 4시간). 비밀값은 넣지 않음"""
    if not app_bridge.enabled():
        return
    run = {"at": now.isoformat(), "sec": round(time.time() - t_start, 1), "m": scanned, "c": stats["checked"], "f": stats["failed"],
           "b": sum(1 for a in alerts if a["side"] == "buy"), "s": sum(1 for a in alerts if a["side"] != "buy"),
           "k": sum(1 for a in alerts if a.get("kakao")), "p": (app or {}).get("pushed", 0), "e": (app or {}).get("error"),
           "force": bool(force), "note": mode.strip(" ·")[:300]}
    try:
        prev = app_bridge.get_kv("engine") or {}
    except Exception:
        prev = {}
    hist = ([run] + [r for r in (prev.get("runs") or []) if isinstance(r, dict)])[:48]
    cats = {mk: {c: len(v) for c, v in (cs or {}).items()} for mk, cs in MARKETS.items()}
    cfg = {
        "watch": cats, "kakao_preset": KAKAO_PRESET, "kakao_rules": KAKAO_RULES, "kakao_short": KAKAO_SHORT,
        "budget_krw": BUDGET_KRW, "budget_usd": BUDGET_USD, "max_loss_krw": MAX_LOSS_KRW, "max_loss_usd": MAX_LOSS_USD,
        "min_score": _SCORE, "min_grade": MIN_GRADE, "confirm_min": CONFIRM_MIN, "min_rr": MIN_RR, "stop_atr": STOP_ATR,
        "cooldown_min": COOLDOWN_MIN, "sell_all": SELL_ALL, "sell_link_days": SELL_LINK_DAYS, "brief": BRIEF,
        "trail_atr": TRAIL_ATR, "rebound_atr": REBOUND_ATR, "earn_days": EARN_DAYS, "fee": FEE, "app_floor": APP_FLOOR,
        "guards": {mk: {g: guard_on(mk, g) for g in {**GUARD_DEFAULT, **GUARD_EXTRA}} for mk in MARKETS},
        "score_by_market": {mk: min_score(mk) for mk in MARKETS},
    }
    live = {"open": len(book.get("open") or []), "closed": len(book.get("closed") or []),
            "paused": sorted(k.split("|", 1)[1] for k, v in (book.get("flags") or {}).items()
                             if k.startswith("pause|") and isinstance(v, str) and v > now.isoformat())}
    app_bridge.put_kv("engine", {"at": now.isoformat(), "cfg": cfg, "live": live, "runs": hist})


if __name__ == "__main__":
    main()
