# Migration scripts (HAI-1309) — design

Status: draft for review, 2026-11-25. Ticket: HAI-1309 (epic HAI-1080).
Reference: wiki "Merging Systems: Migration Steps" (page 3785490446, v126).

## Intent

Merging a site's OpenMRS server (source, e.g. HSN) into ZL Central (target) is a long list of manual
steps on the wiki. This work turns that list into a set of small scripts that do the typing and the
checking, while the person running the migration still does every step themselves, reads what each step
did, and decides whether to go on. It eases the work; it doesn't hide it.

The person running it is comfortable with Linux, SSH and MySQL, but forgets exact commands since the
servers moved to docker. Every script prints the exact command or SQL before it runs it, so the scripts
double as reminders.

**The real migration is run with no AI involved.** AI is used only to build the scripts. Success
(per the ticket) = one full end-to-end run done by a person from the scripts and the README alone.

## Goals

- One script per step (or small group of tightly linked steps), numbered in run order without gaps
  (`00-`, `01-`, `02-`, …).
- Each script: says what it is about to do, prints the command/SQL, asks before any write, shows the
  result, says what to check and which script comes next.
- Scripts *build* the uuid lists, user/provider mappings and concept-name mapping drafts from the
  databases instead of by hand / from the ETL server.
- A script that creates the settings file by asking for each value, and a preflight that checks every
  value against the servers.
- Include the progress/metric reporting built during the test runs (row-count snapshots and diff,
  export/import summaries, failure classes, CSV row counts).
- Cover HAI-1304 (user/provider mappings incl. email matching), HAI-1307 (concept-name mappings) and
  HAI-1314 (password-hash copy right after the user import).
- `migration/README.md` becomes the source of truth for the steps. The old wiki page stays, marked as
  outdated with a link to the README. The README lists each wiki TODO and what happened to it.
- Every run re-checks the unsupported-data list on the source (appointments of both types, conditions,
  diagnoses, notes, paper records): counts > 0 must be looked at before going on.

## Non-goals

- No one-command migration / single guided runner (rejected: the person must stay engaged).
- No new wiki page.
- No changes to the export/import/verify logic in `src/` (only small additions if a script needs output
  the node scripts don't already give).
- No automation of things that need human judgement: reviewing mapping lists, deciding on duplicate
  emails, deciding whether a verify failure is acceptable, the ID/card printing review, CommCare, ETL.

## Anti-goals (would be a failure even if it works)

- Scripts that need AI, or this repo's Claude tooling, to run or to understand.
- Scripts that silently write: every write to a production database or server is shown first and needs
  a "yes".
- Password hashes (or any user/patient rows) landing in a file, log, the export data, or Jira.
- Anything tied to one laptop (paths, usernames, hostnames, container names hardcoded).
- Opening the target to users before the whole migration is done (import, hash copy, verify, index
  rebuild, checks). Un-retiring users is the last step before handover, not part of the user import.
- Replacing human verification with script "PASS" lines; scripts report, the person decides.

## Constraints

- **Where commands run:** every script is started on the operator's laptop and runs its commands on the
  servers over SSH (SQL via `docker exec`, restarts, file operations). The operator never has to log in
  to a server by hand, though they can attach to the `tmux` session to watch a long run.
- Source and target servers **cannot SSH to each other at the moment**. Everything that crosses servers
  goes through the laptop: `ssh source '…' | ssh target '…'`. **This may change in the future**: to be
  researched with IT. The shared helper and the README say so, and that the cross-server steps can be
  simplified if server-to-server SSH becomes possible.
- MySQL on the servers runs in docker (`mysql56` container on prod per the wiki; a setting).
  All SQL goes through `ssh <host> sudo docker exec -i -e MYSQL_PWD=… <container> mysql …`.
- Passwords never on a command line visible in `ps` on the servers where avoidable, never in the repo.
- **Export runs on the source server, import and verify on the target server** (chosen for reliability:
  multi-hour runs must survive the laptop sleeping or losing its connection). The laptop script starts
  them inside `tmux` on the server and returns; re-running it shows progress (summary lines, counts)
  without attaching. They use a `node:22` docker image (pinned tag; the repo has no engines pin and is
  developed on node 22) against a git checkout of this repo on the server, so nothing is installed on the
  host. The importer talks to OpenMRS on the same host (localhost URL in the server-side importer `.env`).
- Patient and staff data: the export JSON is written on the source and streamed to the target through
  the laptop as a `tar` stream (`ssh src tar c | ssh tgt tar x`), never stored on the laptop. It ends up
  on both servers; the last script deletes it from both after the encrypted archive is made.
- Bash (POSIX-ish, GNU tools), runs on Linux and macOS laptops. The laptop needs only bash, ssh and git.
- The old wiki page (v126) is the source for exact commands (backups, storage copy, index rebuild, dossier
  sequence, compose folder) wherever this document is brief; where the two disagree, ask.

## Approaches considered

1. **Numbered bash scripts + existing node scripts (chosen).** A `migration/` folder with
   `NN-name.sh` scripts sharing a small `lib.sh` (ssh + docker-exec mysql wrapper, print-then-confirm,
   colours, "next step" footer) and one settings file per migration. Export/import/verify stay the
   existing `src/*.js`. Commands stay visible, which is what makes the scripts work as reminders.
2. Everything in node with a MySQL client — one language and testable, but MySQL is inside docker on the
   servers so it needs `docker exec` or an opened port anyway, and the commands end up hidden in JS.
3. One guided runner — easiest to follow, but contradicts the ticket's "multiple, smaller scripts" so the
   operator stays engaged.

## Design

### Layout

```
migration/
  README.md                 source of truth: setup, the steps in order, what each script does, TODO outcomes
  lib.sh                    shared helpers (see below)
  migration.env.example     all settings with comments
  00-create-settings.sh … 24-archive-and-clean.sh   one script per step, see "Steps"
  sql/                      SQL used by more than one script (object counts, unsupported-data counts, …)
```

### Settings

One settings file per migration (e.g. `~/migrations/hsn/migration.env`, path passed as `MIGRATION_ENV`
or first argument; never inside the repo). Holds: source/target SSH host aliases, MySQL container names
and database names, the source site's dossier prefix, `ORDER_NUMBER_PREFIX`, facility uuid, retire reason
(`Migrating from <source>`), the migrating user's username, a working directory on the laptop for
lists/mappings/logs, the checkout/work folder on each server, the importer settings (the scripts write
the server-side importer `.env` from them), and the optional role / patient-identifier /
program-workflow-state mapping files (supported by the importer, unused so far).
Server-specific operations are settings, pre-filled with the wiki's commands as defaults: the restart
command for the target, the URL to poll until it's up, the compose folder used to shut down the source.
The dossier sequence is found by the dossier prefix in `idgen_seq_id_gen`, as in the wiki SQL.
MySQL root passwords are not stored in it: read from the server at run time (`sudo` on the server, e.g.
from the docker env / the server's runtime properties) or prompted once per script and kept only in a
variable.

`00-create-settings.sh` creates the file: copies the example, asks for each value with the default
shown, and where it can, looks the value up on the servers and offers it (container names from
`docker ps`, database names, facility uuid by location name, dossier prefix from the target's
`idgen_seq_id_gen`). Re-running it edits an existing file.
`01-preflight.sh` checks every value (see Steps).

### Test runs (`MIGRATION_MODE=test`)

The first real test exports from a **production** source and imports into a target running on the
operator's laptop. The settings file has `MIGRATION_MODE=test|real` (asked by 00, shown in every
script's header). In test mode:

- **The source is read-only.** `lib.sh` refuses any SQL write or service command on the source
  (enforced in the helper, not left to each script). Scripts that only change the source say they are
  skipped in test mode: 03 lock-source, 04 backup-source, 08 check-no-sessions (users are working),
  23 shutdown-source. Read-only SQL (counts, mapping inputs, lists, hashes) still runs.
- The only things written on the source server are the repo checkout, the node image and the export
  JSON in the work folder (disk, not the database); 24 removes the JSON. The export is REST reads and
  took about 12 minutes for SSPE locally; run it at a quiet time.
- The target may be the laptop itself: target host `local` runs commands directly instead of over SSH;
  container, restart command and wait URL come from the settings (e.g. the SDK's `mysql-openmrs` and
  `openmrs-sdk run`). The copy steps then become `ssh src tar c | tar x` into the local folder.
- Because source users aren't retired, imported users keep their own retired state; 22 finds no
  `Migrating from <source>` users to un-retire, and says this is expected in test mode.
- 16 (hash copy) still runs, so it gets tested; the hashes land in the laptop's database, which already
  holds prod copies with hashes. Can be skipped with a test-mode setting.

### Complex obs and other files

The export leaves the file part of complex obs out (`exporterService.js`: the obs row is imported with
its `valueComplex` key, the file is not uploaded). The files are copied separately in 18 with the
existing `tools/create_archive.py` + `tools/merge_extract.py` (never overwrites; conflicts go to a CSV)
[33, UHM-9065]. The directories to copy are a setting, defaulting to the source's `complex_obs`,
`storage` and `person_images`, each that exists; ownership fixed to tomcat afterwards.

Both `complex_obs` (legacy location; old files are not moved) and `storage` (core 2.8 storage service)
can exist on the source and the target at the same time. Each is merged into the directory **of the
same name** on the target, since the obs's `valueComplex` key (kept as is by the import) decides where
the target looks. 19 adds a check that every imported complex obs's file can be fetched on the target
(through the REST obs value endpoint, so it works for either location), reporting counts and the
uuids that fail.

### lib.sh

- `src_sql` / `tgt_sql`: run SQL on the source/target DB over SSH + docker exec; print the SQL first.
- `confirm "what this will change"`: required before any write; `--yes` is **not** offered.
- `step_header`, `next_step "NN-name.sh" "what to check first"`.
- `pipe_src_to_tgt`: the laptop-in-the-middle pipe (`ssh src … | ssh tgt …`), with the comment that the
  servers can't reach each other *at the moment*, that this may change (to research with IT), and what
  could be simplified then.
- `start_in_tmux` / `show_progress`: start a node script in tmux on a server; show its summary lines.
- Every script logs what it printed (not secrets) to `<workdir>/logs/NN-name.<timestamp>.log`.

### Steps (wiki step numbers in brackets)

Each bullet is one script. Steps that need a person (editing cron, printing setup, CommCare, ETL) are
reminders printed by the nearest script and listed in the README checklist.

**Before the day** (00–02 can run days earlier, and run again on the day)
- `00-create-settings.sh` — creates/edits the settings file (above).
- `01-preflight.sh` — checks every setting: SSH to both servers, sudo, docker containers found, MySQL
  reachable, databases exist, facility uuid exists on both, dossier prefix exists on the target, mapping
  files that are set exist, `ORDER_NUMBER_PREFIX` set; on both servers: `tmux`, the `node:22` image
  (or can be pulled), free disk; PIH EMR versions on both side by side [1].
- `02-check-source-data.sh` — health-center attribute set on all source patients [2] and target [3];
  **unsupported-data counts** [4] on the source — anything > 0 is shown and must be acknowledged;
  providers without user accounts [18.3.1, as a count]. Reminders: ID/card printing [5], CommCare [44],
  ETL [45].

**On the day: lock both servers**
- `03-lock-source.sh` — retire all source users except the migrating user with the exact reason [8];
  count before/after. Reminders: disable 2FA for the migrating user [6.1]; disable backups in cron on
  source and target [7, 11].
- `04-backup-source.sh` — the two backup commands on the source [9].
- `05-lock-target.sh` — retire target users except the migrating user and `ccIntegrationUser` with
  `Temp - migrating data` [10].
- `06-backup-target.sh` — same backup commands on the target [12].
- `07-prepare-target.sh` — dossier sequence: read from source, show target's current value, set it
  [13–15]; turn off search indexing in runtime properties [16] with the puppet warning; restart the
  target and wait until it's up [16].
- `08-check-no-sessions.sh` — confirm nobody else is logged into the source [17].

**On the day: mappings and lists** (must run here, after both servers are locked, so users or concepts
added on the day are included; 09–10 may also be run earlier as a preview)
- `09-build-user-mappings.sh` — HAI-1304 [18]: user mappings by username, then by email for the rest;
  providers the same way + UnknownProvider. Duplicate or conflicting email matches are listed for the
  operator, not chosen. Matching ignores whether either side is retired, but a match where the source and
  target retired state differ (other than target users retired with `Temp - migrating data`) is mapped
  and listed as an FYI. Prints matched / unmatched / FYI counts. Output format matches what the importer
  reads: `source-uuid label,target-uuid` (the label after the space is ignored). Source rows go
  source → laptop (uuid, username, email only) → target temp table → join. When this is the 2nd+ site
  into the same target, the earlier site's import is already in, so its users are matched too (chained
  mappings).
- `10-build-concept-name-mappings.sh` — HAI-1307 [19]: coded-value concept names used by source obs that
  don't exist by uuid on the target; for each, a draft mapping line when the target has the same concept
  with same text/locale/type; lists the ones with no candidate; flags existing mapping lines whose target
  name is voided. Output is a draft the operator reviews and merges into the mappings file.
- `11-build-lists.sh` — uuid lists for users, providers, non-voided patients, relationships [20]; counts.

**Export**
- `12-setup-servers.sh` — clone/update the repo checkout on each server, pull the node image, write the
  server-side importer `.env`, copy the lists and mappings up.
- `13-export.sh` — on the source, in tmux; re-run to see progress. Clears old exports/logs after
  confirming [21], runs exportUsers, exportProviders, exportPatients, exportRelationships [22–25] with
  the summary lines; re-running retries only failures. Object counts on source and target [26].
- `14-copy-exports.sh` — streams the export JSON source → target through the laptop; compares file
  counts on both ends.

**Import** (on the target, in tmux)
- `15-import-users.sh` — table-count snapshot of the target; `innodb_flush_log_at_trx_commit = 2` [27];
  importUsers [28, repeat until no new users]. Ends by pointing straight to 16.
- `16-copy-password-hashes.sh` — HAI-1314: stream uuid/password/salt from source to target as SQL into a
  temporary table, update only users the import created (not mapped accounts); prints the count updated,
  never the rows. Must run before anyone can log in.
- `17-import-patients.sh` — importProviders [29], importPatients with pass 2 retry and failure classes
  [30], importRelationships [31], flush back to 1 [32], progress lines while it runs.
- `18-copy-files.sh` — complex obs / person images / storage directory copy via the laptop [33]
  (see "Complex obs and other files"), ownership fixed to tomcat.

**Check**
- `19-verify.sh` — verifyPatients, verifyRelationships [34], table-count diff [35], verifyUsers [37,
  incl. re-run for earlier imports into the same target], CSV row counts (source-data-fixes,
  source-data-review, visits-before-birthdate, invalid-identifiers).
- `20-rebuild-index.sh` — restore runtime properties, restart, trigger rebuild, wait [36].
- `21-spot-checks.sh` — health-center attribute counts on target [38], patient search for a few dossier
  numbers the operator types in [39].

**Open the server** (only after everything above is done and checked)
- `22-open-target.sh` — re-asks: verify reviewed? index rebuilt? Then un-retire `Temp - migrating data`
  users and the `Migrating from <source>` users [40]; flush setting is 1; reminders: re-enable backups
  + run one [42], re-enable 2FA [43].
- `23-shutdown-source.sh` — `docker compose down` on the source, backups off there [41].
- `24-archive-and-clean.sh` — 7z encrypt the exports on the target, copy to the backup location, then
  delete the patient JSON and logs from both servers and anything on the laptop [46]; reminder to share
  invalid-identifiers.csv through the usual channel [47].

### Wiki page

At the end, the old page gets a note at the top: outdated, the steps now live in `migration/README.md`
(link), kept for reference. Its content is not changed. (Edited only with the user's go-ahead.)

### Wiki TODOs and stale items (each gets an outcome in the README)

| Item | Outcome |
|---|---|
| "update to show how to run locally" | Covered by the scripts + README. |
| Step 10 "test ccIntegrationUser" | Tested on a local ZL Central copy before the real run. |
| Step 8 sentence cut off ("and make s…") | Fixed in the README. |
| Steps 8.2/8.3 "temporary until HAI-1314" | Hash copy added (16); un-retire stays SQL in 22 until done in the importer. |
| 18.3.1 providers without users | Count in 02. |
| Step 18 ETL-server queries, cange/mirebalais examples | Replaced by 09. |
| Steps 7 and 11 both disable target backups | One reminder (03). |
| Voided-for-dispense counts differ export vs import summary (test runs) | Listed as open in the README. |

## Decided with the user

- Approach 1 (bash + existing node).
- Operator = experienced with Linux/MySQL; scripts remind, don't teach.
- Scripts numbered without gaps.
- Unsupported-data list is still right, and is re-checked every run.
- HAI-1304 / HAI-1307 / HAI-1314 handling as above. Server not reopened until the whole migration is done.
- Mappings are built on the day, right before the export, so users added on the day are included.
- All cross-server traffic via the laptop for now; nothing laptop-specific; server-to-server SSH may
  change, to research with IT.
- Final migration has no AI involvement.
- Export on the source, import/verify on the target, in tmux (option "b"), for reliability.
- User matching: map regardless of retired state; differing retired state listed as FYI.
- Role / identifier / workflow-state mapping files: optional settings, checked in preflight.
- No new wiki page: README is the source of truth; old page marked outdated, pointing to it.
- A script creates the settings file, and preflight checks it.
- Test mode: export from the production source, import into a target on the laptop, source users not
  retired (source read-only).

## My calls (check these)

- Every script runs on the laptop and works on the servers over SSH; long node runs in tmux on the server.
- `node:22` docker image + git checkout on each server instead of installing node.
- JSON copied as a `tar` stream through the laptop, not stored on it.
- Concept-name mappings also built on the day, with the user mappings.
- Old wiki page wins for exact commands where this doc is brief.
- Restart command, wait URL, compose folder are settings with the wiki's commands as defaults.

## Left to the builder

- Exact script boundaries where two wiki steps are trivially small (merge or split), renumbering to keep
  no gaps.
- How the MySQL root password is obtained on each server (must not be stored in the repo or settings file).
- Whether `tmux` or `screen` (whichever the servers have; check in preflight).
- Tests: a fake `ssh` / `docker` shim so scripts can be run against the local SDK MySQL copies
  (`mysql-openmrs`) in a dry run; no tests against real servers.
