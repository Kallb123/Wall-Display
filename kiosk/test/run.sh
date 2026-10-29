#!/usr/bin/env bash
# Runs every kiosk test file and fails if any of them fails.
set -euo pipefail

test_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
failed=0

for test_file in "$test_dir"/*.test.sh; do
  echo "# $(basename "$test_file")"
  bash "$test_file" || failed=1
done

exit "$failed"
