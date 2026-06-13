# Rollback

Rollback must restore the previous manifest, module artifact set, profile
metadata, and local route/depot recovery cache.

Rollback is not release-ready until the Launcher proves:

- Previous Standalone module artifacts are retained or re-downloadable.
- Save/profile data remains readable after rollback.
- Survey catalog state does not advance or reset unexpectedly.
- Failed update attempts leave a repairable profile.
