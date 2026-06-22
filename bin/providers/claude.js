import fs from "node:fs";
import path from "node:path";

import { addUsage, estimateCredits, shortId, walk } from "./shared.js";

function readSession(file, date, helpers, pricing) {
  const sessionId = path.basename(file, ".jsonl");
  const session = {
    provider: "claude",
    providerTag: "CC",
    sourceLabel: "",
    file,
    name: shortId(sessionId),
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

  let foundActivity = false;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line);
      if (obj.type !== "assistant") continue;

      const ts = obj.timestamp;
      if (helpers.localDate(ts) !== date) continue;

      const usage = obj.message?.usage;
      if (!usage) continue;

      const model = obj.message?.model;
      if (typeof model === "string" && model) session.model = model;

      const delta = {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheCreate: usage.cache_creation_input_tokens ?? 0,
        reasoning: 0,
        total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        credits: 0,
      };

      if (delta.input || delta.output || delta.cacheRead || delta.cacheCreate) {
        foundActivity = true;
        session.time = helpers.localTime(ts);
        addUsage(session, delta);
      }
    } catch {
      // ignore malformed lines
    }
  }

  session.credits = estimateCredits(session, pricing);

  return foundActivity ? session : null;
}

const provider = {
  id: "claude",
  name: "Claude",
  isAvailable({ home }) {
    return fs.existsSync(path.join(home, ".claude", "projects"));
  },
  loadSessions({ home, date, helpers, pricing }) {
    const projectsDir = path.join(home, ".claude", "projects");
    return walk(projectsDir)
      .map((file) => readSession(file, date, helpers, pricing))
      .filter(Boolean);
  },
};

export default provider;
