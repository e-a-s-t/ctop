import { B, D, G, M, R, X, Y, Z } from "./colors.js";

export function strip(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function cell(s, width) {
  return s + " ".repeat(Math.max(0, width - strip(s).length));
}

export function fit(text, width, align = "left") {
  const value = `${text}`.slice(0, width);
  return align === "right" ? value.padStart(width) : value.padEnd(width);
}

export function padVisible(value, width, align = "left") {
  const text = `${value}`;
  const spaces = " ".repeat(Math.max(0, width - strip(text).length));
  return align === "right" ? spaces + text : text + spaces;
}

export function fmt(n = 0) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

export function bar(s, max, width = 16) {
  const used = max > 0 ? Math.max(1, Math.round((s.total / max) * width)) : 0;
  const parts = [
    [B, s.input],
    [G, s.output],
    [X, s.cacheRead],
    [M, s.cacheCreate],
  ];

  let res = "";
  let left = used;

  for (const [color, value] of parts) {
    const len = s.total > 0 ? Math.round((value / s.total) * used) : 0;
    const actual = Math.min(len, left);

    if (actual > 0) {
      res += color + "█".repeat(actual) + Z;
      left -= actual;
    }
  }

  if (left > 0) res += "█".repeat(left);
  if (used < width) res += D + "░".repeat(width - used) + Z;

  return res;
}

export function risk(s, warnTokens) {
  if (s.total >= warnTokens) return `${R}🔥${Z}`;
  if (s.total >= warnTokens * 0.7) return `${Y}⚠${Z}`;
  return `${G}●${Z}`;
}

export function limitColor(percent) {
  if (percent > 100) return R;
  if (percent >= 95) return R;
  if (percent >= 80) return Y;
  return Z;
}

export function limitMarker(percent) {
  return percent > 100 ? "🔥" : "";
}

export function limitBar(percent, width = 16) {
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)));
  return "█".repeat(filled) + D + "░".repeat(width - filled) + Z;
}
