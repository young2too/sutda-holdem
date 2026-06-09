const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("outputs/server.js", "utf8").replace(/server\.listen[\s\S]*$/, "");
const ctx = { console, require, Buffer, process: { env: {} }, __dirname: "outputs" };
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

const helpers = `
  const spade = String.fromCharCode(0x2660);
  const heart = String.fromCharCode(0x2665);
  const diamond = String.fromCharCode(0x2666);
  const club = String.fromCharCode(0x2663);
  function c(rank, suit) {
    return {
      id: rank + suit,
      rank,
      suit,
      month: rank === "A" ? 1 : rank === "J" ? 11 : rank === "Q" ? 12 : rank === "K" ? null : Number(rank),
      value: rank === "A" ? 14 : rank === "K" ? 13 : rank === "Q" ? 12 : rank === "J" ? 11 : Number(rank)
    };
  }
  function player(id, name) {
    return { id, name, position: ["UTG", "MP", "CO"][id], mode: "sutda" };
  }
  function initialSaguVsAli() {
    return [
      { player: player(0, "Sagu"), hand: evaluateSutdaPair(c("4", heart), c("9", spade)) },
      { player: player(1, "Ali"), hand: evaluateSutdaPair(c("A", heart), c("2", heart)) }
    ];
  }
`;

const spyBeats18InReroll = run(`
  ${helpers}
  const fixed = [c("4", spade), c("7", spade), c("A", spade), c("8", spade)];
  shuffle = (cards) => [...fixed, ...cards.filter((card) => !fixed.some((item) => item.id === card.id))];
  const logs = [];
  const contest = resolveSutdaContest(initialSaguVsAli(), logs);
  return {
    winner: contest.winners[0].player.name,
    winnerHand: contest.winners[0].hand.name,
    retryCount: logs.filter((line) => line.includes("재경기 섯다")).length
  };
`);
assert(
  spyBeats18InReroll.winner === "Sagu" &&
    spyBeats18InReroll.winnerHand === "암행어사" &&
    spyBeats18InReroll.retryCount === 1,
  "spy should beat 18 gwang in reroll",
  spyBeats18InReroll
);

const spyLoses38InReroll = run(`
  ${helpers}
  const fixed = [c("4", spade), c("7", spade), c("3", spade), c("8", spade)];
  shuffle = (cards) => [...fixed, ...cards.filter((card) => !fixed.some((item) => item.id === card.id))];
  const contest = resolveSutdaContest(initialSaguVsAli(), []);
  return { winner: contest.winners[0].player.name, winnerHand: contest.winners[0].hand.name };
`);
assert(
  spyLoses38InReroll.winner === "Ali" && spyLoses38InReroll.winnerHand === "38광땡",
  "spy should lose to 38 gwang in reroll",
  spyLoses38InReroll
);

const rerollSaguTriggersAgain = run(`
  ${helpers}
  let round = 0;
  shuffle = (cards) => {
    round += 1;
    const fixed = round === 1
      ? [c("4", heart), c("9", spade), c("A", heart), c("2", heart)]
      : [c("5", heart), c("4", heart), c("9", spade), c("10", heart)];
    return [...fixed, ...cards.filter((card) => !fixed.some((item) => item.id === card.id))];
  };
  const logs = [];
  const contest = resolveSutdaContest(initialSaguVsAli(), logs);
  return {
    round,
    winner: contest.winners[0].player.name,
    winnerHand: contest.winners[0].hand.name,
    retryCount: logs.filter((line) => line.includes("재경기 섯다")).length
  };
`);
assert(
  rerollSaguTriggersAgain.round === 2 &&
    rerollSaguTriggersAgain.retryCount === 2 &&
    rerollSaguTriggersAgain.winner === "Ali" &&
    rerollSaguTriggersAgain.winnerHand === "9끗",
  "sagu inside reroll should trigger another reroll",
  rerollSaguTriggersAgain
);

console.log("sutda reroll edge tests passed");
