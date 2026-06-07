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
    month: rank === "A" ? 1 : Number(rank),
    value: rank === "A" ? 14 : Number(rank)
  };
}
JSON.stringify([
  ["A heart + 8 heart", evaluateSutdaPair(c("A", "♥"), c("8", "♥")).name, "9끗"],
  ["A heart + 8 spade", evaluateSutdaPair(c("A", "♥"), c("8", "♠")).name, "9끗"],
  ["A spade + 8 spade", evaluateSutdaPair(c("A", "♠"), c("8", "♠")).name, "18광땡"],
  ["3 spade + 8 spade", evaluateSutdaPair(c("3", "♠"), c("8", "♠")).name, "38광땡"],
  ["3 club + 8 spade", evaluateSutdaPair(c("3", "♣"), c("8", "♠")).name, "1끗"],
  ["3 gwang + 7 boar", evaluateSutdaPair(c("3", "♠"), c("7", "♠")).name, "땡잡이"],
  ["3 ribbon + 7 boar", evaluateSutdaPair(c("3", "♥"), c("7", "♠")).name, "0끗"],
  ["4 bird + 7 boar", evaluateSutdaPair(c("4", "♠"), c("7", "♠")).name, "암행어사"],
  ["4 ribbon + 7 boar", evaluateSutdaPair(c("4", "♥"), c("7", "♠")).name, "1끗"],
  ["4 bird + 9 animal", evaluateSutdaPair(c("4", "♠"), c("9", "♠")).name, "멍사구"],
  ["4 ribbon + 9 animal", evaluateSutdaPair(c("4", "♥"), c("9", "♠")).name, "사구"],
  ["4 ddang is not sagu", evaluateSutdaPair(c("4", "♠"), c("4", "♥")).name, "4땡"],
  ["9 ddang is not sagu", evaluateSutdaPair(c("9", "♠"), c("9", "♥")).name, "9땡"],
  ["ttang catcher beats 9ddang", compareSutdaValues(evaluateSutdaPair(c("3", "♠"), c("7", "♠")), evaluateSutdaPair(c("9", "♠"), c("9", "♥"))) > 0 ? "win" : "lose", "win"],
  ["ttang catcher loses to jangddang", compareSutdaValues(evaluateSutdaPair(c("3", "♠"), c("7", "♠")), evaluateSutdaPair(c("10", "♠"), c("10", "♥"))) < 0 ? "lose" : "win", "lose"],
  ["spy beats 18gwang", compareSutdaValues(evaluateSutdaPair(c("4", "♠"), c("7", "♠")), evaluateSutdaPair(c("A", "♠"), c("8", "♠"))) > 0 ? "win" : "lose", "win"],
  ["spy loses 38gwang", compareSutdaValues(evaluateSutdaPair(c("4", "♠"), c("7", "♠")), evaluateSutdaPair(c("3", "♠"), c("8", "♠"))) < 0 ? "lose" : "win", "lose"]
]);
`;

const results = JSON.parse(vm.runInContext(script, ctx)).map(([label, actual, expected]) => ({
  label,
  actual,
  expected,
  ok: actual === expected
}));

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.ok)) process.exit(1);

const retryScript = `
function c(rank, suit) {
  return {
    id: rank + suit,
    rank,
    suit,
    month: rank === "A" ? 1 : Number(rank),
    value: rank === "A" ? 14 : Number(rank)
  };
}
shuffle = (cards) => [c("9", "♠"), c("9", "♥"), c("A", "♠"), c("2", "♠"), ...cards];
const p1 = { id: 1, name: "Sutda", position: "UTG", mode: "sutda" };
const p2 = { id: 2, name: "Swing", position: "MP", mode: "swing" };
const logs = [];
const initial = [
  { player: p1, hand: evaluateSutdaPair(c("4", "♥"), c("9", "♠")) },
  { player: p2, hand: evaluateSutdaPair(c("A", "♥"), c("2", "♥")) }
];
const winners = resolveSutdaRetry(initial, bestEntries(initial, "hand", compareSutdaValues), logs);
JSON.stringify({
  winner: winners.map((entry) => entry.player.name).join(","),
  log: logs.join(" | ")
});
`;

const retryResult = JSON.parse(vm.runInContext(retryScript, ctx));
console.log(JSON.stringify(retryResult, null, 2));
if (retryResult.winner !== "Sutda" || !retryResult.log.includes("2장 재경기")) process.exit(1);

const selectedBoardScript = `
function c(rank, suit) {
  return {
    id: rank + suit,
    rank,
    suit,
    month: rank === "A" ? 1 : Number(rank),
    value: rank === "A" ? 14 : Number(rank)
  };
}
state.community = [c("4", "♠"), c("6", "♠")];
const player = { mode: "sutda", cards: [c("9", "♠"), c("9", "♥")], sutdaCard: "9♠", sutdaBoardCard: "4♠" };
JSON.stringify({
  selected: evaluateSutdaPlayer(player).name,
  auto: evaluateSutdaFromCard(player.cards[0]).name
});
`;

const selectedBoardResult = JSON.parse(vm.runInContext(selectedBoardScript, ctx));
console.log(JSON.stringify(selectedBoardResult, null, 2));
if (selectedBoardResult.selected !== "멍사구" || selectedBoardResult.auto === "멍사구") process.exit(1);

const retryBoundaryScript = `
function hand(score, name, extra = {}) {
  return { score, kickers: [], name, ...extra };
}
function retryAgainst(retryType, opponent) {
  return shouldRetrySutda([
    { player: { name: retryType }, hand: { score: 0, kickers: [], name: retryType, retryType } },
    { player: { name: opponent.name }, hand: opponent }
  ]);
}
JSON.stringify([
  ["mung sagu retries against 9ddang", retryAgainst("mungSagu", hand(809, "9땡", { group: "ddang" })), true],
  ["mung sagu loses to jangddang", retryAgainst("mungSagu", hand(810, "장땡", { group: "ddang" })), false],
  ["mung sagu loses to 18gwang", retryAgainst("mungSagu", hand(880, "18광땡", { group: "gwang" })), false],
  ["mung sagu loses to 38gwang", retryAgainst("mungSagu", hand(900, "38광땡", { group: "gwang" })), false],
  ["sagu retries against ali", retryAgainst("sagu", hand(760, "알리")), true],
  ["sagu loses to 1ddang", retryAgainst("sagu", hand(801, "1땡", { group: "ddang" })), false],
  ["sagu loses to 9ddang", retryAgainst("sagu", hand(809, "9땡", { group: "ddang" })), false],
  ["sagu loses to jangddang", retryAgainst("sagu", hand(810, "장땡", { group: "ddang" })), false]
]);
`;

const retryBoundaryResults = JSON.parse(vm.runInContext(retryBoundaryScript, ctx)).map(([label, actual, expected]) => ({
  label,
  actual,
  expected,
  ok: actual === expected
}));

console.log(JSON.stringify(retryBoundaryResults, null, 2));
if (retryBoundaryResults.some((result) => !result.ok)) process.exit(1);
