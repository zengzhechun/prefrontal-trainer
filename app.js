/* ============================================================
   前额叶训练中心 · 游戏逻辑
   纯前端 / 无依赖 / localStorage 持久化成绩
   包含：舒尔特方格 + Dual N-Back + Stroop 色词 + Go/No-Go
         + Flanker + 数字广度 + 任务切换 + 视觉跟踪(MOT)
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
    {
      id: "digitspan", name: "数字广度", domain: "记忆", domainLabel: "短时记忆", icon: "🔢",
      desc: "记住并复述依次闪现的数字（顺背或反背），训练短时记忆的容量与复述能力。",
      settings: "digitspanSettings", stage: "digitspanStage", reset: dsReset, idle: dsReset,
    },
    {
      id: "task", name: "任务切换", domain: "灵活", domainLabel: "认知灵活性", icon: "🔄",
      desc: "按每题变化的规则对数字做判断，训练在不同任务间快速切换的认知灵活性。",
      settings: "taskSettings", stage: "taskStage", reset: tsReset, idle: tsReset,
    },
    {
      id: "mot", name: "视觉跟踪", domain: "注意", domainLabel: "视觉跟踪", icon: "◍",
      desc: "记住高亮小球、用眼睛跟踪其运动，结束后从所有小球中选出目标，训练视觉追踪与持续注意。",
      settings: "motSettings", stage: "motStage", reset: motReset, idle: motReset,
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
  function fmtMetric(r) { if (r.unit === "ms") return fmtTime(r.metric); if (r.unit === "位") return Math.round(r.metric) + " 位"; return Math.round(r.metric) + "%"; }

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
      const dsp = all.filter((r) => r.game === "digitspan").length;
      const ts = all.filter((r) => r.game === "task").length;
      const mot = all.filter((r) => r.game === "mot").length;
      const done = all.filter((r) => r.success).length;
      const rate = all.length ? Math.round((done / all.length) * 100) + "%" : "—";
      statsHtml = `
        <div class="stat"><div class="v">${all.length}</div><div class="l">总场次</div></div>
        <div class="stat"><div class="v">${sc}</div><div class="l">舒尔特</div></div>
        <div class="stat"><div class="v">${nb}</div><div class="l">N-Back</div></div>
        <div class="stat"><div class="v">${sp}</div><div class="l">Stroop</div></div>
        <div class="stat"><div class="v">${gn}</div><div class="l">Go/No-Go</div></div>
        <div class="stat"><div class="v">${fl}</div><div class="l">Flanker</div></div>
        <div class="stat"><div class="v">${dsp}</div><div class="l">数字广度</div></div>
        <div class="stat"><div class="v">${ts}</div><div class="l">任务切换</div></div>
        <div class="stat"><div class="v">${mot}</div><div class="l">视觉跟踪</div></div>
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
      const gameBadge = r.game === "schulte" ? "舒尔特" : (r.game === "nback" ? "N-Back" : (r.game === "stroop" ? "Stroop" : (r.game === "gonogo" ? "Go/No-Go" : (r.game === "flanker" ? "Flanker" : (r.game === "digitspan" ? "数字广度" : (r.game === "task" ? "任务切换" : "视觉跟踪"))))));
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
      } else if (r.game === "flanker") {
        const congLabel = { mixed: "混合", incongruent: "仅不一致", congruent: "仅一致", neutral: "中性" }[r.congruency] || "混合";
        const arrowLabel = `${r.flankerN * 2 + 1} 箭头`;
        const limitLabel = r.perLimit ? `${r.perLimit / 1000}s/题` : "不限时";
        tag2 = `<span class="mode-badge timer">${congLabel}</span>`;
        meta = `${r.trials} 试次·${arrowLabel}·${limitLabel}`;
      } else if (r.game === "task") {
        const modeLabel = { mixed: "随机", block: "区块", switch: "多数切换" }[r.seqMode] || "随机";
        const costLabel = (typeof r.switchCost === "number") ? `切换+${r.switchCost}ms` : "";
        tag2 = `<span class="mode-badge timer">${modeLabel}</span>`;
        meta = `${r.trials} 试次${costLabel ? "·" + costLabel : ""}`;
      } else if (r.game === "mot") {
        const speedLabel = { slow: "慢", med: "中", fast: "快" }[r.speed] || "中";
        const cxLabel = { line: "直线", curve: "曲线", zigzag: "急停变向", inc: "逐轮递增" }[r.complexity] || "曲线";
        tag2 = `<span class="mode-badge timer">${r.timed ? "限时" : "不限时"}</span>`;
        meta = `${r.tracked}目标·${r.total}球·${speedLabel}·${r.duration / 1000}s·${cxLabel}·${r.rounds}轮`;
      } else {
        const modeLabel = { forward: "顺背", backward: "反背", mixed: "混合" }[r.mode] || "顺背";
        const best = r.metric ? `${r.metric} 位` : "0 位";
        tag2 = `<span class="mode-badge timer">${modeLabel}</span>`;
        meta = `起始 ${r.startLen || "—"}·广度 ${best}`;
      }
      const d = new Date(r.date);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      let rtExtra = ((r.game === "stroop" || r.game === "gonogo" || r.game === "flanker" || r.game === "task") && r.rtAvg) ? `<span>RT ${r.rtAvg}ms</span>` : "";
      if (r.game === "task" && typeof r.switchCost === "number") rtExtra += `<span>切换代价 ${r.switchCost}ms</span>`;
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
    const fmtV = (v) => (unit === "ms" ? fmtTime(v) : (unit === "位" ? Math.round(v) + " 位" : Math.round(v) + "%"));
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
    size: 5, mode: "count", timeLimit: 60, layout: "grid", order: "asc", motion: "none",
    rangeOffset: false, rangeStart: 26,
    interf: { color: false, font: false, jitter: false, mirror: false, zoneColor: false, rotation: false },
    running: false, paused: false, finished: false,
    numbers: [], count: 0, next: 1, step: 1, elapsed: 0, rafId: null, lastTick: 0, remain: 0,
    floatState: [], floatCell: 0, floatLast: 0,
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
    let count, rawCoords, cell;
    if (S.motion === "float") {
      count = S.size * S.size;
      cell = Math.max(10, 64 / Math.sqrt(count));
      rawCoords = Array.from({ length: count }, () => ({
        x: rnd(14, 86), y: rnd(14, 86),
        vx: rnd(6, 13) * (Math.random() < 0.5 ? -1 : 1),
        vy: rnd(6, 13) * (Math.random() < 0.5 ? -1 : 1),
      }));
      S.floatCell = cell;
      S.floatState = rawCoords.map((c) => ({ x: c.x, y: c.y, vx: c.vx, vy: c.vy }));
    } else {
      const lay = S_computeLayout(S.layout, S.size);
      count = lay.count; cell = lay.cell; rawCoords = lay.coords;
    }
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
      const p = rawCoords[i];
      el.style.left = p.x + "%"; el.style.top = p.y + "%"; el.style.width = cell + "%"; el.style.height = cell + "%";
      el.style.fontSize = (cell * 0.34) + "vmin"; el.style.opacity = "1"; el.style.pointerEvents = "auto";
      S_styleCell(el, num, i);
      if (S.motion === "float") el.style.clipPath = "";
      else if (S.layout === "hexagon") el.style.clipPath = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";
      else if (S.layout === "irregular") {
        const pts = [[rnd(0, 12), rnd(0, 12)], [rnd(88, 100), rnd(0, 12)], [rnd(88, 100), rnd(88, 100)], [rnd(0, 12), rnd(88, 100)]];
        el.style.clipPath = `polygon(${pts.map(([x, y]) => x + "% " + y + "%").join(", ")})`;
      } else el.style.clipPath = "";
    }
    S.count = count;
    Sboard.className = "board" + (S.motion === "float" ? " float" : "");
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
  function S_countFor() {
    return S.motion === "float" ? S.size * S.size : S_computeLayout(S.layout, S.size).count;
  }
  function S_buildBoard() {
    const count = S_countFor();
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
  let SfloatRaf = null;
  function S_floatStep(now) {
    if (!S.running || S.paused || S.motion !== "float") { SfloatRaf = null; return; }
    const dt = Math.min(0.05, (now - S.floatLast) / 1000); S.floatLast = now;
    const half = S.floatCell / 2;
    for (let i = 0; i < ScellEls.length; i++) {
      const el = ScellEls[i];
      if (el.style.pointerEvents === "none") continue; // 已点中的数字定格，不再移动
      const st = S.floatState[i];
      st.x += st.vx * dt; st.y += st.vy * dt;
      if (st.x < half) { st.x = half; st.vx = Math.abs(st.vx); }
      else if (st.x > 100 - half) { st.x = 100 - half; st.vx = -Math.abs(st.vx); }
      if (st.y < half) { st.y = half; st.vy = Math.abs(st.vy); }
      else if (st.y > 100 - half) { st.y = 100 - half; st.vy = -Math.abs(st.vy); }
      el.style.left = st.x + "%"; el.style.top = st.y + "%";
    }
    SfloatRaf = requestAnimationFrame(S_floatStep);
  }
  function S_startFloat() { if (S.motion !== "float" || !S.running || S.paused) return; S.floatLast = performance.now(); if (!SfloatRaf) SfloatRaf = requestAnimationFrame(S_floatStep); }
  function S_stopFloat() { if (SfloatRaf) cancelAnimationFrame(SfloatRaf); SfloatRaf = null; }
  function S_startGame() {
    if (state_sound) beep(880, 0.1, "sine");
    S_buildBoard(); S.running = true; S.paused = false; S.finished = false;
    S.step = S.order === "asc" ? 1 : -1; S.next = S.order === "asc" ? S_effStart() : S_effEnd();
    S.elapsed = 0; S.remain = S.timeLimit * 1000;
    timeValueEl.textContent = S.mode === "timer" ? fmtTime(S.remain) : "0.0s";
    timeValueEl.closest(".hud-item").classList.remove("danger");
    Soverlay.classList.add("hidden");
    SstartBtn.disabled = true; SpauseBtn.disabled = false; SresumeBtn.disabled = true; SresetBtn.disabled = false; SendBtn.disabled = false;
    S_updateProgress(); S_startClock(); S_startFloat();
  }
  function S_pauseGame() {
    if (!S.running || S.paused) return; S.paused = true; S_stopClock(); S_stopFloat(); SpauseBtn.disabled = true; SresumeBtn.disabled = false;
    S_showOverlay("⏸", "已暂停", "点击「恢复」继续训练。", "继续", false); if (state_sound) beep(520, 0.1, "sine");
  }
  function S_resumeGame() {
    if (!S.running || !S.paused) return; S.paused = false; Soverlay.classList.add("hidden"); SpauseBtn.disabled = false; SresumeBtn.disabled = true; S_startClock(); S_startFloat(); if (state_sound) beep(620, 0.1, "sine");
  }
  function S_reset() {
    S_stopClock(); S_stopFloat(); S.running = false; S.paused = false; S.finished = false;
    SstartBtn.disabled = false; SpauseBtn.disabled = true; SresumeBtn.disabled = true; SresetBtn.disabled = false; SendBtn.disabled = true;
    S_showOverlay("◧", "准备开始", S_idleDesc(), "开始训练", true); S_refreshIdle();
  }
  function S_endGame() { if (!S.running || S.finished) return; S_finishGame("manual"); }
  function S_finishGame(reason) {
    S_stopClock(); S_stopFloat(); S.running = false; S.finished = true;
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
    saveRecord({ game: "schulte", mode: S.mode, size: S.size, count: total, layout: S.layout, motion: S.motion, order: S.order, rangeOffset: S.rangeOffset, rangeStart: S.rangeStart, success, metric: Math.round(usedMs), unit: "ms", metricLabel: "用时", betterIsLower: true, timeMs: Math.round(usedMs), found: Math.max(0, found), interf: { ...S.interf }, date: Date.now() });
  }
  function S_showOverlay(emoji, title, desc, btnText, startAction) {
    SoverlayEmoji.textContent = emoji; SoverlayTitle.textContent = title; SoverlayDesc.textContent = desc; SoverlayStart.textContent = btnText;
    SoverlayStart.dataset.action = startAction ? "start" : "resume"; Soverlay.classList.remove("hidden");
  }
  function S_idleDesc() {
    const start = S_effStart(), end = S_effEnd();
    const range = S.order === "asc" ? `${start} 到 ${end}` : `${end} 到 ${start}`;
    const offsetTip = S.rangeOffset ? `（偏移）` : "";
    const motionTip = S.motion === "float" ? `；数字会随机飘动，需边追踪边寻找目标` : "";
    return `点击「开始」后，按${ORDER_LABEL[S.order]}依次点击数字 ${range}${offsetTip}${motionTip}（${LAYOUT_LABEL[S.layout]}布局）。`;
  }
  SoverlayStart.addEventListener("click", () => { if (SoverlayStart.dataset.action === "start") S_startGame(); else S_resumeGame(); });
  function S_refreshIdle() {
    if (S.running) return;
    S.rangeStart = Math.max(1, parseInt(SrangeStart.value, 10) || 1);
    S.count = S_countFor();
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
  S_bindSeg("motionSeg", "motion", (v) => { S.motion = v; S_refreshIdle(); });
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

  // ============================================================
  //  模式六：数字广度 / 反向数字记忆（短时记忆）
  // ============================================================
  const DS_MODE_LABEL = { forward: "顺背", backward: "反背", mixed: "混合" };
  const DS = {
    running: false, finished: false,
    mode: "forward", startLen: 4, digitMs: 800, gapMs: 250,
    len: 4, trialsAtLen: 0, correctAtLen: 0, bestLen: 0, doneSeq: 0,
    seq: [], trialBackward: false, input: [], inputPhase: false,
    timers: [],
  };
  const dsDisplay = $("dsDisplay"), dsDigit = $("dsDigit"), dsModeHint = $("dsModeHint"), dsInput = $("dsInput"), dsKeypad = $("dsKeypad");
  const dsLenVal = $("dsLenVal"), dsTrialVal = $("dsTrialVal"), dsBestVal = $("dsBestVal");
  const dsOverlay = $("dsOverlay"), dsOe = $("dsOverlayEmoji"), dsot = $("dsOverlayTitle"), dsod = $("dsOverlayDesc"), dsos = $("dsOverlayStart");
  const dsStartBtn = $("dsStartBtn"), dsEndBtn = $("dsEndBtn"), dsResetBtn = $("dsResetBtn");

  function dsUpdateHud() {
    dsLenVal.textContent = (DS.running || DS.finished) ? DS.len + " 位" : "—";
    dsTrialVal.textContent = `${DS.doneSeq} 序列`;
    dsBestVal.textContent = DS.bestLen ? DS.bestLen + " 位" : "—";
  }
  function dsClearTimers() { DS.timers.forEach((id) => clearTimeout(id)); DS.timers = []; }
  function dsGenSeq(len) {
    const seq = [];
    for (let i = 0; i < len; i++) {
      let d;
      do { d = Math.floor(Math.random() * 10); } while (i >= 2 && seq[i - 1] === d && seq[i - 2] === d); // 避免连续三个相同
      seq.push(d);
    }
    return seq;
  }
  function dsPresent() {
    DS.trialBackward = DS.mode === "backward" ? true : (DS.mode === "mixed" ? Math.random() < 0.5 : false);
    DS.seq = dsGenSeq(DS.len);
    dsModeHint.textContent = "";
    dsInput.textContent = "";
    dsInput.classList.remove("show");
    dsKeypad.classList.remove("show");
    DS.inputPhase = false;
    let i = 0;
    function showDigit() {
      if (i >= DS.seq.length) { dsDigit.textContent = ""; dsDigit.classList.remove("big"); DS.timers.push(setTimeout(dsBeginInput, DS.gapMs)); return; }
      dsDigit.textContent = DS.seq[i];
      dsDigit.classList.add("big");
      DS.timers.push(setTimeout(() => { dsDigit.classList.remove("big"); dsDigit.textContent = ""; i++; DS.timers.push(setTimeout(showDigit, DS.gapMs)); }, DS.digitMs));
    }
    showDigit();
  }
  function dsBeginInput() {
    DS.inputPhase = true;
    DS.input = [];
    dsRenderInput();
    dsInput.classList.add("show");
    dsKeypad.classList.add("show");
    dsModeHint.textContent = DS.trialBackward ? "反背：倒序输入" : "顺背：按原顺序输入";
  }
  function dsRenderInput() {
    dsInput.textContent = DS.input.length ? DS.input.join(" ") : "·";
  }
  function dsInputDigit(d) {
    if (!DS.running || !DS.inputPhase) return;
    if (DS.input.length >= DS.len) return;
    DS.input.push(d);
    dsRenderInput();
    if (DS.input.length === DS.len) DS.timers.push(setTimeout(dsSubmit, 250));
  }
  function dsInputBack() {
    if (!DS.running || !DS.inputPhase) return;
    DS.input.pop();
    dsRenderInput();
  }
  function dsSubmit() {
    if (!DS.running || !DS.inputPhase) return;
    DS.inputPhase = false;
    dsKeypad.classList.remove("show");
    dsInput.classList.remove("show");
    const target = DS.trialBackward ? DS.seq.slice().reverse() : DS.seq.slice();
    const correct = DS.input.length === target.length && DS.input.every((v, idx) => v === target[idx]);
    DS.trialsAtLen++; DS.doneSeq++;
    if (correct) {
      DS.correctAtLen++; DS.bestLen = Math.max(DS.bestLen, DS.len);
      if (state_sound) beep(740, 0.07, "sine");
      dsDigit.textContent = "✓"; dsDigit.className = "ds-digit big ok";
    } else {
      if (state_sound) beep(200, 0.12, "square", 0.05);
      dsDigit.textContent = "✗"; dsDigit.className = "ds-digit big bad";
    }
    dsUpdateHud();
    const advance = DS.trialsAtLen >= 2 && DS.correctAtLen >= 2;
    const failStop = DS.trialsAtLen >= 2 && DS.correctAtLen < 2;
    if (advance) { DS.len++; DS.trialsAtLen = 0; DS.correctAtLen = 0; }
    DS.timers.push(setTimeout(() => {
      dsDigit.className = "ds-digit";
      if (failStop || DS.len > 12) dsFinish(false);
      else dsPresent();
    }, 700));
  }
  function dsStart() {
    if (state_sound) beep(880, 0.1, "sine");
    const modeBtn = $("dsModeSeg").querySelector(".seg-btn.active");
    DS.mode = (modeBtn && modeBtn.dataset.mode) || "forward";
    DS.startLen = clampInt($("dsStartLen").value, 3, 9, 4);
    DS.digitMs = clampInt($("dsDigitMs").value, 400, 1500, 800);
    DS.len = DS.startLen; DS.trialsAtLen = 0; DS.correctAtLen = 0; DS.bestLen = 0; DS.doneSeq = 0;
    DS.running = true; DS.finished = false;
    dsStartBtn.disabled = true; dsEndBtn.disabled = false; dsResetBtn.disabled = false;
    dsOverlay.classList.add("hidden");
    dsUpdateHud();
    dsPresent();
  }
  function dsReset() {
    dsClearTimers();
    DS.running = false; DS.finished = false; DS.inputPhase = false;
    dsStartBtn.disabled = false; dsEndBtn.disabled = true; dsResetBtn.disabled = false;
    dsDigit.textContent = "准备"; dsDigit.className = "ds-digit";
    dsModeHint.textContent = "";
    dsInput.textContent = ""; dsInput.classList.remove("show");
    dsKeypad.classList.remove("show");
    dsUpdateHud();
    dsShowOverlay("🔢", "准备开始", "记住屏幕依次闪现的数字，随后按原顺序（顺背）或倒序（反背）复述出来。序列会从短到长逐步增加难度。", "开始训练", true);
  }
  function dsEnd() { if (!DS.running || DS.finished) return; dsFinish(true); }
  function dsFinish(manual) {
    dsClearTimers();
    DS.running = false; DS.finished = true; DS.inputPhase = false;
    dsStartBtn.disabled = false; dsEndBtn.disabled = true; dsResetBtn.disabled = false;
    dsDigit.className = "ds-digit";
    const best = DS.bestLen;
    const success = !manual;
    saveRecord({ game: "digitspan", mode: DS.mode, startLen: DS.startLen, success, metric: best, unit: "位", metricLabel: "广度", betterIsLower: false, trials: DS.doneSeq, date: Date.now() });
    const emoji = success ? "🎉" : "🏁";
    const title = success ? "本轮完成！" : "已结束本轮";
    const desc = `最大广度 ${best} 位（共 ${DS.doneSeq} 个序列 · ${DS_MODE_LABEL[DS.mode]}）`;
    dsShowOverlay(emoji, title, desc, "再来一局", true);
  }
  function dsShowOverlay(emoji, title, desc, btnText, startAction) {
    dsOe.textContent = emoji; dsot.textContent = title; dsod.textContent = desc; dsos.textContent = btnText;
    dsos.dataset.action = startAction ? "start" : "resume"; dsOverlay.classList.remove("hidden");
  }
  dsos.addEventListener("click", () => { if (dsos.dataset.action === "start") dsStart(); });
  dsKeypad.querySelectorAll(".ds-key").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.del) dsInputBack();
      else if (b.dataset.ok) { if (DS.input.length === DS.len) dsSubmit(); }
      else dsInputDigit(parseInt(b.dataset.d, 10));
    });
  });
  dsStartBtn.addEventListener("click", dsStart);
  dsEndBtn.addEventListener("click", dsEnd);
  dsResetBtn.addEventListener("click", dsReset);
  const dsModeSeg = $("dsModeSeg");
  dsModeSeg.addEventListener("click", (e) => { const btn = e.target.closest(".seg-btn"); if (!btn) return; dsModeSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); });
  $("dsStartLen").addEventListener("change", (e) => { DS.startLen = clampInt(e.target.value, 3, 9, 4); });
  $("dsDigitMs").addEventListener("change", (e) => { DS.digitMs = clampInt(e.target.value, 400, 1500, 800); });
  function dsIdle() { dsReset(); }

  // ============================================================
  //  模式七：任务切换 Task Switching（认知灵活性）
  //  每题给出「当前规则」，对中间数字做判断并选左/右；规则会变，
  //  在任务间快速切换时反应变慢（切换代价 = 切换试次平均 RT − 重复试次平均 RT）。
  // ============================================================
  const TS_RULE_LABEL = { parity: "奇偶规则", magnitude: "大小规则" };
  const TS_NUMS = [1, 2, 3, 4, 6, 7, 8, 9]; // 排除 5（大小分界点的歧义）
  const TS = {
    running: false, paused: false, finished: false, advancing: false,
    trials: 30, seqMode: "mixed", perLimit: 0,
    t: 0, rule: "parity", prevRule: null, isSwitch: false, num: 1, trialStart: 0,
    rules: [], nums: [],
    correct: 0, total: 0, rtSum: 0, rtCount: 0, switchRts: [], repeatRts: [],
    timerId: null, advanceId: null,
  };
  const tsStim = $("tsStim"), tsRule = $("tsRule"), tsFeedback = $("tsFeedback");
  const tsTrial = $("tsTrialVal"), tsAcc = $("tsAccVal"), tsRt = $("tsRtVal");
  const tsOverlay = $("tsOverlay"), tsOe = $("tsOverlayEmoji"), tsot = $("tsOverlayTitle"), tsod = $("tsOverlayDesc"), tsos = $("tsOverlayStart");
  const tsStartBtn = $("tsStartBtn"), tsPauseBtn = $("tsPauseBtn"), tsResumeBtn = $("tsResumeBtn"), tsEndBtn = $("tsEndBtn"), tsResetBtn = $("tsResetBtn");
  const tsBtns = Array.from(document.querySelectorAll(".ts-dir-btn"));

  function tsBuildRules(n, mode) {
    const rules = [];
    if (mode === "block") {
      let cur = Math.random() < 0.5 ? "parity" : "magnitude";
      const sizes = []; let rem = n;
      while (rem > 0) { const b = Math.min(rem, 4 + Math.floor(Math.random() * 3)); sizes.push(b); rem -= b; }
      for (const b of sizes) { for (let i = 0; i < b; i++) rules.push(cur); cur = cur === "parity" ? "magnitude" : "parity"; }
    } else if (mode === "switch") {
      let cur = Math.random() < 0.5 ? "parity" : "magnitude";
      rules.push(cur);
      for (let i = 1; i < n; i++) { if (Math.random() < 0.75) cur = cur === "parity" ? "magnitude" : "parity"; rules.push(cur); }
    } else {
      let cur = Math.random() < 0.5 ? "parity" : "magnitude";
      for (let i = 0; i < n; i++) { if (i > 0 && Math.random() < 0.5) cur = cur === "parity" ? "magnitude" : "parity"; rules.push(cur); }
    }
    return rules;
  }
  function tsExpectedDir(rule, num) {
    return rule === "parity" ? (num % 2 === 0 ? -1 : 1) : (num <= 4 ? -1 : 1);
  }
  function tsUpdateHud() {
    const shown = (TS.running || TS.finished) ? Math.min(TS.t + 1, TS.trials) : 0;
    tsTrial.textContent = `${shown}/${TS.trials}`;
    tsAcc.textContent = TS.total ? Math.round((TS.correct / TS.total) * 100) + "%" : "—";
    tsRt.textContent = TS.rtCount ? Math.round(TS.rtSum / TS.rtCount) + "ms" : "—";
  }
  function tsShowTrial(t) {
    if (t >= TS.trials) { tsFinish(false); return; }
    TS.t = t; TS.advancing = false;
    const rule = TS.rules[t];
    TS.isSwitch = t > 0 && rule !== TS.prevRule;
    TS.prevRule = rule;
    const num = TS.nums[t];
    TS.rule = rule; TS.num = num;
    TS.trialStart = performance.now();
    tsRule.textContent = TS_RULE_LABEL[rule] + (TS.isSwitch ? "（切换！）" : "");
    tsRule.classList.toggle("switching", TS.isSwitch);
    tsStim.textContent = num;
    tsStim.className = "ts-stim";
    tsFeedback.textContent = "";
    tsBtns.forEach((b) => (b.disabled = false));
    tsUpdateHud();
    if (TS.perLimit > 0) TS.timerId = setTimeout(() => tsRespond(0), TS.perLimit);
  }
  function tsRespond(choice) {
    if (!TS.running || TS.paused || TS.advancing) return;
    clearTimeout(TS.timerId);
    TS.advancing = true;
    const expected = tsExpectedDir(TS.rule, TS.num);
    const correct = choice === expected;
    const rt = performance.now() - TS.trialStart;
    TS.total++;
    if (correct) {
      TS.correct++; TS.rtSum += rt; TS.rtCount++;
      if (TS.t > 0) { if (TS.isSwitch) TS.switchRts.push(rt); else TS.repeatRts.push(rt); }
      if (state_sound) beep(740, 0.07, "sine");
    } else { if (state_sound) beep(200, 0.12, "square", 0.05); }
    tsStim.classList.add(correct ? "ts-correct" : "ts-wrong");
    if (choice !== 0) { const b = tsBtns.find((x) => parseInt(x.dataset.dir, 10) === choice); if (b) { b.classList.add(correct ? "lit-ok" : "lit-bad"); setTimeout(() => b.classList.remove("lit-ok", "lit-bad"), 300); } }
    tsFeedback.textContent = correct ? "正确" : "错误";
    tsFeedback.className = "ts-feedback " + (correct ? "ok" : "bad");
    tsUpdateHud();
    tsBtns.forEach((b) => (b.disabled = true));
    TS.advanceId = setTimeout(() => { TS.advanceId = null; tsStim.classList.remove("ts-correct", "ts-wrong"); tsShowTrial(TS.t + 1); }, 300);
  }
  function tsStart() {
    if (state_sound) beep(880, 0.1, "sine");
    TS.trials = clampInt($("tsTrials").value, 5, 60, 30);
    const mBtn = $("tsModeSeg").querySelector(".seg-btn.active");
    TS.seqMode = (mBtn && mBtn.dataset.mode) || "mixed";
    TS.perLimit = clampInt($("tsPerLimit").value, 0, 5000, 0);
    TS.rules = tsBuildRules(TS.trials, TS.seqMode);
    TS.nums = Array.from({ length: TS.trials }, () => TS_NUMS[Math.floor(Math.random() * TS_NUMS.length)]);
    TS.correct = TS.total = TS.rtSum = TS.rtCount = 0;
    TS.switchRts = []; TS.repeatRts = []; TS.prevRule = null; TS.t = 0; TS.advancing = false;
    TS.running = true; TS.paused = false; TS.finished = false;
    tsStartBtn.disabled = true; tsPauseBtn.disabled = false; tsEndBtn.disabled = false; tsResumeBtn.disabled = true;
    tsOverlay.classList.add("hidden");
    tsShowTrial(0);
  }
  function tsPause() {
    if (!TS.running || TS.paused) return;
    TS.paused = true; clearTimeout(TS.timerId); clearTimeout(TS.advanceId); TS.advanceId = null;
    tsPauseBtn.disabled = true; tsResumeBtn.disabled = false;
    tsBtns.forEach((b) => (b.disabled = true));
    tsShowOverlay("⏸", "已暂停", "点击「恢复」继续训练。", "继续", false); if (state_sound) beep(520, 0.1, "sine");
  }
  function tsResume() {
    if (!TS.running || !TS.paused) return;
    TS.paused = false; tsOverlay.classList.add("hidden");
    tsPauseBtn.disabled = false; tsResumeBtn.disabled = true;
    tsShowTrial(TS.advancing ? TS.t + 1 : TS.t);
  }
  function tsReset() {
    clearTimeout(TS.timerId); clearTimeout(TS.advanceId); TS.advanceId = null;
    TS.running = false; TS.paused = false; TS.finished = false; TS.advancing = false;
    tsStartBtn.disabled = false; tsPauseBtn.disabled = true; tsResumeBtn.disabled = true; tsEndBtn.disabled = true;
    tsBtns.forEach((b) => { b.disabled = true; b.classList.remove("lit-ok", "lit-bad"); });
    tsStim.textContent = "5"; tsStim.className = "ts-stim";
    tsRule.textContent = "奇偶规则 / 大小规则"; tsRule.classList.remove("switching");
    tsFeedback.textContent = ""; tsFeedback.className = "ts-feedback";
    tsUpdateHud();
    tsShowOverlay("🔄", "准备开始", "看清上方「当前规则」：奇偶＝偶数按左/奇数按右；大小＝≤4 按左/≥6 按右。规则会变，注意切换。", "开始训练", true);
  }
  function tsEnd() { if (!TS.running || TS.finished) return; tsFinish(true); }
  function tsFinish(manual) {
    clearTimeout(TS.timerId); clearTimeout(TS.advanceId); TS.advanceId = null;
    TS.running = false; TS.finished = true; TS.paused = false; TS.advancing = false;
    tsStartBtn.disabled = false; tsPauseBtn.disabled = true; tsResumeBtn.disabled = true; tsEndBtn.disabled = true;
    tsBtns.forEach((b) => (b.disabled = true));
    const acc = TS.total ? (TS.correct / TS.total) * 100 : 0;
    const avgRt = TS.rtCount ? Math.round(TS.rtSum / TS.rtCount) : 0;
    const sw = TS.switchRts.length ? Math.round(TS.switchRts.reduce((a, b) => a + b, 0) / TS.switchRts.length) : 0;
    const rp = TS.repeatRts.length ? Math.round(TS.repeatRts.reduce((a, b) => a + b, 0) / TS.repeatRts.length) : 0;
    const switchCost = (TS.switchRts.length && TS.repeatRts.length) ? (sw - rp) : 0;
    const success = !manual;
    saveRecord({ game: "task", trials: TS.trials, seqMode: TS.seqMode, perLimit: TS.perLimit, success, metric: Math.round(acc), unit: "%", metricLabel: "正确率", betterIsLower: false, rtAvg: avgRt, switchCost, date: Date.now() });
    const emoji = success ? "🎉" : "🏁";
    const title = success ? "本轮完成！" : "已结束本轮";
    const costTxt = (TS.switchRts.length && TS.repeatRts.length) ? `（切换 ${sw}ms / 重复 ${rp}ms，切换代价 ${switchCost}ms）` : "";
    const desc = `正确率 ${Math.round(acc)}% · 平均反应 ${avgRt}ms${costTxt}`;
    tsShowOverlay(emoji, title, desc, "再来一局", true);
  }
  function tsShowOverlay(emoji, title, desc, btnText, startAction) {
    tsOe.textContent = emoji; tsot.textContent = title; tsod.textContent = desc; tsos.textContent = btnText;
    tsos.dataset.action = startAction ? "start" : "resume"; tsOverlay.classList.remove("hidden");
  }
  tsos.addEventListener("click", () => { if (tsos.dataset.action === "start") tsStart(); else tsResume(); });
  tsBtns.forEach((b) => b.addEventListener("click", () => tsRespond(parseInt(b.dataset.dir, 10))));
  tsStartBtn.addEventListener("click", tsStart);
  tsPauseBtn.addEventListener("click", tsPause);
  tsResumeBtn.addEventListener("click", tsResume);
  tsEndBtn.addEventListener("click", tsEnd);
  tsResetBtn.addEventListener("click", tsReset);
  const tsModeSeg = $("tsModeSeg");
  tsModeSeg.addEventListener("click", (e) => { const btn = e.target.closest(".seg-btn"); if (!btn) return; tsModeSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); });
  $("tsTrials").addEventListener("change", (e) => { TS.trials = clampInt(e.target.value, 5, 60, 30); tsUpdateHud(); });
  $("tsPerLimit").addEventListener("change", (e) => { TS.perLimit = clampInt(e.target.value, 0, 5000, 0); });
  function tsIdle() { tsReset(); }

  // ============================================================
  //  模式八：视觉跟踪（Multiple Object Tracking, MOT）
  // ============================================================
  const CUE_MS = 2000;
  const motCanvas = $("motCanvas");
  const mctx = motCanvas.getContext ? motCanvas.getContext("2d") : null;
  const MW = motCanvas.width, MH = motCanvas.height;
  const motWrap = $("motWrap");
  const motRoundVal = $("motRoundVal"), motPhaseVal = $("motPhaseVal"), motScoreVal = $("motScoreVal"), motTimeVal = $("motTimeVal");
  const motSelectHint = $("motSelectHint");
  const motResultBar = $("motResultBar"), motResultFB = $("motResultFB");
  const motOverlay = $("motOverlay"), motOe = $("motOverlayEmoji"), motOt = $("motOverlayTitle"), motOd = $("motOverlayDesc"), motOs = $("motOverlayStart");
  const motStartBtn = $("motStartBtn"), motPauseBtn = $("motPauseBtn"), motResumeBtn = $("motResumeBtn"), motSubmitBtn = $("motSubmitBtn"), motResetBtn = $("motResetBtn");
  const motTrackSeg = $("motTrackSeg"), motRatioSeg = $("motRatioSeg"), motSpeedSeg = $("motSpeedSeg"), motDurSeg = $("motDurSeg"), motCxSeg = $("motCxSeg"), motRoundsSeg = $("motRoundsSeg"), motSelLimitSeg = $("motSelLimitSeg");
  const motTimed = $("motTimed"), motSelLimitWrap = $("motSelLimitWrap");
  const MOT_PRESETS = {
    easy: { tracked: 3, ratio: 1, speed: "slow", dur: 3000, cx: "line", rounds: 3, timed: false },
    medium: { tracked: 4, ratio: 2, speed: "med", dur: 5000, cx: "curve", rounds: 3, timed: false },
    hard: { tracked: 5, ratio: 3, speed: "fast", dur: 7000, cx: "zigzag", rounds: 5, timed: true },
  };
  const MOT = {
    running: false, paused: false, finished: false, phase: "idle",
    tracked: 4, ratio: 2, speed: "med", speedW: 90, duration: 5000, complexity: "curve",
    rounds: 3, timed: false, selLimit: 8000,
    round: 0, score: 0, totalHits: 0, totalFA: 0, totalTargets: 0,
    balls: [], targets: [], selected: new Set(),
    cueRemain: 0, motionRemain: 0, selRemain: 0, lastTick: null,
  };

  function motSetSegActive(segEl, attr, val) { segEl.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset[attr] === val)); }
  function motBindSeg(segId, attr, cb) {
    const seg = $(segId);
    seg.addEventListener("click", (e) => { const btn = e.target.closest(".seg-btn"); if (!btn) return; seg.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); cb(btn.dataset[attr]); });
  }
  function motReadControls() {
    MOT.tracked = parseInt(motTrackSeg.querySelector(".seg-btn.active").dataset.n, 10);
    MOT.ratio = parseInt(motRatioSeg.querySelector(".seg-btn.active").dataset.r, 10);
    MOT.speed = motSpeedSeg.querySelector(".seg-btn.active").dataset.s;
    MOT.duration = parseInt(motDurSeg.querySelector(".seg-btn.active").dataset.d, 10);
    MOT.complexity = motCxSeg.querySelector(".seg-btn.active").dataset.c;
    MOT.rounds = parseInt(motRoundsSeg.querySelector(".seg-btn.active").dataset.r, 10);
    MOT.timed = motTimed.checked;
    MOT.selLimit = parseInt(motSelLimitSeg.querySelector(".seg-btn.active").dataset.s, 10);
    MOT.speedW = ({ slow: 0.09, med: 0.15, fast: 0.24 }[MOT.speed]) * MW;
  }
  function motUpdateTotalInfo() {
    const tracked = parseInt(motTrackSeg.querySelector(".seg-btn.active").dataset.n, 10);
    const ratio = parseInt(motRatioSeg.querySelector(".seg-btn.active").dataset.r, 10);
    $("motTotalInfo").textContent = tracked * (ratio + 1);
  }
  function motApplyDifficulty(diff) {
    const p = MOT_PRESETS[diff]; if (!p) return;
    motSetSegActive(motTrackSeg, "n", String(p.tracked));
    motSetSegActive(motRatioSeg, "r", String(p.ratio));
    motSetSegActive(motSpeedSeg, "s", p.speed);
    motSetSegActive(motDurSeg, "d", String(p.dur));
    motSetSegActive(motCxSeg, "c", p.cx);
    motSetSegActive(motRoundsSeg, "r", String(p.rounds));
    motTimed.checked = p.timed; motSelLimitWrap.classList.toggle("hidden", !p.timed);
    motUpdateTotalInfo();
  }
  function motCxForRound(r) { return MOT.complexity === "inc" ? ["line", "curve", "zigzag"][Math.min(r, 2)] : MOT.complexity; }

  function motStart() {
    if (state_sound) beep(880, 0.1, "sine");
    motReadControls();
    MOT.score = 0; MOT.totalHits = 0; MOT.totalFA = 0; MOT.totalTargets = 0; MOT.round = 0; MOT.finished = false;
    MOT.running = true; MOT.paused = false;
    motStartBtn.disabled = true; motPauseBtn.disabled = false; motResumeBtn.disabled = true; motSubmitBtn.disabled = true; motResetBtn.disabled = false;
    motStartRound(0);
    MOT.lastTick = null; requestAnimationFrame(motTick);
  }
  function motStartRound(r) {
    MOT.round = r;
    const total = MOT.tracked * (MOT.ratio + 1);
    const r0 = Math.max(11, 24 - total * 0.55);
    const sp = MOT.speedW;
    MOT.balls = [];
    for (let i = 0; i < total; i++) {
      const a = Math.random() * Math.PI * 2;
      MOT.balls.push({ x: rnd(r0, MW - r0), y: rnd(r0, MH - r0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: r0, ang: a, w: rnd(-1.3, 1.3), changeT: rnd(0.4, 1.1) });
    }
    MOT.targets = shuffle(Array.from({ length: total }, (_, i) => i)).slice(0, MOT.tracked);
    MOT.selected = new Set();
    MOT.phase = "cue"; MOT.cueRemain = CUE_MS;
    motOverlay.classList.add("hidden");
    motResultBar.classList.add("hidden");
    motWrap.classList.remove("selecting");
    motSelectHint.textContent = `记住 ${MOT.tracked} 个高亮小球（第 ${MOT.round + 1} / ${MOT.rounds} 轮）`;
    motUpdateHud();
    motRender(true, null, false);
  }
  function motUpdateMotion(dt) {
    const cx = motCxForRound(MOT.round);
    if (cx === "curve") {
      for (const b of MOT.balls) { b.ang += b.w * dt; const sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(b.ang) * sp; b.vy = Math.sin(b.ang) * sp; }
    } else if (cx === "zigzag") {
      for (const b of MOT.balls) { b.changeT -= dt; if (b.changeT <= 0) { const a = Math.random() * Math.PI * 2; const sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.changeT = rnd(0.4, 1.1); } }
    }
    for (const b of MOT.balls) { b.x += b.vx * dt; b.y += b.vy * dt; }
    for (const b of MOT.balls) {
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
      else if (b.x > MW - b.r) { b.x = MW - b.r; b.vx = -Math.abs(b.vx); }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }
      else if (b.y > MH - b.r) { b.y = MH - b.r; b.vy = -Math.abs(b.vy); }
    }
    for (let i = 0; i < MOT.balls.length; i++) {
      for (let j = i + 1; j < MOT.balls.length; j++) {
        const a = MOT.balls[i], b = MOT.balls[j];
        const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.hypot(dx, dy); const min = a.r + b.r;
        if (dist > 0 && dist < min) {
          const nx = dx / dist, ny = dy / dist;
          const p = (a.vx * nx + a.vy * ny) - (b.vx * nx + b.vy * ny);
          a.vx -= p * nx; a.vy -= p * ny; b.vx += p * nx; b.vy += p * ny;
          const ov = (min - dist) / 2; a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
        }
      }
    }
  }
  function motEnterSelect() {
    MOT.phase = "select"; MOT.selected = new Set();
    motWrap.classList.add("selecting");
    motSubmitBtn.disabled = false; motSubmitBtn.textContent = "验证答案"; motPauseBtn.disabled = true;
    motResultBar.classList.add("hidden");
    if (MOT.timed) MOT.selRemain = MOT.selLimit;
    motSelectHint.innerHTML = `点击你记住的目标小球（已选 <b>0</b> / 目标 ${MOT.tracked}）`;
    if (state_sound) beep(620, 0.08, "sine");
    motRender(false, MOT.selected, false);
  }
  function motTick(now) {
    if (!MOT.running) return;
    if (MOT.lastTick == null) MOT.lastTick = now;
    let dt = (now - MOT.lastTick) / 1000; MOT.lastTick = now;
    if (dt < 0) dt = 0; if (dt > 0.05) dt = 0.05;
    if (!MOT.paused) {
      if (MOT.phase === "cue") {
        MOT.cueRemain -= dt * 1000;
        if (MOT.cueRemain <= 0) { MOT.phase = "motion"; MOT.motionRemain = MOT.duration; motSelectHint.textContent = "标记已消失，用眼睛跟踪目标小球！"; if (state_sound) beep(740, 0.08, "sine"); }
      } else if (MOT.phase === "motion") {
        motUpdateMotion(dt);
        MOT.motionRemain -= dt * 1000;
        if (MOT.motionRemain <= 0) motEnterSelect();
      } else if (MOT.phase === "select") {
        if (MOT.timed) { MOT.selRemain -= dt * 1000; if (MOT.selRemain <= 0) motSubmit(); }
      }
      motUpdateHud();
      if (MOT.phase === "cue") motRender(true, null, false);
      else if (MOT.phase === "motion") motRender(false, null, false);
      else if (MOT.phase === "select") motRender(false, MOT.selected, false);
    }
    requestAnimationFrame(motTick);
  }
  function motSubmit() {
    if (MOT.phase === "select") {
      const sel = MOT.selected;
      let hits = 0, fa = 0;
      for (let i = 0; i < MOT.balls.length; i++) {
        const isT = MOT.targets.includes(i), isS = sel.has(i);
        if (isT && isS) hits++;
        else if (!isT && isS) fa++;
      }
      const miss = MOT.tracked - hits;
      MOT.score += Math.max(0, hits - fa);
      MOT.totalHits += hits; MOT.totalFA += fa; MOT.totalTargets += MOT.tracked;
      MOT.phase = "result";
      motWrap.classList.remove("selecting");
      motSubmitBtn.disabled = false;
      motSubmitBtn.textContent = (MOT.round + 1 >= MOT.rounds) ? "查看总结果" : "下一轮 ▶";
      motPauseBtn.disabled = true;
      motRender(false, sel, true);
      motSelectHint.innerHTML = `验证完成，已用颜色标出对错，请查看下方说明。`;
      motResultFB.innerHTML = `第 ${MOT.round + 1} 轮 · 命中 <b class="ok">${hits} / ${MOT.tracked}</b> · 误选 <b class="bad">${fa}</b> · 漏跟 <b class="warn">${miss}</b> · 本轮得分 <b>${Math.max(0, hits - fa)}</b>（累计 ${MOT.score}）`;
      motResultBar.classList.remove("hidden");
      if (state_sound) { if (hits === MOT.tracked && fa === 0) beep(990, 0.12, "sine"); else beep(300, 0.15, "square", 0.05); }
      motUpdateHud();
    } else if (MOT.phase === "result") {
      motResultBar.classList.add("hidden");
      if (MOT.round + 1 >= MOT.rounds) motFinalize();
      else motStartRound(MOT.round + 1);
    }
  }
  function motFinalize() {
    MOT.running = false; MOT.finished = true;
    motStartBtn.disabled = false; motPauseBtn.disabled = true; motResumeBtn.disabled = true; motSubmitBtn.disabled = true; motResetBtn.disabled = false;
    const acc = MOT.totalTargets ? Math.round(100 * MOT.totalHits / MOT.totalTargets) : 0;
    const precision = (MOT.totalHits + MOT.totalFA) ? Math.round(100 * MOT.totalHits / (MOT.totalHits + MOT.totalFA)) : 0;
    saveRecord({ game: "mot", tracked: MOT.tracked, total: MOT.tracked * (MOT.ratio + 1), speed: MOT.speed, duration: MOT.duration, complexity: MOT.complexity, timed: MOT.timed, rounds: MOT.rounds, success: true, metric: acc, unit: "%", metricLabel: "命中率", betterIsLower: false, score: MOT.score, hits: MOT.totalHits, fa: MOT.totalFA, precision, date: Date.now() });
    motShowOverlay("🎉", "全部完成！", `总命中率 ${acc}%（精确率 ${precision}%）· 累计得分 ${MOT.score}`, "再来一局", "finish");
  }
  function motShowOverlay(emoji, title, desc, btn, action) {
    motOe.textContent = emoji; motOt.textContent = title; motOd.textContent = desc; motOs.textContent = btn;
    motOs.dataset.action = action; motOverlay.classList.remove("hidden");
  }
  function motUpdateHud() {
    motRoundVal.textContent = (MOT.running ? MOT.round + 1 : 0) + " / " + MOT.rounds;
    motPhaseVal.textContent = ({ idle: "准备", cue: "标记中", motion: "追踪中", select: "选择中", result: "结算" }[MOT.phase]) || "准备";
    motScoreVal.textContent = MOT.score;
    let t = "—";
    if (MOT.phase === "cue") t = Math.ceil(MOT.cueRemain / 1000) + "s";
    else if (MOT.phase === "motion") t = Math.ceil(MOT.motionRemain / 1000) + "s";
    else if (MOT.phase === "select" && MOT.timed) t = Math.ceil(MOT.selRemain / 1000) + "s";
    motTimeVal.textContent = t;
    const danger = (MOT.phase === "select" && MOT.timed && MOT.selRemain < 3000);
    motTimeVal.closest(".hud-item").classList.toggle("danger", danger);
  }
  function motRender(highlight, selectedSet, resultMode) {
    if (!mctx) return;
    mctx.clearRect(0, 0, MW, MH);
    for (let i = 0; i < MOT.balls.length; i++) {
      const b = MOT.balls[i];
      let fill = "#6c8cff", ring = null, ringW = 3, dash = false;
      if (resultMode) {
        const isT = MOT.targets.includes(i), isS = selectedSet.has(i);
        if (isT && isS) { fill = "#36d399"; ring = "#0a9e6b"; ringW = 4; }
        else if (isT && !isS) { fill = "#6c8cff"; ring = "#ffcc66"; ringW = 4; dash = true; }
        else if (!isT && isS) { fill = "#ff6b81"; }
        else { fill = "#6c8cff"; }
      } else {
        if (highlight && MOT.targets.includes(i)) { ring = "#ffd166"; ringW = 5; }
        if (selectedSet && selectedSet.has(i)) { ring = "#36d399"; ringW = 5; }
      }
      mctx.beginPath(); mctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      mctx.fillStyle = fill; mctx.fill();
      if (ring) { mctx.lineWidth = ringW; mctx.strokeStyle = ring; mctx.setLineDash(dash ? [5, 4] : []); mctx.stroke(); mctx.setLineDash([]); }
    }
  }
  function motPause() {
    if (!MOT.running || MOT.paused) return; MOT.paused = true;
    motPauseBtn.disabled = true; motResumeBtn.disabled = false;
    motShowOverlay("⏸", "已暂停", "点击「恢复」继续训练。", "继续", "resume"); if (state_sound) beep(520, 0.1, "sine");
  }
  function motResume() {
    if (!MOT.running || !MOT.paused) return; MOT.paused = false; MOT.lastTick = null;
    motOverlay.classList.add("hidden"); motPauseBtn.disabled = false; motResumeBtn.disabled = true; if (state_sound) beep(620, 0.1, "sine");
  }
  function motReset() {
    MOT.running = false; MOT.paused = false; MOT.finished = false; MOT.phase = "idle"; MOT.round = 0; MOT.score = 0; MOT.totalHits = 0; MOT.totalFA = 0; MOT.totalTargets = 0; MOT.lastTick = null;
    MOT.balls = []; MOT.targets = []; MOT.selected = new Set();
    motStartBtn.disabled = false; motPauseBtn.disabled = true; motResumeBtn.disabled = true; motSubmitBtn.disabled = true; motSubmitBtn.textContent = "验证答案"; motResetBtn.disabled = false;
    motWrap.classList.remove("selecting");
    motResultBar.classList.add("hidden");
    if (mctx) mctx.clearRect(0, 0, MW, MH);
    motRoundVal.textContent = "0 / " + MOT.rounds; motPhaseVal.textContent = "准备"; motScoreVal.textContent = "0"; motTimeVal.textContent = "—";
    motSelectHint.textContent = "点击「开始」后，记住被高亮标记的小球。";
    motShowOverlay("◍", "准备开始", "记住短暂高亮标记的小球，标记消失后用眼睛跟踪它们；运动结束后，从所有小球中选出你记住的目标。", "开始训练", "start");
  }
  motOs.addEventListener("click", () => { const a = motOs.dataset.action; if (a === "start") motStart(); else if (a === "next") motStartRound(MOT.round + 1); else if (a === "resume") motResume(); else motReset(); });
  motCanvas.addEventListener("click", (e) => {
    if (MOT.phase !== "select") return;
    const rect = motCanvas.getBoundingClientRect();
    const sx = rect.width ? MW / rect.width : 1, sy = rect.height ? MH / rect.height : 1;
    const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
    let hit = -1, best = 1e9;
    for (let i = 0; i < MOT.balls.length; i++) { const b = MOT.balls[i]; const d = Math.hypot(b.x - x, b.y - y); if (d <= b.r && d < best) { best = d; hit = i; } }
    if (hit >= 0) {
      if (MOT.selected.has(hit)) MOT.selected.delete(hit); else MOT.selected.add(hit);
      motRender(false, MOT.selected, false);
      motSelectHint.innerHTML = `点击你记住的目标小球（已选 <b>${MOT.selected.size}</b> / 目标 ${MOT.tracked}）`;
    }
  });
  motStartBtn.addEventListener("click", motStart);
  motPauseBtn.addEventListener("click", motPause);
  motResumeBtn.addEventListener("click", motResume);
  motSubmitBtn.addEventListener("click", motSubmit);
  motResetBtn.addEventListener("click", motReset);
  motBindSeg("motDiffSeg", "diff", (v) => motApplyDifficulty(v));
  motBindSeg("motTrackSeg", "n", () => motUpdateTotalInfo());
  motBindSeg("motRatioSeg", "r", () => motUpdateTotalInfo());
  motBindSeg("motSpeedSeg", "s", () => {});
  motBindSeg("motDurSeg", "d", () => {});
  motBindSeg("motCxSeg", "c", () => {});
  motBindSeg("motRoundsSeg", "r", () => {});
  motBindSeg("motSelLimitSeg", "s", () => {});
  motTimed.addEventListener("change", (e) => { motSelLimitWrap.classList.toggle("hidden", !e.target.checked); });
  function motIdle() { motReset(); }

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
      if (e.key.toLowerCase() === "f" || e.key === "ArrowLeft") { e.preventDefault(); flRespond(-1); }
      else if (e.key.toLowerCase() === "j" || e.key === "ArrowRight") { e.preventDefault(); flRespond(1); }
      else if (e.code === "Space") { e.preventDefault(); if (!FL.running) flStart(); else if (FL.paused) flResume(); else flEnd(); }
      else if (e.key.toLowerCase() === "r") flReset();
    } else if (currentGame === "digitspan") {
      if (e.key >= "0" && e.key <= "9") { e.preventDefault(); dsInputDigit(parseInt(e.key, 10)); }
      else if (e.key === "Backspace") { e.preventDefault(); dsInputBack(); }
      else if (e.key === "Enter") { e.preventDefault(); if (DS.input.length === DS.len) dsSubmit(); }
      else if (e.code === "Space") { e.preventDefault(); if (!DS.running) dsStart(); else dsEnd(); }
      else if (e.key.toLowerCase() === "r") dsReset();
    } else if (currentGame === "task") {
      if (e.key.toLowerCase() === "f" || e.key === "ArrowLeft") { e.preventDefault(); tsRespond(-1); }
      else if (e.key.toLowerCase() === "j" || e.key === "ArrowRight") { e.preventDefault(); tsRespond(1); }
      else if (e.code === "Space") { e.preventDefault(); if (!TS.running) tsStart(); else if (TS.paused) tsResume(); else tsEnd(); }
      else if (e.key.toLowerCase() === "r") tsReset();
    } else if (currentGame === "mot") {
      if (e.code === "Space") { e.preventDefault(); if (!MOT.running) motStart(); else if (MOT.paused) motResume(); else if (MOT.phase === "select" || MOT.phase === "result") motSubmit(); }
      else if (e.key.toLowerCase() === "r") motReset();
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
    tsReset();
    motReset();
  }
  init();
})();
