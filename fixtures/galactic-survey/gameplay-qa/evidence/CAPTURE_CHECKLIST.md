# Capture Checklist

Capture real evidence before any public alpha handoff:

- Prepare a checksum-bound capture folder with
  `node scripts\prepare-manual-gameplay-capture.mjs --tester <id> --world-or-profile <profile> --started-at <iso>`.
- Fresh profile/world creation.
- First 30-minute route completion.
- First 2-hour route completion.
- Survey Array completion.
- Save/reload verification.
- No-crash log review.
- Current Release Index launcher lifecycle reports are present for install,
  update, repair, and rollback.
- Import the completed capture bundle with
  `node scripts\import-manual-gameplay-capture.mjs --capture-root <folder> --artifact <pack.zip> --tester <id> --world-or-profile <profile> --started-at <iso> --force`.
- Re-run `node scripts\verify-manual-gameplay-evidence.mjs --require-release-ready`
  after import.

Do not replace missing evidence with placeholder screenshots, empty logs, or
template notes. The importer rejects template markers, placeholder text,
non-PNG screenshots, non-ZIP save snapshots, artifact mismatches, missing
capture manifests, and accidental overwrites.
