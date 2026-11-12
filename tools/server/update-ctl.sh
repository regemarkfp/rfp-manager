#!/usr/bin/env bash
# RFP Manager: updates of this server from the Universe page. Installed as /usr/local/sbin/rfp-update-ctl by
# rfp-autoupdate; the website's account (rfpsvc) may run only this, through sudo (/etc/sudoers.d/rfp-update).
# The update itself is always rfp-autoupdate.service (tools/server/github-update.sh), so it carries on while the
# website restarts, and its output is in: journalctl -u rfp-autoupdate
#   rfp-update-ctl status                    key=value lines: the nightly schedule, the next runs, the last result
#   rfp-update-ctl log                       the updater's last 80 lines
#   rfp-update-ctl now [force]               update now (force: reinstall even when the version is the same)
#   rfp-update-ctl schedule off              no automatic updates
#   rfp-update-ctl schedule <days> <HH:MM>   update automatically: days = daily | weekdays | mon … sun
#   rfp-update-ctl once <YYYY-MM-DD> <HH:MM> update once at that time (replaces an earlier one)
#   rfp-update-ctl cancel                    drop the one-off update
set -euo pipefail
die() { echo "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "needs root"
ETC=/etc/rfp-manager
TIMER=/etc/systemd/system/rfp-autoupdate.timer
cmd="${1:-}"
show() { systemctl show "$1" -p "$2" --value 2>/dev/null || true; }
case "$cmd" in
  status)
    echo "installed=$([ -f /etc/systemd/system/rfp-autoupdate.service ] && echo yes || echo no)"
    echo "enabled=$(systemctl is-enabled rfp-autoupdate.timer 2>/dev/null || echo disabled)"
    echo "calendar=$(grep -m1 '^OnCalendar=' "$TIMER" 2>/dev/null | cut -d= -f2- || true)"
    echo "next=$(show rfp-autoupdate.timer NextElapseUSecRealtime)"
    echo "running=$(systemctl is-active rfp-autoupdate.service 2>/dev/null || true)"
    echo "result=$(show rfp-autoupdate.service Result)"
    echo "lastStart=$(show rfp-autoupdate.service ExecMainStartTimestamp)"
    echo "lastEnd=$(show rfp-autoupdate.service ExecMainExitTimestamp)"
    echo "lastCode=$(show rfp-autoupdate.service ExecMainStatus)"
    echo "once=$(show rfp-update-once.timer NextElapseUSecRealtime)"
    echo "onceActive=$(systemctl is-active rfp-update-once.timer 2>/dev/null || true)"
    echo "repo=$(cat "$ETC/update-repo" 2>/dev/null || echo regemarkfp/rfp-manager)"
    ;;
  log)
    journalctl -u rfp-autoupdate -n 80 --no-pager -o short-iso 2>/dev/null || true
    ;;
  now)
    [ -f /etc/systemd/system/rfp-autoupdate.service ] || die "The GitHub updater is not set up (see the README: rfp-autoupdate --install)"
    if [ "${2:-}" = force ]; then mkdir -p "$ETC"; touch "$ETC/update-force"; fi
    systemctl start --no-block rfp-autoupdate.service
    echo started
    ;;
  schedule)
    days="${2:-}"; at="${3:-}"
    if [ "$days" = off ]; then systemctl disable --now rfp-autoupdate.timer >/dev/null 2>&1 || true; echo off; exit 0; fi
    [[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "Time as HH:MM"
    case "$days" in
      daily) cal="*-*-* $at" ;;
      weekdays) cal="Mon..Fri *-*-* $at" ;;
      mon|tue|wed|thu|fri|sat|sun) cal="${days^} *-*-* $at" ;;
      *) die "Days: daily, weekdays or mon … sun" ;;
    esac
    cat > "$TIMER" <<EOF
[Unit]
Description=RFP Manager: install a newer version from GitHub
[Timer]
OnCalendar=$cal
RandomizedDelaySec=2m
Persistent=true
[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now rfp-autoupdate.timer >/dev/null 2>&1
    systemctl restart rfp-autoupdate.timer
    echo "$cal"
    ;;
  once)
    d="${2:-}"; at="${3:-}"
    [[ "$d" =~ ^20[0-9][0-9]-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ ]] || die "Date as YYYY-MM-DD"
    [[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "Time as HH:MM"
    [ -f /etc/systemd/system/rfp-autoupdate.service ] || die "The GitHub updater is not set up (see the README: rfp-autoupdate --install)"
    systemctl stop rfp-update-once.timer >/dev/null 2>&1 || true
    systemctl reset-failed rfp-update-once.timer rfp-update-once.service >/dev/null 2>&1 || true
    systemd-run --quiet --unit=rfp-update-once --on-calendar="$d $at" --timer-property=AccuracySec=30s --collect /bin/systemctl start --no-block rfp-autoupdate.service
    echo "$d $at"
    ;;
  cancel)
    systemctl stop rfp-update-once.timer >/dev/null 2>&1 || true
    echo cancelled
    ;;
  *) die "Use: status | log | now [force] | schedule off | schedule <days> <HH:MM> | once <YYYY-MM-DD> <HH:MM> | cancel" ;;
esac
