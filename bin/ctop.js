#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  collectSessionsForDate,
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

function collectUsageForDate(date) {
  const sessions = collectSessionsForDate({
    selectedDate: date,
    lookbackDays: LOOKBACK_DAYS,
    homeDir: HOME,
    helpers: { dateMinus, localDate, localTime },
  });
  return collectUsageTotals(sessions);
}

function collectUsageForDateRange(startDate, endDate) {
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
    reasoning: 0,
    total: 0,
    credits: 0,
  };

  for (let date = startDate; date <= endDate; date = datePlus(date, 1)) {
    const next = collectUsageForDate(date);
    totals.input += next.input;
    totals.output += next.output;
    totals.cacheRead += next.cacheRead;
    totals.cacheCreate += next.cacheCreate;
    totals.reasoning += next.reasoning;
    totals.total += next.total;
    totals.credits += next.credits;
  }

  return totals;
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

function render() {
  const date = currentDate();
  const thisWeek = collectUsageForDateRange(weekStart(date), weekEnd(date));
  const thisMonth = collectUsageForDateRange(monthStart(date), monthEnd(date));
  const sessions = collectSessionsForDate({
    selectedDate: date,
    lookbackDays: LOOKBACK_DAYS,
    homeDir: HOME,
    helpers: { dateMinus, localDate, localTime },
  });
  const totals = collectUsageTotals(sessions);
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
      const metrics = renderSessionMetrics(s, max);
      const credit = s.creditAvailable ? s.credits.toFixed(2) : "--";
      const left =
        `${C}${s.time}${Z} ${s.providerTag.padEnd(2)} ${s.model.padEnd(8).slice(0, 8)} ` +
        `${metrics} ${D}${s.name}${Z}`;

      console.log(`│ ${cell(rightCreditLabel(left, credit))} │`);
    }

    console.log("├" + "─".repeat(WIDTH + 2) + "┤");

    const totalLeft =
      `Σ ${bar(totals, totals.total)} ${fmt(totals.total)} ` +
      `I:${fmt(totals.input)} O:${fmt(totals.output)} C:${fmt(totals.cacheRead)} R:${fmt(totals.reasoning)}`;

    console.log(`│ ${cell(rightCredit(totalLeft, totals.credits))} │`);
    console.log("├" + "─".repeat(WIDTH + 2) + "┤");
    console.log(
      `│ ${cell(rightCredit(`Week: ${fmt(thisWeek.total)} I:${fmt(thisWeek.input)} O:${fmt(thisWeek.output)} C:${fmt(thisWeek.cacheRead)} R:${fmt(thisWeek.reasoning)}`, thisWeek.credits))} │`,
    );
    console.log(
      `│ ${cell(rightCredit(`Month: ${fmt(thisMonth.total)} I:${fmt(thisMonth.input)} O:${fmt(thisMonth.output)} C:${fmt(thisMonth.cacheRead)} R:${fmt(thisMonth.reasoning)}`, thisMonth.credits))} │`,
    );
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
