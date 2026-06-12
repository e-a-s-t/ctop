#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadPricing } from "./pricing/index.js";
import { renderDashboard } from "./render/index.js";
import { collectSessionsForDate, hasPartialData } from "./providers/index.js";
import { renderTinyDashboard } from "./render/tiny.js";

const args = process.argv.slice(2);

function arg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function argFrom(list, name) {
  const idx = list.indexOf(name);
  return idx >= 0 ? list[idx + 1] : undefined;
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
  --tiny [N]              Show condensed today-only view, latest N sessions, default 5
  --warn-tokens NUMBER    Warning threshold, default 2000000
  --lookback-days NUMBER  Scan recent session folders, default 14
  --pricing-file PATH     Load pricing override JSON
  --codex-weekly-limit N  Weekly Codex credit calibration
  --codex-monthly-limit N Monthly Codex credit calibration

Environment:
  AI_USAGE_DATE
  AI_USAGE_REFRESH
  AI_USAGE_WARN_TOKENS
  AI_USAGE_LOOKBACK_DAYS
  CTOP_PRICING_FILE
  CTOP_CODEX_WEEKLY_LIMIT
  CTOP_CODEX_MONTHLY_LIMIT

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
const PRICING_FILE = resolvePricingFile();
const CODEX_WEEKLY_LIMIT = resolveCodexLimit(
  "--codex-weekly-limit",
  "CTOP_CODEX_WEEKLY_LIMIT",
);
const CODEX_MONTHLY_LIMIT = resolveCodexLimit(
  "--codex-monthly-limit",
  "CTOP_CODEX_MONTHLY_LIMIT",
);
const PRICING = loadPricing({ pricingFile: PRICING_FILE });

const TINY = hasFlag("--tiny");
const TINY_LIMIT = optionalNumberAfter("--tiny", 5);

export function resolveCodexLimit(
  flagName,
  envName,
  argv = args,
  env = process.env,
) {
  const raw = argFrom(argv, flagName) ?? env[envName];
  if (raw == null || raw === "") return null;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function resolvePricingFile(argv = args, env = process.env) {
  return argFrom(argv, "--pricing-file") ?? env.CTOP_PRICING_FILE ?? null;
}

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

export function collectUsageForDate(date, options = {}) {
  const {
    lookbackDays = LOOKBACK_DAYS,
    homeDir = HOME,
    helpers = { dateMinus, localDate, localTime },
    pricing = PRICING,
  } = options;

  return {
    sessions: collectSessionsForDate({
      selectedDate: date,
      lookbackDays,
      homeDir,
      helpers,
      pricing,
    }),
  };
}

function collectSessionsForRange(startDate, endDate) {
  const sessions = [];

  for (let date = startDate; date <= endDate; date = datePlus(date, 1)) {
    sessions.push(...collectUsageForDate(date).sessions);
  }

  return sessions;
}

function hasFlag(name) {
  return args.includes(name);
}

function optionalNumberAfter(name, fallback) {
  const idx = args.indexOf(name);
  if (idx < 0) return fallback;

  const raw = args[idx + 1];
  if (!raw || raw.startsWith("-")) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function render() {
  const date = currentDate();
  const { sessions } = collectUsageForDate(date);
  const partialData = hasPartialData(sessions);

  if (TINY) {
    process.stdout.write(
      renderTinyDashboard({
        date,
        width: WIDTH,
        lookbackDays: LOOKBACK_DAYS,
        sessions,
        warnTokens: WARN_TOKENS,
        partialData,
      }),
    );
    return;
  }

  const thisWeekSessions = collectSessionsForRange(
    weekStart(date),
    weekEnd(date),
  );
  const thisMonthSessions = collectSessionsForRange(
    monthStart(date),
    monthEnd(date),
  );

  process.stdout.write(
    renderDashboard({
      date,
      width: WIDTH,
      lookbackDays: LOOKBACK_DAYS,
      sessions,
      weekSessions: thisWeekSessions,
      monthSessions: thisMonthSessions,
      partialData,
      codexWeeklyLimit: CODEX_WEEKLY_LIMIT,
      codexMonthlyLimit: CODEX_MONTHLY_LIMIT,
    }),
  );
}

async function loop() {
  while (true) {
    render();
    await new Promise((r) => setTimeout(r, REFRESH * 1000));
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])
) {
  loop();
}
