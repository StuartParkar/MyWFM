# Database Backup Artifacts

This folder is where restore-validation metadata and backup manifests get
written to (gitignored - see root `.gitignore` for `database/backup/*.bak`).
The executable backup/restore logic lives in `scripts/backup-mywfm.ps1` and
`scripts/restore-mywfm.ps1` (and their `.sh` equivalents); see
`documentation/backup-restore.md` for the full procedure. Nothing in this
folder is committed to source control.
