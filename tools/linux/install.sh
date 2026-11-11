#!/usr/bin/env bash
# Installs RFP Manager for this user (no root needed): the program in ~/.local/share/rfp-manager, "rfp-manager" in
# ~/.local/bin, RFP Manager in the applications menu (and its screens), and a systemd user service that keeps it
# running and starts it again after an update. Run it from the unpacked folder:   ./install.sh [--autostart]
#   --autostart   start RFP Manager when you log in (and keep it running after you log out: needs "loginctl enable-linger")
# Updating: unpack the new download and run ./install.sh again – config.json, data/ and your images are kept.
set -eu
src="$(cd "$(dirname "$0")" && pwd)"
dest="${RFP_HOME:-$HOME/.local/share/rfp-manager}"
auto=0; [ "${1:-}" = "--autostart" ] && auto=1
[ -f "$src/server.js" ] || { echo "Run this from the unpacked RFP Manager folder." >&2; exit 1; }
if systemctl --user is-active --quiet rfp-manager.service 2>/dev/null; then systemctl --user stop rfp-manager.service; restart=1; else restart=0; fi
mkdir -p "$dest"
if [ "$src" != "$dest" ]; then
  # everything except what belongs to this PC (its settings, data, and the update backups)
  (cd "$src" && tar --exclude=./config.json --exclude=./data --exclude=./.update-backup --exclude=./.update-tmp -cf - .) | (cd "$dest" && tar -xf -)
fi
chmod +x "$dest/rfp-manager" "$dest/run.sh" "$dest/node/bin/node" 2>/dev/null || true
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps" "$HOME/.config/systemd/user"
ln -sf "$dest/rfp-manager" "$HOME/.local/bin/rfp-manager"
cp "$dest/public/icons/icon-512.png" "$HOME/.local/share/icons/hicolor/512x512/apps/rfp-manager.png"
cat > "$HOME/.local/share/applications/rfp-manager.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=RFP Manager
Comment=Live production: productions, scoring, CasparCG graphics and streaming
Exec=$dest/rfp-manager
Icon=rfp-manager
Terminal=false
Categories=AudioVideo;Video;
StartupWMClass=rfp-manager
Actions=control;scorer;timeline;console;stop;

[Desktop Action control]
Name=Graphics control
Exec=$dest/rfp-manager --screen /live/control.html

[Desktop Action scorer]
Name=Scorer
Exec=$dest/rfp-manager --screen /scorer

[Desktop Action timeline]
Name=Timeline
Exec=$dest/rfp-manager --screen /app#/list/timeline

[Desktop Action console]
Name=Console (in a terminal)
Exec=x-terminal-emulator -e $dest/rfp-manager --console

[Desktop Action stop]
Name=Stop RFP Manager
Exec=$dest/rfp-manager --stop
DESK
cat > "$HOME/.config/systemd/user/rfp-manager.service" <<UNIT
[Unit]
Description=RFP Manager (live production)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$dest
ExecStart=$dest/rfp-manager --loop
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT
if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload 2>/dev/null; then
  if [ "$auto" = 1 ]; then systemctl --user enable rfp-manager.service >/dev/null; loginctl enable-linger "$USER" 2>/dev/null || true; echo "Starts when you log in."; fi
  [ "$restart" = 1 ] && systemctl --user start rfp-manager.service
fi
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
cat <<DONE

RFP Manager is installed in $dest
Open it from the applications menu (RFP Manager), or run:  rfp-manager
(If "rfp-manager" is not found, log out and in once so ~/.local/bin is on your PATH.)
Copy templates/rfp into CasparCG's template folder for the graphics.
Remove it again with:  $dest/uninstall.sh
DONE
