#!/usr/bin/env bash
# Remove dsh-bark-push from a DSH profile. The plugin's state file is kept so a
# reinstall restores mute state and configuration; delete it manually to start
# clean:
#
#   rm -rf "$DSH_HOME/bark-push"
set -euo pipefail

profile="${1:-web}"
if ! command -v dsh >/dev/null 2>&1; then
  echo "dsh command not found." >&2
  exit 1
fi

dsh plugin --profile "${profile}" remove dsh-bark-push
echo "Removed from profile '${profile}'. State under \$DSH_HOME/bark-push was kept."
