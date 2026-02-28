#!/usr/bin/env bash

set -euo pipefail

# Simple log generator for local dev.
# It creates a log file if needed and appends lines in the same general
# format the parser expects:
#   "<ts>\t<LEVEL>\t<module>\t<message>"
# with a mix of INFO / WARNING / ERROR / CRITICAL messages.

# Usage:
#   # use default ./test-observer.log in the repo root
#   bash ./forTestingAppendToLog.sh
#
#   # or specify a custom path
#   bash ./forTestingAppendToLog.sh /absolute/path/to/your.log
#
# You can also use the LOG_FILE env var:
#   LOG_FILE=/tmp/my-log.log bash ./forTestingAppendToLog.sh

LOG_FILE="${LOG_FILE:-${1:-./test-observer.log}}"

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

echo "forTestingAppendToLog.sh: appending test lines to '$LOG_FILE' (Ctrl-C to stop)"

counter=0

while true; do
  # Timestamp like "2025-10-22 07:33:49,000" but forced to UTC/GMT
  ts="$(date -u '+%Y-%m-%d %H:%M:%S,000')"
  round="$(( (RANDOM % 900000) + 100000 ))"

  counter=$((counter + 1))

  level="INFO"
  message="network:devnet round:${round} protocol:fdc message=info_event"

  # On a regular cadence, emit other levels too
  if (( counter % 30 == 0 )); then
    level="CRITICAL"
    message="network:devnet round:${round} protocol:fdc message=critical_event"
  elif (( counter % 15 == 0 )); then
    level="ERROR"
    message="network:devnet round:${round} protocol:fdc message=error_event"
  elif (( counter % 7 == 0 )); then
    level="WARNING"
    message="network:devnet round:${round} protocol:fdc message=warning_event"
  fi

  printf '%s\t%s\tforTestingAppendToLog\t%s\n' \
    "$ts" "$level" "$message" >> "$LOG_FILE"

  sleep 1
done

