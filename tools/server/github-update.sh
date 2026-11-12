#!/usr/bin/env bash
# RFP Manager server: update straight from GitHub (no website needed as the update source, e.g. without Render).
#
# Switch a server to it once (it then becomes "sudo rfp-autoupdate" and the nightly 04:30 update):
#   curl -fsSL https://raw.githubusercontent.com/regemarkfp/rfp-manager/main/tools/server/github-update.sh | sudo bash -s -- --install
#
# Each run: if package.json on GitHub has a newer version than this server, the code is downloaded from GitHub,
# installed in /opt/rfp-manager (the old copy kept as /opt/rfp-manager.old), and the website restarted. If it does
# not start, the old copy is put back. Settings, the database, recordings and the NAS are not touched.
#   --install            make this the server's updater (and update now)
#   --force              install even when the version is the same
#   --repo owner/name    another repository (default regemarkfp/rfp-manager)   --branch main
set -euo pipefail
REPO=regemarkfp/rfp-manager; BRANCH=main; INSTALL=""; FORCE=""
ETC=/etc/rfp-manager; APP=/opt/rfp-manager; DATA=/var/lib/rfp-manager; SVC=rfpsvc
[ -f "$ETC/update-repo" ] && REPO="$(cat "$ETC/update-repo")"
# "Install now (reinstall)" on the Universe page leaves this flag for one run
[ -f "$ETC/update-force" ] && { FORCE=1; rm -f "$ETC/update-force"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --install) INSTALL=1; shift ;;
    --force) FORCE=1; shift ;;
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
[ -d "$APP" ] || { echo "RFP Manager is not installed here ($APP). Use the setup command from a website first."; exit 1; }
command -v jq >/dev/null || apt-get install -y -q jq >/dev/null

if [ -n "$INSTALL" ]; then
  mkdir -p "$ETC"; touch "$ETC/update-github"; echo "$REPO" > "$ETC/update-repo"; rm -f "$ETC/no-auto-update"
  curl -fsSL --retry 3 "https://raw.githubusercontent.com/$REPO/$BRANCH/tools/server/github-update.sh" -o /usr/local/bin/rfp-autoupdate
  chmod 755 /usr/local/bin/rfp-autoupdate
  cat > /etc/systemd/system/rfp-autoupdate.service <<'EOF'
[Unit]
Description=RFP Manager: install a newer version from GitHub
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/rfp-autoupdate
EOF
  cat > /etc/systemd/system/rfp-autoupdate.timer <<'EOF'
[Unit]
Description=RFP Manager: check for a newer version every night
[Timer]
OnCalendar=*-*-* 04:30
RandomizedDelaySec=15m
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload; systemctl enable --now rfp-autoupdate.timer >/dev/null 2>&1 || true
  echo "This server now updates from github.com/$REPO ($BRANCH): every night at 04:30, or now with: sudo rfp-autoupdate"
fi

# the small root helpers the website may run through sudo (nothing else): NAS users, and updates from the Universe page
install_helpers() {
  # the NAS's Samba users from the Universe page: a small root helper the website may run, and nothing else
  if [ -f "$APP/tools/server/nas-users.sh" ] && { [ -f "$ETC/nas" ] || grep -q "^\[NAS\]" /etc/samba/smb.conf 2>/dev/null; } && command -v smbpasswd >/dev/null; then
    install -m 755 -o root -g root "$APP/tools/server/nas-users.sh" /usr/local/sbin/rfp-nas-users
    echo "$SVC ALL=(root) NOPASSWD: /usr/local/sbin/rfp-nas-users" > /etc/sudoers.d/rfp-nas.tmp
    chmod 440 /etc/sudoers.d/rfp-nas.tmp
    if visudo -cf /etc/sudoers.d/rfp-nas.tmp >/dev/null; then mv /etc/sudoers.d/rfp-nas.tmp /etc/sudoers.d/rfp-nas; else rm -f /etc/sudoers.d/rfp-nas.tmp; fi
  fi

  # updates from the Universe page (check, install now, schedule): a small root helper the website may run, and nothing else
  if [ -f "$APP/tools/server/update-ctl.sh" ]; then
    install -m 755 -o root -g root "$APP/tools/server/update-ctl.sh" /usr/local/sbin/rfp-update-ctl
    echo "$SVC ALL=(root) NOPASSWD: /usr/local/sbin/rfp-update-ctl" > /etc/sudoers.d/rfp-update.tmp
    chmod 440 /etc/sudoers.d/rfp-update.tmp
    if visudo -cf /etc/sudoers.d/rfp-update.tmp >/dev/null; then mv /etc/sudoers.d/rfp-update.tmp /etc/sudoers.d/rfp-update; else rm -f /etc/sudoers.d/rfp-update.tmp; fi
  fi
}

REMOTE="$(curl -fsSL --retry 3 --max-time 60 "https://raw.githubusercontent.com/$REPO/$BRANCH/package.json?t=$(date +%s)" | jq -r .version)"
LOCAL="$(jq -r .version "$APP/package.json")"
[ -n "$REMOTE" ] && [ "$REMOTE" != null ] || { echo "Could not read the version on GitHub"; exit 1; }
if [ -z "$FORCE" ] && { [ "$REMOTE" = "$LOCAL" ] || [ "$(printf '%s\n%s\n' "$REMOTE" "$LOCAL" | sort -V | tail -1)" = "$LOCAL" ]; }; then install_helpers; echo "Up to date ($LOCAL)"; exit 0; fi
echo "Updating $LOCAL -> $REMOTE from github.com/$REPO"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL --retry 3 --max-time 600 "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$TMP/src.tgz"
mkdir -p "$TMP/new" && tar -xzf "$TMP/src.tgz" -C "$TMP/new" --strip-components=1
[ -f "$TMP/new/server.js" ] && [ -f "$TMP/new/package.json" ] || { echo "The download does not look like RFP Manager"; exit 1; }
(cd "$TMP/new" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
# the Android app and the WhatsApp library are not on GitHub: keep the ones this server has
for f in public/app/rfp-manager.apk public/app/rfp-manager.json; do [ -f "$APP/$f" ] && [ ! -f "$TMP/new/$f" ] && { mkdir -p "$(dirname "$TMP/new/$f")"; cp "$APP/$f" "$TMP/new/$f"; } || true; done
rm -rf "$APP.old"; mv "$APP" "$APP.old"; mv "$TMP/new" "$APP"
chown -R root:root "$APP"; chown -R "$SVC:$SVC" "$DATA" 2>/dev/null || true

# this updater keeps itself up to date (later fixes reach the server without --install)
if [ -f "$APP/tools/server/github-update.sh" ] && ! cmp -s "$APP/tools/server/github-update.sh" /usr/local/bin/rfp-autoupdate; then
  install -m 755 "$APP/tools/server/github-update.sh" /usr/local/bin/rfp-autoupdate
fi
install_helpers

# the encoders' address can change without a setup command: /etc/rfp-manager/stream-host
if [ -f "$ETC/stream-host" ] && [ -f "$ETC/env" ]; then
  SH="$(cat "$ETC/stream-host")"
  if grep -q '^STREAM_HOST=' "$ETC/env"; then sed -i "s|^STREAM_HOST=.*|STREAM_HOST=$SH|" "$ETC/env"; else echo "STREAM_HOST=$SH" >> "$ETC/env"; fi
fi

systemctl restart rfp-manager
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break; sleep 1; done
if ! curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
  echo "The new version did not start: putting $LOCAL back. See: journalctl -u rfp-manager -n 50"
  journalctl -u rfp-manager -n 30 --no-pager || true
  rm -rf "$APP"; mv "$APP.old" "$APP"; systemctl restart rfp-manager; exit 1
fi
echo "RFP Manager $REMOTE is running."
