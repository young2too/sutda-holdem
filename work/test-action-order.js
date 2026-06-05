const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("outputs/server.js", "utf8").replace(/server\.listen[\s\S]*$/, "");
const ctx = { console, require, Buffer, process: { env: {} }, __dirname: "outputs", setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(code, ctx);

function runScenario(name, previousPlayers, expected) {
  const result = vm.runInContext(`
(() => {
clearAiTimer();
clearActionTimer();
handNumber = 1;
state = createHand(6, ${JSON.stringify(previousPlayers)});
const initialPositions = state.players.map((player) => player.position);
const positionCount = state.positionCount;
const firstActor = state.players[state.currentPlayer] ? state.players[state.currentPlayer].position : "";
const preflopOrder = [];
while (state.street === 0 && preflopOrder.length < 10) {
  const player = state.players[state.currentPlayer];
  preflopOrder.push(player.position);
  checkCall(player);
}
const flopFirst = state.players[state.currentPlayer] ? state.players[state.currentPlayer].position : "";
const postflopOrder = [];
while (state.street === 1 && postflopOrder.length < 10) {
  const player = state.players[state.currentPlayer];
  postflopOrder.push(player.position);
  checkCall(player);
}
return JSON.stringify({
  initialPositions,
  positionCount,
  firstActor,
  preflopOrder,
  flopFirst,
  postflopOrder
});
})()
`, ctx);
  const parsed = JSON.parse(result);
  console.log(name, JSON.stringify(parsed, null, 2));
  if (parsed.positionCount !== expected.positionCount) process.exit(1);
  if (expected.seat0 && parsed.initialPositions[0] !== expected.seat0) process.exit(1);
  if (parsed.firstActor !== expected.firstActor) process.exit(1);
  if (parsed.preflopOrder.join(",") !== expected.preflopOrder.join(",")) process.exit(1);
  if (parsed.flopFirst !== expected.flopFirst) process.exit(1);
  if (parsed.postflopOrder.join(",") !== expected.postflopOrder.join(",")) process.exit(1);
}

const fullTable = Array.from({ length: 6 }, (_, index) => ({
  clientId: index === 0 ? "human" : null,
  ai: index !== 0,
  name: index === 0 ? "Human" : "AI " + index,
  stack: 1000,
  lastSeen: Date.now()
}));

const headsUpOnSixSeatTable = Array.from({ length: 6 }, (_, index) => ({
  clientId: index === 0 ? "human" : (index === 1 ? "villain" : null),
  ai: false,
  name: index === 0 ? "Human" : (index === 1 ? "Villain" : ""),
  stack: 1000,
  lastSeen: Date.now()
}));

function occupiedOnSixSeatTable(count) {
  return Array.from({ length: 6 }, (_, index) => ({
    clientId: index < count ? `p${index}` : null,
    ai: false,
    name: index < count ? `P${index}` : "",
    stack: 1000,
    lastSeen: Date.now()
  }));
}

runScenario("6 occupied", fullTable, {
  positionCount: 6,
  seat0: "BB",
  firstActor: "UTG",
  preflopOrder: ["UTG", "MP", "CO", "BTN", "SB", "BB"],
  flopFirst: "SB",
  postflopOrder: ["SB", "BB", "UTG", "MP", "CO", "BTN"]
});

runScenario("2 occupied on 6-seat table", headsUpOnSixSeatTable, {
  positionCount: 2,
  seat0: "BB",
  firstActor: "SB",
  preflopOrder: ["SB", "BB"],
  flopFirst: "BB",
  postflopOrder: ["BB", "SB"]
});

runScenario("3 occupied on 6-seat table", occupiedOnSixSeatTable(3), {
  positionCount: 3,
  seat0: "BB",
  firstActor: "BTN",
  preflopOrder: ["BTN", "SB", "BB"],
  flopFirst: "SB",
  postflopOrder: ["SB", "BB", "BTN"]
});

runScenario("4 occupied on 6-seat table", occupiedOnSixSeatTable(4), {
  positionCount: 4,
  seat0: "BB",
  firstActor: "UTG",
  preflopOrder: ["UTG", "BTN", "SB", "BB"],
  flopFirst: "SB",
  postflopOrder: ["SB", "BB", "UTG", "BTN"]
});

runScenario("5 occupied on 6-seat table", occupiedOnSixSeatTable(5), {
  positionCount: 5,
  seat0: "BB",
  firstActor: "UTG",
  preflopOrder: ["UTG", "CO", "BTN", "SB", "BB"],
  flopFirst: "SB",
  postflopOrder: ["SB", "BB", "UTG", "CO", "BTN"]
});
