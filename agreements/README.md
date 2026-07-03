# CLA agreement texts

This folder holds the versioned Contributor License Agreement texts that the
operator provides. The individual and corporate texts live here under versioned
names, for example `Individual-CLA-v1.md` and `Corporate-CLA-v1.md`.

The current version in force is whatever `config/cla.config.json` points at
(`icla.file` and `ccla.file`). The version label in the config is set to match
the file name stem exactly (for example `Individual-CLA-v1`), so the label and
the text it names never drift.

Every version is retained here permanently. An old version file is the exact text
that past contributors signed, so it is kept as signed history evidence. Never
delete a previous version. To publish a new version, add a new file (for example
`Individual-CLA-v2.md`) alongside the existing ones and repoint the config; leave
all earlier version files in place.
