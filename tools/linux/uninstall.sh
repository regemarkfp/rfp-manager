#!/usr/bin/env bash
# Removes RFP Manager for this user. Your settings and data (config.json, data/) stay unless you add --everything.
set -u
dest="${RFP_HOME:-$HOME/.local/share/rfp-manager}"
systemctl --user disable --now rfp-manager.service 2>/dev/null
rm -f "$HOME/.config/systemd/user/rfp-manager.service" "$HOME/.local/bin/rfp-manager" "$HOME/.local/share/applications/rfp-manager.desktop" "$HOME/.local/share/icons/hicolor/512x512/apps/rfp-manager.png"
systemctl --user daemon-reload 2>/dev/null
if [ "${1:-}" = "--everything" ]; then rm -rf "$dest" "${XDG_STATE_HOME:-$HOME/.local/state}/rfp-manager"; echo "RFP Manager and its data are removed.";
else find "$dest" -mindepth 1 -maxdepth 1 ! -name config.json ! -name data -exec rm -rf {} +; echo "RFP Manager is removed. Its settings and data are still in $dest (remove them with --everything)."; fi
