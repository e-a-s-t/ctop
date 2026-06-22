import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  collectUsageForDate,
  resolveCodexLimit,
  resolvePricingFile,
} from "../bin/ctop.js";
import {
  renderCodexLimitCell,
  renderProviderTotals,
  renderPeriodLines,
} from "../bin/render/periods.js";
import {
  renderSessionLine,
  renderSessionMetrics,
} from "../bin/render/sessions.js";
import {
  DEFAULT_PRICING,
  loadPricing,
  resolveModelPricing,
} from "../bin/pricing/index.js";
import {
  collectProviderTotals,
  collectSessionsForDate,
  collectUsageTotals,
  estimateCredits,
  hasPartialData,
} from "../bin/providers/index.js";
import { displayModel } from "../bin/render/bars.js";

const FIXTURE_HOME = path.resolve("test/fixtures/home");
const EMPTY_FIXTURE_HOME = path.resolve("test/fixtures/codex-only-home");
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text) {
  return text.replace(ANSI_RE, "");
}

const helpers = {
  dateMinus(date, days) {
    const d = new Date(`${date}T12:00:00+02:00`);
    d.setDate(d.getDate() - days);
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  },
  localDate(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  },
  localTime(ts) {
    if (!ts) return "--:--";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "--:--";
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  },
};

test("collect sessions keeps codex parsing and discovers copilot", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
    pricing: DEFAULT_PRICING,
  });

  assert.equal(sessions.length, 3);

  const codex = sessions.find((session) => session.provider === "codex");
  assert.ok(codex);
  assert.equal(codex.model, "g5.5");
  assert.equal(codex.total, 70);
  assert.equal(codex.input, 20);
  assert.equal(codex.time, "11:15");
  assert.equal(codex.creditAvailable, true);

  const cli = sessions.find((session) => session.source === "cli");
  assert.ok(cli);
  assert.equal(cli.provider, "copilot");
  assert.equal(cli.providerTag, "GH");
  assert.equal(cli.sourceLabel, "cli");
  assert.equal(cli.name, "9db2…df1b cli");
  assert.equal(cli.model, "g5-mini");
  assert.equal(cli.time, "11:09");
  assert.equal(cli.requestCount, 1);
  assert.equal(cli.messageCount, 2);
  assert.equal(cli.total, 250);
  assert.equal(cli.reasoning, 10);
  assert.equal(cli.usageAvailable, true);
  assert.equal(cli.creditAvailable, false);
  assert.match(cli.note, /credits unavailable/i);

  const vscode = sessions.find((session) => session.source === "vscode");
  assert.ok(vscode);
  assert.equal(vscode.provider, "copilot");
  assert.equal(vscode.providerTag, "GH");
  assert.equal(vscode.sourceLabel, "vscode");
  assert.equal(vscode.name, "0262…9d2b vscode");
  assert.equal(vscode.model, "g4.1");
  assert.equal(vscode.time, "11:54");
  assert.equal(vscode.requestCount, 1);
  assert.equal(vscode.messageCount, 2);
  assert.equal(vscode.usageAvailable, false);
  assert.equal(vscode.creditAvailable, false);
  assert.match(vscode.note, /usage\/credits unavailable/i);
});

test("collectUsageForDate single day always returns iterable sessions", () => {
  const result = collectUsageForDate("2026-06-04", {
    lookbackDays: 14,
    homeDir: FIXTURE_HOME,
    helpers,
    pricing: DEFAULT_PRICING,
  });

  assert.ok(result.sessions);
  assert.ok(Array.isArray(result.sessions));
  assert.equal(result.sessions.length, 3);
});

test("collectUsageForDate empty day returns empty iterable sessions", () => {
  const result = collectUsageForDate("2026-06-03", {
    lookbackDays: 14,
    homeDir: FIXTURE_HOME,
    helpers,
    pricing: DEFAULT_PRICING,
  });

  assert.ok(result.sessions);
  assert.ok(Array.isArray(result.sessions));
  assert.deepEqual(result.sessions, []);
});

test("collectUsageForDate mixed days keep sessions iterable across range", () => {
  const dates = ["2026-06-03", "2026-06-04", "2026-06-05"];
  const sessions = dates.flatMap((date) =>
    collectUsageForDate(date, {
      lookbackDays: 14,
      homeDir: FIXTURE_HOME,
      helpers,
      pricing: DEFAULT_PRICING,
    }).sessions,
  );

  assert.ok(Array.isArray(sessions));
  assert.equal(sessions.length, 3);
});

test("collectUsageForDate multi-day empty range stays iterable", () => {
  const dates = ["2026-06-01", "2026-06-02", "2026-06-03"];
  const sessions = dates.flatMap((date) =>
    collectUsageForDate(date, {
      lookbackDays: 14,
      homeDir: EMPTY_FIXTURE_HOME,
      helpers,
      pricing: DEFAULT_PRICING,
    }).sessions,
  );

  assert.ok(Array.isArray(sessions));
  assert.deepEqual(sessions, []);
});

test("bin/ctop.js render path does not throw sessions iterable regression", async () => {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["bin/ctop.js"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        HOME: FIXTURE_HOME,
        AI_USAGE_DATE: "2026-06-04",
        AI_USAGE_REFRESH: "60",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        try {
          assert.doesNotMatch(
            stderr,
            /TypeError: collectUsageForDate\(\.\.\.\)\.sessions is not iterable/,
          );
          assert.match(stdout, /CTop 2026-06-04/);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }, 500);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      finish(() => {
        if (code === 0 || signal === "SIGTERM") {
          try {
            assert.doesNotMatch(
              stderr,
              /TypeError: collectUsageForDate\(\.\.\.\)\.sessions is not iterable/,
            );
            assert.match(stdout, /CTop 2026-06-04/);
            resolve();
          } catch (error) {
            reject(error);
          }
          return;
        }

        reject(
          new Error(`bin/ctop.js exited unexpectedly: code=${code} signal=${signal}\n${stderr}`),
        );
      });
    });
  });
});

test("totals ignore rows with unavailable copilot usage and mark partial", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
    pricing: DEFAULT_PRICING,
  });

  const totals = collectUsageTotals(sessions);

  assert.equal(totals.total, 320);
  assert.equal(totals.input, 170);
  assert.equal(totals.output, 100);
  assert.equal(totals.cacheRead, 120);
  assert.equal(totals.reasoning, 10);
  assert.equal(Number(totals.credits.toFixed(3)), 0.041);
  assert.equal(hasPartialData(sessions), true);
});

test("copilot rows without tokens show msg/req metadata", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
    pricing: DEFAULT_PRICING,
  });

  const vscode = sessions.find((session) => session.source === "vscode");
  assert.ok(vscode);
  assert.match(renderSessionMetrics(vscode, 250), /msg:2/);
  assert.match(renderSessionMetrics(vscode, 250), /req:1/);
  assert.match(renderSessionMetrics(vscode, 250), /I:-- O:-- C:-- R:--/);

  const cliNoTokens = {
    provider: "copilot",
    usageAvailable: false,
    messageCount: 3,
    requestCount: 1,
  };
  assert.match(renderSessionMetrics(cliNoTokens, 250), /msg:3/);
  assert.match(renderSessionMetrics(cliNoTokens, 250), /req:1/);
});

test("copilot rows with real tokens keep token display", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
    pricing: DEFAULT_PRICING,
  });

  const cli = sessions.find((session) => session.source === "cli");
  assert.ok(cli);

  const rendered = renderSessionMetrics(cli, cli.total);
  assert.match(rendered, /I:150 O:50 C:40 R:10/);
  assert.doesNotMatch(rendered, /msg:/);
  assert.doesNotMatch(rendered, /req:/);
});

test("row layout shows source near provider", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
    pricing: DEFAULT_PRICING,
  });

  const cli = sessions.find((session) => session.source === "cli");
  const vscode = sessions.find((session) => session.source === "vscode");
  assert.ok(cli);
  assert.ok(vscode);

  assert.match(
    stripAnsi(renderSessionLine(cli, cli.total)),
    /^11:09\s+GH cli\s+g5-mini\s+[█░]+\s+250\s+150\s+50\s+40\s+10\s+9db2…df1b cli\s+--$/,
  );
  assert.match(
    stripAnsi(renderSessionLine(vscode, cli.total)),
    /^11:54\s+GH vscode\s+g4\.1\s+[·░]+\s+--\s+--\s+--\s+--\s+--\s+0262…9d2b vscode.*\s+--$/,
  );
});

test("provider totals keep token totals and metadata-only msg/req totals", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
    pricing: DEFAULT_PRICING,
  });

  const totals = collectProviderTotals(sessions);
  const cx = totals.find((total) => total.providerTag === "CX");
  const gh = totals.find((total) => total.providerTag === "GH");

  assert.ok(cx);
  assert.equal(cx.total, 70);
  assert.equal(cx.input, 20);
  assert.equal(cx.output, 50);
  assert.equal(cx.creditAvailable, true);
  assert.equal(cx.metadataMessageCount, 0);
  assert.equal(cx.metadataRequestCount, 0);

  assert.ok(gh);
  assert.equal(gh.total, 250);
  assert.equal(gh.input, 150);
  assert.equal(gh.output, 50);
  assert.equal(gh.cacheRead, 40);
  assert.equal(gh.reasoning, 10);
  assert.equal(gh.creditAvailable, false);
  assert.equal(gh.metadataMessageCount, 2);
  assert.equal(gh.metadataRequestCount, 1);
});

test("codex footer semantics keep input and total excluding cache reads", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctop-codex-footers-"));
  const sessionDir = path.join(homeDir, ".codex", "sessions", "2026", "06", "22");
  fs.mkdirSync(sessionDir, { recursive: true });

  fs.writeFileSync(
    path.join(sessionDir, "session-1.jsonl"),
    [
      {
        timestamp: "2026-06-22T09:00:00.000Z",
        model: "gpt-5.5",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 0,
              output_tokens: 0,
              cached_input_tokens: 0,
              cache_creation_input_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 0,
            },
          },
        },
        session_id: "session-1",
      },
      {
        timestamp: "2026-06-22T09:15:00.000Z",
        model: "gpt-5.5",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 15091509,
              output_tokens: 86342,
              cached_input_tokens: 14651008,
              cache_creation_input_tokens: 0,
              reasoning_output_tokens: 51379,
              total_tokens: 526843,
            },
          },
        },
        session_id: "session-1",
      },
    ].map((line) => JSON.stringify(line)).join("\n"),
  );

  fs.writeFileSync(
    path.join(sessionDir, "session-2.jsonl"),
    [
      {
        timestamp: "2026-06-22T11:00:00.000Z",
        model: "gpt-5.5",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 0,
              output_tokens: 0,
              cached_input_tokens: 0,
              cache_creation_input_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 0,
            },
          },
        },
        session_id: "session-2",
      },
      {
        timestamp: "2026-06-22T11:30:00.000Z",
        model: "gpt-5.5",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1791740,
              output_tokens: 32475,
              cached_input_tokens: 1641728,
              cache_creation_input_tokens: 0,
              reasoning_output_tokens: 21279,
              total_tokens: 182487,
            },
          },
        },
        session_id: "session-2",
      },
    ].map((line) => JSON.stringify(line)).join("\n"),
  );

  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-22",
    lookbackDays: 1,
    helpers,
    homeDir,
    pricing: DEFAULT_PRICING,
  });

  assert.equal(sessions.length, 2);
  assert.deepEqual(
    sessions.map((session) => ({
      total: session.total,
      input: session.input,
      output: session.output,
      cacheRead: session.cacheRead,
      reasoning: session.reasoning,
    })),
    [
      {
        total: 526843,
        input: 440501,
        output: 86342,
        cacheRead: 14651008,
        reasoning: 51379,
      },
      {
        total: 182487,
        input: 150012,
        output: 32475,
        cacheRead: 1641728,
        reasoning: 21279,
      },
    ],
  );

  const totals = collectUsageTotals(sessions);
  assert.equal(totals.input, 590513);
  assert.equal(totals.output, 118817);
  assert.equal(totals.cacheRead, 16292736);
  assert.equal(totals.total, 709330);
  assert.equal(totals.reasoning, 72658);
  assert.equal(Number(totals.credits.toFixed(3)), 366.586);
});

test("estimateCredits bills cacheCreate at input rate", () => {
  const withoutCacheCreate = estimateCredits({
    model: "g5.2-codex",
    input: 1_000_000,
    cacheCreate: 0,
    cacheRead: 1_000_000,
    output: 1_000_000,
    reasoning: 1_000_000,
  }, DEFAULT_PRICING);
  const withCacheCreate = estimateCredits({
    model: "g5.2-codex",
    input: 1_000_000,
    cacheCreate: 500_000,
    cacheRead: 1_000_000,
    output: 1_000_000,
    reasoning: 1_000_000,
  }, DEFAULT_PRICING);

  assert.equal(
    withoutCacheCreate,
    DEFAULT_PRICING.models["gpt-5.2-codex"].input +
      DEFAULT_PRICING.models["gpt-5.2-codex"].cachedInput +
      DEFAULT_PRICING.models["gpt-5.2-codex"].output,
  );
  assert.equal(
    withCacheCreate - withoutCacheCreate,
    (500_000 / 1_000_000) * DEFAULT_PRICING.models["gpt-5.2-codex"].input,
  );
});

test("estimateCredits ignores reasoning and preserves behavior when cacheCreate is zero", () => {
  const baseSession = {
    model: "g5.4",
    input: 2_000_000,
    cacheCreate: 0,
    cacheRead: 3_000_000,
    output: 4_000_000,
  };

  const expected =
    2 * DEFAULT_PRICING.models["gpt-5.4"].input +
    3 * DEFAULT_PRICING.models["gpt-5.4"].cachedInput +
    4 * DEFAULT_PRICING.models["gpt-5.4"].output;

  assert.equal(estimateCredits(baseSession, DEFAULT_PRICING), expected);
  assert.equal(
    estimateCredits({ ...baseSession, reasoning: 0 }, DEFAULT_PRICING),
    estimateCredits({ ...baseSession, reasoning: 999_999 }, DEFAULT_PRICING),
  );
});

test("estimateCredits exact model lookup uses exact model key", () => {
  const usage = {
    input: 1_000_000,
    cacheCreate: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000,
    reasoning: 123_456,
  };

  assert.equal(
    estimateCredits({ model: "gpt-5.2-codex", ...usage }, DEFAULT_PRICING),
    2 * DEFAULT_PRICING.models["gpt-5.2-codex"].input +
      DEFAULT_PRICING.models["gpt-5.2-codex"].cachedInput +
      DEFAULT_PRICING.models["gpt-5.2-codex"].output,
  );
});

test("estimateCredits alias lookup resolves aliases", () => {
  const usage = {
    input: 1_000_000,
    cacheCreate: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000,
    reasoning: 123_456,
  };

  assert.equal(
    estimateCredits({ model: "g5.2-codex", ...usage }, DEFAULT_PRICING),
    estimateCredits({ model: "gpt-5.2-codex", ...usage }, DEFAULT_PRICING),
  );
  assert.equal(
    estimateCredits({ model: "gpt-5.1-codex-mini", ...usage }, DEFAULT_PRICING),
    estimateCredits({ model: "codex-mini-latest", ...usage }, DEFAULT_PRICING),
  );
  assert.equal(
    estimateCredits({ model: "gpt-5.5", ...usage }, DEFAULT_PRICING),
    estimateCredits({ model: "g5.5", ...usage }, DEFAULT_PRICING),
  );
});

test("estimateCredits unknown models fall back to default pricing", () => {
  const usage = {
    input: 1_000_000,
    cacheCreate: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000,
    reasoning: 123_456,
  };

  assert.equal(
    estimateCredits({ model: "totally-unknown-model", ...usage }, DEFAULT_PRICING),
    estimateCredits({ model: "default", ...usage }, DEFAULT_PRICING),
  );
});

test("estimateCredits alias target missing falls back to default pricing", () => {
  const pricing = {
    models: {
      default: { input: 5, cachedInput: 1, output: 10 },
    },
    aliases: {
      broken: "missing-model",
    },
  };

  assert.deepEqual(
    resolveModelPricing(pricing, "broken"),
    pricing.models.default,
  );
});

test("loadPricing partial override merges with defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctop-pricing-"));
  const file = path.join(dir, "pricing.json");

  fs.writeFileSync(
    file,
    JSON.stringify({
      models: {
        "gpt-5.4": {
          input: 99,
        },
      },
      aliases: {
        local: "gpt-5.4",
      },
    }),
  );

  const pricing = loadPricing({ pricingFile: file });
  assert.equal(pricing.models["gpt-5.4"].input, 99);
  assert.equal(
    pricing.models["gpt-5.4"].cachedInput,
    DEFAULT_PRICING.models["gpt-5.4"].cachedInput,
  );
  assert.equal(pricing.aliases.local, "gpt-5.4");
  assert.equal(pricing.aliases["g5.4"], "gpt-5.4");
});

test("loadPricing uses env pricing file when CLI absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctop-pricing-"));
  const file = path.join(dir, "env-pricing.json");

  fs.writeFileSync(
    file,
    JSON.stringify({
      models: {
        default: { input: 7, cachedInput: 0.7, output: 70 },
      },
    }),
  );

  assert.equal(resolvePricingFile([], { CTOP_PRICING_FILE: file }), file);
  assert.equal(loadPricing({ pricingFile: file }).models.default.input, 7);
});

test("resolvePricingFile prefers CLI over env", () => {
  assert.equal(
    resolvePricingFile(
      ["--pricing-file", "./cli-pricing.json"],
      { CTOP_PRICING_FILE: "./env-pricing.json" },
    ),
    "./cli-pricing.json",
  );
});

test("loadPricing missing file gives clear error", () => {
  assert.throws(
    () => loadPricing({ pricingFile: "/definitely/missing/pricing.json" }),
    /pricing file not found: .*pricing\.json/,
  );
});

test("loadPricing invalid JSON gives clear error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctop-pricing-"));
  const file = path.join(dir, "broken.json");
  fs.writeFileSync(file, "{");

  assert.throws(
    () => loadPricing({ pricingFile: file }),
    new RegExp(`Invalid JSON in pricing file: ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
});

test("Daily Week and Month show CX and GH totals", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
    pricing: DEFAULT_PRICING,
  });

  const daily = renderPeriodLines("Daily", sessions).map(stripAnsi).join("\n");
  const week = renderPeriodLines("Week", sessions).map(stripAnsi).join("\n");
  const month = renderPeriodLines("Month", sessions).map(stripAnsi).join("\n");

  assert.match(daily, /^Daily$/m);
  assert.match(daily, /^SRC\s+TOTAL\s+INPUT\s+OUTPUT\s+CACHE\s+REASON\s+MSG\s+REQ\s+CREDITS$/m);
  assert.match(daily, /^ALL\s+320\s+170\s+100\s+120\s+10\s+-\s+-\s+0\.04$/m);
  assert.match(daily, /^CX\s+70\s+20\s+50\s+80\s+0\s+-\s+-\s+0\.04$/m);
  assert.match(daily, /^GH\s+250\s+150\s+50\s+40\s+10\s+2\s+1\s+--$/m);
  assert.doesNotMatch(daily, /LIMIT|%|🔥/);

  assert.match(week, /^Week$/m);
  assert.match(week, /^SRC\s+TOTAL\s+INPUT\s+OUTPUT\s+CACHE\s+REASON\s+MSG\s+REQ\s+CREDITS$/m);
  assert.match(week, /^ALL\s+320\s+170\s+100\s+120\s+10\s+-\s+-\s+0\.04$/m);
  assert.match(week, /^CX\s+70\s+20\s+50\s+80\s+0\s+-\s+-\s+0\.04$/m);
  assert.match(week, /^GH\s+250\s+150\s+50\s+40\s+10\s+2\s+1\s+--$/m);

  assert.match(month, /^Month$/m);
  assert.match(month, /^GH\s+250\s+150\s+50\s+40\s+10\s+2\s+1\s+--$/m);
});

test("period lines stay unchanged when no Codex limits configured", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
    pricing: DEFAULT_PRICING,
  });

  const week = renderPeriodLines("Week", sessions).map(stripAnsi);
  const month = renderPeriodLines("Month", sessions).map(stripAnsi);

  assert.deepEqual(week, [
    "Week",
    "SRC       TOTAL    INPUT   OUTPUT    CACHE   REASON  MSG  REQ  CREDITS",
    "ALL         320      170      100      120       10    -    -     0.04",
    "CX           70       20       50       80        0    -    -     0.04",
    "GH          250      150       50       40       10    2    1       --",
  ]);
  assert.deepEqual(month, [
    "Month",
    "SRC       TOTAL    INPUT   OUTPUT    CACHE   REASON  MSG  REQ  CREDITS",
    "ALL         320      170      100      120       10    -    -     0.04",
    "CX           70       20       50       80        0    -    -     0.04",
    "GH          250      150       50       40       10    2    1       --",
  ]);
});

test("period lines still render with empty sessions", () => {
  const daily = renderPeriodLines("Daily", []).map(stripAnsi);
  const week = renderPeriodLines("Week", []).map(stripAnsi);
  const month = renderPeriodLines("Month", [], {
    codexMonthlyLimit: 100,
  }).map(stripAnsi);

  assert.deepEqual(daily, [
    "Daily",
    "SRC       TOTAL    INPUT   OUTPUT    CACHE   REASON  MSG  REQ  CREDITS",
    "ALL          --       --       --       --       --    -    -     0.00",
  ]);
  assert.deepEqual(week, [
    "Week",
    "SRC       TOTAL    INPUT   OUTPUT    CACHE   REASON  MSG  REQ  CREDITS",
    "ALL          --       --       --       --       --    -    -     0.00",
  ]);
  assert.match(month[0], /^Month$/);
  assert.match(month[1], /^SRC\s+TOTAL\s+INPUT\s+OUTPUT\s+CACHE\s+REASON\s+MSG\s+REQ\s+CREDITS\s+LIMIT\s*$/);
  assert.match(month[2], /^ALL\s+--\s+--\s+--\s+--\s+--\s+-\s+-\s+0\.00\s+░+\s+0%/);
});

test("period lines append Codex limit progress for CX only", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
    pricing: DEFAULT_PRICING,
  });

  const week = renderPeriodLines("Week", sessions, {
    codexWeeklyLimit: 0.05,
  }).map(stripAnsi);
  const month = renderPeriodLines("Month", sessions, {
    codexMonthlyLimit: 0.06,
  }).map(stripAnsi);
  const daily = renderPeriodLines("Daily", sessions, {
    codexWeeklyLimit: 0.05,
    codexMonthlyLimit: 0.06,
  }).map(stripAnsi);

  assert.equal(daily[1], "SRC       TOTAL    INPUT   OUTPUT    CACHE   REASON  MSG  REQ  CREDITS");
  assert.equal(daily[2], "ALL         320      170      100      120       10    -    -     0.04");
  assert.equal(daily[3], "CX           70       20       50       80        0    -    -     0.04");
  assert.equal(daily[4], "GH          250      150       50       40       10    2    1       --");
  assert.match(week[1], /^SRC\s+TOTAL\s+INPUT\s+OUTPUT\s+CACHE\s+REASON\s+MSG\s+REQ\s+CREDITS\s+LIMIT\s*$/);
  assert.equal(
    week[2],
    "ALL         320      170      100      120       10    -    -     0.04 ████████░░ 82%   ",
  );
  assert.equal(
    week[3],
    "CX           70       20       50       80        0    -    -     0.04 ████████░░ 82%   ",
  );
  assert.match(week[4], /^GH\s+250\s+150\s+50\s+40\s+10\s+2\s+1\s+--\s+-\s*$/);
  assert.equal(
    month[2],
    "ALL         320      170      100      120       10    -    -     0.04 ███████░░░ 68%   ",
  );
  assert.equal(
    month[3],
    "CX           70       20       50       80        0    -    -     0.04 ███████░░░ 68%   ",
  );
});

test("renderProviderTotals keeps fixed columns and dims unavailable values", () => {
  const rendered = renderProviderTotals(
    "Week",
    {
      total: 11_300_000,
      input: 11_200_000,
      output: 133_000,
      cacheRead: 9_700_000,
      reasoning: 34_000,
      credits: 806.91,
    },
    [
      {
        providerTag: "CX",
        total: 11_300_000,
        input: 11_100_000,
        output: 132_000,
        cacheRead: 9_700_000,
        reasoning: 34_000,
        metadataMessageCount: 0,
        metadataRequestCount: 0,
        credits: 806.91,
        creditAvailable: true,
      },
      {
        providerTag: "GH",
        total: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        reasoning: 0,
        metadataMessageCount: 6,
        metadataRequestCount: 3,
        credits: 0,
        creditAvailable: false,
      },
    ],
  );
  const lines = rendered.map(stripAnsi);

  assert.deepEqual(lines, [
    "Week",
    "SRC       TOTAL    INPUT   OUTPUT    CACHE   REASON  MSG  REQ  CREDITS",
    "ALL       11.3M    11.2M     133k     9.7M      34k    -    -   806.91",
    "CX        11.3M    11.1M     132k     9.7M      34k    -    -   806.91",
    "GH           --       --       --       --       --    6    3       --",
  ]);

  assert.match(rendered[1], /\x1b\[2m/);
  assert.match(rendered[2], /\x1b\[33m806\.91\x1b\[0m/);
  assert.match(rendered[4], /\x1b\[2m--\x1b\[0m/);
});

test("resolveCodexLimit prefers CLI over env", () => {
  assert.equal(
    resolveCodexLimit(
      "--codex-weekly-limit",
      "CTOP_CODEX_WEEKLY_LIMIT",
      ["--codex-weekly-limit", "4000"],
      { CTOP_CODEX_WEEKLY_LIMIT: "3000" },
    ),
    4000,
  );
});

test("resolveCodexLimit uses env when CLI absent", () => {
  assert.equal(
    resolveCodexLimit("--codex-monthly-limit", "CTOP_CODEX_MONTHLY_LIMIT", [], {
      CTOP_CODEX_MONTHLY_LIMIT: "15000",
    }),
    15000,
  );
});

test("renderCodexLimitCell colors thresholds and progress bar", () => {
  assert.equal(
    stripAnsi(renderCodexLimitCell(3642.73, 4000)),
    "█████████░ 91%",
  );
  assert.match(renderCodexLimitCell(3642.73, 4000), /\x1b\[33m/);

  assert.equal(
    stripAnsi(renderCodexLimitCell(12495.58, 15000)),
    "████████░░ 83%",
  );

  assert.equal(
    stripAnsi(renderCodexLimitCell(96, 100)),
    "██████████ 96%",
  );
  assert.match(renderCodexLimitCell(96, 100), /\x1b\[31m/);

  assert.equal(
    stripAnsi(renderCodexLimitCell(101, 100)),
    "██████████ 101% 🔥",
  );
  assert.match(renderCodexLimitCell(101, 100), /🔥/);
});

test("missing copilot path does not break codex collection", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: path.resolve("test/fixtures/codex-only-home"),
    pricing: DEFAULT_PRICING,
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].provider, "codex");
});

test("claude provider discovers sessions and sums per-event token usage", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctop-claude-"));
  const projectDir = path.join(homeDir, ".claude", "projects", "-home-pol-code-myproject");
  fs.mkdirSync(projectDir, { recursive: true });

  const sessionId = "aabb1234-5678-9abc-def0-123456789abc";
  const lines = [
    // event on target date with usage
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-22T09:00:00.000Z",
      sessionId,
      message: {
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 300,
        },
      },
    }),
    // second event same session same date
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-22T09:30:00.000Z",
      sessionId,
      message: {
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 50,
          output_tokens: 25,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
      },
    }),
    // event on different date — should not be counted
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-20T12:00:00.000Z",
      sessionId,
      message: {
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 999,
          output_tokens: 999,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    }),
    // non-assistant event — should be ignored
    JSON.stringify({ type: "user", timestamp: "2026-06-22T09:01:00.000Z", sessionId }),
  ];

  fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), lines.join("\n"));

  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-22",
    lookbackDays: 1,
    helpers,
    homeDir,
    pricing: DEFAULT_PRICING,
  });

  assert.equal(sessions.length, 1);
  const session = sessions[0];
  assert.equal(session.provider, "claude");
  assert.equal(session.providerTag, "CC");
  assert.equal(session.model, "claude-opus-4-8");
  assert.equal(session.input, 150);
  assert.equal(session.output, 75);
  assert.equal(session.cacheRead, 300);
  assert.equal(session.cacheCreate, 300);
  assert.equal(session.total, 225);
  assert.equal(session.usageAvailable, true);
  assert.equal(session.creditAvailable, true);
  assert.ok(session.credits > 0);
  assert.equal(session.name, `${sessionId.slice(0, 4)}…${sessionId.slice(-4)}`);
});

test("displayModel strips claude- prefix for display, leaves other models unchanged", () => {
  assert.equal(displayModel("claude-opus-4-8"), "opus-4-8");
  assert.equal(displayModel("claude-sonnet-4-6"), "sonnet-4-6");
  assert.equal(displayModel("claude-haiku-4-5-20251001"), "haiku-4-5-20251001");
  assert.equal(displayModel("gpt-5.5"), "gpt-5.5");
  assert.equal(displayModel("g5-mini"), "g5-mini");
  assert.equal(displayModel("g4.1"), "g4.1");
});

test("claude session renderSessionLine displays stripped model, credits use full model id", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctop-claude-render-"));
  const sessionId = "aabbccdd1122";
  const projectDir = path.join(homeDir, ".claude", "projects", "-home-pol-code-myproject");
  fs.mkdirSync(projectDir, { recursive: true });
  const logFile = path.join(projectDir, `${sessionId}.jsonl`);
  const ts = "2026-06-22T10:00:00.000Z";
  fs.writeFileSync(
    logFile,
    [
      JSON.stringify({ type: "assistant", timestamp: ts, message: { model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
    ].join("\n"),
  );

  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-22",
    lookbackDays: 1,
    helpers,
    homeDir,
    pricing: DEFAULT_PRICING,
  });

  const session = sessions.find((s) => s.provider === "claude");
  assert.ok(session);
  assert.equal(session.model, "claude-opus-4-8", "raw model field must retain full id for pricing");
  assert.ok(session.credits > 0, "credits resolve from full model id");

  const rendered = stripAnsi(renderSessionLine(session, session.total));
  assert.match(rendered, /opus-4-8/, "displayed model has claude- prefix stripped");
  assert.doesNotMatch(rendered, /claude-opus/, "full claude- prefix must not appear in display");
});

test("claude provider returns no sessions when .claude/projects is absent", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctop-claude-empty-"));

  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-22",
    lookbackDays: 1,
    helpers,
    homeDir,
    pricing: DEFAULT_PRICING,
  });

  assert.equal(sessions.filter((s) => s.provider === "claude").length, 0);
});
