import fs from "node:fs";
import path from "node:path";

import {
  addUsage,
  estimateCredits,
  modelFrom,
  shortId,
  walk,
} from "./shared.js";

function candidateDirs(date, lookbackDays, helpers, home) {
  const dirs = [];
  for (let i = 0; i < lookbackDays; i++) {
    const value = helpers.dateMinus(date, i);
    const [yy, mm, dd] = value.split("-");
    dirs.push(path.join(home, ".codex", "sessions", yy, mm, dd));
  }
  return dirs;
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

      if (typeof id === "string" && id.length > 8) return shortId(id);
    } catch {
      // ignore malformed lines
    }
  }

  return path
    .basename(file, ".jsonl")
    .replace(/^rollout-/, "")
    .slice(0, 16);
}

function normalizedUsageFrom(info) {
  const cacheRead = info.cached_input_tokens ?? 0;
  const input = Math.max(0, (info.input_tokens ?? 0) - cacheRead);

  // Codex footer semantics: input excludes cached input, and total is input + output.
  return {
    input,
    output: info.output_tokens ?? 0,
    cacheRead,
    cacheCreate: info.cache_creation_input_tokens ?? 0,
    reasoning: info.reasoning_output_tokens ?? 0,
    total: input + (info.output_tokens ?? 0),
  };
}

function codexDeltaUsage(prevUsage, nextUsage) {
  if (!prevUsage) return null;

  const delta = {
    input: Math.max(0, nextUsage.input - prevUsage.input),
    output: Math.max(0, nextUsage.output - prevUsage.output),
    cacheRead: Math.max(0, nextUsage.cacheRead - prevUsage.cacheRead),
    cacheCreate: Math.max(0, nextUsage.cacheCreate - prevUsage.cacheCreate),
    reasoning: Math.max(0, nextUsage.reasoning - prevUsage.reasoning),
  };
  delta.total = delta.input + delta.output;

  return delta.input ||
    delta.output ||
    delta.cacheRead ||
    delta.cacheCreate ||
    delta.reasoning
    ? delta
    : null;
}

function readSession(file, date, helpers, pricing) {
  const session = {
    provider: "codex",
    providerTag: "CX",
    sourceLabel: "",
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
    usageAvailable: true,
    creditAvailable: true,
    note: "",
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

      const usage = normalizedUsageFrom(info);
      const ts =
        obj.timestamp ?? obj.time ?? obj.created_at ?? obj.payload?.timestamp;
      const eventDate = helpers.localDate(ts);

      const delta = codexDeltaUsage(prevUsage, usage);
      prevUsage = usage;

      if (eventDate !== date || !delta) continue;

      foundActivity = true;
      session.time = helpers.localTime(ts);
      addUsage(session, delta);
    } catch {
      // ignore malformed lines
    }
  }

  session.credits = estimateCredits(session, pricing);

  return foundActivity ? session : null;
}

const provider = {
  id: "codex",
  name: "Codex",
  isAvailable({ home }) {
    return fs.existsSync(path.join(home, ".codex", "sessions"));
  },
  loadSessions({ home, date, lookbackDays, helpers, pricing }) {
    return candidateDirs(date, lookbackDays, helpers, home)
      .flatMap((dir) => walk(dir))
      .map((file) => readSession(file, date, helpers, pricing))
      .filter(Boolean);
  },
};

export default provider;
