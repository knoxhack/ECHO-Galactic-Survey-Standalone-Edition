# ECHO Galactic Survey Standalone Edition

Galactic Survey Standalone Edition is the ECHO Standalone Runtime packaging lane for
`ECHO: Galactic Survey`.

## Role

- Consumes `-standalone.jar` artifacts from `ECHO-Modules`.
- Uses `echogalacticsurveyprotocol` as the canonical Galactic Survey content
  source.
- Installs the survey spine modules required for probes, HoloMap routing,
  orbital salvage, catalog progression, logistics, and survey UI.
- Publishes Standalone install, update, repair, and rollback manifests for the ECHO
  Launcher after evidence exists.
- Does not own gameplay registries, balancing, names, textures, sounds, recipes,
  or progression data.

## Source Repos

- Protocol module: `knoxhack/ECHO-Modules/addons/echogalacticsurveyprotocol`
- Runtime: `knoxhack/ECHO-Standalone-Runtime`
- SDK templates: `knoxhack/ECHO-SDK`
- Release index: `knoxhack/ECHO-Release-Index`
- Planned repo: `knoxhack/ECHO-Galactic-Survey-Standalone-Edition`

## Status

Implementation foundation only. Keep this edition preview-only until the Standalone
artifact, launcher install flow, update flow, repair flow, rollback flow, first
30-minute playthrough, first 2-hour playthrough, and Survey Array completion
evidence all pass.

Gameplay evidence must follow `docs/gameplay-evidence.md` and the template at
`fixtures/galactic-survey/gameplay-qa/manual-evidence.template.json`.
