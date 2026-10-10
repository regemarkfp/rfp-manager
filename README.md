# RFP Manager

All-in-one live production tool: assets, fixtures and results, rundowns, productions, crew and costing,
live scoring to each sport's federation rules, CasparCG graphics, advertising, and commentary and rundown monitors. One program, two ways to run it:

```
 Website (free host)                         Production PC (console app)
 MODE=cloud  ── MongoDB Atlas                node server.js ── SQLite file + image folder
 Google sign-in                              CasparCG (AMCP 5250), browser outputs
        ▲                                             │
        └───────── sync + live link (machine key) ────┘
 Scorers, producers, crew on any device      Graphics operator, scorer at the venue
```

- **Production PC**: a console app with its own local database (SQLite, one file) so it keeps working with
  no internet. It drives CasparCG and keeps every image as a real file in a folder you choose per machine.
- **Website**: the same app in cloud mode, storing data in MongoDB. People sign in with Google.
- The two stay in step. Changes go across within a moment while online and catch up after an outage.
  The newest change to a record wins, so score a match from one place (normally the production PC).

## 1. Run it on the production PC

1. Install **Node.js 22.13 or newer** (the current LTS from https://nodejs.org is fine). Nothing else to install.
2. Double-click `run.bat` (Windows) or run `./run.sh`.
3. Open the address the console prints, e.g. `http://localhost:8090`.
4. First run: either **create the first account** on this machine, or **link it to your website** (section 3).
5. Copy `templates/rfp` into CasparCG's template folder (`template-path` in `casparcg.config`).

### The app: RFP Manager.exe (Windows)

Double-click **`Build RFP Manager app.cmd`** once (with internet the first time). It builds `RFP Manager.exe` in this
folder with the C# compiler that comes with Windows and puts shortcuts on the desktop and in the Start menu. The first
build fetches Microsoft's WebView2 SDK (about 10 MB from nuget.org) into `tools\launcher\webview2`; later builds and
new zips reuse it (copy that folder across when you update). Start RFP Manager from the shortcut from then on:

- **its own windows, no browser**: RFP Manager, Graphics control, the scorer, dashboards, the Timeline and Worship open
  as windows of RFP Manager.exe (WebView2, the engine of Microsoft Edge that Windows 10 and 11 already have). Each window
  has a menu: **RFP Manager** (Home, New window Ctrl+N, Console, Open this screen in my web browser, Close Ctrl+W, Quit
  Ctrl+Q), **Screens** (Graphics control Ctrl+1, Scorer Ctrl+2, Dashboards Ctrl+3, Timeline Ctrl+4, Worship Ctrl+5,
  Rundown, Browser output, Monitors), **View** (Reload F5, Back, Zoom Ctrl +/−/0, Full screen F11 (Esc leaves it),
  Always on top, Print Ctrl+P, Developer tools). Links and pop-ups of RFP Manager (reports, print views) open as new
  windows; other websites open in your web browser. Each screen remembers its size, position and monitor. You sign in
  once for all windows.
- no console window: RFP Manager runs in the background with an icon in the tray (bottom right). Closing the windows
  keeps it running (graphics, scorers on tablets and outputs carry on); double-click the tray icon to open it again,
  Quit to stop it. Starting the shortcut again opens a window in the running copy.
- right-click the tray icon: those screens, **Console** (everything the console prints, with Status, Sync now,
  Reconnect CasparCG, Reset a password and Restart as buttons), open in your web browser, open the folder,
  **Start with Windows**, Restart, Quit;
- if RFP Manager stops by itself it is started again.

If the WebView2 SDK could not be fetched, or the WebView2 Runtime is missing (rare; installer at
https://go.microsoft.com/fwlink/p/?LinkId=2124703), the windows open in Edge / Chrome app mode instead and the console
says why. It still needs Node.js installed (or a `node\node.exe` in this folder). `run.bat` keeps working as before,
and phones, tablets and other PCs still use the web addresses.

### Where things are kept, and a forgotten password

Everything on the production PC is in the `data` folder inside the RFP Manager folder: `data/rfpmanager.db` holds the
accounts (passwords are stored scrambled, not readable), teams, matches and settings; pictures are in the image folder
shown when it starts. A copy of RFP Manager in another folder has its own `data` folder, so its own accounts.
Forgot a password: click in the black RFP Manager window and press **P**. It lists the accounts on this PC and sets a new
password for the one you choose.

### Updating to a new zip

Close the RFP Manager window, unzip over the same folder (replace all files; `config.json` and `data/` are kept), and
start `run.bat` (or RFP Manager.exe: tray icon → Quit first, and run `Build RFP Manager app.cmd` again when the
new version's notes say the app changed; `tools\launcher\webview2` is kept) again. The version shows at the bottom of the side menu and on the SERVER pill in Graphics control
(`SERVER 0.10.0`). If it still shows the old number, the old copy is the one that is running.


Console keys: `S` status · `Y` sync now · `R` reconnect CasparCG · `Q` quit.

Settings that belong to the machine live in `config.json` (created on first run, see `config.example.json`) and
are edited in the app under **Settings → This machine**.

### The image folder (per machine)

**Settings → This machine → Image folder.** Every image (logos, player photos, sponsor boards) is saved there
as a normal file, named after the image, e.g. `toyota-cheetahs_k3f9x2ab.png`.

- Upload on this machine: saved to the folder, then uploaded to the website.
- Upload on the website or another machine: downloaded into this machine's folder automatically.
- Change the folder: existing files are copied across and anything missing is downloaded again.
- CasparCG templates receive the file path (`file:///C:/…/logo.png`). If CasparCG runs on a different PC,
  switch *Images in templates* to *Web address*.

## 2. Put the website online (free)

You need three free accounts: MongoDB Atlas (database), Render (hosting) and Google Cloud (sign-in).

### 2a. MongoDB Atlas

1. Create an account at https://www.mongodb.com/atlas and create a **Free** cluster.
2. *Database Access*: add a database user with a password.
3. *Network Access*: allow access from anywhere (`0.0.0.0/0`). A free host has no fixed address.
4. *Connect → Drivers*: copy the connection string, `mongodb+srv://USER:PASSWORD@cluster….mongodb.net/`.

The free cluster holds 0.5 GB. Images are stored in the database too (free hosts have no permanent disk), at up
to 8 MB each, so keep logos reasonably sized. Atlas pauses a free cluster after 30 days with no connections.

### 2b. Render

1. Put this folder in a GitHub repository (private is fine). `config.json` and `data/` are already ignored.
2. In Render: **New → Blueprint**, choose the repository. `render.yaml` sets everything up.
   (Or **New → Web Service**: build `npm install`, start `node server.js`.)
3. Set the environment variables:

   | Variable | Value |
   |---|---|
   | `MODE` | `cloud` |
   | `MONGODB_URI` | the Atlas connection string |
   | `GOOGLE_CLIENT_ID` | from 2c |
   | `NODE_VERSION` | `22` |

4. Deploy. Your site is at `https://<name>.onrender.com`.

A free Render service sleeps after 15 minutes without traffic and takes about a minute to wake. A linked
production PC syncs every few seconds, which keeps it awake during a production. Any Node host works the same
way; the app only needs the variables above.

### 2c. Google sign-in

1. Open https://console.cloud.google.com/auth/clients and create or select a project.
   If asked, configure the consent screen first (*External*, app name, your email).
2. **Create client** → *Application type*: **Web application**.
3. **Authorised JavaScript origins**, add:
   - `https://<name>.onrender.com`
   - `http://localhost` and `http://localhost:8090` (so Google sign-in also works on the production PC itself)
4. Create, then copy the **Client ID** (`…apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID` on Render.
   No client secret is needed.
5. While the consent screen is in *Testing*, only the test users you list can sign in. Publish it when ready.

How it works: the page shows Google's button, Google returns a signed ID token, and the server checks the
signature against Google's public keys, the audience (your client ID), expiry and verified email. The first
time you sign in you create your production team; add colleagues under **Settings → Members** by their Google
email and give each a role.

| Role | Can |
|---|---|
| Admin | everything, including members, settings, machine keys |
| Producer | edit all records |
| Scorer | score matches and control graphics |
| Crew | view only (ID numbers hidden) |

## 3. Link a production PC to the website

**With Google on the PC (quickest).** On the PC's first-run screen (in RFP Manager.exe or at
`http://localhost:8090`), press **Sign in with Google** and pick your account. If you are an Admin of a production
team on the website, the PC links itself to the website (it gets its own machine key), your teams and data come down,
and you are signed in. The PC takes the Google sign-in settings from the website by itself, so nothing needs setting
up on it. After that, every member of those teams signs in on the PC with Google; someone added on the website a
moment ago is let in too (the PC checks with the website first). Changes made on the PC go up to the website as
before.

**By signing in on the website.** On the PC, at first run (or **Settings → This machine → Website link**), keep the
website address (`https://rfp-manager-f3r7.onrender.com` is filled in) and press **Sign in on the website to link this
PC**. The website opens in your browser with a code: sign in with Google as an Admin of your production team, check
the code matches the one on the PC, and press **Link this PC**. The PC gets its own machine key by itself (it shows on
the website under Settings → Machine keys, where it can be revoked) and starts syncing. Nothing to copy.

**With a key (still works).** Website: **Settings → Machine keys → Create machine key**, then on the PC open
"Link with a machine key instead" and paste the address and key.

The PC then holds every production team the key's owner is an Admin of. Accounts come down with the data, so
members sign in on the PC with the same Google account they use on the website (at `http://localhost:8090` and in
RFP Manager.exe). For venues with no internet, an Admin can set a password for a member on the PC
(**Settings → Members**). Those passwords stay on that PC.

Google sign-in on the PC works at `http://localhost:8090`. Google does not allow plain `http://` addresses
other than localhost, so other devices reach the PC's screens through the website (below), or sign in with a
password on the local network, or over HTTPS with Tailscale.

### Using the PC's screens from anywhere (remote access through the website)

A linked PC keeps one outgoing connection open to the website. Team members signed in on the website can then use
**every live screen of that PC from anywhere**: Graphics control, the scorers, dashboards, the Timeline and crew view,
Worship, the confidence, rundown and output monitors, Settings → Connections, Templates (with previews from the
PC's template folder), Variables & triggers and Advert playout. Graphics still play out from the PC (CasparCG,
vMix, ATEM, HyperDeck, OBS, Companion …). Nothing has to be opened on the router.

- On the website, the menu shows **PC: <name>** under the team. With one PC online it is used straight away; with
  several, pick one (remembered per browser). "No PC (website only)" uses the website itself (scoring and records,
  no graphics). **Live → Production PCs** (or "+ Link a production PC…" in that list) shows which PCs are online.
- Settings on the website gets **Connections** and **Production PC** tabs for the PC in use (Admins).
- **Monitors** on the website gives links that work anywhere. View-only screens (confidence monitor, rundown,
  output, preview, fill/key, stage, crew view) carry the PC and its screen key, e.g.
  `https://…onrender.com/output?pc=<PC>&key=<screen key>` for an OBS or vMix browser source in another city.
- Who may: the website checks the Google sign-in and that the person is in a production team the PC serves; the PC
  then applies the person's role as usual. The play log shows such actions with the person and their address.
- If the PC goes offline, its screens show "Waiting for the production PC…" and carry on by themselves when it is back.
- Switch it off per PC: Settings → This machine → Remote access through the website.
- Every request travels website → PC, so expect a little delay (about the round trip from the viewer to the
  website and on to the PC). For the lowest latency at the venue, keep using the PC's own address there.
- The free Render plan sleeps when nobody uses the site; a linked PC keeps it awake while it runs.

### Backup: Tailscale Funnel (no website involved)

Tailscale can give the PC its own fixed `https://` address on the internet, separate from the website:

1. Install Tailscale on the PC (https://tailscale.com/download) and sign in.
2. In the Tailscale admin console, allow Funnel for the PC (Access controls → "funnel" node attribute; the console
   offers it the first time).
3. On the PC, in a command prompt: `tailscale funnel --bg 8090`. It prints the address, e.g.
   `https://ob-truck.tail1234.ts.net`.
4. In RFP Manager on the PC: Settings → This machine → "Who can reach this app" → **Any address**, and add the
   `https://…ts.net` address as an authorised JavaScript origin of the Google client (Google Cloud console →
   Clients → RFP Manager website) so Google sign-in works there too.

Anyone with that address reaches the PC's sign-in page, so keep members' roles tight. `tailscale funnel --bg off`
(or `tailscale funnel reset`) turns it off. Only for devices on your own tailnet, `tailscale serve --bg 8090` is
the private version.

### Live streaming: Channels (SRT / RTMP in, watch pages out)

The website can run its own streaming server, so you do not need YouTube or Facebook. Each production team makes
**Channels** (Streaming → Channels). A channel has its own stream key and a watch page at
`https://<site>/watch/<channel>` that plays in any browser (WebRTC, under a second of delay; HLS on iPhones when
WebRTC cannot play). Who can watch is set per channel: **Public**, **Team members** (signed in) or **Password**.
A paywall can be added later on the same check.

Send to a channel from OBS, vMix, Wirecast, an encoder or Larix on a phone. The channel page shows exactly what to
type and has Copy buttons:

* **RTMP**: server `rtmp://<site>/live`, stream key `<channel>?user=publish&pass=<key>`.
* **SRT** (better on poor internet): host `<site>`, port 8890, stream ID `publish:live/<channel>:publish:<key>`
  (or the full `srt://…` URL in OBS).

The channel page also shows whether it is live, for how long, how many watch and the bitrate coming in.
**New stream key** stops the old key straight away. **Switched off** blocks streaming and watching.

**Setting up the server** (once; Oracle Cloud, Hetzner or any Ubuntu 22.04 / 24.04 VM, arm64 or x64):

1. Where the website runs now (Render → Environment), add `SITE_ADMINS` = your email, so you get
   **Settings → Server**.
2. Settings → Server → **Make the setup command**. Run that one line on the new server over SSH, or paste it in
   as the VM's *cloud-init script* when you create it. It installs Node.js, this website, MediaMTX (the streaming
   server) and Caddy (https), using the same database and Google sign-in as the current website. The link in it
   works for 24 hours and hands out the database settings, so do not share it.
3. Open the ports in the cloud firewall (Oracle: the subnet's security list): TCP 80, 443, 1935, 8189 and UDP
   443, 8189, 8890.
4. The server's address is `https://<its-ip-with-dashes>.sslip.io` unless you add `--domain tv.example.com` (point
   the domain's A record at the server first). Add that address to the Google client's *Authorised JavaScript
   origins*, then use it from then on and link the production PCs to it. Render can stay as a spare.

To update the server later, make a new setup command and run it again. The settings and stream keys stay. Logs:
`journalctl -u rfp-manager -f` and `journalctl -u mediamtx -f`. Bandwidth: one 4 Mb/s stream uses about 1.8 GB
an hour for each viewer (Oracle includes 10 TB a month).

### Who does what: the website manages, the PC is the CasparCG bridge

* **The website** is where records are managed: clubs, teams, players, venues, competitions, fixtures, productions
  and rundowns, crew, crew roles, equipment, adverts and ad playlists, songs and services, images, channels, team
  settings and members. The website does **no scoring**.
* **The production PC** is the bridge to CasparCG. It must be linked to the website once (sign in with Google, or
  link by signing in on the website). It shows everything from the website **read-only** (each record has *Edit on
  the website ↗*), and it runs the live side: scoring (on the PC or on tablets and phones on its network), Graphics
  control, the template folder, themes, dashboards, timelines, variables and triggers, worship control, advert
  playout, devices and the play log. The menu opens on **Bridge**: website and CasparCG status, what is on air, and
  the live screens.
* **Internet down?** The PC carries on with its own copy of everything. Scores, graphics and the play log are kept
  on the PC. The Bridge page shows how many changes are waiting, and they go up to the website as soon as it is
  reachable again.
* **Signing in without internet:** Google needs the internet. An Admin can give a member a password for this PC only
  (Settings → Members on the PC).

## 4. Using it

| Area | What it does |
|---|---|
| **Assets** | Themes, competitions, players, venues, clubs and teams. A team inherits name, graphic name, abbreviation, colours and logo from its club unless it sets its own. |
| **Fixtures & Results** | Match name is generated from the teams unless you type one. Saving a fixture creates or updates a production for that venue and day. **Score** opens the live scorer for that match; **Put on air** makes it the match the graphics and monitors follow. Completed matches feed the competition log and player statistics. |
| **Rundown** | Per match or production. Start times follow on from durations; a typed time pins an item. Each line can have a colour. **Print** gives the run order sheet (header box, Item / Time / Content / Source / Sound / Graphics / Duration, coloured lines). **Monitor** opens the rundown monitor. |
| **Productions** | Event, TX time, remote studio, key contacts, crew by location with call and TX times, additional information, nearest hospitals, equipment and other costs. Costing shows cost, invoice, profit and margin. **Call sheet** prints with your production team's name, logo and details (Settings → Production team), followed by the run order. |
| **Adverts** | Images (full screen, lower banner, corner bug, side panel, or a custom position and size in pixels) or CasparCG video clips, single or as a playlist. Per advert: picture fit, background, transition and its time, CasparCG channel, layer and template, loop and clip volume, run from / until dates and most plays a day (playlists skip adverts outside their dates or over their daily plays). Every play is logged for proof of play with the time it was really on air. |
| **Timelines** | Live → Timelines: a show on tracks against time, run with PLAY and GO (see Timeline below). |
| **Play log** | Live → Play log: everything that went to air (graphics and adverts) with start, end, time on air, channel-layer, the text on it, **who took it** (the screen, the person and their address: "Graphics control · Ruan · 100.64.0.7", "Timeline GO", "Trigger", "Companion", "Input", "Ad playlist"), who took it off, and the **production** and match. Filter by dates, kind, production, match, person / screen, text, and pick only certain graphics or adverts; totals per sponsor and advert; **Print report** (a printable page of what the filters show, with totals) and Export CSV. |
| **Monitors** | The short link for every screen on this PC. |
| **Worship** | Services, songs, CCLI report and Bibles (see Worship control below). |
| **Phones and tablets** | Every screen fits a phone and a tablet: the side menu opens from ☰, tab rows swipe sideways, scorers and Graphics control stack into one column, bigger touch targets, and the commentary and rundown monitors turn into one column you scroll when the screen is upright. On the Timeline hold a finger on a track to add a cue. |
| **Side menu** | One group open at a time (the one you are in, or the one you opened last). « makes the whole menu narrow; it remembers that per browser. |
| **Settings** | Accent colour, company details and logo, currency, custom fields on any record type, members, machine settings, save file. |

### One link per screen

Every screen has a short link on the production PC. The links belong to the device and follow whatever is live
on it, so they never change from match to match:

| Link | Screen | Access |
|---|---|---|
| `http://pc-name:8090/scorer` | The right scorer for the match on air (cricket or the sport's own) | Sign-in, Scorer role or higher |
| `http://pc-name:8090/graphics-control` | Graphics control | Sign-in; Producer for CasparCG settings |
| `http://pc-name:8090/confidence` | Commentary confidence monitor | Open, view-only |
| `http://pc-name:8090/rundown` | Rundown monitor | Open, view-only (cueing needs a sign-in) |
| `http://pc-name:8090/output`, `/preview` | Program and preview output | Open, view-only |
| `http://pc-name:8090/fill-key`, `/key`, `/fill` | Program output with a key signal (Raspberry Pi) | Open, view-only |
| `http://pc-name:8090/worship` | Worship control | Sign-in, Scorer role or higher |
| `http://pc-name:8090/stage` | Stage display | Open, view-only |

`pc-name` is the computer's name (its MagicDNS name on Tailscale); its Tailscale IP address works too. The
**Monitors** page lists the links for the PC you are on, and the console prints them at start-up.

- To drop the `:8090`, set `"port": 80` in `config.json` and restart (nothing else on the PC may use port 80).
- "Open" screens need no sign-in, so anyone who can reach the PC can view them. Set `"shortLinks": false` in
  `config.json` to make them ask for a sign-in or the screen key instead.
- Someone who is not signed in and opens `/scorer` is asked to sign in and is then taken back to the scorer.

**No set-up at the match.** The scorer takes the teams, squads, numbers, positions, colours, logos, competition
and venue from the match. The rules come from the match's **Format / rules** field, else the competition's,
else the sport's default (for example "Rugby: Rugby sevens (2 × 7)" or "Cricket: T20 (20 overs)").
The first match a scorer opens on a PC becomes that PC's live production. If `/scorer` is opened while nothing
is on air, it asks which match the production is, and every other screen follows.

These are the CricketCG screens, running inside RFP Manager. The match state is saved on the fixture, so
results, logs and player statistics come from the same data.

### Federation rules

| Sport | Rules built in |
|---|---|
| **Cricket** (ICC) | Presets: T20, one-day (50), T10, 100-ball, Test / first-class, or custom overs. Powerplay phases (scaled when overs are reduced), bowler over limits, no consecutive overs, free hit after a no-ball and the dismissals allowed on one, DLS par score and revised target (built-in table, or import the official one), super over, two-innings matches with declaration, follow-on and innings victory. A broken restriction is shown to the scorer, who can override it. |
| **Rugby** (World Rugby) | Union 2 × 40, U19 2 × 35, schools 2 × 30, sevens 2 × 7, sevens final 2 × 10, league 2 × 40. Try, conversion, penalty, drop goal, penalty try. Yellow card 10 minutes (2 in sevens), 20-minute red card, permanent red card. Log points with bonus points. |
| **Hockey** (FIH) | 4 × 15 or 2 × 35. Green card 2 minutes, yellow 5 or 10 minutes, red permanent. Penalty corners and strokes, shoot-out. |
| **Netball** (World Netball) | 4 × 15, super shot, Fast5. Centre pass tracking, warning, 2-minute suspension, ordered off. |
| **Tennis** (ITF) | Best of 3 or 5 with a tie-break at 6-6, Grand Slam 10-point final-set tie-break, match tie-break instead of a third set, no-ad doubles, advantage final set, short sets. Server and change of ends follow the rules. |
| **Also included** | Football (IFAB, incl. second yellow, shoot-out, futsal), basketball (FIBA, NBA, 3x3), padel, badminton, volleyball, baseball, athletics. |

The variant is guessed from the fixture's sport (for example "Rugby Sevens") and its period settings, and can
be changed in the scorer's set-up before the match starts.

### Match statistics

Each sport records the statistics its federation and broadcasters report. They can be entered on the scorer
(open **Match statistics** under the score buttons) or by a second person on the **Stats entry** tab of the same
scorer link; both work on the same match at the same time.

| Sport | Statistics |
|---|---|
| **Rugby** | Possession and territory (by time), carries, line breaks, offloads, 22m entries, kicks from hand, handling errors, tackles made and missed, turnovers won and conceded, scrums, lineouts and rucks won and lost, mauls, penalties and free kicks conceded, plus points, tries and goal-kicking. |
| **Hockey** | Possession, shots on goal and wide, circle and 23m entries, penalty corners and conversion, penalty strokes, long corners, aerials, saves, interceptions, tackles, turnovers, fouls, video referrals. |
| **Netball** | Shooting percentage, centre pass receives, feeds, goal assists, gains, intercepts, deflections, rebounds, pick-ups, contact and obstruction penalties, turnovers by type. |
| **Tennis / padel** | Aces, double faults, first serve in, points won on first and second serve, receiving points won, break points won and saved, net points, winners, forced and unforced errors, longest run. Mark "1st serve fault" and "At the net" before the point for the serve and net figures. |
| **Football, basketball, volleyball, badminton** | The usual match sheet for each (shots, saves, possession; box score with offensive and defensive rebounds; attack, block, ace and error types). |
| **Cricket** | Full scorecard, partnerships, fall of wickets, bowling figures, run rates, extras (unchanged). |

- With **Ask which player** on, each stat is credited to a player and appears in the player table and lower
  thirds; off, one click records a team total.
- Possession and territory are counted between events, so they move when the next stat or score is entered.
- The **Stats** tab shows the full team and player tables and exports them as CSV.
- Graphics: **Team Stats (FS)** shows the first nine lines; **page 2** and **page 3** show the rest.

### Statistics graphics

Graphics control → **Scores & Stats** has a group "Statistics with team badges" (template `sport_stat`):

| Graphic | Shows |
|---|---|
| Stat comparison (LT) | One statistic you choose, both teams' badges, values and a bar |
| Key stats (LT) | The first three statistics that have numbers |
| Possession & territory (LT) | Possession, and territory where the sport has it |
| Player stats (LT) | Badge, number, name and up to eight counted statistics of one player |
| Team Stats (FS), pages 1 to 3 | The full table |

They update themselves while on air. They share the lower-third layer, so taking one replaces another lower third.

### Your own templates

**Templates** in the menu reads the HTML templates in a folder on the production PC, normally CasparCG's template
folder (`template-path` in `casparcg.config`). Set the folder at the top of the page; sub-folders are included
and nothing in the folder is ever changed.

1. **Load** a template. RFP Manager reads its variable fields and makes a graphic from it.
2. Set the name, kind, channel, layer and the starting value of each field. Image fields use the image library;
   the preview shows the template itself with your values.
3. It appears in Graphics control under **Captions / Custom → My templates**. The operator can still change any
   field in the Data panel before taking it. The same template can be loaded several times with different values.

How fields are found, in this order:

- declared by the template: `<meta name="rfp-fields" content="title, who:Speaker name, logo:image">`
- sample data in the template: `window.CG_DEMO = { title: 'Hello' }` (the sample becomes the starting value)
- bound in the markup: `data-f="key"`, `data-src="key"` and the like
- the CasparCG convention of elements with `id="f0"`, `id="f1"` …
- placeholders `{{key}}`, and what the script reads from its data (`data.title`, `d['name']`)

**Lottie templates** (LottieFiles / Bodymovin, with the animation in the page or in a `.json` / `.js` file next to
it) are read differently: the editable variables are the text layers you renamed, the pictures, and layers with
"colour" in their name. Each is listed with what the template shows now (its text, picture or colour), and that
text becomes the starting value. Text layers still carrying the name After Effects gave them (their own words)
are treated as fixed labels and offered separately, as are unnamed pictures. Layers starting with `#` are ignored.
The variable name is the layer name, which is what Lottie templates for CasparCG normally match on.

Detection reads the file's text, so an unusual template can be missed or over-read: use **+ Field** to add a
variable by name and ✕ to drop one. **Read from template** re-reads the file after you change it and keeps your values.

**Linking variables to live values.** Each field has **Link to live value…**, which lists everything RFP Manager
knows about the match on air with its current value: team names, short names, badges and colours, scores, period,
clock, statistics, competition, venue, your company name and logo. A linked field shows as a name in braces
(`{teamA_name}`) and follows the match while the graphic is on air; text can mix links and words
(`{teamA_name} v {teamB_name}`). When a template is loaded, variables whose names match a live value are linked
for you (`home`, `away_score`, `tournament`, `home_logo` and the like); check them, since the match is by name.
The preview fills links with what is on air now.

Live values include the competition's logo and colours (`competition_logo` / `tournament_logo`,
`competition_color1`), and cards give a colour as well as a name: `card_color`, `card_name`, `card_player`,
`card_team_name` for the latest card, `last_color` for the latest event (the card's colour, or the team's for a
score), and `sinbin1_color` … for players in the sin bin. For the card slots on a score bug each team has four:
`teamA_card1_color` … `teamA_card4_color` and the same for `teamB` (with `_name`, `_number`, `_key` and `_text`, the
sin-bin time left). They hold the cards in force: sendings-off first, then players in the sin bin, emptying as
sin bins end. Template variables named like `_t1card1` … `_t2card4` are linked to them automatically.

**Automatic updates.** A graphic with links has **Update automatically while on air** switched on: changes are
sent to the template as they happen, and a linked clock every half second, so a template that only shows text
keeps time without a clock of its own. Switch it off to change only on UPDATE.

**Transparent colours.** Any colour field can be set to Transparent, and a linked colour can be told to go
transparent when it has no value (no card yet, a team with no colour). Choose per graphic whether transparent is
sent as `transparent`, `#00000000` or `rgba(0,0,0,0)`, whichever your template understands.

**Variables in bulk.** **Export** on a graphic saves its variables as a CSV file (variable, label, type, value) that
opens in Excel; **Import** loads the same file back, or a JSON file, matching by variable name. Values, including
links such as `{teamA_name}`, are replaced; variables in the file that the graphic does not have are added.
Nothing is kept until you press Save.

**Hiding graphics.** Untick **Show in Graphics control** (or click Shown / Hidden in the Loaded graphics list) to
keep old or unused templates away from the operator. A hidden graphic still plays when it is linked to a built-in
button.

**Using a theme's graphics instead of the standard ones.** On a loaded graphic, set **Link to graphic** (for example your CLOCK instead of "Clock Only", or your bug instead of "Score Bug"). While that theme
is in use, the built-in button plays your template on your channel and layer, including TAKE BUG, quick graphics
and automatic wipes, and its links can use everything the built-in graphic sends.

One template can be linked to several built-in graphics. Cricket and the other sports have separate graphics with
the same names ("Score Bug" exists twice), so link both if the template should serve both; the list says which is
which. The editor tells you when a link cannot work yet (the theme is not in use, or the link is for the other kind
of match) and offers the fix.

Which theme is in use, first match wins:

1. the theme chosen in Graphics control → Production → **Theme** (kept for this PC; "Standard graphics only" turns themes off);
2. the theme of the competition of the match on air;
3. the production team's **Default theme** (Settings → Production team).

**Themes from folders.** Each folder inside the template folder is offered as a theme. **Load as theme** makes a
Theme and a graphic for every template in the folder. Set the theme on a competition and, for its matches:

- the theme's graphics are listed first in Graphics control, marked "this competition";
- a file in the theme folder named like a built-in template (`scorebug.html`, `lowerthird.html`, `fullframe.html`,
  `sport_bug.html`, `sport_full.html`, `sport_stat.html`, `wipe.html` …) replaces that built-in graphic. It receives
  the built-in graphic's data keys, so it must use those names. Anything the folder does not have still comes
  from the standard `rfp` folder.

### Scorer buttons and macros

Both scorers (cricket and the other sports) have **✎ BUTTONS** in the top bar. In that mode, click any button to:

- change its text and colour, its position, or move it under **More…** (a popup with extra buttons) or hide it;
- add actions that run after it scores (a moment later, so the graphics get the new score): take, update or take
  off a graphic with values (`line1 = TRY {team}`, `line2 = {team{team}_name}` – `{team}` is the side pressed, A
  or B, `{other}` the other side, and any live value in braces), invoke a template method, set a field, run a
  macro, send a vMix / ATEM / HyperDeck command, or send an AMCP command. Each action can have a delay.

**Shortcut** (in the same editor): **◉ Learn key** and press a key on the keyboard, and / or **◉ Learn button** and
press a MIDI pad or note, an X-keys key, a button on the Pi's GPI, or send the OSC message. The shortcut presses that
button exactly as a click does (a team's button: that team; set it on each team's button). Keyboard shortcuts work on
that screen; hardware shortcuts work on screens where the **HW KEYS** pill is on (it turns on where you learn one;
have it on in one scorer only, or a press scores twice). They are saved with the buttons, per theme.

**+ New button** adds a button that does only graphics (no scoring), on the scorer or under More…. **Macros…**
keeps named lists of actions that any button can run. Buttons and macros are saved per sport **with the theme in
use** (Graphics control → Production → Theme), or with the production team when no theme is chosen, so each
theme can have its own mapping. Keyboard shortcuts in the cricket scorer score as before but do not run the
button actions.

### Dashboards

Your own control panels: Live → Dashboards → new → **Design**. Drag controls onto the page, drag to move, drag the
corner to resize (snaps to the grid; Alt for free), and set each one up on the right:

| Control | Does |
|---|---|
| Button | runs actions (take / update / take off graphics, macros, adverts, playlists, device commands, set variables, Timeline, AMCP); can ask first; lights up while its graphic is on air or a live value is on |
| Take / out | one graphic: TAKE, and OUT while it is on air (lit red) |
| Toggle | on / off: sets an on / off variable, with actions for on and for off |
| Fader | up / down or sideways: sets a number variable and / or runs actions with `{value}` (on release, or while moving) |
| List | choices you type, the choices of a list variable, players of both teams (or one), the teams, adverts, playlists, graphics or macros: sets a variable and / or runs actions with `{value}` and `{label}` (adverts play, playlists start, graphics are taken, macros run when there are no actions) |
| Text box | sets a variable and / or runs actions with `{value}` |
| Number − / + | steps a number variable, with actions for + and − |
| Text / live value | any text with live values: `{teamA_name} {scoreA} – {scoreB}`, `{clock_text}`, `{var_attendance}` … |
| Clock | time of day, the game clock, the Timeline's time … |
| Image / logo | a picture address or a live value (`{teamA_logo}`) |
| Frame | a box with a title to group controls |

Several pages (tabs), sizes for a PC, an iPad (either way up) or a phone, dark or light, undo, copy / paste. **Use**
mode works on a PC, tablet or phone: the page scales to the screen (a phone held upright scrolls). Open it from the
dashboard's record, the `/dash` link (Monitors), or the app's tray menu. Using a dashboard needs the Scorer role;
designing one, Producer.

### Variables and game triggers (Live → Variables & triggers)

**Variables** are your own values: a name and a key, text, number (lowest / highest), on / off or one of a list,
kept as one value, one per sport, per competition or **per match**, and optionally only for one sport or competition.
They are live values `{var_<key>}` everywhere (templates, triggers, dashboards, action values). Set them on that page,
from dashboards, or with the action **Set a variable** (`12`, `+1`, `-1`, `toggle`, `{value}`, text with live values).
Values are kept on the production PC.

**Game triggers**: WHEN something happens in a game THEN run actions. Cricket: any ball, four, six, four or six,
wicket, dot, wide, no ball, any extra, end of an over, maiden, batter reaches 50 / 100, end of an innings. Other
sports: any score, try, conversion, penalty goal, drop goal, goal, point, any card, yellow, red, substitution,
time-out, new period, end, anything. Per team (either / A / B), sport and competition; every Nth time, a wait before,
not again within N seconds, most per match. Actions include **Play an advert**, **Start an ad playlist** and **Stop
the adverts** (also in scorer buttons, macros, dashboards and Timeline cues), so a sponsor's advert can follow every
second try. Values can use `{team}`, `{event}`, `{event_text}` and `{player}`. They run on the production PC for
the match on air; the play log shows them as "Game trigger".

### Timeline

A show laid out on tracks against time, for concerts, services, awards, half-time shows and anything that runs to a
plan. Make one under Live → Timelines (name, date, the production or match it belongs to, length, tempo), then
**Open timeline**.

- **Tracks** for shots, graphics, lyrics, lights, audio, playback, notes or anything else. A track can be switched
  off (●): its cues show but do not fire.
- **Cues** sit on a track at a time, as a moment or with a length. Double-click a track to add one, drag to move
  (also to another track), drag the end to lengthen. Each cue has a label, text for the crew (lyrics on a lyrics
  track) and **actions**, the same as scorer buttons: take / update / take off a graphic with values, invoke, set a
  field, run a macro, a vMix / ATEM / HyperDeck / Raspberry Pi GPIO command, AMCP, each with a delay. Values can use
  `{cue_label}`, `{cue_text}`, `{section}` and `{track}` as well as every live value.
- **Hold** cues stop the playhead until **GO**. GO also jumps to the next cue on an armed track and fires it, so a
  show can run on the clock, on GO, or both.
- **Sections** (songs, segments, breaks) on their own strip. A section can have its own tempo: switch the ruler to
  **Bars** and the grid shows bars and beats, starting at bar 1 for that section. Snap follows the grid (Alt drags
  freely).
- **Import rundown** brings the rundown of the production or match in as sections and a Rundown track.
- **Comments** at a moment on the timeline, from the editor or from a crew screen, with done / delete.
- Keys: Space play / pause, Enter GO, Home back to the start, N new cue, M new section, Delete, Ctrl+D, Ctrl+C /
  Ctrl+V, Ctrl+Z / Ctrl+Y, ←/→ nudge, Ctrl + mouse wheel zoom.

The timeline runs on the production PC: every screen shows the same playhead, and the actions go out from there.
The website can edit timelines and show them, but not run them. **Crew view** (Monitors → Timeline crew view, or the
`/crew` link) shows each person the tracks they pick: what is on now, what is next with a countdown that turns to
STAND BY, the section, and the next eight cues. Opened from the `/crew` link it follows whichever timeline was
started last. Live values for templates: `timeline_name`, `timeline_state`, `timeline_time`, `timeline_remaining`,
`timeline_section`, `timeline_section_left`, `timeline_next`, `timeline_next_in`.

Not in this version yet: recording rehearsal takes into the timeline, timecode in / out, and exporting markers to
editing software. (OSC, MIDI and Art-Net cues work through Device command actions.)

### Raspberry Pi as a GPO / GPI box

`tools/pi-gpio.py` turns a Raspberry Pi with a relay board into contact closures (GPO) and contact inputs (GPI).
Never wire the Pi's pins straight to broadcast equipment: use an isolated relay board (dry contacts) or optocouplers.

```
python3 pi-gpio.py                    try it (Ctrl+C stops it)
python3 pi-gpio.py --mock             try it without a relay board
sudo python3 pi-gpio.py --install     start it with the Pi (remove: --remove)
```

Pins (BCM numbers) are set with `OUTPUTS=26,20,21` and `INPUTS=5,6,13,19` in front of the command, `ACTIVE_LOW=1`
for relay boards that switch on when the pin is low, `PORT=8095`. Outputs start off, also after a restart; inputs
are on when closed to ground. Needs python3 and gpiozero (both come with Raspberry Pi OS).

In RFP Manager add a **Raspberry Pi GPIO** device (Graphics control → Settings → Devices) with the Pi's address.
Commands: `pulse` (`gpo=1 ms=200`), `on`, `off`, `toggle` (`gpo=2`). Live values: `<id>_gpo1`…, `<id>_gpi1`…, so a
trigger can take a graphic when a button on GPI 1 is pressed, and a cue can fire a relay. Expect a frame or two from
the command to the contact closing.

### Connections (Settings → Connections)

Everything this production PC talks to, in one place (Admins, on the production PC):

- **CasparCG**: on / off, host, AMCP port, program and preview channel, template data (JSON / XML), images as file
  paths or web addresses, default template folder, clear after OUT, reconnect, and a box to send any AMCP command.
- **Devices and software**: vMix, ATEM, HyperDeck, OBS Studio, Bitfocus Companion, OSC, Art-Net, MIDI, X-keys and the
  Raspberry Pi GPIO box, with live status and **Try a command**. Graphics control → Settings shows the same status.
- **Input mappings**: when a live value is pressed / let go / changes / becomes a value, run actions. **◉ Learn**
  fills in the value from the next key, pad, note, GPI or OSC message (15 seconds to press it); **◉ Learn a new one**
  makes a new mapping from it. For example
  X-keys key 5 → Timeline GO, MIDI note 60 → take everything off, `pi_gpi1` → take the scorebug, an OSC message → a
  macro. Actions: macro, Timeline (GO, play, pause, stop, back), take / take off a graphic, take everything off, a
  device command, AMCP, each with a delay.
- **Control RFP Manager from Companion or a Stream Deck**: addresses Companion's "Generic HTTP" module can call
  (no key from the same PC, `?key=<screen key>` from another machine):
  `/live/api/companion/macro/<name>`, `/timeline/go` (play, pause, stop, prev), `/take/<graphic id>`,
  `/out/<graphic id>`, `/hideall`, `/device/<device id>/<command>?value=…`, and `/values` (every live value as JSON).

**MIDI and X-keys** plugged into the production PC connect by themselves, like vMix: add a MIDI or X-keys device in
Settings → Connections (optionally the part of the port / unit name to use; the ports found on the PC are listed
under it) and it goes green. Nothing to install: on Windows RFP Manager starts `tools/rfp-hw.ps1` (PowerShell, which
talks to Windows' own MIDI and HID drivers); on Linux it reads `/dev/snd/midiC*D*` and `/dev/hidraw*` (the user needs
access, e.g. the `audio` group and a udev rule for X-keys). Close other programs holding a MIDI port: some Windows
MIDI drivers let only one program open it. Gear plugged into another computer can still come in through the hardware
bridge page (`/live/bridge.html`) in Chrome or Edge there; browsers allow MIDI / USB only on https or localhost.

| Device | Live values | Commands |
|---|---|---|
| OBS Studio (obs-websocket 5, port 4455, password) | `program_scene`, `preview_scene`, `studio_mode`, `streaming`, `streaming_time`, `recording`, `recording_time`, `recording_paused`, `scenes` | `scene` / `preview` (scene name), `transition`, `stream-start` / `-stop` / `-toggle`, `record-start` / `-stop` / `-toggle` / `-pause` / `-resume`, `mute` / `unmute` / `toggle-mute` (source), `source-show` / `-hide` / `-toggle` (`Scene \| Source`), or any obs-websocket request with JSON |
| Bitfocus Companion (HTTP API, port 8000) | `last_press` | `press`, `down`, `up`, `rotate-left`, `rotate-right` (`1/0/2` = page / row / column), `set-variable` (`name=value`) |
| OSC (UDP) | with a listen port: every address received, e.g. `/1/fader1` → `<id>_1_fader1`, and `last_in` | the address as the command (`/eos/key/go_0`), the arguments as the value (`1 0.5 "text"`) |
| Art-Net (UDP 6454, a universe) | `ch1`… for the channels set | `set` (`1=255 2=128 10-12=50%`), `fade` (`1=255 time=2`), `blackout` |
| MIDI | `note60` (velocity while held), `cc7`, `program`, `last` | `note` (`note=60 vel=127 ch=1`, on and off), `note-on`, `note-off`, `cc` (`cc=7 value=100`), `pc` (`program=3`) |
| X-keys | `key1`…, `last` | `light-on`, `light-off`, `light-flash` (`key=5`, `red=1` for the red bank), `lights-off` |

### vMix, ATEM and HyperDeck

Graphics control → Settings → **Devices**: add vMix (HTTP API, port 8088), Blackmagic ATEM switchers (port 9910)
and HyperDeck recorders (port 9993), with a host and an id. Their state becomes live values named
`<id>_<value>`, usable in template fields, triggers and button values like any other (listed in the template
editor under "Devices"):

| Device | Live values |
|---|---|
| vMix | `active`, `active_title`, `preview`, `preview_title`, `fadetoblack`, `streaming`, `streaming_time`, `recording`, `recording_time`, `external`, `overlay1`…`overlay4` with `_title` and `_onair`, `version` |
| ATEM | `program`, `program_name`, `preview`, `preview_name`, `ftb`, `key1_onair`…, `dsk1_onair`, `dsk1_transition`…, `streaming`, `streaming_state`, `streaming_time`, `recording`, `recording_time`, `model` (other MEs: `me2_program` …) |
| HyperDeck | `status`, `recording`, `playing`, `timecode`, `clip`, `slot` |
| Raspberry Pi GPIO | `gpo1`…, `gpi1`…, `name` |
| all | `<id>_connected` |

On/off values are `1` or empty, so a trigger can use "= 1" or "is not empty". A graphic showing a device value
updates by itself (a stream clock: `LIVE {vmix_streaming_time}`). vMix streaming time is counted from when RFP
Manager first saw the stream running.

Commands (a **Device command** action in scorer buttons, macros and graphic buttons, or **Try a command** in
Settings):

- vMix: any function name with its values, e.g. `Cut`, `OverlayInput1In` with `Input=3`, `SetText` with
  `Input=2&SelectedName=Title.Text&Value={teamA_name}`, `StartStreaming`, `StartRecording`.
- ATEM: `cut`, `auto`, `program` / `preview` (`input=2 me=1`), `key-on` / `key-off` (`key=1`), `dsk-on`,
  `dsk-off`, `dsk-auto` (`dsk=1`), `ftb`, `stream-start`, `stream-stop`, `record-start`, `record-stop`.
- HyperDeck: the protocol's own text commands, e.g. `record`, `stop`, `play`, `goto: clip id:` with `2`.

### Worship control

For church services, in the style of presentation software such as ProPresenter. Open it from the Dashboard,
from **Services** or **Songs**, or at `/worship`.

- **Left**: the order of service (songs, scripture, text slides, media, headings) and the library to add from.
- **Middle**: the slides of the selected item, coloured by section. Click a slide to put it on screen.
- **Right**: the program output, what is next, and tabs for speaker names, the stage display, your own buttons
  and settings.
- Keys: `→` or `Space` next, `←` previous, `F1` clear all, `F2` clear slide, `F3` blank, `F4` logo, `F5` clear name.

**Songs.** Lyrics use `[Verse 1]`, `[Chorus]` headings; a blank line starts a new slide and long sections are
split to the lines-per-slide setting. Chords in `[G]` brackets are kept in the song but not shown.

**CCLI.** CCLI has closed its SongSelect API to new software, so RFP Manager cannot search or download songs from
CCLI itself. Instead:

1. In SongSelect, download a song's lyrics file (`.txt` or `.usr`); ChordPro files work too.
2. **Songs → Import song files…** reads the title, writers, copyright and CCLI song number. Importing a song you
   already have (same CCLI number) updates it.
3. Set your CCLI licence number in Worship control → Settings. The copyright line and licence number are shown on
   the first and last slide of each song.
4. **CCLI report** lists every song put on screen, once per service day, with projected and streamed counts, and
   exports CSV for your reporting.

**Bibles** are files on the production PC (**Bibles** in the menu).

- The King James Version (public domain) downloads with one click; it needs internet once.
- Afrikaans 1933/53, Afrikaans 2020, Nuwe Lewende Vertaling and most modern translations are copyrighted and
  cannot be shipped with the app. If you have the text from the publisher or the Bible Society, import it as
  OSIS XML, Zefania XML, USFM (select all the book files together) or JSON.
- References work in English and Afrikaans: `John 3:16-18`, `Joh 3:16`, `1 Kor 13:4-7`, `Ps 23`. You can also
  search for words.

**Outputs** (Settings tab, saved on the PC):

| Output | Default | Notes |
|---|---|---|
| Audience screen | program channel, layer 60, full slides | |
| Stream lower third | off; layer 61 | Shows the first lines of each slide as a lower third. Give it its own channel for a keyed stream feed. |
| Name super | layer 62 | Fired from the Names tab; saved names are kept for the team. |
| Your buttons | – | Each button sends the AMCP commands you type, one per line: play a sting, fire a lower third from your own template, switch a background. |

Channel 0 means the program channel. Any output can use your own template instead of `worship`; it receives
`layout`, `text`, `line1…`, `label`, `caption`, `footer`, colours and font. You can add more outputs (a second
room, a foyer screen).

**Stage display** (`/stage`): the current and next slide, clock, a countdown timer and messages from the operator.

### Monitors over Tailscale

Open the links above from any device on the tailnet. The commentary confidence monitor switches between cricket
and other sports by itself. On the rundown monitor, signed-in crew (Scorer or higher) can cue with the arrow keys;
everyone else watches.

### Text of several lines and colours

**Several lines in a template text box**, any of these:

- In Graphics control's Data panel press **Shift+Enter** in a text field, or click **¶** next to it, and the field
  becomes a box of several lines (Enter = new line). Pasting text with line breaks does the same. **Ctrl+Enter**
  (Cmd+Enter on a Mac) sends it: UPDATE if the graphic is on air, TAKE if it is not. ¶ again goes back to one line
  (line breaks become spaces). The choice is remembered per graphic and field on that browser.
- Templates → a field's type **Text, several lines**: that field is always a box of several lines, in the template
  editor and in Graphics control. A template can declare it too: `<meta name="rfp-fields" content="body:multiline">`.
  Linking a live value to such a field puts it on a new line.
- In buttons, macros, triggers, the Timeline and Companion: write `{nl}` for a line break, e.g.
  `line1 = FIRST LINE{nl}SECOND LINE`.
- Dashboards: a Text box with **Several lines** ticked (Enter = new line, Ctrl+Enter = Set).

Line breaks reach CasparCG as `\n` in JSON data and as `&#10;` in XML data. The built-in templates show them (`data-f`
fields get the class `cg-ml` with `white-space: pre-line`); in your own HTML templates use
`white-space: pre-line` (or `pre-wrap`) on the element, or replace `\n` with `<br>` when you set `innerHTML`.

**Colours**: every colour box in RFP Manager opens the same picker: a colour square, colour and transparency sliders,
HEX, R, G, B and A (%) fields, a CSS field (`rgb()`, `rgba()`, `hsl()`, names like `orange`), an eyedropper (Chrome /
Edge), Transparent, recent colours, preset colours and, in Graphics control, the colours of the match. Escape or
Cancel puts the colour back. A colour without transparency is stored as `#rrggbb`, one with transparency as
`#rrggbbaa` (CasparCG 2.3+ HTML templates understand both). The accent colour stays solid.

### Customising

- **Custom fields**: Settings → Production team. Add a field to any record type; it appears on the form.
- **Graphics**: Graphics control → Settings. Per graphic you can set your own template, channel and layer.
- **Themes**: copy `templates/rfp` to a new folder, restyle it, create a Theme pointing at that folder and set
  it on a competition.
- **Save file**: Settings → Save file exports and imports XML in the layout of the original save file template.

## 5. Templates

Copy `templates/rfp` into CasparCG's template folder. It holds the CricketCG templates plus three for
productions:

| Template | Used for |
|---|---|
| `scorebug`, `lowerthird`, `fullframe`, `wipe` | Cricket graphics |
| `sport_bug`, `sport_full` (+ `lowerthird`, `wipe`) | All other sports |
| `countdown`, `table`, `advert` | Countdown to a time of day, log table and fixtures, adverts |
| `worship` | Worship slides, stream lower thirds and name supers |
| `sport_stat` | Statistics lower thirds with team badges, player stats |
| `lottie-template`, `debug` | Your own Lottie animations (`tools/wrap-lottie.ps1`), and a data inspector |

Data is a flat `key → text` map. Graphics control shows the exact keys and values for the selected graphic,
lets you edit them before a take, and has preview (PVW channel), **TAKE / UPDATE / OUT**, auto wipes and a
ticker line. Team, competition and player images are sent to CasparCG as `file:///` paths into this machine's
image folder, and to browser outputs as web addresses.

**Browser output**: `/live/output.html?key=<output key>` mirrors every take, update and out with the same
templates. Use it as an OBS or vMix browser source (1920×1080). With CasparCG switched off it is the only output.

**Visual editor for templates**: Templates → open a graphic → *Visual editor*. The preview shows a box on every variable
the template draws (green = follows a live value, amber = fixed value, grey = empty). Click a box or a name, then type a
value or click a live value to link it; Shift-click adds it to the text; live values can be dragged onto a box.
"Auto-link all" links every variable whose name matches a live value. Colours and variables the template is not showing
at the moment have no box but are in the list. *Settings and table* is the full list with channel, layer and theme.

**Buttons (invokes and actions)**: Templates → a graphic → *Settings and table* → Buttons. A button has a text and one or
more actions that all happen on one press: invoke a method on this or another graphic (`showStats`, `page(2)`), take,
take off or update this or another graphic, set a field of this graphic, or send an AMCP command (`{channel}` and
`{layer}` stand for this graphic's). Each action can have a delay in seconds after the press. Functions found in the
template file are offered to add. In Graphics control the buttons show on the graphic's row in the On air list, and under
TAKE / UPDATE / OUT when the selected graphic is in Program, with NEXT and a box to send any other method.
A trigger can also react to an invoke: `IF invoke is <method, or empty for any> THEN update this graphic`, and every
show / hide / update trigger can have a delay.

**Triggers on a template**: Templates → a graphic → *Settings and table* → Triggers. Rules of the form
IF *live value* *is / is more than / contains / changes …* THEN *show this graphic (for N seconds) / take it off / update it /
set a field to …*. Show, hide and update fire at the moment the IF becomes true while a match is on air (checked twice a
second), never for what was already true. "Set a field" holds for as long as the IF is true. All triggers can be switched
off in Graphics control → Production.

**Choosing instead of typing in Graphics control**: in the Data panel of a loaded template, a text field offers the people
and teams of the match, a picture field lists logos, player photos and the image library, and a colour field has a colour
box plus the match colours and Transparent. Choosing a name fills the picture and colour fields that share its prefix
(`x_name` → `x_image`, `x_color`).

**Table templates (fixtures, results, standings)**: a loaded template whose variables are numbered (`_t1name1` … `_t1name12`,
`_time1` …) gets a rows editor in Graphics control: select it and press *Edit rows…*. Each row is one line with a "kind of
row" choice made from the template's `…-opacityN` variables (Heading / Fixture / Result / Off), the row's texts and its
picture; rows can be moved and cleared, and the preview follows. *Fill from matches* fills the rows from the matches in
RFP Manager for a competition and date range (date headings, times for fixtures, scores for results). "Shown =" is the
value sent for a visible row (100 for an opacity in percent, 1 for on/off). Use *Save as preset* to keep a filled table.

**Blue Slate Cricket theme**: `templates/blue-slate-cricket` is a ready-made cricket theme (score bug, lower thirds,
full screens) in blue, charcoal and white. Copy the folder into the CasparCG template folder, load it as a theme under
Templates, and set it on a competition; the normal cricket buttons then play it. Colours are at the top of `theme.css`.

**Fill and key on a Raspberry Pi**: a Pi 4 or Pi 5 with both HDMI outputs into a vision mixer gives the program
graphics as fill (HDMI 0) and key (HDMI 1). Copy `tools/pi-output.sh` to the Pi and run

    ./pi-output.sh http://pc-name:8090            # try it
    ./pi-output.sh install http://pc-name:8090    # start with the Pi from now on

It opens `/fill-key`: one 3840×1080 page, fill on the left and key on the right, drawn in the same frame. The key is
white where a graphic is solid, black where there is none and grey where it is see-through (soft edges, shadows).
The fill is over black, so set the mixer's key to **pre-multiplied**. Options: `RATE=50` (default) or `RATE=60`,
`SWAP=1` (key on HDMI 0), `CH=pvw`, and a second word `two` (two separate windows), `key` or `fill` (one screen).
The Pi must use X11 (raspi-config → Advanced Options → Wayland → X11). Page options: `output.html?mode=key | fillkey`,
`&swap=1`, `&invert=1`. Each graphic is drawn twice in fill + key, so heavy animated templates need a Pi 5.


## 6. Files

```
server.js            start here (console banner, keys)
lib/app.js           configuration, database, services
lib/store-sqlite.js  local database          lib/store-mongo.js   online database + image storage
lib/blobs.js         per-machine image folder
lib/auth.js          Google sign-in, passwords, sessions, machine keys
lib/api.js           HTTP API                lib/hub.js           WebSocket for the management app
lib/live.js          live match sessions, scorer/control/monitor WebSocket, rundown monitor API
lib/gfx.js           graphics catalog, CasparCG playout, adverts and playlists, play log, button actions
lib/devices.js       vMix, ATEM, HyperDeck, OBS, Companion, OSC, Art-Net, MIDI, X-keys, Pi GPIO; input mappings
lib/actor.js         who did it (screen, person, address) for the play log
lib/automation.js    custom variables and game triggers
lib/timeline.js      Timeline: cues, holds, GO, crew screens, comments, rundown import
lib/templates.js     reads the template folder and each template's variable fields
lib/worship.js       worship control (outputs, stage display, CCLI log)   lib/bible.js   Bibles on this PC
lib/sync.js          PC <-> website sync     lib/domain.js        match names, automatic productions
lib/amcp.js          CasparCG client         lib/xml.js           XML save file
lib/stream.js        streaming channels: MediaMTX checks, live status, watch pages   lib/tarball.js  the program as .tar.gz
tools/server/install.sh   sets up a server: website + MediaMTX + Caddy   public/watch.html  the viewer page
shared/schema.js     every record type and field (forms, lists and the save file come from this)
shared/cricket.js    cricket engine (ICC)    shared/sports.js     rules for every other sport
shared/scoring.js    results, log tables and player statistics across sports
shared/worship.js    lyrics to slides, song file import, Bible references
public/              the management app      public/live/         scorers, control, monitors, outputs
public/live/js/padkit.js   scorer button editor (✎ BUTTONS), More… popup and macros
public/live/js/actions.js  the action list editor (scorer buttons, macros, Timeline cues)
lib/hw.js / tools/rfp-hw.ps1  MIDI and X-keys on this PC     public/live/bridge.html  hardware bridge (other computers)   public/js/connections.js  Settings → Connections
public/live/dash.html      dashboards (design and use)        public/js/automation-pages.js  Variables & triggers
tools/launcher/      RFP Manager.exe (tray app)          tools/build-exe.ps1  builds it ("Build RFP Manager app.cmd")
public/live/timeline.html  Timeline editor and crew view      tools/pi-gpio.py   Raspberry Pi GPO / GPI service
templates/rfp/       CasparCG templates      tests/               npm test
```

To add a field, add it to `shared/schema.js`. To add a graphic, add an entry to `createCatalog` in `lib/gfx.js`.
To change a sport's rules or add a variant, edit its entry in `shared/sports.js`.

## 7. Tests

`npm test` runs 54 tests: the cricket engine (ICC conditions, DLS, super over, two-innings matches), the rules
and statistics of every other sport, worship control (slides, outputs, CCLI log, song and Bible file formats),
the short screen links, the live scorer and graphics control over the WebSocket against a stand-in CasparCG
server, the rundown monitor, accounts and roles, the image folder, Google token checks (against a locally
generated key), XML export and import, sync between an online instance and production PCs, scorer buttons and
macros per theme, advert options and the play log, vMix, ATEM, HyperDeck, Raspberry Pi GPIO, OBS, Companion, OSC, Art-Net, MIDI and X-keys (the Windows helper's line protocol, and Linux device files) against small stand-ins, input mappings, the Companion addresses, who took each graphic, the Timeline (cues, holds, GO,
crew screens, comments, rundown import), custom variables, game triggers (adverts on tries), dashboards, text of several lines (JSON, XML and `{nl}`), linking a PC by signing in on the website or with Google on the PC (a stand-in Google key), and remote access through the website (live pages, WebSocket, settings, adverts, screen keys, team checks, a forged identity, the PC going offline), the bridge PC (records read-only on the PC, no scoring through the website, working offline and catching up afterwards), streaming channels (stream keys, who may publish and watch, viewer tokens, passwords, live status against a stand-in MediaMTX) and the server setup command (bundle, settings, who may make it).

Not covered by the tests, so check these on your own setup first: a real CasparCG server, real vMix, ATEM,
HyperDeck, OBS, Companion, lighting desks and X-keys / MIDI hardware (built from their published protocols, tested only
against stand-ins; the Windows MIDI / X-keys helper and RFP Manager.exe (with its WebView2 windows) could not be built or run on the build machine; the X-keys key numbering and
backlight commands vary by model), a real relay board on a Pi
(pi-gpio.py was tried in its --mock mode only), a real MediaMTX server and tools/server/install.sh on a real VM (written to MediaMTX's documented settings; not run here), a real MongoDB Atlas
cluster (the tests use an in-memory stand-in for the driver), a real Google client ID, Windows (the tests
ran on Linux), the King James download (the address could not be reached from the build machine), and real
SongSelect and publisher Bible files (the importers were tested with files written to the published formats).

## 8. Notes

- Image addresses (`/media/<id>`) are unguessable but need no sign-in, so templates and outputs can load them.
  Do not upload anything confidential as an image.
- Score a match from one place. Several scorer screens on the same instance work together, but if the website
  and a PC both score the same match while apart, the newest save replaces the other.
- Two machines' clocks decide which edit is newer. Keep Windows time sync on.
- The federation rules are built from the published laws. Check the playing conditions of your own competition
  (bonus points, card times, tie-break format) in the scorer's set-up before the first match.
- Back up: `data/rfpmanager.db` on each PC, and Atlas for the website. The XML export is a readable copy.
