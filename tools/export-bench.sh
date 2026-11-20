#!/usr/bin/env bash
# Runs one timed patient export into its own directory, for benchmarking export changes.
#
#   tools/export-bench.sh <bench dir> <run name> <patient list file> [VAR=value ...]
#
# Exports to <bench dir>/<run name>/ (which must not exist yet) with logs in
# <bench dir>/<run name>-logs/. Extra VAR=value arguments are passed to the export as environment
# variables (they override src/.env). The export's own output contains patient UUIDs, so it goes
# only to the log directory; this prints just the end-of-run summary and the metrics file, which
# contain no identifiers.
set -uo pipefail
BENCH_DIR=$1; NAME=$2; LIST=$3; shift 3
OUT="$BENCH_DIR/$NAME"; LOGS="$BENCH_DIR/$NAME-logs"
[ -e "$OUT" ] && { echo "$OUT already exists" >&2; exit 2; }
mkdir -p "$OUT" "$LOGS"
cd "$(dirname "$0")/../src" || exit 2
start=$(date +%s.%N)
env TARGET_DIR="$OUT" EXPORT_PATIENT_LIST_FILE="$LIST" LOG_HOME="$LOGS" "$@" \
  node exportPatients.js > "$LOGS/console.log" 2>&1
rc=$?
end=$(date +%s.%N)
echo "run: $NAME  exit: $rc  wall: $(awk -v s="$start" -v e="$end" 'BEGIN{printf "%.1f", e-s}') s  files: $(find "$OUT" -maxdepth 1 -name '*_patient.json' | wc -l)  size: $(du -sm "$OUT" | cut -f1) MB"
grep -o 'Export summary: .*' "$LOGS/console.log" | sed -E 's/; metrics written to .*//'
metrics=$(ls -t "$LOGS"/export-metrics-*.json 2>/dev/null | head -1)
[ -n "$metrics" ] && echo "metrics: $metrics"
# Error lines name patient UUIDs, so only count them.
echo "error lines in log: $(grep -c ' ERROR: ' "$LOGS/console.log")"
exit $rc
