#!/usr/bin/env bash
# Step 10: build the concept name mappings (HAI-1307) for the importer.
#   10-build-concept-name-mappings.sh [settings-file]
# Same mechanics as step 09: one target mysql session receives, through the laptop, a temporary table
# with the concept names the source's non-voided obs use as coded values, and runs the matching
# queries; the laptop only splits what the target prints into the files in $WORKDIR/mappings/.
# If EXPORT_CONCEPT_NAME_MAPPINGS_FILE is set and exists, its target uuids are checked too.
# That file is never modified. Only temporary tables are created, so nothing is confirmed or changed.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 10 "concept name mappings"
require_settings SOURCE_MYSQL_CONTAINER SOURCE_DB TARGET_MYSQL_CONTAINER TARGET_DB

map_dir="$WORKDIR/mappings"
mkdir -p "$map_dir"
existing="${EXPORT_CONCEPT_NAME_MAPPINGS_FILE:-}"
draft="$map_dir/concept_name_mappings.draft.csv"

# Source side: read-only query that prints the insert statements (distinct names of coded values).
src_gen="select concat('insert into src_names values (', quote(n.uuid), ',', quote(c.uuid), ',', quote(n.name), ',', quote(n.locale), ',', quote(n.concept_name_type), ',', n.voided, ');') from concept_name n join concept c on c.concept_id = n.concept_id where n.concept_name_id in (select distinct o.value_coded_name_id from obs o where o.voided = 0 and o.value_coded_name_id is not null)"
_require_read_only_sql "$src_gen"

# Existing mapping file: key = first token before a space, value = after the last comma.
existing_inserts=""
if [ -n "$existing" ] && [ -f "$existing" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case "$line" in *,*) ;; *) continue ;; esac
    key=${line%% *}; val=${line##*,}
    [ -n "$key" ] && [ -n "$val" ] || continue
    existing_inserts+="insert into old_map values ($(sql_quote "$key"), $(sql_quote "$val"));"$'\n'
  done < "$existing"
fi

cs='character set utf8 collate utf8_general_ci'
head_sql="create temporary table src_names(uuid char(38) $cs, concept_uuid char(38) $cs, name varchar(255) $cs, locale varchar(50) $cs, ntype varchar(50) $cs, voided tinyint);
create temporary table old_map(s_uuid varchar(100) $cs, t_uuid varchar(100) $cs);"

# Target side, after the source rows. A temporary table can be used only once per statement in
# MySQL 5.6, hence the many small steps.
tail_sql="${existing_inserts}create temporary table tgt_n as select n.uuid, n.name, n.locale, n.concept_name_type ntype, n.voided, c.uuid concept_uuid from concept_name n join concept c on c.concept_id = n.concept_id;
create temporary table tgt_ok as select * from tgt_n where voided = 0;
create temporary table missing_n as select * from src_names where uuid not in (select uuid from tgt_n);
create temporary table cand(s_uuid char(38) $cs, t_uuid char(38) $cs);
create temporary table ccount(s_uuid char(38) $cs, n int);
insert into cand select s.uuid, t.uuid from missing_n s join tgt_ok t on t.concept_uuid = s.concept_uuid and t.name = s.name and t.locale = s.locale and t.ntype <=> s.ntype;
insert into ccount select s_uuid, count(*) from cand group by s_uuid;
select 'DRAFT', s.uuid, replace(replace(replace(replace(s.name, ',', ' '), char(9), ' '), char(10), ' '), char(13), ' '), c.t_uuid from missing_n s join cand c on c.s_uuid = s.uuid join ccount x on x.s_uuid = s.uuid where x.n = 1;
select 'NOCAND', s.uuid, s.concept_uuid, replace(replace(replace(s.name, char(9), ' '), char(10), ' '), char(13), ' '), s.locale, ifnull(s.ntype, ''), s.voided, ifnull(x.n, 0) from missing_n s left join ccount x on x.s_uuid = s.uuid where ifnull(x.n, 0) <> 1;
select 'OLDMAP', m.s_uuid, m.t_uuid, if(t.uuid is null, 'missing', 'voided') from old_map m left join tgt_n t on t.uuid = m.t_uuid where t.uuid is null or t.voided = 1;"

_dim "[source SQL] $src_gen"
_dim "[target SQL, temporary tables only] $head_sql"
_dim "[target SQL, temporary tables only] $tail_sql"

# Laptop-side filter between the two servers: adds the target password line, the table
# definitions before and the matching queries after the source rows. Stores nothing.
_wrap_for_target() { mysql_pw_line tgt; printf '%s\n' "$head_sql"; cat; printf '%s\n' "$tail_sql"; }

flags='--raw --default-character-set=utf8'
echo "Building concept name mappings in $map_dir ..."
counts=$(pipe_src_to_tgt "$(mysql_cmd src "$flags")" "$(mysql_cmd tgt "$flags")" _wrap_for_target < <(mysql_input src "$src_gen") |
  awk -F'\t' -v dir="$map_dir" '
    function csv(s) { if (s ~ /[",\n]/) { gsub(/"/, "\"\"", s); return "\"" s "\"" } return s }
    BEGIN {
      dr = dir "/concept_name_mappings.draft.csv"; nc = dir "/concept-names-no-candidate.csv"; vt = dir "/concept-mappings-voided-target.csv"
      printf "" > dr
      print "source_name_uuid,concept_uuid,name,locale,concept_name_type,source_voided,candidate_count" > nc
      print "source_name_uuid,target_name_uuid,problem" > vt
    }
    $1 == "DRAFT"  { print $2 " " $3 "," $4 > dr; nd++ }
    $1 == "NOCAND" { print csv($2) "," csv($3) "," csv($4) "," csv($5) "," csv($6) "," $7 "," $8 > nc; nn++ }
    $1 == "OLDMAP" { print csv($2) "," csv($3) "," $4 > vt; nv++ }
    END { printf "draft mappings (exactly one candidate): %d\nnames without exactly one candidate: %d\nexisting mappings to missing or voided target names: %d\n", nd, nn, nv }')
printf '%s\n' "$counts"
echo "Files in $map_dir: concept_name_mappings.draft.csv (importer format), concept-names-no-candidate.csv, concept-mappings-voided-target.csv"
echo "Read the two review files: names without a candidate and existing mappings to voided or missing names need a decision."
if [ -n "$existing" ] && [ -f "$existing" ]; then
  echo "Existing mappings file $existing is not modified. After review, to merge the draft into a new file:"
  echo "  sort -u $existing $draft > $existing.merged"
else
  echo "No existing concept name mappings file (EXPORT_CONCEPT_NAME_MAPPINGS_FILE). After review, set it to the draft or a copy of it."
fi

next_step "11-build-lists.sh" "review the two concept name files and merge the draft into the mappings file"
