import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { renderSessionMetrics } from "../bin/ctop.js";
import {
  collectSessionsForDate,
  collectUsageTotals,
  hasPartialData,
} from "../lib/providers.js";

const FIXTURE_HOME = path.resolve("test/fixtures/home");

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
