"""고객 한마디 분류기 — Streamlit 화면.

CSV/엑셀을 올리면 criteria.json 의 기준대로 «분류·감정·긴급도»를 붙여 준다.
규칙은 rules.js 와 똑같다 (우선순위대로 훑어 처음 걸리는 분류 / 부정 먼저 / 높음 먼저).
기준을 고치면 파일 수정 시각이 바뀌므로 화면을 새로고침하면 바로 반영된다.

실행:  streamlit run streamlit_app.py
"""
import io
import json
from pathlib import Path

import pandas as pd
import streamlit as st

CRITERIA_PATH = Path(__file__).with_name("criteria.json")
SAMPLE_PATH = Path(__file__).with_name("sample_input.csv")
TEXT_HINTS = ["문장", "text", "내용", "문의", "고객", "의견", "voc", "메시지"]


# ── 기준 불러오기 (파일이 바뀌면 다시 읽는다) ─────────────────────────
@st.cache_data
def load_criteria(mtime: float) -> dict:
    return json.loads(CRITERIA_PATH.read_text(encoding="utf-8"))


# ── rules.js 와 같은 분류 ────────────────────────────────────────────
def hit(text: str, words):
    for w in words or []:
        if w in text:
            return w
    return None


def iga(word: str) -> str:
    c = ord(str(word).strip()[-1:] or " ")
    if 0xAC00 <= c <= 0xD7A3:
        return "이" if (c - 0xAC00) % 28 else "가"
    return "이(가)"


def classify(text, criteria: dict) -> dict:
    t = "" if pd.isna(text) else str(text)

    # 우선순위대로 훑어 처음 걸리는 분류가 답. 뒤쪽 분류에도 걸리면 «걸침»으로 따로 적어 둔다.
    category, why_cat = "기타", "어느 분류의 신호도 없어서 «기타»"
    matched = []  # [(분류, 걸린 키워드)]
    for name in criteria["priority"]:
        cat = next((c for c in criteria["categories"] if c["name"] == name), None)
        w = hit(t, cat["keywords"]) if cat else None
        if w:
            matched.append((name, w))
    if matched:
        name, w = matched[0]
        category, why_cat = name, f"«{w}»{iga(w)} 있어서 «{name}»"

    neg = hit(t, criteria["sentiment"]["부정"])
    pos = hit(t, criteria["sentiment"]["긍정"])
    sentiment = "부정" if neg else "긍정" if pos else "중립"
    why_sent = f"«{neg}»" if neg else f"«{pos}»" if pos else "신호 없음"

    hi = hit(t, criteria["urgency"]["높음"])
    lo = hit(t, criteria["urgency"]["낮음"])
    urgency = "높음" if hi else "낮음" if lo else "보통"
    why_urg = f"«{hi}»" if hi else f"«{lo}»" if lo else "신호 없음"

    return {
        "분류": category,
        "감정": sentiment,
        "긴급도": urgency,
        "분류 근거": why_cat,
        "걸친 분류": ", ".join(n for n, _ in matched) if len(matched) > 1 else "",
        "걸친 키워드": ", ".join(f"{n}:{w}" for n, w in matched) if len(matched) > 1 else "",
        "감정 근거": why_sent,
        "긴급도 근거": why_urg,
    }


# ── 파일 읽기 ────────────────────────────────────────────────────────
def read_upload(f) -> pd.DataFrame:
    name = f.name.lower()
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        return pd.read_excel(f)
    raw = f.getvalue()
    for enc in ("utf-8-sig", "cp949"):
        try:
            return pd.read_csv(io.StringIO(raw.decode(enc)))
        except UnicodeDecodeError:
            continue
    raise ValueError("CSV 인코딩을 읽지 못했습니다 (utf-8, cp949 모두 실패)")


def guess_text_column(df: pd.DataFrame) -> str:
    for col in df.columns:
        if any(h in str(col).lower() for h in TEXT_HINTS):
            return col
    obj = [c for c in df.columns if df[c].dtype == object]
    if obj:
        return max(obj, key=lambda c: df[c].astype(str).str.len().mean())
    return df.columns[0]


def to_excel(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as w:
        df.to_excel(w, index=False, sheet_name="분류결과")
    return buf.getvalue()


# ── 화면 ─────────────────────────────────────────────────────────────
st.set_page_config(page_title="고객 한마디 분류기", page_icon="🗂️", layout="wide")
criteria = load_criteria(CRITERIA_PATH.stat().st_mtime)
CAT_ORDER = list(criteria["priority"])

st.title("🗂️ 고객 한마디 분류기")
st.caption("CSV·엑셀을 올리면 `criteria.json` 기준대로 분류·감정·긴급도를 붙입니다. (AI 없이 규칙만 적용)")

with st.sidebar:
    st.subheader("적용 중인 기준")
    st.markdown(f"**{criteria['title']}** · v{criteria['version']}")
    st.caption(criteria["owner"])
    st.markdown("**분류 우선순위**")
    st.markdown(" → ".join(CAT_ORDER))
    with st.expander("분류 정의 보기"):
        for c in criteria["categories"]:
            st.markdown(f"**{c['name']}** — {c['definition']}")
    st.caption("기준을 고쳤다면 이 화면을 새로고침(R)하세요.")

up = st.file_uploader("분류할 파일 (CSV 또는 엑셀)", type=["csv", "xlsx", "xls"])

# 샘플 파일 바로 넣어 보기
b1, b2, _ = st.columns([1.3, 1, 4])
if b1.button("📄 샘플 파일로 해보기", disabled=not SAMPLE_PATH.exists()):
    st.session_state["use_sample"] = True
if st.session_state.get("use_sample") and b2.button("샘플 닫기"):
    st.session_state["use_sample"] = False
    st.rerun()

use_sample = bool(st.session_state.get("use_sample")) and up is None

if up is None and not use_sample:
    st.info("파일을 올리거나 «샘플 파일로 해보기»를 눌러 보세요.")
    st.stop()

try:
    if use_sample:
        df = pd.read_csv(SAMPLE_PATH, encoding="utf-8-sig")
        st.caption(f"샘플 파일 `{SAMPLE_PATH.name}` 을 쓰는 중입니다.")
    else:
        df = read_upload(up)
except Exception as e:  # noqa: BLE001
    st.error(f"파일을 읽지 못했습니다: {e}")
    st.stop()

if df.empty:
    st.warning("행이 없는 파일입니다.")
    st.stop()

c1, c2 = st.columns(2)
cols = list(df.columns)
text_col = c1.selectbox("분류할 문장이 들어 있는 열", cols, index=cols.index(guess_text_column(df)))
gold_opts = ["(없음)"] + [c for c in cols if c != text_col]
default_gold = next((i for i, c in enumerate(gold_opts) if str(c) in ("정답", "category", "분류정답")), 0)
gold_col = c2.selectbox("사람이 붙인 정답 분류 열 (있으면 비교)", gold_opts, index=default_gold)

result = pd.DataFrame([classify(t, criteria) for t in df[text_col]])
out = pd.concat([df.reset_index(drop=True), result], axis=1)

st.success(f"{len(out):,}건을 분류했습니다.")

# 요약
st.subheader("분류별 건수")
cnt = out["분류"].value_counts().reindex(CAT_ORDER, fill_value=0).rename("규칙 분류")
summary = cnt.to_frame()
if gold_col != "(없음)":
    summary["사람 정답"] = out[gold_col].value_counts().reindex(CAT_ORDER, fill_value=0)
    summary["차이"] = summary["규칙 분류"] - summary["사람 정답"]
summary.index.name = "분류"

left, right = st.columns([3, 2])
left.dataframe(summary, width="stretch")
right.bar_chart(cnt)

s1, s2 = st.columns(2)
s1.markdown("**감정**")
s1.dataframe(out["감정"].value_counts().reindex(["부정", "중립", "긍정"], fill_value=0).rename("건수"))
s2.markdown("**긴급도**")
s2.dataframe(out["긴급도"].value_counts().reindex(["높음", "보통", "낮음"], fill_value=0).rename("건수"))

# 정답 비교
if gold_col != "(없음)":
    same = (out["분류"] == out[gold_col].astype(str))
    st.subheader("정답과 비교")
    st.metric("분류 일치", f"{same.sum():,} / {len(out):,}", f"{same.mean() * 100:.1f}%")
    wrong = out[~same]
    with st.expander(f"정답과 다른 {len(wrong):,}건 보기"):
        st.dataframe(wrong[[text_col, gold_col, "분류", "분류 근거"]], width="stretch")

# 두 분류 이상에 걸친 문장
multi = out[out["걸친 분류"] != ""]
st.subheader(f"두 분류 이상에 걸친 문장 ({len(multi):,}건)")
if multi.empty:
    st.caption("두 분류 이상의 키워드가 함께 걸린 문장이 없습니다.")
else:
    st.caption(
        "한 문장에 여러 분류의 키워드가 함께 있는 경우입니다. "
        "최종 분류는 우선순위가 앞선 칸이 되고, 아래에 «걸친 분류»가 모두 적힙니다."
    )
    pair = (
        multi["걸친 분류"].str.split(", ")
        .apply(lambda xs: " + ".join(xs))
        .value_counts()
        .rename_axis("걸친 조합")
        .reset_index(name="건수")
    )
    m1, m2 = st.columns([2, 5])
    m1.dataframe(pair, width="stretch", hide_index=True)
    show = [text_col, "분류", "걸친 분류", "걸친 키워드"]
    if gold_col != "(없음)":
        show.insert(1, gold_col)
    m2.dataframe(multi[show], width="stretch", hide_index=True)

# 전체 결과
st.subheader("분류 결과")
pick = st.multiselect("분류 칸 거르기", CAT_ORDER)
view = out[out["분류"].isin(pick)] if pick else out
st.dataframe(view, width="stretch", height=420)

d1, d2, _ = st.columns([1, 1, 4])
d1.download_button(
    "CSV 내려받기",
    out.to_csv(index=False).encode("utf-8-sig"),
    file_name="분류결과.csv",
    mime="text/csv",
)
d2.download_button(
    "엑셀 내려받기",
    to_excel(out),
    file_name="분류결과.xlsx",
    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
)
