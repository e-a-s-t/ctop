import fs from "node:fs";
import path from "node:path";
import { resolveModelPricing } from "../pricing/index.js";

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

export function estimateCredits(session, pricing) {
  const modelPricing = resolveModelPricing(pricing, session.model);
  return (
    ((session.input + (session.cacheCreate ?? 0)) / 1_000_000) * modelPricing.input +
    (session.cacheRead / 1_000_000) * modelPricing.cachedInput +
    (session.output / 1_000_000) * modelPricing.output
  );
}

export function walk(dir, out = [], suffix = ".jsonl") {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out, suffix);
    else if (entry.name.endsWith(suffix)) out.push(file);
  }

  return out;
}

export function shortId(value) {
  if (typeof value !== "string" || value.length < 8) return value ?? "-";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function normalizeModel(value) {
  if (typeof value !== "string" || !value) return "-";
  return value.replace("gpt-", "g");
}

export function modelFrom(obj) {
  return normalizeModel(
    obj.model ??
    obj.payload?.model ??
    obj.payload?.response?.model ??
    obj.payload?.message?.model ??
    "-"
  );
}

export function usageFrom(info) {
  return {
    input: info.input_tokens ?? 0,
    output: info.output_tokens ?? 0,
    cacheRead: info.cached_input_tokens ?? 0,
    cacheCreate: info.cache_creation_input_tokens ?? 0,
    reasoning: info.reasoning_output_tokens ?? 0,
    total: info.total_tokens ?? 0,
  };
}

export function deltaUsage(prev, next) {
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

export function parseYamlScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

export function maxTimestamp(current, next) {
  if (!next) return current;
  const value = new Date(next).getTime();
  if (Number.isNaN(value)) return current;
  return current === null || value > current ? value : current;
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
