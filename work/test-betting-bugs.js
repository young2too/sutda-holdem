const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("outputs/server.js", "utf8").replace(/server\.listen[\s\S]*$/, "");
const ctx = { console, require, Buffer, process: { env: {} }, __dirname: "outputs", setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(code, ctx);

function run(script) {
  return JSON.parse(vm.runInContext(`JSON.stringify((() => { ${script} })())`, ctx));
}

function assert(condition, message, detail) {
  if (!condition) {
    console.error(message, detail || "");
    process.exit(1);
  }
}

const idleLeave = run(`
  clearAiTimer();
  clearActionTimer();
  state = createHand(6, []);
  hostClientId = null;
  joinSeat({ clientId: "p0", name: "P0" });
  joinSeat({ clientId: "p1", name: "P1" });
  leaveSeat({ clientId: "p1" });
  return { street: state.street, pot: state.pot, currentPlayer: state.currentPlayer, handNumber: state.handNumber };
`);
assert(idleLeave.street === 0 && idleLeave.pot === 0 && idleLeave.currentPlayer === -1, "idle leave advanced the hand", idleLeave);

const shortStackRaiseFallsBackToCall = run(`
  state = createHand(3, [
    { clientId: "p0", name: "P0", stack: 200, lastSeen: Date.now() },
    { clientId: "p1", name: "P1", stack: 1000, lastSeen: Date.now() },
    { clientId: "p2", name: "P2", stack: 1000, lastSeen: Date.now() }
  ]);
  state.players.forEach((player) => {
    player.folded = false;
    player.acted = true;
    player.bet = 0;
    player.streetBet = 0;
    player.contribution = 0;
  });
  state.players[0].stack = 200;
  state.currentPlayer = 0;
  state.currentBet = 500;
  state.lastRaise = 500;
  state.pot = 0;
  betRaise(state.players[0], 200);
  return { stack: state.players[0].stack, bet: state.players[0].bet, currentBet: state.currentBet, pot: state.pot };
`);
assert(shortStackRaiseFallsBackToCall.stack === 0 && shortStackRaiseFallsBackToCall.bet === 200 && shortStackRaiseFallsBackToCall.currentBet === 500, "short stack raise was treated as a legal raise", shortStackRaiseFallsBackToCall);

const shortAllInRaiseSettles = run(`
  state = createHand(3, [
    { clientId: "p0", name: "P0", stack: 700, lastSeen: Date.now() },
    { clientId: "p1", name: "P1", stack: 500, lastSeen: Date.now() },
    { clientId: "p2", name: "P2", stack: 500, lastSeen: Date.now() }
  ]);
  state.players.forEach((player, index) => {
    player.folded = false;
    player.acted = index !== 0;
    player.bet = index === 0 ? 0 : 500;
    player.streetBet = player.bet;
    player.contribution = player.bet;
  });
  state.currentPlayer = 0;
  state.currentBet = 500;
  state.lastRaise = 500;
  state.pot = 1000;
  betRaise(state.players[0], 700);
  const afterAllIn = { currentBet: state.currentBet, lastRaise: state.lastRaise, p0Stack: state.players[0].stack, p1Acted: state.players[1].acted };
  checkCall(state.players[1]);
  checkCall(state.players[2]);
  return { ...afterAllIn, street: state.street };
`);
assert(shortAllInRaiseSettles.currentBet === 700 && shortAllInRaiseSettles.lastRaise === 500 && shortAllInRaiseSettles.p0Stack === 0 && shortAllInRaiseSettles.street === 1, "short all-in raise did not settle correctly", shortAllInRaiseSettles);

const maxRaiseAfterStreet = run(`
  state = createHand(2, [
    { clientId: "p0", name: "P0", stack: 300, lastSeen: Date.now() },
    { clientId: "p1", name: "P1", stack: 1000, lastSeen: Date.now() }
  ]);
  hostClientId = "p0";
  state.currentPlayer = 0;
  state.currentBet = 0;
  state.players[0].bet = 0;
  state.players[0].streetBet = 0;
  state.players[0].stack = 300;
  const view = safeState("p0");
  return view.controls;
`);
assert(maxRaiseAfterStreet.maxRaiseTo === 300, "raise max did not follow remaining stack", maxRaiseAfterStreet);

const sidePots = run(`
  state = createHand(3, [
    { clientId: "p0", name: "P0", stack: 0, lastSeen: Date.now() },
    { clientId: "p1", name: "P1", stack: 0, lastSeen: Date.now() },
    { clientId: "p2", name: "P2", stack: 0, lastSeen: Date.now() }
  ]);
  state.players.forEach((player, index) => {
    player.folded = false;
    player.contribution = index === 0 ? 700 : 1000;
  });
  state.pot = 2700;
  return buildSidePots().map((pot) => ({ amount: pot.amount, contenders: pot.contenders.map((player) => player.id) }));
`);
assert(sidePots.length === 2 && sidePots[0].amount === 2100 && sidePots[0].contenders.length === 3 && sidePots[1].amount === 600 && sidePots[1].contenders.join(",") === "1,2", "side pot layers are wrong", sidePots);

const firstAllInPlayerIsSkipped = run(`
  state = createHand(3, [
    { clientId: "p0", name: "P0", stack: 1000, lastSeen: Date.now() },
    { clientId: "p1", name: "P1", stack: 1000, lastSeen: Date.now() },
    { clientId: "p2", name: "P2", stack: 1000, lastSeen: Date.now() }
  ]);
  const firstPostflop = state.players.find((player) => player.position === firstActionPositionForStreet(1));
  firstPostflop.stack = 0;
  firstPostflop.contribution = 500;
  state.pot = 1500;
  advanceStreet();
  return {
    street: state.street,
    firstPostflopId: firstPostflop.id,
    currentPlayer: state.currentPlayer,
    firstPostflopActed: firstPostflop.acted,
    firstPostflopLastAction: firstPostflop.lastAction
  };
`);
assert(firstAllInPlayerIsSkipped.street === 1 && firstAllInPlayerIsSkipped.currentPlayer !== firstAllInPlayerIsSkipped.firstPostflopId && firstAllInPlayerIsSkipped.firstPostflopActed && firstAllInPlayerIsSkipped.firstPostflopLastAction, "all-in first actor was not auto-skipped", firstAllInPlayerIsSkipped);

const allInRunout = run(`
  state = createHand(2, [
    { clientId: "p0", name: "P0", stack: 1000, lastSeen: Date.now() },
    { clientId: "p1", name: "P1", stack: 1000, lastSeen: Date.now() }
  ]);
  state.players.forEach((player) => {
    player.folded = false;
    player.stack = 0;
    player.acted = true;
    player.contribution = 1000;
  });
  state.pot = 2000;
  advanceStreet();
  const p0State = safeState("p0", 0);
  return { street: state.street, showdown: state.showdown, readyPhase: state.readyPhase, currentPlayer: state.currentPlayer, canReady: p0State.controls.canReady };
`);
assert(allInRunout.readyPhase && !allInRunout.showdown && allInRunout.street === 4 && allInRunout.currentPlayer === -1 && allInRunout.canReady, "all-in runout skipped showdown choice", allInRunout);

const allInAutoFromState = run(`
  state = createHand(2, [
    { clientId: "p0", name: "P0", stack: 1000, lastSeen: Date.now() },
    { clientId: "p1", name: "P1", stack: 1000, lastSeen: Date.now() }
  ]);
  state.players.forEach((player) => {
    player.folded = false;
    player.stack = 0;
    player.acted = true;
    player.contribution = 1000;
  });
  state.pot = 2000;
  const p0State = safeState("p0", 0);
  return { street: state.street, readyPhase: state.readyPhase, showdown: state.showdown, cardsRevealed: state.cardsRevealed, currentPlayer: state.currentPlayer, canReady: p0State.controls.canReady };
`);
assert(allInAutoFromState.readyPhase && !allInAutoFromState.showdown && !allInAutoFromState.cardsRevealed && allInAutoFromState.street === 4 && allInAutoFromState.currentPlayer === -1 && allInAutoFromState.canReady, "all-in players did not stop for showdown choice from state polling", allInAutoFromState);

const foldWinKeepsCardsHidden = run(`
  state = createHand(2, [
    { clientId: "winner", name: "Win", stack: 1000, lastSeen: Date.now() },
    { clientId: "folder", name: "Fold", stack: 1000, lastSeen: Date.now() }
  ]);
  state.players.forEach((player) => {
    player.folded = false;
    player.acted = false;
  });
  state.currentPlayer = 1;
  state.pot = 100;
  fold(state.players[1]);
  const viewerState = safeState("folder");
  const winnerView = viewerState.players.find((player) => player.id === 0);
  return {
    showdown: state.showdown,
    cardsRevealed: state.cardsRevealed,
    winnerCardsHidden: winnerView.cards.every((card) => card === null),
    winnerMode: winnerView.mode
  };
`);
assert(foldWinKeepsCardsHidden.showdown && !foldWinKeepsCardsHidden.cardsRevealed && foldWinKeepsCardsHidden.winnerCardsHidden && foldWinKeepsCardsHidden.winnerMode === "hidden", "fold victory revealed winner cards", foldWinKeepsCardsHidden);

const sutdaRetryEvent = run(`
  state = createHand(2, [
    { clientId: "p0", name: "Sagu", stack: 1000, lastSeen: Date.now() },
    { clientId: "p1", name: "Jang", stack: 1000, lastSeen: Date.now() }
  ]);
  state.events = [];
  state.eventId = 0;
  const results = [
    { player: state.players[0], hand: { score: 0, kickers: [4, 9], name: "사구", retryType: "sagu" } },
    { player: state.players[1], hand: { score: 745, kickers: [1, 10], name: "장삥" } }
  ];
  resolveSutdaRetry(results, [results[1]], state.log);
  const event = state.events.find((item) => item.type === "sutdaRetry");
  return {
    hasEvent: Boolean(event),
    label: event && event.label,
    entryCount: event ? event.entries.length : 0,
    cardCounts: event ? event.entries.map((entry) => entry.cards.length) : []
  };
`);
assert(sutdaRetryEvent.hasEvent && sutdaRetryEvent.label === "사구 재경기 중..." && sutdaRetryEvent.entryCount === 2 && sutdaRetryEvent.cardCounts.every((count) => count === 2), "sutda retry event was not emitted", sutdaRetryEvent);

const bustedPlayersLeave = run(`
  state = createHand(3, [
    { clientId: "p0", name: "Alive", stack: 500, lastSeen: Date.now() },
    { clientId: "p1", name: "Bust", stack: 0, lastSeen: Date.now() },
    { clientId: "p2", name: "AlsoBust", stack: 0, lastSeen: Date.now() }
  ]);
  state.players[0].stack = 500;
  state.players[1].stack = 0;
  state.players[2].stack = 0;
  removeBustedPlayers();
  return {
    occupied: state.players.map((player) => player.occupied || Boolean(player.clientId || player.ai)),
    p0Occupied: Boolean(state.players[0].clientId || state.players[0].ai),
    p1Occupied: Boolean(state.players[1].clientId || state.players[1].ai),
    p2Occupied: Boolean(state.players[2].clientId || state.players[2].ai)
  };
`);
assert(bustedPlayersLeave.p0Occupied && !bustedPlayersLeave.p1Occupied && !bustedPlayersLeave.p2Occupied, "busted players were not auto-removed", bustedPlayersLeave);

const readableActionLabels = run(`
  state = createHand(3, [
    { clientId: "p0", name: "P0", stack: 1000, lastSeen: Date.now() },
    { clientId: "p1", name: "P1", stack: 1000, lastSeen: Date.now() },
    { clientId: "p2", name: "P2", stack: 1000, lastSeen: Date.now() }
  ]);
  state.players.forEach((player) => {
    player.folded = false;
    player.acted = false;
    player.bet = 0;
    player.streetBet = 0;
    player.contribution = 0;
  });
  state.currentPlayer = 0;
  state.currentBet = 0;
  state.pot = 0;
  checkCall(state.players[0]);
  const checkLabel = state.players[0].lastAction;
  state.currentPlayer = 1;
  betRaise(state.players[1], 100);
  const raiseLabel = state.players[1].lastAction;
  state.currentPlayer = 2;
  checkCall(state.players[2]);
  const callLabel = state.players[2].lastAction;
  state = createHand(2, [
    { clientId: "a0", name: "All", stack: 50, lastSeen: Date.now() },
    { clientId: "a1", name: "Cover", stack: 1000, lastSeen: Date.now() }
  ]);
  state.players.forEach((player) => {
    player.folded = false;
    player.acted = false;
    player.bet = 0;
    player.streetBet = 0;
    player.contribution = 0;
  });
  state.players[0].stack = 50;
  state.players[0].bet = 0;
  state.currentBet = 100;
  state.lastRaise = 100;
  state.currentPlayer = 0;
  betRaise(state.players[0], 500);
  const allInLabel = state.players[0].lastAction;
  return { checkLabel, raiseLabel, callLabel, allInLabel };
`);
assert(
  readableActionLabels.checkLabel === "체크" &&
  readableActionLabels.raiseLabel.startsWith("베팅") &&
  readableActionLabels.callLabel.startsWith("콜") &&
  readableActionLabels.allInLabel.startsWith("올인"),
  "action labels are not readable Korean",
  readableActionLabels
);

const allInRunoutStopsForShowdownChoice = run(`
  state = createHand(2, [
    { clientId: "p0", name: "P0", stack: 0, lastSeen: Date.now() },
    { clientId: "p1", name: "P1", stack: 0, lastSeen: Date.now() }
  ]);
  state.players.forEach((player) => {
    player.folded = false;
    player.acted = true;
    player.ready = false;
    player.bet = 500;
    player.streetBet = 500;
    player.contribution = 500;
    player.stack = 0;
  });
  state.pot = 1000;
  state.street = 3;
  state.currentPlayer = -1;
  state.currentBet = 500;
  const autoResult = runAutoShowdownIfNeeded();
  const p0State = safeState("p0", 0);
  return {
    autoResult,
    readyPhase: state.readyPhase,
    showdown: state.showdown,
    p0Ready: state.players[0].ready,
    canReady: p0State.controls.canReady,
    showControls: p0State.readyPhase && !p0State.showdown
  };
`);
assert(
  allInRunoutStopsForShowdownChoice.readyPhase === true &&
  allInRunoutStopsForShowdownChoice.showdown === false &&
  allInRunoutStopsForShowdownChoice.p0Ready === false &&
  allInRunoutStopsForShowdownChoice.canReady === true &&
  allInRunoutStopsForShowdownChoice.showControls === true,
  "all-in runout skipped the showdown choice phase",
  allInRunoutStopsForShowdownChoice
);

const threeWayRetryEvent = run(`
  function c(rank, suit) {
    return {
      id: rank + suit,
      rank,
      suit,
      month: rank === "A" ? 1 : rank === "J" ? 11 : rank === "Q" ? 12 : rank === "K" ? null : Number(rank),
      value: rank === "A" ? 14 : rank === "K" ? 13 : rank === "Q" ? 12 : rank === "J" ? 11 : Number(rank)
    };
  }
  state = createHand(3, [
    { clientId: "p0", name: "Retry0", stack: 1000, lastSeen: Date.now() },
    { clientId: "p1", name: "Retry1", stack: 1000, lastSeen: Date.now() },
    { clientId: "p2", name: "Retry2", stack: 1000, lastSeen: Date.now() }
  ]);
  state.events = [];
  state.eventId = 0;
  const fixedCards = [c("9", "\\u2660"), c("9", "\\u2665"), c("A", "\\u2660"), c("2", "\\u2660"), c("4", "\\u2665"), c("A", "\\u2665")];
  shuffle = (cards) => [...fixedCards, ...cards.filter((card) => !fixedCards.some((fixed) => fixed.id === card.id))];
  const results = state.players.map((player, index) => ({
    player,
    hand: index === 0
      ? { score: 0, kickers: [4, 9], name: "사구", retryType: "sagu" }
      : { score: index, kickers: [index], name: index + "끗" }
  }));
  const winners = resolveSutdaRetry(results, [results[2]], state.log);
  const event = state.events.find((item) => item.type === "sutdaRetry");
  return {
    winnerIds: winners.map((entry) => entry.player.id),
    durationMs: event && event.durationMs,
    entryCount: event ? event.entries.length : 0,
    hands: event ? event.entries.map((entry) => entry.hand) : [],
    results: event ? event.entries.map((entry) => entry.result) : []
  };
`);
assert(
  threeWayRetryEvent.entryCount === 3 &&
  threeWayRetryEvent.durationMs >= 11000 &&
  threeWayRetryEvent.hands.join(",") === "9땡,알리,독사" &&
  threeWayRetryEvent.results.join(",") === "win,lose,lose",
  "3-way sutda retry event did not include readable results",
  threeWayRetryEvent
);

const readyTimeoutDefaultsToHoldem = run(`
  clearAiTimer();
  clearActionTimer();
  clearAutoHandTimer();
  state = createHand(2, [
    { clientId: "p0", name: "Slow0", stack: 1000, lastSeen: Date.now() },
    { clientId: "p1", name: "Slow1", stack: 1000, lastSeen: Date.now() }
  ]);
  state.players.forEach((player) => {
    player.folded = false;
    player.ready = false;
    player.mode = "sutda";
    player.contribution = 100;
  });
  state.pot = 200;
  state.readyPhase = true;
  state.showdown = false;
  state.street = 4;
  state.currentPlayer = -1;
  scheduleReadyTimer();
  const hadDeadline = Boolean(state.actionDeadline);
  const timeoutMs = state.actionTimeoutMs;
  runReadyTimeout(state.handNumber);
  return {
    hadDeadline,
    timeoutMs,
    readyPhase: state.readyPhase,
    showdown: state.showdown,
    cardsRevealed: state.cardsRevealed,
    modes: state.players.map((player) => player.mode),
    ready: state.players.map((player) => player.ready),
    lastActions: state.players.map((player) => player.lastAction)
  };
`);
assert(
  readyTimeoutDefaultsToHoldem.hadDeadline &&
  readyTimeoutDefaultsToHoldem.timeoutMs === 20000 &&
  readyTimeoutDefaultsToHoldem.showdown === true &&
  readyTimeoutDefaultsToHoldem.readyPhase === false &&
  readyTimeoutDefaultsToHoldem.cardsRevealed === true &&
  readyTimeoutDefaultsToHoldem.modes.every((mode) => mode === "holdem") &&
  readyTimeoutDefaultsToHoldem.ready.every(Boolean) &&
  readyTimeoutDefaultsToHoldem.lastActions.every((action) => action === "홀덤 자동 준비"),
  "showdown choice timeout did not force holdem showdown",
  readyTimeoutDefaultsToHoldem
);

vm.runInContext("clearAiTimer(); clearActionTimer(); clearAutoHandTimer();", ctx);
console.log("betting bug regression tests passed");
