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
#   rfp-nas-users apply                    who may open what, on stdin, one rule per line (tab separated):
#                                            full   <users,…>                    the whole NAS, read and write
#                                            read   <users,…>                    the whole NAS, read only
#                                            share  <Name> <folder> <readers,…> <writers,…>   one folder as its own share
#                                          (an empty list is written as -) written to /etc/samba/rfp-nas.conf (smb.conf includes it), checked with
#                                          testparm, and Samba reloaded. Only names of NAS users and folders inside
#                                          the NAS are accepted; the share settings themselves are fixed here.
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
nasroot() {
  local r=""
  [ -f /etc/rfp-manager/nas ] && r="$(cat /etc/rfp-manager/nas)"
  [ -z "$r" ] && r="$(awk '/^\[NAS\]/{f=1;next} /^\[/{f=0} f && $1=="path"{print $3}' /etc/samba/smb.conf /etc/samba/rfp-nas.conf 2>/dev/null | head -1 || true)"
  [ -n "$r" ] && [ -d "$r" ] || die "No NAS folder found"
  realpath -e "$r"
}
userlist() {   # a,b,c → checked NAS users, space separated for smb.conf
  local out="" u
  IFS=',' read -ra arr <<< "${1:-}"
  for u in "${arr[@]}"; do
    [ -z "$u" ] || [ "$u" = "-" ] && continue
    [[ "$u" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "Not a user name: $u"
    pdbedit -u "$u" >/dev/null 2>&1 || die "Not a NAS user: $u"
    out="$out $u"
  done
  echo "${out# }"
}
HOSTS="127. 10. 172.16.0.0/12 192.168. 100.64.0.0/10"
share() {   # name path valid read write
  printf '\n[%s]\n   path = %s\n   valid users = %s\n   read list = %s\n   write list = %s\n   read only = yes\n   browseable = yes\n   access based share enum = yes\n   create mask = 0664\n   directory mask = 2775\n   force group = %s\n   hosts allow = %s\n' "$1" "$2" "${3:-root}" "$4" "$5" "$GROUP" "$HOSTS"
}
case "$cmd" in
  apply)
    command -v testparm >/dev/null || die "Samba is not installed"
    root="$(nasroot)"; full=""; ro=""; body=""; names=" NAS "
    while IFS=$'\t' read -r kind a b c d; do
      case "$kind" in
        full) full="$(userlist "$a")" ;;
        read) ro="$(userlist "$a")" ;;
        share)
          [[ "$a" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$ ]] || die "Not a share name: $a"
          case " $(echo "$a" | tr 'A-Z' 'a-z') " in " global "|" homes "|" printers "|" print\$ "|" nas "|" ipc\$ ") die "That share name is reserved: $a" ;; esac
          [[ "$names" == *" $a "* ]] && die "Two shares are called $a"
          names="$names$a "
          [[ "$b" =~ ^[A-Za-z0-9\ _.,\'\(\)\&+-]+(/[A-Za-z0-9\ _.,\'\(\)\&+-]+)*$ ]] && [[ "/$b/" != *"/../"* ]] && [[ "/$b/" != *"/./"* ]] || die "Not a folder in the NAS: $b"
          p="$(realpath -e "$root/$b" 2>/dev/null)" || die "No such folder: $b"
          [ -d "$p" ] && [[ "$p" == "$root/"* ]] || die "Not a folder in the NAS: $b"
          r="$(userlist "$c")"; w="$(userlist "$d")"
          body="$body$(share "$a" "$p" "$(echo "$r $w" | xargs)" "$r" "$w")"$'\n' ;;
        '') ;;
        *) die "Unknown rule: $kind" ;;
      esac
    done
    conf="# Written by rfp-nas-users from the Universe page (RFP Manager). Changes here are replaced on the next save.$(share NAS "$root" "$(echo "$full $ro" | xargs)" "$ro" "$full")"$'\n'"$body"
    tmp="$(mktemp)"; printf '%s\n' "$conf" > "$tmp"
    cp -a /etc/samba/smb.conf /etc/samba/smb.conf.rfp-bak
    # the first time: the old [NAS] block of install.sh comes out of smb.conf, the include goes in
    if grep -q '^\[NAS\]' /etc/samba/smb.conf; then
      awk 'BEGIN{skip=0} /^# RFP Manager.s NAS \(install.sh\)/{next} /^\[NAS\]/{skip=1;next} /^\[/{skip=0} !skip' /etc/samba/smb.conf > /etc/samba/smb.conf.new && mv /etc/samba/smb.conf.new /etc/samba/smb.conf
    fi
    grep -q '^include = /etc/samba/rfp-nas.conf' /etc/samba/smb.conf || printf '\n# RFP Manager: the NAS shares (Universe page)\ninclude = /etc/samba/rfp-nas.conf\n' >> /etc/samba/smb.conf
    [ -f /etc/samba/rfp-nas.conf ] && cp -a /etc/samba/rfp-nas.conf /etc/samba/rfp-nas.conf.bak
    install -m 644 "$tmp" /etc/samba/rfp-nas.conf; rm -f "$tmp"
    if ! testparm -s >/dev/null 2>&1; then
      cp -a /etc/samba/smb.conf.rfp-bak /etc/samba/smb.conf
      [ -f /etc/samba/rfp-nas.conf.bak ] && cp -a /etc/samba/rfp-nas.conf.bak /etc/samba/rfp-nas.conf || rm -f /etc/samba/rfp-nas.conf
      die "Samba did not accept the settings; nothing changed"
    fi
    systemctl reload smbd 2>/dev/null || smbcontrol all reload-config 2>/dev/null || true
    echo ok ;;
  folders)   # top two levels of folders in the NAS, one per line (relative)
    root="$(nasroot)"
    find "$root" -mindepth 1 -maxdepth 2 -type d ! -name '.*' -printf '%P\n' 2>/dev/null | sort | head -500 ;;
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
    share="$(nasroot 2>/dev/null || true)"
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
  *) die "usage: rfp-nas-users list|info|folders|apply|add|passwd|enable|disable|remove <name>" ;;
esac
