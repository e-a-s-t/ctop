# Changelog

## v0.2.0

### Added

- Weekly and monthly summaries
- GitHub Copilot support
- Configurable Codex limits and progress bars
- External pricing JSON
- Custom pricing override support:
  - `--pricing-file`
  - `CTOP_PRICING_FILE`

### Changed

- Improved dashboard layout
- Daily summary now uses the same table layout as Week and Month
- Daily provider split shows ALL, CX and GH rows
- Removed the old Σ line
- Credit calculation now includes cacheCreate tokens

### Internal

- Provider parsing split into separate modules
- Pricing moved from code into JSON
- Dashboard rendering moved into dedicated modules
- Removed `lib/`

## v0.1.0

- Initial release
- Live dashboard
- Session view
- Daily totals
