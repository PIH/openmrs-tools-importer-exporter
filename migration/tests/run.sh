#!/usr/bin/env bash
# Runs every test_* function in tests/test_*.sh (or the files given), each in its own subshell.
#   tests/run.sh [test_file...]
# Needs the test database: tests/testdb.sh up
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$HERE/.." || exit 2
export PATH="$HERE:$PATH"
export WORKDIR; WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
# Harness-only (lib.sh ignores MIGRATION_CONFIRM_INPUT without MIGRATION_UNDER_TEST=1): confirm reads its answer from stdin instead of /dev/tty.
export MIGRATION_UNDER_TEST=1
export MIGRATION_CONFIRM_INPUT=/dev/stdin

source lib.sh
trap - ERR

assert_eq()           { [ "$1" = "$2" ] || { echo "  expected: [$1]"; echo "  actual:   [$2] ${3:-}"; exit 1; }; }
assert_contains()     { case "$1" in *"$2"*) ;; *) echo "  expected to contain: [$2]"; echo "  in: [$1]"; exit 1 ;; esac; }
assert_not_contains() { case "$1" in *"$2"*) echo "  expected NOT to contain: [$2]"; echo "  in: [$1]"; exit 1 ;; esac; }
assert_exit()         { local want=$1 rc; shift; ( "$@" ) >/dev/null 2>&1; rc=$?; assert_eq "$want" "$rc" "(exit code of: $*)"; }

files=("$@")
[ ${#files[@]} -gt 0 ] || files=(tests/test_*.sh)
pass=0; fail=0
for f in "${files[@]}"; do
  before=$(declare -F | awk '{print $3}' | grep '^test_' | sort)
  source "$f"
  tests=$(comm -13 <(echo "$before") <(declare -F | awk '{print $3}' | grep '^test_' | sort))
  for t in $tests; do
    out=$( ( trap - ERR; set +e; load_settings tests/fixtures/test.env >/dev/null 2>&1; "$t"; exit $? ) 2>&1 )
    if [ $? -eq 0 ]; then pass=$((pass+1)); echo "PASS $t"
    else fail=$((fail+1)); echo "FAIL $t"; echo "$out" | sed 's/^/    /'; fi
  done
  unset -f $tests
done
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
