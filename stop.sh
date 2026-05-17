#!/bin/bash

ROOT="$(cd "$(dirname "$0")"; pwd)"
PIDS_FILE="$ROOT/.pids"

if [ ! -f "$PIDS_FILE" ]; then
  echo "No .pids file found — nothing to stop." >&2
  exit 1
fi

read SERVER_PID QUEUE_PID < "$PIDS_FILE"

kill "$SERVER_PID" "$QUEUE_PID" 2>/dev/null && echo "Stopped (server $SERVER_PID, queue $QUEUE_PID)" || echo "Processes may already be stopped."
rm -f "$PIDS_FILE"
