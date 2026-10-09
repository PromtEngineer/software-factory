#!/usr/bin/env zsh
# On-camera demo 5: the hidden tests. They live outside the repo, so no agent ever sees them.
here=${0:A:h}; demo=$here/../demo-repo
C=$'\e[1;36m'; D=$'\e[2m'; B=$'\e[1m'; X=$'\e[0m'
print "${C}▸ the repo the agents work on${X}"
(cd $demo/tinylinks && ls -1 src test | sed 's/^/  /')
print ""; print "${C}▸ hidden tests, kept outside the repo (one per issue)${X}"
ls -1 $demo/hidden-tests | grep -v helpers | paste - - - | sed 's/^/  /'
print ""; print "${C}▸ hidden test for issue #2${X}  ${D}(hidden-tests/h02.test.ts)${X}"
sed 's/^/  /' $demo/hidden-tests/h02.test.ts
