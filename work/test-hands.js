const fs = require("fs");
const vm = require("vm");

const noopNode = {
  textContent: "",
  innerHTML: "",
  value: "6",
  hidden: false,
  disabled: false,
  dataset: {},
  addEventListener() {},
  classList: { toggle() {} }
};
const document = {
  querySelector() { return noopNode; },
  querySelectorAll() { return []; }
};
const ctx = { document, console, Math };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("outputs/game.js", "utf8"), ctx);

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
  ["not straight", [c("A","♠"), c("K","♥"), c("Q","♦"), c("J","♣"), c("9","♠")], "하이카드"],
  ["wheel", [c("A","♠"), c("2","♥"), c("3","♦"), c("4","♣"), c("5","♠")], "스트레이트"],
  ["broadway", [c("A","♠"), c("K","♥"), c("Q","♦"), c("J","♣"), c("10","♠")], "스트레이트"],
  ["flush only", [c("A","♠"), c("K","♠"), c("9","♠"), c("6","♠"), c("3","♠")], "플러시"],
  ["straight flush", [c("9","♥"), c("8","♥"), c("7","♥"), c("6","♥"), c("5","♥")], "스트레이트 플러시"],
  ["four", [c("9","♠"), c("9","♥"), c("9","♦"), c("9","♣"), c("5","♥")], "포카드"],
  ["full house", [c("9","♠"), c("9","♥"), c("9","♦"), c("5","♣"), c("5","♥")], "풀하우스"],
  ["trips", [c("9","♠"), c("9","♥"), c("9","♦"), c("K","♣"), c("5","♥")], "트리플"],
  ["two pair", [c("9","♠"), c("9","♥"), c("5","♦"), c("5","♣"), c("K","♥")], "투페어"],
  ["one pair", [c("9","♠"), c("9","♥"), c("A","♦"), c("5","♣"), c("K","♥")], "원페어"]
];
JSON.stringify(cases.map(([label, cards, expected]) => {
  const actual = scoreFive(cards).name;
  return { label, expected, actual, ok: actual === expected };
}));
`;

const results = JSON.parse(vm.runInContext(script, ctx));
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.ok)) process.exit(1);
