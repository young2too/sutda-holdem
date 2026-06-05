const fs = require("fs");
const vm = require("vm");

const nodes = {};
function node(id) {
  if (!nodes[id]) {
    nodes[id] = {
      textContent: "",
      innerHTML: "",
      value: id === "#playerCount" ? "9" : "holdem",
      hidden: false,
      disabled: false,
      dataset: {},
      addEventListener() {},
      classList: { toggle() {} }
    };
  }
  return nodes[id];
}

const document = {
  querySelector(selector) {
    return node(selector);
  },
  querySelectorAll() {
    return [];
  }
};

const code = fs.readFileSync("outputs/game.js", "utf8");
const ctx = { document, console, Math };
vm.createContext(ctx);
vm.runInContext(code, ctx);

console.log(vm.runInContext(`JSON.stringify({
  players: state.players.length,
  positions: state.players.map((player) => player.position).join(","),
  pot: document.querySelector("#totalPot").textContent,
  street: document.querySelector("#streetLabel").textContent,
  hasPlayers: document.querySelector("#players").innerHTML.includes("UTG+1")
})`, ctx));

console.log(vm.runInContext(`
let guard = 0;
while (!state.readyPhase && !state.showdown && guard < 80) {
  checkCall();
  guard += 1;
}
JSON.stringify({
  guard,
  readyPhase: state.readyPhase,
  showdown: state.showdown,
  street: STREET_NAMES[state.street],
  active: state.players.filter((player) => !player.folded).length
})`, ctx));

console.log(vm.runInContext(`
state.players.filter((player) => !player.folded).forEach((player) => markReady(player.id));
JSON.stringify({
  readyPhase: state.readyPhase,
  showdown: state.showdown,
  street: STREET_NAMES[state.street],
  logHasHoldem: state.log.some((line) => line.includes("홀덤 최고:"))
})`, ctx));
