#!/bin/bash
# RFP Manager – program output with a key signal on a Raspberry Pi (Pi 4 / Pi 5, two HDMI outputs).
#
#   HDMI 0  = FILL  (the graphics over black)
#   HDMI 1  = KEY   (white where the graphics are, black elsewhere, grey for see-through parts)
#
# Run once to try it:        ./pi-output.sh http://pc-name:8090
# Start it with the Pi:      ./pi-output.sh install http://pc-name:8090
# Stop starting with the Pi: ./pi-output.sh remove
#
# Second word, optional:  fillkey (default, both outputs) | two (two separate windows) | key | fill
#   ./pi-output.sh http://pc-name:8090 key        one screen, key only
# Settings (put them in front of the command):  RATE=50  SWAP=1 (key on HDMI 0)  CH=pgm|pvw
#
# The Pi must show its desktop with X11, not Wayland:  sudo raspi-config → Advanced Options → Wayland → X11, then reboot.
# Needs: chromium (comes with Raspberry Pi OS with desktop), curl.

set -u
SELF="$(readlink -f "$0")"
AUTOSTART="$HOME/.config/autostart/rfp-output.desktop"

if [ "${1:-}" = "remove" ]; then rm -f "$AUTOSTART"; echo "Removed. The output no longer starts with the Pi."; exit 0; fi
INSTALL=0
if [ "${1:-}" = "install" ]; then INSTALL=1; shift; fi

SERVER="${1:-}"
MODE="${2:-fillkey}"
RATE="${RATE:-50}"
CH="${CH:-pgm}"
SWAP="${SWAP:-0}"
if [ -z "$SERVER" ]; then echo "Give the address of the RFP Manager PC, for example:  $0 http://pc-name:8090"; exit 1; fi
SERVER="${SERVER%/}"
case "$SERVER" in http://*|https://*) ;; *) SERVER="http://$SERVER" ;; esac

if [ "$INSTALL" = "1" ]; then
  mkdir -p "$(dirname "$AUTOSTART")"
  cat > "$AUTOSTART" <<EOF
[Desktop Entry]
Type=Application
Name=RFP Manager output
Exec=env RATE=$RATE SWAP=$SWAP CH=$CH "$SELF" "$SERVER" "$MODE"
X-GNOME-Autostart-enabled=true
EOF
  echo "Installed. The output starts by itself when the Pi shows its desktop."
  echo "Make the Pi log in to the desktop automatically: sudo raspi-config → System Options → Boot / Auto Login → Desktop Autologin."
  exit 0
fi

BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$BROWSER" ]; then echo "Chromium is not installed:  sudo apt install chromium-browser"; exit 1; fi

# Wait for the production PC (the Pi usually starts first).
echo "Waiting for $SERVER ..."
until curl -fsS -o /dev/null --max-time 3 "$SERVER/live/api/info"; do sleep 2; done

WAYLAND=0
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then WAYLAND=1; fi

OUTS=()
if [ "$WAYLAND" = "0" ] && command -v xrandr >/dev/null; then
  export DISPLAY="${DISPLAY:-:0}"
  xset s off -dpms s noblank 2>/dev/null                       # never blank the outputs
  mapfile -t OUTS < <(xrandr --query | awk '/ connected/{print $1}')
  xrandr --delmonitor RFP 2>/dev/null
  X=0
  for o in "${OUTS[@]}"; do
    xrandr --output "$o" --mode 1920x1080 --rate "$RATE" --pos "${X}x0" 2>/dev/null || xrandr --output "$o" --mode 1920x1080 --pos "${X}x0"
    X=$((X + 1920))
  done
fi

FLAGS=(--kiosk --no-first-run --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-translate
  --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 --overscroll-history-navigation=0
  --disable-features=TranslateUI --password-store=basic --hide-scrollbars)
Q="ch=$CH"
[ "$SWAP" = "1" ] && Q="$Q&swap=1"
PROFILE="$HOME/.cache/rfp-output"
pkill -f "user-data-dir=$PROFILE" 2>/dev/null
sleep 1
# Chromium must not offer to "restore pages" after the power was pulled.
for p in "$PROFILE-a" "$PROFILE-b"; do
  [ -f "$p/Default/Preferences" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' "$p/Default/Preferences"
done

one() { "$BROWSER" "${FLAGS[@]}" --user-data-dir="$PROFILE-a" --window-position=0,0 "$1" >/dev/null 2>&1 & }

case "$MODE" in
  key)  one "$SERVER/key?$Q" ;;
  fill) one "$SERVER/fill?$Q" ;;
  two)
    # Two windows, one per output. Simple, but the two can be a frame apart while a graphic animates.
    A="fill"; B="key"; [ "$SWAP" = "1" ] && { A="key"; B="fill"; }
    "$BROWSER" "${FLAGS[@]}" --user-data-dir="$PROFILE-a" --window-position=0,0 "$SERVER/$A?ch=$CH" >/dev/null 2>&1 &
    "$BROWSER" "${FLAGS[@]}" --user-data-dir="$PROFILE-b" --window-position=1920,0 "$SERVER/$B?ch=$CH" >/dev/null 2>&1 &
    ;;
  *)
    if [ "$WAYLAND" = "1" ]; then
      echo "This Pi runs Wayland, where one window cannot be stretched over both outputs."
      echo "Switch to X11:  sudo raspi-config → Advanced Options → Wayland → X11, reboot, and run this again."
      exit 1
    fi
    if [ "${#OUTS[@]}" -lt 2 ]; then echo "Only one screen is connected. Connect both HDMI outputs, or use:  $0 $SERVER key"; exit 1; fi
    # One window over both outputs, so fill and key are drawn in the same frame: tell the desktop the two are one screen.
    xrandr --setmonitor RFP 3840/1066x1080/300+0+0 "${OUTS[0]},${OUTS[1]}"
    sleep 1
    "$BROWSER" "${FLAGS[@]}" --user-data-dir="$PROFILE-a" --window-position=0,0 --window-size=3840,1080 "$SERVER/fill-key?$Q" >/dev/null 2>&1 &
    ;;
esac
echo "Output running ($MODE) from $SERVER. Close it with:  pkill -f rfp-output"
wait
