#!/usr/bin/env bash
# トレードの勝ちすぎの切り分け（計測だけ）。1つの種で、試し（VARIANTS）を4本ずつ並べて回す。
#   tools/sim-harness/trade-why.sh <種> <出力先>
set -u
SEED=$1; OUT=$2; mkdir -p "$OUT"
VARIANTS=${VARIANTS:-"none full rounds=pack rounds=mid+y2 one cap=1 cap=3 norebuy pairlimit=1"}
run() {
  local v=$1 mode=trade tv=$1
  [ "$v" = none ] && mode=none && tv=
  [ "$v" = full ] && tv=
  TRADE_VARIANT="$tv" node tools/sim-harness/human-trade-probe.mjs $mode $SEED > "$OUT/$SEED-${v//[=+,]/_}.log" 2>&1
}
export -f run; export SEED OUT
printf '%s\n' $VARIANTS | xargs -P "${JOBS:-4}" -I{} bash -c 'run "$@"' _ {}
grep -h '^RESULT ' "$OUT"/$SEED-*.log
