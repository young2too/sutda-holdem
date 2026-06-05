const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("outputs/server.js", "utf8").replace(/server\.listen[\s\S]*$/, "");
const ctx = { console, require, Buffer, process: { env: {} }, __dirname: "outputs" };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const script = `
function c(rank, suit) {
  return {
    id: rank + suit,
    rank,
    suit,
    month: rank === "A" ? 1 : rank === "J" ? 11 : rank === "Q" ? 12 : rank === "K" ? null : Number(rank),
    value: rank === "A" ? 14 : rank === "K" ? 13 : rank === "Q" ? 12 : rank === "J" ? 11 : Number(rank)
  };
}

function resetState(players, community, pot) {
  state = {
    deck: [],
    community,
    playerCount: players.length,
    handNumber: 99,
    street: 5,
    currentPlayer: -1,
    currentBet: 0,
    pot,
    lastRaise: 10,
    readyPhase: false,
    showdown: false,
    players,
    result: null,
    events: [],
    eventId: 0,
    log: []
  };
}

function p(id, name, mode, cards, sutdaCard) {
  return {
    id,
    name,
    position: id === 0 ? "UTG" : "MP",
    clientId: id === 0 ? "human" : null,
    ai: id !== 0,
    stack: 1000,
    bet: 0,
    streetBet: 0,
    acted: true,
    folded: false,
    ready: true,
    lastAction: "",
    cards,
    mode,
    sutdaCard
  };
}

const retryDeckCards = [c("9", "♠"), c("9", "♥"), c("A", "♠"), c("2", "♠")];
shuffle = (cards) => [...retryDeckCards, ...cards.filter((card) => !retryDeckCards.some((fixed) => fixed.id === card.id))];

const board = [c("9", "♠"), c("A", "♦"), c("K", "♣"), c("Q", "♦"), c("J", "♣")];
const swing49 = p(0, "Swing49", "swing", [c("4", "♥"), c("A", "♣")], "4♥");
const sutdaAli = p(1, "SutdaAli", "sutda", [c("2", "♥"), c("K", "♥")], "2♥");
resetState([swing49, sutdaAli], board, 100);
const result = settlePots();

JSON.stringify({
  log: result.logs,
  awards: result.awards,
  swingStack: state.players[0].stack,
  sutdaStack: state.players[1].stack
});
`;

const result = JSON.parse(vm.runInContext(script, ctx));
console.log(JSON.stringify(result, null, 2));

const joinedLog = result.log.join(" | ");
const hasRetry = joinedLog.includes("2장 재경기");
const hasRetryCards = joinedLog.includes("Swing49 UTG 9♠+9♥ 9땡") && joinedLog.includes("SutdaAli MP A♠+2♠ 알리");
const swingAward = result.awards.find((award) => award.label === "스윙");

if (!hasRetry || !hasRetryCards || !swingAward || swingAward.amount !== 100 || result.swingStack !== 1100 || result.sutdaStack !== 1000) {
  process.exit(1);
}
