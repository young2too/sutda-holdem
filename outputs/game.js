const SUIT_NAMES = { "♠": "spade", "♥": "heart", "♦": "diamond", "♣": "club" };
const SEAT_POSITIONS = {
  6: [[50, 84], [7, 76], [7, 22], [50, 12], [93, 22], [93, 76]],
  7: [[50, 84], [22, 79], [7, 50], [30, 13], [70, 13], [93, 50], [78, 79]],
  8: [[50, 85], [27, 80], [7, 56], [20, 14], [50, 10], [80, 14], [93, 56], [73, 80]],
  9: [[50, 86], [30, 81], [7, 61], [7, 31], [35, 11], [65, 11], [93, 31], [93, 61], [70, 81]]
};
const POSITIONS = {
  6: ["UTG", "MP", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG+1", "MP", "MP+1", "HJ", "CO", "BTN", "SB", "BB"]
};
const BIG_BLIND = 10;
const AUDIO_SAMPLES = {
  check: "audio/check.mp3",
  call: "audio/call.mp3",
  fold: "audio/fold.mp3",
  raise: "audio/raise.mp3",
  allIn: "audio/all-in.mp3",
  showdown: "audio/showdown.mp3"
};

const clientId = getClientId();
let snapshot = null;
let pollTimer = null;
let lastVisualEventId = 0;
let visualHandNumber = null;
let actionTimerKey = "";
let actionTimerSyncedAt = 0;
let actionTimerRemainingAtSync = 0;
let audioContext = null;
let audioReady = false;
let musicMode = "";
let musicTimer = null;
let musicStep = 0;
let lastTurnSoundKey = "";
let lastTickAt = 0;
let audioVolume = Number(localStorage.getItem("hwatu-audio-volume") || 70) / 100;
const savedNickname = localStorage.getItem("hwatu-nickname") || "";

function getClientId() {
  const existing = localStorage.getItem("hwatu-client-id");
  if (existing) return existing;
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  localStorage.setItem("hwatu-client-id", id);
  return id;
}

function cardImagePath(card) {
  return `./assets/cards/${card.rank}_${SUIT_NAMES[card.suit]}.png`;
}

function isSutdaUsableCard(card) {
  return Boolean(card && (card.suit === "♥" || card.suit === "♠") && card.month >= 1 && card.month <= 10);
}

function renderCard(card, extraClass = "") {
  const classes = extraClass ? ` ${extraClass}` : "";
  if (!card) return `<img class="card image-card back${classes}" src="./assets/cards/back.png" alt="뒷면">`;
  const sutdaClass = isSutdaUsableCard(card) ? " sutda-usable-card" : "";
  const sutdaTitle = isSutdaUsableCard(card) ? " · 섯다 사용 가능" : "";
  return `<img class="card image-card${sutdaClass}${classes}" src="${cardImagePath(card)}" alt="${card.rank}${card.suit}" title="${card.rank}${card.suit}${sutdaTitle}">`;
}

function render() {
  if (!snapshot) return;
  document.querySelector("#playerCount").value = String(snapshot.playerCount);
  document.querySelector("#totalPot").textContent = snapshot.pot;
  document.querySelector("#holdemPot").textContent = snapshot.holdemPot;
  document.querySelector("#sutdaPot").textContent = snapshot.sutdaPot;
  document.querySelector("#centerPot").textContent = snapshot.pot;
  document.querySelector("#currentBet").textContent = snapshot.currentBet;
  document.querySelector("#streetLabel").textContent = snapshot.streetName;
  document.querySelector("#communityCards").innerHTML = snapshot.community.map(renderCard).join("");
  const playersEl = document.querySelector("#players");
  playersEl.className = `players table-seats count-${snapshot.playerCount} ${snapshot.cardsRevealed ? "showdown-seats" : ""}`;
  playersEl.innerHTML = displayPlayers().map(({ player, visualIndex }) => renderPlayer(player, visualIndex)).join("");
  bindKickButtons();
  bindCardPreview();
  renderShowdownControls();
  document.querySelector("#log").innerHTML = snapshot.log.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  renderChat();
  document.querySelector("#checkCallButton").disabled = !snapshot.controls.canAct;
  document.querySelector("#betRaiseButton").disabled = !snapshot.controls.canAct || !snapshot.controls.canRaise;
  const allInButton = document.querySelector("#allInButton");
  const myPlayer = currentPlayerSeat();
  allInButton.disabled = !snapshot.controls.canAct || !myPlayer || myPlayer.stack <= 0;
  allInButton.textContent = myPlayer && myPlayer.stack > 0 ? `올인 ${myPlayer.stack}` : "올인";
  document.querySelector("#foldButton").disabled = !snapshot.controls.canAct;
  const fillAiButton = document.querySelector("#fillAiButton");
  const mobileFillAiButton = document.querySelector("#mobileFillAiButton");
  fillAiButton.hidden = !snapshot.isHost;
  fillAiButton.disabled = !snapshot.isHost;
  mobileFillAiButton.hidden = !snapshot.isHost;
  mobileFillAiButton.disabled = !snapshot.isHost;
  const newHandButton = document.querySelector("#newHandButton");
  const mobileNewHandButton = document.querySelector("#mobileNewHandButton");
  newHandButton.hidden = !snapshot.isHost;
  newHandButton.disabled = !snapshot.isHost;
  mobileNewHandButton.hidden = !snapshot.isHost;
  mobileNewHandButton.disabled = !snapshot.isHost;
  document.querySelector("#playerCount").disabled = !snapshot.isHost;
  document.querySelector("#readyNotice").hidden = !snapshot.readyPhase || snapshot.showdown;
  renderActionControls();
  document.querySelector("#connectionStatus").textContent = connectionText();
  updateNicknameControls();
  renderActionTimer();
  updateMusicMode();
  playTurnSoundIfNeeded();
  playVisualEvents();
}

function displayPlayers() {
  const players = snapshot.players || [];
  const count = snapshot.playerCount || players.length;
  const offset = snapshot.seatId === null ? 0 : snapshot.seatId;
  return players.map((_, index) => {
    const player = players[(index + offset) % count];
    return { player, visualIndex: index };
  }).filter(({ player }) => Boolean(player));
}

function visualSeatIndex(playerId) {
  if (!snapshot || snapshot.seatId === null) return playerId;
  return (playerId - snapshot.seatId + snapshot.playerCount) % snapshot.playerCount;
}

function updateNicknameControls() {
  const input = document.querySelector("#nicknameInput");
  const joinButton = document.querySelector("#joinButton");
  const leaveButton = document.querySelector("#leaveButton");
  const mobileLeaveButton = document.querySelector("#mobileLeaveButton");
  if (!input || !joinButton || !leaveButton) return;
  if (input.value !== sanitizeNickname(input.value, "")) input.value = sanitizeNickname(input.value, "");
  if (snapshot.seatId !== null) {
    input.disabled = false;
    joinButton.disabled = false;
    joinButton.textContent = "닉변";
    leaveButton.disabled = false;
    if (mobileLeaveButton) mobileLeaveButton.disabled = false;
    return;
  }
  input.disabled = false;
  joinButton.disabled = false;
  joinButton.textContent = "착석";
  leaveButton.disabled = true;
  if (mobileLeaveButton) mobileLeaveButton.disabled = true;
}

function renderActionTimer() {
  const timer = document.querySelector("#ropeTimer");
  const seconds = document.querySelector("#ropeSeconds");
  const active = Boolean(snapshot.actionDeadline && !snapshot.showdown && (snapshot.readyPhase || snapshot.currentPlayer >= 0));
  timer.hidden = !active;
  if (!active) {
    actionTimerKey = "";
    if (seconds) seconds.textContent = "0.00s";
    return;
  }
  const total = Math.max(1, snapshot.actionTimeoutMs || 20000);
  const key = `${snapshot.handNumber}:${snapshot.readyPhase ? "showdown" : snapshot.currentPlayer}:${snapshot.actionDeadline}`;
  if (key !== actionTimerKey || Math.abs((snapshot.actionRemainingMs || 0) - getLocalActionRemaining()) > 350) {
    actionTimerKey = key;
    actionTimerSyncedAt = performance.now();
    actionTimerRemainingAtSync = Math.max(0, snapshot.actionRemainingMs || 0);
  }
  const remaining = getLocalActionRemaining();
  const progress = Math.max(0, Math.min(1, remaining / total));
  timer.style.setProperty("--rope-progress", progress);
  timer.classList.toggle("rope-danger", progress <= 0.25);
  if (seconds) seconds.textContent = `${(remaining / 1000).toFixed(2)}s`;
  const isMine = snapshot.readyPhase
    ? Boolean(snapshot.controls.canReady)
    : snapshot.seatId !== null && snapshot.currentPlayer === snapshot.seatId;
  if (audioReady && isMine && progress <= 0.25 && performance.now() - lastTickAt > 620) {
    lastTickAt = performance.now();
    playSound("tick");
  }
}

function getLocalActionRemaining() {
  if (!actionTimerSyncedAt) return Math.max(0, snapshot ? snapshot.actionRemainingMs || 0 : 0);
  return Math.max(0, actionTimerRemainingAtSync - (performance.now() - actionTimerSyncedAt));
}

function renderChat() {
  const list = document.querySelector("#chatMessages");
  if (!list) return;
  const messages = snapshot.chat || [];
  list.innerHTML = messages.map((message) => (
    `<li><strong style="--chat-name-color:${chatColor(message.senderKey || message.name)}">${escapeHtml(message.name)}</strong> : <span>${escapeHtml(message.text)}</span></li>`
  )).join("");
}

function chatColor(key) {
  const text = String(key || "viewer");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 72%, 68%)`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function unlockAudio() {
  if (audioReady) return;
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) return;
  audioContext = audioContext || new AudioEngine();
  audioContext.resume().then(() => {
    audioReady = true;
    updateMusicMode();
  }).catch(() => {});
}

function tone(frequency, duration = 0.12, volume = 0.05, type = "sine", when = 0) {
  if (!audioReady || !audioContext) return;
  const scaledVolume = Math.max(0.0001, volume * audioVolume);
  const start = audioContext.currentTime + when;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(scaledVolume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playSound(kind) {
  if (!audioReady) return;
  if (playSample(kind)) return;
  if (kind === "tick") tone(980, 0.045, 0.028, "square");
  if (kind === "turn") {
    tone(660, 0.11, 0.055, "sine");
    tone(880, 0.14, 0.05, "sine", 0.12);
  }
}

function playSample(kind) {
  const src = AUDIO_SAMPLES[kind];
  if (!src || audioVolume <= 0) return false;
  const sample = new Audio(src);
  sample.volume = Math.min(1, audioVolume);
  sample.play().catch(() => {});
  return true;
}

function isAllInShowdownMusic() {
  if (!snapshot || snapshot.showdown) return false;
  const livePlayers = (snapshot.players || []).filter((player) => player.occupied && !player.folded);
  return livePlayers.length > 1 && livePlayers.every((player) => player.stack <= 0);
}

function updateMusicMode() {
  if (!audioReady) return;
  const nextMode = isAllInShowdownMusic() ? "allIn" : "table";
  if (nextMode === musicMode) return;
  stopMusic();
  musicMode = nextMode;
  musicStep = 0;
  musicTimer = window.setInterval(playMusicStep, nextMode === "allIn" ? 260 : 520);
  playMusicStep();
}

function stopMusic() {
  if (musicTimer) window.clearInterval(musicTimer);
  musicTimer = null;
}

function playMusicStep() {
  if (!audioReady || !musicMode) return;
  const tablePattern = [196, 247, 294, 247, 220, 262, 330, 262];
  const allInPattern = [220, 330, 440, 554, 440, 330, 277, 370];
  const pattern = musicMode === "allIn" ? allInPattern : tablePattern;
  const note = pattern[musicStep % pattern.length];
  tone(note, musicMode === "allIn" ? 0.18 : 0.28, musicMode === "allIn" ? 0.07 : 0.04, musicMode === "allIn" ? "sawtooth" : "sine");
  if (musicStep % 2 === 0) tone(note / 2, musicMode === "allIn" ? 0.2 : 0.36, musicMode === "allIn" ? 0.04 : 0.026, "triangle");
  musicStep += 1;
}

function syncVolumeControls(value = audioVolume) {
  audioVolume = Math.max(0, Math.min(1, Number(value) || 0));
  localStorage.setItem("hwatu-audio-volume", String(Math.round(audioVolume * 100)));
  ["#volumeControl", "#mobileVolumeControl"].forEach((selector) => {
    const control = document.querySelector(selector);
    if (control && Number(control.value) !== Math.round(audioVolume * 100)) control.value = String(Math.round(audioVolume * 100));
  });
}

function handleVolumeInput(event) {
  syncVolumeControls(Number(event.target.value) / 100);
  unlockAudio();
}

function playTurnSoundIfNeeded() {
  if (!snapshot || snapshot.seatId === null || !snapshot.controls.canAct) return;
  const key = `${snapshot.handNumber}:${snapshot.currentPlayer}:${snapshot.street}:${snapshot.currentBet}`;
  if (snapshot.currentPlayer !== snapshot.seatId || key === lastTurnSoundKey) return;
  lastTurnSoundKey = key;
  playSound("turn");
}

function renderActionControls() {
  if (snapshot.showdown) {
    document.querySelector("#turnLabel").textContent = "핸드 종료";
    document.querySelector("#callLabel").textContent = "정산 완료";
    document.querySelector("#checkCallButton").textContent = "체크/콜";
    document.querySelector("#raiseAmount").disabled = true;
    document.querySelector("#raiseAmountLabel").textContent = "0";
    document.querySelector("#raiseAmountLabel").value = "0";
    renderRaisePresets();
    return;
  }
  if (snapshot.readyPhase) {
    document.querySelector("#turnLabel").textContent = snapshot.controls.canReady ? "쇼다운 결정" : "쇼다운 대기";
    document.querySelector("#callLabel").textContent = snapshot.controls.canReady ? "20초 후 홀덤 자동" : "다른 플레이어 준비 대기";
    document.querySelector("#checkCallButton").textContent = "체크/콜";
    document.querySelector("#betRaiseButton").textContent = "베팅/레이즈";
    document.querySelector("#raiseAmount").disabled = true;
    document.querySelector("#raiseAmountLabel").textContent = "0";
    document.querySelector("#raiseAmountLabel").value = "0";
    renderRaisePresets();
    return;
  }
  const acting = snapshot.controls.actingLabel || "액션 대기";
  const callAmount = snapshot.controls.callAmount || 0;
  const minRaise = snapshot.controls.minRaiseTo || 10;
  const maxRaise = Math.max(minRaise, snapshot.controls.maxRaiseTo || minRaise);
  const slider = document.querySelector("#raiseAmount");
  const label = document.querySelector("#raiseAmountLabel");
  document.querySelector("#turnLabel").textContent = snapshot.controls.canAct ? `내 차례 (${acting})` : (snapshot.controls.actingLabel ? `${acting} 차례` : "액션 대기");
  document.querySelector("#callLabel").textContent = callAmount ? `콜 ${callAmount}` : "체크 가능";
  document.querySelector("#checkCallButton").textContent = callAmount ? `콜 ${callAmount}` : "체크";
  document.querySelector("#betRaiseButton").textContent = snapshot.currentBet > 0 ? "레이즈" : "베팅";
  slider.min = minRaise;
  slider.max = maxRaise;
  slider.step = 5;
  if (Number(slider.value) < minRaise || Number(slider.value) > maxRaise) slider.value = minRaise;
  slider.disabled = !snapshot.controls.canAct || !snapshot.controls.canRaise || minRaise > maxRaise;
  label.value = slider.value;
  label.textContent = slider.value;
  renderRaisePresets();
}

function currentPlayerSeat() {
  return snapshot && snapshot.players ? snapshot.players.find((player) => player.mine) : null;
}

function renderRaisePresets() {
  const presets = document.querySelector("#raisePresets");
  if (!presets || !snapshot || snapshot.readyPhase || snapshot.showdown) {
    if (presets) presets.innerHTML = "";
    return;
  }
  const hasPreviousBet = (snapshot.currentBet || 0) > 0;
  const openOptions = snapshot.street === 0
    ? [
      { label: "2BB", kind: "bb", value: 2 },
      { label: "3BB", kind: "bb", value: 3 },
      { label: "6BB", kind: "bb", value: 6 }
    ]
    : [
      { label: "1/3", kind: "pot", value: 1 / 3 },
      { label: "1/2", kind: "pot", value: 1 / 2 },
      { label: "1/1", kind: "pot", value: 1 }
    ];
  const raiseOptions = hasPreviousBet
    ? [
      { label: "2x", kind: "multiple", value: 2 },
      { label: "2.5x", kind: "multiple", value: 2.5 },
      { label: "3x", kind: "multiple", value: 3 }
    ]
    : [];
  const options = [...openOptions, ...raiseOptions];
  const disabled = !snapshot.controls.canAct || !snapshot.controls.canRaise;
  presets.innerHTML = options.map((option) => (
    `<button type="button" data-raise-preset-kind="${option.kind}" data-raise-preset-value="${option.value}" ${disabled ? "disabled" : ""}>
      <span>${option.label}</span>
      <b>${presetRaiseTarget(option.kind, option.value)}</b>
    </button>`
  )).join("");
}

function presetRaiseTarget(kind, value) {
  const player = currentPlayerSeat();
  if (!player) return Number(document.querySelector("#raiseAmount").value);
  const minRaise = snapshot.controls.minRaiseTo || BIG_BLIND;
  const maxRaise = snapshot.controls.maxRaiseTo || player.bet + player.stack;
  const callAmount = snapshot.controls.callAmount || 0;
  let rawTarget;
  if (kind === "bb") rawTarget = Number(value) * BIG_BLIND;
  else if (kind === "multiple") rawTarget = Math.round((snapshot.currentBet || BIG_BLIND) * Number(value) / 5) * 5;
  else rawTarget = player.bet + callAmount + Math.round(((snapshot.pot || 0) + callAmount) * Number(value) / 5) * 5;
  return Math.max(minRaise, Math.min(maxRaise, rawTarget));
}

function setRaiseAmount(amount) {
  const slider = document.querySelector("#raiseAmount");
  const label = document.querySelector("#raiseAmountLabel");
  slider.value = String(amount);
  label.value = String(amount);
  label.textContent = String(amount);
}

function chooseRaisePreset(button) {
  if (!button || button.disabled) return;
  const amount = presetRaiseTarget(button.dataset.raisePresetKind, Number(button.dataset.raisePresetValue));
  setRaiseAmount(amount);
  postAction({ type: "betRaise", amount });
}

function goAllIn() {
  const player = currentPlayerSeat();
  if (!player || !snapshot.controls.canAct || player.stack <= 0) return;
  const amount = snapshot.controls.maxRaiseTo || player.bet + player.stack;
  setRaiseAmount(amount);
  postAction({ type: "betRaise", amount });
}

function renderShowdownControls() {
  const panel = document.querySelector("#showdownControls");
  const modeSelect = document.querySelector("#showdownMode");
  const sutdaSelect = document.querySelector("#showdownSutdaCard");
  const sutdaBoardSelect = document.querySelector("#showdownSutdaBoardCard");
  const readyButton = document.querySelector("#showdownReadyButton");
  const player = snapshot.seatId === null ? null : snapshot.players[snapshot.seatId];
  const visible = Boolean(player && snapshot.readyPhase && !snapshot.showdown && !player.folded);
  panel.hidden = !visible;
  if (!visible || !player) return;
  modeSelect.value = player.mode === "hidden" ? "holdem" : player.mode;
  [...modeSelect.options].forEach((option) => {
    option.disabled = option.value !== "holdem" && !player.canSutda;
  });
  sutdaSelect.innerHTML = sutdaOptions(player);
  sutdaSelect.disabled = !player.canSutda;
  sutdaBoardSelect.innerHTML = sutdaBoardOptions(player);
  sutdaBoardSelect.disabled = !player.canSutda;
  readyButton.disabled = !snapshot.controls.canReady;
  readyButton.textContent = player.ready ? "준비 완료" : "쇼다운 준비";
}

function connectionText() {
  if (snapshot.seatId === null) return "관전 중. 착석하면 빈 좌석에 앉습니다.";
  const player = snapshot.players[snapshot.seatId];
  const hostLabel = snapshot.isHost ? " · 방장" : "";
  return `${player.name} 접속 중${hostLabel}. 현재 포지션: ${player.position || "대기"}`;
}

function renderPlayer(player, visualIndex = visualSeatIndex(player.id)) {
  const isActive = snapshot.currentPlayer === player.id && !snapshot.readyPhase && !snapshot.showdown && !player.folded;
  const seat = SEAT_POSITIONS[snapshot.playerCount][visualIndex];
  if (!player.occupied) {
    return `
      <article class="player seat empty-seat" style="--seat-x:${seat[0]}%; --seat-y:${seat[1]}%;">
        <span class="empty-seat-label">빈 좌석</span>
      </article>
    `;
  }
  const owned = player.mine;
  const actionText = isActive ? "액션 중" : (player.lastAction || (player.ai ? "AI 대기" : "대기"));
  const kickButton = player.canKick ? `<button class="kick-button" type="button" data-kick-seat="${player.id}" title="강퇴">강퇴</button>` : "";
  const declaration = snapshot.cardsRevealed && !player.folded && player.mode !== "hidden" ? `<span class="declaration-badge">${modeLabel(player.mode)}</span>` : "";
  const awardBadges = renderPlayerAwards(player);
  const winnerClass = awardBadges ? "winner-seat" : "";
  return `
    <article class="player seat ${isActive ? "active-player" : ""} ${player.folded ? "folded-player" : ""} ${winnerClass} ${owned ? "my-seat" : "opponent-seat"}" style="--seat-x:${seat[0]}%; --seat-y:${seat[1]}%;">
      ${awardBadges}
      <div class="player-head">
        <div>
          <h2>${player.name} <span class="position">${player.position}</span>${declaration}</h2>
        </div>
        <div class="player-tools">
          <strong>칩 ${player.stack}</strong>
          ${kickButton}
        </div>
      </div>
      <div class="seat-main">
        <div class="cards hand-cards ${owned ? "my-hand-cards" : ""}">${renderPlayerCards(player)}</div>
        <div class="made-panel">
          <span>섯다 최고 <strong>${player.sutdaOutput || (owned ? "불성립" : "-")}</strong></span>
          <span>홀덤 최고 <strong>${player.holdemOutput || (owned ? "대기" : "-")}</strong></span>
        </div>
      </div>
      <div class="seat-meta">
        <span class="action-badge ${isActive ? "current-action" : actionClass(player)}">${actionText}</span>
        <span class="bet-chip">베팅 ${player.streetBet}</span>
      </div>
    </article>
  `;
}

function renderPlayerAwards(player) {
  if (!snapshot.showdown || !snapshot.result || player.folded) return "";
  const awards = (snapshot.result.awards || []).flatMap((award) => {
    const winner = award.winners.find((item) => item.id === player.id);
    if (!winner) return [];
    return [{
      label: award.label,
      amount: award.share,
      hand: winner.hand || ""
    }];
  });
  if (!awards.length) return "";
  return `
    <div class="player-awards">
      ${awards.map((award) => `
        <span class="player-award-badge">
          <strong>${escapeHtml(award.label)}</strong>
          <span class="player-award-hand">${escapeHtml(award.hand)}</span>
          <b>${award.amount}</b>
        </span>
      `).join("")}
    </div>
  `;
}

function renderPlayerCards(player) {
  if (!snapshot.cardsRevealed || player.mode === "hidden" || player.folded) return player.cards.map((card) => renderCard(card)).join("");
  if (player.mode === "sutda") {
    return player.cards.map((card) => (card && card.id === player.sutdaCard ? renderCard(card, "sutda-showdown-card") : renderCard(null, "showdown-hidden-card"))).join("");
  }
  if (player.mode === "swing") {
    return player.cards.map((card) => renderCard(card, card && card.id === player.sutdaCard ? "swing-sutda-card" : "")).join("");
  }
  return player.cards.map((card) => renderCard(card)).join("");
}

function modeLabel(mode) {
  return ({ holdem: "홀덤", sutda: "섯다", swing: "스윙" }[mode] || "");
}

function actionClass(player) {
  const action = player.lastAction || "";
  if (player.folded || action.includes("폴드")) return "action-folded";
  if (action.includes("레이즈") || action.includes("베팅")) return "action-raised";
  if (action.includes("콜") || action.includes("체크")) return "action-called";
  return "";
}

function bindCardPreview() {
  document.querySelectorAll(".my-hand-cards .card").forEach((card) => {
    card.addEventListener("mouseenter", () => showCardPreview(card));
    card.addEventListener("mousemove", () => positionCardPreview(card));
    card.addEventListener("mouseleave", hideCardPreview);
  });
}

function bindKickButtons() {
  document.querySelectorAll("[data-kick-seat]").forEach((button) => {
    button.addEventListener("click", () => kickSeat(Number(button.dataset.kickSeat)));
  });
}

function showCardPreview(card) {
  hideCardPreview();
  const preview = document.createElement("img");
  preview.id = "cardPreview";
  preview.className = "card-preview-popover";
  preview.src = card.src;
  preview.alt = card.alt || "";
  document.body.appendChild(preview);
  positionCardPreview(card);
}

function positionCardPreview(card) {
  const preview = document.querySelector("#cardPreview");
  if (!preview) return;
  const rect = card.getBoundingClientRect();
  const previewWidth = 118;
  const previewHeight = 170;
  const left = Math.min(window.innerWidth - previewWidth - 12, Math.max(12, rect.left + rect.width / 2 - previewWidth / 2));
  const top = Math.min(window.innerHeight - previewHeight - 12, Math.max(12, rect.top - previewHeight - 18));
  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
}

function hideCardPreview() {
  const preview = document.querySelector("#cardPreview");
  if (preview) preview.remove();
}

function playVisualEvents() {
  if (!snapshot || !Array.isArray(snapshot.events)) return;
  if (visualHandNumber !== snapshot.handNumber) {
    visualHandNumber = snapshot.handNumber;
    lastVisualEventId = 0;
  }
  const events = snapshot.events;
  const maxEventId = events.reduce((max, event) => Math.max(max, event.id || 0), lastVisualEventId);
  if (maxEventId <= lastVisualEventId) {
    lastVisualEventId = maxEventId;
    return;
  }
  if (!events.length) return;
  events
    .filter((event) => event.id > lastVisualEventId)
    .forEach((event) => {
      if (event.type === "bet") {
        animateBet(event);
        const label = String(event.label || "");
        const sound = event.allIn ? "allIn" : (label.includes("\uCF5C") ? "call" : "raise");
        playSound(sound);
      }
      if (event.type === "check" || event.type === "fold") {
        flashAction(event);
        playSound(event.type);
      }
      if (event.type === "sutdaRetry") animateSutdaRetry(event);
      if (event.type === "award") {
        playSound("showdown");
        const retryDelay = Math.max(0, ...events
          .filter((item) => item.id > lastVisualEventId && item.type === "sutdaRetry")
          .map((item) => Number(item.durationMs) || retryDisplayDuration(item)));
        animateAwards(event.awards || [], retryDelay);
      }
    });
  lastVisualEventId = maxEventId;
}

function seatPoint(playerId) {
  const seat = SEAT_POSITIONS[snapshot.playerCount][visualSeatIndex(playerId)] || [50, 50];
  return { x: seat[0], y: seat[1] };
}

function addFlyingChip({ from, to, text, className = "" }) {
  const layer = document.querySelector("#chipLayer");
  const chip = document.createElement("div");
  chip.className = `flying-chip ${className}`;
  chip.textContent = text;
  chip.style.setProperty("--from-x", `${from.x}%`);
  chip.style.setProperty("--from-y", `${from.y}%`);
  chip.style.setProperty("--to-x", `${to.x}%`);
  chip.style.setProperty("--to-y", `${to.y}%`);
  layer.appendChild(chip);
  window.setTimeout(() => chip.remove(), 1200);
}

function animateBet(event) {
  addFlyingChip({
    from: seatPoint(event.playerId),
    to: { x: 50, y: 50 },
    text: `+${event.amount}`,
    className: "to-pot"
  });
}

function animateAwards(awards, baseDelay = 0) {
  awards.forEach((award, awardIndex) => {
    award.winners.forEach((winner, winnerIndex) => {
      window.setTimeout(() => {
        addFlyingChip({
          from: { x: 50, y: 50 },
          to: seatPoint(winner.id),
          text: `${award.label} +${award.share}`,
          className: "to-winner"
        });
      }, baseDelay + (awardIndex * 220) + (winnerIndex * 120));
    });
  });
}

function animateSutdaRetry(event) {
  const layer = document.querySelector("#chipLayer");
  if (!layer) return;
  document.querySelector("#sutdaRetryOverlay")?.remove();
  const entries = event.entries || [];
  const durationMs = retryDisplayDuration(event);
  const overlay = document.createElement("div");
  overlay.id = "sutdaRetryOverlay";
  overlay.className = "sutda-retry-overlay";
  overlay.innerHTML = `
    <div class="sutda-retry-head">
      <strong>${escapeHtml(event.label || "사구 재경기 중...")}</strong>
      <span>재경기 결과 확인</span>
    </div>
    <div class="sutda-retry-table">
      ${entries.map((entry, entryIndex) => `
        <div class="sutda-retry-player sutda-retry-${entry.result === "win" ? "win" : "lose"}">
          <span>${escapeHtml(entry.name)} ${escapeHtml(entry.position || "")}</span>
          <div class="sutda-retry-cards">
            ${(entry.cards || []).map((card, cardIndex) => `
              <span class="sutda-retry-card-shell" style="--deal-delay:${(cardIndex * entries.length + entryIndex) * 320}ms">
                ${renderCard(card)}
              </span>
            `).join("")}
          </div>
          <b>${escapeHtml(entry.hand || "")}</b>
          <em>${entry.result === "win" ? "승" : "패"}</em>
        </div>
      `).join("")}
    </div>
  `;
  layer.appendChild(overlay);
  window.setTimeout(() => overlay.classList.add("dealing"), 40);
  window.setTimeout(() => overlay.classList.add("leaving"), Math.max(0, durationMs - 650));
  window.setTimeout(() => overlay.remove(), durationMs);
}

function retryDisplayDuration(event) {
  const entries = event.entries || [];
  return Math.min(16000, Math.max(11000, Number(event.durationMs) || (8500 + entries.length * 700)));
}

function flashAction(event) {
  const player = snapshot.players[event.playerId];
  if (!player) return;
  addFlyingChip({
    from: seatPoint(event.playerId),
    to: seatPoint(event.playerId),
    text: event.label,
    className: event.type === "fold" ? "action-fold" : "action-check"
  });
}

function statusText(player) {
  if (!player.occupied) return "빈 좌석";
  if (player.folded) return "폴드";
  if (snapshot.showdown) return "쇼다운";
  if (snapshot.readyPhase) return `${player.ready ? "준비 완료" : "쇼다운 대기"} · ${player.mine ? player.mode : "비공개"}`;
  return `베팅 ${player.bet} · ${player.acted ? "액션 완료" : "액션 대기"} · ${player.mine ? player.mode : "비공개"}`;
}

function sutdaOptions(player) {
  if (!player.mine) return `<option>비공개</option>`;
  return player.sutdaOptions.map((option) => (
    `<option value="${option.id}" ${option.disabled ? "disabled" : ""} ${player.sutdaCard === option.id ? "selected" : ""}>${option.label}</option>`
  )).join("");
}

function sutdaBoardOptions(player) {
  if (!player.mine) return `<option>비공개</option>`;
  return player.sutdaBoardOptions.map((option) => (
    `<option value="${option.id}" ${option.disabled ? "disabled" : ""} ${player.sutdaBoardCard === option.id ? "selected" : ""}>${option.label}</option>`
  )).join("");
}

async function fetchState() {
  try {
    const response = await fetch(`/api/state?clientId=${encodeURIComponent(clientId)}`);
    snapshot = await response.json();
    render();
  } catch (error) {
    document.querySelector("#connectionStatus").textContent = "서버 연결 실패. node outputs/server.js로 실행해야 합니다.";
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "요청 실패");
  await fetchState();
}

function sanitizeNickname(name, fallback = "Player") {
  return Array.from(String(name || "").trim() || fallback).slice(0, 5).join("");
}

async function joinSeat() {
  const nickname = sanitizeNickname(document.querySelector("#nicknameInput").value);
  localStorage.setItem("hwatu-nickname", nickname);
  try {
    await postJson("/api/join", { clientId, name: nickname });
  } catch (error) {
    alert(error.message);
  }
}

async function newHand() {
  if (!snapshot || !snapshot.isHost) return;
  try {
    await postJson("/api/new-hand", { clientId, playerCount: Number(document.querySelector("#playerCount").value) });
  } catch (error) {
    alert(error.message);
  }
}

async function initDebugTools() {
  if (!new URLSearchParams(window.location.search).has("debug")) return;
  const panel = document.createElement("aside");
  panel.className = "debug-panel";
  panel.innerHTML = `
    <strong>Debug Scenario</strong>
    <select id="debugScenarioSelect"></select>
    <button id="debugScenarioButton" type="button">Load</button>
  `;
  document.body.appendChild(panel);
  try {
    const response = await fetch("/api/debug-scenarios");
    const data = await response.json();
    const select = panel.querySelector("#debugScenarioSelect");
    select.innerHTML = (data.scenarios || []).map((scenario) => (
      `<option value="${escapeHtml(scenario.id)}">${escapeHtml(scenario.label)}</option>`
    )).join("");
    panel.querySelector("#debugScenarioButton").addEventListener("click", () => applyDebugScenario(select.value));
  } catch (error) {
    panel.querySelector("#debugScenarioSelect").innerHTML = `<option>${escapeHtml(error.message)}</option>`;
  }
}

async function applyDebugScenario(scenarioId) {
  try {
    await postJson("/api/debug-scenario", { clientId, scenarioId });
    await fetchState();
  } catch (error) {
    alert(error.message);
  }
}

async function fillAiSeats() {
  try {
    await postJson("/api/fill-ai", { clientId });
  } catch (error) {
    alert(error.message);
  }
}

async function kickSeat(seatId) {
  if (!snapshot || !snapshot.isHost) return;
  try {
    await postJson("/api/kick", { clientId, seatId });
  } catch (error) {
    alert(error.message);
  }
}

async function sendChat(event) {
  event.preventDefault();
  const input = document.querySelector("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    await postJson("/api/chat", { clientId, text });
    switchPanelTab("chat");
  } catch (error) {
    input.value = text;
    alert(error.message);
  }
}

function switchPanelTab(tabName) {
  document.querySelectorAll("[data-panel-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.panelTab === tabName);
  });
  document.querySelector("#chatPanel").classList.toggle("active", tabName === "chat");
  document.querySelector("#logPanel").classList.toggle("active", tabName === "log");
}

function toggleMobileComms(open) {
  document.body.classList.toggle("mobile-comms-open", open);
}

async function leaveSeat() {
  if (!snapshot || snapshot.seatId === null) return;
  try {
    await postJson("/api/leave", { clientId });
  } catch (error) {
    alert(error.message);
    await fetchState();
  }
}

function sendLeaveBeacon() {
  if (!snapshot || snapshot.seatId === null) return;
  const body = JSON.stringify({ clientId });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", new Blob([body], { type: "application/json" }));
    return;
  }
  fetch("/api/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}

async function postAction(action) {
  if (snapshot.seatId === null) return;
  try {
    await postJson("/api/action", { clientId, seatId: snapshot.seatId, ...action });
  } catch (error) {
    alert(error.message);
    await fetchState();
  }
}

document.querySelector("#nicknameInput").value = sanitizeNickname(savedNickname, "");
document.querySelector("#nicknameInput").addEventListener("input", (event) => {
  event.target.value = sanitizeNickname(event.target.value, "");
  localStorage.setItem("hwatu-nickname", event.target.value);
});
document.querySelector("#joinButton").addEventListener("click", joinSeat);
document.querySelector("#leaveButton").addEventListener("click", leaveSeat);
document.querySelector("#fillAiButton").addEventListener("click", fillAiSeats);
document.querySelector("#newHandButton").addEventListener("click", newHand);
document.querySelector("#mobileLeaveButton").addEventListener("click", leaveSeat);
document.querySelector("#mobileFillAiButton").addEventListener("click", fillAiSeats);
document.querySelector("#mobileNewHandButton").addEventListener("click", newHand);
document.querySelector("#playerCount").addEventListener("change", newHand);
document.querySelector("#chatForm").addEventListener("submit", sendChat);
syncVolumeControls();
document.querySelector("#volumeControl").addEventListener("input", handleVolumeInput);
document.querySelector("#mobileVolumeControl").addEventListener("input", handleVolumeInput);
document.querySelectorAll("[data-panel-tab]").forEach((button) => {
  button.addEventListener("click", () => switchPanelTab(button.dataset.panelTab));
});
document.querySelector("#mobileChatButton").addEventListener("click", () => toggleMobileComms(true));
document.querySelector("#mobileCloseCommsButton").addEventListener("click", () => toggleMobileComms(false));
document.querySelector("#checkCallButton").addEventListener("click", () => postAction({ type: "checkCall" }));
document.querySelector("#betRaiseButton").addEventListener("click", () => postAction({ type: "betRaise", amount: Number(document.querySelector("#raiseAmount").value) }));
document.querySelector("#allInButton").addEventListener("click", goAllIn);
document.querySelector("#foldButton").addEventListener("click", () => postAction({ type: "fold" }));
document.querySelector("#raisePresets").addEventListener("click", (event) => {
  chooseRaisePreset(event.target.closest("[data-raise-preset-kind]"));
});
document.querySelector("#showdownMode").addEventListener("change", (event) => postAction({ type: "setMode", mode: event.target.value }));
document.querySelector("#showdownSutdaCard").addEventListener("change", (event) => postAction({ type: "setSutdaCard", sutdaCard: event.target.value }));
document.querySelector("#showdownSutdaBoardCard").addEventListener("change", (event) => postAction({ type: "setSutdaBoardCard", sutdaBoardCard: event.target.value }));
document.querySelector("#showdownReadyButton").addEventListener("click", () => postAction({ type: "ready" }));
document.querySelector("#raiseAmount").addEventListener("input", (event) => {
  document.querySelector("#raiseAmountLabel").textContent = event.target.value;
  document.querySelector("#raiseAmountLabel").value = event.target.value;
});
document.querySelector("#helpButton").addEventListener("click", () => document.querySelector("#helpDialog").showModal());
document.querySelector("#mobileHelpButton").addEventListener("click", () => document.querySelector("#helpDialog").showModal());
document.querySelector("#closeHelpButton").addEventListener("click", () => document.querySelector("#helpDialog").close());
document.querySelector("#helpDialog").addEventListener("click", (event) => {
  if (event.target.id === "helpDialog") event.target.close();
});
["pointerdown", "keydown"].forEach((eventName) => {
  window.addEventListener(eventName, unlockAudio, { once: true });
});
window.addEventListener("beforeunload", sendLeaveBeacon);

fetchState();
initDebugTools();
pollTimer = setInterval(fetchState, 1000);
setInterval(renderActionTimer, 50);
