const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const spritePath = path.join(root, "outputs", "assets", "hwaturump.webp");
const outDir = path.join(root, "outputs", "assets", "cards");
const tmpDir = path.join(root, "work", "card-crop-html");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q"];
const suits = [
  ["spade", "s"],
  ["heart", "h"],
  ["diamond", "d"],
  ["club", "c"]
];

const sheet = { width: 1240, height: 6110 };
const card = { width: 250, height: 360 };
const grid = { x: 70, y: 82, stepX: 276, stepY: 402 };
const kings = { x: 63, y: 5064, stepX: 282 };
const extras = [
  { name: "joker_red", x: 62, y: 5554 },
  { name: "joker_black", x: 344, y: 5554 },
  { name: "back", x: 626, y: 5554 }
];

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

const jobs = [];
for (let row = 0; row < ranks.length; row += 1) {
  for (let col = 0; col < suits.length; col += 1) {
    jobs.push({
      name: `${ranks[row]}_${suits[col][0]}`,
      x: grid.x + col * grid.stepX,
      y: grid.y + row * grid.stepY
    });
  }
}
for (let col = 0; col < suits.length; col += 1) {
  jobs.push({
    name: `K_${suits[col][0]}`,
    x: kings.x + col * kings.stepX,
    y: kings.y
  });
}
jobs.push(...extras);

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/").replace(/ /g, "%20")}`;
}

for (const job of jobs) {
  const htmlPath = path.join(tmpDir, `${job.name}.html`);
  const outPath = path.join(outDir, `${job.name}.png`);
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;width:${card.width}px;height:${card.height}px;overflow:hidden;background:transparent}
img{position:absolute;left:-${job.x}px;top:-${job.y}px;width:${sheet.width}px;height:${sheet.height}px;max-width:none}
</style>
</head>
<body><img src="${fileUrl(spritePath)}"></body>
</html>`;
  fs.writeFileSync(htmlPath, html);

  const result = spawnSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${card.width},${card.height}`,
    `--screenshot=${outPath}`,
    fileUrl(htmlPath)
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log(`Wrote ${jobs.length} card images to ${outDir}`);
