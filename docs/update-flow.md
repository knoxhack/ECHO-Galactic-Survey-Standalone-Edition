# Update Flow

Updates must preserve player profiles, survey network state, probe queues,
catalog progress, route depot inventories, salvage recovery state, and rollback
metadata.

The Launcher should update changed module artifacts individually when Release
Index metadata provides URLs and SHA-256 hashes. If an individual module artifact
cannot be resolved, the update flow must fall back to a full pack archive or
block the update with a readable diagnostic.
