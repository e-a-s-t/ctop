import { collectUsageTotals } from "../providers/index.js";
import { cell, displayModel, fmt, padVisible } from "./bars.js";
import { D, Y, Z } from "./colors.js";

function tinyHeader() {
  return `${D}${[
    padVisible("TIME", 5),
    padVisible("MODEL", 8),
    padVisible("TOTAL", 7, "right"),
    padVisible("SESSION", 18),
    padVisible("CREDITS", 8, "right"),
  ].join(" ")}${Z}`;
}

function tinySessionLine(session) {
  const total = session.usageAvailable ? fmt(session.total) : "--";
  const credits = session.creditAvailable ? session.credits.toFixed(2) : "--";

  return [
    padVisible(session.time, 5),
    padVisible(displayModel(session.model), 8),
    padVisible(total, 7, "right"),
    padVisible(`${D}${session.name}${Z}`, 18),
    padVisible(
      session.creditAvailable ? `${Y}${credits}${Z}` : `${D}--${Z}`,
      8,
      "right",
    ),
  ].join(" ");
}

function tinyTotalLine(sessions) {
  const totals = collectUsageTotals(sessions);

  return [
    padVisible("Σ", 5),
    padVisible("", 8),
    padVisible(fmt(totals.total), 7, "right"),
    padVisible("", 18),
    padVisible(`${Y}${totals.credits.toFixed(2)}${Z}`, 8, "right"),
  ].join(" ");
}

export function renderTinyDashboard({
  date,
  width,
  sessions,
  lookbackDays,
  limit = 5,
  partialData,
}) {
  const latestSessions = [...sessions]
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, limit)
    .reverse();

  const lineWidth = 5 + 1 + 8 + 1 + 7 + 1 + 18 + 1 + 8;

  const lines = [
    `CTop ${date} tiny latest ${limit}`,
    "─".repeat(lineWidth),
    tinyHeader(),
  ];

  if (latestSessions.length === 0) {
    lines.push(
      `No active usage found for ${date} within last ${lookbackDays} day(s)`,
    );
  } else {
    lines.push(...latestSessions.map(tinySessionLine));
    lines.push("─".repeat(lineWidth));
    lines.push(tinyTotalLine(sessions));
  }

  if (partialData) {
    lines.push(
      `${Y}Note:${Z} totals partial; some Copilot usage/credits unavailable`,
    );
  }

  return `\x1Bc${lines.map((line) => cell(line, Math.min(width, lineWidth))).join("\n")}\n`;
}
