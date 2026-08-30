/**
 * 카드 뒤집기 — Canvas 2D API
 *
 * Context7 (/mdn/content, /websites/developer_mozilla_en-us)에서 확인한 API:
 * - canvas.getContext("2d")
 * - roundRect + fill/stroke
 * - save / restore / translate / scale (뒤집기)
 * - createLinearGradient
 * - fillText
 * - devicePixelRatio로 고해상도 맞춤
 * - 클릭 좌표: clientX/Y - getBoundingClientRect()
 * - requestAnimationFrame 게임 루프
 */

const PAIRS = ["🍎", "🍋", "🍇", "🍓", "🍑", "🍒", "🥝", "🍉"];
const COLS = 4;
const ROWS = 4;
const FLIP_MS = 360;
const MISMATCH_MS = 820;
const PREVIEW_STAGGER_MS = 45;
const PREVIEW_HOLD_MS = 3000;
const BEST_KEY = "card-flip-best-moves";
const NAME_KEY = "card-flip-player-name";
const MUTE_KEY = "card-flip-muted";
const FONT = "'IBM Plex Sans KR', 'Malgun Gothic', sans-serif";
const DISPLAY = "'Playfair Display', 'Times New Roman', serif";
const SUPABASE_URL = "https://xtzzhxytfgngurmvfiwi.supabase.co";
const SUPABASE_KEY = "sb_publishable_e2rbJxUMqz4hhxic76LWDQ_MFYIGNxQ";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const resultSummaryEl = document.getElementById("result-summary");
const playerNameEl = document.getElementById("player-name");
const saveScoreBtn = document.getElementById("save-score");
const saveStatusEl = document.getElementById("save-status");
const leaderboardListEl = document.getElementById("leaderboard-list");
const playAgainBtn = document.getElementById("play-again");
const muteBtn = document.getElementById("mute-sound");

const db = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const sound = {
  ctx: null,
  muted: localStorage.getItem(MUTE_KEY) === "1",
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  tone(freq, duration, type, volume, when) {
    if (this.muted) return;
    const audio = this.ensure();
    const start = when ?? audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  },
  flip() {
    if (this.muted) return;
    const audio = this.ensure();
    const start = audio.currentTime;
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(460, start);
    osc.frequency.exponentialRampToValueAtTime(170, start + 0.13);
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    gain.gain.setValueAtTime(0.09, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.16);
    this.tone(88, 0.05, "sine", 0.05, start);
  },
  match() {
    if (this.muted) return;
    const audio = this.ensure();
    this.tone(523.25, 0.12, "sine", 0.08, audio.currentTime);
    this.tone(659.25, 0.18, "sine", 0.07, audio.currentTime + 0.08);
  },
  mismatch() {
    if (this.muted) return;
    const audio = this.ensure();
    this.tone(148, 0.16, "triangle", 0.06, audio.currentTime);
    this.tone(108, 0.2, "sine", 0.05, audio.currentTime + 0.05);
  },
  win() {
    if (this.muted) return;
    const audio = this.ensure();
    [523.25, 659.25, 783.99, 1046.5].forEach((note, i) => {
      this.tone(note, 0.22, "sine", 0.07, audio.currentTime + i * 0.1);
    });
  },
};

function syncMuteButton() {
  muteBtn.setAttribute("aria-pressed", sound.muted ? "true" : "false");
  muteBtn.setAttribute("aria-label", sound.muted ? "효과음 켜기" : "효과음 끄기");
  muteBtn.textContent = sound.muted ? "🔇" : "♪";
}

const state = {
  cards: [],
  open: [],
  locked: false,
  phase: "preview",
  previewUntil: 0,
  timers: [],
  moves: 0,
  matches: 0,
  startedAt: 0,
  elapsed: 0,
  won: false,
  scoreSaved: false,
  hover: -1,
  restartBtn: null,
  particles: [],
  cssW: 560,
  cssH: 640,
};

function shuffle(list) {
  const next = list.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function layout() {
  const w = state.cssW;
  const h = state.cssH;
  const pad = 28;
  const headerH = 92;
  const footerH = 88;
  const gridTop = headerH;
  const gridH = h - headerH - footerH;
  const gap = 12;
  const cellW = (w - pad * 2 - gap * (COLS - 1)) / COLS;
  const cellH = (gridH - pad * 0.4 - gap * (ROWS - 1)) / ROWS;
  const size = Math.min(cellW, cellH);
  const gridW = size * COLS + gap * (COLS - 1);
  const gridStartX = (w - gridW) / 2;
  const gridStartY = gridTop + (gridH - (size * ROWS + gap * (ROWS - 1))) / 2;

  return {
    w,
    h,
    pad,
    size,
    gap,
    gridStartX,
    gridStartY,
    headerH,
    restart: {
      x: w / 2 - 78,
      y: h - 68,
      w: 156,
      h: 44,
    },
  };
}

function cardRect(card, lay) {
  return {
    x: lay.gridStartX + card.col * (lay.size + lay.gap),
    y: lay.gridStartY + card.row * (lay.size + lay.gap),
    w: lay.size,
    h: lay.size,
  };
}

function clearTimers() {
  for (const id of state.timers) window.clearTimeout(id);
  state.timers = [];
}

function after(ms, fn) {
  const id = window.setTimeout(fn, ms);
  state.timers.push(id);
  return id;
}

function resetGame() {
  clearTimers();
  const symbols = shuffle([...PAIRS, ...PAIRS]);
  state.cards = symbols.map((symbol, i) => ({
    symbol,
    col: i % COLS,
    row: Math.floor(i / COLS),
    faceUp: false,
    matched: false,
    flip: 0,
    flipping: false,
    from: 0,
    to: 0,
    start: 0,
  }));
  state.open = [];
  state.locked = true;
  state.phase = "preview";
  state.previewUntil = 0;
  state.moves = 0;
  state.matches = 0;
  state.startedAt = 0;
  state.elapsed = 0;
  state.won = false;
  state.scoreSaved = false;
  state.hover = -1;
  state.particles = [];
  hideResult();
  announce("카드를 기억하세요.");
  startPreview();
}

function startPreview() {
  const lastOpenAt = (state.cards.length - 1) * PREVIEW_STAGGER_MS;

  state.cards.forEach((card, i) => {
    after(i * PREVIEW_STAGGER_MS, () => startFlip(card, 1, true));
  });

  after(lastOpenAt + FLIP_MS, () => {
    state.previewUntil = performance.now() + PREVIEW_HOLD_MS;
  });
  after(lastOpenAt + FLIP_MS + PREVIEW_HOLD_MS, hidePreview);
}

function hidePreview() {
  state.phase = "hiding";
  state.previewUntil = 0;
  state.cards.forEach((card, i) => {
    after(i * PREVIEW_STAGGER_MS, () => startFlip(card, 0, true));
  });

  const lastHideAt = (state.cards.length - 1) * PREVIEW_STAGGER_MS + FLIP_MS;
  after(lastHideAt, () => {
    state.phase = "play";
    state.locked = false;
    state.previewUntil = 0;
    announce("같은 그림을 찾아 짝을 맞추세요.");
  });
}

function announce(text) {
  statusEl.textContent = text;
}

function bestMoves() {
  const raw = localStorage.getItem(BEST_KEY);
  return raw ? Number(raw) : null;
}

function saveBest() {
  const prev = bestMoves();
  if (prev == null || state.moves < prev) {
    localStorage.setItem(BEST_KEY, String(state.moves));
  }
}

function playerName() {
  const name = playerNameEl.value.trim() || "익명";
  return name.slice(0, 24);
}

function showResult() {
  resultSummaryEl.textContent = `${state.moves}번 이동 · ${formatTime(state.elapsed)}`;
  playerNameEl.value = localStorage.getItem(NAME_KEY) || "";
  saveScoreBtn.disabled = false;
  saveStatusEl.textContent = "닉네임을 적고 점수 저장을 눌러 주세요.";
  resultEl.hidden = false;
  playerNameEl.focus();
}

function hideResult() {
  resultEl.hidden = true;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderLeaderboard(rows, message) {
  if (message) {
    leaderboardListEl.innerHTML = `<li class="empty">${message}</li>`;
    return;
  }

  leaderboardListEl.innerHTML = rows
    .map(
      (row, i) =>
        `<li><span>${i + 1}. ${escapeHtml(row.player_name)}</span><span>${row.moves}회 · ${formatTime(Number(row.time_seconds))}</span></li>`,
    )
    .join("");
}

async function refreshLeaderboard() {
  if (!db) {
    renderLeaderboard([], "수파베이스에 연결되지 않았습니다.");
    return;
  }

  const { data, error } = await db
    .from("scores")
    .select("player_name, moves, time_seconds")
    .order("moves", { ascending: true })
    .order("time_seconds", { ascending: true })
    .limit(5);

  if (error) {
    renderLeaderboard([], "리더보드를 불러오지 못했습니다.");
    return;
  }

  if (!data.length) {
    renderLeaderboard([], "아직 기록이 없습니다.");
    return;
  }

  renderLeaderboard(data);
}

function subscribeLeaderboard() {
  if (!db) return;

  db.channel("scores-leaderboard")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "scores" },
      () => {
        refreshLeaderboard();
      },
    )
    .subscribe();
}

async function saveScore() {
  if (state.scoreSaved) {
    saveStatusEl.textContent = "이 판은 이미 저장했습니다.";
    return;
  }

  if (!db) {
    saveStatusEl.textContent = "저장할 수 없습니다. 게임실행.bat으로 다시 열어 주세요.";
    return;
  }

  const name = playerName();
  localStorage.setItem(NAME_KEY, name);
  saveScoreBtn.disabled = true;
  saveStatusEl.textContent = "저장하는 중...";

  const { error } = await db.from("scores").insert({
    player_name: name,
    moves: state.moves,
    time_seconds: Number(state.elapsed.toFixed(2)),
    matched_pairs: state.matches,
  });

  if (error) {
    saveScoreBtn.disabled = false;
    saveStatusEl.textContent = "저장에 실패했습니다. 다시 눌러 주세요.";
    return;
  }

  state.scoreSaved = true;
  saveStatusEl.textContent = `${name} 이름으로 저장되었습니다.`;
  announce("점수가 수파베이스에 저장되었습니다.");
  await refreshLeaderboard();
}

function hitTest(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function canvasPoint(event) {
  const bounding = canvas.getBoundingClientRect();
  const x = ((event.clientX - bounding.left) * state.cssW) / bounding.width;
  const y = ((event.clientY - bounding.top) * state.cssH) / bounding.height;
  return { x, y };
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function startFlip(card, to, quiet = false) {
  card.flipping = true;
  card.from = card.flip;
  card.to = to;
  card.start = performance.now();
  if (!quiet) sound.flip();
}

function spawnBurst(x, y, color) {
  for (let i = 0; i < 18; i += 1) {
    const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.2;
    const speed = 80 + Math.random() * 140;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40,
      life: 1,
      color,
      size: 3 + Math.random() * 3,
    });
  }
}

function updateFlips(now) {
  for (const card of state.cards) {
    if (!card.flipping) continue;
    const t = Math.min(1, (now - card.start) / FLIP_MS);
    card.flip = card.from + (card.to - card.from) * easeInOut(t);
    if (t >= 1) {
      card.flip = card.to;
      card.flipping = false;
      card.faceUp = card.to === 1;
    }
  }
}

function updateParticles(dt) {
  for (const p of state.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 420 * dt;
    p.life -= dt * 1.4;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
}

function tryOpen(index) {
  const card = state.cards[index];
  if (state.phase !== "play" || state.locked || state.won || card.matched || card.flipping || card.faceUp) return;
  if (state.open.includes(index)) return;

  if (!state.startedAt) state.startedAt = performance.now();

  startFlip(card, 1);
  state.open.push(index);
  announce(`카드 ${state.open.length}장을 뒤집었습니다.`);

  if (state.open.length < 2) return;

  state.moves += 1;
  const [a, b] = state.open;
  const first = state.cards[a];
  const second = state.cards[b];

  if (first.symbol === second.symbol) {
    first.matched = true;
    second.matched = true;
    state.matches += 1;
    state.open = [];
    const lay = layout();
    const r = cardRect(first, lay);
    spawnBurst(r.x + r.w / 2, r.y + r.h / 2, "#e4c078");
    sound.match();
    announce(`${first.symbol} 짝을 맞췄습니다. ${state.matches} / 8`);

    if (state.matches === PAIRS.length) {
      state.won = true;
      state.elapsed = (performance.now() - state.startedAt) / 1000;
      saveBest();
      sound.win();
      announce(`완료! ${state.moves}번 만에 맞췄습니다.`);
      showResult();
    }
    return;
  }

  sound.mismatch();
  state.locked = true;
  after(MISMATCH_MS, () => {
    if (state.phase !== "play") return;
    startFlip(first, 0);
    startFlip(second, 0);
    state.open = [];
    state.locked = false;
  });
}

function fillRoundRect(context, x, y, w, h, radius) {
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, w, h, radius);
  } else {
    const r = Math.min(radius, w / 2, h / 2);
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }
}

function drawBackground(lay) {
  const felt = ctx.createRadialGradient(lay.w * 0.5, 40, 40, lay.w * 0.5, lay.h * 0.4, lay.h);
  felt.addColorStop(0, "#4a2230");
  felt.addColorStop(0.45, "#2b1520");
  felt.addColorStop(1, "#140a10");
  ctx.fillStyle = felt;
  fillRoundRect(ctx, 0, 0, lay.w, lay.h, 24);
  ctx.fill();

  ctx.save();
  fillRoundRect(ctx, 0, 0, lay.w, lay.h, 24);
  ctx.clip();
  ctx.strokeStyle = "rgb(0 0 0 / 0.08)";
  ctx.lineWidth = 1;
  for (let y = 10; y < lay.h; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(lay.w, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgb(228 192 120 / 0.38)";
  ctx.lineWidth = 2;
  fillRoundRect(ctx, 14, 14, lay.w - 28, lay.h - 36, 20);
  ctx.stroke();

  ctx.strokeStyle = "rgb(228 192 120 / 0.12)";
  ctx.lineWidth = 6;
  fillRoundRect(ctx, 18, 18, lay.w - 36, lay.h - 40, 18);
  ctx.stroke();
}

function drawHeader(lay, now) {
  if (state.startedAt && !state.won) {
    state.elapsed = (now - state.startedAt) / 1000;
  }

  ctx.fillStyle = "#e4c078";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 28px ${DISPLAY}`;
  ctx.fillText("카드 뒤집기", 32, 26);

  ctx.font = `500 14px ${FONT}`;
  ctx.fillStyle = "#d9c8b0";
  ctx.fillText(previewHint(now), 32, 62);

  const time = formatTime(state.elapsed);
  const best = bestMoves();
  ctx.textAlign = "right";
  ctx.fillStyle = "#f7efe2";
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(`이동 ${state.moves}`, lay.w - 32, 28);
  ctx.fillStyle = "#d9c8b0";
  ctx.font = `500 14px ${FONT}`;
  ctx.fillText(`시간 ${time}`, lay.w - 32, 52);
  ctx.fillText(best == null ? "최고 기록 —" : `최고 ${best}회`, lay.w - 32, 72);
}

function previewHint(now) {
  if (state.phase === "hiding") return "카드를 덮는 중";
  if (state.phase !== "preview") return "같은 그림을 찾아 짝을 맞추세요";
  if (!state.previewUntil) return "카드를 기억하세요";
  const remain = Math.max(0, Math.ceil((state.previewUntil - now) / 1000));
  return remain > 0 ? `위치를 기억하세요  ${remain}` : "카드를 덮는 중";
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function drawCardBack(x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "#6a3040");
  g.addColorStop(0.55, "#4a1c2a");
  g.addColorStop(1, "#32141c");
  ctx.fillStyle = g;
  fillRoundRect(ctx, x, y, w, h, 16);
  ctx.fill();

  ctx.save();
  fillRoundRect(ctx, x + 8, y + 7, w - 16, h - 14, 11);
  ctx.clip();
  ctx.strokeStyle = "rgb(228 192 120 / 0.18)";
  ctx.lineWidth = 1;
  const step = 11;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgb(228 192 120 / 0.55)";
  ctx.lineWidth = 1.6;
  fillRoundRect(ctx, x + 7, y + 7, w - 14, h - 14, 12);
  ctx.stroke();

  ctx.fillStyle = "rgb(228 192 120 / 0.78)";
  ctx.font = `${Math.floor(w * 0.26)}px ${DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("◆", x + w / 2, y + h / 2 + 1);
}

function drawCardFront(card, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "#fffaf3");
  g.addColorStop(1, card.matched ? "#f4e6c0" : "#f3ead8");
  ctx.fillStyle = g;
  fillRoundRect(ctx, x, y, w, h, 16);
  ctx.fill();

  ctx.strokeStyle = card.matched ? "#c4963a" : "#e0c9a4";
  ctx.lineWidth = card.matched ? 2.4 : 1.6;
  fillRoundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 14);
  ctx.stroke();

  if (card.matched) {
    ctx.strokeStyle = "rgb(228 192 120 / 0.45)";
    ctx.lineWidth = 1;
    fillRoundRect(ctx, x + 7, y + 7, w - 14, h - 14, 10);
    ctx.stroke();
  }

  ctx.font = `${Math.floor(w * 0.46)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#2a1c16";
  ctx.fillText(card.symbol, x + w / 2, y + h / 2 + 2);
}

function drawCard(card, index, lay) {
  const rect = cardRect(card, lay);
  const scaleX = Math.max(0.05, Math.abs(Math.cos(card.flip * Math.PI)));
  const showFront = card.flip >= 0.5;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const hovering = state.hover === index && state.phase === "play" && !card.matched && !state.won;
  const lift = (hovering ? 5 : 0) + (card.flipping ? 10 * (1 - scaleX) : 0);

  ctx.save();
  ctx.translate(cx, cy - lift);
  ctx.scale(scaleX, 1);
  ctx.translate(-cx, -cy);
  ctx.shadowColor = hovering || card.flipping ? "rgb(228 192 120 / 0.42)" : "rgb(0 0 0 / 0.35)";
  ctx.shadowBlur = hovering || card.flipping ? 18 + lift : 10;
  ctx.shadowOffsetY = 6 + lift * 0.4;

  if (showFront) drawCardFront(card, rect.x, rect.y, rect.w, rect.h);
  else drawCardBack(rect.x, rect.y, rect.w, rect.h);

  ctx.restore();
}

function drawRestart(lay) {
  const btn = lay.restart;
  state.restartBtn = btn;
  const hovered = state.hover === -2;

  ctx.fillStyle = hovered ? "#5c2a3a" : "#4a2230";
  fillRoundRect(ctx, btn.x, btn.y, btn.w, btn.h, 12);
  ctx.fill();
  ctx.strokeStyle = "rgb(228 192 120 / 0.55)";
  ctx.lineWidth = 1.4;
  fillRoundRect(ctx, btn.x + 0.5, btn.y + 0.5, btn.w - 1, btn.h - 1, 12);
  ctx.stroke();

  ctx.fillStyle = "#f7efe2";
  ctx.font = `700 16px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(state.won ? "한 판 더" : "다시하기", btn.x + btn.w / 2, btn.y + btn.h / 2);
}

function drawWin(lay) {
  if (!state.won) return;
  ctx.fillStyle = "rgb(12 6 10 / 0.28)";
  fillRoundRect(ctx, 0, 0, lay.w, lay.h, 24);
  ctx.fill();
}

function drawParticles() {
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function draw(now) {
  const lay = layout();
  ctx.clearRect(0, 0, lay.w, lay.h);
  drawBackground(lay);
  drawHeader(lay, now);
  state.cards.forEach((card, i) => drawCard(card, i, lay));
  drawParticles();
  drawWin(lay);
  drawRestart(lay);
}

let last = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateFlips(now);
  updateParticles(dt);
  draw(now);
  requestAnimationFrame(loop);
}

function resize() {
  const cssW = 560;
  const cssH = 640;
  state.cssW = cssW;
  state.cssH = cssH;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function indexAt(x, y) {
  const lay = layout();
  if (hitTest(x, y, lay.restart)) return -2;
  for (let i = 0; i < state.cards.length; i += 1) {
    if (hitTest(x, y, cardRect(state.cards[i], lay))) return i;
  }
  return -1;
}

canvas.addEventListener("pointermove", (event) => {
  const { x, y } = canvasPoint(event);
  state.hover = indexAt(x, y);
});

canvas.addEventListener("pointerleave", () => {
  state.hover = -1;
});

canvas.addEventListener("click", (event) => {
  if (!resultEl.hidden) return;
  const { x, y } = canvasPoint(event);
  const index = indexAt(x, y);
  if (index === -2) {
    resetGame();
    return;
  }
  if (index >= 0) tryOpen(index);
});

saveScoreBtn.addEventListener("click", () => {
  saveScore();
});

playerNameEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveScore();
  }
});

playAgainBtn.addEventListener("click", () => {
  resetGame();
});

muteBtn.addEventListener("click", () => {
  sound.muted = !sound.muted;
  localStorage.setItem(MUTE_KEY, sound.muted ? "1" : "0");
  syncMuteButton();
  if (!sound.muted) sound.ensure();
});

window.addEventListener(
  "pointerdown",
  () => {
    if (!sound.muted) sound.ensure();
  },
  { once: true },
);

window.addEventListener("resize", resize);

syncMuteButton();
resize();
resetGame();
refreshLeaderboard();
subscribeLeaderboard();
requestAnimationFrame(loop);
