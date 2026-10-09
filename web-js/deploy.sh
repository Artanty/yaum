#!/usr/bin/env bash
# Publish web/ to Surge and confirm it is live by polling the URL.
#
# Why this exists: the surge CLI's upload/CDN progress bars do not reliably
# finish or exit — publish(s) can hang on a bar reading "CDN: 0%" even though
# the upload already landed. So this script treats the live URL as ground
# truth: it uploads a unique marker file and polls it.
#
# Usage:   ./deploy.sh [domain]
#          domain defaults to CNAME, then to simple3453t3fg4344.surge.sh
# Exit:    0 = marker is live on the site; 1 = could not confirm
set -u

cd "$(dirname "$0")" || exit 2

DEFAULT_DOMAIN="simple3453t3fg4344.surge.sh"
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ] && [ -f CNAME ]; then
  DOMAIN="$(tr -d '[:space:]' < CNAME)"
fi
[ -z "$DOMAIN" ] && DOMAIN="$DEFAULT_DOMAIN"

URL="https://$DOMAIN"
MARK="__deploycheck"
TOKEN="deploy-$(date +%s)-$$"

echo "$TOKEN" > "$MARK"
SURGE_PID=""
trap 'rm -f "$MARK"; [ -n "$SURGE_PID" ] && kill "$SURGE_PID" 2>/dev/null' EXIT

LOG="/tmp/plst-surge-$DOMAIN.log"
echo "Publishing $PWD to $DOMAIN ..." >&2
surge publish . "$DOMAIN" > "$LOG" 2>&1 &
SURGE_PID=$!

for i in $(seq 1 120); do
  if [ "$(curl -s -m 5 "$URL/$MARK" 2>/dev/null)" = "$TOKEN" ]; then
    echo "OK — live at $URL (deep links like $URL/library served via 200.html)" >&2
    exit 0
  fi
  if ! kill -0 "$SURGE_PID" 2>/dev/null; then
    if [ -s "$LOG" ]; then
      echo "surge exited before the marker was live; last lines of $LOG:" >&2
      tail -5 "$LOG" >&2
    else
      echo "surge is not running (check the install and that you ran 'surge login')" >&2
    fi
    exit 1
  fi
  [ $((i % 10)) -eq 0 ] && echo "waiting for the CDN to serve the upload (${i}s)..." >&2
  sleep 1
done

echo "FAILED — marker not served after 120s. The upload may be stuck; see $LOG" >&2
exit 1