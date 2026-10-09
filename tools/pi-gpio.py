#!/usr/bin/env python3
"""RFP Manager - Raspberry Pi as a GPO / GPI box.

Outputs (GPO) switch relays or optocouplers on a relay board / HAT; inputs (GPI) read contact closures (a GO button,
a tally, a switcher's GPO). RFP Manager talks to this over the network: add a "Raspberry Pi GPIO" device in
Graphics control -> Settings -> Devices with the Pi's address and port 8095.

NEVER wire the Pi's pins straight to broadcast equipment: use an isolated relay board (dry contacts) or optocouplers.

  Try it:                 python3 pi-gpio.py
  Without hardware:       python3 pi-gpio.py --mock
  Start it with the Pi:   sudo python3 pi-gpio.py --install      (remove: sudo python3 pi-gpio.py --remove)

Settings (environment, or edit the defaults below):
  OUTPUTS=26,20,21          BCM pin numbers of GPO 1, 2, 3 ... (these three = a common 3-relay HAT)
  INPUTS=5,6,13,19          BCM pin numbers of GPI 1, 2, 3 ... (closed to ground = on; the Pi's pull-ups are used)
  ACTIVE_LOW=1              set for relay boards that switch on when the pin is low (many cheap relay boards)
  PORT=8095

HTTP:  GET /state  ·  GET /events (live updates)  ·  GET /cmd?do=pulse|on|off|toggle&gpo=1&ms=200
Needs: python3 and gpiozero (both come with Raspberry Pi OS).
"""
import json, os, sys, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('PORT', '8095'))
OUTPUTS = [int(x) for x in os.environ.get('OUTPUTS', '26,20,21').split(',') if x.strip()]
INPUTS = [int(x) for x in os.environ.get('INPUTS', '5,6,13,19').split(',') if x.strip()]
ACTIVE_LOW = os.environ.get('ACTIVE_LOW', '0') == '1'
MOCK = '--mock' in sys.argv
NAME = os.uname().nodename

changed = threading.Condition()
version = 0


def bump():
    global version
    with changed:
        version += 1
        changed.notify_all()


class MockPin:
    def __init__(self):
        self.value = 0
        self.when_activated = None
        self.when_deactivated = None
    def on(self): self.value = 1
    def off(self): self.value = 0
    @property
    def is_active(self): return bool(self.value)


if MOCK:
    outs = [MockPin() for _ in OUTPUTS]
    ins = [MockPin() for _ in INPUTS]
else:
    try:
        from gpiozero import OutputDevice, DigitalInputDevice
    except ImportError:
        sys.exit('gpiozero is missing:  sudo apt install python3-gpiozero   (or run with --mock to try without hardware)')
    # initial_value=False: every output starts off, also after the Pi restarts
    outs = [OutputDevice(p, active_high=not ACTIVE_LOW, initial_value=False) for p in OUTPUTS]
    ins = [DigitalInputDevice(p, pull_up=True, bounce_time=0.02) for p in INPUTS]
    for i in ins:
        i.when_activated = lambda d=None: bump()
        i.when_deactivated = lambda d=None: bump()

timers = {}


def state():
    return {'name': NAME, 'mock': MOCK, 'outputs': {str(n + 1): 1 if o.value else 0 for n, o in enumerate(outs)},
            'inputs': {str(n + 1): 1 if i.is_active else 0 for n, i in enumerate(ins)}}


def command(do, n, ms):
    if n < 1 or n > len(outs):
        raise ValueError('There is no GPO %d (this Pi has %d)' % (n, len(outs)))
    o = outs[n - 1]
    t = timers.pop(n, None)
    if t: t.cancel()
    if do == 'on': o.on()
    elif do == 'off': o.off()
    elif do == 'toggle': o.off() if o.value else o.on()
    elif do == 'pulse':
        o.on()
        def end():
            o.off(); timers.pop(n, None); bump()
        t = threading.Timer(max(10, min(10000, ms)) / 1000.0, end); t.daemon = True; t.start(); timers[n] = t
    else:
        raise ValueError('Unknown command %s (pulse, on, off, toggle)' % do)
    bump()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b)))
        self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == '/state': return self.send_json(200, state())
        if u.path == '/cmd':
            try:
                command(q.get('do', 'pulse'), int(q.get('gpo', '1')), int(q.get('ms', '200')))
                return self.send_json(200, {'ok': True, 'state': state()})
            except ValueError as e:
                return self.send_json(400, {'error': str(e)})
        if u.path == '/mock' and MOCK:                       # flip an input when trying without hardware
            n = int(q.get('gpi', '1'))
            if 1 <= n <= len(ins): ins[n - 1].value = int(q.get('v', '1')); bump()
            return self.send_json(200, state())
        if u.path == '/events':
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache'); self.end_headers()
            seen = -1
            try:
                while True:
                    with changed:
                        if seen == version: changed.wait(5)
                        now = version
                    if now != seen:
                        seen = now
                        self.wfile.write(('data: %s\n\n' % json.dumps(state())).encode())
                    else:
                        self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
        self.send_json(404, {'error': 'Not found'})


def install():
    unit = '/etc/systemd/system/rfp-gpio.service'
    env = 'Environment=OUTPUTS=%s INPUTS=%s ACTIVE_LOW=%s PORT=%d' % (','.join(map(str, OUTPUTS)), ','.join(map(str, INPUTS)), '1' if ACTIVE_LOW else '0', PORT)
    with open(unit, 'w') as f:
        f.write('[Unit]\nDescription=RFP Manager GPIO\nAfter=network-online.target\n\n[Service]\n%s\nExecStart=/usr/bin/python3 %s\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n' % (env, os.path.abspath(__file__)))
    os.system('systemctl daemon-reload && systemctl enable --now rfp-gpio')
    print('Installed: starts with the Pi. Status: systemctl status rfp-gpio')


if __name__ == '__main__':
    if '--install' in sys.argv: install(); sys.exit(0)
    if '--remove' in sys.argv: os.system('systemctl disable --now rfp-gpio; rm -f /etc/systemd/system/rfp-gpio.service; systemctl daemon-reload'); print('Removed.'); sys.exit(0)
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    srv.daemon_threads = True
    print('RFP Manager GPIO on port %d: %d outputs (BCM %s), %d inputs (BCM %s)%s' % (PORT, len(outs), OUTPUTS, len(ins), INPUTS, ' - MOCK, no hardware' if MOCK else ''))
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        for o in outs: o.off()
