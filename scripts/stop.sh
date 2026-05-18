#!/bin/bash

ROOT="$(cd "$(dirname "$0")/.."; pwd)"
PIDS_FILE="$ROOT/storage/.pids"

SERVER_PID=""
QUEUE_PID=""

if [ -f "$PIDS_FILE" ]; then
  read SERVER_PID QUEUE_PID < "$PIDS_FILE"
else
  echo "No storage/.pids found — searching via ps aux..." >&2
  SERVER_PID=$(ps aux | grep "node.*server\.mjs" | grep -v grep | awk '{print $2}')
  QUEUE_PID=$(ps aux  | grep "node.*daemon\.mjs" | grep -v grep | awk '{print $2}')
fi

if [ -z "$SERVER_PID" ] && [ -z "$QUEUE_PID" ]; then
  echo "No running processes found." >&2
  exit 1
fi

[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null && echo "Stopped server (pid $SERVER_PID)"
[ -n "$QUEUE_PID"  ] && kill "$QUEUE_PID"  2>/dev/null && echo "Stopped queue  (pid $QUEUE_PID)"
rm -f "$PIDS_FILE"
