import claude from "./claude.js";
import codex from "./codex.js";
import copilot from "./copilot.js";
import { DEFAULT_PRICING } from "../pricing/index.js";

export {
  collectProviderTotals,
  collectUsageTotals,
  estimateCredits,
  hasPartialData,
} from "./shared.js";

const providers = [codex, copilot, claude];

export function createProviders() {
  return providers;
}

export function collectSessionsForDate({
  selectedDate,
  lookbackDays,
  helpers,
  homeDir,
  pricing = DEFAULT_PRICING,
}) {
  return providers
    .filter((provider) => provider.isAvailable({ home: homeDir }))
    .flatMap((provider) =>
      provider.loadSessions({
        home: homeDir,
        date: selectedDate,
        lookbackDays,
        helpers,
        pricing,
      }),
    )
    .sort((a, b) => a.time.localeCompare(b.time));
}
