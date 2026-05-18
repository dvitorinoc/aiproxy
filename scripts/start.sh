#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.."; pwd)"
PIDS_FILE="$ROOT/storage/.pids"
mkdir -p "$ROOT/storage" "$ROOT/logs"

if [ -f "$PIDS_FILE" ]; then
  echo "Already running? Found storage/.pids — run stop.sh first." >&2
  exit 1
fi

SERVER_RUNNING=$(ps aux | grep "node.*server\.mjs" | grep -v grep | awk '{print $2}')
QUEUE_RUNNING=$(ps aux  | grep "node.*daemon\.mjs" | grep -v grep | awk '{print $2}')
if [ -n "$SERVER_RUNNING" ] || [ -n "$QUEUE_RUNNING" ]; then
  echo "Processes already running (server: ${SERVER_RUNNING:-none}, queue: ${QUEUE_RUNNING:-none}) — run stop.sh first." >&2
  exit 1
fi

ENV_FLAG=""
[ -f "$ROOT/.env" ] && ENV_FLAG="--env-file=$ROOT/.env"

nohup node $ENV_FLAG "$ROOT/src/queue/daemon.mjs" >> "$ROOT/logs/queue.log" 2>&1 &
QUEUE_PID=$!

nohup node $ENV_FLAG "$ROOT/server.mjs" >> "$ROOT/logs/server.log" 2>&1 &
SERVER_PID=$!

echo "$SERVER_PID $QUEUE_PID" > "$PIDS_FILE"
echo "queue  started (pid $QUEUE_PID) → logs/queue.log"
echo "server started (pid $SERVER_PID) → logs/server.log"
