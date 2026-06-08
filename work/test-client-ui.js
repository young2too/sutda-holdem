const fs = require("fs");

let code = fs.readFileSync("outputs/game.js", "utf8");
code = code
  .slice(0, code.indexOf("function renderShowdownControls"))
  .replace("let snapshot = null;", "var snapshot = null;");

const nodes = {};
global.document = {
  querySelector(selector) {
    if (!nodes[selector]) nodes[selector] = { innerHTML: "", value: "20", textContent: "", disabled: false };
    return nodes[selector];
  },
  querySelectorAll() {
    return [];
  }
};
global.localStorage = {
  getItem() { return ""; },
  setItem() {}
};
global.crypto = {
  randomUUID() { return "client-id"; }
};

eval(code);

function resetControls(state) {
  snapshot = state;
  nodes["#raiseAmount"] = { value: "20" };
  nodes["#raiseAmountLabel"] = { value: "", textContent: "" };
  nodes["#raisePresets"] = { innerHTML: "" };
}

function assert(condition, message, detail) {
  if (!condition) {
    console.error(message, detail || "");
    process.exit(1);
  }
}

resetControls({
  seatId: 2,
  playerCount: 6,
  players: [0, 1, 2, 3, 4, 5].map((id) => ({ id, mine: id === 2, bet: id === 2 ? 10 : 0, stack: 990 })),
  street: 0,
  currentBet: 10,
  pot: 15,
  controls: { canAct: true, canRaise: true, callAmount: 0, minRaiseTo: 20, maxRaiseTo: 1000 }
});

const visualOrder = displayPlayers().map(({ player }) => player.id).join(",");
renderRaisePresets();
const preflopPresets = nodes["#raisePresets"].innerHTML;
const preflopTwoPointFive = presetRaiseTarget("multiple", 2.5);

assert(visualOrder === "2,3,4,5,0,1", "client-relative seating did not put mine first", visualOrder);
assert(preflopPresets.includes("2BB") && preflopPresets.includes("2.5x"), "preflop raise presets are missing expected choices", preflopPresets);
assert(preflopTwoPointFive === 25, "preflop 2.5x target is wrong", preflopTwoPointFive);

resetControls({
  seatId: 0,
  playerCount: 6,
  players: [{ id: 0, mine: true, bet: 0, stack: 1000 }],
  street: 2,
  currentBet: 60,
  pot: 180,
  controls: { canAct: true, canRaise: true, callAmount: 60, minRaiseTo: 120, maxRaiseTo: 1000 }
});

renderRaisePresets();
const postflopPresets = nodes["#raisePresets"].innerHTML;
const postflopThreeX = presetRaiseTarget("multiple", 3);

assert(postflopPresets.includes("1/3") && postflopPresets.includes("3x"), "postflop raise presets are missing expected choices", postflopPresets);
assert(postflopThreeX === 180, "postflop 3x target is wrong", postflopThreeX);

console.log("client UI regression tests passed");
