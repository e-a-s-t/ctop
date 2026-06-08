import fs from "node:fs";
import path from "node:path";

import {
  addUsage,
  emptyUsage,
  maxTimestamp,
  normalizeModel,
  parseYamlScalar,
  shortId,
  walk,
} from "./shared.js";

function createSession({ source, file, id }) {
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

function note(source, usageAvailable, creditAvailable) {
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

function parseLogs(logDir, date, helpers) {
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
      if (helpers.localDate(ts) !== date) continue;

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

function readVsCodeSession(file, date, helpers) {
  const fallbackId = path.basename(file, ".jsonl");
  const session = createSession({
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
  if (helpers.localDate(latestTs) !== date) return null;

  session.name = `${shortId(sessionId)} vscode`;
  session.time = helpers.localTime(latestTs);
  session.note = note("vscode", false, false);

  return session;
}

function parseCliUsage(event) {
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

function readCliSession(sessionDir, date, helpers, logMeta = null) {
  const workspaceFile = path.join(sessionDir, "workspace.yaml");
  if (!fs.existsSync(workspaceFile)) return null;

  const workspace = fs.readFileSync(workspaceFile, "utf8");
  const fallbackId = path.basename(sessionDir);
  const session = createSession({
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
    if (helpers.localDate(ts) === date) activeToday = true;
  }

  if (fs.existsSync(eventsFile)) {
    session.file = eventsFile;

    for (const line of fs.readFileSync(eventsFile, "utf8").split("\n")) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);
        const ts = event.timestamp ?? event.data?.startTime;
        latestTs = maxTimestamp(latestTs, ts);
        if (helpers.localDate(ts) === date) activeToday = true;

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

          const usage = parseCliUsage(event);
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
  session.note = note("cli", session.usageAvailable, false);

  return session;
}

const provider = {
  id: "copilot",
  name: "Copilot",
  isAvailable({ home }) {
    return (
      fs.existsSync(path.join(home, ".copilot", "session-state")) ||
      fs.existsSync(path.join(home, ".copilot", "logs")) ||
      fs.existsSync(
        path.join(
          home,
          "Library",
          "Application Support",
          "Code",
          "User",
          "workspaceStorage",
        ),
      )
    );
  },
  loadSessions({ home, date, helpers }) {
    const stateRoot = path.join(home, ".copilot", "session-state");
    const logRoot = path.join(home, ".copilot", "logs");
    const sessions = [];

    const storageRoot = path.join(
      home,
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
          const session = readVsCodeSession(file, date, helpers);
          if (session) sessions.push(session);
        }
      }
    }

    if (fs.existsSync(stateRoot)) {
      const logs = parseLogs(logRoot, date, helpers);

      for (const entry of fs.readdirSync(stateRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const session = readCliSession(
          path.join(stateRoot, entry.name),
          date,
          helpers,
          logs.get(entry.name) ?? null,
        );
        if (session) sessions.push(session);
      }
    }

    return sessions;
  },
};

export default provider;
