/* ============================================================
   前额叶训练中心 · 游戏逻辑
   纯前端 / 无依赖 / localStorage 持久化成绩
   包含：舒尔特方格 + Dual N-Back + Stroop 色词 + Go/No-Go
   ============================================================ */

(() => {
  "use strict";

  const STORE_KEY = "ptrainer_records_v1";
  const THEME_KEY = "ptrainer_theme";

  const LAYOUT_LABEL = { grid: "方形", circle: "圆形", triangle: "三角形", nested: "多层嵌套", hexagon: "蜂巢", radial: "圆盘", irregular: "变式" };
  const ORDER_LABEL = { asc: "正序", desc: "倒序" };
  const CHANNEL_LABEL = { dual: "双通道", visual: "仅视觉", audio: "仅听觉" };

  // ---------- 游戏注册表（Phase 0：数据驱动的游戏库） ----------
  // 每个游戏声明元数据 + 其设置面板/舞台元素 id + 生命周期钩子（reset 停止并复位，idle 重建预览）。
  // 新增游戏只需在此登记一项，并在历史 filterGame 中加入对应选项即可，无需改动切换逻辑。
  const GAMES = [
    {
      id: "schulte", name: "舒尔特方格", domain: "注意", domainLabel: "视觉搜索", icon: "▦",
      desc: "按序快速定位数字，训练视觉搜索速度与选择性注意。",
      settings: "schulteSettings", stage: "schulteStage", reset: S_reset, idle: S_refreshIdle,
    },
    {
      id: "nback", name: "Dual N-Back", domain: "记忆", domainLabel: "工作记忆", icon: "◉",
      desc: "同时记忆位置与声音刺激，训练工作记忆的维持与在线更新。",
      settings: "nbackSettings", stage: "nbackStage", reset: nbReset, idle: nbIdle,
    },
    {
      id: "stroop", name: "Stroop 色词", domain: "抑制", domainLabel: "抑制控制", icon: "🎨",
      desc: "忽略字义、只认字的颜色，训练对优势反应的抑制能力。",
      settings: "stroopSettings", stage: "stroopStage", reset: spReset, idle: spReset,
    },
    {
      id: "gonogo", name: "Go/No-Go", domain: "抑制", domainLabel: "反应抑制", icon: "🛑",
      desc: "看见 GO 就反应、看见停就忍住，训练对优势反应的运动抑制。",
      settings: "gonogoSettings", stage: "gonogoStage", reset: gnReset, idle: gnReset,
    },
    {
      id: "flanker", name: "Flanker 任务", domain: "注意", domainLabel: "选择性注意", icon: "↔",
      desc: "只看中间箭头的朝向、忽略两侧干扰箭头，训练抗干扰的集中注意能力。",
      settings: "flankerSettings", stage: "flankerStage", reset: flReset, idle: flReset,
    },
  ];
  const GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));

  // ---------- 安全持久化（file:// 下部分浏览器会禁用 localStorage） ----------
  const memStore = {};
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return k in memStore ? memStore[k] : null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { memStore[k] = v; } };
  const lsRemove = (k) => { try { localStorage.removeItem(k); } catch (e) { delete memStore[k]; } };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);

  // ---------- 工具 ----------
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const fmtTime = (ms) => {
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + "s";
    const m = Math.floor(s / 60);
    const r = (s - m * 60).toFixed(1);
    return `${m}:${r.padStart(4, "0")}`;
  };
  const clampInt = (v, min, max, def) => { let n = parseInt(v, 10); if (isNaN(n)) n = def; return Math.min(max, Math.max(min, n)); };
  const rnd = (min, max) => Math.random() * (max - min) + min;
  const FONT_CLASSES = ["font-round", "font-serif", "font-mono", "font-cond"];
  const COLORS = ["#6c8cff", "#b06cff", "#36d399", "#ffcc66", "#ff6b81", "#4dd0e1", "#ff9f6c", "#a0d468", "#ec407a", "#7e9cff", "#f06292", "#4db6ac"];
  const ZONE_COLORS = ["rgba(255,107,129,0.25)", "rgba(108,140,255,0.25)", "rgba(54,211,153,0.25)", "rgba(255,204,102,0.25)", "rgba(176,108,255,0.25)", "rgba(77,208,225,0.25)", "rgba(255,159,108,0.25)", "rgba(160,212,104,0.25)"];

  // ---------- 音效（WebAudio + 语音合成） ----------
  let audioCtx = null;
  function beep(freq = 660, dur = 0.08, type = "sine", gain = 0.06) {
    if (!state_sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = gain;
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* ignore */ }
  }
  const LETTERS = ["A", "B", "C", "D", "E", "H", "K", "M", "Q", "R", "S", "T"];
  function speakLetter(idx) {
    if (!state_sound) return;
    const ch = LETTERS[idx % LETTERS.length];
    try {
      if (window.speechSynthesis) {
        const u = new SpeechSynthesisUtterance(ch);
        u.lang = "en-US"; u.rate = 1.0; u.pitch = 1.0;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        return;
      }
    } catch (e) { /* fall through */ }
    // 无语音合成时的音高回退
    const f = 300 + (idx % LETTERS.length) * 45;
    beep(f, 0.35, "triangle", 0.07);
  }

  let state_sound = true;

  // ============================================================
  //  历史记录（统一存储，按 game 区分）
  // ============================================================
  function loadRecords() { try { return JSON.parse(lsGet(STORE_KEY)) || []; } catch (e) { return []; } }
  function saveRecord(rec) { const list = loadRecords(); list.unshift(rec); if (list.length > 200) list.length = 200; lsSet(STORE_KEY, JSON.stringify(list)); renderHistory(); }
  function fmtMetric(r) { return r.unit === "ms" ? fmtTime(r.metric) : Math.round(r.metric) + "%"; }

  function renderHistory() {
    const all = loadRecords();
    const fg = $("filterGame").value;
    const fl = $("filterLayout").value;
    const fo = $("filterOrder").value;
    const list = $("historyList");
    const empty = $("historyEmpty");

    const matchGame = (r) => fg === "all" || r.game === fg;
    const matchSchulte = (r) => (fl === "all" || r.layout === fl) && (fo === "all" || r.order === fo);
    const filtered = all.filter((r) => matchGame(r) && (r.game !== "schulte" || matchSchulte(r)));

    // ---- 统计 ----
    let statsHtml = "";
    if (fg === "all") {
      const sc = all.filter((r) => r.game === "schulte").length;
      const nb = all.filter((r) => r.game === "nback").length;
      const sp = all.filter((r) => r.game === "stroop").length;
      const gn = all.filter((r) => r.game === "gonogo").length;
      const fl = all.filter((r) => r.game === "flanker").length;
      const done = all.filter((r) => r.success).length;
      const rate = all.length ? Math.round((done / all.length) * 100) + "%" : "—";
      statsHtml = `
        <div class="stat"><div class="v">${all.length}</div><div class="l">总场次</div></div>
        <div class="stat"><div class="v">${sc}</div><div class="l">舒尔特</div></div>
        <div class="stat"><div class="v">${nb}</div><div class="l">N-Back</div></div>
        <div class="stat"><div class="v">${sp}</div><div class="l">Stroop</div></div>
        <div class="stat"><div class="v">${gn}</div><div class="l">Go/No-Go</div></div>
        <div class="stat"><div class="v">${fl}</div><div class="l">Flanker</div></div>
        <div class="stat"><div class="v">${rate}</div><div class="l">完成率</div></div>`;
    } else {
      const best = filtered.length ? filtered.reduce((a, b) => (a.metric === b.metric ? a : (a.betterIsLower ? (a.metric <= b.metric ? a : b) : (a.metric >= b.metric ? a : b)))) : null;
      const avg = filtered.length ? filtered.reduce((a, b) => a + b.metric, 0) / filtered.length : 0;
      const done = filtered.filter((r) => r.success).length;
      const rate = filtered.length ? Math.round((done / filtered.length) * 100) + "%" : "—";
      statsHtml = `
        <div class="stat"><div class="v">${filtered.length}</div><div class="l">总场次</div></div>
        <div class="stat"><div class="v">${best ? fmtMetric(best) : "—"}</div><div class="l">最佳${best ? best.metricLabel : ""}</div></div>
        <div class="stat"><div class="v">${filtered.length ? fmtMetric({ metric: avg, unit: filtered[0].unit }) : "—"}</div><div class="l">平均</div></div>
        <div class="stat"><div class="v">${rate}</div><div class="l">完成率</div></div>`;
    }
    $("historyStats").innerHTML = statsHtml;

    // ---- 列表 ----
    list.innerHTML = "";
    empty.classList.toggle("hidden", filtered.length > 0);
    filtered.forEach((r) => {
      const li = document.createElement("li");
      li.className = "history-item";
      const gameBadge = r.game === "schulte" ? "舒尔特" : (r.game === "nback" ? "N-Back" : (r.game === "stroop" ? "Stroop" : (r.game === "gonogo" ? "Go/No-Go" : "Flanker")));
      const resTxt = r.success
        ? (r.game === "nback" ? "达标" : "完成")
        : (r.game === "schulte" ? `弃 ${r.found}/${r.count}` : "提前结束");
      const resCls = r.success ? "res-ok" : "res-fail";
      let tag2 = "", meta = "";
      if (r.game === "schulte") {
        const modeTxt = r.mode === "timer" ? "定时" : "计时";
        const orderTxt = r.order === "desc" ? "倒" : "正";
        const offsetTxt = r.rangeOffset ? `偏${r.rangeStart}` : "";
        const interfTxt = Object.entries(r.interf || {}).filter(([, v]) => v).map(([k]) => ({ color: "色", font: "字", jitter: "抖", mirror: "镜", zoneColor: "区", rotation: "转" }[k])).join("");
        tag2 = `<span class="mode-badge ${r.mode === "timer" ? "timer" : ""}">${modeTxt}</span><span class="mode-badge">${orderTxt}</span>`;
        meta = `${r.size}×${r.size}·${LAYOUT_LABEL[r.layout] || "方"}${offsetTxt ? "·" + offsetTxt : ""}${interfTxt ? "·" + interfTxt : ""}`;
      } else if (r.game === "nback") {
        tag2 = `<span class="mode-badge timer">N=${r.level}</span><span class="mode-badge">${CHANNEL_LABEL[r.channels] || "双"}</span>`;
        meta = `${r.trials} 试次`;
      } else if (r.game === "stroop") {
        const congLabel = { mixed: "混合", incongruent: "仅不一致", congruent: "仅一致" }[r.congruency] || "混合";
        const limitLabel = r.perLimit ? `${r.perLimit / 1000}s/题` : "不限时";
        tag2 = `<span class="mode-badge timer">${congLabel}</span>`;
        meta = `${r.trials} 试次·${limitLabel}`;
      } else if (r.game === "gonogo") {
        const winLabel = r.windowMs ? `${r.windowMs}ms窗口` : "";
        const goLabel = r.goRatio ? `GO${r.goRatio}%` : "";
        tag2 = `<span class="mode-badge timer">反应抑制</span>`;
        meta = `${r.trials} 试次·${winLabel}${goLabel ? "·" + goLabel : ""}`;
      } else {
        const congLabel = { mixed: "混合", incongruent: "仅不一致", congruent: "仅一致", neutral: "中性" }[r.congruency] || "混合";
        const arrowLabel = `${r.flankerN * 2 + 1} 箭头`;
        const limitLabel = r.perLimit ? `${r.perLimit / 1000}s/题` : "不限时";
        tag2 = `<span class="mode-badge timer">${congLabel}</span>`;
        meta = `${r.trials} 试次·${arrowLabel}·${limitLabel}`;
      }
      const d = new Date(r.date);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const rtExtra = ((r.game === "stroop" || r.game === "gonogo" || r.game === "flanker") && r.rtAvg) ? `<span>RT ${r.rtAvg}ms</span>` : "";
      li.innerHTML = `
        <div class="row1">
          <span><span class="game-badge">${gameBadge}</span>${tag2}&nbsp;${meta}</span>
          <span class="${resCls}">${resTxt}</span>
        </div>
        <div class="meta"><span>⏱ ${fmtMetric(r)}</span>${rtExtra}</div>
        <div class="date">${dateStr}</div>`;
      list.appendChild(li);
    });

    // ---- 趋势图 ----
    if (fg === "all") {
      $("trendChart").innerHTML = "";
      const ce = $("chartEmpty"); ce.classList.remove("hidden"); ce.textContent = "请选择具体游戏（舒尔特 / N-Back）以查看趋势图。";
    } else {
      const chartRecs = filtered.filter((r) => r.success).slice().sort((a, b) => a.date - b.date);
      drawChart(chartRecs);
    }
  }

  function drawChart(recs) {
    const svg = $("trendChart");
    const empty = $("chartEmpty");
    if (recs.length < 1) {
      svg.innerHTML = ""; empty.classList.remove("hidden");
      empty.textContent = "完成至少一局成功记录后显示趋势。";
      return;
    }
    empty.classList.add("hidden");
    const unit = recs[0].unit;
    const W = 300, H = 175, padL = 38, padR = 12, padT = 14, padB = 24;
    const pw = W - padL - padR, ph = H - padT - padB;
    const vals = recs.map((r) => r.metric);
    let minV = Math.min(...vals), maxV = Math.max(...vals);
    if (minV === maxV) { minV = minV * 0.85; maxV = maxV * 1.15; if (minV === maxV) minV = 0; }
    const n = recs.length;
    const X = (i) => padL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Y = (v) => padT + ph - ((v - minV) / (maxV - minV)) * ph;
    const fmtD = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
    const fmtV = (v) => (unit === "ms" ? fmtTime(v) : Math.round(v) + "%");
    const parts = [];
    const ticks = 3;
    for (let k = 0; k <= ticks; k++) {
      const v = minV + ((maxV - minV) * k) / ticks;
      const y = Y(v);
      parts.push(`<line class="grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`);
      parts.push(`<text class="ax" x="${padL - 5}" y="${y + 3}" text-anchor="end">${fmtV(v)}</text>`);
    }
    parts.push(`<text class="ax" x="${padL}" y="${H - 7}" text-anchor="middle">${fmtD(recs[0].date)}</text>`);
    if (n > 1) parts.push(`<text class="ax" x="${W - padR}" y="${H - 7}" text-anchor="middle">${fmtD(recs[n - 1].date)}</text>`);
    // 最佳基准线
    const bestRec = recs.reduce((a, b) => (a.metric === b.metric ? a : (recs[0].betterIsLower ? (a.metric <= b.metric ? a : b) : (a.metric >= b.metric ? a : b))));
    const bestY = Y(bestRec.metric);
    parts.push(`<line class="best" x1="${padL}" y1="${bestY}" x2="${W - padR}" y2="${bestY}"/>`);
    parts.push(`<text class="best-label" x="${W - padR}" y="${bestY - 4}" text-anchor="end">最佳 ${fmtV(bestRec.metric)}</text>`);
    const pts = recs.map((r, i) => `${X(i)},${Y(r.metric)}`).join(" ");
    parts.push(`<polyline class="trend" points="${pts}"/>`);
    recs.forEach((r, i) => parts.push(`<circle class="dot" cx="${X(i)}" cy="${Y(r.metric)}" r="3.2"/>`));
    svg.innerHTML = parts.join("");
  }

  $("clearHistory").addEventListener("click", () => { if (confirm("确定清空所有历史成绩？此操作不可撤销。")) { lsRemove(STORE_KEY); renderHistory(); } });
  ["filterGame", "filterLayout", "filterOrder"].forEach((id) => $(id).addEventListener("change", renderHistory));

  // ============================================================
  //  游戏切换（数据驱动：基于 GAMES 注册表）
  // ============================================================
  let currentGame = "schulte";
  function renderGameLibrary() {
    const groups = $("glGroups");
    const q = ($("glSearch").value || "").trim().toLowerCase();
    groups.innerHTML = "";
    const items = GAMES.filter((gm) => !q || (gm.name + " " + gm.desc + " " + gm.domainLabel + " " + gm.domain).toLowerCase().includes(q));
    if (!items.length) { groups.innerHTML = `<p class="gl-empty">未找到匹配的训练游戏。</p>`; return; }
    const cards = document.createElement("div");
    cards.className = "gl-cards";
    items.forEach((gm) => {
      const card = document.createElement("button");
      card.className = "gl-card" + (gm.id === currentGame ? " active" : "");
      card.dataset.game = gm.id;
      card.innerHTML = `<span class="gl-icon">${gm.icon}</span>`
        + `<span class="gl-domain">${gm.domainLabel}</span>`
        + `<span class="gl-name">${gm.name}</span>`
        + `<span class="gl-desc">${gm.desc}</span>`;
      cards.appendChild(card);
    });
    groups.appendChild(cards);
  }
  function switchGame(g) {
    if (g === currentGame || !GAME_BY_ID[g]) return;
    const prev = GAME_BY_ID[currentGame];
    if (prev && prev.reset) prev.reset();           // 停止并复位上一游戏
    currentGame = g;
    document.querySelectorAll(".gl-card").forEach((c) => c.classList.toggle("active", c.dataset.game === g));
    GAMES.forEach((gm) => {
      $(gm.settings).classList.toggle("hidden", gm.id !== g);
      $(gm.stage).classList.toggle("hidden", gm.id !== g);
    });
    $("filterGame").value = g;
    const cur = GAME_BY_ID[g];
    if (cur && cur.idle) cur.idle();
    renderHistory();
  }
  $("glSearch").addEventListener("input", renderGameLibrary);
  $("glGroups").addEventListener("click", (e) => { const card = e.target.closest(".gl-card"); if (card) switchGame(card.dataset.game); });

  // ============================================================
  //  模式一：舒尔特方格
  // ============================================================
  const S = {
    size: 5, mode: "count", timeLimit: 60, layout: "grid", order: "asc",
    rangeOffset: false, rangeStart: 26,
    interf: { color: false, font: false, jitter: false, mirror: false, zoneColor: false, rotation: false },
    running: false, paused: false, finished: false,
    numbers: [], count: 0, next: 1, step: 1, elapsed: 0, rafId: null, lastTick: 0, remain: 0,
  };
  const Sboard = $("board");
  const Soverlay = $("overlay"), SoverlayEmoji = $("overlayEmoji"), SoverlayTitle = $("overlayTitle"), SoverlayDesc = $("overlayDesc"), SoverlayStart = $("overlayStart");
  const targetNumEl = $("targetNum"), timeLabelEl = $("timeLabel"), timeValueEl = $("timeValue"), progressValueEl = $("progressValue");
  const SstartBtn = $("startBtn"), SpauseBtn = $("pauseBtn"), SresumeBtn = $("resumeBtn"), SresetBtn = $("resetBtn"), SendBtn = $("endBtn");
  const SrangeOffset = $("rangeOffset"), SrangeStart = $("rangeStart"), SrangeStartWrap = $("rangeStartWrap");

  function S_computeLayout(layout, size) {
    let count, coords = [], cell;
    if (layout === "grid") {
      count = size * size;
      coords = Array.from({ length: count }, (_, i) => ({ x: ((i % size) + 0.5) / size * 100, y: (Math.floor(i / size) + 0.5) / size * 100 }));
      cell = (86 / size);
    } else if (layout === "circle") {
      count = size * size; const R = 42;
      coords = Array.from({ length: count }, (_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / count; return { x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a) }; });
      cell = Math.min((2 * Math.PI * R) / count * 0.82, 18);
    } else if (layout === "triangle") {
      const rows = size; count = (rows * (rows + 1)) / 2; const sp = 80 / rows; coords = [];
      for (let r = 0; r < rows; r++) { const y = ((r + 0.5) / rows) * 100; for (let j = 0; j <= r; j++) coords.push({ x: 50 + (j - r / 2) * sp, y }); }
    } else if (layout === "hexagon") {
      const rows = size, cols = size; count = rows * cols;
      const s = Math.min(100 / (cols * 1.5 + 0.5), 100 / (rows * 1.732 + 0.866));
      const dx = 1.5 * s, dy = Math.sqrt(3) * s;
      const ox = (100 - (cols - 1) * dx) / 2, oy = (100 - (rows - 1) * dy) / 2; coords = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) coords.push({ x: ox + c * dx + (r % 2) * dx * 0.5, y: oy + r * dy });
      cell = s * 1.1;
    } else if (layout === "radial") {
      const rings = size, sectors = size; count = rings * sectors; const Rmax = 44;
      for (let k = 0; k < rings; k++) { const radius = ((k + 0.5) / rings) * Rmax; for (let j = 0; j < sectors; j++) { const a = -Math.PI / 2 + (j * 2 * Math.PI) / sectors; coords.push({ x: 50 + radius * Math.cos(a), y: 50 + radius * Math.sin(a) }); } }
      cell = Math.min((2 * Math.PI * Rmax) / sectors * 0.75, (Rmax / rings) * 0.85, 16);
    } else if (layout === "irregular") {
      count = size * size;
      coords = Array.from({ length: count }, (_, i) => ({ x: ((i % size) + 0.5) / size * 100, y: (Math.floor(i / size) + 0.5) / size * 100 }));
      cell = (86 / size);
    } else {
      count = size * size; const Rmax = 44; const R = Math.max(2, Math.round(Math.sqrt(count) / 2));
      const weights = Array.from({ length: R }, (_, k) => k + 1); const wsum = weights.reduce((a, b) => a + b, 0);
      let counts = weights.map((w) => Math.max(1, Math.round((count * w) / wsum))); let guard = 0, diff = count - counts.reduce((a, b) => a + b, 0);
      while (diff !== 0 && guard++ < 2000) { const i = diff > 0 ? R - 1 : 0; counts[i] += Math.sign(diff); diff = count - counts.reduce((a, b) => a + b, 0); }
      const Rmax2 = 44;
      for (let k = 0; k < R; k++) { const cr = counts[k]; const radius = ((k + 0.5) / R) * Rmax2; const offset = (k % 2) * (Math.PI / cr); for (let j = 0; j < cr; j++) { const a = offset + (j * 2 * Math.PI) / cr; coords.push({ x: 50 + radius * Math.cos(a), y: 50 + radius * Math.sin(a) }); } }
      cell = Math.min((2 * Math.PI * Rmax2) / counts[R - 1] * 0.8, 16);
    }
    return { count, coords, cell: Math.max(cell, 6) };
  }

  let ScellEls = [];
  function S_applyLayout() {
    const { count, coords, cell } = S_computeLayout(S.layout, S.size);
    while (ScellEls.length < count) {
      const el = document.createElement("div"); el.className = "cell";
      const span = document.createElement("span"); span.className = "num"; el.appendChild(span);
      el.addEventListener("click", () => S_onCellClick(parseInt(el.dataset.num, 10), el));
      Sboard.appendChild(el); ScellEls.push(el);
    }
    while (ScellEls.length > count) { const el = ScellEls.pop(); el.style.opacity = "0"; setTimeout(() => el.remove(), 420); }
    for (let i = 0; i < count; i++) {
      const el = ScellEls[i]; const num = S.numbers[i];
      el.dataset.num = num; el.querySelector(".num").textContent = num;
      const p = coords[i];
      el.style.left = p.x + "%"; el.style.top = p.y + "%"; el.style.width = cell + "%"; el.style.height = cell + "%";
      el.style.fontSize = (cell * 0.34) + "vmin"; el.style.opacity = "1"; el.style.pointerEvents = "auto";
      S_styleCell(el, num, i);
      if (S.layout === "hexagon") el.style.clipPath = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";
      else if (S.layout === "irregular") {
        const pts = [[rnd(0, 12), rnd(0, 12)], [rnd(88, 100), rnd(0, 12)], [rnd(88, 100), rnd(88, 100)], [rnd(0, 12), rnd(88, 100)]];
        el.style.clipPath = `polygon(${pts.map(([x, y]) => x + "% " + y + "%").join(", ")})`;
      } else el.style.clipPath = "";
    }
    S.count = count;
    Sboard.className = "board";
    if (S.interf.jitter) Sboard.classList.add("jitter");
    if (S.interf.rotation) Sboard.classList.add("rotate");
  }
  function S_styleCell(el, num, i) {
    const span = el.querySelector(".num");
    if (S.interf.color) span.style.color = COLORS[num % COLORS.length]; else span.style.color = "";
    FONT_CLASSES.forEach((f) => span.classList.remove(f));
    if (S.interf.font) span.classList.add(FONT_CLASSES[num % FONT_CLASSES.length]);
    el.classList.toggle("mirror", S.interf.mirror && num % 2 === 0);
    if (S.interf.zoneColor) el.style.backgroundColor = ZONE_COLORS[S_zoneFor(i) % ZONE_COLORS.length]; else el.style.backgroundColor = "";
  }
  function S_zoneFor(i) {
    const { count } = S_computeLayout(S.layout, S.size);
    if (S.layout === "grid") { const row = Math.floor(i / S.size), col = i % S.size; return (row < S.size / 2 ? 0 : 2) + (col < S.size / 2 ? 0 : 1); }
    if (S.layout === "triangle") { const row = Math.floor((Math.sqrt(8 * i + 1) - 1) / 2); return row; }
    if (S.layout === "hexagon") return Math.floor(i / S.size);
    return Math.floor((i / count) * 4) % 4;
  }
  function S_buildBoard() {
    const { count } = S_computeLayout(S.layout, S.size);
    const start = S.rangeOffset ? S.rangeStart : 1;
    S.numbers = shuffle(Array.from({ length: count }, (_, i) => start + i));
    S_applyLayout();
  }
  function S_updateAllInterferences() {
    ScellEls.forEach((el, i) => S_styleCell(el, parseInt(el.dataset.num, 10), i));
    Sboard.classList.toggle("jitter", S.interf.jitter);
    Sboard.classList.toggle("rotate", S.interf.rotation);
  }
  const S_effStart = () => (S.rangeOffset ? Math.max(1, S.rangeStart) : 1);
  const S_effEnd = () => S_effStart() + S.count - 1;
  function S_updateProgress() {
    const total = S.count; let done, t;
    if (S.order === "asc") { done = S.next - S_effStart(); t = S.next; if (S.next > S_effEnd()) t = "✓"; }
    else { done = S_effEnd() - S.next; t = S.next; if (S.next < S_effStart()) t = "✓"; }
    progressValueEl.textContent = `${Math.max(0, done)} / ${total}`;
    targetNumEl.textContent = t;
  }
  function S_onCellClick(num, cell) {
    if (!S.running || S.paused || S.finished) return;
    if (num === S.next) {
      cell.style.pointerEvents = "none"; S.next += S.step; beep(740, 0.07, "sine"); S_updateProgress();
      const finished = S.order === "asc" ? S.next > S_effEnd() : S.next < S_effStart();
      if (finished) S_finishGame("success");
    } else {
      cell.classList.remove("wrong"); void cell.offsetWidth; cell.classList.add("wrong"); beep(200, 0.12, "square", 0.05);
      setTimeout(() => cell.classList.remove("wrong"), 350);
    }
  }
  function S_tick(now) {
    if (!S.running || S.paused) return;
    const dt = now - S.lastTick; S.lastTick = now;
    if (S.mode === "timer") {
      S.remain -= dt;
      if (S.remain <= 0) { S.remain = 0; timeValueEl.textContent = "0.0s"; S_finishGame("timeout"); return; }
      timeValueEl.textContent = fmtTime(S.remain);
      timeValueEl.closest(".hud-item").classList.toggle("danger", S.remain < 10000);
    } else { S.elapsed += dt; timeValueEl.textContent = fmtTime(S.elapsed); }
    S.rafId = requestAnimationFrame(S_tick);
  }
  function S_startClock() { S.lastTick = performance.now(); S.rafId = requestAnimationFrame(S_tick); }
  function S_stopClock() { if (S.rafId) cancelAnimationFrame(S.rafId); S.rafId = null; }
  function S_startGame() {
    if (state_sound) beep(880, 0.1, "sine");
    S_buildBoard(); S.running = true; S.paused = false; S.finished = false;
    S.step = S.order === "asc" ? 1 : -1; S.next = S.order === "asc" ? S_effStart() : S_effEnd();
    S.elapsed = 0; S.remain = S.timeLimit * 1000;
    timeValueEl.textContent = S.mode === "timer" ? fmtTime(S.remain) : "0.0s";
    timeValueEl.closest(".hud-item").classList.remove("danger");
    Soverlay.classList.add("hidden");
    SstartBtn.disabled = true; SpauseBtn.disabled = false; SresumeBtn.disabled = true; SresetBtn.disabled = false; SendBtn.disabled = false;
    S_updateProgress(); S_startClock();
  }
  function S_pauseGame() {
    if (!S.running || S.paused) return; S.paused = true; S_stopClock(); SpauseBtn.disabled = true; SresumeBtn.disabled = false;
    S_showOverlay("⏸", "已暂停", "点击「恢复」继续训练。", "继续", false); if (state_sound) beep(520, 0.1, "sine");
  }
  function S_resumeGame() {
    if (!S.running || !S.paused) return; S.paused = false; Soverlay.classList.add("hidden"); SpauseBtn.disabled = false; SresumeBtn.disabled = true; S_startClock(); if (state_sound) beep(620, 0.1, "sine");
  }
  function S_reset() {
    S_stopClock(); S.running = false; S.paused = false; S.finished = false;
    SstartBtn.disabled = false; SpauseBtn.disabled = true; SresumeBtn.disabled = true; SresetBtn.disabled = false; SendBtn.disabled = true;
    S_showOverlay("◧", "准备开始", S_idleDesc(), "开始训练", true); S_refreshIdle();
  }
  function S_endGame() { if (!S.running || S.finished) return; S_finishGame("manual"); }
  function S_finishGame(reason) {
    S_stopClock(); S.running = false; S.finished = true;
    SpauseBtn.disabled = true; SresumeBtn.disabled = true; SstartBtn.disabled = false; SendBtn.disabled = true;
    const total = S.count; const isTimer = S.mode === "timer";
    const usedMs = isTimer ? S.timeLimit * 1000 - S.remain : S.elapsed;
    const success = reason === "success";
    const found = S.order === "asc" ? S.next - S_effStart() : S_effEnd() - S.next;
    if (success) {
      Sboard.classList.add("solved"); beep(990, 0.12, "sine"); setTimeout(() => beep(1320, 0.16, "sine"), 120);
      const title = isTimer ? "时间到前完成！" : "全部完成！";
      const desc = isTimer ? `在限定时间内完成，用时 ${fmtTime(usedMs)}。` : `你完成了全部 ${total} 个方格，用时 ${fmtTime(usedMs)}。`;
      S_showOverlay("🎉", title, desc, "再来一局", true);
    } else {
      beep(180, 0.25, "square", 0.06);
      const isTimeout = reason === "timeout"; const emoji = isTimeout ? "⏰" : "🏁"; const title = isTimeout ? "时间到" : "已结束本轮";
      const desc = `本局未完成。已找到 ${Math.max(0, found)} / ${total} 个数字，用时 ${fmtTime(usedMs)}。`;
      S_showOverlay(emoji, title, desc, "再来一局", true);
    }
    saveRecord({ game: "schulte", mode: S.mode, size: S.size, count: total, layout: S.layout, order: S.order, rangeOffset: S.rangeOffset, rangeStart: S.rangeStart, success, metric: Math.round(usedMs), unit: "ms", metricLabel: "用时", betterIsLower: true, timeMs: Math.round(usedMs), found: Math.max(0, found), interf: { ...S.interf }, date: Date.now() });
  }
  function S_showOverlay(emoji, title, desc, btnText, startAction) {
    SoverlayEmoji.textContent = emoji; SoverlayTitle.textContent = title; SoverlayDesc.textContent = desc; SoverlayStart.textContent = btnText;
    SoverlayStart.dataset.action = startAction ? "start" : "resume"; Soverlay.classList.remove("hidden");
  }
  function S_idleDesc() {
    const start = S_effStart(), end = S_effEnd();
    const range = S.order === "asc" ? `${start} 到 ${end}` : `${end} 到 ${start}`;
    const offsetTip = S.rangeOffset ? `（偏移）` : "";
    return `点击「开始」后，按${ORDER_LABEL[S.order]}依次点击数字 ${range}${offsetTip}（${LAYOUT_LABEL[S.layout]}布局）。`;
  }
  SoverlayStart.addEventListener("click", () => { if (SoverlayStart.dataset.action === "start") S_startGame(); else S_resumeGame(); });
  function S_refreshIdle() {
    if (S.running) return;
    S.rangeStart = Math.max(1, parseInt(SrangeStart.value, 10) || 1);
    S.count = S_computeLayout(S.layout, S.size).count;
    S.step = S.order === "asc" ? 1 : -1; S.next = S.order === "asc" ? S_effStart() : S_effEnd();
    timeLabelEl.textContent = S.mode === "timer" ? "剩余" : "用时";
    timeValueEl.textContent = S.mode === "timer" ? fmtTime(S.timeLimit * 1000) : "0.0s";
    S_buildBoard(); ScellEls.forEach((c) => (c.style.pointerEvents = "none")); S_updateProgress();
  }
  function S_bindSeg(segId, attr, cb) {
    const seg = $(segId);
    seg.addEventListener("click", (e) => { const btn = e.target.closest(".seg-btn"); if (!btn) return; seg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); cb(btn.dataset[attr]); });
  }
  S_bindSeg("sizeSeg", "size", (v) => { const wrap = $("customSizeWrap"); if (v === "custom") { wrap.classList.remove("hidden"); S.size = clampInt($("customSize").value, 2, 15, 5); } else { wrap.classList.add("hidden"); S.size = parseInt(v, 10); } S_refreshIdle(); });
  S_bindSeg("modeSeg", "mode", (v) => { S.mode = v; $("timerWrap").classList.toggle("hidden", v !== "timer"); S_refreshIdle(); });
  S_bindSeg("layoutSeg", "layout", (v) => { S.layout = v; S_refreshIdle(); });
  S_bindSeg("orderSeg", "order", (v) => { S.order = v; S_refreshIdle(); });
  $("customSize").addEventListener("input", (e) => { if ($("sizeSeg").querySelector(".seg-btn.active").dataset.size === "custom") { S.size = clampInt(e.target.value, 2, 15, 5); S_refreshIdle(); } });
  $("timeLimit").addEventListener("input", (e) => { S.timeLimit = clampInt(e.target.value, 5, 600, 60); });
  SrangeOffset.addEventListener("change", (e) => { S.rangeOffset = e.target.checked; SrangeStartWrap.classList.toggle("hidden", !e.target.checked); S_refreshIdle(); });
  SrangeStart.addEventListener("input", (e) => { S.rangeStart = Math.max(1, parseInt(e.target.value, 10) || 1); S_refreshIdle(); });
  ["interfColor", "interfFont", "interfJitter", "interfMirror", "interfZoneColor", "interfRotation"].forEach((id) => {
    const key = id.replace("interf", "").replace(/^./, (c) => c.toLowerCase());
    $(id).addEventListener("change", (e) => { S.interf[key] = e.target.checked; if (S.running || S.finished) S_updateAllInterferences(); });
  });
  SstartBtn.addEventListener("click", S_startGame);
  SpauseBtn.addEventListener("click", S_pauseGame);
  SresumeBtn.addEventListener("click", S_resumeGame);
  SresetBtn.addEventListener("click", S_reset);
  SendBtn.addEventListener("click", S_endGame);

  // ============================================================
  //  模式二：Dual N-Back
  // ============================================================
  const NB = { running: false, paused: false, finished: false, N: 2, trials: 20, interval: 2500, channels: "dual", adapt: true, seqPos: [], seqAud: [], t: 0, posResp: false, audResp: false, posCorrect: 0, posTotal: 0, audCorrect: 0, audTotal: 0, timers: [] };
  const NBgrid = $("nbackGrid"), NBoL = $("nbLevelVal"), NBtrial = $("nbTrialVal"), NBposAcc = $("nbPosAccVal"), NBaulAcc = $("nbAudAccVal");
  const NBoverlay = $("nbOverlay"), NBoe = $("nbOverlayEmoji"), NBot = $("nbOverlayTitle"), NBod = $("nbOverlayDesc"), NBos = $("nbOverlayStart");
  const NBstart = $("nbStartBtn"), NBpause = $("nbPauseBtn"), NBresume = $("nbResumeBtn"), NBend = $("nbEndBtn"), NBreset = $("nbResetBtn");
  const NBposBtn = $("nbPosBtn"), NBadBtn = $("nbAudBtn"), NBaucue = $("nbAudioCue");
  let NBcells = [];

  function nbBuildGrid() {
    NBgrid.innerHTML = "";
    NBcells = [];
    for (let i = 0; i < 9; i++) { const c = document.createElement("div"); c.className = "nb-cell"; NBgrid.appendChild(c); NBcells.push(c); }
  }
  function nbClearTimers() { NB.timers.forEach((id) => clearTimeout(id)); NB.timers = []; }
  function nbActiveChannel(which) { return NB.channels === "dual" || NB.channels === which; }
  function nbUpdateAcc() {
    NBposAcc.textContent = NB.posTotal ? Math.round(NB.posCorrect / NB.posTotal * 100) + "%" : "—";
    NBaulAcc.textContent = NB.audTotal ? Math.round(NB.audCorrect / NB.audTotal * 100) + "%" : "—";
  }
  function nbShowTrial(t) {
    if (t >= NB.trials) { nbFinish(false); return; }
    NB.t = t; NB.posResp = false; NB.audResp = false;
    NBoL.textContent = NB.N; NBtrial.textContent = `${Math.min(t + 1, NB.trials)}/${NB.trials}`;
    const stimDur = 500;
    if (nbActiveChannel("visual")) { NBcells[NB.seqPos[t]].classList.add("active"); NB.timers.push(setTimeout(() => NBcells[NB.seqPos[t]].classList.remove("active"), stimDur)); }
    if (nbActiveChannel("audio")) {
      NBaucue.classList.add("on"); speakLetter(NB.seqAud[t]);
      NB.timers.push(setTimeout(() => NBaucue.classList.remove("on"), stimDur));
    }
    NB.timers.push(setTimeout(() => { nbEvaluate(t); nbShowTrial(t + 1); }, NB.interval));
  }
  function nbEvaluate(t) {
    if (t < NB.N) return;
    const posMatch = NB.seqPos[t] === NB.seqPos[t - NB.N];
    const audMatch = NB.seqAud[t] === NB.seqAud[t - NB.N];
    if (nbActiveChannel("visual")) { NB.posTotal++; if (NB.posResp === posMatch) NB.posCorrect++; }
    if (nbActiveChannel("audio")) { NB.audTotal++; if (NB.audResp === audMatch) NB.audCorrect++; }
    nbUpdateAcc();
    NBposBtn.classList.remove("lit"); NBadBtn.classList.remove("lit");
  }
  function nbRespond(which) {
    if (!NB.running || NB.paused) return;
    if (which === "pos") { if (nbActiveChannel("visual")) { NB.posResp = true; NBposBtn.classList.add("lit"); } }
    else { if (nbActiveChannel("audio")) { NB.audResp = true; NBadBtn.classList.add("lit"); } }
  }
  function nbStart() {
    if (state_sound) beep(880, 0.1, "sine");
    NB.N = clampInt($("nbLevel").value, 1, 9, 2);
    NB.trials = clampInt($("nbTrials").value, 5, 60, 20);
    NB.interval = clampInt($("nbInterval").value, 1500, 5000, 2500);
    const chBtn = $("nbChannelSeg").querySelector(".seg-btn.active"); NB.channels = chBtn ? chBtn.dataset.channel : "dual";
    NB.adapt = $("nbAdapt").checked;
    NB.seqPos = Array.from({ length: NB.trials }, () => Math.floor(Math.random() * 9));
    NB.seqAud = Array.from({ length: NB.trials }, () => Math.floor(Math.random() * LETTERS.length));
    NB.posCorrect = NB.posTotal = NB.audCorrect = NB.audTotal = 0;
    NB.running = true; NB.paused = false; NB.finished = false;
    NBstart.disabled = true; NBpause.disabled = false; NBend.disabled = false; NBresume.disabled = true;
    NBposBtn.disabled = false; NBadBtn.disabled = false;
    nbUpdateAcc();
    NBoverlay.classList.add("hidden");
    nbShowTrial(0);
  }
  function nbPause() {
    if (!NB.running || NB.paused) return; NB.paused = true; nbClearTimers();
    NBpause.disabled = true; NBresume.disabled = false; NBposBtn.disabled = true; NBadBtn.disabled = true;
    nbShowOverlay("⏸", "已暂停", "点击「恢复」继续训练。", "继续", false); if (state_sound) beep(520, 0.1, "sine");
  }
  function nbResume() {
    if (!NB.running || !NB.paused) return; NB.paused = false; NBoverlay.classList.add("hidden");
    NBpause.disabled = false; NBresume.disabled = true; NBposBtn.disabled = false; NBadBtn.disabled = false;
    nbShowTrial(NB.t);
  }
  function nbReset() {
    nbClearTimers(); NB.running = false; NB.paused = false; NB.finished = false;
    NBstart.disabled = false; NBpause.disabled = true; NBend.disabled = true; NBresume.disabled = true;
    NBposBtn.disabled = true; NBadBtn.disabled = true; NBposBtn.classList.remove("lit"); NBadBtn.classList.remove("lit");
    nbBuildGrid(); NBoL.textContent = clampInt($("nbLevel").value, 1, 9, 2); NBtrial.textContent = `0/${clampInt($("nbTrials").value, 5, 60, 20)}`; NBposAcc.textContent = "—"; NBaulAcc.textContent = "—";
    nbShowOverlay("◉", "准备开始", "记住 N 步之前出现过的「位置」与「声音」，出现相同就按下对应匹配键（F / J）。", "开始训练", true);
  }
  function nbEnd() { if (!NB.running || NB.finished) return; nbFinish(true); }
  function nbFinish(manual) {
    nbClearTimers(); NB.running = false; NB.finished = true;
    NBpause.disabled = true; NBresume.disabled = true; NBstart.disabled = false; NBend.disabled = true;
    NBposBtn.disabled = true; NBadBtn.disabled = true; NBposBtn.classList.remove("lit"); NBadBtn.classList.remove("lit");
    const posAcc = NB.posTotal ? (NB.posCorrect / NB.posTotal) * 100 : 0;
    const audAcc = NB.audTotal ? (NB.audCorrect / NB.audTotal) * 100 : 0;
    const totalScored = NB.posTotal + NB.audTotal;
    const overall = totalScored ? (NB.posCorrect + NB.audCorrect) / totalScored * 100 : 0;
    if (!manual && NB.adapt) {
      if (posAcc >= 90 && audAcc >= 90 && NB.N < 9) NB.N++;
      else if ((posAcc < 70 || audAcc < 70) && NB.N > 1) NB.N--;
    }
    const success = !manual;
    saveRecord({ game: "nback", level: NB.N, channels: NB.channels, trials: NB.trials, success, metric: Math.round(overall), unit: "%", metricLabel: "正确率", betterIsLower: false, posAcc: Math.round(posAcc), audAcc: Math.round(audAcc), date: Date.now() });
    const emoji = success ? "🎉" : "🏁";
    const title = success ? "本轮完成！" : "已结束本轮";
    const desc = `位置正确率 ${Math.round(posAcc)}% · 声音正确率 ${Math.round(audAcc)}%${NB.adapt ? ` · 当前 N = ${NB.N}` : ""}`;
    nbShowOverlay(emoji, title, desc, "再来一局", true);
  }
  function nbShowOverlay(emoji, title, desc, btnText, startAction) {
    NBoe.textContent = emoji; NBot.textContent = title; NBod.textContent = desc; NBos.textContent = btnText;
    NBos.dataset.action = startAction ? "start" : "resume"; NBoverlay.classList.remove("hidden");
  }
  NBos.addEventListener("click", () => { if (NBos.dataset.action === "start") nbStart(); else nbResume(); });
  NBstart.addEventListener("click", nbStart);
  NBpause.addEventListener("click", nbPause);
  NBresume.addEventListener("click", nbResume);
  NBend.addEventListener("click", nbEnd);
  NBreset.addEventListener("click", nbReset);
  NBposBtn.addEventListener("click", () => nbRespond("pos"));
  NBadBtn.addEventListener("click", () => nbRespond("aud"));
  function nbBindSeg() {
    const seg = $("nbChannelSeg");
    seg.addEventListener("click", (e) => { const btn = e.target.closest(".seg-btn"); if (!btn) return; seg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); });
  }
  nbBindSeg();
  function nbIdle() { nbReset(); }

  // ============================================================
  //  模式三：Stroop 色词测验（抑制控制）
  // ============================================================
  const SP_COLORS = [
    { name: "红", hex: "#ff5d73" },
    { name: "绿", hex: "#2ecc71" },
    { name: "蓝", hex: "#4f8cff" },
    { name: "黄", hex: "#ffc233" },
  ];
  const SP_CONG_LABEL = { mixed: "混合", incongruent: "仅不一致", congruent: "仅一致" };
  const SP = {
    running: false, paused: false, finished: false, advancing: false,
    trials: 20, congruency: "mixed", perLimit: 0,
    t: 0, word: 0, ink: 0, trialStart: 0,
    correct: 0, total: 0, rtSum: 0, rtCount: 0,
    timerId: null, advanceId: null,
  };
  const SPword = $("spWord");
  const SPtrial = $("spTrialVal"), SPacc = $("spAccVal"), SPrt = $("spRtVal");
  const SPoverlay = $("spOverlay"), SPoe = $("spOverlayEmoji"), SPot = $("spOverlayTitle"), SPod = $("spOverlayDesc"), SPos = $("spOverlayStart");
  const SPstart = $("spStartBtn"), SPpause = $("spPauseBtn"), SPresume = $("spResumeBtn"), SPend = $("spEndBtn"), SPreset = $("spResetBtn");
  const SPbtns = Array.from(document.querySelectorAll(".sp-color-btn"));

  function spPickColors() {
    const word = Math.floor(Math.random() * 4);
    let ink;
    if (SP.congruency === "congruent") ink = word;
    else if (SP.congruency === "incongruent") { do { ink = Math.floor(Math.random() * 4); } while (ink === word); }
    else ink = Math.floor(Math.random() * 4);
    return { word, ink };
  }
  function spUpdateHud() {
    const shown = (SP.running || SP.finished) ? Math.min(SP.t + 1, SP.trials) : 0;
    SPtrial.textContent = `${shown}/${SP.trials}`;
    SPacc.textContent = SP.total ? Math.round((SP.correct / SP.total) * 100) + "%" : "—";
    SPrt.textContent = SP.rtCount ? Math.round(SP.rtSum / SP.rtCount) + "ms" : "—";
  }
  function spShowTrial(t) {
    if (t >= SP.trials) { spFinish(false); return; }
    SP.t = t; SP.advancing = false;
    const { word, ink } = spPickColors();
    SP.word = word; SP.ink = ink;
    SP.trialStart = performance.now();
    SPword.textContent = SP_COLORS[word].name;
    SPword.style.color = SP_COLORS[ink].hex;
    SPword.classList.remove("sp-correct", "sp-wrong");
    SPbtns.forEach((b) => (b.disabled = false));
    spUpdateHud();
    if (SP.perLimit > 0) SP.timerId = setTimeout(() => spRespond(-1), SP.perLimit);
  }
  function spRespond(choice) {
    if (!SP.running || SP.paused || SP.advancing) return;
    clearTimeout(SP.timerId);
    SP.advancing = true;
    const correct = choice === SP.ink;
    const rt = performance.now() - SP.trialStart;
    SP.total++;
    if (correct) { SP.correct++; SP.rtSum += rt; SP.rtCount++; if (state_sound) beep(740, 0.07, "sine"); }
    else { if (state_sound) beep(200, 0.12, "square", 0.05); }
    SPword.classList.add(correct ? "sp-correct" : "sp-wrong");
    if (choice >= 0) { const b = SPbtns[choice]; if (b) { b.classList.add(correct ? "lit-ok" : "lit-bad"); setTimeout(() => b.classList.remove("lit-ok", "lit-bad"), 300); } }
    spUpdateHud();
    SPbtns.forEach((b) => (b.disabled = true));
    SP.advanceId = setTimeout(() => { SP.advanceId = null; SPword.classList.remove("sp-correct", "sp-wrong"); spShowTrial(SP.t + 1); }, 300);
  }
  function spStart() {
    if (state_sound) beep(880, 0.1, "sine");
    SP.trials = clampInt($("spTrials").value, 5, 60, 20);
    const congBtn = $("spCongSeg").querySelector(".seg-btn.active");
    SP.congruency = (congBtn && congBtn.dataset.cong) || "mixed";
    SP.perLimit = clampInt($("spPerLimit").value, 0, 5000, 0);
    SP.correct = SP.total = SP.rtSum = SP.rtCount = 0; SP.t = 0; SP.advancing = false;
    SP.running = true; SP.paused = false; SP.finished = false;
    SPstart.disabled = true; SPpause.disabled = false; SPend.disabled = false; SPresume.disabled = true;
    SPoverlay.classList.add("hidden");
    spShowTrial(0);
  }
  function spPause() {
    if (!SP.running || SP.paused) return;
    SP.paused = true;
    clearTimeout(SP.timerId); clearTimeout(SP.advanceId); SP.advanceId = null;
    SPpause.disabled = true; SPresume.disabled = false;
    SPbtns.forEach((b) => (b.disabled = true));
    spShowOverlay("⏸", "已暂停", "点击「恢复」继续训练。", "继续", false);
    if (state_sound) beep(520, 0.1, "sine");
  }
  function spResume() {
    if (!SP.running || !SP.paused) return;
    SP.paused = false; SPoverlay.classList.add("hidden");
    SPpause.disabled = false; SPresume.disabled = true;
    spShowTrial(SP.advancing ? SP.t + 1 : SP.t);
  }
  function spReset() {
    clearTimeout(SP.timerId); clearTimeout(SP.advanceId); SP.advanceId = null;
    SP.running = false; SP.paused = false; SP.finished = false; SP.advancing = false;
    SPstart.disabled = false; SPpause.disabled = true; SPresume.disabled = true; SPend.disabled = true;
    SPbtns.forEach((b) => { b.disabled = true; b.classList.remove("lit-ok", "lit-bad"); });
    SPword.classList.remove("sp-correct", "sp-wrong");
    SPword.textContent = "色"; SPword.style.color = "";
    spUpdateHud();
    spShowOverlay("🎨", "准备开始", "看着「字的颜色」而非字义，从下方选出对应的颜色（也可按 1–4 键）。", "开始训练", true);
  }
  function spEnd() { if (!SP.running || SP.finished) return; spFinish(true); }
  function spFinish(manual) {
    clearTimeout(SP.timerId); clearTimeout(SP.advanceId); SP.advanceId = null;
    SP.running = false; SP.finished = true; SP.paused = false; SP.advancing = false;
    SPstart.disabled = false; SPpause.disabled = true; SPresume.disabled = true; SPend.disabled = true;
    SPbtns.forEach((b) => (b.disabled = true));
    const acc = SP.total ? (SP.correct / SP.total) * 100 : 0;
    const avgRt = SP.rtCount ? Math.round(SP.rtSum / SP.rtCount) : 0;
    const success = !manual;
    saveRecord({ game: "stroop", trials: SP.trials, congruency: SP.congruency, perLimit: SP.perLimit, success, metric: Math.round(acc), unit: "%", metricLabel: "正确率", betterIsLower: false, rtAvg: avgRt, date: Date.now() });
    const emoji = success ? "🎉" : "🏁";
    const title = success ? "本轮完成！" : "已结束本轮";
    const desc = `正确率 ${Math.round(acc)}% · 平均反应 ${avgRt}ms（共 ${SP.total} 题）`;
    spShowOverlay(emoji, title, desc, "再来一局", true);
  }
  function spShowOverlay(emoji, title, desc, btnText, startAction) {
    SPoe.textContent = emoji; SPot.textContent = title; SPod.textContent = desc; SPos.textContent = btnText;
    SPos.dataset.action = startAction ? "start" : "resume"; SPoverlay.classList.remove("hidden");
  }
  SPos.addEventListener("click", () => { if (SPos.dataset.action === "start") spStart(); else spResume(); });
  SPbtns.forEach((b) => b.addEventListener("click", () => spRespond(parseInt(b.dataset.color, 10))));
  SPstart.addEventListener("click", spStart);
  SPpause.addEventListener("click", spPause);
  SPresume.addEventListener("click", spResume);
  SPend.addEventListener("click", spEnd);
  SPreset.addEventListener("click", spReset);
  const SPcongSeg = $("spCongSeg");
  SPcongSeg.addEventListener("click", (e) => { const btn = e.target.closest(".seg-btn"); if (!btn) return; SPcongSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); SP.congruency = btn.dataset.cong; });
  $("spTrials").addEventListener("change", (e) => { SP.trials = clampInt(e.target.value, 5, 60, 20); spUpdateHud(); });
  $("spPerLimit").addEventListener("change", (e) => { SP.perLimit = clampInt(e.target.value, 0, 5000, 0); });

  // ============================================================
  //  模式四：Go/No-Go（反应抑制 / 运动抑制）
  // ============================================================
  const GN = {
    running: false, paused: false, finished: false, advancing: false,
    trials: 30, windowMs: 800, goRatio: 0.75,
    t: 0, isGo: true, responded: false, trialStart: 0,
    hits: 0, correctRej: 0, commissions: 0, omissions: 0, rtSum: 0, rtCount: 0, total: 0,
    seq: [], timerId: null, advanceId: null,
  };
  const gnStim = $("gnStim"), gnFeedback = $("gnFeedback");
  const gnTrial = $("gnTrialVal"), gnAcc = $("gnAccVal"), gnRt = $("gnRtVal");
  const gnOverlay = $("gnOverlay"), gnOe = $("gnOverlayEmoji"), gnot = $("gnOverlayTitle"), gnod = $("gnOverlayDesc"), gnos = $("gnOverlayStart");
  const gnStartBtn = $("gnStartBtn"), gnPauseBtn = $("gnPauseBtn"), gnResumeBtn = $("gnResumeBtn"), gnEndBtn = $("gnEndBtn"), gnResetBtn = $("gnResetBtn"), gnRespBtn = $("gnRespBtn");

  // 生成试次序列：保证 Go/No-Go 比例，且连续 No-Go 不超过 2 次
  function gnBuildSeq() {
    const n = GN.trials;
    const nGo = Math.round(n * GN.goRatio);
    const nNo = n - nGo;
    const base = Array(nGo).fill(true).concat(Array(nNo).fill(false));
    let seq = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const cand = shuffle(base.slice());
      let ok = true, consec = 0;
      for (const v of cand) { if (!v) { if (++consec >= 3) { ok = false; break; } } else consec = 0; }
      if (ok) { seq = cand; break; }
    }
    GN.seq = seq || shuffle(base.slice());
  }
  function gnUpdateHud() {
    const shown = (GN.running || GN.finished) ? Math.min(GN.t + 1, GN.trials) : 0;
    gnTrial.textContent = `${shown}/${GN.trials}`;
    const acc = GN.total ? ((GN.hits + GN.correctRej) / GN.total) * 100 : 0;
    gnAcc.textContent = GN.total ? Math.round(acc) + "%" : "—";
    gnRt.textContent = GN.rtCount ? Math.round(GN.rtSum / GN.rtCount) + "ms" : "—";
  }
  function gnShowTrial(t) {
    if (t >= GN.trials) { gnFinish(false); return; }
    GN.t = t; GN.advancing = false; GN.responded = false;
    const isGo = GN.seq[t]; GN.isGo = isGo;
    GN.trialStart = performance.now();
    gnStim.className = "gn-stim " + (isGo ? "go" : "nogo") + " show pop";
    gnStim.textContent = isGo ? "GO" : "停";
    gnFeedback.textContent = "";
    gnUpdateHud();
    GN.timerId = setTimeout(gnResolve, GN.windowMs);
  }
  function gnRespond() {
    if (!GN.running || GN.paused || GN.advancing) return;
    GN.responded = true;
    gnResolve();
  }
  function gnResolve() {
    if (!GN.running || GN.advancing) return;
    clearTimeout(GN.timerId);
    GN.advancing = true;
    const isGo = GN.isGo;
    const correct = isGo ? GN.responded : !GN.responded;
    GN.total++;
    if (isGo) {
      if (GN.responded) { GN.hits++; const rt = performance.now() - GN.trialStart; GN.rtSum += rt; GN.rtCount++; }
      else GN.omissions++;
    } else {
      if (GN.responded) GN.commissions++; else GN.correctRej++;
    }
    if (correct) { if (state_sound) beep(740, 0.07, "sine"); gnFeedback.textContent = "正确"; gnFeedback.className = "gn-feedback ok"; }
    else { if (state_sound) beep(200, 0.12, "square", 0.05); gnFeedback.textContent = isGo ? "漏按!" : "误按!"; gnFeedback.className = "gn-feedback bad"; }
    gnStim.classList.remove("show");
    gnUpdateHud();
    GN.advanceId = setTimeout(() => { GN.advanceId = null; gnFeedback.textContent = ""; gnShowTrial(GN.t + 1); }, 350);
  }
  function gnStart() {
    if (state_sound) beep(880, 0.1, "sine");
    GN.trials = clampInt($("gnTrials").value, 5, 60, 30);
    GN.windowMs = clampInt($("gnWindow").value, 400, 1500, 800);
    GN.goRatio = clampInt($("gnGoRatio").value, 50, 90, 75) / 100;
    GN.hits = GN.correctRej = GN.commissions = GN.omissions = GN.rtSum = GN.rtCount = GN.total = 0;
    GN.t = 0; GN.advancing = false; GN.responded = false;
    GN.running = true; GN.paused = false; GN.finished = false;
    gnStartBtn.disabled = true; gnPauseBtn.disabled = false; gnEndBtn.disabled = false; gnResumeBtn.disabled = true; gnRespBtn.disabled = false;
    gnBuildSeq();
    gnOverlay.classList.add("hidden");
    gnShowTrial(0);
  }
  function gnPause() {
    if (!GN.running || GN.paused) return;
    GN.paused = true; clearTimeout(GN.timerId); clearTimeout(GN.advanceId); GN.advanceId = null;
    gnPauseBtn.disabled = true; gnResumeBtn.disabled = false; gnRespBtn.disabled = true;
    gnShowOverlay("⏸", "已暂停", "点击「恢复」继续训练。", "继续", false); if (state_sound) beep(520, 0.1, "sine");
  }
  function gnResume() {
    if (!GN.running || !GN.paused) return;
    GN.paused = false; gnOverlay.classList.add("hidden");
    gnPauseBtn.disabled = false; gnResumeBtn.disabled = true; gnRespBtn.disabled = false;
    gnShowTrial(GN.t);
  }
  function gnReset() {
    clearTimeout(GN.timerId); clearTimeout(GN.advanceId); GN.advanceId = null;
    GN.running = false; GN.paused = false; GN.finished = false; GN.advancing = false; GN.responded = false;
    gnStartBtn.disabled = false; gnPauseBtn.disabled = true; gnResumeBtn.disabled = true; gnEndBtn.disabled = true; gnRespBtn.disabled = true;
    gnStim.classList.remove("show"); gnFeedback.textContent = "";
    gnUpdateHud();
    gnShowOverlay("🛑", "准备开始", "看见绿色圆「GO」就按空格/点击；看见红色圆「停」就忍住别按。训练你的反应抑制。", "开始训练", true);
  }
  function gnEnd() { if (!GN.running || GN.finished) return; gnFinish(true); }
  function gnFinish(manual) {
    clearTimeout(GN.timerId); clearTimeout(GN.advanceId); GN.advanceId = null;
    GN.running = false; GN.finished = true; GN.paused = false; GN.advancing = false;
    gnStim.classList.remove("show");
    gnStartBtn.disabled = false; gnPauseBtn.disabled = true; gnResumeBtn.disabled = true; gnEndBtn.disabled = true; gnRespBtn.disabled = true;
    const correct = GN.hits + GN.correctRej;
    const acc = GN.total ? (correct / GN.total) * 100 : 0;
    const avgRt = GN.rtCount ? Math.round(GN.rtSum / GN.rtCount) : 0;
    const success = !manual && GN.total >= GN.trials;
    saveRecord({ game: "gonogo", trials: GN.trials, windowMs: GN.windowMs, goRatio: Math.round(GN.goRatio * 100), success, metric: Math.round(acc), unit: "%", metricLabel: "正确率", betterIsLower: false, rtAvg: avgRt, hits: GN.hits, correctRej: GN.correctRej, commissions: GN.commissions, omissions: GN.omissions, date: Date.now() });
    const emoji = success ? "🎉" : "🏁";
    const title = success ? "本轮完成！" : "已结束本轮";
    const desc = `正确率 ${Math.round(acc)}% · 平均反应 ${avgRt}ms（命中 ${GN.hits} · 正确抑制 ${GN.correctRej} · 误按 ${GN.commissions} · 漏按 ${GN.omissions}）`;
    gnShowOverlay(emoji, title, desc, "再来一局", true);
  }
  function gnShowOverlay(emoji, title, desc, btnText, startAction) {
    gnOe.textContent = emoji; gnot.textContent = title; gnod.textContent = desc; gnos.textContent = btnText;
    gnos.dataset.action = startAction ? "start" : "resume"; gnOverlay.classList.remove("hidden");
  }
  gnos.addEventListener("click", () => { if (gnos.dataset.action === "start") gnStart(); else gnResume(); });
  gnStim.addEventListener("click", gnRespond);
  gnRespBtn.addEventListener("click", gnRespond);
  gnStartBtn.addEventListener("click", gnStart);
  gnPauseBtn.addEventListener("click", gnPause);
  gnResumeBtn.addEventListener("click", gnResume);
  gnEndBtn.addEventListener("click", gnEnd);
  gnResetBtn.addEventListener("click", gnReset);
  $("gnTrials").addEventListener("change", (e) => { GN.trials = clampInt(e.target.value, 5, 60, 30); gnUpdateHud(); });
  $("gnWindow").addEventListener("change", (e) => { GN.windowMs = clampInt(e.target.value, 400, 1500, 800); });
  $("gnGoRatio").addEventListener("change", (e) => { GN.goRatio = clampInt(e.target.value, 50, 90, 75) / 100; });
  function gnIdle() { gnReset(); }

  // ============================================================
  //  模式五：Flanker 任务（选择性注意 / 抗干扰聚焦）
  // ============================================================
  const FL_ARROWS = { left: "←", right: "→", neutral: "▢" };
  const FL = {
    running: false, paused: false, finished: false, advancing: false,
    trials: 30, flankerN: 2, congruency: "mixed", perLimit: 0,
    t: 0, dir: 1, type: "congruent", trialStart: 0,
    correct: 0, total: 0, rtSum: 0, rtCount: 0,
    timerId: null, advanceId: null,
  };
  const flRow = $("flRow");
  const flTrial = $("flTrialVal"), flAcc = $("flAccVal"), flRt = $("flRtVal");
  const flOverlay = $("flOverlay"), flOe = $("flOverlayEmoji"), flot = $("flOverlayTitle"), flod = $("flOverlayDesc"), flos = $("flOverlayStart");
  const flStartBtn = $("flStartBtn"), flPauseBtn = $("flPauseBtn"), flResumeBtn = $("flResumeBtn"), flEndBtn = $("flEndBtn"), flResetBtn = $("flResetBtn");
  const flBtns = Array.from(document.querySelectorAll(".fl-dir-btn"));

  function flPickTrial() {
    const dir = Math.random() < 0.5 ? -1 : 1; // -1 左, 1 右
    let type;
    if (FL.congruency === "congruent") type = "congruent";
    else if (FL.congruency === "incongruent") type = "incongruent";
    else if (FL.congruency === "neutral") type = "neutral";
    else type = ["congruent", "incongruent", "neutral"][Math.floor(Math.random() * 3)];
    return { dir, type };
  }
  function flUpdateHud() {
    const shown = (FL.running || FL.finished) ? Math.min(FL.t + 1, FL.trials) : 0;
    flTrial.textContent = `${shown}/${FL.trials}`;
    flAcc.textContent = FL.total ? Math.round((FL.correct / FL.total) * 100) + "%" : "—";
    flRt.textContent = FL.rtCount ? Math.round(FL.rtSum / FL.rtCount) + "ms" : "—";
  }
  function flShowTrial(t) {
    if (t >= FL.trials) { flFinish(false); return; }
    FL.t = t; FL.advancing = false;
    const { dir, type } = flPickTrial();
    FL.dir = dir; FL.type = type;
    FL.trialStart = performance.now();
    const n = FL.flankerN, mid = n;
    const chars = [];
    for (let i = 0; i < 2 * n + 1; i++) {
      const isMid = i === mid;
      let ch, cls = "fl-arrow";
      if (isMid) { ch = dir === 1 ? FL_ARROWS.right : FL_ARROWS.left; cls += " target"; }
      else if (type === "neutral") { ch = FL_ARROWS.neutral; cls += " neutral"; }
      else if (type === "congruent") { ch = dir === 1 ? FL_ARROWS.right : FL_ARROWS.left; }
      else { ch = dir === 1 ? FL_ARROWS.left : FL_ARROWS.right; } // 不一致：两侧与中间反向
      chars.push(`<span class="${cls}">${ch}</span>`);
    }
    flRow.innerHTML = chars.join("");
    flRow.classList.remove("fl-correct", "fl-wrong");
    flBtns.forEach((b) => (b.disabled = false));
    flUpdateHud();
    if (FL.perLimit > 0) FL.timerId = setTimeout(() => flRespond(0), FL.perLimit);
  }
  function flRespond(choice) {
    if (!FL.running || FL.paused || FL.advancing) return;
    clearTimeout(FL.timerId);
    FL.advancing = true;
    const correct = choice === FL.dir;
    const rt = performance.now() - FL.trialStart;
    FL.total++;
    if (correct) { FL.correct++; FL.rtSum += rt; FL.rtCount++; if (state_sound) beep(740, 0.07, "sine"); }
    else { if (state_sound) beep(200, 0.12, "square", 0.05); }
    flRow.classList.add(correct ? "fl-correct" : "fl-wrong");
    if (choice !== 0) { const b = flBtns.find((x) => parseInt(x.dataset.dir, 10) === choice); if (b) { b.classList.add(correct ? "lit-ok" : "lit-bad"); setTimeout(() => b.classList.remove("lit-ok", "lit-bad"), 300); } }
    flUpdateHud();
    flBtns.forEach((b) => (b.disabled = true));
    FL.advanceId = setTimeout(() => { FL.advanceId = null; flRow.classList.remove("fl-correct", "fl-wrong"); flShowTrial(FL.t + 1); }, 300);
  }
  function flStart() {
    if (state_sound) beep(880, 0.1, "sine");
    FL.trials = clampInt($("flTrials").value, 5, 60, 30);
    const nBtn = $("flFlankerSeg").querySelector(".seg-btn.active");
    FL.flankerN = nBtn ? parseInt(nBtn.dataset.n, 10) : 2;
    const congBtn = $("flCongSeg").querySelector(".seg-btn.active");
    FL.congruency = (congBtn && congBtn.dataset.cong) || "mixed";
    FL.perLimit = clampInt($("flPerLimit").value, 0, 5000, 0);
    FL.correct = FL.total = FL.rtSum = FL.rtCount = 0; FL.t = 0; FL.advancing = false;
    FL.running = true; FL.paused = false; FL.finished = false;
    flStartBtn.disabled = true; flPauseBtn.disabled = false; flEndBtn.disabled = false; flResumeBtn.disabled = true;
    flOverlay.classList.add("hidden");
    flShowTrial(0);
  }
  function flPause() {
    if (!FL.running || FL.paused) return;
    FL.paused = true; clearTimeout(FL.timerId); clearTimeout(FL.advanceId); FL.advanceId = null;
    flPauseBtn.disabled = true; flResumeBtn.disabled = false;
    flBtns.forEach((b) => (b.disabled = true));
    flShowOverlay("⏸", "已暂停", "点击「恢复」继续训练。", "继续", false); if (state_sound) beep(520, 0.1, "sine");
  }
  function flResume() {
    if (!FL.running || !FL.paused) return;
    FL.paused = false; flOverlay.classList.add("hidden");
    flPauseBtn.disabled = false; flResumeBtn.disabled = true;
    flShowTrial(FL.advancing ? FL.t + 1 : FL.t);
  }
  function flReset() {
    clearTimeout(FL.timerId); clearTimeout(FL.advanceId); FL.advanceId = null;
    FL.running = false; FL.paused = false; FL.finished = false; FL.advancing = false;
    flStartBtn.disabled = false; flPauseBtn.disabled = true; flResumeBtn.disabled = true; flEndBtn.disabled = true;
    flBtns.forEach((b) => { b.disabled = true; b.classList.remove("lit-ok", "lit-bad"); });
    flRow.innerHTML = ""; flRow.classList.remove("fl-correct", "fl-wrong");
    flUpdateHud();
    flShowOverlay("↔", "准备开始", "只看中间「那一个」箭头的朝向，忽略两侧的干扰箭头；中间朝左按 F / 点左侧，朝右按 J / 点右侧。", "开始训练", true);
  }
  function flEnd() { if (!FL.running || FL.finished) return; flFinish(true); }
  function flFinish(manual) {
    clearTimeout(FL.timerId); clearTimeout(FL.advanceId); FL.advanceId = null;
    FL.running = false; FL.finished = true; FL.paused = false; FL.advancing = false;
    flStartBtn.disabled = false; flPauseBtn.disabled = true; flResumeBtn.disabled = true; flEndBtn.disabled = true;
    flBtns.forEach((b) => (b.disabled = true));
    const acc = FL.total ? (FL.correct / FL.total) * 100 : 0;
    const avgRt = FL.rtCount ? Math.round(FL.rtSum / FL.rtCount) : 0;
    const success = !manual;
    saveRecord({ game: "flanker", trials: FL.trials, flankerN: FL.flankerN, congruency: FL.congruency, perLimit: FL.perLimit, success, metric: Math.round(acc), unit: "%", metricLabel: "正确率", betterIsLower: false, rtAvg: avgRt, date: Date.now() });
    const emoji = success ? "🎉" : "🏁";
    const title = success ? "本轮完成！" : "已结束本轮";
    const desc = `正确率 ${Math.round(acc)}% · 平均反应 ${avgRt}ms（共 ${FL.total} 题）`;
    flShowOverlay(emoji, title, desc, "再来一局", true);
  }
  function flShowOverlay(emoji, title, desc, btnText, startAction) {
    flOe.textContent = emoji; flot.textContent = title; flod.textContent = desc; flos.textContent = btnText;
    flos.dataset.action = startAction ? "start" : "resume"; flOverlay.classList.remove("hidden");
  }
  flos.addEventListener("click", () => { if (flos.dataset.action === "start") flStart(); else flResume(); });
  flBtns.forEach((b) => b.addEventListener("click", () => flRespond(parseInt(b.dataset.dir, 10))));
  flStartBtn.addEventListener("click", flStart);
  flPauseBtn.addEventListener("click", flPause);
  flResumeBtn.addEventListener("click", flResume);
  flEndBtn.addEventListener("click", flEnd);
  flResetBtn.addEventListener("click", flReset);
  const flFlankerSeg = $("flFlankerSeg");
  flFlankerSeg.addEventListener("click", (e) => { const btn = e.target.closest(".seg-btn"); if (!btn) return; flFlankerSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); FL.flankerN = parseInt(btn.dataset.n, 10); });
  const flCongSeg = $("flCongSeg");
  flCongSeg.addEventListener("click", (e) => { const btn = e.target.closest(".seg-btn"); if (!btn) return; flCongSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); FL.congruency = btn.dataset.cong; });
  $("flTrials").addEventListener("change", (e) => { FL.trials = clampInt(e.target.value, 5, 60, 30); flUpdateHud(); });
  $("flPerLimit").addEventListener("change", (e) => { FL.perLimit = clampInt(e.target.value, 0, 5000, 0); });
  function flIdle() { flReset(); }

  // ---------- 全局：音效开关 + 主题 + 键盘 ----------
  $("soundOn").addEventListener("change", (e) => { state_sound = e.target.checked; });
  $("themeBtn").addEventListener("click", () => { const light = document.body.classList.toggle("light"); lsSet(THEME_KEY, light ? "light" : "dark"); });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (currentGame === "schulte") {
      if (e.code === "Space") { e.preventDefault(); if (!S.running) S_startGame(); else if (S.paused) S_resumeGame(); else S_endGame(); }
      else if (e.key.toLowerCase() === "r") S_reset();
      else if (e.key.toLowerCase() === "e") S_endGame();
    } else if (currentGame === "nback") {
      if (e.key.toLowerCase() === "f") nbRespond("pos");
      else if (e.key.toLowerCase() === "j") nbRespond("aud");
      else if (e.code === "Space") { e.preventDefault(); if (!NB.running) nbStart(); else if (NB.paused) nbResume(); else nbEnd(); }
      else if (e.key.toLowerCase() === "r") nbReset();
    } else if (currentGame === "stroop") {
      if (e.key >= "1" && e.key <= "4") { e.preventDefault(); spRespond(parseInt(e.key, 10) - 1); }
      else if (e.code === "Space") { e.preventDefault(); if (!SP.running) spStart(); else if (SP.paused) spResume(); else spEnd(); }
      else if (e.key.toLowerCase() === "r") spReset();
    } else if (currentGame === "gonogo") {
      if (e.code === "Space") { e.preventDefault(); if (!GN.running) gnStart(); else if (GN.paused) gnResume(); else gnRespond(); }
      else if (e.key.toLowerCase() === "r") gnReset();
    } else if (currentGame === "flanker") {
      if (e.key.toLowerCase() === "f") flRespond(-1);
      else if (e.key.toLowerCase() === "j") flRespond(1);
      else if (e.code === "Space") { e.preventDefault(); if (!FL.running) flStart(); else if (FL.paused) flResume(); else flEnd(); }
      else if (e.key.toLowerCase() === "r") flReset();
    }
  });

  // ---------- 初始化 ----------
  function init() {
    if (lsGet(THEME_KEY) === "light") document.body.classList.add("light");
    nbBuildGrid();
    renderGameLibrary();
    $("filterGame").value = "schulte";
    renderHistory();
    S_refreshIdle();
    S_showOverlay("◧", "准备开始", S_idleDesc(), "开始训练", true);
    nbShowOverlay("◉", "准备开始", "记住 N 步之前出现过的「位置」与「声音」，出现相同就按下对应匹配键（F / J）。", "开始训练", true);
    flReset();
  }
  init();
})();
