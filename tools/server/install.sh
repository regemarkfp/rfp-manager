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
set -euo pipefail

FROM=""; TOKEN=""; DOMAIN=""; ADMIN=""; EMAIL=""; KEEP_DAYS=90
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2%/}"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --domain) DOMAIN="${2#https://}"; DOMAIN="${DOMAIN%/}"; shift 2 ;;
    --admin-domain) ADMIN="${2#https://}"; ADMIN="${ADMIN%/}"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --keep-days) KEEP_DAYS="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
[ -n "$FROM" ] && [ -n "$TOKEN" ] || { echo "Usage: install.sh --from https://<your-site> --token <token>   (the website's Settings → Server makes the command)"; exit 1; }

exec > >(tee -a /var/log/rfp-install.log) 2>&1
say() { printf '\n== %s\n' "$*"; }
APP=/opt/rfp-manager; DATA=/var/lib/rfp-manager; ETC=/etc/rfp-manager

case "$(uname -m)" in
  aarch64|arm64) NODE_ARCH=arm64; MTX_ARCH='linux_arm64(v8)?' ;;
  x86_64|amd64) NODE_ARCH=x64; MTX_ARCH='linux_amd64' ;;
  *) echo "This processor ($(uname -m)) is not supported."; exit 1 ;;
esac

say "Checking the setup link"
curl -fsS "$FROM/api/server/env?t=$TOKEN" -o /tmp/rfp-site.env || { echo "The website did not accept this link. Make a new one: Settings → Server."; exit 1; }

say "System packages"
export DEBIAN_FRONTEND=noninteractive
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
apt-get update -y -q
apt-get install -y -q curl ca-certificates tar xz-utils jq gnupg openssl iptables-persistent debian-keyring debian-archive-keyring apt-transport-https

IP="$(curl -fsS --max-time 10 https://api.ipify.org || curl -fsS --max-time 10 https://ifconfig.me || true)"
[ -n "$IP" ] || { echo "Could not find this server's public IP address."; exit 1; }
# an update keeps the addresses set up before (from the last install's env file)
ETC0=/etc/rfp-manager
if [ -z "$DOMAIN" ] && [ -f "$ETC0/env" ]; then DOMAIN="$(grep -E '^PUBLIC_URL=' "$ETC0/env" | cut -d= -f2- | sed -e 's|^https://||' -e 's|/$||')"; fi
if [ -z "$ADMIN" ] && [ -f "$ETC0/env" ]; then ADMIN="$(grep -E '^ADMIN_URL=' "$ETC0/env" | cut -d= -f2- | sed -e 's|^https://||' -e 's|/$||')"; fi
SSLIP="$(echo "$IP" | tr . -).sslip.io"
[ -n "$DOMAIN" ] || DOMAIN="$SSLIP"
[ "$ADMIN" = "$DOMAIN" ] && ADMIN=""
# Caddy serves (and gets HTTPS certificates for) the website, the Studio address and always the sslip.io address
HOSTS="$DOMAIN"; [ -n "$ADMIN" ] && HOSTS="$HOSTS, $ADMIN"; [ "$DOMAIN" != "$SSLIP" ] && HOSTS="$HOSTS, $SSLIP"
WWW=""; case "$DOMAIN" in www.*|*.sslip.io) ;; *) [ "$(echo "$DOMAIN" | tr -cd . | wc -c)" = 1 ] && WWW="www.$DOMAIN" ;; esac
# www. serves the same website (no redirect: while DNS moves, an old host that sends regemarkfp.com → www would loop)
[ -n "$WWW" ] && HOSTS="$DOMAIN, $WWW${HOSTS#"$DOMAIN"}"
echo "Public IP $IP   ·   website https://$DOMAIN${ADMIN:+   ·   studio https://$ADMIN}"

say "Firewall (this server)"
# Oracle's Ubuntu images reject everything but SSH; open the web and streaming ports. Also open them in the cloud
# firewall (Oracle: the subnet's security list).
open_port() { iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p "$1" --dport "$2" -j ACCEPT; }
open_port tcp 80; open_port tcp 443; open_port udp 443
open_port tcp 1935                       # RTMP in
open_port udp 8890                       # SRT in
open_port udp 8189; open_port tcp 8189   # WebRTC to viewers
netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4

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

say "RFP Manager"
id rfp >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin rfp
mkdir -p "$DATA" "$ETC" /etc/mediamtx /var/lib/mediamtx/recordings
chown -R rfp:rfp /var/lib/mediamtx
curl -fsSL "$FROM/api/server/bundle.tgz?t=$TOKEN" -o /tmp/rfp.tgz
rm -rf /tmp/rfp-new && mkdir -p /tmp/rfp-new && tar -xzf /tmp/rfp.tgz -C /tmp/rfp-new
rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"
mv /tmp/rfp-new/rfp-manager "$APP"
(cd "$APP" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
chown -R root:root "$APP"; chown -R rfp:rfp "$DATA"

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
  echo "STREAM_HOST=$DOMAIN"
  echo "STREAM_API=http://127.0.0.1:9997"
  echo "STREAM_PLAYBACK=http://127.0.0.1:9996"
  echo "STREAM_HOOK_SECRET=$SECRET"
} > "$ETC/env.new"
install -m 600 -o root -g root "$ETC/env.new" "$ETC/env"; rm -f "$ETC/env.new" /tmp/rfp-site.env

cat > /etc/systemd/system/rfp-manager.service <<EOF
[Unit]
Description=RFP Manager website
After=network-online.target
Wants=network-online.target

[Service]
User=rfp
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
webrtc: true
webrtcAddress: 127.0.0.1:8889
webrtcLocalUDPAddress: :8189
webrtcLocalTCPAddress: :8189
webrtcIPsFromInterfaces: true
webrtcAdditionalHosts: [$IP]
# recordings become the videos on the website (RFP Manager lists them; productions can switch recording off)
playback: true
playbackAddress: 127.0.0.1:9996
pathDefaults:
  record: true
  recordPath: /var/lib/mediamtx/recordings/%path/%Y-%m-%d_%H-%M-%S-%f
  recordFormat: fmp4
  recordSegmentDuration: 1h
  recordDeleteAfter: ${KEEP_DAYS}d
paths:
  all_others:
EOF
chown root:rfp /etc/mediamtx/mediamtx.yml; chmod 640 /etc/mediamtx/mediamtx.yml

cat > /etc/systemd/system/mediamtx.service <<EOF
[Unit]
Description=MediaMTX streaming server (for RFP Manager)
After=network-online.target rfp-manager.service
Wants=network-online.target

[Service]
User=rfp
ExecStart=/usr/local/bin/mediamtx /etc/mediamtx/mediamtx.yml
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

{
  if [ -n "$EMAIL" ]; then printf '{\n  email %s\n}\n\n' "$EMAIL"; fi
  cat <<EOF
$HOSTS {
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
