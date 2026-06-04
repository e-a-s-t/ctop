import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  renderProviderTotals,
  renderPeriodLines,
  renderSessionLine,
  renderSessionMetrics,
} from "../bin/ctop.js";
import {
  collectProviderTotals,
  collectSessionsForDate,
  collectUsageTotals,
  estimateCredits,
  hasPartialData,
  MODEL_PRICING,
} from "../lib/providers.js";

const FIXTURE_HOME = path.resolve("test/fixtures/home");
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
  });

  assert.equal(sessions.length, 3);

  const codex = sessions.find((session) => session.provider === "codex");
  assert.ok(codex);
  assert.equal(codex.model, "g5.5");
  assert.equal(codex.total, 230);
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

test("totals ignore rows with unavailable copilot usage and mark partial", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
  });

  const totals = collectUsageTotals(sessions);

  assert.equal(totals.total, 480);
  assert.equal(totals.input, 250);
  assert.equal(totals.output, 100);
  assert.equal(totals.cacheRead, 120);
  assert.equal(totals.reasoning, 10);
  assert.equal(Number(totals.credits.toFixed(3)), 0.051);
  assert.equal(hasPartialData(sessions), true);
});

test("copilot rows without tokens show msg/req metadata", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
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
  });

  const cli = sessions.find((session) => session.source === "cli");
  const vscode = sessions.find((session) => session.source === "vscode");
  assert.ok(cli);
  assert.ok(vscode);

  assert.match(stripAnsi(renderSessionLine(cli, cli.total)), /11:09 GH cli\s+g5-mini/);
  assert.match(
    stripAnsi(renderSessionLine(vscode, cli.total)),
    /11:54 GH vscode\s+g4.1/,
  );
});

test("provider totals keep token totals and metadata-only msg/req totals", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
  });

  const totals = collectProviderTotals(sessions);
  const cx = totals.find((total) => total.providerTag === "CX");
  const gh = totals.find((total) => total.providerTag === "GH");

  assert.ok(cx);
  assert.equal(cx.total, 230);
  assert.equal(cx.input, 100);
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

test("estimateCredits bills cacheCreate at input rate", () => {
  const withoutCacheCreate = estimateCredits({
    model: "g5.2-codex",
    input: 1_000_000,
    cacheCreate: 0,
    cacheRead: 1_000_000,
    output: 1_000_000,
    reasoning: 1_000_000,
  });
  const withCacheCreate = estimateCredits({
    model: "g5.2-codex",
    input: 1_000_000,
    cacheCreate: 500_000,
    cacheRead: 1_000_000,
    output: 1_000_000,
    reasoning: 1_000_000,
  });

  assert.equal(
    withoutCacheCreate,
    MODEL_PRICING["g5.2-codex"].input +
      MODEL_PRICING["g5.2-codex"].cache +
      MODEL_PRICING["g5.2-codex"].output,
  );
  assert.equal(
    withCacheCreate - withoutCacheCreate,
    (500_000 / 1_000_000) * MODEL_PRICING["g5.2-codex"].input,
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
    2 * MODEL_PRICING["g5.4"].input +
    3 * MODEL_PRICING["g5.4"].cache +
    4 * MODEL_PRICING["g5.4"].output;

  assert.equal(estimateCredits(baseSession), expected);
  assert.equal(
    estimateCredits({ ...baseSession, reasoning: 0 }),
    estimateCredits({ ...baseSession, reasoning: 999_999 }),
  );
});

test("estimateCredits resolves aliases and unknown models use default pricing", () => {
  const usage = {
    input: 1_000_000,
    cacheCreate: 1_000_000,
    cacheRead: 1_000_000,
    output: 1_000_000,
    reasoning: 123_456,
  };

  assert.equal(
    estimateCredits({ model: "gpt-5.2-codex", ...usage }),
    estimateCredits({ model: "g5.2-codex", ...usage }),
  );
  assert.equal(
    estimateCredits({ model: "gpt-5.1-codex-mini", ...usage }),
    estimateCredits({ model: "codex-mini-latest", ...usage }),
  );
  assert.equal(
    estimateCredits({ model: "gpt-5.5", ...usage }),
    estimateCredits({ model: "g5.5", ...usage }),
  );
  assert.equal(
    estimateCredits({ model: "totally-unknown-model", ...usage }),
    estimateCredits({ model: "default", ...usage }),
  );
});

test("Week and Month show CX and GH totals", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: FIXTURE_HOME,
  });

  const week = renderPeriodLines("Week", sessions).map(stripAnsi).join("\n");
  const month = renderPeriodLines("Month", sessions).map(stripAnsi).join("\n");

  assert.match(week, /^Week$/m);
  assert.match(week, /^SRC\s+TOTAL\s+INPUT\s+OUTPUT\s+CACHE\s+REASON\s+MSG\s+REQ\s+CREDITS$/m);
  assert.match(week, /^ALL\s+480\s+250\s+100\s+120\s+10\s+-\s+-\s+0\.05$/m);
  assert.match(week, /^CX\s+230\s+100\s+50\s+80\s+0\s+-\s+-\s+0\.05$/m);
  assert.match(week, /^GH\s+250\s+150\s+50\s+40\s+10\s+2\s+1\s+--$/m);

  assert.match(month, /^Month$/m);
  assert.match(month, /^GH\s+250\s+150\s+50\s+40\s+10\s+2\s+1\s+--$/m);
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

test("missing copilot path does not break codex collection", () => {
  const sessions = collectSessionsForDate({
    selectedDate: "2026-06-04",
    lookbackDays: 14,
    helpers,
    homeDir: path.resolve("test/fixtures/codex-only-home"),
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].provider, "codex");
});
