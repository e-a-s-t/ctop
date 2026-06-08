import codex from "./codex.js";
import copilot from "./copilot.js";

export {
  collectProviderTotals,
  collectUsageTotals,
  estimateCredits,
  hasPartialData,
  MODEL_PRICING,
} from "./shared.js";

const providers = [codex, copilot];

export function createProviders() {
  return providers;
}

export function collectSessionsForDate({
  selectedDate,
  lookbackDays,
  helpers,
  homeDir,
}) {
  return providers
    .filter((provider) => provider.isAvailable({ home: homeDir }))
    .flatMap((provider) =>
      provider.loadSessions({
        home: homeDir,
        date: selectedDate,
        lookbackDays,
        helpers,
      }),
    )
    .sort((a, b) => a.time.localeCompare(b.time));
}
