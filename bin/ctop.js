#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

const MODEL_PRICING = {
  "g5.5": { input: 125, cache: 12.5, output: 750 },
  "g5.4": { input: 62.5, cache: 6.25, output: 375 },
  "g5.4-mini": { input: 18.75, cache: 1.875, output: 113 },
  "g5.2-codex": { input: 43.75, cache: 4.375, output: 350 },
  default: { input: 62.5, cache: 6.25, output: 375 },
};

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

function fmt(n = 0) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

function estimateCredits(s) {
  const p = MODEL_PRICING[s.model] ?? MODEL_PRICING.default;
  return (
    (s.input / 1_000_000) * p.input +
    (s.cacheRead / 1_000_000) * p.cache +
    (s.output / 1_000_000) * p.output
  );
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }

  return out;
}

function add(a, b) {
  a.input += b.input ?? 0;
  a.output += b.output ?? 0;
  a.cacheRead += b.cacheRead ?? 0;
  a.cacheCreate += b.cacheCreate ?? 0;
  a.reasoning += b.reasoning ?? 0;
  a.total += b.total ?? 0;
  a.credits += b.credits ?? 0;
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
    reasoning: 0,
    total: 0,
    credits: 0,
    model: "default",
  };
}

function modelFrom(obj) {
  return (
    obj.model ??
    obj.payload?.model ??
    obj.payload?.response?.model ??
    obj.payload?.message?.model ??
    "-"
  ).replace("gpt-", "g");
}

function usageFrom(info) {
  return {
    input: info.input_tokens ?? 0,
    output: info.output_tokens ?? 0,
    cacheRead: info.cached_input_tokens ?? 0,
    cacheCreate: info.cache_creation_input_tokens ?? 0,
    reasoning: info.reasoning_output_tokens ?? 0,
    total: info.total_tokens ?? 0,
  };
}

function deltaUsage(prev, next) {
  if (!prev) return null;

  const d = {
    input: Math.max(0, next.input - prev.input),
    output: Math.max(0, next.output - prev.output),
    cacheRead: Math.max(0, next.cacheRead - prev.cacheRead),
    cacheCreate: Math.max(0, next.cacheCreate - prev.cacheCreate),
    reasoning: Math.max(0, next.reasoning - prev.reasoning),
    total: Math.max(0, next.total - prev.total),
  };

  if (d.total === 0) {
    d.total = d.input + d.output + d.cacheRead + d.cacheCreate;
  }

  return d.total > 0 ? d : null;
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

function sessionName(file) {
  const text = fs.readFileSync(file, "utf8");

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line);

      const id =
        obj.session_id ??
        obj.sessionId ??
        obj.id ??
        obj.payload?.session_id ??
        obj.payload?.sessionId ??
        obj.payload?.session?.id ??
        obj.payload?.id;

      if (typeof id === "string" && id.length > 8) {
        return `${id.slice(0, 4)}…${id.slice(-4)}`;
      }
    } catch {
      // ignore malformed lines
    }
  }

  // Fallback if no session id found
  return path
    .basename(file, ".jsonl")
    .replace(/^rollout-/, "")
    .slice(0, 16);
}

function readSessionActiveOnDate(file, selectedDate) {
  const session = {
    agent: "codex",
    file,
    name: sessionName(file),
    time: "--:--",
    model: "-",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
    reasoning: 0,
    total: 0,
    credits: 0,
  };

  let prevUsage = null;
  let foundActivity = false;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line);
      const model = modelFrom(obj);
      if (model !== "-") session.model = model;

      if (obj.payload?.type !== "token_count") continue;

      const info = obj.payload.info?.total_token_usage;
      if (!info) continue;

      const usage = usageFrom(info);
      const ts =
        obj.timestamp ?? obj.time ?? obj.created_at ?? obj.payload?.timestamp;
      const eventDate = localDate(ts);

      const d = deltaUsage(prevUsage, usage);
      prevUsage = usage;

      if (eventDate !== selectedDate || !d) continue;

      foundActivity = true;
      session.time = localTime(ts);
      add(session, d);
    } catch {}
  }

  session.credits = estimateCredits(session);

  return foundActivity && session.total > 0 ? session : null;
}

function candidateDirs(selectedDate) {
  const dirs = [];
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const d = dateMinus(selectedDate, i);
    const [yy, mm, dd] = d.split("-");
    dirs.push(path.join(HOME, ".codex", "sessions", yy, mm, dd));
  }
  return dirs;
}

function collectUsageForDate(date) {
  const totals = emptyUsage();
  const files = candidateDirs(date).flatMap((d) => walk(d));

  for (const file of files) {
    const session = readSessionActiveOnDate(file, date);
    if (session) add(totals, session);
  }

  return totals;
}

function collectUsageForDateRange(startDate, endDate) {
  const totals = emptyUsage();

  for (let date = startDate; date <= endDate; date = datePlus(date, 1)) {
    add(totals, collectUsageForDate(date));
  }

  return totals;
}

function render() {
  const date = currentDate();
  const dayStart = date;
  const dayEnd = date;
  const thisWeek = collectUsageForDateRange(weekStart(date), weekEnd(date));
  const thisMonth = collectUsageForDateRange(monthStart(date), monthEnd(date));
  const files = candidateDirs(date).flatMap((d) => walk(d));
  const sessions = files
    .map((f) => readSessionActiveOnDate(f, date))
    .filter(Boolean)
    .sort((a, b) => a.time.localeCompare(b.time));
  const totals = collectUsageForDateRange(dayStart, dayEnd);

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
      const left =
        `${C}${s.time}${Z} ${s.model.padEnd(8).slice(0, 8)} ` +
        `${bar(s, max)} ${fmt(s.total).padStart(5)} ` +
        `I:${fmt(s.input)} O:${fmt(s.output)} C:${fmt(s.cacheRead)} R:${fmt(s.reasoning)} ${risk(s)} ` +
        `${D}${s.name}${Z}`;

      console.log(`│ ${cell(rightCredit(left, s.credits))} │`);
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
  }

  console.log("╰" + "─".repeat(WIDTH + 2) + "╯");
}

async function loop() {
  while (true) {
    render();
    await new Promise((r) => setTimeout(r, REFRESH * 1000));
  }
}

loop();
