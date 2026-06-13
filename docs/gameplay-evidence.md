# Gameplay Evidence

Galactic Survey Standalone Edition cannot be promoted from preview metadata until
real manual gameplay evidence exists for the public `0.1.0` alpha package.

## Required Claims

Fill `fixtures/galactic-survey/gameplay-qa/manual-evidence.json` from the
template in this repo only after a real playthrough has produced the files it
references. Every claim must be true:

- `realFirst30Playthrough`: fresh install reaches the 30-minute route gate.
- `realFirst2HourPlaythrough`: the same route reaches the 2-hour systems gate.
- `realSurveyArrayPlaythrough`: Survey Array completion is reached and recorded.
- `freshWorldCreated`: the run starts from a fresh Galactic Survey profile.
- `saveReloadVerified`: the profile is saved, closed, reopened, and still valid.
- `noCrashEvidence`: logs and support review show no blocking crash.

Launcher install/update/repair/rollback evidence is verified by the Release Index
launcher lifecycle reports, not by this manual gameplay file.

## Required Sessions

- `fresh_world_creation`
- `first_30_minutes`
- `first_2_hours`
- `survey_array_completion`
- `save_reload_verification`
- `no_crash_review`

## Required Release Gates

Each entry in `releaseGates` must match
`fixtures/galactic-survey/gameplay-qa/release-gates.contract.json` and must be
set to `satisfied: true` only after the referenced real evidence exists.
Template evidence keeps every gate false.

- `probe_launch_works`
- `holomap_reveals_meaningful_data`
- `catalog_entries_unlock_from_discoveries`
- `fuel_route_limits_understandable`
- `one_salvage_site_playable`
- `one_probe_upgrade_matters`
- `first_2_hour_loop_no_dead_end`
- `real_first_30_playthrough`
- `real_first_2_hour_playthrough`
- `real_survey_array_playthrough`
- `fresh_world_created`
- `save_reload_verified`
- `no_crash_evidence`

Launcher lifecycle evidence remains a public promotion requirement, but it is
owned by `ECHO-Release-Index/release-readiness/galactic-survey-launcher-lifecycle-smoke.json`
and `ECHO-Release-Index/release-readiness/galactic-survey-electron-ui-smoke.json`.

## Verification

Initialize the evidence capture layout before the manual run:

```powershell
node scripts\init-manual-gameplay-evidence.mjs
```

Template-mode CI check:

```powershell
node scripts\verify-manual-gameplay-evidence.mjs --template-only
```

Edition manifest and release-gate drift check:

```powershell
node scripts\validate-galactic-survey-edition.mjs --root .
```

When `ECHO-Modules` is available as a sibling repository, the edition validator
also compares this repo's release-gate contract against the canonical
`echogalacticsurveyprotocol` `release_gates.json`. Use `--module-root` to point
at a different local module checkout.

Release-ready local check:

```powershell
node scripts\verify-manual-gameplay-evidence.mjs --require-release-ready
```
