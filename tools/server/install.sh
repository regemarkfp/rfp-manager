#!/usr/bin/env bash
# RFP Manager server: the website, live streaming (MediaMTX: SRT + RTMP in, WebRTC + HLS out) and https (Caddy)
# on one Ubuntu 22.04/24.04 VM (Oracle Cloud, Hetzner, any). Run again with a new link to update.
#
#   curl -fsSL https://<your-site>/server/install.sh | sudo bash -s -- --from https://<your-site> --token <token>
#
# The website makes this command (Settings → Server). It downloads the program and the database / Google sign-in
# settings from that website, so this server is the same site with streaming added.
#   --domain tv.example.com   your own name for it (point its DNS A record at this server first).
#                             Without one it uses <ip>.sslip.io, which works straight away.
#   --email you@example.com   for the https certificate (optional)
#   --keep-days 90            how long recordings (the videos) are kept; 0 = for ever
#
# At home (a Raspberry Pi 3/4/5 with 64-bit Raspberry Pi OS Lite, or any Debian/Ubuntu box) with no ports open:
#   --tunnel <token>          a Cloudflare Tunnel connector token (Cloudflare → Zero Trust → Networks → Tunnels).
#                             The website is reached through Cloudflare, so no port forwarding and no fixed IP.
#                             Set the tunnel's public hostnames (e.g. regemarkfp.com, admin.regemarkfp.com) to
#                             http://localhost:8080. Paste the token yourself; it is kept on this machine only.
#   --home                    the same without installing the tunnel (one already runs, or you add it later).
#   --recordings /mnt/usb     where the stream recordings go (a USB drive rather than the SD card).
#   Tailscale is installed too: run "sudo tailscale up" once, then encoders on your tailnet send SRT / RTMP to
#   this machine's Tailscale name (Cloudflare carries only the website, not SRT/RTMP/WebRTC).
#
# A home server that is also the database and a NAS (an old PC with Ubuntu Server 24.04):
#   --local-db                MongoDB on this machine. The first time, everything is copied from the database the
#                             website used (Atlas). Backed up every night to the NAS (or /var/backups/rfp-manager).
#   --nas /srv/nas            a Samba share "NAS" for the house network and Tailscale, with assets/ (every image of
#                             RFP Manager as a file), templates/, shared/ and backups/. Set your Samba password
#                             once with:  sudo smbpasswd -a <your user>
#   --no-recordings           streams are relayed but not recorded.
#   --no-auto-update          do not update by itself. Otherwise the server checks the website every night at 04:30
#                             and installs a newer RFP Manager on its own (with its own update key, kept here).
#   --stream-host stream.example.com   the public name encoders send SRT / RTMP to (home server with UDP 8890 and
#                             TCP 1935 forwarded on the router). Default at home: this machine's Tailscale name.
set -euo pipefail

FROM=""; TOKEN=""; DOMAIN=""; ADMIN=""; EMAIL=""; KEEP_DAYS=90; TUNNEL=""; HOME_MODE=""; RECDIR=/var/lib/mediamtx/recordings
UKEY=""; AUTOUP=1; AUTOUP_SET=""; LOCALDB=""; NAS=""; RECORD=true; SHOST=""; RECORD_SET=
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2%/}"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --update-key) UKEY="$2"; shift 2 ;;
    --no-auto-update) AUTOUP=""; AUTOUP_SET=1; shift ;;
    --auto-update) AUTOUP=1; AUTOUP_SET=1; shift ;;
    --domain) DOMAIN="${2#https://}"; DOMAIN="${DOMAIN%/}"; shift 2 ;;
    --admin-domain) ADMIN="${2#https://}"; ADMIN="${ADMIN%/}"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --keep-days) KEEP_DAYS="$2"; shift 2 ;;
    --tunnel) TUNNEL="$2"; HOME_MODE=1; shift 2 ;;
    --home) HOME_MODE=1; shift ;;
    --recordings) RECDIR="${2%/}"; shift 2 ;;
    --local-db) LOCALDB=1; shift ;;
    --nas) NAS="${2%/}"; shift 2 ;;
    --no-recordings) RECORD=false; RECORD_SET=1; shift ;;
    --recordings-on) RECORD=true; RECORD_SET=1; shift ;;
    --stream-host) SHOST="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
[ -n "$FROM" ] && { [ -n "$TOKEN" ] || [ -n "$UKEY" ]; } || { echo "Usage: install.sh --from https://<your-site> --token <token>   (the website's Settings → Server makes the command)"; exit 1; }

exec > >(tee -a /var/log/rfp-install.log) 2>&1
say() { printf '\n== %s\n' "$*"; }
APP=/opt/rfp-manager; DATA=/var/lib/rfp-manager; ETC=/etc/rfp-manager
# an update of a home server stays a home server
[ -z "$HOME_MODE" ] && [ -f "$ETC/home" ] && HOME_MODE=1
[ -f "$ETC/recordings" ] && [ "$RECDIR" = /var/lib/mediamtx/recordings ] && RECDIR="$(cat "$ETC/recordings")"
# and keeps its own database, NAS and recording choice
[ -z "$LOCALDB" ] && [ -f "$ETC/localdb" ] && LOCALDB=1
[ -z "$NAS" ] && [ -f "$ETC/nas" ] && NAS="$(cat "$ETC/nas")"
[ -z "$RECORD_SET" ] && [ -f "$ETC/no-recordings" ] && RECORD=false
[ -z "$SHOST" ] && [ -f "$ETC/stream-host" ] && SHOST="$(cat "$ETC/stream-host")"

case "$(uname -m)" in
  aarch64|arm64) NODE_ARCH=arm64; MTX_ARCH='linux_arm64(v8)?' ;;
  x86_64|amd64) NODE_ARCH=x64; MTX_ARCH='linux_amd64' ;;
  *) echo "This processor ($(uname -m)) is not supported."; exit 1 ;;
esac

say "Checking the setup link"
AUTH="t=$TOKEN"; [ -z "$TOKEN" ] && AUTH="u=$UKEY"
curl -fsS --retry 3 --max-time 120 "$FROM/api/server/env?$AUTH" -o /tmp/rfp-site.env || { echo "The website did not accept this link. Make a new one: Settings → Server."; exit 1; }

say "System packages"
export DEBIAN_FRONTEND=noninteractive
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
apt-get update -y -q
apt-get install -y -q curl ca-certificates tar xz-utils jq gnupg openssl ffmpeg fonts-dejavu-core iptables-persistent debian-keyring debian-archive-keyring apt-transport-https

IP="$(curl -fsS --max-time 10 https://api.ipify.org || curl -fsS --max-time 10 https://ifconfig.me || true)"
[ -n "$IP" ] || [ -n "$HOME_MODE" ] || { echo "Could not find this server's public IP address."; exit 1; }
# an update keeps the addresses set up before (from the last install's env file)
ETC0=/etc/rfp-manager
if [ -z "$DOMAIN" ] && [ -f "$ETC0/env" ]; then DOMAIN="$(grep -E '^PUBLIC_URL=' "$ETC0/env" | cut -d= -f2- | sed -e 's|^https://||' -e 's|/$||')"; fi
if [ -z "$ADMIN" ] && [ -f "$ETC0/env" ]; then ADMIN="$(grep -E '^ADMIN_URL=' "$ETC0/env" | cut -d= -f2- | sed -e 's|^https://||' -e 's|/$||')"; fi
SSLIP="$(echo "$IP" | tr . -).sslip.io"
if [ -n "$HOME_MODE" ]; then
  [ -n "$DOMAIN" ] || { echo "At home the website needs your own name: add --domain regemarkfp.com (and --admin-domain admin.regemarkfp.com)."; exit 1; }
  SSLIP="$DOMAIN"                      # no sslip.io name through a tunnel
fi
[ -n "$DOMAIN" ] || DOMAIN="$SSLIP"
[ "$ADMIN" = "$DOMAIN" ] && ADMIN=""
# Caddy serves (and gets HTTPS certificates for) the website, the Studio address and always the sslip.io address
HOSTS="$DOMAIN"; [ -n "$ADMIN" ] && HOSTS="$HOSTS, $ADMIN"; [ "$DOMAIN" != "$SSLIP" ] && HOSTS="$HOSTS, $SSLIP"
WWW=""; case "$DOMAIN" in www.*|*.sslip.io) ;; *) [ "$(echo "$DOMAIN" | tr -cd . | wc -c)" = 1 ] && WWW="www.$DOMAIN" ;; esac
# www. serves the same website (no redirect: while DNS moves, an old host that sends regemarkfp.com → www would loop)
[ -n "$WWW" ] && HOSTS="$DOMAIN, $WWW${HOSTS#"$DOMAIN"}"
echo "Public IP $IP   ·   website https://$DOMAIN${ADMIN:+   ·   studio https://$ADMIN}"

if [ -n "$HOME_MODE" ]; then
  say "Home server: nothing is opened to the internet (Cloudflare Tunnel + Tailscale)"
  # a Pi 3 has 1 GB: give it swap so npm and ffmpeg do not run out of memory
  if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 1600000 ] && [ -f /etc/dphys-swapfile ]; then
    sed -i -E 's/^#?CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile && (dphys-swapfile setup && dphys-swapfile swapon) >/dev/null 2>&1 || true
  fi
else
say "Firewall (this server)"
# Oracle's Ubuntu images reject everything but SSH; open the web and streaming ports. Also open them in the cloud
# firewall (Oracle: the subnet's security list).
open_port() { iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p "$1" --dport "$2" -j ACCEPT; }
open_port tcp 80; open_port tcp 443; open_port udp 443
open_port tcp 1935                       # RTMP in
open_port udp 8890                       # SRT in
open_port udp 8189; open_port tcp 8189   # WebRTC to viewers
netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4
fi

if [ -n "$HOME_MODE" ]; then
  say "Cloudflare Tunnel (cloudflared) and Tailscale"
  if ! command -v cloudflared >/dev/null; then
    # Cloudflare's own package (also what its tunnel page installs); the .deb from its GitHub releases if that fails
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$([ "$NODE_ARCH" = x64 ] && echo amd64 || echo arm64).deb" -o /tmp/cloudflared.deb
    dpkg -i /tmp/cloudflared.deb || apt-get install -f -y -q
    rm -f /tmp/cloudflared.deb
  fi
  cloudflared --version
  if [ -n "$TUNNEL" ]; then
    systemctl stop cloudflared 2>/dev/null || true
    cloudflared service uninstall >/dev/null 2>&1 || true
    cloudflared service install "$TUNNEL"
  fi
  command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
fi

say "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  SUMS="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt)"
  FILE="$(echo "$SUMS" | grep -oE "node-v22[0-9.]+-linux-$NODE_ARCH\.tar\.xz" | head -1)"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$FILE" -o "/tmp/$FILE"
  (cd /tmp && echo "$SUMS" | grep " $FILE\$" | sha256sum -c -)
  rm -rf /opt/node && mkdir -p /opt/node && tar -xJf "/tmp/$FILE" -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node; ln -sf /opt/node/bin/npm /usr/local/bin/npm; ln -sf /opt/node/bin/npx /usr/local/bin/npx
fi
node --version

say "MediaMTX (streaming server)"
URL="$(curl -fsSL https://api.github.com/repos/bluenviron/mediamtx/releases/latest | jq -r '.assets[].browser_download_url' | grep -E "_${MTX_ARCH}\.tar\.gz$" | head -1)"
[ -n "$URL" ] || { echo "Could not find a MediaMTX download for this processor."; exit 1; }
rm -rf /tmp/mtx && mkdir -p /tmp/mtx && curl -fsSL "$URL" | tar -xz -C /tmp/mtx
install -m 755 /tmp/mtx/mediamtx /usr/local/bin/mediamtx
/usr/local/bin/mediamtx --version || true

say "Caddy (https)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y -q && apt-get install -y -q caddy
fi

if [ -n "$LOCALDB" ]; then
  say "MongoDB (this machine)"
  if ! command -v mongod >/dev/null; then
    . /etc/os-release
    grep -q -w avx /proc/cpuinfo || { echo "MongoDB needs a processor with AVX (Intel 2nd generation Core / Sandy Bridge or newer)."; exit 1; }
    curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --batch --yes --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
    CODENAME="$VERSION_CODENAME"; case "$CODENAME" in noble|jammy) ;; *) CODENAME=noble ;; esac
    echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $CODENAME/mongodb-org/8.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-8.0.list
    apt-get update -y -q && apt-get install -y -q mongodb-org
  fi
  # only this machine talks to it
  sed -i -E 's/^( *bindIp:).*/\1 127.0.0.1/' /etc/mongod.conf
  systemctl enable --now mongod >/dev/null 2>&1; systemctl restart mongod
  for i in $(seq 1 30); do mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && break; sleep 1; done
fi

if [ -n "$NAS" ]; then
  say "NAS (Samba share)"
  apt-get install -y -q samba
  getent group nas >/dev/null || groupadd nas
  mkdir -p "$NAS/assets/images" "$NAS/templates" "$NAS/shared" "$NAS/backups"
  OWNER="${SUDO_USER:-}"; [ -n "$OWNER" ] && [ "$OWNER" != root ] && usermod -aG nas "$OWNER"
  chgrp -R nas "$NAS"; chmod -R g+rwX "$NAS"; find "$NAS" -type d -exec chmod g+s {} +
  if ! grep -q '^\[NAS\]' /etc/samba/smb.conf; then
    cat >> /etc/samba/smb.conf <<EOF

# RFP Manager's NAS (install.sh): the house network and Tailscale only
[NAS]
   path = $NAS
   valid users = @nas
   read only = no
   create mask = 0664
   directory mask = 2775
   force group = nas
   hosts allow = 127. 10. 172.16.0.0/12 192.168. 100.64.0.0/10
EOF
  fi
  systemctl enable --now smbd >/dev/null 2>&1; systemctl restart smbd
fi

say "RFP Manager"
# the program runs as its own system account "rfp"; if "rfp" is already a person's login (UID 1000 or more),
# it uses "rfpsvc" instead, so the website never runs with an admin's rights
SVC=rfp
if id rfp >/dev/null 2>&1 && [ "$(id -u rfp)" -ge 1000 ]; then SVC=rfpsvc; fi
id "$SVC" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$SVC"
mkdir -p "$DATA" "$ETC" /etc/mediamtx /var/lib/mediamtx "$RECDIR"
chown -R "$SVC:$SVC" /var/lib/mediamtx "$RECDIR"
if [ -n "$HOME_MODE" ]; then touch "$ETC/home"; else rm -f "$ETC/home"; fi
if [ -n "$LOCALDB" ]; then touch "$ETC/localdb"; fi
if [ -n "$NAS" ]; then echo "$NAS" > "$ETC/nas"; usermod -aG nas "$SVC"; fi
if [ "$RECORD" = false ]; then touch "$ETC/no-recordings"; else rm -f "$ETC/no-recordings"; fi
echo "$RECDIR" > "$ETC/recordings"
curl -fsSL --retry 3 --max-time 300 "$FROM/api/server/bundle.tgz?$AUTH" -o /tmp/rfp.tgz
rm -rf /tmp/rfp-new && mkdir -p /tmp/rfp-new && tar -xzf /tmp/rfp.tgz -C /tmp/rfp-new
rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"
mv /tmp/rfp-new/rfp-manager "$APP"
(cd "$APP" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
# the Android app (not in the program bundle): from the website this command came from, else keep the one we had
mkdir -p "$APP/public/app"
for f in rfp-manager.apk rfp-manager.json; do
  curl -fsSL "$FROM/app/$f" -o "$APP/public/app/$f.new" 2>/dev/null && mv "$APP/public/app/$f.new" "$APP/public/app/$f" \
    || { rm -f "$APP/public/app/$f.new"; [ -f "$APP.old/public/app/$f" ] && cp "$APP.old/public/app/$f" "$APP/public/app/$f"; true; }
done
chown -R root:root "$APP"; chown -R "$SVC:$SVC" "$DATA"

# where encoders send SRT / RTMP: at home, this machine's Tailscale name (Cloudflare carries the website only)
STREAM_HOST="$DOMAIN"
if [ -n "$SHOST" ]; then STREAM_HOST="$SHOST"; mkdir -p "$ETC"; echo "$SHOST" > "$ETC/stream-host"
elif [ -n "$HOME_MODE" ]; then
  TS="$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//' || true)"
  [ -n "$TS" ] && STREAM_HOST="$TS"
fi

# the first time with --local-db: copy the database the website used (Atlas) to this machine
DBNAME="$(grep -E '^MONGODB_DB=' /tmp/rfp-site.env | cut -d= -f2-)"; DBNAME="${DBNAME:-rfpmanager}"
if [ -n "$LOCALDB" ] && [ ! -f "$ETC/db-copied" ]; then
  REMOTE="$(grep -E '^MONGODB_URI=' /tmp/rfp-site.env | cut -d= -f2-)"
  case "$REMOTE" in
    mongodb*://127.0.0.1*|mongodb*://localhost*|"") echo "No other database to copy from: starting with this machine's." ;;
    *) say "Copying the database ($DBNAME) to this machine"
       mongodump --uri="$REMOTE" --db="$DBNAME" --archive --gzip | mongorestore --uri="mongodb://127.0.0.1:27017" --archive --gzip --drop
       ;;
  esac
  touch "$ETC/db-copied"
fi
BACKUPS="/var/backups/rfp-manager"; [ -n "$NAS" ] && BACKUPS="$NAS/backups"

# the hook secret stays the same across updates
SECRET=""
[ -f "$ETC/env" ] && SECRET="$(grep -E '^STREAM_HOOK_SECRET=' "$ETC/env" | cut -d= -f2- || true)"
[ -n "$SECRET" ] || SECRET="$(openssl rand -hex 24)"
{
  cat /tmp/rfp-site.env
  echo "PORT=3000"
  echo "PUBLIC_URL=https://$DOMAIN"
  [ -n "$ADMIN" ] && echo "ADMIN_URL=https://$ADMIN"
  echo "DATA_DIR=$DATA"
  echo "CONFIG=$DATA/config.json"
  echo "STREAM_HOST=$STREAM_HOST"
  echo "STREAM_API=http://127.0.0.1:9997"
  echo "STREAM_PLAYBACK=http://127.0.0.1:9996"
  echo "STREAM_HOOK_SECRET=$SECRET"
  if [ -n "$LOCALDB" ]; then echo "MONGODB_URI=mongodb://127.0.0.1:27017"; echo "MONGODB_DB=$DBNAME"; fi   # later lines win
  if [ -n "$NAS" ]; then echo "MEDIA_DIR=$NAS/assets/images"; fi
} > "$ETC/env.new"
install -m 600 -o root -g root "$ETC/env.new" "$ETC/env"; rm -f "$ETC/env.new" /tmp/rfp-site.env

cat > /etc/systemd/system/rfp-manager.service <<EOF
[Unit]
Description=RFP Manager website
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC
EnvironmentFile=$ETC/env
WorkingDirectory=$APP
ExecStart=/usr/local/bin/node --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/mediamtx/mediamtx.yml <<EOF
# Written by RFP Manager's install.sh. Who may publish or watch is decided by RFP Manager (Streaming → Channels).
logLevel: info
api: true
apiAddress: 127.0.0.1:9997
authMethod: http
authHTTPAddress: http://127.0.0.1:3000/api/stream/auth?s=$SECRET
authHTTPExclude:
  - action: api
  - action: metrics
  - action: pprof
rtsp: false
rtmp: true
rtmpAddress: :1935
srt: true
srtAddress: :8890
hls: true
hlsAddress: 127.0.0.1:8888
hlsVariant: fmp4
hlsAlwaysRemux: true
hlsSegmentCount: 7
webrtc: $([ -n "$HOME_MODE" ] && echo false || echo true)
webrtcAddress: 127.0.0.1:8889
webrtcLocalUDPAddress: :8189
webrtcLocalTCPAddress: :8189
webrtcIPsFromInterfaces: true
webrtcAdditionalHosts: [$IP]
# recordings become the videos on the website (RFP Manager lists them; productions can switch recording off)
playback: true
playbackAddress: 127.0.0.1:9996
pathDefaults:
  record: $RECORD
  recordPath: $RECDIR/%path/%Y-%m-%d_%H-%M-%S-%f
  recordFormat: fmp4
  recordSegmentDuration: 1h
  recordDeleteAfter: ${KEEP_DAYS}d
paths:
  all_others:
EOF
chown "root:$SVC" /etc/mediamtx/mediamtx.yml; chmod 640 /etc/mediamtx/mediamtx.yml

cat > /etc/systemd/system/mediamtx.service <<EOF
[Unit]
Description=MediaMTX streaming server (for RFP Manager)
After=network-online.target rfp-manager.service
Wants=network-online.target

[Service]
User=$SVC
ExecStart=/usr/local/bin/mediamtx /etc/mediamtx/mediamtx.yml
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

SITE="$HOSTS"
# at home Cloudflare does https; Caddy answers plain http on 8080 for the tunnel (and the house network)
[ -n "$HOME_MODE" ] && SITE="http://:8080"
{
  if [ -n "$HOME_MODE" ]; then printf '{\n  servers {\n    trusted_proxies static private_ranges\n  }\n}\n\n'
  elif [ -n "$EMAIL" ]; then printf '{\n  email %s\n}\n\n' "$EMAIL"; fi
  cat <<EOF
$SITE {
  handle_path /webrtc/* {
    reverse_proxy 127.0.0.1:8889
  }
  handle_path /hls/* {
    # MediaMTX sends players to /<path>/index.m3u8?cookieCheck=1 first: keep them under /hls/
    reverse_proxy 127.0.0.1:8888 {
      header_down Location "^/(.*)$" "/hls/\$1"
    }
  }
  handle_path /vod/* {
    reverse_proxy 127.0.0.1:9996
  }
  handle {
    reverse_proxy 127.0.0.1:3000
  }
}
EOF
} > /etc/caddy/Caddyfile

if [ -n "$LOCALDB" ]; then
  mkdir -p "$BACKUPS"
  cat > /usr/local/bin/rfp-backup <<EOF
#!/bin/sh
# RFP Manager: nightly database backup (install.sh). Keeps 14 days.
set -e
mkdir -p "$BACKUPS"
mongodump --uri=mongodb://127.0.0.1:27017 --db=$DBNAME --archive="$BACKUPS/rfp-\$(date +%Y-%m-%d).archive.gz" --gzip --quiet
find "$BACKUPS" -name 'rfp-*.archive.gz' -mtime +14 -delete
EOF
  chmod 755 /usr/local/bin/rfp-backup
  cat > /etc/systemd/system/rfp-backup.service <<EOF
[Unit]
Description=RFP Manager database backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/rfp-backup
EOF
  cat > /etc/systemd/system/rfp-backup.timer <<EOF
[Unit]
Description=RFP Manager database backup every night
[Timer]
OnCalendar=*-*-* 03:15
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload; systemctl enable --now rfp-backup.timer >/dev/null 2>&1
fi

# ---- automatic updates: every night, if the website has a newer version, install it with this server's own key
[ -z "$AUTOUP_SET" ] && [ -f "$ETC/no-auto-update" ] && AUTOUP=""      # stays off until --auto-update
if [ -z "$AUTOUP" ]; then
  touch "$ETC/no-auto-update"; systemctl disable --now rfp-autoupdate.timer >/dev/null 2>&1 || true
else
  rm -f "$ETC/no-auto-update"
  if [ -n "$TOKEN" ] && { [ ! -s "$ETC/update-key" ] || [ "$(cat "$ETC/update-from" 2>/dev/null)" != "$FROM" ]; }; then
    curl -fsS --max-time 120 "$FROM/api/server/update-key?t=$TOKEN" -o "$ETC/update-key.new" && mv "$ETC/update-key.new" "$ETC/update-key" || rm -f "$ETC/update-key.new"
  fi
  [ -n "$UKEY" ] && echo "$UKEY" > "$ETC/update-key"
  chmod 600 "$ETC/update-key" 2>/dev/null || true
  echo "$FROM" > "$ETC/update-from"
  cat > /usr/local/bin/rfp-autoupdate <<'EOF'
#!/bin/sh
# RFP Manager: install a newer version from the website this server came from (install.sh writes this).
set -e
ETC=/etc/rfp-manager
FROM="$(cat $ETC/update-from)"; KEY="$(cat $ETC/update-key)"
[ -n "$FROM" ] && [ -n "$KEY" ] || { echo "No update key: run a setup command once."; exit 1; }
REMOTE="$(curl -fsS --retry 3 --max-time 120 "$FROM/api/config" | jq -r .version)"
LOCAL="$(jq -r .version /opt/rfp-manager/package.json)"
[ -n "$REMOTE" ] && [ "$REMOTE" != null ] || { echo "Could not read the website's version"; exit 1; }
if [ "$REMOTE" = "$LOCAL" ] || [ "$(printf '%s\n%s\n' "$REMOTE" "$LOCAL" | sort -V | tail -1)" = "$LOCAL" ]; then echo "Up to date ($LOCAL)"; exit 0; fi
echo "Updating $LOCAL -> $REMOTE"
curl -fsSL --retry 3 --max-time 120 "$FROM/server/install.sh" | bash -s -- --from "$FROM" --update-key "$KEY"
EOF
  chmod 755 /usr/local/bin/rfp-autoupdate
  cat > /etc/systemd/system/rfp-autoupdate.service <<'EOF'
[Unit]
Description=RFP Manager: install a newer version from the website
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
  systemctl daemon-reload; systemctl enable rfp-autoupdate.timer >/dev/null 2>&1 || true
  # an update started by the timer must not restart the timer's own job: start it only on a manual run
  [ -n "$TOKEN" ] && systemctl start rfp-autoupdate.timer >/dev/null 2>&1 || true
fi

say "Starting"
systemctl daemon-reload
systemctl enable rfp-manager mediamtx caddy >/dev/null 2>&1
systemctl restart rfp-manager
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/healthz >/dev/null || { echo "RFP Manager did not start. See: journalctl -u rfp-manager -n 50"; journalctl -u rfp-manager -n 30 --no-pager; exit 1; }
systemctl restart mediamtx
systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 2
systemctl is-active --quiet mediamtx || { echo "MediaMTX did not start:"; journalctl -u mediamtx -n 30 --no-pager; exit 1; }

if [ -n "$HOME_MODE" ]; then
  TUN="not installed yet (run again with --tunnel <token>)"; systemctl is-active --quiet cloudflared 2>/dev/null && TUN="running"
  NASLINE=""; [ -n "$NAS" ] && NASLINE="NAS: \\\\$(hostname)\\NAS  (images in assets\\images). Set your password once: sudo smbpasswd -a ${SUDO_USER:-<user>}"
  TSNOTE=""; [ -z "$SHOST" ] && [ "$STREAM_HOST" = "$DOMAIN" ] && TSNOTE="Tailscale is not signed in yet: run  sudo tailscale up  and then this command again."
  cat <<EOF

────────────────────────────────────────────────────────────────
  RFP Manager is running on this machine (home server).

  Website     https://$DOMAIN${ADMIN:+
  Studio      https://$ADMIN/app}
  House network   http://$(hostname -I 2>/dev/null | awk '{print $1}'):8080
  Cloudflare Tunnel: $TUN
     Public hostnames (Cloudflare → Zero Trust → Networks → Tunnels → your tunnel):
       $DOMAIN${ADMIN:+ and $ADMIN}  →  HTTP  localhost:8080
  Streams in $([ -n "$SHOST" ] && echo "(router: UDP 8890 + TCP 1935 forwarded to this machine)" || echo "(over Tailscale)")
     RTMP     rtmp://$STREAM_HOST/live
     SRT      srt://$STREAM_HOST:8890
     $TSNOTE
  Viewers watch through Cloudflare (HLS). For big audiences, restream to YouTube / Facebook.
  Recordings: $([ "$RECORD" = true ] && echo "$RECDIR" || echo "off")
  Updates: $([ -n "$AUTOUP" ] && echo "automatic, every night at 04:30 (now: sudo rfp-autoupdate)" || echo "manual (run a setup command)")
  Database: $([ -n "$LOCALDB" ] && echo "MongoDB on this machine, backed up every night to $BACKUPS" || echo "the website's (Atlas)")
  $NASLINE

  Still to do:
   · Google sign-in: https://$DOMAIN${ADMIN:+ and https://$ADMIN} must be in the OAuth client's origins.
   · Production PCs: link them to https://${ADMIN:-$DOMAIN} (Settings → This machine).

  Logs: journalctl -u rfp-manager -f     journalctl -u cloudflared -f
────────────────────────────────────────────────────────────────
EOF
  exit 0
fi

cat <<EOF

────────────────────────────────────────────────────────────────
  RFP Manager is running on this server.

  Website     https://$DOMAIN${ADMIN:+
  Studio      https://$ADMIN/app}
  RTMP in     rtmp://$DOMAIN/live            (stream key: see the channel)
  SRT in      srt://$DOMAIN:8890             (stream id: see the channel)
  Watch       https://$DOMAIN/watch/<stream>      Website  https://$DOMAIN/

  Still to do:
   · Google sign-in: add https://$DOMAIN${ADMIN:+ and https://$ADMIN} to "Authorised JavaScript origins"
     of the OAuth client (Google Cloud console → APIs & Services → Credentials).
   · Cloud firewall: open TCP 80, 443, 1935, 8189 and UDP 443, 8189, 8890.
   · Production PCs: link them to https://${ADMIN:-$DOMAIN} (Settings → This machine).

  Logs: journalctl -u rfp-manager -f     journalctl -u mediamtx -f
────────────────────────────────────────────────────────────────
EOF
