#!/usr/bin/env bash
# Step 09: build the user and provider mappings (HAI-1304) for the importer.
#   09-build-user-mappings.sh [settings-file]
# One target mysql session receives, through the laptop, temporary tables with the source users and
# providers (uuid, username, email, retired and retire reason only: no password hashes cross) and runs the
# matching queries; the laptop only splits what the target prints into the files in $WORKDIR/mappings/.
# Only temporary tables are created (they vanish with the session), so nothing is confirmed or changed.
# Retired state: a source user retired by 03 ('Migrating from <SOURCE_NAME>') and a target user retired by 05
# ('Temp - migrating data') count as not retired.
# Manual decisions (conflicts, unmatched users) go in user_mappings.manual.csv / provider_mappings.manual.csv in
# $WORKDIR/mappings/ (same line format as the importer files). 09 never writes them; it merges them into the generated
# files on every run, a manual line replacing any generated line for the same source uuid.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 09 "user and provider mappings"
require_settings SOURCE_MYSQL_CONTAINER SOURCE_DB TARGET_MYSQL_CONTAINER TARGET_DB SOURCE_NAME

map_dir="$WORKDIR/mappings"
mkdir -p "$map_dir"
unknown_provider='f9badd80-ab76-11e2-9e96-0800200c9a66 UnknownProvider,f9badd80-ab76-11e2-9e96-0800200c9a66'
temp_reason='Temp - migrating data'
source_reason="Migrating from $SOURCE_NAME"

# Source side: read-only query that prints the insert statements.
src_gen="select concat('insert into src_users values (', quote(u.uuid), ',', quote(u.username), ',', quote(u.email), ',', u.retired, ',', quote(u.retire_reason), ',', quote(p.uuid), ');') from users u join person p on p.person_id = u.person_id
union all
select concat('insert into src_providers values (', quote(pr.uuid), ',', quote(p.uuid), ');') from provider pr join person p on p.person_id = pr.person_id"
_require_read_only_sql "$src_gen"

# Target side, before the source rows: the temporary tables.
head_sql="create temporary table src_users(uuid char(38) character set utf8 collate utf8_general_ci, username varchar(50) character set utf8 collate utf8_general_ci, email varchar(255) character set utf8 collate utf8_general_ci, retired tinyint, retire_reason varchar(255) character set utf8 collate utf8_general_ci, person_uuid char(38) character set utf8 collate utf8_general_ci);
create temporary table src_providers(uuid char(38) character set utf8 collate utf8_general_ci, person_uuid char(38) character set utf8 collate utf8_general_ci);"

# Target side, after the source rows: the matching. A temporary table can be used only once per
# statement in MySQL 5.6, hence the many small steps.
tail_sql="update src_users set retired = 0 where retired = 1 and binary ifnull(retire_reason, '') = binary $(sql_quote "$source_reason");
create temporary table tgt_u as select t.uuid, t.username, lower(trim(t.email)) em, t.retired, t.retire_reason, p.uuid person_uuid from users t join person p on p.person_id = t.person_id;
create temporary table tgt_prov as select pr.uuid, p.uuid person_uuid from provider pr join person p on p.person_id = pr.person_id;
create temporary table m_nraw(s_uuid char(38) character set utf8 collate utf8_general_ci, t_uuid char(38) character set utf8 collate utf8_general_ci);
create temporary table nsc(s_uuid char(38) character set utf8 collate utf8_general_ci, n int);
create temporary table ntc(t_uuid char(38) character set utf8 collate utf8_general_ci, n int);
create temporary table m_name(s_uuid char(38) character set utf8 collate utf8_general_ci, t_uuid char(38) character set utf8 collate utf8_general_ci);
create temporary table cand(s_uuid char(38) character set utf8 collate utf8_general_ci, t_uuid char(38) character set utf8 collate utf8_general_ci);
create temporary table ccount(s_uuid char(38) character set utf8 collate utf8_general_ci, n int);
create temporary table tcount(t_uuid char(38) character set utf8 collate utf8_general_ci, n int);
create temporary table m_email(s_uuid char(38) character set utf8 collate utf8_general_ci, t_uuid char(38) character set utf8 collate utf8_general_ci);
create temporary table m_conf(s_uuid char(38) character set utf8 collate utf8_general_ci, t_uuids text character set utf8 collate utf8_general_ci, reason varchar(100) character set utf8 collate utf8_general_ci);
create temporary table m_all(s_uuid char(38) character set utf8 collate utf8_general_ci, t_uuid char(38) character set utf8 collate utf8_general_ci, how varchar(10) character set utf8 collate utf8_general_ci);
create temporary table m_prov(sp_uuid char(38) character set utf8 collate utf8_general_ci, tp_uuid char(38) character set utf8 collate utf8_general_ci, label varchar(50) character set utf8 collate utf8_general_ci);
create temporary table pcount(sp_uuid char(38) character set utf8 collate utf8_general_ci, n int);
insert into m_nraw select s.uuid, t.uuid from src_users s join tgt_u t on s.username = t.username where s.username <> '';
insert into nsc select s_uuid, count(*) from m_nraw group by s_uuid;
insert into ntc select t_uuid, count(*) from m_nraw group by t_uuid;
insert into m_name select a.s_uuid, a.t_uuid from m_nraw a join nsc x on x.s_uuid = a.s_uuid join ntc y on y.t_uuid = a.t_uuid where x.n = 1 and y.n = 1;
insert into m_conf select a.s_uuid, group_concat(distinct a.t_uuid order by a.t_uuid), if(max(x.n) > 1, 'several target users have this username', 'several source users have the same username as this target user') from m_nraw a join nsc x on x.s_uuid = a.s_uuid join ntc y on y.t_uuid = a.t_uuid group by a.s_uuid having max(x.n) > 1 or max(y.n) > 1;
insert into cand select s.uuid, t.uuid from src_users s join tgt_u t on t.em = lower(trim(s.email)) where trim(ifnull(s.email, '')) <> '' and s.uuid not in (select s_uuid from m_nraw);
insert into ccount select s_uuid, count(*) from cand group by s_uuid;
insert into tcount select t_uuid, count(distinct s_uuid) from cand group by t_uuid;
insert into m_email select c.s_uuid, c.t_uuid from cand c join ccount x on x.s_uuid = c.s_uuid join tcount y on y.t_uuid = c.t_uuid where x.n = 1 and y.n = 1 and c.t_uuid not in (select t_uuid from m_nraw);
insert into m_conf select c.s_uuid, group_concat(distinct c.t_uuid order by c.t_uuid), if(x.n > 1, 'several target users have this email', if(max(y.n) > 1, 'several source users have the same email as this target user', 'target user is the username match of another source user')) from cand c join ccount x on x.s_uuid = c.s_uuid join tcount y on y.t_uuid = c.t_uuid left join m_nraw n2 on n2.t_uuid = c.t_uuid group by c.s_uuid, x.n having x.n > 1 or max(y.n) > 1 or count(n2.t_uuid) > 0;
insert into m_all select s_uuid, t_uuid, 'username' from m_name;
insert into m_all select s_uuid, t_uuid, 'email' from m_email;
insert into m_prov select sp.uuid, tp.uuid, s.username from src_providers sp join src_users s on s.person_uuid = sp.person_uuid join m_all a on a.s_uuid = s.uuid join tgt_u t on t.uuid = a.t_uuid join tgt_prov tp on tp.person_uuid = t.person_uuid;
insert into pcount select sp_uuid, count(distinct tp_uuid) from m_prov group by sp_uuid;
select 'USER', a.s_uuid, ifnull(s.username, ''), a.t_uuid, a.how from m_all a join src_users s on s.uuid = a.s_uuid;
select 'PROVIDER', p.sp_uuid, min(ifnull(p.label, '')), p.tp_uuid from m_prov p join pcount x on x.sp_uuid = p.sp_uuid where x.n = 1 group by p.sp_uuid, p.tp_uuid;
select 'CONFLICT', 'user', c.s_uuid, ifnull(s.username, ''), ifnull(s.email, ''), c.t_uuids, c.reason from m_conf c join src_users s on s.uuid = c.s_uuid;
select 'CONFLICT', 'provider', p.sp_uuid, min(ifnull(p.label, '')), '', group_concat(distinct p.tp_uuid order by p.tp_uuid), 'several target providers for the mapped user' from m_prov p join pcount x on x.sp_uuid = p.sp_uuid where x.n > 1 group by p.sp_uuid;
select 'FYI', s.uuid, ifnull(s.username, ''), t.uuid, ifnull(t.username, ''), s.retired, if(t.retired = 1 and ifnull(t.retire_reason, '') <> $(sql_quote "$temp_reason"), 1, 0) from m_all a join src_users s on s.uuid = a.s_uuid join tgt_u t on t.uuid = a.t_uuid where s.retired <> if(t.retired = 1 and ifnull(t.retire_reason, '') <> $(sql_quote "$temp_reason"), 1, 0);
select 'UNMATCHED', s.uuid, ifnull(s.username, ''), ifnull(s.email, ''), s.retired from src_users s where s.uuid not in (select s_uuid from m_all) and s.uuid not in (select s_uuid from m_conf);"

_dim "[source SQL] $src_gen"
_dim "[target SQL, temporary tables only] $head_sql"
_dim "[target SQL, temporary tables only] $tail_sql"

# Laptop-side filter between the two servers: adds the target password line (prompt auth), the
# table definitions before and the matching queries after the source rows. Stores nothing.
_wrap_for_target() { mysql_pw_line tgt; printf '%s\n' "$head_sql"; cat; printf '%s\n' "$tail_sql"; }

# merge_manual GENERATED MANUAL: puts the MANUAL lines (if the file exists) into GENERATED, dropping generated lines
# for the same source uuid. Blank lines and lines starting with # are ignored. MANUAL is only read.
merge_manual() {
  local gen=$1 man=$2 name n bad dup
  name=$(basename "$man")
  if [ ! -f "$man" ]; then echo "manual lines applied from $name: 0 (no such file)"; return 0; fi
  bad=$(grep -vE '^[[:space:]]*(#|$)' "$man" | grep -nvE '^[0-9A-Fa-f-]{36} [^,]+,[0-9A-Fa-f-]{36}[[:space:]]*$' | cut -d: -f1 | tr '\n' ' ' || true)
  if [ -n "$bad" ]; then
    echo "$man: lines that are not '<source-uuid> <label>,<target-uuid>' (numbered without comments and blank lines): $bad" >&2; exit 2
  fi
  dup=$({ grep -vE '^[[:space:]]*(#|$)' "$man" || true; } | awk '{print $1}' | sort | uniq -d | tr '\n' ' ')
  if [ -n "$dup" ]; then echo "$man: source uuid(s) more than once: $dup" >&2; exit 2; fi
  # grep exits 1 when the file is empty or only comments; that is 0 manual lines, not an error.
  { grep -vE '^[[:space:]]*(#|$)' "$man" || true; } | sed 's/[[:space:]]*$//' > "$gen.manual-lines"
  # FILENAME, not NR == FNR: with an empty manual file NR == FNR would hold for every generated line.
  awk -v man="$gen.manual-lines" 'FILENAME == man { m[$1] = 1; next } !($1 in m)' "$gen.manual-lines" "$gen" > "$gen.merged"
  cat "$gen.manual-lines" >> "$gen.merged"
  n=$(wc -l < "$gen.manual-lines" | tr -d ' ')
  mv "$gen.merged" "$gen"; rm -f "$gen.manual-lines"
  echo "manual lines applied from $name: $n"
}

flags='--raw --default-character-set=utf8'
echo "Building mappings in $map_dir ..."
counts=$(pipe_src_to_tgt "$(mysql_cmd src "$flags")" "$(mysql_cmd tgt "$flags")" _wrap_for_target < <(mysql_input src "$src_gen") |
  awk -F'\t' -v dir="$map_dir" '
    function csv(s) { if (s ~ /[",\n]/) { gsub(/"/, "\"\"", s); return "\"" s "\"" } return s }
    BEGIN {
      um = dir "/user_mappings.csv"; pm = dir "/provider_mappings.csv"
      rc = dir "/review-email-conflicts.csv"; fy = dir "/fyi-retired-differs.csv"; un = dir "/unmatched-users.csv"
      printf "" > um; printf "" > pm
      print "source_uuid,source_username,object,source_email,target_uuids,reason" > rc
      print "source_uuid,source_username,target_uuid,target_username,source_retired_ignoring_migration_lock,target_retired_ignoring_temp_lock" > fy
      print "source_uuid,source_username,source_email,source_retired_ignoring_migration_lock" > un
    }
    $1 == "USER"      { print $2 " " $3 "," $4 > um; if ($5 == "username") nu++; else ne++ }
    $1 == "PROVIDER"  { print $2 " " $3 "," $4 > pm; np++ }
    $1 == "CONFLICT"  { print csv($3) "," csv($4) "," csv($2) "," csv($5) "," csv($6) "," csv($7) > rc; if ($2 == "user") nc++; else npc++ }
    $1 == "FYI"       { print csv($2) "," csv($3) "," csv($4) "," csv($5) "," $6 "," $7 > fy; nf++ }
    $1 == "UNMATCHED" { print csv($2) "," csv($3) "," csv($4) "," $5 > un; nx++ }
    END { printf "users matched by username: %d\nusers matched by email: %d\nuser conflicts: %d\nretired differs (FYI): %d\nunmatched users: %d\nproviders matched: %d\nprovider conflicts: %d\n", nu, ne, nc, nf, nx, np, npc }')
printf '%s\n' "$unknown_provider" >> "$map_dir/provider_mappings.csv"
printf '%s\n' "$counts"
for kind in user provider; do
  merge_manual "$map_dir/${kind}_mappings.csv" "$map_dir/${kind}_mappings.manual.csv"
done
echo "Files in $map_dir: user_mappings.csv provider_mappings.csv (+ UnknownProvider line), review-email-conflicts.csv, fyi-retired-differs.csv, unmatched-users.csv"
echo "Read review-email-conflicts.csv (nothing is mapped for those) and fyi-retired-differs.csv; unmatched users are created by the import."
echo "Put your own decisions in user_mappings.manual.csv / provider_mappings.manual.csv (never edit the generated files: every run of 09 rewrites them)."

next_step "10-build-concept-name-mappings.sh" "run this on the day after steps 03 and 05 (so the lists are current); for a 2nd or later site the earlier import is already in, so its users match too; read the review lists"
