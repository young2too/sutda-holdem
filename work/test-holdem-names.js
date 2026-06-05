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
const cases = [
  ["high", [c("A","♠"), c("K","♥"), c("Q","♦"), c("J","♣"), c("9","♠")], "A하이"],
  ["wheel", [c("A","♠"), c("2","♥"), c("3","♦"), c("4","♣"), c("5","♠")], "5스트레이트"],
  ["broadway", [c("A","♠"), c("K","♥"), c("Q","♦"), c("J","♣"), c("10","♠")], "A스트레이트"],
  ["flush", [c("A","♥"), c("K","♥"), c("9","♥"), c("6","♥"), c("3","♥")], "A플러시"],
  ["straight flush", [c("9","♥"), c("8","♥"), c("7","♥"), c("6","♥"), c("5","♥")], "9스트레이트 플러시"],
  ["four", [c("9","♠"), c("9","♥"), c("9","♦"), c("9","♣"), c("5","♥")], "9포카드"],
  ["full house", [c("9","♠"), c("9","♥"), c("9","♦"), c("5","♣"), c("5","♥")], "9,5풀하우스"],
  ["trips", [c("9","♠"), c("9","♥"), c("9","♦"), c("K","♣"), c("5","♥")], "9트리플"],
  ["two pair", [c("9","♠"), c("9","♥"), c("5","♦"), c("5","♣"), c("K","♥")], "9,5투페어"],
  ["one pair", [c("K","♠"), c("K","♥"), c("A","♦"), c("5","♣"), c("9","♥")], "K원페어"]
];
JSON.stringify(cases.map(([label, cards, expected]) => {
  const actual = scoreFive(cards).name;
  return { label, expected, actual, ok: actual === expected };
}));
`;

const results = JSON.parse(vm.runInContext(script, ctx));
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.ok)) process.exit(1);
