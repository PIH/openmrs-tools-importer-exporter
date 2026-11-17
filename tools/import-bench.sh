#!/usr/bin/env bash
# Runs one timed patient import from a sample of export files, for benchmarking import changes.
#
#   tools/import-bench.sh <bench dir> <run name> <sample dir> [VAR=value ...]
#
# Hard-links the *_patient.json files in <sample dir> into <bench dir>/<run name>/ (which must not exist)
# and imports from there, so the import's moving of files into successful/ and failed/ never touches the
# sample. Logs go to <bench dir>/<run name>-logs/. Extra VAR=value arguments are passed to the import as
# environment variables (they override src/.env), e.g. OPENMRS_TARGET_CONTEXT_PATH. The import's own
# output contains patient UUIDs and identifiers, so it goes only to the log directory; this prints the
# end-of-run summary (counts, failure types by exception class) and per-directory file counts.
set -uo pipefail
BENCH_DIR=$1; NAME=$2; SAMPLE=$3; shift 3
OUT="$BENCH_DIR/$NAME"; LOGS="$BENCH_DIR/$NAME-logs"
[ -e "$OUT" ] && { echo "$OUT already exists" >&2; exit 2; }
mkdir -p "$OUT" "$LOGS"
cp -l "$SAMPLE"/*_patient.json "$OUT"/
cd "$(dirname "$0")/../src" || exit 2
start=$(date +%s.%N)
env TARGET_DIR="$OUT" LOG_HOME="$LOGS" "$@" node importPatients.js > "$LOGS/console.log" 2>&1
rc=$?
end=$(date +%s.%N)
count() { find "$1" -maxdepth 1 -name '*_patient.json' 2>/dev/null | wc -l; }
echo "run: $NAME  exit: $rc  wall: $(awk -v s="$start" -v e="$end" 'BEGIN{printf "%.1f", e-s}') s  successful: $(count "$OUT/successful")  failed: $(count "$OUT/failed")  left: $(count "$OUT")"
grep -o 'Import summary: .*' "$LOGS/console.log" | sed -E 's/; metrics written to .*//'
metrics=$(ls -t "$LOGS"/import-metrics-*.json 2>/dev/null | head -1)
[ -n "$metrics" ] && echo "metrics: $metrics"
grep -o 'Fatal error: .*' "$LOGS/console.log" | head -1
exit $rc
