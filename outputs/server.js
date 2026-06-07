const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 4173);

const MONTHS = { A: "1월", 2: "2월", 3: "3월", 4: "4월", 5: "5월", 6: "6월", 7: "7월", 8: "8월", 9: "9월", 10: "10월", J: "11월", Q: "12월", K: "K" };
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const STREET_NAMES = ["프리플랍", "플랍", "턴", "리버", "쇼다운 준비", "쇼다운"];
const POSITIONS = {
  2: ["SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["UTG", "BTN", "SB", "BB"],
  5: ["UTG", "CO", "BTN", "SB", "BB"],
  6: ["UTG", "MP", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG+1", "MP", "MP+1", "HJ", "CO", "BTN", "SB", "BB"]
};
const SUTDA_CARD_TYPES = {
  "♥": { 1: "홍단", 2: "홍단", 3: "홍단", 4: "초단", 5: "초단", 6: "청단", 7: "초단", 8: "띠", 9: "청단", 10: "청단" },
  "♠": { 1: "광", 2: "동물", 3: "광", 4: "동물", 5: "동물", 6: "동물", 7: "동물", 8: "광", 9: "동물", 10: "동물" }
};

let handNumber = 0;
let hostClientId = null;
let aiTimer = null;
let actionTimer = null;
let autoHandTimer = null;
let chatMessages = [];
const ACTION_TIMEOUT_MS = 20000;
const DISCONNECT_GRACE_MS = 15000;
let state = createHand(6, []);

function createHand(playerCount, previousPlayers) {
  handNumber += 1;
  const deck = shuffle(buildDeck());
  const seats = Array.from({ length: playerCount }, (_, index) => previousPlayers[index] || {});
  const occupiedSeats = seats
    .map((prev, index) => ({ prev, index, occupied: Boolean(prev.clientId || prev.ai) }))
    .filter((seat) => seat.occupied);
  const occupiedCount = occupiedSeats.length;
  const handPositions = POSITIONS[occupiedCount] || [];
  const dealerOffset = occupiedCount ? (handNumber - 1) % occupiedCount : 0;
  const positionBySeat = new Map();
  occupiedSeats.forEach(({ index }, orderIndex) => {
    if (handPositions.length) {
      positionBySeat.set(index, handPositions[(orderIndex - dealerOffset + occupiedCount) % occupiedCount]);
    }
  });
  const players = seats.map((prev, index) => {
    const occupied = Boolean(prev.clientId || prev.ai);
    const cards = occupied ? deck.splice(0, 2) : [];
    const firstSutdaCard = cards.find(isSutdaUsable);
    const assignedPosition = positionBySeat.get(index) || "";
    return {
      id: index,
      name: occupied ? (prev.name || `AI ${index + 1}`) : "",
      clientId: prev.ai ? null : (prev.clientId || null),
      ai: Boolean(prev.ai && !prev.clientId),
      lastSeen: prev.lastSeen || Date.now(),
      position: occupied ? assignedPosition : "",
      stack: typeof prev.stack === "number" ? prev.stack : 1000,
      bet: 0,
      streetBet: 0,
      contribution: 0,
      acted: !occupied,
      folded: !occupied,
      ready: !occupied,
      lastAction: "",
      cards,
      mode: "holdem",
      sutdaCard: firstSutdaCard ? firstSutdaCard.id : (cards[0] ? cards[0].id : null),
      sutdaBoardCard: null
    };
  });
  const log = [`${playerCount}인 테이블 새 핸드.`];
  let currentPlayer = -1;
  let currentBet = 0;
  let pot = 0;
  if (occupiedCount >= 2) {
    const sbIndex = players.findIndex((player) => isOccupied(player) && player.position === "SB");
    const bbIndex = players.findIndex((player) => isOccupied(player) && player.position === "BB");
    if (sbIndex >= 0 && bbIndex >= 0) {
      const sbPaid = postBlind(players[sbIndex], 5);
      const bbPaid = postBlind(players[bbIndex], 10);
      currentBet = Math.max(sbPaid, bbPaid);
      pot = sbPaid + bbPaid;
      currentPlayer = firstActiveFromPosition(firstActionPositionForStreet(0, occupiedCount), players, 0);
      log.push("SB 5, BB 10.");
    } else {
      currentPlayer = firstActiveIndex(players, 0);
      log.push("블라인드 포지션이 비어 있어 이번 핸드는 대기합니다.");
    }
  } else {
    log.push("플레이어가 2명 이상 필요합니다. 착석 후 방장이 AI를 채울 수 있습니다.");
  }
  return {
    deck,
    community: deck.splice(0, 5),
    playerCount,
    positionCount: occupiedCount,
    handNumber,
    street: 0,
    currentPlayer,
    currentBet,
    pot,
    lastRaise: 10,
    readyPhase: false,
    showdown: false,
    cardsRevealed: false,
    players,
    result: null,
    events: [],
    eventId: 0,
    actionDeadline: null,
    actionTimeoutMs: ACTION_TIMEOUT_MS,
    log
  };
}

function buildDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({
    id: `${rank}${suit}`,
    rank,
    suit,
    month: rank === "A" ? 1 : rank === "J" ? 11 : rank === "Q" ? 12 : rank === "K" ? null : Number(rank),
    value: rank === "A" ? 14 : rank === "K" ? 13 : rank === "Q" ? 12 : rank === "J" ? 11 : Number(rank)
  })));
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function postBlind(player, amount) {
  const paid = Math.max(0, Math.min(player.stack, amount));
  player.stack -= paid;
  player.bet += paid;
  player.streetBet += paid;
  player.contribution += paid;
  player.lastAction = `블라인드 ${amount}`;
  return paid;
}

function pushEvent(event) {
  if (!state || !state.events) return;
  state.eventId += 1;
  state.events.push({ id: state.eventId, ...event });
  state.events = state.events.slice(-80);
}

function isSutdaUsable(card) {
  return Boolean(card && SUTDA_CARD_TYPES[card.suit] && SUTDA_CARD_TYPES[card.suit][card.month]);
}

function canDeclareSutda(player) {
  return player.cards.some(isSutdaUsable);
}

function normalizeDeclaration(player) {
  if (canDeclareSutda(player)) return;
  player.mode = "holdem";
  player.sutdaCard = player.cards[0] ? player.cards[0].id : null;
  player.sutdaBoardCard = null;
}

function visibleCommunity() {
  const count = [0, 3, 4, 5, 5, 5][state.street];
  return state.community.slice(0, count);
}

function hasSutdaCommunityCard() {
  return state.community.some(isSutdaUsable);
}

function getPotLayout() {
  if (state.street >= 3 && !hasSutdaCommunityCard()) return { holdem: state.pot, sutda: 0 };
  const holdem = Math.floor(state.pot / 2);
  return { holdem, sutda: state.pot - holdem };
}

function isOccupied(player) {
  return Boolean(player && (player.clientId || player.ai));
}

function activePlayers() {
  return state.players.filter((player) => isOccupied(player) && !player.folded);
}

function actionPlayers() {
  return activePlayers().filter((player) => player.stack > 0);
}

function shouldAutoShowdown() {
  return !state.readyPhase && !state.showdown && activePlayers().length > 1 && actionPlayers().length === 0;
}

function runAutoShowdownIfNeeded() {
  if (!shouldAutoShowdown()) return false;
  clearActionTimer();
  clearAiTimer();
  while (!state.showdown && !state.readyPhase) {
    advanceStreet();
  }
  return state.showdown;
}

function isHandInProgress() {
  return Boolean(state && (state.pot > 0 || state.street > 0 || state.readyPhase || state.showdown));
}

function commitChips(player, amount) {
  const paid = Math.max(0, Math.min(player.stack, Number(amount) || 0));
  player.stack -= paid;
  player.bet += paid;
  player.streetBet += paid;
  player.contribution = (player.contribution || 0) + paid;
  state.pot += paid;
  return paid;
}

function firstActiveIndex(players = state.players, start = 0) {
  if (!players.length) return -1;
  const normalizedStart = start >= 0 ? start : 0;
  for (let offset = 0; offset < players.length; offset += 1) {
    const index = (normalizedStart + offset) % players.length;
    if (isOccupied(players[index]) && !players[index].folded) return index;
  }
  return -1;
}

function positionCountFor(players = state.players) {
  if (state && players === state.players && state.positionCount) return state.positionCount;
  return players.filter(isOccupied).length;
}

function bettingOrderForStreet(street = state.street, positionCount = positionCountFor()) {
  const preflopOrder = POSITIONS[positionCount] || POSITIONS[6];
  if (street === 0) return preflopOrder;
  if (positionCount === 2) return ["BB", "SB"];
  const smallBlindIndex = preflopOrder.indexOf("SB");
  return smallBlindIndex >= 0 ? [...preflopOrder.slice(smallBlindIndex), ...preflopOrder.slice(0, smallBlindIndex)] : preflopOrder;
}

function firstActionPositionForStreet(street = state.street, positionCount = positionCountFor()) {
  return bettingOrderForStreet(street, positionCount)[0] || "UTG";
}

function firstActiveFromPosition(position, players = state.players, street = state ? state.street : 0) {
  const order = bettingOrderForStreet(street, positionCountFor(players));
  const start = order.indexOf(position);
  const rotatedOrder = start >= 0 ? [...order.slice(start), ...order.slice(0, start)] : order;
  for (const positionName of rotatedOrder) {
    const index = players.findIndex((player) => isOccupied(player) && !player.folded && player.stack > 0 && player.position === positionName);
    if (index >= 0) return index;
  }
  return -1;
}

function nextActiveIndex(from) {
  const player = state.players[from];
  const order = bettingOrderForStreet();
  const start = order.indexOf(player ? player.position : "");
  const rotatedOrder = start >= 0 ? [...order.slice(start + 1), ...order.slice(0, start + 1)] : order;
  for (const positionName of rotatedOrder) {
    const index = state.players.findIndex((item) => isOccupied(item) && !item.folded && item.stack > 0 && item.position === positionName);
    if (index >= 0) return index;
  }
  return -1;
}

function isOwner(player, clientId) {
  return player && player.clientId && player.clientId === clientId;
}

function playerByClient(clientId) {
  return state.players.find((player) => isOwner(player, clientId));
}

function safeState(clientId, seatId) {
  touchClient(clientId);
  cleanupDisconnectedPlayers();
  runAutoShowdownIfNeeded();
  scheduleAiStep();
  state.players.filter(isOccupied).forEach(normalizeDeclaration);
  const seat = playerByClient(clientId);
  const seatIdForClient = seat ? seat.id : null;
  const ownsSeat = Boolean(seat);
  const splitPots = getPotLayout();
  const actingPlayer = state.players[state.currentPlayer];
  return {
    playerCount: state.playerCount,
    handNumber: state.handNumber,
    street: state.street,
    streetName: STREET_NAMES[state.street],
    currentPlayer: state.currentPlayer,
    currentBet: state.currentBet,
    pot: state.pot,
    actionDeadline: state.actionDeadline,
    actionTimeoutMs: state.actionTimeoutMs || ACTION_TIMEOUT_MS,
    actionRemainingMs: state.actionDeadline ? Math.max(0, state.actionDeadline - Date.now()) : 0,
    holdemPot: splitPots.holdem,
    sutdaPot: splitPots.sutda,
    readyPhase: state.readyPhase,
    showdown: state.showdown,
    cardsRevealed: state.cardsRevealed,
    result: publicResult(),
    events: state.events.slice(-40),
    community: visibleCommunity(),
    seatId: ownsSeat ? seatIdForClient : null,
    isHost: Boolean(clientId && clientId === hostClientId),
    log: state.log.slice(-80),
    chat: chatMessages.slice(-120),
    players: state.players.map((player) => publicPlayer(player, clientId)),
    controls: {
      canAct: ownsSeat && isOccupied(seat) && state.currentPlayer === seatIdForClient && !state.readyPhase && !state.showdown && !seat.folded && seat.stack > 0 && activePlayers().length > 1,
      canReady: ownsSeat && isOccupied(seat) && state.readyPhase && !state.showdown && !seat.folded && !seat.ready,
      canRaise: ownsSeat ? canRaise(seat) : false,
      callAmount: ownsSeat ? Math.min(seat.stack, Math.max(0, state.currentBet - seat.bet)) : 0,
      minRaiseTo: ownsSeat ? displayedMinRaiseTo(seat) : state.currentBet + state.lastRaise,
      maxRaiseTo: ownsSeat ? maxRaiseTo(seat) : state.currentBet,
      actingLabel: actingPlayer && isOccupied(actingPlayer) ? `${actingPlayer.name} ${actingPlayer.position}` : ""
    }
  };
}

function touchClient(clientId) {
  const player = playerByClient(clientId);
  if (player && !player.ai) player.lastSeen = Date.now();
}

function cleanupDisconnectedPlayers() {
  const now = Date.now();
  state.players
    .filter((player) => player.clientId && !player.ai && player.lastSeen && now - player.lastSeen > DISCONNECT_GRACE_MS)
    .forEach((player) => removeSeat(player, "연결 끊김"));
}

function hasHumanPlayer() {
  return state.players.some((player) => player.clientId && !player.ai);
}

function minRaiseTo(player) {
  return state.currentBet ? state.currentBet + state.lastRaise : state.lastRaise;
}

function maxRaiseTo(player) {
  return player.bet + player.stack;
}

function displayedMinRaiseTo(player) {
  if (!canRaise(player)) return maxRaiseTo(player);
  return Math.min(minRaiseTo(player), maxRaiseTo(player));
}

function canRaise(player) {
  return maxRaiseTo(player) > state.currentBet;
}

function publicPlayer(player, clientId) {
  const occupied = isOccupied(player);
  const mine = isOwner(player, clientId);
  const showCards = occupied && !player.folded && (mine || state.cardsRevealed);
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    occupied,
    ai: player.ai,
    mine,
    canKick: Boolean(clientId && clientId === hostClientId && occupied && !mine),
    stack: player.stack,
    bet: player.bet,
    streetBet: player.streetBet,
    acted: player.acted,
    folded: player.folded,
    ready: player.ready,
    lastAction: player.lastAction,
    mode: showCards ? player.mode : "hidden",
    sutdaCard: showCards ? player.sutdaCard : null,
    sutdaBoardCard: showCards ? player.sutdaBoardCard : null,
    canSutda: mine && occupied ? canDeclareSutda(player) : false,
    cards: showCards ? player.cards : (occupied ? [null, null] : []),
    holdemOutput: showCards ? currentHoldemOutput(player) : "",
    sutdaOutput: showCards ? currentSutdaOutput(player) : "",
    sutdaOptions: mine && occupied ? player.cards.map((card) => ({ id: card.id, label: `${card.rank}${card.suit} ${sutdaCardLabel(card)}`, disabled: !isSutdaUsable(card) })) : [],
    sutdaBoardOptions: mine && occupied ? state.community.map((card) => ({ id: card.id, label: `${card.rank}${card.suit} ${sutdaCardLabel(card)}`, disabled: !isSutdaUsable(card) })) : []
  };
}

function publicResult() {
  if (!state.result) return null;
  return {
    awards: state.result.awards || [],
    summaries: state.result.summaries || []
  };
}

function sutdaCardLabel(card) {
  if (!isSutdaUsable(card)) return "섯다 불가";
  return `${MONTHS[card.rank]} ${sutdaDisplayType(card)}`;
}

function currentHoldemOutput(player) {
  if (player.folded) return "-";
  const cards = [...player.cards, ...visibleCommunity()];
  if (cards.length < 5) return "대기";
  return evaluateHoldem(cards).name;
}

function currentSutdaOutput(player) {
  if (player.folded) return "-";
  const handCards = player.cards.filter(isSutdaUsable);
  const boardCards = visibleCommunity().filter(isSutdaUsable);
  if (!handCards.length || !boardCards.length) return "불성립";
  const candidates = handCards.flatMap((handCard) => boardCards.map((boardCard) => evaluateSutdaPair(handCard, boardCard)));
  return candidates.sort((a, b) => -compareSutdaValues(a, b))[0].name;
}

function handleAction(body) {
  clearAiTimer();
  const player = playerByClient(body.clientId);
  if (!isOwner(player, body.clientId) || !isOccupied(player)) throw new Error("이 좌석의 플레이어가 아닙니다.");
  if (body.type === "setMode") {
    player.mode = canDeclareSutda(player) ? body.mode : "holdem";
    normalizeDeclaration(player);
    scheduleAiStep();
    return;
  }
  if (body.type === "setSutdaCard") {
    const card = player.cards.find((item) => item.id === body.sutdaCard);
    if (card && isSutdaUsable(card)) player.sutdaCard = card.id;
    scheduleAiStep();
    return;
  }
  if (body.type === "setSutdaBoardCard") {
    const card = state.community.find((item) => item.id === body.sutdaBoardCard);
    if (card && isSutdaUsable(card)) player.sutdaBoardCard = card.id;
    scheduleAiStep();
    return;
  }
  if (body.type === "ready") {
    markReady(player);
    scheduleAiStep();
    return;
  }
  if (state.readyPhase || state.showdown || state.currentPlayer !== player.id) throw new Error("현재 액션 차례가 아닙니다.");
  clearActionTimer();
  if (body.type === "checkCall") checkCall(player);
  else if (body.type === "betRaise") betRaise(player, Number(body.amount));
  else if (body.type === "fold") fold(player);
  scheduleAiStep();
}

function scheduleAiStep(delay = 850) {
  if (runAutoShowdownIfNeeded()) return;
  if (state.showdown) {
    clearActionTimer();
    return;
  }
  if (state.readyPhase) {
    clearActionTimer();
    if (!aiTimer && activePlayers().some((player) => player.ai && !player.ready)) {
      aiTimer = setTimeout(runScheduledStep, delay);
    }
    return;
  }
  const player = state.players[state.currentPlayer];
  if (player && player.ai && isOccupied(player) && !player.folded && activePlayers().length > 1) {
    clearActionTimer();
    if (!aiTimer) aiTimer = setTimeout(runScheduledStep, delay);
    return;
  }
  scheduleActionTimer();
}

function clearAiTimer() {
  if (!aiTimer) return;
  clearTimeout(aiTimer);
  aiTimer = null;
}

function clearAutoHandTimer() {
  if (!autoHandTimer) return;
  clearTimeout(autoHandTimer);
  autoHandTimer = null;
}

function scheduleAutoNewHand() {
  clearAutoHandTimer();
  const nextHandNumber = state.handNumber;
  autoHandTimer = setTimeout(() => {
    autoHandTimer = null;
    if (!state.showdown || state.handNumber !== nextHandNumber) return;
    removeBustedPlayers();
    state = createHand(state.playerCount, state.players);
    state.log.push("다음 핸드를 자동으로 시작합니다.");
    scheduleAiStep();
  }, 4000);
}

function removeBustedPlayers() {
  state.players.filter((player) => isOccupied(player) && player.stack <= 0).forEach((player) => {
    const name = player.name || "Player";
    state.log.push(`${name} 올인 후 칩이 없어 자동 이석됩니다.`);
    clearSeat(player);
  });
  reassignHostIfNeeded();
}

function scheduleActionTimer() {
  if (actionTimer || state.readyPhase || state.showdown) return;
  const player = state.players[state.currentPlayer];
  if (!player || player.ai || !isOccupied(player) || player.folded || activePlayers().length <= 1) {
    state.actionDeadline = null;
    return;
  }
  state.actionTimeoutMs = ACTION_TIMEOUT_MS;
  state.actionDeadline = Date.now() + ACTION_TIMEOUT_MS;
  const handNumberAtStart = state.handNumber;
  const playerIdAtStart = player.id;
  actionTimer = setTimeout(() => runActionTimeout(handNumberAtStart, playerIdAtStart), ACTION_TIMEOUT_MS);
}

function clearActionTimer() {
  if (actionTimer) {
    clearTimeout(actionTimer);
    actionTimer = null;
  }
  if (state) state.actionDeadline = null;
}

function runActionTimeout(handNumberAtStart, playerIdAtStart) {
  actionTimer = null;
  if (state.handNumber !== handNumberAtStart || state.currentPlayer !== playerIdAtStart || state.readyPhase || state.showdown) return;
  const player = state.players[state.currentPlayer];
  if (!player || player.ai || !isOccupied(player) || player.folded || activePlayers().length <= 1) return;
  state.actionDeadline = null;
  state.log.push(`${player.name} ${player.position} 시간 초과.`);
  if (Math.max(0, state.currentBet - player.bet)) fold(player);
  else checkCall(player);
  scheduleAiStep();
}

function runScheduledStep() {
  aiTimer = null;
  if (state.showdown) return;
  if (state.readyPhase) {
    const nextReady = activePlayers().find((player) => player.ai && !player.ready);
    if (!nextReady) {
      if (activePlayers().every((player) => player.ready)) doShowdown();
      return;
    }
    chooseAiDeclaration(nextReady);
    markReady(nextReady);
    scheduleAiStep();
    return;
  }
  const player = state.players[state.currentPlayer];
  if (!player || !player.ai || !isOccupied(player) || player.folded || activePlayers().length <= 1) return;
  const owed = Math.max(0, state.currentBet - player.bet);
  if (owed > 80 && Math.random() < 0.2) fold(player);
  else if (owed === 0 && player.stack > state.lastRaise && Math.random() < 0.12) betRaise(player, minRaiseTo(player));
  else checkCall(player);
  scheduleAiStep();
}

function chooseAiDeclaration(player) {
  if (!canDeclareSutda(player)) {
    player.mode = "holdem";
    return;
  }
  const roll = Math.random();
  player.mode = roll > 0.9 ? "swing" : roll > 0.62 ? "sutda" : "holdem";
  const usable = player.cards.find(isSutdaUsable);
  if (usable) player.sutdaCard = usable.id;
  chooseDefaultSutdaDeclaration(player);
}

function checkCall(player) {
  const owed = Math.max(0, state.currentBet - player.bet);
  const paid = commitChips(player, owed);
  player.acted = true;
  const allIn = paid > 0 && player.stack === 0;
  player.lastAction = allIn ? `\uC62C\uC778 ${player.bet}` : (paid ? `\uCF5C ${paid}` : "\uCCB4\uD06C");
  if (paid) state.log.push(`${player.name} ${player.position} \uCF5C ${paid}.`);
  pushEvent({ type: paid ? "bet" : "check", playerId: player.id, amount: paid, label: player.lastAction, allIn });
  afterAction();
}

function betRaise(player, requestedTarget) {
  const maxTarget = maxRaiseTo(player);
  if (maxTarget <= state.currentBet) {
    checkCall(player);
    return;
  }
  const minTarget = minRaiseTo(player);
  const requested = Number(requestedTarget) || displayedMinRaiseTo(player);
  const clampedTarget = Math.min(maxTarget, requested);
  const targetBet = clampedTarget < minTarget && clampedTarget < maxTarget ? displayedMinRaiseTo(player) : clampedTarget;
  if (targetBet <= state.currentBet) {
    checkCall(player);
    return;
  }
  const owed = Math.max(0, targetBet - player.bet);
  const previousBet = state.currentBet;
  const raiseSize = targetBet - previousBet;
  const paid = commitChips(player, owed);
  player.acted = true;
  state.currentBet = player.bet;
  if (raiseSize >= state.lastRaise) state.lastRaise = raiseSize;
  const allIn = paid > 0 && player.stack === 0;
  player.lastAction = allIn ? `\uC62C\uC778 ${state.currentBet}` : (previousBet ? `\uB808\uC774\uC988 ${state.currentBet}` : `\uBCA0\uD305 ${state.currentBet}`);
  activePlayers().forEach((item) => {
    if (item.id !== player.id && item.stack > 0 && item.bet < state.currentBet) item.acted = false;
  });
  state.log.push(`${player.name} ${player.position} ${state.currentBet}\uAE4C\uC9C0 \uB808\uC774\uC988.`);
  pushEvent({ type: "bet", playerId: player.id, amount: paid, label: player.lastAction, allIn });
  afterAction();
}

function fold(player) {
  player.folded = true;
  player.acted = true;
  player.lastAction = "폴드";
  state.log.push(`${player.name} ${player.position} 폴드.`);
  pushEvent({ type: "fold", playerId: player.id, amount: 0, label: "폴드" });
  if (activePlayers().length === 1) {
    const winner = activePlayers()[0];
    winner.stack += state.pot;
    state.log.push(`${winner.name} ${winner.position} 전체 팟 ${state.pot} 획득.`);
    state.result = {
      awards: [{ label: "전체", amount: state.pot, share: state.pot, winners: [{ id: winner.id, name: winner.name, position: winner.position, hand: awardHandSummary(winner, "전체") }] }],
      summaries: [`${winner.name} ${winner.position} 전체 팟 ${state.pot} 획득`]
    };
    pushEvent({ type: "award", awards: state.result.awards });
    state.pot = 0;
    state.showdown = true;
    state.cardsRevealed = false;
    state.street = 5;
    state.currentPlayer = -1;
    scheduleAutoNewHand();
    return;
  }
  afterAction();
}

function awardRemainingAfterRemoval() {
  const winner = activePlayers()[0];
  if (!winner) return;
  winner.stack += state.pot;
  state.log.push(`${winner.name} ${winner.position} 전체 팟 ${state.pot} 획득.`);
  state.result = {
    awards: [{ label: "전체", amount: state.pot, share: state.pot, winners: [{ id: winner.id, name: winner.name, position: winner.position, hand: awardHandSummary(winner, "전체") }] }],
    summaries: [`${winner.name} ${winner.position} 전체 팟 ${state.pot} 획득`]
  };
  pushEvent({ type: "award", awards: state.result.awards });
  state.pot = 0;
  state.showdown = true;
  state.cardsRevealed = false;
  state.street = 5;
  state.currentPlayer = -1;
  scheduleAutoNewHand();
  clearActionTimer();
  clearAiTimer();
}

function afterAction() {
  if (isBettingRoundSettled()) advanceStreet();
  else state.currentPlayer = nextActiveIndex(state.currentPlayer);
  if (state.currentPlayer < 0 && !isBettingRoundSettled()) advanceStreet();
}

function isBettingRoundSettled() {
  return activePlayers().every((player) => player.acted && (player.bet === state.currentBet || player.stack === 0));
}

function advanceStreet() {
  if (state.street >= 3) {
    enterReadyPhase();
    return;
  }
  state.street += 1;
  state.currentBet = 0;
  state.lastRaise = 10;
  state.players.forEach((player) => {
    player.bet = 0;
    player.streetBet = 0;
    player.acted = !isOccupied(player) || player.folded || player.stack === 0;
    if (isOccupied(player) && !player.folded) player.lastAction = player.stack === 0 ? "체크" : "";
  });
  state.currentPlayer = firstActiveFromPosition(firstActionPositionForStreet(state.street));
  state.log.push(`${STREET_NAMES[state.street]} 카드가 열렸습니다.`);
  if (state.currentPlayer < 0 || isBettingRoundSettled()) advanceStreet();
}

function enterReadyPhase() {
  state.street = 4;
  state.readyPhase = true;
  state.currentBet = 0;
  state.players.forEach((player) => {
    player.bet = 0;
    player.streetBet = 0;
    player.ready = !isOccupied(player) || player.folded;
    if (isOccupied(player) && !player.folded) player.lastAction = "";
    if (isOccupied(player) && !player.folded) chooseDefaultSutdaDeclaration(player);
  });
  state.log.push("리버 베팅 종료. 생존 플레이어의 쇼다운 준비를 기다립니다.");
}

function chooseDefaultSutdaDeclaration(player) {
  const handCards = player.cards.filter(isSutdaUsable);
  const boardCards = state.community.filter(isSutdaUsable);
  if (!handCards.length || !boardCards.length) {
    player.sutdaBoardCard = null;
    return;
  }
  const best = handCards.flatMap((handCard) => (
    boardCards.map((boardCard) => ({ handCard, boardCard, hand: evaluateSutdaPair(handCard, boardCard) }))
  )).sort((a, b) => -compareSutdaValues(a.hand, b.hand))[0];
  player.sutdaCard = best.handCard.id;
  player.sutdaBoardCard = best.boardCard.id;
}

function markReady(player) {
  if (!state.readyPhase || player.folded || state.showdown) return;
  player.ready = true;
  player.lastAction = "준비 완료";
  state.log.push(`${player.name} ${player.position} 쇼다운 준비 완료.`);
  if (activePlayers().every((item) => item.ready)) doShowdown();
}

function doShowdown() {
  state.street = 5;
  state.readyPhase = false;
  state.showdown = true;
  state.cardsRevealed = true;
  state.currentPlayer = -1;
  const result = settlePots();
  state.result = result;
  result.logs.forEach((line) => state.log.push(line));
  pushEvent({ type: "award", awards: result.awards });
  state.pot = 0;
  scheduleAutoNewHand();
}

function settlePots() {
  const sidePots = buildSidePots();
  if (!sidePots.length) return settlePotAmount(state.pot, activePlayers());
  const result = { logs: [], awards: [], summaries: [] };
  sidePots.forEach((pot, index) => {
    const settled = settlePotAmount(pot.amount, pot.contenders, sidePots.length > 1 ? ` #${index + 1}` : "");
    result.logs.push(...settled.logs);
    result.awards.push(...settled.awards);
    result.summaries.push(...(settled.summaries || []));
  });
  return { logs: result.logs, awards: result.awards.filter(Boolean), summaries: result.summaries };
}

function buildSidePots() {
  const contributors = state.players.filter((player) => (player.contribution || 0) > 0);
  const levels = [...new Set(contributors.map((player) => player.contribution || 0))].sort((a, b) => a - b);
  const pots = [];
  let previous = 0;
  levels.forEach((level) => {
    const contributorsAtLevel = contributors.filter((player) => (player.contribution || 0) >= level);
    const amount = (level - previous) * contributorsAtLevel.length;
    const contenders = activePlayers().filter((player) => (player.contribution || 0) >= level);
    if (amount > 0 && contenders.length) pots.push({ amount, contenders });
    previous = level;
  });
  return pots;
}

function potLayoutForAmount(amount) {
  if (state.street >= 3 && !hasSutdaCommunityCard()) return { holdem: amount, sutda: 0 };
  const holdem = Math.floor(amount / 2);
  return { holdem, sutda: amount - holdem };
}

function settlePotAmount(amount, contenders, labelSuffix = "") {
  const holdem = contenders.filter(isHoldemPotParticipant).map((player) => ({ player, hand: evaluateHoldem([...player.cards, ...state.community]) }));
  const holdemWinners = holdem.length ? bestEntries(holdem, "hand") : [];
  const logs = [`\uD640\uB364 \uCD5C\uACE0${labelSuffix}: ${holdem.length ? holdem.map((entry) => `${entry.player.name} ${entry.player.position} ${entry.hand.name}`).join(" / ") : "\uCC38\uAC00\uC790 \uC5C6\uC74C"}.`];
  const awards = [];
  const summaries = [];
  if (!hasSutdaCommunityCard()) {
    const forcedHoldem = contenders.map((player) => ({ player, hand: evaluateHoldem([...player.cards, ...state.community]) }));
    const forcedHoldemWinners = bestEntries(forcedHoldem, "hand");
    logs.push("\uCEE4\uBBA4\uB2C8\uD2F0\uC5D0 \uC12F\uB2E4 \uCE74\uB4DC\uAC00 \uC5C6\uC5B4 \uC12F\uB2E4 \uD31F\uC774 \uC5F4\uB9AC\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    awards.push(awardPlayers(forcedHoldemWinners.map((entry) => entry.player), amount, `\uD640\uB364${labelSuffix}`, logs));
    return { logs, awards: awards.filter(Boolean), summaries };
  }
  const sutda = contenders.filter(isSutdaPotParticipant).map((player) => ({ player, hand: evaluateSutdaPlayer(player) }));
  logs.push(`\uC12F\uB2E4 \uCD5C\uACE0${labelSuffix}: ${sutda.length ? sutda.map((entry) => `${entry.player.name} ${entry.player.position} ${entry.hand.name}`).join(" / ") : "\uCC38\uAC00\uC790 \uC5C6\uC74C"}.`);
  const sutdaWinners = sutda.length ? resolveSutdaRetry(sutda, bestEntries(sutda, "hand", compareSutdaValues), logs) : [];
  const swingWinners = contenders.filter((player) => player.mode === "swing" && isSoleWinner(holdemWinners, player) && isSoleWinner(sutdaWinners, player));
  if (swingWinners.length) {
    awards.push(awardPlayers(swingWinners, amount, `\uC2A4\uC719${labelSuffix}`, logs));
    return { logs, awards: awards.filter(Boolean), summaries };
  }
  const failedSwingIds = new Set(contenders.filter((player) => player.mode === "swing").map((player) => player.id));
  const holdemAwardPool = holdem.filter((entry) => !failedSwingIds.has(entry.player.id));
  const sutdaAwardPool = sutda.filter((entry) => !failedSwingIds.has(entry.player.id));
  const holdemAwardWinners = holdemAwardPool.length ? bestEntries(holdemAwardPool, "hand") : [];
  const sutdaAwardWinners = sutdaAwardPool.length ? bestEntries(sutdaAwardPool, "hand", compareSutdaValues) : [];
  if (failedSwingIds.size) logs.push("\uC2A4\uC719 \uC2E4\uD328\uC790\uB294 \uC591\uCABD \uD31F \uC218\uC0C1 \uC790\uACA9\uC5D0\uC11C \uC81C\uC678\uB429\uB2C8\uB2E4.");
  if (!sutdaAwardPool.length && holdemAwardPool.length) {
    logs.push("\uC12F\uB2E4 \uD31F\uC5D0 \uC720\uD6A8\uD55C \uC218\uC0C1\uC790\uAC00 \uC5C6\uC5B4 \uD640\uB364 \uD31F\uC5D0 \uD569\uCE69\uB2C8\uB2E4.");
    awards.push(awardPlayers(holdemAwardWinners.map((entry) => entry.player), amount, `\uD640\uB364${labelSuffix}`, logs));
    return { logs, awards: awards.filter(Boolean), summaries };
  }
  if (!holdemAwardPool.length && sutdaAwardPool.length) {
    logs.push("\uD640\uB364 \uD31F\uC5D0 \uC720\uD6A8\uD55C \uC218\uC0C1\uC790\uAC00 \uC5C6\uC5B4 \uC12F\uB2E4 \uD31F\uC5D0 \uD569\uCE69\uB2C8\uB2E4.");
    awards.push(awardPlayers(sutdaAwardWinners.map((entry) => entry.player), amount, `\uC12F\uB2E4${labelSuffix}`, logs));
    return { logs, awards: awards.filter(Boolean), summaries };
  }
  if (!holdemAwardPool.length && !sutdaAwardPool.length) {
    logs.push("\uC2A4\uC719 \uD50C\uB808\uC774\uC5B4\uB9CC \uB0A8\uC544 \uC804\uCCB4 \uD31F\uC744 \uC2A4\uD50C\uB9BF\uD569\uB2C8\uB2E4.");
    awards.push(awardPlayers(contenders, amount, `\uC2A4\uC719 \uC2E4\uD328 \uC2A4\uD50C\uB9BF${labelSuffix}`, logs));
    return { logs, awards: awards.filter(Boolean), summaries };
  }
  const pots = potLayoutForAmount(amount);
  awards.push(awardPlayers(holdemAwardWinners.map((entry) => entry.player), pots.holdem, `\uD640\uB364${labelSuffix}`, logs));
  awards.push(awardPlayers(sutdaAwardWinners.map((entry) => entry.player), pots.sutda, `\uC12F\uB2E4${labelSuffix}`, logs));
  return { logs, awards: awards.filter(Boolean), summaries };
}
function isSoleWinner(winners, player) {
  return winners.length === 1 && winners[0].player.id === player.id;
}

function bestEntries(entries, key, comparator = compareValues) {
  let best = entries[0];
  entries.forEach((entry) => {
    if (comparator(entry[key], best[key]) > 0) best = entry;
  });
  return entries.filter((entry) => comparator(entry[key], best[key]) === 0);
}

function awardPlayers(winners, amount, label, logs) {
  if (!amount || !winners.length) return null;
  const split = Math.floor(amount / winners.length);
  const dealerFee = amount - split * winners.length;
  winners.forEach((player) => { player.stack += split; });
  logs.push(`${label} 팟 ${amount}: ${winners.map((player) => `${player.name} ${player.position}`).join(", ")} ${split}씩 획득${dealerFee ? `, 딜러비 ${dealerFee}` : ""}.`);
  return {
    label,
    amount,
    share: split,
    dealerFee,
    winners: winners.map((player) => ({ id: player.id, name: player.name, position: player.position, hand: awardHandSummary(player, label) }))
  };
}

function awardHandSummary(player, label) {
  if (label.includes("홀덤")) return holdemSummary(player);
  if (label.includes("섯다")) return evaluateSutdaPlayer(player).name;
  if (label.includes("스윙") && !label.includes("실패")) {
    return `홀덤 ${holdemSummary(player)} / 섯다 ${evaluateSutdaPlayer(player).name}`;
  }
  if (player.mode === "holdem") return holdemSummary(player);
  if (player.mode === "sutda") return evaluateSutdaPlayer(player).name;
  if (player.mode === "swing") return `홀덤 ${holdemSummary(player)} / 섯다 ${evaluateSutdaPlayer(player).name}`;
  return holdemSummary(player);
}

function holdemSummary(player) {
  const cards = [...player.cards, ...state.community];
  if (cards.length >= 5) return evaluateHoldem(cards).name;
  const high = cards.map((card) => card.value).sort((a, b) => b - a)[0] || 0;
  return high ? `${rankLabel(high)}하이` : "";
}

function resolveSutdaRetry(results, currentWinners, logs) {
  if (!shouldRetrySutda(results)) return currentWinners;
  logs.push("사구/멍사구 발생. 섯다 팟 참가자끼리 섯다 전용 덱으로 2장 재경기합니다.");
  const retryDeck = shuffle(buildDeck().filter(isSutdaUsable));
  const reroll = results.map((entry) => {
    const cards = retryDeck.splice(0, 2);
    return { player: entry.player, cards, hand: evaluateSutdaPair(cards[0], cards[1]) };
  });
  pushEvent({
    type: "sutdaRetry",
    label: hasMungSagu(results) ? "멍사구 재경기 중..." : "사구 재경기 중...",
    entries: reroll.map((entry) => ({
      playerId: entry.player.id,
      name: entry.player.name,
      position: entry.player.position,
      cards: entry.cards,
      hand: entry.hand.name
    }))
  });
  logs.push(`재경기 섯다: ${reroll.map((entry) => `${entry.player.name} ${entry.player.position} ${entry.cards.map((card) => card.id).join("+")} ${entry.hand.name}`).join(" / ")}.`);
  return bestEntries(reroll, "hand", compareSutdaValues);
}
function hasMungSagu(results) {
  return results.some((entry) => entry.hand.retryType === "mungSagu");
}


function isSutdaPotParticipant(player) {
  return player.mode === "sutda" || player.mode === "swing";
}

function isHoldemPotParticipant(player) {
  return player.mode === "holdem" || player.mode === "swing";
}

function shouldRetrySutda(results) {
  const hasSagu = results.some((entry) => entry.hand.retryType === "sagu");
  const mungSagu = hasMungSagu(results);
  if (!hasSagu && !mungSagu) return false;
  const best = bestEntries(results, "hand", compareSutdaValues)[0].hand;
  const ali = { score: 760, kickers: [1, 2], name: "알리" };
  const nineDdang = { score: 809, kickers: [9, 9], name: "9땡", group: "ddang" };
  return (mungSagu && compareSutdaValues(best, nineDdang) <= 0) || (hasSagu && compareSutdaValues(best, ali) <= 0);
}

function evaluateSutdaPlayer(player) {
  if (player.mode === "holdem") return { score: -1, kickers: [], name: "섯다 미선언" };
  const handCard = player.cards.find((item) => item.id === player.sutdaCard);
  if (!handCard || !isSutdaUsable(handCard)) return { score: -1, kickers: [], name: "섯다 불성립" };
  const boardCard = state.community.find((item) => item.id === player.sutdaBoardCard);
  if (boardCard && isSutdaUsable(boardCard)) return evaluateSutdaPair(handCard, boardCard);
  return evaluateSutdaFromCard(handCard);
}

function evaluateSutdaFromCard(handCard) {
  const candidates = state.community.filter(isSutdaUsable).map((board) => evaluateSutdaPair(handCard, board));
  if (!candidates.length) return { score: -1, kickers: [], name: "섯다 불성립" };
  return candidates.sort((a, b) => -compareSutdaValues(a, b))[0];
}

function evaluateSutdaPair(a, b) {
  const months = [a.month, b.month].sort((x, y) => x - y);
  const key = months.join("-");
  const bothGwang = sutdaType(a) === "광" && sutdaType(b) === "광";
  const gwangMade = {
    "3-8": [900, "38광땡"],
    "1-8": [880, "18광땡"],
    "1-3": [870, "13광땡"]
  };
  if (gwangMade[key] && bothGwang) return { score: gwangMade[key][0], kickers: months, name: gwangMade[key][1], group: "gwang" };
  if (hasSpecificCards(a, b, (card) => isGwangMonth(card, 3), (card) => isBoar(card))) {
    return { score: 0, kickers: months, name: "땡잡이", special: "ttangCatch" };
  }
  if (hasSpecificCards(a, b, (card) => isBird(card), (card) => isBoar(card))) {
    return { score: 1, kickers: months, name: "암행어사", special: "spy" };
  }
  if (key === "4-9") {
    const mung = hasSpecificCards(a, b, (card) => isBird(card), (card) => card.month === 9 && sutdaType(card) === "동물");
    return { score: 0, kickers: months, name: mung ? "멍사구" : "사구", retryType: mung ? "mungSagu" : "sagu" };
  }
  const made = {
    "1-2": [760, "알리"], "1-4": [755, "독사"], "1-9": [750, "구삥"],
    "1-10": [745, "장삥"], "4-10": [740, "장사"], "4-6": [735, "세륙"],
  };
  if (made[key]) return { score: made[key][0], kickers: months, name: made[key][1], retry: Boolean(made[key][2]) };
  if (months[0] === months[1]) return { score: 800 + months[0], kickers: months, name: `${months[0]}땡`, group: "ddang" };
  const gut = (months[0] + months[1]) % 10;
  return { score: gut, kickers: [gut, ...months], name: `${gut}끗` };
}

function sutdaType(card) {
  return isSutdaUsable(card) ? SUTDA_CARD_TYPES[card.suit][card.month] : "";
}

function sutdaDisplayType(card) {
  if (!isSutdaUsable(card)) return "";
  if (card.suit === "♠" && card.month === 4) return "새";
  if (card.suit === "♠" && card.month === 7) return "멧돼지";
  return sutdaType(card);
}

function hasSpecificCards(a, b, first, second) {
  return (first(a) && second(b)) || (first(b) && second(a));
}

function isGwangMonth(card, month) {
  return card && card.month === month && sutdaType(card) === "광";
}

function isBird(card) {
  return card && card.month === 4 && sutdaType(card) === "동물";
}

function isBoar(card) {
  return card && card.month === 7 && sutdaType(card) === "동물";
}

function evaluateHoldem(cards) {
  return combinations(cards, 5).map(scoreFive).sort((a, b) => -compareValues(a, b))[0];
}

function combinations(items, size) {
  const result = [];
  const walk = (start, picked) => {
    if (picked.length === size) {
      result.push(picked);
      return;
    }
    for (let i = start; i <= items.length - (size - picked.length); i += 1) walk(i + 1, [...picked, items[i]]);
  };
  walk(0, []);
  return result;
}

function scoreFive(cards) {
  const values = cards.map((card) => card.value).sort((a, b) => b - a);
  const unique = [...new Set(values)];
  const straightHigh = findStraightHigh(unique);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const counts = unique.map((value) => ({ value, count: values.filter((v) => v === value).length })).sort((a, b) => b.count - a.count || b.value - a.value);
  if (flush && straightHigh) return hand(8, [straightHigh], `${rankLabel(straightHigh)}스트레이트 플러시`);
  if (counts[0].count === 4) return hand(7, [counts[0].value, counts[1].value], `${rankLabel(counts[0].value)}포카드`);
  if (counts[0].count === 3 && counts[1].count === 2) return hand(6, [counts[0].value, counts[1].value], `${rankLabel(counts[0].value)},${rankLabel(counts[1].value)}풀하우스`);
  if (flush) return hand(5, values, `${rankLabel(values[0])}플러시`);
  if (straightHigh) return hand(4, [straightHigh], `${rankLabel(straightHigh)}스트레이트`);
  if (counts[0].count === 3) return hand(3, [counts[0].value, ...counts.slice(1).map((c) => c.value)], `${rankLabel(counts[0].value)}트리플`);
  if (counts[0].count === 2 && counts[1].count === 2) return hand(2, [counts[0].value, counts[1].value, counts[2].value], `${rankLabel(counts[0].value)},${rankLabel(counts[1].value)}투페어`);
  if (counts[0].count === 2) return hand(1, [counts[0].value, ...counts.slice(1).map((c) => c.value)], `${rankLabel(counts[0].value)}원페어`);
  return hand(0, values, `${rankLabel(values[0])}하이`);
}

function hand(category, kickers, name) {
  return { score: category * 1000000, kickers, name };
}

function rankLabel(value) {
  return ({ 14: "A", 13: "K", 12: "Q", 11: "J" }[value] || String(value));
}

function findStraightHigh(uniqueValues) {
  const unique = [...uniqueValues].sort((a, b) => b - a);
  if (unique.includes(14) && unique.includes(5) && unique.includes(4) && unique.includes(3) && unique.includes(2)) return 5;
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const run = unique.slice(index, index + 5);
    if (run.length === 5 && run.every((value, offset) => value === run[0] - offset)) return run[0];
  }
  return 0;
}

function compareValues(a, b) {
  if (a.score !== b.score) return Math.sign(a.score - b.score);
  const max = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < max; i += 1) {
    const diff = (typeof a.kickers[i] === "number" ? a.kickers[i] : 0) - (typeof b.kickers[i] === "number" ? b.kickers[i] : 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

function compareSutdaValues(a, b) {
  if (sutdaSpecialBeats(a, b)) return 1;
  if (sutdaSpecialBeats(b, a)) return -1;
  return compareValues(a, b);
}

function sutdaSpecialBeats(a, b) {
  if (!a || !b) return false;
  if (a.special === "ttangCatch" && b.group === "ddang" && (b.kickers[0] || 0) < 10) return true;
  if (a.special === "spy" && b.group === "gwang" && b.name !== "38광땡") return true;
  return false;
}

function joinSeat(body) {
  let player = playerByClient(body.clientId);
  const nextName = sanitizePlayerName(body.name);
  if (player) {
    player.lastSeen = Date.now();
    if (player.name !== nextName) {
      player.name = nextName;
      state.log.push(`${player.name} 닉네임 변경.`);
    }
    return;
  }
  player = state.players.find((item) => !isOccupied(item));
  if (!player) throw new Error("빈 좌석이 없습니다.");
  if (!hostClientId) hostClientId = body.clientId;
  player.clientId = body.clientId;
  player.ai = false;
  player.lastSeen = Date.now();
  player.name = nextName;
  player.folded = true;
  player.acted = true;
  player.ready = true;
  state.log.push(`${player.name} 착석.`);
}

function sanitizePlayerName(name) {
  const cleaned = String(name || "").trim().replace(/\s+/g, " ");
  return Array.from(cleaned || "Player").slice(0, 5).join("");
}

function kickSeat(body) {
  if (!body.clientId || body.clientId !== hostClientId) throw new Error("방장만 강퇴할 수 있습니다.");
  const player = state.players[Number(body.seatId)];
  if (!isOccupied(player)) throw new Error("이미 빈 좌석입니다.");
  if (player.clientId && player.clientId === body.clientId) throw new Error("방장은 자기 자신을 강퇴할 수 없습니다.");
  removeSeat(player, "방장 강퇴");
}

function leaveSeat(body) {
  const player = playerByClient(body.clientId);
  if (player) removeSeat(player, "퇴장");
}

function removeSeat(player, reason) {
  const inProgress = isHandInProgress();
  const wasActive = inProgress && !state.showdown && !state.readyPhase && state.currentPlayer === player.id && !player.folded;
  const wasLive = inProgress && !state.showdown && !player.folded;
  const name = player.name || "Player";
  const position = player.position || "";
  if (wasLive) {
    player.folded = true;
    player.acted = true;
    player.lastAction = reason;
    pushEvent({ type: "fold", playerId: player.id, amount: 0, label: reason });
  }
  state.log.push(`${name} ${position} ${reason}.`);
  clearSeat(player);
  reassignHostIfNeeded();
  if (!inProgress || state.showdown) return;
  if (activePlayers().length === 1 && state.pot > 0) {
    awardRemainingAfterRemoval();
    return;
  }
  if (state.readyPhase) {
    if (activePlayers().every((item) => item.ready)) doShowdown();
    return;
  }
  if (wasActive) afterAction();
  else if (wasLive && isBettingRoundSettled()) advanceStreet();
}

function clearSeat(player) {
  player.clientId = null;
  player.ai = false;
  player.name = "";
  player.lastSeen = 0;
  player.position = "";
  player.stack = 1000;
  player.bet = 0;
  player.streetBet = 0;
  player.contribution = 0;
  player.acted = true;
  player.folded = true;
  player.ready = true;
  player.lastAction = "";
  player.cards = [];
  player.mode = "holdem";
  player.sutdaCard = null;
}

function reassignHostIfNeeded() {
  if (hostClientId && state.players.some((player) => player.clientId === hostClientId)) return;
  const nextHost = state.players.find((player) => player.clientId && !player.ai);
  hostClientId = nextHost ? nextHost.clientId : null;
}

function fillAiSeats(body) {
  if (!body.clientId || body.clientId !== hostClientId) throw new Error("방장만 AI를 채울 수 있습니다.");
  clearAiTimer();
  clearActionTimer();
  clearAutoHandTimer();
  let filled = 0;
  state.players.forEach((player, index) => {
    if (isOccupied(player)) return;
    player.clientId = null;
    player.ai = true;
    player.name = `AI ${index + 1}`;
    player.stack = 1000;
    filled += 1;
  });
  state = createHand(state.playerCount, state.players);
  state.log.push(filled ? `방장이 빈 좌석 ${filled}개를 AI로 채웠습니다.` : "채울 빈 좌석이 없습니다.");
  scheduleAiStep();
}

function startNewHand(body) {
  if (!body.clientId || body.clientId !== hostClientId) throw new Error("방장만 새 핸드를 시작할 수 있습니다.");
  clearAiTimer();
  clearActionTimer();
  clearAutoHandTimer();
  state = createHand(Number(body.playerCount || state.playerCount), state.players);
  scheduleAiStep();
}

function postChat(body) {
  const text = Array.from(String(body.text || "").trim().replace(/\s+/g, " ")).slice(0, 80).join("");
  if (!text) throw new Error("채팅 내용이 없습니다.");
  const player = playerByClient(body.clientId);
  if (player && !player.ai) player.lastSeen = Date.now();
  const name = player && isOccupied(player) ? player.name : "관전";
  const senderKey = player && player.clientId ? player.clientId : `viewer:${body.clientId || "anonymous"}`;
  chatMessages.push({
    id: Date.now() + Math.random(),
    senderKey,
    name,
    text,
    at: Date.now()
  });
  chatMessages = chatMessages.slice(-120);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".mp3": "audio/mpeg" };
    res.writeHead(200, { "Content-Type": `${types[ext] || "application/octet-stream"}; charset=utf-8` });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/state") {
      return sendJson(res, safeState(url.searchParams.get("clientId"), Number(url.searchParams.get("seatId"))));
    }
    if (url.pathname === "/api/join" && req.method === "POST") {
      joinSeat(await readJson(req));
      return sendJson(res, { ok: true });
    }
    if (url.pathname === "/api/leave" && req.method === "POST") {
      leaveSeat(await readJson(req));
      return sendJson(res, { ok: true });
    }
    if (url.pathname === "/api/kick" && req.method === "POST") {
      kickSeat(await readJson(req));
      return sendJson(res, { ok: true });
    }
    if (url.pathname === "/api/chat" && req.method === "POST") {
      postChat(await readJson(req));
      return sendJson(res, { ok: true });
    }
    if (url.pathname === "/api/fill-ai" && req.method === "POST") {
      fillAiSeats(await readJson(req));
      return sendJson(res, { ok: true });
    }
    if (url.pathname === "/api/new-hand" && req.method === "POST") {
      startNewHand(await readJson(req));
      return sendJson(res, { ok: true });
    }
    if (url.pathname === "/api/action" && req.method === "POST") {
      handleAction(await readJson(req));
      return sendJson(res, { ok: true });
    }
    serveStatic(req, res);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 400);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`화투럼프 섯다 홀덤 서버: http://localhost:${port}`);
});

