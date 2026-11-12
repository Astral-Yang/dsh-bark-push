#!/usr/bin/env bash
# Install dsh-bark-push into a DSH profile.
#
#   ./scripts/install.sh [profile]    # default: web
#
# The profile's plugin manager forwards `add link:<this directory>` to pnpm and
# appends the package to dsh.profile.bundles, so the bundle layer's
# cordis.patch.yml inserts the loader entry. Restart the profile afterwards
# (or let dsh-hmr reload it) and open Settings -> Bark 推送.
set -euo pipefail

profile="${1:-web}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v dsh >/dev/null 2>&1; then
  echo "dsh command not found. Install @deepseek-ai/dsh or run this through your packaged DSH launcher." >&2
  exit 1
fi

echo "Installing ${here} into profile '${profile}'..."
dsh plugin --profile "${profile}" add "link:${here}"
echo
echo "Installed. Restart the profile (for example: dsh --profile ${profile}) and open Settings -> Bark 推送."
echo "The management page is also available at /api/bark-push/ui once the Web profile is running."
