/* Shared client library for all Regemark RL Broadcast pages */
(function () {
  const RL = window.RL = {
    control: null, update: null, sos: 'disconnected', postgame: null,
    handlers: { update: [], ev: [], control: [], status: [], postgame: [], open: [], error: [] }, canControl: false, parts: [],
  };
  RL.on = (type, fn) => { RL.handlers[type].push(fn); return RL; };
  const emit = (type, ...a) => RL.handlers[type].forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } });

  let ws;
  const GOOGLE = { 'Montserrat': 'Montserrat:ital,wght@0,600;0,800;0,900;1,800;1,900', 'Oswald': 'Oswald:wght@500;600;700', 'Rajdhani': 'Rajdhani:wght@600;700', 'Teko': 'Teko:wght@500;600;700', 'Barlow Condensed': 'Barlow+Condensed:ital,wght@0,600;0,800;1,800', 'Saira Condensed': 'Saira+Condensed:wght@600;800;900', 'Exo 2': 'Exo+2:ital,wght@0,700;0,900;1,800;1,900', 'Russo One': 'Russo+One' };
  RL.FONTS = ['Segoe UI', 'Bahnschrift', 'Arial Black', 'Impact', ...Object.keys(GOOGLE)];
  RL.COLOR_KEYS = [
    ['bug','Scorebug','Team name & logo panels'],['bugtext','Scorebug','Team name text'],['clockbg','Scorebug','Clock background'],['clock','Scorebug','Clock text'],['clockline','Scorebug','Clock underline'],['score','Scorebug','Score numbers'],
    ['info','Scorebug','Game / best-of strip'],['infotext','Scorebug','Game strip text'],['title','Scorebug','Event title strip'],['titletext','Scorebug','Event title text'],
    ['board','Boost bars','Bar background'],['boardtext','Boost bars','Name & boost text'],['fill','Boost bars','Boost fill (blank = team colour)'],['fill2','Boost bars','Boost fill end'],
    ['target','Boost bars','Spectated player highlight'],['targettext','Boost bars','Spectated player text'],['targetline','Boost bars','Spectated outline'],
    ['icon','Boost bars','Event icon plate'],['icontext','Boost bars','Event icon symbol'],
    ['card','Player card','Card background'],['cardtext','Player card','Name & stats text'],['speed','Player card','Speed bar'],['dial','Player card','Boost meter background'],['dialtext','Player card','Boost meter number'],
    ['stinger','Goal stinger','Main band (blank = team colour)'],['stinger2','Goal stinger','Second band'],['stingertext','Goal stinger','GOAL / scorer text'],['stingerline','Goal stinger','Glow lines'],
    ['wipe','Transitions','Wipe centre panel'],['wipeline','Transitions','Wipe lines'],['replay','Transitions','Replay tag background'],
  ];
  RL.logoUrl = () => RL.control?.theme?.logo || 'rfp-logo.png';
  RL.applyTheme = function (t) {
    t = t || RL.control?.theme || {}; const r = document.documentElement, st = r.style;
    if (window.RL_THEME_LIMITED) {   // control panel: keep its own dark UI, follow accent + logo only
      if (t.accent && t.accent.toLowerCase() !== '#111111') st.setProperty('--accent', t.accent);
      document.querySelectorAll('img.brand-logo').forEach(img => { const u = RL.logoUrl(); if (img.getAttribute('src') !== u) img.src = u; });
      return;
    }
    const hexA = (h, a) => RL.hexA(h, a);
    if (t.accent) st.setProperty('--accent', t.accent);
    if (t.live) { st.setProperty('--live', t.live); st.setProperty('--bad', t.live); }
    if (t.text) st.setProperty('--text', t.text);
    if (t.muted) st.setProperty('--muted', t.muted);
    if (t.panel) {
      const o = (t.panelOpacity ?? 92) / 100;
      st.setProperty('--slab', t.panel);
      st.setProperty('--slab2', `color-mix(in srgb, ${t.panel} 90%, #ffffff)`);
      st.setProperty('--slab3', `color-mix(in srgb, ${t.panel} 80%, #ffffff)`);
      st.setProperty('--ink', `color-mix(in srgb, ${t.panel} 70%, #000000)`);
      st.setProperty('--panelA', hexA(t.panel, o));
    }
    const ang = Math.max(0, Math.min(30, +(t.angle ?? 16)));
    st.setProperty('--skew', `-${ang}deg`);
    st.setProperty('--sl', Math.round(Math.tan(ang * Math.PI / 180) * 66) + 'px');
    if (t.font) {
      if (GOOGLE[t.font] && !document.getElementById('gf-' + t.font)) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.id = 'gf-' + t.font;
        l.href = 'https://fonts.googleapis.com/css2?family=' + GOOGLE[t.font] + '&display=swap'; document.head.appendChild(l);
      }
      st.setProperty('--font', `"${t.font}","Segoe UI",system-ui,Arial,sans-serif`);
    }
    r.classList.toggle('nofilm', t.film === false);
    r.classList.toggle('noglow', t.glow === false);
    r.classList.toggle('noitalic', t.italic === false);
    st.setProperty('--logoScale', (t.logoSize ?? 100) / 100);
    st.setProperty('--stingerScale', 100 / Math.max(40, t.stingerSpeed ?? 100));
    const cols = t.colors || {};
    RL.COLOR_KEYS.forEach(([k]) => { if (cols[k]) st.setProperty('--c-' + k, cols[k]); else st.removeProperty('--c-' + k); });
    document.querySelectorAll('img.brand-logo').forEach(img => { const u = RL.logoUrl(); if (img.getAttribute('src') !== u) img.src = u; });
    const vis = { scorebug: t.logoScorebug, transition: t.logoTransition, postgame: t.logoPostgame, stats: t.logoStats };
    document.querySelectorAll('[data-logo]').forEach(el => el.style.display = vis[el.dataset.logo] === false ? 'none' : '');
  };
  RL.on('control', c => RL.applyTheme(c.theme));

  // where the data comes from: RFP Manager's /rl/ws. A page from RFP Manager finds it by itself, OBS can add ?ws=…,
  // and in CasparCG (a file:// template) the address comes in the template data: update({ ws, part })
  RL.wsUrl = (() => { const q = new URLSearchParams(location.search).get('ws'); if (q) return q; if (location.protocol === 'file:' || !location.host) return ''; return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/rl/ws'; })();
  let retryT = null;
  RL.connect = function (url) {
    if (url) { if (url === RL.wsUrl && ws && ws.readyState < 2) return; RL.wsUrl = url; if (ws) { ws.onclose = null; try { ws.close(); } catch (e) { /* gone */ } } }
    if (!RL.wsUrl) return;
    clearTimeout(retryT);
    ws = new WebSocket(RL.wsUrl);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'hello') { RL.control = m.control; RL.sos = m.sos; RL.canControl = !!m.canControl; RL.parts = m.parts || []; emit('control', m.control); emit('status', m.sos); emit('open'); }
      else if (m.t === 'error') emit('error', m.error);
      else if (m.t === 'control') { RL.control = m.control; emit('control', m.control); }
      else if (m.t === 'status') { RL.sos = m.sos; emit('status', m.sos); }
      else if (m.t === 'update') { RL.update = m.d; emit('update', m.d); }
      else if (m.t === 'ev') emit('ev', m.e, m.d);
      else if (m.t === 'postgame') { RL.postgame = m.d; emit('postgame', m.d); }
    };
    ws.onclose = () => { RL.sos = 'offline'; emit('status', 'offline'); retryT = setTimeout(() => RL.connect(), 2000); };
  };
  RL.send = (obj) => ws && ws.readyState === 1 && ws.send(JSON.stringify(obj));
  RL.patch = (patch) => RL.send({ t: 'control', patch });
  RL.action = (name, extra) => RL.send({ t: 'action', name, ...(extra || {}) });

  /* ---- helpers ---- */
  RL.teamColor = (i) => RL.control?.teams?.[i]?.color || (i ? '#ff7a1a' : '#1f7cff');
  RL.teamName = (i) => {
    const c = RL.control;
    if (c?.useGameNames) { const n = RL.update?.game?.teams?.[i]?.name; if (n) return n; }
    return c?.teams?.[i]?.name || (i ? 'Orange' : 'Blue');
  };
  RL.teamTag = (i) => RL.control?.teams?.[i]?.tag || RL.teamName(i).slice(0, 3).toUpperCase();
  RL.teamLogo = (i) => RL.control?.teams?.[i]?.logo || '';
  RL.fmtClock = (g) => {
    const s = Math.max(0, Math.round(g?.time_seconds ?? 300));
    return (g?.isOT ? '+' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  RL.playersByTeam = (d) => {
    const out = [[], []];
    for (const [id, p] of Object.entries(d?.players || {})) out[p.team === 1 ? 1 : 0].push({ ...p, _id: id });
    out.forEach(a => a.sort((x, y) => (x.shortcut ?? 0) - (y.shortcut ?? 0) || String(x.name).localeCompare(y.name)));
    return out;
  };
  RL.targetPlayer = (d) => {
    const t = d?.game?.target; if (!t) return null;
    const ps = d.players || {};
    if (ps[t]) return { ...ps[t], _id: t };
    for (const [id, p] of Object.entries(ps)) if (p.id === t || p.primaryID === t || p.name === t) return { ...p, _id: id };
    return null;
  };
  RL.hexA = (hex, a) => {
    const h = String(hex || '#888').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  };
  const ARENAS = {
    stadium_p:'DFH Stadium', stadium_day_p:'DFH Stadium (Day)', stadium_foggy_p:'DFH Stadium (Stormy)', stadium_winter_p:'DFH Stadium (Snowy)', stadium_race_day_p:'DFH Stadium (Circuit)', stadium_10a_p:'DFH Stadium (10th Anniversary)',
    eurostadium_p:'Mannfield', eurostadium_night_p:'Mannfield (Night)', eurostadium_rainy_p:'Mannfield (Stormy)', eurostadium_snownight_p:'Mannfield (Snowy)', eurostadium_dusk_p:'Mannfield (Dusk)',
    cs_p:'Champions Field', cs_day_p:'Champions Field (Day)', cs_hw_p:'Rivals Arena', swoosh_p:'Champions Field (Nike FC)', bb_p:'Champions Field (NFL)',
    utopiastadium_p:'Utopia Coliseum', utopiastadium_dusk_p:'Utopia Coliseum (Dusk)', utopiastadium_snow_p:'Utopia Coliseum (Snowy)', utopiastadium_lux_p:'Utopia Coliseum (Gilded)',
    park_p:'Beckwith Park', park_night_p:'Beckwith Park (Midnight)', park_rainy_p:'Beckwith Park (Stormy)', park_snowy_p:'Beckwith Park (Snowy)', park_bman_p:'Beckwith Park (Night)',
    trainstation_p:'Urban Central', trainstation_night_p:'Urban Central (Night)', trainstation_dawn_p:'Urban Central (Dawn)', trainstation_spooky_p:'Urban Central (Haunted)',
    wasteland_p:'Wasteland', wasteland_s_p:'Wasteland', wasteland_night_p:'Wasteland (Night)', wasteland_night_s_p:'Wasteland (Night)', wasteland_grs_p:'Wasteland (Pitched)',
    neotokyo_standard_p:'Neo Tokyo', neotokyo_p:'Neo Tokyo', neotokyo_toon_p:'Neo Tokyo (Comic)', neotokyo_arcade_p:'Neo Tokyo (Arcade)', neotokyo_hax_p:'Neo Tokyo (Hacked)',
    farm_p:'Farmstead', farm_night_p:'Farmstead (Night)', farm_upsidedown_p:'Farmstead (The Upside Down)', farm_hw_p:'Farmstead (Spooky)', farm_grs_p:'Farmstead (Pitched)',
    arc_p:'Starbase ARC', arc_standard_p:'Starbase ARC', arc_darc_p:'Starbase ARC (Aftermath)',
    beach_p:'Salty Shores', beach_night_p:'Salty Shores (Night)', beach_night_grs_p:'Salty Shores (Salty Fest)',
    underwater_p:'AquaDome', underwater_grs_p:'AquaDome (Salty Shallows)',
    chinatown_p:'Forbidden Temple', chinatown_dusk_p:'Forbidden Temple (Day)', fni_stadium_p:'Forbidden Temple (Fire & Ice)',
    music_p:'Neon Fields', outlaw_p:'Deadeye Canyon', outlaw_oasis_p:'Deadeye Canyon (Oasis)', street_p:'Sovereign Heights',
    woods_p:'Drift Woods', woods_night_p:'Drift Woods (Night)', hoopsstadium_p:'Dunk House', shattershot_p:'Core 707',
    throwbackstadium_p:'Throwback Stadium', chn_stadium_p:'Estadio Vida', chn_stadium_day_p:'Estadio Vida (Day)',
  };
  RL.arenaName = (raw) => {
    if (!raw) return '';
    const k = String(raw).toLowerCase();
    if (ARENAS[k]) return ARENAS[k];
    return String(raw).replace(/_p$/i, '').split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  };
  RL.esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  RL.mvp = (players) => {
    let best = null;
    for (const p of Object.values(players || {})) if (!best || (p.score ?? 0) > (best.score ?? 0)) best = p;
    return best;
  };

  /* ---- minimap ---- */
  const FIELD = { X: 4096, Y: 5120, C: 1152, GW: 893, GD: 880 };
  const PADS = [[-3584, 0], [3584, 0], [-3072, 4096], [3072, 4096], [-3072, -4096], [3072, -4096]];
  const SMALL = [[0,-4240],[-1792,-4184],[1792,-4184],[-940,-3308],[940,-3308],[0,-2816],[-3584,-2484],[3584,-2484],[-1788,-2300],[1788,-2300],[-2048,-1036],[0,-1024],[2048,-1036],[-1024,0],[1024,0],[-2048,1036],[0,1024],[2048,1036],[-1788,2300],[1788,2300],[-3584,2484],[3584,2484],[0,2816],[-940,3310],[940,3308],[-1792,4184],[1792,4184],[0,4240]];
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpAng = (a, b, t) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
  const yawRad = (y) => y == null ? 0 : (Math.abs(y) > 7 ? y / 32768 * Math.PI : y);

  RL.MiniMap = class {
    constructor(canvas, opts = {}) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.opts = Object.assign({ names: true, trails: true, pads: true, compact: false, bg: true }, opts);
      this.sm = {}; this.trails = {}; this.ball = null; this.ballTrail = [];
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
      const loop = () => { this.draw(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    resize() {
      const r = this.c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      this.c.width = Math.max(1, r.width * dpr); this.c.height = Math.max(1, r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const len = (FIELD.Y + FIELD.GD) * 2, wid = FIELD.X * 2, pad = this.opts.compact ? 8 : 22;
      this.v = { s: Math.min((r.width - pad * 2) / len, (r.height - pad * 2) / wid), cx: r.width / 2, cy: r.height / 2, w: r.width, h: r.height };
    }
    P(x, y) { return [this.v.cx + y * this.v.s, this.v.cy + x * this.v.s]; }
    path(pts) { const c = this.ctx; c.beginPath(); pts.forEach(([x, y], i) => { const [sx, sy] = this.P(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); }
    field() {
      const c = this.ctx, { X, Y, C, GW, GD } = FIELD, b = RL.teamColor(0), o = RL.teamColor(1);
      c.clearRect(0, 0, this.v.w, this.v.h);
      const oct = [[-X + C, -Y], [X - C, -Y], [X, -Y + C], [X, Y - C], [X - C, Y], [-X + C, Y], [-X, Y - C], [-X, -Y + C]];
      // goals
      [[-1, b], [1, o]].forEach(([side, col]) => {
        this.path([[-GW, side * Y], [GW, side * Y], [GW, side * (Y + GD)], [-GW, side * (Y + GD)]]); c.closePath();
        c.fillStyle = RL.hexA(col, .55); c.fill(); c.strokeStyle = RL.hexA(col, .9); c.lineWidth = 1.5; c.stroke();
      });
      this.path(oct); c.closePath();
      if (this.opts.bg) {
        const g = c.createLinearGradient(this.P(0, -Y)[0], 0, this.P(0, Y)[0], 0);
        g.addColorStop(0, RL.hexA(b, .28)); g.addColorStop(.5, 'rgba(14,20,34,.85)'); g.addColorStop(1, RL.hexA(o, .28));
        c.fillStyle = g; c.fill();
      }
      c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,.6)'; c.stroke();
      c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,.28)';
      this.path([[-X, 0], [X, 0]]); c.stroke();
      const [cx, cy] = this.P(0, 0); c.beginPath(); c.arc(cx, cy, 1000 * this.v.s, 0, Math.PI * 2); c.stroke();
      // penalty-ish boxes
      [-1, 1].forEach(s => { this.path([[-1800, s * Y], [-1800, s * (Y - 1400)], [1800, s * (Y - 1400)], [1800, s * Y]]); c.stroke(); });
      if (this.opts.pads) {
        c.fillStyle = 'rgba(255,196,61,.75)';
        PADS.forEach(([x, y]) => { const [sx, sy] = this.P(x, y); c.beginPath(); c.arc(sx, sy, Math.max(2.5, 150 * this.v.s), 0, Math.PI * 2); c.fill(); });
        if (!this.opts.compact) {
          c.fillStyle = 'rgba(255,196,61,.4)';
          SMALL.forEach(([x, y]) => { const [sx, sy] = this.P(x, y); c.beginPath(); c.arc(sx, sy, Math.max(1.5, 60 * this.v.s), 0, Math.PI * 2); c.fill(); });
        }
      }
    }
    draw() {
      if (!this.v || !this.v.s) return;
      this.field();
      const d = RL.update, c = this.ctx; if (!d) return;
      const target = RL.targetPlayer(d)?._id;
      const players = d.players || {};
      for (const id of Object.keys(this.sm)) if (!players[id]) { delete this.sm[id]; delete this.trails[id]; }
      for (const [id, p] of Object.entries(players)) {
        const L = p.location; if (!L) continue;
        const yaw = yawRad(L.yaw);
        const s = this.sm[id] || (this.sm[id] = { x: L.X, y: L.Y, z: L.Z || 0, yaw, lx: L.X, ly: L.Y, ping: 0 });
        const est = !!p.locEstimated, k = est ? .09 : .35;
        if (est && (L.X !== s.lx || L.Y !== s.ly)) { s.ping = 1; s.lx = L.X; s.ly = L.Y; }
        s.x = lerp(s.x, L.X, k); s.y = lerp(s.y, L.Y, k); s.z = lerp(s.z, L.Z || 0, k); s.yaw = lerpAng(s.yaw, yaw, est ? .15 : .35);
        const alpha = est ? Math.max(.3, 1 - Math.max(0, (p.locAge || 0) - 1500) / 9000) : 1;
        c.globalAlpha = alpha;
        const col = RL.teamColor(p.team === 1 ? 1 : 0);
        if (this.opts.trails) {
          const tr = this.trails[id] || (this.trails[id] = []); tr.push([s.x, s.y]); if (tr.length > 36) tr.shift();
          this.path(tr); c.strokeStyle = RL.hexA(col, .35); c.lineWidth = 2; c.stroke();
        }
        if (p.isDead) { c.globalAlpha = 1; continue; }
        const [sx, sy] = this.P(s.x, s.y);
        if (s.ping > 0) { c.beginPath(); c.arc(sx, sy, 6 + (1 - s.ping) * 26, 0, Math.PI * 2); c.strokeStyle = RL.hexA(col, s.ping); c.lineWidth = 2; c.stroke(); s.ping = Math.max(0, s.ping - .03); }
        const r = Math.max(this.opts.compact ? 5 : 7, 150 * this.v.s) * (1 + Math.min(s.z, 1500) / 3000);
        const dx = Math.sin(s.yaw), dy = Math.cos(s.yaw), isT = id === target;
        if (!this.opts.compact) {
          c.beginPath(); c.arc(sx, sy, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(100, p.boost || 0) / 100);
          c.strokeStyle = '#ffc43d'; c.lineWidth = 2.5; c.stroke();
        }
        c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fillStyle = col; c.fill();
        c.lineWidth = isT ? 3 : 1.5; c.strokeStyle = isT ? '#fff' : 'rgba(0,0,0,.6)'; c.stroke();
        c.beginPath();
        c.moveTo(sx + dx * (r + 8), sy + dy * (r + 8));
        c.lineTo(sx + dx * r * .3 - dy * r * .7, sy + dy * r * .3 + dx * r * .7);
        c.lineTo(sx + dx * r * .3 + dy * r * .7, sy + dy * r * .3 - dx * r * .7);
        c.closePath(); c.fillStyle = 'rgba(255,255,255,.92)'; c.fill();
        if (this.opts.names) {
          c.font = `700 ${this.opts.compact ? 10 : 12}px Bahnschrift, "Barlow Condensed", "Segoe UI", sans-serif`; c.textAlign = 'center';
          c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.85)'; const label = String(p.name || id).toUpperCase();
          c.strokeText(label, sx, sy - r - 7); c.fillStyle = '#fff'; c.fillText(label, sx, sy - r - 7);
        }
        c.globalAlpha = 1;
      }
      const B = d.game?.ball?.location;
      if (B) {
        const b = this.ball || (this.ball = { x: B.X, y: B.Y, z: B.Z || 0 });
        b.x = lerp(b.x, B.X, .45); b.y = lerp(b.y, B.Y, .45); b.z = lerp(b.z, B.Z || 0, .45);
        if (this.opts.trails) { this.ballTrail.push([b.x, b.y]); if (this.ballTrail.length > 26) this.ballTrail.shift(); this.path(this.ballTrail); c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 2; c.stroke(); }
        const [bx, by] = this.P(b.x, b.y);
        const br = Math.max(this.opts.compact ? 4 : 6, 150 * this.v.s) * (1 + Math.min(b.z, 2000) / 2500);
        c.beginPath(); c.arc(bx, by, br + 5, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,.14)'; c.fill();
        c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1.5; c.stroke();
      }
    }
  };
})();
