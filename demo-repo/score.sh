#!/bin/zsh
# Score a checkout against the hidden tests. Usage: score.sh <checkout-dir> [issue ids...]
# Prints one line per issue: "#N PASS|FAIL".
set -u
src=$1; shift
here=${0:A:h}
if (( $# )); then ids=("$@"); else ids=(1 2 3 4 5 6 7 8 9); fi
tmp=$(mktemp -d)
rsync -a --exclude node_modules --exclude .git "$src"/ "$tmp"/
ln -s "$here/tinylinks/node_modules" "$tmp/node_modules"
mkdir -p "$tmp/test/_hidden"
cp "$here/hidden-tests/helpers.ts" "$tmp/test/_hidden/helpers.ts"
sed -i '' 's#\.\./src/#../../src/#' "$tmp/test/_hidden/helpers.ts"
for i in $ids; do
  f=$(printf "h%02d.test.ts" $i)
  cp "$here/hidden-tests/$f" "$tmp/test/_hidden/$f"
  if (cd "$tmp" && ./node_modules/.bin/vitest run "test/_hidden/$f" >/dev/null 2>&1); then echo "#$i PASS"; else echo "#$i FAIL"; fi
done
rm -rf "$tmp"
