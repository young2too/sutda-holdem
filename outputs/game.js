const SUIT_NAMES = { "♠": "spade", "♥": "heart", "♦": "diamond", "♣": "club" };
const SEAT_POSITIONS = {
  6: [[50, 78], [14, 74], [14, 26], [50, 18], [86, 26], [86, 74]],
  7: [[50, 79], [22, 74], [12, 50], [30, 18], [70, 18], [88, 50], [78, 74]],
  8: [[50, 79], [27, 75], [12, 54], [22, 20], [50, 16], [78, 20], [88, 54], [73, 75]],
  9: [[50, 79], [30, 75], [12, 57], [16, 32], [37, 18], [63, 18], [84, 32], [88, 57], [70, 75]]
};
const POSITIONS = {
  6: ["UTG", "MP", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG+1", "MP", "MP+1", "HJ", "CO", "BTN", "SB", "BB"]
};

const clientId = getClientId();
let snapshot = null;
let pollTimer = null;
let lastVisualEventId = 0;
let visualHandNumber = null;
let actionTimerKey = "";
let actionTimerSyncedAt = 0;
let actionTimerRemainingAtSync = 0;
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

function renderCard(card) {
  if (!card) return `<img class="card image-card back" src="./assets/cards/back.png" alt="뒷면">`;
  const sutdaClass = isSutdaUsableCard(card) ? " sutda-usable-card" : "";
  const sutdaTitle = isSutdaUsableCard(card) ? " · 섯다 사용 가능" : "";
  return `<img class="card image-card${sutdaClass}" src="${cardImagePath(card)}" alt="${card.rank}${card.suit}" title="${card.rank}${card.suit}${sutdaTitle}">`;
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
  renderSettlement();
  const playersEl = document.querySelector("#players");
  playersEl.className = `players table-seats count-${snapshot.playerCount} ${snapshot.showdown ? "showdown-seats" : ""}`;
  playersEl.innerHTML = snapshot.players.map(renderPlayer).join("");
  bindKickButtons();
  bindCardPreview();
  renderShowdownControls();
  document.querySelector("#log").innerHTML = snapshot.log.map((item) => `<li>${item}</li>`).join("");
  document.querySelector("#checkCallButton").disabled = !snapshot.controls.canAct;
  document.querySelector("#betRaiseButton").disabled = !snapshot.controls.canAct;
  document.querySelector("#foldButton").disabled = !snapshot.controls.canAct;
  const fillAiButton = document.querySelector("#fillAiButton");
  fillAiButton.hidden = !snapshot.isHost;
  fillAiButton.disabled = !snapshot.isHost;
  const newHandButton = document.querySelector("#newHandButton");
  newHandButton.hidden = !snapshot.isHost;
  newHandButton.disabled = !snapshot.isHost;
  document.querySelector("#playerCount").disabled = !snapshot.isHost;
  document.querySelector("#readyNotice").hidden = !snapshot.readyPhase || snapshot.showdown;
  renderActionControls();
  document.querySelector("#connectionStatus").textContent = connectionText();
  updateNicknameControls();
  renderActionTimer();
  playVisualEvents();
}

function updateNicknameControls() {
  const input = document.querySelector("#nicknameInput");
  const joinButton = document.querySelector("#joinButton");
  const leaveButton = document.querySelector("#leaveButton");
  if (!input || !joinButton || !leaveButton) return;
  if (input.value !== sanitizeNickname(input.value, "")) input.value = sanitizeNickname(input.value, "");
  if (snapshot.seatId !== null) {
    input.disabled = false;
    joinButton.disabled = false;
    joinButton.textContent = "닉변";
    leaveButton.disabled = false;
    return;
  }
  input.disabled = false;
  joinButton.disabled = false;
  joinButton.textContent = "착석";
  leaveButton.disabled = true;
}

function renderActionTimer() {
  const timer = document.querySelector("#ropeTimer");
  const seconds = document.querySelector("#ropeSeconds");
  const active = Boolean(snapshot.actionDeadline && !snapshot.readyPhase && !snapshot.showdown && snapshot.currentPlayer >= 0);
  timer.hidden = !active;
  if (!active) {
    actionTimerKey = "";
    if (seconds) seconds.textContent = "0.00s";
    return;
  }
  const total = Math.max(1, snapshot.actionTimeoutMs || 10000);
  const key = `${snapshot.handNumber}:${snapshot.currentPlayer}:${snapshot.actionDeadline}`;
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
}

function getLocalActionRemaining() {
  if (!actionTimerSyncedAt) return Math.max(0, snapshot ? snapshot.actionRemainingMs || 0 : 0);
  return Math.max(0, actionTimerRemainingAtSync - (performance.now() - actionTimerSyncedAt));
}

function renderSettlement() {
  const boardPanel = document.querySelector("#boardPanel");
  const settlementPanel = document.querySelector("#settlementPanel");
  if (!snapshot.showdown || !snapshot.result) {
    boardPanel.hidden = false;
    settlementPanel.hidden = true;
    settlementPanel.innerHTML = "";
    return;
  }
  boardPanel.hidden = true;
  settlementPanel.hidden = false;
  const awards = snapshot.result.awards || [];
  settlementPanel.innerHTML = `
    <div class="settlement-title">
      <span>쇼다운 종료</span>
      <strong>정산</strong>
    </div>
    <div class="settlement-awards">
      ${awards.map(renderAward).join("") || `<p>정산 내역 없음</p>`}
    </div>
  `;
}

function renderAward(award) {
  const winners = award.winners.map((winner) => `${winner.name} ${winner.position}`).join(", ");
  return `
    <article class="award-row">
      <span class="award-label">${award.label}</span>
      <strong>${winners}</strong>
      <span>팟 ${award.amount} · ${award.share}씩 획득${award.dealerFee ? ` · 딜러비 ${award.dealerFee}` : ""}</span>
    </article>
  `;
}

function renderActionControls() {
  if (snapshot.showdown) {
    document.querySelector("#turnLabel").textContent = "핸드 종료";
    document.querySelector("#callLabel").textContent = "정산 완료";
    document.querySelector("#checkCallButton").textContent = "체크/콜";
    document.querySelector("#raiseAmount").disabled = true;
    document.querySelector("#raiseAmountLabel").textContent = "0";
    document.querySelector("#raiseAmountLabel").value = "0";
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
  slider.min = minRaise;
  slider.max = maxRaise;
  slider.step = 5;
  if (Number(slider.value) < minRaise || Number(slider.value) > maxRaise) slider.value = minRaise;
  slider.disabled = !snapshot.controls.canAct || minRaise > maxRaise;
  label.value = slider.value;
  label.textContent = slider.value;
}

function renderShowdownControls() {
  const panel = document.querySelector("#showdownControls");
  const modeSelect = document.querySelector("#showdownMode");
  const sutdaSelect = document.querySelector("#showdownSutdaCard");
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
  readyButton.disabled = !snapshot.controls.canReady;
  readyButton.textContent = player.ready ? "준비 완료" : "쇼다운 준비";
}

function connectionText() {
  if (snapshot.seatId === null) return "관전 중. 착석하면 빈 좌석에 앉습니다.";
  const player = snapshot.players[snapshot.seatId];
  const hostLabel = snapshot.isHost ? " · 방장" : "";
  return `${player.name} 접속 중${hostLabel}. 현재 포지션: ${player.position || "대기"}`;
}

function renderPlayer(player) {
  const isActive = snapshot.currentPlayer === player.id && !snapshot.readyPhase && !snapshot.showdown && !player.folded;
  const seat = SEAT_POSITIONS[snapshot.playerCount][player.id];
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
  return `
    <article class="player seat ${isActive ? "active-player" : ""} ${player.folded ? "folded-player" : ""} ${owned ? "my-seat" : ""}" style="--seat-x:${seat[0]}%; --seat-y:${seat[1]}%;">
      <div class="player-head">
        <div>
          <h2>${player.name} <span class="position">${player.position}</span></h2>
        </div>
        <div class="player-tools">
          <strong>칩 ${player.stack}</strong>
          ${kickButton}
        </div>
      </div>
      <div class="seat-main">
        <div class="cards hand-cards ${owned ? "my-hand-cards" : ""}">${player.cards.map(renderCard).join("")}</div>
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
  const events = snapshot.events || [];
  const maxEventId = events.length ? Math.max(...events.map((event) => event.id)) : 0;
  if (visualHandNumber !== snapshot.handNumber) {
    visualHandNumber = snapshot.handNumber;
    lastVisualEventId = maxEventId;
    return;
  }
  if (!events.length) return;
  events
    .filter((event) => event.id > lastVisualEventId)
    .forEach((event) => {
      if (event.type === "bet") animateBet(event);
      if (event.type === "check" || event.type === "fold") flashAction(event);
      if (event.type === "award") animateAwards(event.awards || []);
    });
  lastVisualEventId = maxEventId;
}

function seatPoint(playerId) {
  const seat = SEAT_POSITIONS[snapshot.playerCount][playerId] || [50, 50];
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

function animateAwards(awards) {
  awards.forEach((award, awardIndex) => {
    award.winners.forEach((winner, winnerIndex) => {
      window.setTimeout(() => {
        addFlyingChip({
          from: { x: 50, y: 50 },
          to: seatPoint(winner.id),
          text: `${award.label} +${award.share}`,
          className: "to-winner"
        });
      }, (awardIndex * 220) + (winnerIndex * 120));
    });
  });
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
document.querySelector("#playerCount").addEventListener("change", newHand);
document.querySelector("#checkCallButton").addEventListener("click", () => postAction({ type: "checkCall" }));
document.querySelector("#betRaiseButton").addEventListener("click", () => postAction({ type: "betRaise", amount: Number(document.querySelector("#raiseAmount").value) }));
document.querySelector("#foldButton").addEventListener("click", () => postAction({ type: "fold" }));
document.querySelector("#showdownMode").addEventListener("change", (event) => postAction({ type: "setMode", mode: event.target.value }));
document.querySelector("#showdownSutdaCard").addEventListener("change", (event) => postAction({ type: "setSutdaCard", sutdaCard: event.target.value }));
document.querySelector("#showdownReadyButton").addEventListener("click", () => postAction({ type: "ready" }));
document.querySelector("#raiseAmount").addEventListener("input", (event) => {
  document.querySelector("#raiseAmountLabel").textContent = event.target.value;
  document.querySelector("#raiseAmountLabel").value = event.target.value;
});
document.querySelector("#helpButton").addEventListener("click", () => document.querySelector("#helpDialog").showModal());
document.querySelector("#closeHelpButton").addEventListener("click", () => document.querySelector("#helpDialog").close());
document.querySelector("#helpDialog").addEventListener("click", (event) => {
  if (event.target.id === "helpDialog") event.target.close();
});
window.addEventListener("beforeunload", sendLeaveBeacon);

fetchState();
pollTimer = setInterval(fetchState, 1000);
setInterval(renderActionTimer, 50);
