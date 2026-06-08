import { collectProviderTotals, collectUsageTotals } from "../providers/index.js";
import { D, Y, Z } from "./colors.js";
import { colorProviderTag } from "./colors.js";
import { fmt, limitBar, limitColor, limitMarker, padVisible } from "./bars.js";

function providerCell(value, width) {
  return padVisible(colorProviderTag(value), width);
}

function usageCell(total, key, width) {
  if (total.total <= 0) return padVisible(`${D}--${Z}`, width, "right");
  return padVisible(fmt(total[key]), width, "right");
}

function metaCell(value, width) {
  return padVisible(value > 0 ? `${value}` : `${D}-${Z}`, width, "right");
}

function creditsCell(value, available, width) {
  if (!available) return padVisible(`${D}--${Z}`, width, "right");
  return padVisible(`${Y}${value.toFixed(2)}${Z}`, width, "right");
}

function findCodexCredits(providerTotals) {
  return providerTotals.find((total) => total.providerTag === "CX")?.credits ?? 0;
}

export function renderCodexLimitCell(credits, limit) {
  if (!(limit > 0)) return null;

  const percent = Math.round((credits / limit) * 100);
  const color = limitColor(percent);
  const marker = limitMarker(percent);
  const content = `${color}${limitBar(percent, 10)} ${percent}%${Z}`;
  return marker ? `${content} ${marker}` : content;
}

function periodLimitCell(providerTag, credits, limit, width) {
  if (!(limit > 0)) return null;
  if (providerTag !== "ALL" && providerTag !== "CX") return padVisible(`${D}-${Z}`, width);
  return padVisible(renderCodexLimitCell(credits, limit), width);
}

export function renderProviderTotals(periodName, totals, providerTotals, options = {}) {
  const limit = options.codexLimit ?? null;
  const columns = [
    ["SRC", 6, "left"],
    ["TOTAL", 8, "right"],
    ["INPUT", 8, "right"],
    ["OUTPUT", 8, "right"],
    ["CACHE", 8, "right"],
    ["REASON", 8, "right"],
    ["MSG", 4, "right"],
    ["REQ", 4, "right"],
    ["CREDITS", 8, "right"],
  ];
  if (limit > 0) columns.push(["LIMIT", 17, "left"]);

  const header = `${D}${columns
    .map(([label, width, align]) => padVisible(label, width, align))
    .join(" ")}${Z}`;

  const codexCredits = findCodexCredits(providerTotals);
  const rows = [
    {
      providerTag: "ALL",
      total: totals.total,
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      reasoning: totals.reasoning,
      metadataMessageCount: 0,
      metadataRequestCount: 0,
      credits: totals.credits,
      creditAvailable: true,
    },
    ...providerTotals,
  ];

  return [
    periodName,
    header,
    ...rows.map((total) => {
      const cells = [
        providerCell(total.providerTag, 6),
        usageCell(total, "total", 8),
        usageCell(total, "input", 8),
        usageCell(total, "output", 8),
        usageCell(total, "cacheRead", 8),
        usageCell(total, "reasoning", 8),
        metaCell(total.metadataMessageCount, 4),
        metaCell(total.metadataRequestCount, 4),
        creditsCell(total.credits, total.creditAvailable, 8),
      ];
      if (limit > 0) cells.push(periodLimitCell(total.providerTag, codexCredits, limit, 17));
      return cells.join(" ");
    }),
  ];
}

export function renderPeriodLines(label, sessions, options = {}) {
  const totals = collectUsageTotals(sessions);
  const providers = collectProviderTotals(sessions);
  let codexLimit = null;
  if (label === "Week") codexLimit = options.codexWeeklyLimit;
  if (label === "Month") codexLimit = options.codexMonthlyLimit;
  return renderProviderTotals(label, totals, providers, {
    codexLimit,
  });
}
