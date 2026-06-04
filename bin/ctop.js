#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  collectSessionsForDate,
  collectProviderTotals,
  collectUsageTotals,
  hasPartialData,
} from "../lib/providers.js";

const args = process.argv.slice(2);

function arg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Codex Usage Dashboard

Usage:
  codex-usage [options]

Options:
  -h, --help              Show help
  --date YYYY-MM-DD       Show specific date
  --refresh SECONDS       Refresh interval, default 2
  --warn-tokens NUMBER    Warning threshold, default 2000000
  --lookback-days NUMBER  Scan recent session folders, default 14

Environment:
  AI_USAGE_DATE
  AI_USAGE_REFRESH
  AI_USAGE_WARN_TOKENS
  AI_USAGE_LOOKBACK_DAYS

Data:
  ~/.codex/sessions/YYYY/MM/DD/*.jsonl
  ~/.copilot/session-state/<id>/workspace.yaml
  ~/.copilot/logs/process-*.log

Mode:
  Active Today - counts usage activity on the selected date,
  even if the session file was created yesterday.
`);
  process.exit(0);
}

const R = "\x1b[31m",
  Y = "\x1b[33m",
  G = "\x1b[32m",
  C = "\x1b[36m";
const B = "\x1b[34m",
  M = "\x1b[35m",
  X = "\x1b[90m",
  D = "\x1b[2m",
  Z = "\x1b[0m";

const WIDTH = Math.max(
  100,
  process.stdout.columns ? process.stdout.columns - 4 : 120,
);
const HOME = os.homedir();

const WARN_TOKENS = Number(
  arg("--warn-tokens") ?? process.env.AI_USAGE_WARN_TOKENS ?? "2000000",
);
const REFRESH = Number(arg("--refresh") ?? process.env.AI_USAGE_REFRESH ?? "2");
const LOOKBACK_DAYS = Number(
  arg("--lookback-days") ?? process.env.AI_USAGE_LOOKBACK_DAYS ?? "14",
);

function currentDate() {
  return (
    arg("--date") ??
    process.env.AI_USAGE_DATE ??
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  );
}

function localDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function localTime(ts) {
  if (!ts) return "--:--";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--";

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function dateMinus(date, days) {
  const d = new Date(`${date}T12:00:00+02:00`);
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function datePlus(date, days) {
  const d = new Date(`${date}T12:00:00+02:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function weekStart(date) {
  const d = new Date(`${date}T12:00:00+02:00`);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function monthStart(date) {
  const [yy, mm] = date.split("-");
  return `${yy}-${mm}-01`;
}

function monthEnd(date) {
  const [yy, mm] = date.split("-").map(Number);
  const d = new Date(Date.UTC(yy, mm, 0, 12, 0, 0));
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function weekEnd(date) {
  return datePlus(weekStart(date), 6);
}

function strip(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function cell(s) {
  return s + " ".repeat(Math.max(0, WIDTH - strip(s).length));
}

function rightCredit(left, credits) {
  const right = `cr:${credits.toFixed(2)}`;
  const spaces = WIDTH - strip(left).length - right.length;
  return left + " ".repeat(Math.max(1, spaces)) + right;
}

function rightCreditLabel(left, creditLabel) {
  const right = `cr:${creditLabel}`;
  const spaces = WIDTH - strip(left).length - right.length;
  return left + " ".repeat(Math.max(1, spaces)) + right;
}

function padVisible(value, width, align = "left") {
  const text = `${value}`;
  const spaces = " ".repeat(Math.max(0, width - strip(text).length));
  return align === "right" ? spaces + text : text + spaces;
}

function providerSourceLabel(session) {
  return session.sourceLabel
    ? `${session.providerTag} ${session.sourceLabel}`
    : session.providerTag;
}

function fmt(n = 0) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

function bar(s, max, width = 16) {
  const used = max > 0 ? Math.max(1, Math.round((s.total / max) * width)) : 0;
  const parts = [
    [B, s.input],
    [G, s.output],
    [X, s.cacheRead],
    [M, s.cacheCreate],
  ];

  let res = "";
  let left = used;

  for (const [color, value] of parts) {
    const len = s.total > 0 ? Math.round((value / s.total) * used) : 0;
    const actual = Math.min(len, left);

    if (actual > 0) {
      res += color + "█".repeat(actual) + Z;
      left -= actual;
    }
  }

  if (left > 0) res += "█".repeat(left);
  if (used < width) res += D + "░".repeat(width - used) + Z;

  return res;
}

function risk(s) {
  if (s.total >= WARN_TOKENS) return `${R}🔥${Z}`;
  if (s.total >= WARN_TOKENS * 0.7) return `${Y}⚠${Z}`;
  return `${G}●${Z}`;
}

export function renderSessionMetrics(s, max) {
  if (s.usageAvailable) {
    return (
      `${bar(s, max)} ${fmt(s.total).padStart(5)} ` +
      `I:${fmt(s.input)} O:${fmt(s.output)} C:${fmt(s.cacheRead)} R:${fmt(s.reasoning)} ${risk(s)}`
    );
  }

  const usage = [];
  if (s.provider === "copilot" && s.messageCount > 0) usage.push(`msg:${s.messageCount}`);
  if (s.provider === "copilot" && s.requestCount > 0) usage.push(`req:${s.requestCount}`);
  const extra = usage.length > 0 ? ` ${usage.join(" ")}` : "";
  return `${D}${"·".repeat(16)}${Z} ${"--".padStart(5)} I:-- O:-- C:-- R:-- ?${extra}`;
}

export function renderSessionLine(s, max) {
  const metrics = renderSessionMetrics(s, max);
  const credit = s.creditAvailable ? s.credits.toFixed(2) : "--";
  const left =
    `${C}${s.time}${Z} ${providerSourceLabel(s).padEnd(9)} ${s.model.padEnd(8).slice(0, 8)} ` +
    `${metrics} ${D}${s.name}${Z}`;

  return rightCreditLabel(left, credit);
}

function collectSessionsForRange(startDate, endDate) {
  const sessions = [];

  for (let date = startDate; date <= endDate; date = datePlus(date, 1)) {
    sessions.push(...collectUsageForDate(date).sessions);
  }

  return sessions;
}

function collectUsageForDate(date) {
  const sessions = collectSessionsForDate({
    selectedDate: date,
    lookbackDays: LOOKBACK_DAYS,
    homeDir: HOME,
    helpers: { dateMinus, localDate, localTime },
  });
  return {
    sessions,
    totals: collectUsageTotals(sessions),
  };
}

function providerColor(providerTag) {
  if (providerTag === "CX") return C;
  if (providerTag === "GH") return G;
  return Z;
}

function colorProviderTag(providerTag) {
  const color = providerColor(providerTag);
  return color === Z ? providerTag : `${color}${providerTag}${Z}`;
}

function providerCell(value, width, providerTag) {
  return padVisible(colorProviderTag(value), width);
}

function usageCell(total, key, width) {
  if (total.total <= 0) return padVisible(`${D}--${Z}`, width, "right");
  return padVisible(fmt(total[key]), width, "right");
}

function metaCell(value, width) {
  return padVisible(value > 0 ? `${value}` : `${D}-${Z}`, width, "right");
}

function creditsCell(value, available, width) {
  if (!available) return padVisible(`${D}--${Z}`, width, "right");
  return padVisible(`${Y}${value.toFixed(2)}${Z}`, width, "right");
}

export function renderProviderTotals(periodName, totals, providerTotals) {
  const columns = [
    ["SRC", 6, "left"],
    ["TOTAL", 8, "right"],
    ["INPUT", 8, "right"],
    ["OUTPUT", 8, "right"],
    ["CACHE", 8, "right"],
    ["REASON", 8, "right"],
    ["MSG", 4, "right"],
    ["REQ", 4, "right"],
    ["CREDITS", 8, "right"],
  ];

  const header = `${D}${columns
    .map(([label, width, align]) => padVisible(label, width, align))
    .join(" ")}${Z}`;

  const rows = [
    {
      providerTag: "ALL",
      total: totals.total,
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      reasoning: totals.reasoning,
      metadataMessageCount: 0,
      metadataRequestCount: 0,
      credits: totals.credits,
      creditAvailable: true,
    },
    ...providerTotals,
  ];

  return [
    periodName,
    header,
    ...rows.map((total) =>
      [
        providerCell(total.providerTag, 6, total.providerTag),
        usageCell(total, "total", 8),
        usageCell(total, "input", 8),
        usageCell(total, "output", 8),
        usageCell(total, "cacheRead", 8),
        usageCell(total, "reasoning", 8),
        metaCell(total.metadataMessageCount, 4),
        metaCell(total.metadataRequestCount, 4),
        creditsCell(total.credits, total.creditAvailable, 8),
      ].join(" "),
    ),
  ];
}

export function renderPeriodLines(label, sessions) {
  const totals = collectUsageTotals(sessions);
  const providers = collectProviderTotals(sessions);
  return renderProviderTotals(label, totals, providers);
}

function render() {
  const date = currentDate();
  const today = collectUsageForDate(date);
  const thisWeekSessions = collectSessionsForRange(weekStart(date), weekEnd(date));
  const thisMonthSessions = collectSessionsForRange(monthStart(date), monthEnd(date));
  const sessions = today.sessions;
  const totals = today.totals;
  const partialData = hasPartialData(sessions);

  const max = Math.max(...sessions.map((s) => s.total), 1);

  process.stdout.write("\x1Bc");
  console.log("╭" + "─".repeat(WIDTH + 2) + "╮");
  console.log(
    `│ ${cell(`CTop ${date}  ACTIVE TODAY  ${B}in${Z} ${G}out${Z} ${X}cache${Z} ${M}create${Z}`)} │`,
  );
  console.log("├" + "─".repeat(WIDTH + 2) + "┤");

  if (sessions.length === 0) {
    console.log(
      `│ ${cell(`No active usage found for ${date} within last ${LOOKBACK_DAYS} day(s)`)} │`,
    );
  } else {
    for (const s of sessions) {
      console.log(`│ ${cell(renderSessionLine(s, max))} │`);
    }

    console.log("├" + "─".repeat(WIDTH + 2) + "┤");

    const totalLeft =
      `Σ ${bar(totals, totals.total)} ${fmt(totals.total)} ` +
      `I:${fmt(totals.input)} O:${fmt(totals.output)} C:${fmt(totals.cacheRead)} R:${fmt(totals.reasoning)}`;

    console.log(`│ ${cell(rightCredit(totalLeft, totals.credits))} │`);
    console.log("├" + "─".repeat(WIDTH + 2) + "┤");
    for (const line of renderPeriodLines("Week", thisWeekSessions)) {
      console.log(`│ ${cell(line)} │`);
    }
    console.log("├" + "─".repeat(WIDTH + 2) + "┤");
    for (const line of renderPeriodLines("Month", thisMonthSessions)) {
      console.log(`│ ${cell(line)} │`);
    }
    if (partialData) {
      console.log("├" + "─".repeat(WIDTH + 2) + "┤");
      console.log(
        `│ ${cell(`${Y}Note:${Z} totals partial; some Copilot usage/credits unavailable`)} │`,
      );
    }
  }

  console.log("╰" + "─".repeat(WIDTH + 2) + "╯");
}

async function loop() {
  while (true) {
    render();
    await new Promise((r) => setTimeout(r, REFRESH * 1000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  loop();
}
