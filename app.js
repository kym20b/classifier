/* 고객 한마디 분류기 — 화면.
 *
 * 흐름: 문장 → 가림(mask.js, 브라우저 안) → AI(api/classify) → 실패하면 규칙(rules.js)
 * 채점: 정답 100건을 규칙으로, 또는 AI로(20건씩 다섯 번) 돌려 맞힌 비율을 잰다.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const S = { criteria: null, test: [], practice: [], aiResults: null, model: "", serverDefault: "" };

  // ── 모델 고르기 ─────────────────────────────────────
  // 무료로 쓸 수 있다고 공식 가격표(aistudio.google.com/docs/pricing)에 적힌 글쓰기 모델.
  // 무료 한도 숫자는 AI Studio 에 로그인해야 보이고 자주 바뀐다 — 순서는 «Flash-Lite 가 대체로 넉넉하다»는 짐작이다.
  const MODELS = [
    { id: "gemini-3.5-flash-lite", note: "가벼움 · 한도 넉넉한 편(추정)" },
    { id: "gemini-3.1-flash-lite", note: "가벼움 · 한도 넉넉한 편(추정)" },
    { id: "gemini-3.6-flash",      note: "중간" },
    { id: "gemini-3.8-flash",      note: "가장 새 Flash" },
    { id: "gemini-3-flash-preview", note: "프리뷰 · 한도가 더 빡빡할 수 있음" },
  ];
  const CUSTOM = "__custom__";
  const KEY = "classifier.model";

  function saveModel() { try { localStorage.setItem(KEY, S.model); } catch (e) { /* 저장 못 해도 동작한다 */ } }
  function loadModel() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }

  function renderModelHint() {
    $("#model-hint").textContent = S.model
      ? `이 모델로 호출합니다: ${S.model}`
      : `서버 기본값을 씁니다${S.serverDefault ? ": " + S.serverDefault : ""} (Vercel 환경 변수 GEMINI_MODEL)`;
  }

  function initModelPicker() {
    const sel = $("#model-sel"), custom = $("#model-custom");
    sel.innerHTML = `<option value="">서버 기본값</option>`
      + MODELS.map(m => `<option value="${m.id}">${m.id} — ${m.note}</option>`).join("")
      + `<option value="${CUSTOM}">직접 입력…</option>`;
    const saved = loadModel();
    S.model = saved;
    if (!saved) sel.value = "";
    else if (MODELS.some(m => m.id === saved)) sel.value = saved;
    else { sel.value = CUSTOM; custom.value = saved; custom.hidden = false; }

    sel.addEventListener("change", () => {
      custom.hidden = sel.value !== CUSTOM;
      S.model = sel.value === CUSTOM ? custom.value.trim() : sel.value;
      if (sel.value === CUSTOM) custom.focus();
      saveModel(); renderModelHint();
    });
    custom.addEventListener("input", () => { S.model = custom.value.trim(); saveModel(); renderModelHint(); });
    renderModelHint();

    // 서버가 쓰는 기본 모델 이름을 물어 안내에 보여 준다. 로컬(서버 함수 없음)에서는 조용히 넘어간다.
    fetch("api/classify").then(r => r.ok ? r.json() : null).then(d => {
      if (d && d.default) { S.serverDefault = d.default; renderModelHint(); }
    }).catch(() => {});
  }

  async function load() {
    const [c, t, p] = await Promise.all([
      fetch("criteria.json").then(r => r.json()),
      fetch("data/answer100.json").then(r => r.json()),
      fetch("data/practice200.json").then(r => r.json()),
    ]);
    S.criteria = c; S.test = t; S.practice = p;
    renderCriteria();
  }

  // ── 탭 ──────────────────────────────────────────────
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    ["try", "score", "rules"].forEach(k => { $("#tab-" + k).hidden = k !== b.dataset.tab; });
  }));

  // ── AI 호출 ─────────────────────────────────────────
  async function askAI(maskedTexts) {
    try {
      const r = await fetch("api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: maskedTexts, criteria: S.criteria, model: S.model }),
      });
      if (!r.ok) return { results: null, reason: `서버 함수가 없습니다 (${r.status}) — 배포하면 생깁니다` };
      return await r.json();
    } catch (e) {
      return { results: null, reason: "서버 함수에 닿지 못했습니다" };
    }
  }

  function chips(el, res) {
    el.innerHTML = ["category", "sentiment", "urgency"]
      .map(k => `<span class="chip ${res[k]}">${res[k]}</span>`).join("");
  }

  // ── 분류해 보기 ─────────────────────────────────────
  $("#btn-sample").addEventListener("click", () => {
    const r = S.practice[Math.floor(Math.random() * S.practice.length)];
    $("#input").value = r.text;
  });

  $("#btn-classify").addEventListener("click", async () => {
    const text = $("#input").value.trim();
    if (!text) return;
    const btn = $("#btn-classify");
    btn.disabled = true; btn.textContent = "분류 중…";

    const m = Mask.mask(text);
    $("#sent").hidden = false;
    $("#sent-text").textContent = m.masked;
    $("#sent-found").innerHTML = m.found.length
      ? m.found.map(f => `<span class="tag">${f.type} 가림</span>`).join("")
      : `<span class="muted">가린 것 없음</span>`;

    const rule = Rules.classify(m.masked, S.criteria);
    const ai = await askAI([m.masked]);
    const got = ai.results && ai.results[0];

    $("#result").hidden = false;
    if (got) {
      $("#main-by").textContent = "AI · " + (ai.model || "");
      chips($("#main-chips"), got);
      $("#main-reason").textContent = got.reason || "";
      $("#note").hidden = true;
    } else {
      $("#main-by").textContent = "규칙";
      chips($("#main-chips"), rule);
      $("#main-reason").textContent = `분류: ${rule.why.category} · 감정: ${rule.why.sentiment} · 긴급도: ${rule.why.urgency}`;
      $("#note").hidden = false;
      $("#note").textContent = `AI 없이 규칙으로만 분류했습니다 — ${ai.reason || "AI 응답 없음"}`;
    }
    chips($("#rule-chips"), rule);
    $("#rule-reason").textContent = `분류: ${rule.why.category}`;
    $("#card-rule").hidden = !got;

    btn.disabled = false; btn.textContent = "분류하기";
  });

  // ── 채점 ───────────────────────────────────────────
  function pct(x) { return x.toFixed(x % 1 ? 1 : 0) + "%"; }

  function showScore(who, s) {
    $("#score-table").hidden = false;
    for (const k of ["category", "sentiment", "urgency"]) {
      document.querySelector(`[data-k="${who}-${k}"]`).textContent = pct(s.accuracy[k]);
    }
    document.querySelector(`[data-k="${who}-all"]`).textContent = `${s.n - s.wrong.length} / ${s.n}`;
    $("#wrong").hidden = false;
    $("#wrong-who").textContent = (who === "ai" ? "— AI" : "— 규칙") + " · 정답 → 판정";
    $("#wrong-list").innerHTML = s.wrong.slice(0, 15).map(w => {
      const diff = ["category", "sentiment", "urgency"].filter(k => w.got[k] !== w.want[k])
        .map(k => `${w.want[k]}→${w.got[k]}`).join(" · ");
      return `<li><span class="t">${w.text}</span><br><span class="d">${diff}${w.note ? " · " + w.note : ""}</span></li>`;
    }).join("") + (s.wrong.length > 15 ? `<li class="d">… 외 ${s.wrong.length - 15}건</li>` : "");
  }

  $("#btn-score-rule").addEventListener("click", () => {
    const s = Rules.score(S.test, r => Rules.classify(Mask.mask(r.text).masked, S.criteria));
    showScore("rule", s);
    $("#score-msg").hidden = true;
  });

  $("#btn-score-ai").addEventListener("click", async () => {
    const btn = $("#btn-score-ai");
    btn.disabled = true;
    const masked = S.test.map(r => Mask.mask(r.text).masked);
    const results = [];
    let usedModel = "";
    for (let i = 0; i < masked.length; i += 20) {
      btn.textContent = `AI 채점 중… ${i}/${masked.length}`;
      const r = await askAI(masked.slice(i, i + 20));
      usedModel = r.model || usedModel;
      if (!r.results) {
        $("#score-msg").hidden = false;
        $("#score-msg").textContent = `AI로 채점하지 못했습니다 — ${r.reason}`;
        btn.disabled = false; btn.textContent = "AI로 채점";
        return;
      }
      results.push(...r.results);
    }
    // 답을 못 받은 문장은 «오답»으로 센다 — 빠진 것을 빼고 세면 점수가 부풀려진다
    const miss = { category: "-", sentiment: "-", urgency: "-" };
    S.aiResults = results;
    const s = Rules.score(S.test, (r, i) => results[i] || miss);
    showScore("ai", s);
    $("#score-ai-head").textContent = usedModel ? "AI · " + usedModel : "AI";
    const blank = results.filter(x => !x).length;
    $("#score-msg").hidden = !blank;
    if (blank) $("#score-msg").textContent = `AI가 답하지 않은 문장 ${blank}건은 오답으로 셌습니다.`;
    $("#btn-download").hidden = false;
    btn.disabled = false; btn.textContent = "AI로 채점";
  });

  $("#btn-download").addEventListener("click", () => {
    const rows = S.test.map((r, i) => ({ id: r.id, text: r.text, 정답: r, AI: S.aiResults[i] }));
    const blob = new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ai_채점결과.json"; a.click();
  });

  // ── 기준 ───────────────────────────────────────────
  function renderCriteria() {
    const c = S.criteria;
    $("#owner").textContent = c.owner;
    $("#crit-cats").innerHTML = c.categories
      .map(x => `<tr><td>${x.name}</td><td>${x.definition}</td></tr>`).join("");
    $("#crit-priority").textContent = c.priority.join(" → ") + " 순서로 먼저 봅니다.";
    $("#crit-priority-reason").textContent = c.priority_reason;
    $("#crit-sent").textContent = c.sentiment.guide;
    $("#crit-urg").textContent = c.urgency.guide;
  }

  initModelPicker();
  load();
})();

