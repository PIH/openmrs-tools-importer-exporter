# Site migration: source server into ZL Central

This is the way to run a migration. It replaces the wiki page "Merging Systems: Migration Steps" (page 3785490446, v126). The page stays for reference, but where the two differ, this file wins.

The scripts in this folder are numbered `00` to `24`. Run them in order, from your laptop. Each script:

- says what it is about to do,
- prints the exact command or SQL before it runs it,
- asks before it changes anything (type `y` or `yes`; there is no option to skip the question),
- shows the result and says what to check and which script comes next.

The scripts do the typing and the counting. You read the output and decide whether to go on. A script never says "PASS" for you.

The migration is run by a person with these scripts. Nothing here needs any other tool.

## Setup

### Laptop

- `bash`, `ssh`, `git`. Linux or macOS. Nothing else is needed on the laptop (no node, no python3, no docker). The scripts run everything on the servers over SSH. (Not so when the laptop is the target in a test: see "Laptop as target".)
- An ssh host alias for each server in `~/.ssh/config`, so that `ssh <alias>` logs in without a password prompt. Use the aliases as `SOURCE_HOST` and `TARGET_HOST`. The scripts add `ServerAliveInterval=30` / `ServerAliveCountMax=6`, so long silent commands are not cut by idle timeouts and a dead connection fails within about 3 minutes.
- Get this repo with git and run the scripts from `migration/`.

### Servers (source and target)

- `docker`, `tmux`, `python3`, `git` on both servers, and `7z` (p7zip) on the target (24 makes the encrypted archive with it). 01 checks all of them.
- The ssh user can run `sudo` without a password (MySQL runs in a docker container, and the OpenMRS data folders are owned by tomcat).
- A work folder owned by the ssh user, for example `/home/<you>/migration` (`SOURCE_SERVER_DIR` and `TARGET_SERVER_DIR`). The importer checkout, the export files, the mappings and the logs go there. Nothing is installed on the host: node runs in a docker container (`NODE_IMAGE`, pulled if missing) against a git checkout of this repo in `<SERVER_DIR>/repo`.
- The servers must be able to reach github (for the checkout) and the docker registry (for the node image), or have both already.

### Settings file

One settings file per migration. Keep it outside the repo (for example `~/migrations/hsn/migration.env`). It holds host names, user names and uuids. It holds no passwords: MySQL passwords are read from the MySQL container itself (`container-env`) or typed once per script (`prompt`).

Create it with:

    ./migration/00-create-settings.sh ~/migrations/hsn/migration.env

It copies `migration.env.example`, asks for each value with the default shown, and offers lookups from the servers where it can (container names, databases, facility uuid, dossier prefixes). Run it again any time to change values. The file is written with mode 600.

Tell the other scripts where it is, either way:

    export MIGRATION_ENV=~/migrations/hsn/migration.env
    ./migration/01-preflight.sh
    # or
    ./migration/01-preflight.sh ~/migrations/hsn/migration.env

`migration.env.example` lists every setting with a comment. Do not commit the real file.

### Where things are

- Laptop work folder: `WORKDIR` from the settings file. Logs of every script (`logs/`), uuid lists (`lists/`), mapping files and review lists (`mappings/`), row-count snapshots (`counts/`). See "Files written".
- Source server: `SOURCE_SERVER_DIR` (repo, lists, export JSON, logs).
- Target server: `TARGET_SERVER_DIR` (repo, mappings, exported JSON, logs, zips).
- Long runs (13, 15, 17, 19) run in `tmux` on the server, so they survive the laptop going to sleep. Attach on the server with `tmux attach -t <session>` (`export`, `import-users`, `import-patients`, `verify`) if you want to watch. You do not have to.

## Test mode and real mode

`MIGRATION_MODE` in the settings file is `test` or `real`. Every script shows it in its header.

**Test mode** is for trying the run with a production source and a target that is not production. Nothing is changed on the source:

- Any SQL write or service command on the source is refused inside `lib.sh` (exit 3).
- 03 (lock source), 04 (backup source), 08 (check no sessions) and 23 (shut down source) print "skipped in test mode" and do nothing.
- Read-only SQL on the source still runs (counts, mapping inputs, lists, hashes).
- On the source, only files in `SOURCE_SERVER_DIR` are written: the repo checkout, the lists, the export JSON, and the node image pulled by docker. 24 removes the files.
- Because the source users are not retired, 22 finds no `Migrating from <source>` users to un-retire. It says so. That is expected.
- 16 (copy password hashes) still runs, so it is tested. Set `SKIP_HASH_COPY_IN_TEST=true` to skip it.
- The export reads the live source through REST. Run it at a quiet time.

**Real mode** is the actual migration. Both servers are locked, and the target is opened at step 22.

**Laptop as target:** set `TARGET_HOST=local`. Commands for the target then run directly on the laptop instead of over SSH. Set `TARGET_DOCKER=docker` (no sudo), `TARGET_FILE_SUDO=` (empty) if you do not need sudo, and the container, restart command and wait URL for your local server (for example the SDK's `mysql-openmrs` and a command that restarts it). The copy steps then become `ssh <source> tar c | tar x` into the local folder. `SOURCE_HOST=local` works the same way.

The laptop then needs everything the target needs: `docker`, `tmux`, `python3` and `7z`, a work folder for `TARGET_SERVER_DIR`, and a local OpenMRS whose MySQL runs in a docker container (for example the SDK's `mysql-openmrs`). 01 checks these on the laptop the same way it checks a server.

## Server-to-server SSH

The source and target servers cannot SSH to each other at the moment. So everything that crosses from one server to the other goes through the laptop as a stream:

    ssh source '...' | ssh target '...'

This applies to the export JSON (14), the user, provider and concept rows used for the mappings (09, 10), the password hashes (16), the file zips (18) and the source logs for the archive (24). The laptop does not store these streams (only the mapping and list files in `WORKDIR`, see below).

This may change. It is to be researched with IT. If the servers can reach each other, these steps can be simplified (copy directly with `rsync` or `scp`, and no laptop in the middle). The helper is `pipe_src_to_tgt` in `lib.sh`, which has the same comment.

## The steps

Steps in order. Numbers in square brackets are the step numbers on the old wiki page. "Check" is what to look at before going on. Each script also prints its own "next step" line.

### Before the day

Steps 00 to 02 can be run days earlier, and again on the day.

**00 `00-create-settings.sh`** Create or edit the settings file (see Setup).
- Check: open the file once and look at the values.

**01 `01-preflight.sh`** Checks every setting against the servers: SSH to both, sudo, docker containers, MySQL reachable, databases exist, facility uuid exists on both sides, dossier prefix exists on the target, optional mapping files exist, `ORDER_NUMBER_PREFIX` is letters and digits only (the exporter refuses anything else), `tmux`, `python3`, `git` and the node image on both servers (offers to pull the image), `7z` on the target, free disk, PIH EMR versions of both sides side by side. [1]
- Check: every line says OK. Fix any PROBLEM in the settings file and run it again. Compare the two EMR versions.

**02 `02-check-source-data.sh`** Read-only. Health Center attribute set on all source patients [2] and on the target [3]. Counts of data the migration does not carry over (both appointment types, conditions, diagnoses, notes, paper records) [4]. Providers without user accounts [18.3.1, as a count].
- Check: every unsupported-data count above 0 needs a decision before you lock anything. Same for patients with no Health Center.
- Manual reminders it prints: ID/card printing [5], CommCare [44], ETL [45].

### On the day: lock both servers

**03 `03-lock-source.sh`** Retires every source user except the migrating user, with the reason `Migrating from <SOURCE_NAME>`. Shows the counts before and after; if any user is still not retired afterwards (for example one created during the update), it stops with exit 1: run it again. [8] Skipped in test mode.
- Do by hand: disable 2FA for the migrating user on the source [6.1]. Disable the backups in cron on the source and on the target [7, 11] (one reminder for both; the wiki lists it twice).
- Check: only the migrating user can still log in.

**04 `04-backup-source.sh`** Runs the source backup commands (`SOURCE_BACKUP_CMDS`), each shown and confirmed. [9] Skipped in test mode.
- Check: the backup files are on the server and look the right size.

**05 `05-lock-target.sh`** Retires every target user except the migrating user and `ccIntegrationUser`, with the reason `Temp - migrating data`. [10]
- Check: only those two can still log in. (Keeping `ccIntegrationUser` open is still to be tested, see Open items.)

**06 `06-backup-target.sh`** The same backup commands on the target (`TARGET_BACKUP_CMDS`). [12]
- Check: the backup files are on the target and look the right size.

**07 `07-prepare-target.sh`** Three parts, each shown and confirmed. (1) Sets the target's dossier number sequence (found by `DOSSIER_PREFIX` in `idgen_seq_id_gen`) to the source's value; warns if the source value is lower. [13-15] (2) Adds `hibernate.search.indexing.listeners.enabled=false` to the target's runtime properties. Puppet manages that file and may overwrite the change; if puppet runs during the migration, check the line is still there. [16] (3) Restarts the target and waits until it answers. [16]
- Check: the login page loads and the dossier sequence is as printed.

**08 `08-check-no-sessions.sh`** Restarts the source OpenMRS, which drops all logged-in sessions (they are kept in memory, there is nothing to query). [17] Skipped in test mode.
- Check: the source is back up and nobody is logged in.

### On the day: mappings and lists

Run these after both servers are locked, so users and concepts added on the day are included. 09 and 10 can also be run earlier as a preview.

**09 `09-build-user-mappings.sh`** Builds the user and provider mappings by matching username first, then email. Only uuid, username, email, retired state and retire reason of the source users cross (no password hashes). Writes `WORKDIR/mappings/`: `user_mappings.csv`, `provider_mappings.csv` (always ends with the `UnknownProvider` line), and the review lists `review-email-conflicts.csv`, `unmatched-users.csv`, `fyi-retired-differs.csv`. [18]
- Check: read the review lists. Duplicate or conflicting email matches are listed for you to decide; the script does not choose. Matching ignores retired state; a pair whose retired state differs is mapped and listed as FYI. Users retired by this migration's locks count as not retired: source users retired by 03 (`Migrating from <SOURCE_NAME>`) and target users retired by 05 (`Temp - migrating data`). For a second or later site into the same target, the earlier import is already in, so its users are matched too.
- Your decisions (a conflict resolved, an unmatched user mapped by hand) go in `WORKDIR/mappings/user_mappings.manual.csv` and `provider_mappings.manual.csv`, one line per source user or provider, in the importer's format `<source-uuid> <label>,<target-uuid>` (lines starting with `#` and blank lines are ignored). Never edit `user_mappings.csv` or `provider_mappings.csv`: every run of 09 rewrites them. 09 never writes the `.manual` files. On every run it merges them in: a manual line replaces the generated line for the same source uuid, and 09 prints how many manual lines it applied. A line in the wrong format, or a source uuid listed twice, stops 09 (exit 2). Run 09 again after editing a `.manual` file, then 12 to copy the result up.

**10 `10-build-concept-name-mappings.sh`** Finds coded-value concept names used by source obs that do not exist by uuid on the target, and drafts a mapping line for each where the target has the same concept with the same text, locale and type. Writes `WORKDIR/mappings/concept_name_mappings.draft.csv`, `concept-names-no-candidate.csv` and `concept-mappings-voided-target.csv` (existing mapping lines whose target name is voided; only if `EXPORT_CONCEPT_NAME_MAPPINGS_FILE` is set). The mappings file itself is never changed. [19]
Source names the existing mappings file already maps are left out of the draft and the no-candidate list (the count is printed).
- Check: review the draft and the other two files, then merge what you accept into the concept name mappings file and set `EXPORT_CONCEPT_NAME_MAPPINGS_FILE` to it. 10 prints the merge: an append of the draft to the existing file into `<file>.merged` (`awk 1`, which is `cat` that also ends a last line without a line break), and a duplicate-key check that must print nothing.

**11 `11-build-lists.sh`** Builds the uuid lists the exporter works through: users, providers, non-voided patients, relationships. Writes `WORKDIR/lists/*.csv` (one uuid per line) and prints counts. [20]
- Check: the counts look plausible for the site. Voided patients and relationships are left out.

### Export

**12 `12-setup-servers.sh`** On each server: clones or updates the importer into `<SERVER_DIR>/repo` at `REPO_REF`, runs `npm ci` in a docker container, writes the importer's `src/.env` (mode 600). Copies the lists up to the source and the mapping files up to the target. The OpenMRS passwords are typed here and never printed or logged. When `REPO_REF` is a branch, an existing checkout is moved forward to the latest commit; if that is not possible (local commits or changes in the checkout), the step fails. It prints the commit that will run on each server. It stops before changing anything when two mapping files have the same file name (they would overwrite each other in `<TARGET_SERVER_DIR>/mappings`).
- Check: the two `.env` files shown look right (passwords are masked), and the commit shown for each server is the one you expect.

**13 `13-export.sh`** On the source, in tmux session `export`: exportUsers, exportProviders, exportPatients, exportRelationships. [21-25] Before the first start it saves object counts of both databases and per-table counts of the target in `WORKDIR/counts/` [26] (existing snapshots are kept). It asks before clearing old exports and logs. It returns at once. Run it again to see progress.
- Check: the session has ended and the "Export summary" lines show no failures. If there are failures, run it again: it retries only the failures.

**14 `14-copy-exports.sh`** Streams `<SOURCE_SERVER_DIR>/exports` to the target as a tar stream through the laptop. The exporters write all files flat in `exports/` (`<uuid>_user.json`, `_provider.json`, `_patient.json`, `_relationship.json`); 14 compares the number of files per type (and per sub-folder, if there are any) on both sides. It refuses, and copies nothing, once an import has started on the target (`exports/` there holds `successful/`, `failed/`, `mapped_to_existing/`, `verified/` or `failed_verification/`): the importers move processed files into those folders, and copying again would put them back at the top level, where they would be imported again.
- Check: the counts match.
- To start the import over from a fresh copy: restore the target database from the 06 backup, delete `<TARGET_SERVER_DIR>/exports` on the target, then run 14 again.

### Import

**15 `15-import-users.sh`** Saves the uuids of the target's existing users (needed by 16), sets `innodb_flush_log_at_trx_commit = 2` on the target for the import [27], and runs importUsers in tmux session `import-users` on the target. [28] Waits for the end and prints a summary.
- Check: look at the failed count. Run it again until no new users are created [28].
- **Run 16 right after 15.** Until 16 has run, imported users have random passwords.

**16 `16-copy-password-hashes.sh`** Copies password hash and salt from the source to the target, for the users the import created only (not users that were mapped to existing accounts). Prints only how many rows it changed, never the rows. Nothing is written to disk on the laptop. (HAI-1314; replaces the "temporary until HAI-1314" steps 8.2/8.3.)
- Check: the count equals the number of users the import created. Users that failed to import have no hash.

**17 `17-import-patients.sh`** On the target, in tmux session `import-patients`: importProviders, importPatients, importPatients again (second pass retries the failures), importRelationships. [29-31] Returns at once. Run it again to see progress and the failure classes. Run it once more after the import ended: it sets `innodb_flush_log_at_trx_commit` back to 1 [32] and offers another pass (answer `n` if done). It refuses to start while `import-users` (15) or `verify` (19) is running.
- Check: flush is 1; the failed count and the failure classes.

**18 `18-copy-files.sh`** Copies the data folders in `COPY_DIRS` (default `complex_obs storage person_images`, each only if it exists) from the source to the target, with `tools/create_archive.py` and `tools/merge_extract.py` (existing files are kept, conflicts go to a CSV), then sets the owner. [33] The export leaves complex obs files out; this step copies them.
- Check: file counts per folder (the target may hold more files than the source) and the number of conflicts.

### Check

**19 `19-verify.sh`** On the target, in tmux session `verify`: verifyPatients, verifyRelationships, verifyUsers, verifyComplexObs, then verifyUsers again for each entry of `EARLIER_IMPORTS`. [34, 37] A failing verifier does not stop the next. It refuses to start while `import-users` (15) or `import-patients` (17) is running. Run it again to see progress. Run it once more after it ended: it prints the table-count differences against the snapshot from 13 [35], the object counts before and after, and the row counts of the report CSVs (source-data-fixes, source-data-review, visits-before-birthdate, invalid-identifiers).
- Check: read the numbers. The script prints, you judge: failed patients, table count changes, complex obs files that cannot be fetched, rows in the report files. verifyComplexObs always writes `complex-obs-missing.csv` (header only when nothing is missing), so `complex-obs-missing*.csv: absent` means it did not run; a `Complex obs check failed: ...` line in the summary means it ran and could not finish.

**20 `20-rebuild-index.sh`** Removes the indexing line added by 07, restarts the target, waits, and rebuilds the search index with a synchronous call (asks for the migrating user's OpenMRS password). [36] It refuses, with nothing changed, while `import-users`, `import-patients` or `verify` is running on the target, and until 17 and 19 have finished (`logs/import-patients.done` and `logs/verify.done` in `TARGET_SERVER_DIR`).
- Check: a patient search in the target UI finds a migrated patient.

**21 `21-spot-checks.sh`** Read-only. Patients per Health Center value on the target, with the source facility marked [38]. Asks for dossier numbers and searches each through REST (prints uuid and identifier only) [39].
- Check: the Health Center counts look like the source's patients, and the numbers you typed are found.

### Open the server

**22 `22-open-target.sh`** The step that lets users in. Run it only when everything above is done and checked. It refuses, with nothing changed, while the indexing line added by 07 (`hibernate.search.indexing.listeners.enabled=false`) is still in `TARGET_RUNTIME_PROPERTIES` (run 20 first), or when it cannot read that file. It asks whether 16 (password hashes copied after the last 15 run), 17, 18, 19, 20 and 21 are finished and reviewed (anything but yes stops with nothing changed). Then it un-retires users retired by this migration only: reason `Temp - migrating data` and `Migrating from <SOURCE_NAME>` [40]. Users retired for any other reason stay retired. It warns if `innodb_flush_log_at_trx_commit` is not 1. (Un-retiring is SQL in this script until the importer does it.)
- Do by hand: re-enable backups in cron on the target and run one [42]. Re-enable 2FA for the migrating user [43].
- Check: users can log in to the target, flush is 1, a backup ran, 2FA is on.

**23 `23-shutdown-source.sh`** `docker compose down` in `SOURCE_COMPOSE_DIR` on the source. [41] Skipped in test mode.
- Do by hand: keep the backups off on the source (the cron entry stays disabled).
- Check: the source containers are stopped.

**24 `24-archive-and-clean.sh`** Asks whether `invalid-identifiers*.csv` was passed to the Haiti team through the usual channel (not Jira) [47]. Streams the source `logs/` (export console log, export-side `source-data-fixes` and `source-data-review` CSVs) through the laptop into `<TARGET_SERVER_DIR>/source-logs/` (confirmed). Creates a password-protected 7z archive `<SOURCE_NAME>-exports-<date>.7z` on the target holding `exports/`, `logs/` (importer and verifier logs, `app.log`, `visits-before-birthdate*`, `verify-users*`, `complex-obs-missing*`, `conflicts-*`, `invalid-identifiers*` and the other report CSVs), `source-logs/` and `mappings/` (7z asks for the password on the server's terminal). It asks whether the archive was copied to the backup location, then deletes the migration's leftovers from both servers and the laptop. [46] The archive is kept on the target.
- Do by hand: copy the archive to the Azure backup; use the default backup password [46.2-46.3].

**A later site into the same target** needs this site's exports and user mappings for `EARLIER_IMPORTS` (19 runs verifyUsers for them). Extract them from the archive under `TARGET_SERVER_DIR` on the target (the node container only sees that folder), for example for HSN:

    mkdir -p <TARGET_SERVER_DIR>/earlier/HSN
    cd <TARGET_SERVER_DIR>/earlier/HSN && 7z x <path>/HSN-exports-<date>.7z     # asks for the archive password
    rm -rf logs source-logs                                                     # not needed for EARLIER_IMPORTS

and set, in the later site's settings file:

    EARLIER_IMPORTS='<TARGET_SERVER_DIR>/earlier/HSN/exports|<TARGET_SERVER_DIR>/earlier/HSN/mappings/user_mappings.csv|<HSN facility uuid>'

The extracted folders hold patient and user data: delete them when that site's migration is done.

## Running a script again

Safe to run again: 00, 01, 02, 09, 10, 11 (read-only, or they only rewrite their own files), 12 (updates the checkout and `.env`), 21.

Long runs show progress when run again:

- **13 export:** while the session is running, it starts nothing and prints the last summary lines and the number of exported files per type. After it ended, it offers to retry the failures only (already exported files are skipped), or to clear everything and start over.
- **15 import users:** while running, shows progress. After it ended, run it again until no new users are created.
- **17 import patients:** while running, shows successful, failed and left for the current pass, and the failure classes. After it ended, it resets flush to 1 and offers another pass. Failed patient files are moved back between the passes.
- **19 verify:** while running, shows progress. After it ended, prints the count differences and the report row counts, and offers another run (verified patient files are not checked again).

Run 16 right after 15, and again after any later 15 pass that created more users. It only touches users the import created (not those in 15's before-import list), so re-running it is safe. 07 sets values that are shown first and asked; think before running it twice.

## Files written

"User data" means usernames or emails. "Patient data" means patient records or uuids and identifiers of patients. Treat both as sensitive. Do not put them in Jira, chat or the repo.

### Laptop (`WORKDIR`)

| File | Written by | Contents | Deleted by |
|---|---|---|---|
| settings file (wherever you put it) | 00 | hosts, **user data** (migrating username), uuids, no passwords. Not in the repo. | not deleted by 24; delete or protect by hand |
| `logs/<script>.<timestamp>.log` | every script | the full output of each script: commands, counts, **patient data** (patient uuids and dossier identifiers from 21, failure uuids from 17 and 19) and **user data** (usernames). No passwords or hashes. | not deleted by 24; 24 lists it as left behind. Delete or protect by hand |
| `mappings/user_mappings.csv`, `provider_mappings.csv` | 09 | **user data** (uuid, username) | 24 |
| `mappings/user_mappings.manual.csv`, `provider_mappings.manual.csv` | you (09 only reads them) | **user data** (uuid, username) | 24 |
| `mappings/review-email-conflicts.csv`, `unmatched-users.csv`, `fyi-retired-differs.csv` | 09 | **user data** (usernames, emails) | 24 |
| `mappings/concept_name_mappings.draft.csv`, `concept-names-no-candidate.csv`, `concept-mappings-voided-target.csv` | 10 | concept names and uuids, no personal data | 24 |
| `lists/users.csv`, `providers.csv`, `patients.csv`, `relationships.csv` | 11 | uuids only; **patient data** (patient and relationship uuids) | 24 |
| `counts/*.txt` (object counts, table counts) | 13, 19 | counts only | not deleted by 24; delete or protect by hand |
| `target-users-before-import.txt` | 15 | uuids of target users, **user data**. First line `# target=<host> db=<db> source=<SOURCE_NAME>`: 15 and 16 refuse a list made for another target or site | not deleted by 24; delete or protect by hand |

Everything the scripts create (here and, for `TARGET_HOST=local`, on this machine) is readable by you only: `load_settings` sets `umask 077`. Password hashes are never written on the laptop. At the end, 24 prints a "Left on this laptop" list of the logs, counts, `target-users-before-import.txt` and the settings file. It deletes none of them.

### Source server (`SOURCE_SERVER_DIR`)

| File | Written by | Contents | Deleted by |
|---|---|---|---|
| `repo/` | 12 | importer checkout | stays |
| `repo/src/.env` | 12 | OpenMRS password for the importer (mode 600) | 24 |
| `lists/*.csv` | 12 | uuids, **patient data** | 24 |
| `exports/` | 13 | export JSON: **patient data and user data** | 24 (after the archive is made) |
| `logs/` (`export-console.log`, importer logs, source-data-fixes and source-data-review CSVs) | 13 | **patient data** | 24 (after it is copied to the target's `source-logs/` and archived) |
| `files-<folder>.zip` | 18 | zip of complex obs, storage or person images: **patient data** | 24 |

Also on the source, a docker image for node is pulled on the server, and a backup from 04 (outside the work folder).

### Target server (`TARGET_SERVER_DIR`)

| File | Written by | Contents | Deleted by |
|---|---|---|---|
| `repo/`, `repo/src/.env` | 12 | importer checkout, OpenMRS password (mode 600) | `.env` by 24 |
| `mappings/` | 12 | mapping files from the laptop: **user data** | 24 (after the archive is made) |
| `exports/` | 14 | export JSON: **patient data and user data** | 24 (after the archive is made) |
| `logs/` (console logs, importer logs, `conflicts-<folder>.csv`, `invalid-identifiers*.csv`, report CSVs) | 15, 17, 18, 19 | **patient data** | 24 (after the archive is made) |
| `source-logs/` | 24 | copy of the source `logs/` for the archive: **patient data** | 24 (after the archive is made) |
| `patients-failed-pass1/` | 17 | failed patient JSON between passes: **patient data** | 24 |
| `files-<folder>.zip` | 18 | **patient data** | 24 |
| `<SOURCE_NAME>-exports-<date>.7z` | 24 | encrypted archive of `exports/`, `logs/`, `source-logs/`, `mappings/`: **patient data and user data** | kept (copy it to the backup) |

Other changes on the target (not files in the work folder): backups (06), the runtime properties line (07, removed by 20), merged files in `TARGET_DATA_DIR` (18).

## Wiki TODOs and stale items

What happened to each open item on the old wiki page.

| Item | Outcome |
|---|---|
| "update to show how to run locally" | Covered by the scripts and this file (test mode, `TARGET_HOST=local`). |
| Step 10: "test ccIntegrationUser" | Still to do: test on a local ZL Central copy (see Open items). |
| Step 8: sentence cut off ("and make s...") | Fixed here. Step 03 locks the source and says what to do by hand (2FA, cron backups). |
| Steps 8.2/8.3 "temporary until HAI-1314" | Hash copy added as step 16. Un-retiring stays SQL in step 22 until the importer does it. |
| 18.3.1 providers without users | Counted in 02. |
| Step 18: ETL-server queries, cange/mirebalais examples | Replaced by 09. |
| Steps 7 and 11 both disable target backups | One reminder, in 03. |
| Voided-for-dispense counts differ between export and import summaries (test runs) | Open, see below. |

## Open items

- The "voided for dispense" counts differ between the export summary and the import summary. Not investigated.
- `ccIntegrationUser` is kept unretired on the target by step 05. This has not been tested on a local ZL Central copy yet. Test it during the first test run.
- `verifyComplexObs` (part of 19) has not been run against a real server yet.
- Server-to-server SSH (see above): to be researched with IT.

## Tests

The scripts have tests in `migration/tests/`. They need docker: the tests use their own throwaway MySQL 5.6 container `hai1309-test-mysql` and never touch any other container or server. `tmux` is used by some tests if installed.

    migration/tests/testdb.sh up        # start the throwaway MySQL container
    migration/tests/run.sh              # run all tests
    migration/tests/run.sh tests/test_09_mappings.sh   # one file (path relative to migration/)
    migration/tests/testdb.sh down      # remove the container

Output is one PASS or FAIL line per test and a total at the end. The tests do not run against real servers.
