import fs from "node:fs";
import path from "node:path";

import {
  addUsage,
  deltaUsage,
  estimateCredits,
  modelFrom,
  shortId,
  usageFrom,
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

function readSession(file, date, helpers) {
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

      const usage = usageFrom(info);
      const ts =
        obj.timestamp ?? obj.time ?? obj.created_at ?? obj.payload?.timestamp;
      const eventDate = helpers.localDate(ts);

      const delta = deltaUsage(prevUsage, usage);
      prevUsage = usage;

      if (eventDate !== date || !delta) continue;

      foundActivity = true;
      session.time = helpers.localTime(ts);
      addUsage(session, delta);
    } catch {
      // ignore malformed lines
    }
  }

  session.credits = estimateCredits(session);

  return foundActivity && session.total > 0 ? session : null;
}

const provider = {
  id: "codex",
  name: "Codex",
  isAvailable({ home }) {
    return fs.existsSync(path.join(home, ".codex", "sessions"));
  },
  loadSessions({ home, date, lookbackDays, helpers }) {
    return candidateDirs(date, lookbackDays, helpers, home)
      .flatMap((dir) => walk(dir))
      .map((file) => readSession(file, date, helpers))
      .filter(Boolean);
  },
};

export default provider;
