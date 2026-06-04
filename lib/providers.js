import fs from "node:fs";
import path from "node:path";

export const MODEL_PRICING = {
  "g5.5": { input: 125, cache: 12.5, output: 750 },
  "g5.4": { input: 62.5, cache: 6.25, output: 375 },
  "g5.4-mini": { input: 18.75, cache: 1.875, output: 113 },
  "g5.2-codex": { input: 43.75, cache: 4.375, output: 350 },
  default: { input: 62.5, cache: 6.25, output: 375 },
};

export function emptyUsage() {
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

function emptyProviderTotal(providerTag) {
  return {
    providerTag,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
    reasoning: 0,
    total: 0,
    credits: 0,
    creditAvailable: true,
    metadataMessageCount: 0,
    metadataRequestCount: 0,
  };
}

export function addUsage(a, b) {
  a.input += b.input ?? 0;
  a.output += b.output ?? 0;
  a.cacheRead += b.cacheRead ?? 0;
  a.cacheCreate += b.cacheCreate ?? 0;
  a.reasoning += b.reasoning ?? 0;
  a.total += b.total ?? 0;
  a.credits += b.credits ?? 0;
}

export function estimateCredits(session) {
  const pricing = MODEL_PRICING[session.model] ?? MODEL_PRICING.default;
  return (
    (session.input / 1_000_000) * pricing.input +
    (session.cacheRead / 1_000_000) * pricing.cache +
    (session.output / 1_000_000) * pricing.output
  );
}

function walk(dir, out = [], suffix = ".jsonl") {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out, suffix);
    else if (entry.name.endsWith(suffix)) out.push(file);
  }

  return out;
}

function shortId(value) {
  if (typeof value !== "string" || value.length < 8) return value ?? "-";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function normalizeModel(value) {
  if (typeof value !== "string" || !value) return "-";
  return value.replace("gpt-", "g");
}

function modelFrom(obj) {
  return normalizeModel(
    obj.model ??
    obj.payload?.model ??
    obj.payload?.response?.model ??
    obj.payload?.message?.model ??
    "-"
  );
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

  const delta = {
    input: Math.max(0, next.input - prev.input),
    output: Math.max(0, next.output - prev.output),
    cacheRead: Math.max(0, next.cacheRead - prev.cacheRead),
    cacheCreate: Math.max(0, next.cacheCreate - prev.cacheCreate),
    reasoning: Math.max(0, next.reasoning - prev.reasoning),
    total: Math.max(0, next.total - prev.total),
  };

  if (delta.total === 0) {
    delta.total =
      delta.input + delta.output + delta.cacheRead + delta.cacheCreate;
  }

  return delta.total > 0 ? delta : null;
}

function parseYamlScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

function maxTimestamp(current, next) {
  if (!next) return current;
  const value = new Date(next).getTime();
  if (Number.isNaN(value)) return current;
  return current === null || value > current ? value : current;
}

function createCopilotSession({ source, file, id }) {
  return {
    provider: "copilot",
    providerTag: "GH",
    sourceLabel: source,
    source,
    file,
    name: `${shortId(id)} ${source}`,
    time: "--:--",
    model: "-",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
    reasoning: 0,
    total: 0,
    credits: 0,
    requestCount: 0,
    messageCount: 0,
    usageAvailable: false,
    creditAvailable: false,
    note: "",
  };
}

function copilotNote(source, usageAvailable, creditAvailable) {
  if (usageAvailable && creditAvailable) return "";
  if (!usageAvailable && !creditAvailable) {
    return `Copilot ${source} usage/credits unavailable`;
  }
  if (!usageAvailable) return `Copilot ${source} usage unavailable`;
  return `Copilot ${source} credits unavailable`;
}

function parseVsCodeSelectedModel(selectedModel) {
  return normalizeModel(
    selectedModel?.metadata?.version ??
      selectedModel?.metadata?.name ??
      selectedModel?.identifier ??
      "-"
  );
}

function parseVsCodeRequestModel(request) {
  return normalizeModel(
    request?.resolvedModel ??
      request?.modelId ??
      request?.model ??
      request?.responseId ??
      "-"
  );
}

function parseCopilotLogs(logDir, selectedDate, helpers) {
  const result = new Map();

  for (const file of walk(logDir, [], ".log")) {
    const text = fs.readFileSync(file, "utf8");
    const sessionIds = [...text.matchAll(/[0-9a-f]{8}-[0-9a-f-]{27}/g)].map(
      (match) => match[0],
    );
    const uniqueIds = [...new Set(sessionIds)];
    const lines = text.split("\n");
    const fileModel =
      text.match(/Using default model:\s+([A-Za-z0-9._-]+)/)?.[1] ?? null;
    const fileCredits =
      text.match(/credits?[:=]\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1] ?? null;

    for (const line of lines) {
      const ts = line.match(/^(\S+)/)?.[1];
      if (helpers.localDate(ts) !== selectedDate) continue;

      const lineIds = [...line.matchAll(/[0-9a-f]{8}-[0-9a-f-]{27}/g)].map(
        (match) => match[0],
      );
      const ids = lineIds.length > 0 ? lineIds : uniqueIds.length === 1 ? uniqueIds : [];

      for (const id of ids) {
        if (!result.has(id)) {
          result.set(id, {
            model: fileModel ?? "-",
            credits: fileCredits ? Number(fileCredits) : null,
            usage: null,
            times: [],
          });
        }

        const info = result.get(id);
        if (ts) info.times.push(ts);
        if (fileModel && info.model === "-") info.model = fileModel;

        const usage = {
          input:
            Number(line.match(/input[_ ]tokens?[:=]\s*(\d+)/i)?.[1] ?? "0") || 0,
          output:
            Number(line.match(/output[_ ]tokens?[:=]\s*(\d+)/i)?.[1] ?? "0") || 0,
          cacheRead:
            Number(line.match(/cached[_ ]input[_ ]tokens?[:=]\s*(\d+)/i)?.[1] ?? "0") || 0,
          cacheCreate:
            Number(line.match(/cache[_ ]creation[_ ]input[_ ]tokens?[:=]\s*(\d+)/i)?.[1] ?? "0") || 0,
          reasoning:
            Number(line.match(/reasoning[_ ]output[_ ]tokens?[:=]\s*(\d+)/i)?.[1] ?? "0") || 0,
          total:
            Number(line.match(/total[_ ]tokens?[:=]\s*(\d+)/i)?.[1] ?? "0") || 0,
        };

        if (
          usage.input ||
          usage.output ||
          usage.cacheRead ||
          usage.cacheCreate ||
          usage.reasoning ||
          usage.total
        ) {
          if (!info.usage) info.usage = emptyUsage();
          addUsage(info.usage, usage);
        }

        const lineCredits = line.match(/credits?[:=]\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];
        if (lineCredits) info.credits = Number(lineCredits);
      }
    }
  }

  return result;
}

function updateVsCodeRequest(state, request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return;

  if (request.requestId) state.requestId = request.requestId;

  const model = parseVsCodeRequestModel(request);
  if (model !== "-") state.model = model;

  if (request.message) state.hasUserMessage = true;
  if (Array.isArray(request.response) && request.response.length > 0) {
    state.hasAssistantMessage = true;
  }

  state.latestTs = maxTimestamp(
    state.latestTs,
    request.modelState?.completedAt ??
      request.responseCreatedAt ??
      request.requestCreatedAt ??
      request.timestamp,
  );
}

function readVsCodeChatSession(file, selectedDate, helpers) {
  const fallbackId = path.basename(file, ".jsonl");
  const session = createCopilotSession({
    source: "vscode",
    file,
    id: fallbackId,
  });
  const requests = new Map();

  let sessionId = fallbackId;
  let latestTs = null;
  let selectedModel = "-";

  function getRequestState(index) {
    if (!requests.has(index)) {
      requests.set(index, {
        requestId: null,
        model: "-",
        hasUserMessage: true,
        hasAssistantMessage: false,
        latestTs: null,
      });
    }
    return requests.get(index);
  }

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line);
      const value = obj.v;

      if (obj.kind === 0 && value && typeof value === "object") {
        if (typeof value.sessionId === "string" && value.sessionId) {
          sessionId = value.sessionId;
        }

        selectedModel = parseVsCodeSelectedModel(value.inputState?.selectedModel);
        latestTs = maxTimestamp(latestTs, value.creationDate);

        if (Array.isArray(value.requests)) {
          value.requests.forEach((request, index) =>
            updateVsCodeRequest(getRequestState(index), request),
          );
        }
      }

      if (!Array.isArray(obj.k) || obj.k[0] !== "requests") continue;

      if (obj.k.length === 1 && Array.isArray(value)) {
        value.forEach((request, index) =>
          updateVsCodeRequest(getRequestState(index), request),
        );
        continue;
      }

      const index = obj.k[1];
      if (!Number.isInteger(index)) continue;

      const requestState = getRequestState(index);
      if (obj.k.length === 2) {
        updateVsCodeRequest(requestState, value);
        continue;
      }

      const leaf = obj.k.at(-1);
      if (leaf === "response" && Array.isArray(value) && value.length > 0) {
        requestState.hasAssistantMessage = true;
      }

      if (
        leaf === "modelState" &&
        value &&
        typeof value === "object" &&
        "completedAt" in value
      ) {
        requestState.latestTs = maxTimestamp(requestState.latestTs, value.completedAt);
      }
    } catch {
      // ignore malformed lines
    }
  }

  session.requestCount = requests.size;
  session.messageCount = [...requests.values()].reduce(
    (sum, request) =>
      sum +
      (request.hasUserMessage ? 1 : 0) +
      (request.hasAssistantMessage ? 1 : 0),
    0,
  );

  for (const request of requests.values()) {
    latestTs = maxTimestamp(latestTs, request.latestTs);
    if (request.model !== "-") session.model = request.model;
  }

  if (session.model === "-") session.model = selectedModel;
  if (helpers.localDate(latestTs) !== selectedDate) return null;

  session.name = `${shortId(sessionId)} vscode`;
  session.time = helpers.localTime(latestTs);
  session.note = copilotNote("vscode", false, false);

  return session;
}

function parseCopilotCliUsage(event) {
  const metrics = event?.data?.modelMetrics?.[event?.data?.currentModel];
  const usage = metrics?.usage;
  if (!usage || typeof usage !== "object") return null;

  const parsed = {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheCreate: usage.cacheWriteTokens ?? 0,
    reasoning: usage.reasoningTokens ?? 0,
    total:
      usage.totalTokens ??
      (usage.inputTokens ?? 0) +
        (usage.outputTokens ?? 0) +
        (usage.cacheReadTokens ?? 0) +
        (usage.cacheWriteTokens ?? 0) +
        (usage.reasoningTokens ?? 0),
  };

  return parsed.total > 0 ? parsed : null;
}

function readCopilotCliSession(
  sessionDir,
  selectedDate,
  helpers,
  logMeta = null,
) {
  const workspaceFile = path.join(sessionDir, "workspace.yaml");
  if (!fs.existsSync(workspaceFile)) return null;

  const workspace = fs.readFileSync(workspaceFile, "utf8");
  const fallbackId = path.basename(sessionDir);
  const session = createCopilotSession({
    source: "cli",
    file: workspaceFile,
    id: fallbackId,
  });
  const eventsFile = path.join(sessionDir, "events.jsonl");

  let sessionId = parseYamlScalar(workspace, "id") ?? fallbackId;
  let latestTs = null;
  let activeToday = false;

  for (const ts of [
    parseYamlScalar(workspace, "created_at"),
    parseYamlScalar(workspace, "updated_at"),
  ]) {
    latestTs = maxTimestamp(latestTs, ts);
    if (helpers.localDate(ts) === selectedDate) activeToday = true;
  }

  if (fs.existsSync(eventsFile)) {
    session.file = eventsFile;

    for (const line of fs.readFileSync(eventsFile, "utf8").split("\n")) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);
        const ts = event.timestamp ?? event.data?.startTime;
        latestTs = maxTimestamp(latestTs, ts);
        if (helpers.localDate(ts) === selectedDate) activeToday = true;

        if (event.type === "session.start" && event.data?.sessionId) {
          sessionId = event.data.sessionId;
        }

        if (event.type === "session.model_change") {
          session.model = normalizeModel(event.data?.newModel ?? "-");
        }

        if (event.type === "user.message") {
          session.requestCount += 1;
          session.messageCount += 1;
        }

        if (event.type === "assistant.message") {
          session.messageCount += 1;
          const model = normalizeModel(event.data?.model ?? "-");
          if (model !== "-") session.model = model;
        }

        if (event.type === "session.shutdown") {
          const model = normalizeModel(event.data?.currentModel ?? "-");
          if (model !== "-") session.model = model;

          const usage = parseCopilotCliUsage(event);
          if (usage) {
            session.input = usage.input;
            session.output = usage.output;
            session.cacheRead = usage.cacheRead;
            session.cacheCreate = usage.cacheCreate;
            session.reasoning = usage.reasoning;
            session.total = usage.total;
            session.usageAvailable = true;
          }
        }
      } catch {
        // ignore malformed lines
      }
    }
  } else if (logMeta) {
    latestTs = maxTimestamp(
      latestTs,
      [...(logMeta.times ?? [])].sort().at(-1) ?? null,
    );
    activeToday ||= (logMeta.times?.length ?? 0) > 0;

    const model = normalizeModel(logMeta.model ?? "-");
    if (model !== "-") session.model = model;
  }

  if (!activeToday) return null;

  session.name = `${shortId(sessionId)} cli`;
  session.time = helpers.localTime(latestTs);
  session.note = copilotNote("cli", session.usageAvailable, false);

  return session;
}

function codexCandidateDirs(selectedDate, lookbackDays, helpers, homeDir) {
  const dirs = [];
  for (let i = 0; i < lookbackDays; i++) {
    const date = helpers.dateMinus(selectedDate, i);
    const [yy, mm, dd] = date.split("-");
    dirs.push(path.join(homeDir, ".codex", "sessions", yy, mm, dd));
  }
  return dirs;
}

function codexSessionName(file) {
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

function readCodexSession(file, selectedDate, helpers) {
  const session = {
    provider: "codex",
    providerTag: "CX",
    sourceLabel: "",
    file,
    name: codexSessionName(file),
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

      if (eventDate !== selectedDate || !delta) continue;

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

export function createProviders() {
  return [
    {
      id: "codex",
      collectSessionsForDate({ selectedDate, lookbackDays, helpers, homeDir }) {
        return codexCandidateDirs(selectedDate, lookbackDays, helpers, homeDir)
          .flatMap((dir) => walk(dir))
          .map((file) => readCodexSession(file, selectedDate, helpers))
          .filter(Boolean);
      },
    },
    {
      id: "copilot",
      collectSessionsForDate({ selectedDate, helpers, homeDir }) {
        const stateRoot = path.join(homeDir, ".copilot", "session-state");
        const logRoot = path.join(homeDir, ".copilot", "logs");
        const sessions = [];

        const storageRoot = path.join(
          homeDir,
          "Library",
          "Application Support",
          "Code",
          "User",
          "workspaceStorage",
        );

        if (fs.existsSync(storageRoot)) {
          for (const entry of fs.readdirSync(storageRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const chatRoot = path.join(storageRoot, entry.name, "chatSessions");
            for (const file of walk(chatRoot)) {
              const session = readVsCodeChatSession(file, selectedDate, helpers);
              if (session) sessions.push(session);
            }
          }
        }

        if (fs.existsSync(stateRoot)) {
          const logs = parseCopilotLogs(logRoot, selectedDate, helpers);

          for (const entry of fs.readdirSync(stateRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const session = readCopilotCliSession(
              path.join(stateRoot, entry.name),
              selectedDate,
              helpers,
              logs.get(entry.name) ?? null,
            );
            if (session) sessions.push(session);
          }
        }

        return sessions;
      },
    },
  ];
}

export function collectSessionsForDate({
  selectedDate,
  lookbackDays,
  helpers,
  homeDir,
}) {
  return createProviders()
    .flatMap((provider) =>
      provider.collectSessionsForDate({
        selectedDate,
        lookbackDays,
        helpers,
        homeDir,
      }),
    )
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function collectUsageTotals(sessions) {
  const totals = emptyUsage();
  for (const session of sessions) {
    if (!session.usageAvailable) continue;
    const credits = session.creditAvailable ? session.credits : 0;
    addUsage(totals, { ...session, credits });
  }
  return totals;
}

export function collectProviderTotals(sessions) {
  const grouped = new Map();

  for (const session of sessions) {
    const key = session.providerTag;
    if (!grouped.has(key)) grouped.set(key, emptyProviderTotal(key));

    const total = grouped.get(key);

    if (session.usageAvailable) {
      const credits = session.creditAvailable ? session.credits : 0;
      addUsage(total, { ...session, credits });
      total.creditAvailable &&= session.creditAvailable;
      continue;
    }

    total.metadataMessageCount += session.messageCount ?? 0;
    total.metadataRequestCount += session.requestCount ?? 0;
    total.creditAvailable = false;
  }

  return [...grouped.values()].sort((a, b) =>
    a.providerTag.localeCompare(b.providerTag),
  );
}

export function hasPartialData(sessions) {
  return sessions.some(
    (session) => !session.usageAvailable || !session.creditAvailable,
  );
}
