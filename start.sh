#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")"; pwd)"
PIDS_FILE="$ROOT/.pids"
mkdir -p "$ROOT/logs"

if [ -f "$PIDS_FILE" ]; then
  echo "Already running? Found .pids — run stop.sh first." >&2
  exit 1
fi

nohup node "$ROOT/src/queue/daemon.mjs" >> "$ROOT/logs/queue.log" 2>&1 &
QUEUE_PID=$!

nohup node "$ROOT/server.mjs" >> "$ROOT/logs/server.log" 2>&1 &
SERVER_PID=$!

echo "$SERVER_PID $QUEUE_PID" > "$PIDS_FILE"
echo "queue  started (pid $QUEUE_PID) → logs/queue.log"
echo "server started (pid $SERVER_PID) → logs/server.log"
