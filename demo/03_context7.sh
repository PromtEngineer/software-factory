#!/usr/bin/env bash
# On-camera demo 3: Context7 Search is one GET request that returns current official docs.
set -a; . "$(dirname "$0")/../.env"; set +a
q="${1:-How do I accept only http and https URLs with zod 4?}"
printf '\033[1;36m▸ curl context7.com/api/v3/search?query=%s\033[0m\n\n' "$q"
curl -sG https://context7.com/api/v3/search -H "Authorization: Bearer $CONTEXT7_API_KEY" --data-urlencode "query=$q" | head -40
