import { B, D, G, M, X, Y, Z } from "./colors.js";
import { cell } from "./bars.js";
import { renderPeriodLines } from "./periods.js";
import { renderSessionsSection } from "./sessions.js";

export function renderDashboard({
  date,
  width,
  lookbackDays,
  sessions,
  weekSessions,
  monthSessions,
  partialData,
  codexWeeklyLimit,
  codexMonthlyLimit,
}) {
  const lines = [
    "╭" + "─".repeat(width + 2) + "╮",
    `│ ${cell(`CTop ${date}  ACTIVE TODAY  ${B}in${Z} ${G}out${Z} ${X}cache${Z} ${M}create${Z}`, width)} │`,
    "├" + "─".repeat(width + 2) + "┤",
    ...renderSessionsSection({ date, sessions, width, lookbackDays }),
    "├" + "─".repeat(width + 2) + "┤",
    ...renderPeriodLines("Daily", sessions).map((line) => `│ ${cell(line, width)} │`),
    "├" + "─".repeat(width + 2) + "┤",
    ...renderPeriodLines("Week", weekSessions, {
      codexWeeklyLimit,
    }).map((line) => `│ ${cell(line, width)} │`),
    "├" + "─".repeat(width + 2) + "┤",
    ...renderPeriodLines("Month", monthSessions, {
      codexMonthlyLimit,
    }).map((line) => `│ ${cell(line, width)} │`),
  ];

  if (partialData) {
    lines.push(
      "├" + "─".repeat(width + 2) + "┤",
      `│ ${cell(`${Y}Note:${Z} totals partial; some Copilot usage/credits unavailable`, width)} │`,
    );
  }

  lines.push("╰" + "─".repeat(width + 2) + "╯");

  return `\x1Bc${lines.join("\n")}\n`;
}
