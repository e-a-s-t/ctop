import { C, D, Y, Z } from "./colors.js";
import { bar, cell, fit, fmt, padVisible, risk } from "./bars.js";
import { providerColor } from "./colors.js";

function providerSourceLabel(session) {
  return session.sourceLabel
    ? `${session.providerTag} ${session.sourceLabel}`
    : session.providerTag;
}

function sourceCell(session, width) {
  const value = fit(providerSourceLabel(session), width);
  const color = providerColor(session.providerTag);
  return color === Z ? value : `${color}${value}${Z}`;
}

function sessionNameCell(session, width) {
  const meta = [];
  if (!session.usageAvailable && session.provider === "copilot" && session.messageCount > 0) {
    meta.push(`msg:${session.messageCount}`);
  }
  if (!session.usageAvailable && session.provider === "copilot" && session.requestCount > 0) {
    meta.push(`req:${session.requestCount}`);
  }
  const suffix = meta.length > 0 ? ` ${meta.join(" ")}` : "";
  return `${D}${fit(`${session.name}${suffix}`, width)}${Z}`;
}

function sessionUsageCell(value, available, width) {
  if (!available) return padVisible(`${D}--${Z}`, width, "right");
  return padVisible(fmt(value), width, "right");
}

function sessionBarCell(session, max, width = 16) {
  if (!session.usageAvailable) return `${D}${"·".repeat(width)}${Z}`;
  return bar(session, max, width);
}

export function renderSessionMetrics(s, max, options = {}) {
  const warnTokens = options.warnTokens ?? 2_000_000;

  if (s.usageAvailable) {
    return (
      `${bar(s, max)} ${fmt(s.total).padStart(5)} ` +
      `I:${fmt(s.input)} O:${fmt(s.output)} C:${fmt(s.cacheRead)} R:${fmt(s.reasoning)} ${risk(s, warnTokens)}`
    );
  }

  const usage = [];
  if (s.provider === "copilot" && s.messageCount > 0) usage.push(`msg:${s.messageCount}`);
  if (s.provider === "copilot" && s.requestCount > 0) usage.push(`req:${s.requestCount}`);
  const extra = usage.length > 0 ? ` ${usage.join(" ")}` : "";
  return `${D}${"·".repeat(16)}${Z} ${"--".padStart(5)} I:-- O:-- C:-- R:-- ?${extra}`;
}

export function renderSessionLine(s, max) {
  const credit = s.creditAvailable ? s.credits.toFixed(2) : "--";
  return [
    `${C}${fit(s.time, 5)}${Z}`,
    sourceCell(s, 9),
    fit(s.model, 8),
    sessionBarCell(s, max),
    sessionUsageCell(s.total, s.usageAvailable, 6),
    sessionUsageCell(s.input, s.usageAvailable, 6),
    sessionUsageCell(s.output, s.usageAvailable, 6),
    sessionUsageCell(s.cacheRead, s.usageAvailable, 6),
    sessionUsageCell(s.reasoning, s.usageAvailable, 6),
    sessionNameCell(s, 18),
    padVisible(s.creditAvailable ? `${Y}${credit}${Z}` : `${D}--${Z}`, 8, "right"),
  ].join(" ");
}

export function renderSessionHeader() {
  const columns = [
    ["TIME", 5, "left"],
    ["SRC", 9, "left"],
    ["MODEL", 8, "left"],
    ["BAR", 16, "left"],
    ["TOTAL", 6, "right"],
    ["INPUT", 6, "right"],
    ["OUTPUT", 6, "right"],
    ["CACHE", 6, "right"],
    ["REASON", 6, "right"],
    ["SESSION", 18, "left"],
    ["CREDITS", 8, "right"],
  ];

  return `${D}${columns.map(([label, width, align]) => fit(label, width, align)).join(" ")}${Z}`;
}

export function renderSessionsSection({ date, sessions, width, lookbackDays }) {
  const max = Math.max(...sessions.map((s) => s.total), 1);
  const lines = [renderSessionHeader()];

  if (sessions.length === 0) {
    lines.push(`No active usage found for ${date} within last ${lookbackDays} day(s)`);
  } else {
    for (const session of sessions) {
      lines.push(renderSessionLine(session, max));
    }
  }

  return lines.map((line) => `│ ${cell(line, width)} │`);
}
