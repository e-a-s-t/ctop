import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRICING_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRICING_FILE = path.join(PRICING_DIR, "default-pricing.json");

function readJson(file, label) {
  let text;

  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`${label} not found: ${file}`);
    }
    throw new Error(`Failed to read ${label}: ${file}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in ${label}: ${file}`);
  }
}

function validatePricingShape(value, label, file) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid pricing config in ${label}: ${file} (expected object)`);
  }

  if (!value.models || typeof value.models !== "object" || Array.isArray(value.models)) {
    throw new Error(`Invalid pricing config in ${label}: ${file} (expected models object)`);
  }

  if ("aliases" in value && (!value.aliases || typeof value.aliases !== "object" || Array.isArray(value.aliases))) {
    throw new Error(`Invalid pricing config in ${label}: ${file} (expected aliases object)`);
  }
}

function mergePricing(defaults, override) {
  const models = { ...defaults.models };

  for (const [name, model] of Object.entries(override.models ?? {})) {
    models[name] = {
      ...(defaults.models[name] ?? {}),
      ...model,
    };
  }

  return {
    models,
    aliases: {
      ...(defaults.aliases ?? {}),
      ...(override.aliases ?? {}),
    },
  };
}

export function resolveModelPricing(pricing, model) {
  if (pricing.models[model]) return pricing.models[model];

  const aliasTarget = pricing.aliases[model];
  if (aliasTarget && pricing.models[aliasTarget]) return pricing.models[aliasTarget];

  return pricing.models.default;
}

export function loadPricing({ pricingFile } = {}) {
  const defaults = readJson(DEFAULT_PRICING_FILE, "default pricing file");
  validatePricingShape(defaults, "default pricing file", DEFAULT_PRICING_FILE);

  if (!pricingFile) return defaults;

  const resolvedFile = path.resolve(pricingFile);
  const override = readJson(resolvedFile, "pricing file");
  validatePricingShape(override, "pricing file", resolvedFile);
  return mergePricing(defaults, override);
}

export const DEFAULT_PRICING = loadPricing();
