const counts = [6, 7, 8, 9];
const viewports = [
  { width: 390, height: 844 },
  { width: 690, height: 760 }
];

const panelModes = {
  normal: {
    opponent: { width: 90, height: 58 },
    mine: { width: 148, height: 130 }
  },
  showdown: {
    opponent: { width: 90, height: 62 },
    mine: { width: 148, height: 130 }
  }
};

const slots = {
  6: { 0: [2, 5], 1: [1, 4], 2: [1, 2], 3: [2, 1], 4: [3, 2], 5: [3, 4] },
  7: { 0: [2, 5], 1: [1, 4], 2: [1, 3], 3: [1, 2], 4: [3, 2], 5: [3, 3], 6: [3, 4] },
  8: { 0: [2, 5], 1: [1, 4], 2: [1, 3], 3: [1, 2], 4: [2, 1], 5: [3, 2], 6: [3, 3], 7: [3, 4] },
  9: { 0: [2, 5], 1: [1, 4], 2: [1, 3], 3: [1, 2], 4: [1, 1], 5: [3, 1], 6: [3, 2], 7: [3, 3], 8: [3, 4] }
};

function stageFor(viewport) {
  const shell = { x: 6, y: 6, width: viewport.width - 12, height: viewport.height - 12 };
  const reserved = { top: 134, bottom: 136 };
  return {
    x: shell.x + 7,
    y: shell.y + reserved.top,
    width: shell.width - 14,
    height: shell.height - reserved.top - reserved.bottom
  };
}

function gridFor(stage) {
  const padding = { left: 8, right: 8, top: 8, bottom: 2 };
  const gapY = 4;
  const colWidths = [96, stage.width - padding.left - padding.right - 192, 96];
  const fixedRows = [54, 68, 68, 132];
  const row3 = Math.max(36, stage.height - padding.top - padding.bottom - fixedRows.reduce((a, b) => a + b, 0) - gapY * 4);
  const rowHeights = [54, 68, row3, 68, 132];
  const x0 = stage.x + padding.left;
  const y0 = stage.y + padding.top;
  const cols = [
    { left: x0, width: colWidths[0] },
    { left: x0 + colWidths[0], width: colWidths[1] },
    { left: x0 + colWidths[0] + colWidths[1], width: colWidths[2] }
  ];
  let y = y0;
  const rows = rowHeights.map((height) => {
    const row = { top: y, height };
    y += height + gapY;
    return row;
  });
  return { cols, rows };
}

function rectFor(stage, count, id, mode) {
  const [colNumber, rowNumber] = slots[count][id];
  const grid = gridFor(stage);
  const cell = {
    left: grid.cols[colNumber - 1].left,
    top: grid.rows[rowNumber - 1].top,
    width: grid.cols[colNumber - 1].width,
    height: grid.rows[rowNumber - 1].height
  };
  const type = id === 0 ? "mine" : "opponent";
  const size = panelModes[mode][type];
  const centerX = cell.left + cell.width / 2;
  const centerY = cell.top + cell.height / 2;
  return {
    left: centerX - size.width / 2,
    right: centerX + size.width / 2,
    top: centerY - size.height / 2,
    bottom: centerY + size.height / 2
  };
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function check(viewport, count, mode) {
  const stage = stageFor(viewport);
  const rects = Array.from({ length: count }, (_, id) => ({ id, rect: rectFor(stage, count, id, mode) }));
  const outOfBounds = rects.filter(({ rect }) => (
    rect.left < stage.x || rect.right > stage.x + stage.width || rect.top < stage.y || rect.bottom > stage.y + stage.height
  ));
  const overlaps = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (intersects(rects[i].rect, rects[j].rect)) overlaps.push([rects[i].id, rects[j].id]);
    }
  }
  return { viewport, count, mode, outOfBounds, overlaps };
}

const results = viewports.flatMap((viewport) => counts.flatMap((count) => [
  check(viewport, count, "normal"),
  check(viewport, count, "showdown")
]));

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.outOfBounds.length || result.overlaps.length)) process.exit(1);
