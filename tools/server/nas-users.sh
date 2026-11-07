#!/usr/bin/env bash
# RFP Manager: the NAS's Samba users, managed from the Universe page. Installed as /usr/local/sbin/rfp-nas-users by
# rfp-autoupdate; the website's account (rfpsvc) may run only this, through sudo (/etc/sudoers.d/rfp-nas).
# The same users work on the house network and over Tailscale (the share allows both).
#   rfp-nas-users list                     one line per user: name<TAB>enabled|disabled<TAB>made-here|existing
#   rfp-nas-users info                     host<TAB>tailscale-name<TAB>tailscale-ip<TAB>share-path
#   rfp-nas-users add <name>               password on stdin (one line): a NAS-only login is made if <name> is new
#   rfp-nas-users passwd <name>            password on stdin
#   rfp-nas-users enable|disable <name>
#   rfp-nas-users remove <name>            off the NAS; a login made here is deleted, an existing person's is kept
set -euo pipefail
MARK="RFP NAS user"
GROUP=nas
cmd="${1:-}"; name="${2:-}"
die() { echo "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "needs root"
command -v pdbedit >/dev/null || die "Samba is not installed"
check() {
  [[ "$name" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "Use lower-case letters, digits, - or _ (up to 32), starting with a letter"
  case "$name" in root|rfp|rfpsvc|nobody|daemon|bin|sys|www-data|mongodb) die "That name is reserved" ;; esac
  if id "$name" >/dev/null 2>&1; then
    local uid gecos; uid="$(id -u "$name")"; gecos="$(getent passwd "$name" | cut -d: -f5)"
    if [ "$uid" -lt 1000 ] && [ "$gecos" != "$MARK" ]; then die "That is a system account"; fi
  fi
}
readpw() { IFS= read -r PW || true; [ "${#PW}" -ge 8 ] || die "Use a password of at least 8 characters"; [ "${#PW}" -le 128 ] || die "That password is too long"; }
made() { [ "$(getent passwd "$1" | cut -d: -f5)" = "$MARK" ]; }
case "$cmd" in
  list)
    members="$(getent group "$GROUP" | cut -d: -f4 | tr ',' '\n' | grep -v '^$' || true)"
    pdbedit -Lw 2>/dev/null | while IFS=: read -r u _ _ _ flags _; do
      echo "$members" | grep -qx "$u" || continue
      st=enabled; [[ "$flags" == *D* ]] && st=disabled
      kind=existing; made "$u" && kind=made-here
      printf '%s\t%s\t%s\n' "$u" "$st" "$kind"
    done ;;
  info)
    ts="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//' || true)"
    tip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
    share="$(awk '/^\[NAS\]/{f=1;next} /^\[/{f=0} f && $1=="path"{print $3}' /etc/samba/smb.conf 2>/dev/null | head -1 || true)"
    printf '%s\t%s\t%s\t%s\n' "$(hostname)" "$ts" "$tip" "$share" ;;
  add)
    check; readpw
    if ! id "$name" >/dev/null 2>&1; then useradd -M -s /usr/sbin/nologin -c "$MARK" -G "$GROUP" "$name"; else usermod -aG "$GROUP" "$name"; fi
    printf '%s\n%s\n' "$PW" "$PW" | smbpasswd -s -a "$name" >/dev/null
    smbpasswd -e "$name" >/dev/null ;;
  passwd)
    check; readpw
    pdbedit -u "$name" >/dev/null 2>&1 || die "No such NAS user"
    printf '%s\n%s\n' "$PW" "$PW" | smbpasswd -s "$name" >/dev/null ;;
  enable|disable)
    check; pdbedit -u "$name" >/dev/null 2>&1 || die "No such NAS user"
    if [ "$cmd" = enable ]; then smbpasswd -e "$name" >/dev/null; else smbpasswd -d "$name" >/dev/null; fi ;;
  remove)
    check
    pdbedit -u "$name" >/dev/null 2>&1 && smbpasswd -x "$name" >/dev/null || true
    gpasswd -d "$name" "$GROUP" >/dev/null 2>&1 || true
    if made "$name"; then userdel "$name" >/dev/null 2>&1 || true; fi ;;
  *) die "usage: rfp-nas-users list|info|add|passwd|enable|disable|remove <name>" ;;
esac
