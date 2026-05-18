#!/bin/bash

ROOT="$(cd "$(dirname "$0")/.."; pwd)"

bash "$ROOT/scripts/stop.sh"; true
bash "$ROOT/scripts/start.sh"
