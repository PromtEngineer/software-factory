#!/usr/bin/env zsh
# On-camera demo 4: run tinylinks from a git ref and poke it like a user would, then run the hidden tests.
#   04_app_check.sh <git-ref> "<label>"     e.g.  main "BEFORE"   /   demo/after "AFTER"
set -u
ref=$1; label=$2
here=${0:A:h}; demo=$here/../demo-repo
set -a; . "$here/../.env"; set +a
B=$'\e[1m'; C=$'\e[1;36m'; G=$'\e[32m'; R=$'\e[31m'; D=$'\e[2m'; X=$'\e[0m'
tmp=$(mktemp -d)
repo=${FACTORY_REPO#https://}; repo=${repo#github.com/}   # owner/name of your tinylinks copy
git clone -q --depth 1 --branch "$ref" "https://x-access-token:$GITHUB_TOKEN@github.com/$repo.git" "$tmp/app" 2>/dev/null
ln -s "$demo/tinylinks/node_modules" "$tmp/app/node_modules"
(cd "$tmp/app" && PORT=3911 ./node_modules/.bin/tsx src/main.ts >/dev/null 2>&1 &) ; sleep 2
H=http://localhost:3911
print -P ""; print "${C}▸ tinylinks @ ${ref}  (${label})${X}"
check() { # issue, description, expected-after, actual
  local mark; [[ $4 == "$3" ]] && mark="${G}✓${X}" || mark="${R}✗${X}"
  printf "  %s %-4s %-44s %s\n" "$mark" "#$1" "$2" "${B}$4${X}"
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check 2 "POST a URL with no scheme (example.com)" 400 "$(code -X POST $H/links -H 'content-type: application/json' -d '{"url":"example.com"}')"
check 3 "GET stats for a slug that doesn't exist" 404 "$(code $H/stats/nope)"
s=$(curl -s -X POST $H/links -H 'content-type: application/json' -d '{"url":"https://upstash.com"}' | sed -E 's/.*"slug":"([^"]+)".*/\1/')
curl -s -o /dev/null -I $H/$s
check 4 "HEAD request, then count clicks" '"clicks":0' "$(curl -s $H/stats/$s | grep -o '"clicks":[0-9]*')"
check 5 "POST with custom slug my-launch, slug used?" '"slug":"my-launch"' "$(curl -s -X POST $H/links -H 'content-type: application/json' -d '{"url":"https://upstash.com/box","slug":"my-launch"}' | grep -o '"slug":"[^"]*"')"
check 7 "DELETE a link" 204 "$(code -X DELETE $H/links/$s)"
check 8 "GET /links?limit=2 (pagination)" 200 "$(code "$H/links?limit=2")"
pkill -f "$tmp/app" 2>/dev/null; lsof -ti tcp:3911 | xargs kill 2>/dev/null
print ""; print "${C}▸ hidden tests (the agents never saw these)${X}"
res=$("$demo/score.sh" "$tmp/app" 2>/dev/null); pass=$(print -r -- "$res" | grep -c PASS)
print -r -- "$res" | sed -e "s/PASS/${G}PASS${X}/" -e "s/FAIL/${R}FAIL${X}/" | paste - - - | sed 's/^/  /'
print ""; print "  ${B}${pass} of 9 hidden tests pass${X}"
rm -rf "$tmp"
