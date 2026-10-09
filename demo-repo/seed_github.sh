#!/bin/zsh
# Create the demo repo on GitHub (private) and open the 10 issues with the `factory` label.
# Usage: demo-repo/seed_github.sh <owner/repo>      e.g. PromtEngineer/tinylinks
# Needs the gh CLI logged in. Run it once; it refuses to touch a repo that already exists.
set -eu
repo=$1
here=${0:A:h}
if gh repo view "$repo" >/dev/null 2>&1; then echo "$repo already exists; not touching it"; exit 1; fi
cd "$here/tinylinks"
gh repo create "$repo" --private --source . --remote origin --push
gh label create factory --repo "$repo" --color 0E8A16 --description "Work for the software factory" || true
python3 - "$here/issues.json" "$repo" <<'P'
import json, subprocess, sys
for i in json.load(open(sys.argv[1])):
    labels = ",".join(["factory"] + i["labels"])
    for l in i["labels"]:
        subprocess.run(["gh", "label", "create", l, "--repo", sys.argv[2]], capture_output=True)
    subprocess.run(["gh", "issue", "create", "--repo", sys.argv[2], "--title", i["title"], "--body", i["body"], "--label", labels], check=True)
    print("created:", i["title"])
P
echo "Done. GitHub issue numbers follow the order in issues.json (#1..#10), so the hidden tests line up."
