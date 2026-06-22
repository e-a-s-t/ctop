use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, fs, path::Path, sync::OnceLock};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ModelPricing {
    pub input: f64,
    #[serde(rename = "cachedInput")]
    pub cached_input: f64,
    pub output: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Pricing {
    pub models: HashMap<String, ModelPricing>,
    #[serde(default)]
    pub aliases: HashMap<String, String>,
}

const DEFAULT_PRICING_JSON: &str = include_str!("../../bin/pricing/default-pricing.json");

static DEFAULT_PRICING: OnceLock<Pricing> = OnceLock::new();

pub fn default_pricing() -> &'static Pricing {
    DEFAULT_PRICING.get_or_init(|| {
        serde_json::from_str(DEFAULT_PRICING_JSON).expect("bundled pricing json must be valid")
    })
}

pub fn load_pricing(path: Option<&Path>) -> Result<Pricing> {
    let defaults =
        serde_json::to_value(default_pricing()).context("failed to serialize default pricing")?;

    let Some(path) = path else {
        return Ok(default_pricing().clone());
    };

    let text = fs::read_to_string(path)
        .with_context(|| format!("failed to read pricing file: {}", path.display()))?;
    let override_value: Value = serde_json::from_str(&text)
        .with_context(|| format!("invalid JSON in pricing file: {}", path.display()))?;

    let merged = merge_values(defaults, override_value);
    serde_json::from_value(merged).context("merged pricing config has an invalid shape")
}

pub fn load_pricing_from_env() -> Result<Pricing> {
    let path = std::env::var_os("CTOP_PRICING_FILE").map(std::path::PathBuf::from);
    load_pricing(path.as_deref())
}

fn merge_values(defaults: Value, override_value: Value) -> Value {
    match (defaults, override_value) {
        (Value::Object(mut base), Value::Object(override_map)) => {
            for (key, override_entry) in override_map {
                let next = match base.remove(&key) {
                    Some(existing) => merge_values(existing, override_entry),
                    None => override_entry,
                };
                base.insert(key, next);
            }
            Value::Object(base)
        }
        (_, override_value) => override_value,
    }
}

pub fn resolve_model_pricing<'a>(pricing: &'a Pricing, model: &str) -> &'a ModelPricing {
    if let Some(found) = pricing.models.get(model) {
        return found;
    }

    if let Some(alias_target) = pricing.aliases.get(model) {
        if let Some(found) = pricing.models.get(alias_target) {
            return found;
        }
    }

    pricing
        .models
        .get("default")
        .expect("bundled pricing must contain default model")
}

pub fn estimate_credits(session: &crate::model::TokenUsage, model: &str, pricing: &Pricing) -> f64 {
    let model_pricing = resolve_model_pricing(pricing, model);

    ((session.input + session.cache_create) as f64 / 1_000_000.0) * model_pricing.input
        + (session.cache_read as f64 / 1_000_000.0) * model_pricing.cached_input
        + (session.output as f64 / 1_000_000.0) * model_pricing.output
}

pub fn resolve_limit(env_name: &str) -> Option<f64> {
    let raw = std::env::var(env_name).ok()?;
    let value = raw.parse::<f64>().ok()?;
    if value > 0.0 { Some(value) } else { None }
}
