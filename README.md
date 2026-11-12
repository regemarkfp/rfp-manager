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

### 1.2.7

- **File previews in File Sharing**: photos and video stills show in the list and the tiles (with ffmpeg on the server for every format; without it photos still show, and mp4 / webm / mov stills come from the browser), text files show their first lines in the tiles, with the file type in a small corner label. (Before, the previews never loaded.)

### 1.2.6

- **File Sharing in the RegemarkFP slant**: the upload panel, the + button, fields, tags, the progress (a slanted bar with the percentage instead of a ring), Previous transfers and the removal notice all have the slanted edges of the rest of the site.

### 1.2.5

- **File Sharing looks like WeTransfer**: on the left the upload panel – a big **+** for files or a whole folder (or drop them anywhere on the page), the folder they go to (and a new sub-folder if you like), **tag people**, a message, **Upload**, with a progress ring and "Upload complete". On the right your folders and **Previous transfers** (what you sent and what was sent to you, with the message and who was tagged; Everything / Sent by me / Sent to me). Inside a folder the panel uploads to that folder and the file explorer is on the right (Transfers lists that folder's).
- **Tagging:** the folder's invited people and the team's Producers and Admins can be tagged. When the upload is complete each tagged person gets an email (files, message, a link straight to them) and a notification in the app and their browser (setting "Files are sent to you in a shared folder"), and the uploader gets a receipt by email. Files sent this way are not in the 10-minute summary email as well.

### 1.2.4

- **Manage shared folders from the Studio** (Media & music → File sharing, e.g. admin.regemarkfp.com/app#/sharing): **+ New folder** (name, production, removal date), **Edit** (rename, link to another production or none, change the removal date) and **Delete** on every folder.
- **Removal dates:** a folder can be removed from the server on a set day (1 week, 1 month, 3 months, 1 year, or any date; empty = never). Three days before, the invited people get one email to download what they need; the folder shows the date at the top for everyone. On the day it is removed for everyone. Deleted and expired folders, and each folder's bin, are kept aside on the NAS for 30 days and then deleted for good (`sharingKeepDays` in config to change it). The managers set the date in the Studio or in the folder's People panel on the Sharing site.

### 1.2.3

- **Media & music → File sharing** (Studio, Producers and Admins): everyone invited to the team's shared folders on one page – each person with their folders and their role in each (change it right there), joined or not, last seen. Send an invitation again (↻), take someone out of one folder or out of everything, add them to more folders, or **+ Invite people** to several folders at once. Search, filter by folder or by joined / not opened yet, and tick people to change their role, add them to folders or remove them in one go. Below: the folders with their production, how many people, last activity, Invite and Open.
- **The Sharing site's header** now says **File Sharing**, with the folder's production next to it (smaller, not bold) when the folder belongs to one.

### 1.2.2

- **sharing.<website> opens Sharing by itself**: any address starting with `sharing.` is the Sharing site, even before `SHARING_URL` / `sharingUrl` is set (set it anyway: invite emails and the Studio's Shared folder button use it).

### 1.2.1

- **Video player on phones and in the Android app**: double-tap the left or right half of the picture to go 10 seconds back or forward (each tap more straight after adds 10 seconds; live streams only go forward up to live); a single tap plays / pauses. Full screen turns the phone sideways by itself for a wide (16:9) video and back when you leave it; upright videos stay upright (the Android app does this from app build 2.0.x with this version; browsers where they allow it). YouTube videos: YouTube's own title bar, logo and "More videos" are trimmed off on phones, tablets and in the app, and a pause or the end shows our own cover instead of YouTube's suggestions.

### 1.2.0

- **Browse with search and filters** (website, `/browse` and `/videos`): the search box searches everything public – live and upcoming streams, videos, series, playlists, matches and channels (titles, series, categories, tags, teams, competitions, venues, sports) – not only what the home page shows. Filter by kind (with counts), channel, category, sport, time (today, this week, month, year), free or paid; sort by best match, newest, oldest or A–Z; "Show more" pages through long lists. The address keeps the filters, so a filtered page can be shared. A channel's Videos tab has its own search, category, series and order.
- **Filters and bulk editing in the Studio** for every list (clubs, teams, players, venues, competitions, productions, crew, equipment, clients, products, adverts, music, songs, VOD …): filters for the choice fields that tell records apart (sport, status, type, category, club …), a date range, archived; click a column heading to sort. Tick records (or Select all) to **change a field** on all of them (lists can be added to or removed from), **archive**, **export as CSV** or **delete**. Fixtures & Results has search, sport / competition / venue filters and **Select** (tick single matches or a whole day). Images can be searched and deleted in bulk. (Quotes & invoices and Content already had theirs.)
- **Universe → Updates** (the superuser page, now at **universe.regemarkfp.com**; analytics.regemarkfp.com still works): the running version and GitHub's, what is new (from this README), **Check for updates**, **Install now** (or Reinstall), **install once** at a date and time, and **automatic updates** every day / weekdays / one day a week at a time you choose (or off). The website itself checks GitHub every hour, 6 hours, day or never, and emails the superusers once when a new version is out. The update log is on the page. Installing goes through the server's updater (rfp-autoupdate), so it finishes while the website restarts and puts the old version back if the new one does not start. The first time: run `sudo rfp-autoupdate` once on the server after this version is installed (it adds the small helper the page uses).

### 1.1.0

- **Sharing: shared folders on the NAS** at **sharing.regemarkfp.com** (or `/sharing` on the website). A folder per production or event that you invite people into: crew, clients, editors, agencies.
  - **Who manages:** Producers and Admins of the team. They make folders (Sharing → + New folder) and invite people. A production's folder is made the first time someone presses **Shared folder** on the production (next to Call sheet); on a production PC that button opens the website's folder. The Studio menu has **Productions → Shared folders**.
  - **Invites by email** as **Viewer** (see, preview, download, comment) or **Editor** (also upload, make folders, rename, move, delete). The email has an *Open the folder* link: they sign in with Google, or make a password the first time. If email is not set up, the People panel shows each person's link to send yourself. Removing someone stops their access and their link at once.
  - **Big uploads that carry on:** files and whole folders (button or drag and drop), two at a time, in 32 MB pieces (under Cloudflare's 100 MB limit). After a dropped connection it carries on by itself; after closing the tab, drop the same file again and it continues where it was. The same name twice keeps both (`A001 (2).mov`).
  - **Previews in the browser:** photos, PDFs, text, audio and video. Camera files the browser cannot play (ProRes, MXF, HEVC, AVCHD …) get a 720p preview made by ffmpeg the first time they are opened; thumbnails for video and photos. Without ffmpeg those files are download-only.
  - **Download as ZIP:** the whole folder, a sub-folder or a selection as one ZIP, written as it downloads (no waiting, no size limit; ZIP64 past 4 GB). Single files download with resume (byte ranges).
  - **Comments and activity:** comments on any file, with the video's timecode (click it to jump there); an activity list (uploads, moves, deletes, comments, invites); a summary email to the invited people at most every 10 minutes when new files or comments arrive (each person can turn it off).
  - Deleted files go to the folder's bin on the NAS (`<folder>/.rfp/bin/<date>`); a deleted shared folder is moved to `<sharing folder>/.deleted/`. Clear those by hand when you are sure.
  - **Set-up** (the website on the home server):
    1. Cloudflare → Zero Trust → Networks → Tunnels → your tunnel → **Public hostname**: `sharing.regemarkfp.com` → `http://localhost:8080` (the same service as the website).
    2. In `config.json` (or the environment): `"sharingUrl": "https://sharing.regemarkfp.com"` (`SHARING_URL`). The files go to `"sharingDir"` (`SHARING_DIR`, e.g. `/srv/nas/sharing`); without it, `<NAS folder>/sharing`, next to the media folder, or `data/sharing`.
    3. Google sign-in on the subdomain: add `https://sharing.regemarkfp.com` to the client's **Authorised JavaScript origins** (Google Cloud → Clients).
    4. Optional, for previews and thumbnails: `sudo apt install ffmpeg` (or `"ffmpeg": "/path/to/ffmpeg"` in config).

### 1.0.21

- **E-Sports: Rocket League.** A sport of its own (category E-Sports; production type E-Sports): fixtures, competitions, teams and players, and a hand scorer (goals, shots, assists, saves, epic saves, demolitions; 5 minutes, then golden-goal overtime; 3v3, 2v2, 1v1) for when the game feed is not there.
- **Rocket League graphics on CasparCG** (production PC, Live & graphics → Rocket League, or `/rl/control`). The RL Broadcast controller, now inside RFP Manager:
  - Game data from the **SOS plugin** (BakkesMod, `ws://localhost:49122`), Psyonix's **official Stats API** (`TAStatsAPI.ini` / `DefaultStatsAPI.ini`: `PacketSendRate=30`, `WebPort=49125` – 49124 is taken by the RocketLink voice-chat plugin; or its TCP port `tcp://localhost:49123`), or a **relay** on another PC (any `ws://` address; SOS and official messages are both understood).
  - The graphics are CasparCG templates (`templates/rfp/rocket/overlay.html`), **one layer per graphic** from layer 40: scorebug, boost bars and event icons, player card and boost meter, minimap, goal stinger / GO / overtime / winner, replay transitions, post-game scoreboard. The switches take them in and out (CG PLAY / STOP); each layer reads the fast data (boost, clock, car positions) from `/rl/ws` itself. Copy `templates/rfp` (with `rocket`) into CasparCG's template folder.
  - The same pages still work in OBS: `/rl/overlay`, `/rl/postgame`, `/rl/stats` (add `?part=scorebug,boost` for some of them only).
  - **From the match on air** fills the teams (names, tags, colours, logos) from the Rocket League fixture in Graphics control. Series wins count by themselves when a game ends.
  - Live values `{rl_…}` (score, clock, seconds, overtime, replay, spectated player and their boost, last goal …) for graphics triggers, dashboards and templates.
- **Game triggers for Rocket League and at set times**: goal, assist, shot, save, epic save, demolition, aerial goal, hat trick, kick-off, goal replay start / end, overtime, game start / end, series point; **Game clock reaches** (At `1:00`, `+1:00` in overtime) and **Time of day** (At `19:30`, any sport). New action **Rocket League graphic**: take one in or out, transition, GO, overtime, winner, post-game, series ±1.
- **Variables by sport** (Live & graphics → Variables by sport): every value for every sport, grouped, with search and Copy as `{key}`, `key` or `data-f="key"`. New: every statistic **by name** (`stat_shots_on_target_a`, `stat_saves_b` …), leaders by name (`leader_top_scorer_name`), and **every player's statistics by shirt number** (`playerA9_goals`, `playerB4_save`, `playerA9_line`), next to the numbered ones (`stat1_label` …). A section for the Rocket League game's live values.

### 1.0.20

- **YouTube Live** (Streaming → YouTube Live): connect the team's YouTube channel once (an Admin, with Google), then schedule broadcasts: title, start, description, who can watch. For a production that streams through this website a YouTube restream destination is added to it, so the stream goes to YouTube while it is live and YouTube starts and ends the broadcast by itself; without a production the server and stream key are shown for vMix / OBS. Change, see the key or cancel each one. Set up once by a site admin: Settings → Server → YouTube Live (the Google client secret).
- Public site menus: headings (Subscriptions, Client portals) in the accent colour.
- **Watch pages**: the player is as large as fits the screen and never taller, with the chat (live streams) or comments (videos) on the right and the title and description underneath. On a phone everything stacks.
- **Comments on videos** (/v): anyone who may watch reads them, signed in to write; the writer and the team can remove them.
- **YouTube videos show their length** instead of 0:00: read from YouTube when added (with or without the YouTube API key), and filled in for videos added before.
- **Signing in keeps you where you were**: on the public website, signing in (also as a production team member) leaves you on the same page; only "Sign in as production team" / "Production teams: sign in" goes on to the Studio.
- **Account menu on phones**: client portal links are listed one under the other, so the menu fits the screen (it ran off the left edge).
- **YouTube captions stay off** when Subtitles is Off (YouTube switched them on by itself from the viewer's YouTube settings or the video's owner).
- **Test PayFast** (Settings → Server → PayFast): the server sends PayFast a signed R5.00 test form (nobody pays, nothing is saved) and shows what PayFast answers: its payment page, or its error page with the reason (signature, merchant…) and what to change. **Remove passphrase** button for when the PayFast (or sandbox) account has none.
- **Quote and invoice PDFs**: the terms and conditions always start at the top of a new page, after the page with the totals. A long line (a description with many rows) starts on the first page and carries on on the next, instead of leaving the first page empty. Terms and notes from Invoice Ninja print as plain text (no HTML), without their copy of the bank details and old terms and conditions (the billing details print those once). Wider Unit Cost column, so R110,500.00 stays on one line. Invisible characters and emoji pasted from websites are left out of PDFs instead of printing as "?", and a copy of the terms and conditions pasted into Small print is not printed a second time. The banking details print once, next to the totals (no longer again after the terms).

### 1.0.19

- **Manage many quotes and invoices at once**: tick them in **Quotes & invoices** (or tick the top box for everything shown) and a bar offers: **Email** (each to its client, with their CC accounts), **Mark as…** a status, **Mark paid** (adds a payment of what is still owed, with the date and how), **To invoices** (quotes), **Copy** (new drafts with new numbers), **PDFs (ZIP)** (all their PDFs in one file), **Spreadsheet** (CSV for Excel or your bookkeeper) and **Delete**. What cannot be done to one (an invoice with payments cannot be deleted, a draft cannot be marked paid) is listed; the rest goes ahead.

### 1.0.18

- **CC accounts for clients**: on a client, **CC accounts** (one address per line) and a **CC** tick on contact people. Every quote and invoice emailed to the client also goes to them: the same email with the PDF, marked as a copy, and a client-portal link of their own (to see, sign or pay). The Email box shows the CC list and you can change it for that one email; the document keeps who got copies.

### 1.0.17

- **RFP Manager for Linux**: x64 PCs and 64-bit ARM (Raspberry Pi 4 / 5), with Node.js included, an installer for your user, an applications-menu entry with the screens, a background service that restarts after updates, and its own window. Built by GitHub ("Linux app" workflow) as the release **linux-latest**. See "The app on Linux" below.
- The Windows download no longer includes stray Android signing files that had landed in the repository's top folder.

### 1.0.16

- **Content holds it all**: Live streams, VOD and Playlists are tabs of Content (Library · Live streams · VOD · Playlists · Website); the Streaming menu has just Content.
- **Smaller files on the server**: when uploading VOD, choose the size – Standard (up to 1080p), Small (720p, about a third) or Smallest (480p).
- **Your own YouTube videos as files**: on a YouTube item, "Use own file" uploads the video (downloaded from YouTube Studio) into the same item. Title, playlists, series and subtitles stay; YouTube plays until the file is ready, then the website plays it from your server in your player – no YouTube player, adverts or logo.

### 1.0.15

- **VOD kept stopping on the website**: the video, series and playlist pages were redrawn every 30 seconds (the front page's "what is live" refresh), which stopped the player. They are left alone now.
- **Subtitles**: upload .srt or .vtt files per language for any VOD, uploaded or YouTube (VOD → CC, or CC in Content), and mark one as the default. In the player, **CC** turns them on and picks the language; the viewer also sets the text size, colour, background and position, kept in their browser with their language for next time. YouTube videos can also show YouTube's own captions.

### 1.0.14

- **Content tab** at the bottom of the Android app (Producers and Admins).
- **Icons everywhere**: every link in the side menu (website and production PC), the Android app's More list, and the public website's menu use the app's icons. The narrow side menu («) now shows the icons instead of hiding the menu.
- YouTube in our player: plays through youtube.com (youtube-nocookie.com is blocked by many ad blockers and filtering DNS); when YouTube cannot load at all it says so, with a "Watch it on YouTube" link. The channel logo under a video is the right size again.

### 1.0.13

- **Content** (Streaming → Content), the CMS: one library of everything your channels show – VOD, YouTube videos, series, playlists and live streams – with search, filters (type, channel, category, tag, who sees it), categories and tags, and changing many at once (who sees it, category, tags, publish date, add to a playlist, delete).
  - **Website** tab: what the front page (site admins) and each channel's Home tab show – a featured item at the top (or the live stream automatically) and the rows in your order: automatic rows (live, coming up, latest videos, series, playlists, matches …), a playlist, a series or a category, each with its own heading. "Back to the automatic page" undoes it.
- **Playlists** (Streaming → Playlists): VOD, YouTube videos and live streams in your order (drag them). On the website `/p/<playlist>` plays them one after the other in our player with the list beside it; a live stream plays live while on air, shows when it starts before that, and plays its recording afterwards. Paid items show how to get a ticket and move on.
- **YouTube**: paste links (videos, Shorts, live videos, playlists) under Content, VOD or Playlists. They play in **our player** (the live streams' bar, in the channel's colour; YouTube's controls hidden – YouTube may still play its own adverts). Single videos need no key; for whole playlists (and video lengths) an Admin adds a free YouTube Data API key (Content → YouTube key; kept on the server only). A playlist from YouTube can be synced again.
- Uploads are called **VOD** in the app (Streaming → VOD), and the video page on the website uses the same player as live streams.

### 1.0.12

- **Videos on demand and series** (Streaming → Videos & series, on the website):
  - **Upload** films, highlights, interviews or whole shows: press Upload or drop files on the page, several at once. Big files are fine – they go up in 8 MB pieces (past Cloudflare's 100 MB limit) and carry on after a dropped connection. Keep the tab open; other screens are fine.
  - The server keeps them on the NAS (`<NAS>/vod`, or `VOD_DIR`) and, with ffmpeg (installed by the server setup), makes a web copy that starts at once and seeks (H.264 / AAC MP4), a poster frame and the length. Without ffmpeg MP4 / WebM play as uploaded.
  - **Series** with seasons and episodes: name the seasons, upload episodes straight into a season (numbered for you), mark a trailer or first episode free.
  - **Who sees it**: Public, Unlisted (link only) or Hidden (only your team), a "publish on" date, and the channel's own rules (team members / password).
  - **Selling** as with live streams (PayFast): a price on a video, a price for the whole series, or the channel pass covers it. Tickets are emailed and kept in the browser; sales show in Ticket sales. Your production team always watches free.
  - **Viewers** get `/v/<video>` and `/s/<series>` pages: the player carries on where they stopped, "Next episode in 5…" at the end, season tabs with what they have watched, and Series and Videos on the channel and home pages. Plays are counted (once per viewer and hour).

### 1.0.11

- Tests tidied: the paid-streams test uses dates relative to today (fixed dates went stale once the day passed), and the old browser output (`/output.html`, `lib/graphics.js`) and its test are removed. The browser output is `/output` (fill, `/key`, `/fill-key`), tested in `tests/live.test.js`.

### 1.0.10

- **Long screens are split into sub-tabs**: a form with several groups (Match, When & where, People, Match settings …) shows them as a row of chips at the top, one group at a time, with **All** for everything; a red dot marks a group with a required field still empty. A page that stacks three or more titled sections (Settings → Website, and the like) gets the same row, sticky while you scroll. Live tools (scorer, graphics control, rundown, call sheet, dashboard) are left as they are.
- **Match setup only shows what the sport uses**: periods, lengths and extra time for the timed sports; golden point and the 20-minute red for rugby; sin bin for rugby, hockey and netball; shoot-out / kicking competition for rugby, hockey and football; line-up and bench for team sports. The Format list only offers the chosen sport's formats.
- **Scoring follows the federations**:
  - Team sports no longer show "X LEAD BY Y" while live (that is a cricket line); graphics show the period instead, and "X WIN" / "DRAW" at the end. Tennis and padel show who serves (or set / match / break point) instead of "LEAD 1-0 IN SETS".
  - Padel: the FIP / Premier Padel **star point** (2026) is the default: two advantage rounds, then one deciding point. Golden point and advantage are still there.
  - Badminton: **BWF 3 × 15** (from 4 January 2027): win by two from 14-14, 21 caps it, interval at 8.
  - Basketball: the bonus now starts after 4 team fouls in a quarter (FIBA, NBA) and after 6 in 3x3, as the rules say.
  - Rugby league: "Field goal" and the NRL **2-point field goal** from 40 m+.
  - Netball Fast5: 1, 2 and 3-point shots.
- The old scoring test (written for an engine that no longer exists) is replaced by federation checks for every sport above.

### 1.0.9

- **Settings save by themselves**: Production team, My account (name, phone, email choices; a new password still has its own button), Website home page, Legal & company, the booking form and Billing details save a moment after you change something, with a small "✓ Saved" (or "Not saved … Try again") where the Save button was.
- The Android build on GitHub no longer fails when two builds finish close together (one build at a time; it commits on top of the newest main).

### 1.0.8

- **Android app: Google sign-in in the app** with the phone's own Google account sheet (Credential Manager), no browser round trip. Needs, once, an **Android OAuth client** in the Google Cloud project of the website's GOOGLE_CLIENT_ID: package `com.regemarkfp.rfpmanager`, SHA-1 of the release key (`keytool -list -v -keystore android/rfp-release.keystore -alias rfp`). Without it (or on an older app) the browser sign-in is used as before.
- **PDFs on a phone's browser** (quotes, invoices, contracts, releases, reports) are fetched signed in and saved as a file, instead of opening a tab that says "Sign in first".
- On a phone the side menu never opens in its narrow (collapsed) form.

### 1.0.7

- **NAS access per user** (Universe → NAS → NAS users → Access): the whole NAS read and write, the whole NAS read only, only chosen folders (each read only or read and write; every chosen folder becomes its own share, \\server\FolderName, and people only see the shares they may open), or no access. New users start with "Only folders I choose". Until access is first changed, everyone keeps the whole NAS. The rules are written by the helper to /etc/samba/rfp-nas.conf (the old [NAS] block in smb.conf is replaced by an include the first time), checked with testparm and Samba reloaded; it only accepts NAS users and folders inside the NAS.

### 1.0.6

- **Universe → NAS → NAS users**: add people to the NAS share (a user name and password that work at home and over Tailscale), change passwords, switch them off or on, remove them. The website runs a small root helper for this (tools/server/nas-users.sh, installed as /usr/local/sbin/rfp-nas-users with a sudoers rule for that one command). Once, on the server: `curl -fsSL https://raw.githubusercontent.com/regemarkfp/rfp-manager/main/tools/server/github-update.sh | sudo bash -s -- --install --force`. From then on rfp-autoupdate also updates itself.
- **Universe → Files**: browse the NAS folder, open or download files (video and audio can be scrubbed), upload (button or drag and drop; up to 100 MB per file through Cloudflare), new folder, rename, delete. Never outside the NAS folder.
- Auto refresh waits while you are typing.

### 1.0.5

- **Universe page**: a **NAS** tab (free and used space, the RAID 1 mirror from /proc/mdstat: healthy or degraded, which disks, a rebuild in progress; and which folders take the room, measured at most every 15 minutes). The folder is NAS_DIR, else two levels up from MEDIA_DIR (…/assets/images), else /srv/nas. Production companies show their logos. The page refreshes itself every 30 seconds (untick "Auto refresh" to stop it).

### 1.0.4

- **WhatsApp stays WhatsApp**: a WhatsApp message only goes into a booking when the client replies to (quotes) a message sent from the app. Everything else people send on WhatsApp is not copied. WhatsApp replies give a notification, not an email (answers on the tracking page still email the Admins).

### 1.0.3

- **Select several** clubs, teams or players (tick boxes, Select all): delete, archive or unarchive, change a field for all of them (sport, age group, club, position …), and add players to a team.
- **Deleting a club deletes its teams** too (the players stay in the players database); the confirmation says how many.

### 1.0.2

- **Legal pages** on the website, linked at the bottom of every page with the copyright line (© year, registered name, all rights reserved): **Company information** (/legal: registered name, registration and VAT numbers, directors, address for legal notices, contact, information officer, prices and payment, complaints: what ECTA section 43 asks of a business selling online), **Terms and conditions** (/terms: the booking team's Billing details unless typed separately) and **Privacy policy** (/privacy: a standard POPIA policy with your details, or your own). Settings → Website → Legal & company. The copyright line also shows in the Studio and on the Universe page.

### 1.0.1

- **Release forms** (Productions → Release forms): one link per form (copy, WhatsApp, email). People sign on their phone with a finger or a picture of their signature; a parent or legal guardian signs for a child under 18. They give permission for the final production and choose whether raw footage in which they can be identified, and promotion, are allowed. Each signed release keeps its wording, choices, signature, time and a fingerprint; the signer gets a PDF copy; Producers and Admins see who signed, the PDF, and can mark one withdrawn (POPIA). Signed releases stay on the website and are not synced to production PCs.
- **Point out when signing** (Billing details): a second tick box in the quote signing popup for the clauses that must be drawn to the client's attention (cancellation fees, liability); the contract PDF records it.

### 1.0.0

- **Menu** grouped by what you do: Clients & sales, Productions, Sport, Live & graphics, Streaming, Adverts & sponsors, Media & music, Worship.
- **Dashboard analytics** for Admins only. **Producers** get the crew notifications (crew booked on a production, crew answers) but do not write to clients: client messages go to the Admins, who reply.
- **Client portal accounts**: a new client with an email gets a welcome email with their portal link. On the portal they sign in with Google or create a password, then keep their details (name, accounts email, phone, VAT and registration numbers, address) up to date; quotes and invoices show them. Signed in on the website, the account menu lists their portals.
- **Superuser page (Universe)** at universe.<your website> (or analytics.<your website>, or /super): the website's health (version, uptime, database, memory, load, disk, email, payments, WhatsApp, push, live streams, PCs online) and every production company with its users per role and its numbers. Sign in with a superuser email (`superUsers` in config.json or `SUPER_USERS`; info@regemarkfp.com by default) and a password set from the emailed **Set or reset password** link. Only Admins who accepted the **Admin terms** (asked once in the Studio) are named, with a CSV of those who did not opt out of marketing email (Settings → My account). Add the public hostname universe.<your website> → http://localhost:8080 to the Cloudflare tunnel.

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

### The app on Linux (Ubuntu, Debian, Mint, Fedora, Raspberry Pi OS 64-bit …)

Download **RFPManager-Linux-x64.tar.gz** (PCs) or **RFPManager-Linux-arm64.tar.gz** (Raspberry Pi 4 / 5 and other 64-bit
ARM) from the release **linux-latest** on GitHub (built by the "Linux app" workflow whenever main changes). Node.js is
included. Then:

```
tar -xzf RFPManager-Linux-x64.tar.gz
cd rfp-manager
./install.sh              # or ./install.sh --autostart to start it when you log in
```

It installs for your user only (no sudo): the program in `~/.local/share/rfp-manager`, **RFP Manager** in the
applications menu (right-click it for Graphics control, Scorer, Timeline, Console and Stop), the `rfp-manager` command,
and a systemd user service that keeps it running and starts it again after an update. RFP Manager opens in its own
window (Chrome, Chromium, Edge or Brave in app mode, with its own profile; otherwise your web browser). Commands:
`rfp-manager` (open), `rfp-manager --screen /live/control.html`, `rfp-manager --console` (in a terminal, with the
console keys), `rfp-manager --status`, `rfp-manager --stop`. To try it without installing, run `./rfp-manager` in the
unpacked folder. Updating: unpack the new download and run `./install.sh` again (config.json and data are kept); it also
updates itself from the website it is linked to. Remove it with `~/.local/share/rfp-manager/uninstall.sh`
(`--everything` also removes its settings and data). MIDI and X-keys need access to `/dev/snd` and `/dev/hidraw*`
(the `audio` group and a udev rule).

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
  no graphics). **Live & graphics → Production PCs** (or "+ Link a production PC…" in that list) shows which PCs are online.
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

### The public website (front page)

On the website, `/` is the public front page, laid out like a video site. It shows what is **live now** at the
top, then streams **coming up**, **videos** (recordings, newest first), **fixtures** and **results**, and the
**channels**. Viewers can search, open a channel at `/c/<channel>`, watch at `/watch/<stream>`, and sign in with
Google to **subscribe**. Subscribers get an email when a channel goes live (needs email set up), and their
channels are under **Subscriptions**.

Everything else (the app for production teams) is at **`/app`**; the front page has a *Studio* button for
members. Old links to `/#/…` still work and lead to `/app`. Matches are on the front page only for teams that tick
*Show our matches on the public website* (Settings → Production team). Only **Public** channels are shown.

### Live streaming: channels and streams (SRT / RTMP in, watch pages and videos out)

Streaming → Live streams is where streams are run and set up: **+ New stream** makes one on a new production (pick a match and it fills in the name, date and time) or on an existing one, then shows the stream key for OBS / vMix. The tabs show what is live, coming up, ended and everything; each stream has Settings, Stream key, Master control and End stream. The stream settings live on the production, so a change in either place shows in both.

The website can run its own streaming server, so you do not need YouTube or Facebook.

* A **channel** (Streaming → Channels) is a branded page: the production company's, or a club's, a team's or a
  production's own (*Channel of*). It has its own logo, banner, colour and description; a club or team channel
  takes the club's logo and colour unless you set them. Who can watch is set per channel: **Public**, **Team
  members** (signed in) or **Password**.
* **Stream keys belong to productions.** On a production, pick the channel under *Live stream on channel* and
  save: the production gets its own stream key and watch page `https://<site>/watch/<stream>` (WebRTC, under a
  second of delay; HLS on iPhones). The production page shows what to type into OBS / vMix, whether it is live,
  how many watch and the bitrate coming in. **New stream key** stops the old key straight away.
* **Videos:** streams are recorded (unless *Record the stream* is off) and appear as videos on the channel, the
  front page and the watch page (*Show the recording on the website afterwards*). Recordings are kept 90 days
  (change with `--keep-days` on the server setup command; 0 keeps them).

Send from OBS, vMix, Wirecast, an encoder or Larix on a phone. The production page shows exactly what to type and
has Copy buttons:

* **RTMP**: server `rtmp://<site>/live`, stream key `<stream>?user=publish&pass=<key>`.
* **SRT** (better on poor internet): host `<site>`, port 8890, stream ID `publish:live/<stream>:publish:<key>`
  (or the full `srt://…` URL in OBS).

**Switched off** on a channel hides it and blocks streaming and watching.

**Who can watch one stream, and for how long.** On the production, under Live stream: *Who can watch this stream* is
empty (as the channel), **Public** (anyone, listed on the website and the channel), **Unlisted** (anyone with the
watch link, not listed anywhere) or **Private** (only your production team, signed in). *Public for (days after the
stream)* closes the recording to viewers that many days after the stream ended (End stream, or its last recording);
after that only the production team can watch it and it leaves the website's lists. A channel's *Streams public for*
is the default for its streams; a stream's own number wins; empty means always.

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

To update the server later, make a new setup command and run it again. The settings, stream keys and recordings stay. Logs:
`journalctl -u rfp-manager -f` and `journalctl -u mediamtx -f`. Bandwidth: one 4 Mb/s stream uses about 1.8 GB
an hour for each viewer (Oracle includes 10 TB a month).

### A home server instead of a VM (Cloudflare Tunnel + Tailscale, no monthly cost)

The same server can run at home on a Raspberry Pi 3, 4 or 5 (64-bit Raspberry Pi OS Lite) or any Debian /
Ubuntu box. Nothing is opened on the router, so it also works behind CGNAT:

* **Cloudflare Tunnel** (free) carries the website and the Studio on your own names (regemarkfp.com,
  admin.regemarkfp.com), with https. The domain's DNS has to be on Cloudflare (free plan).
* **Tailscale** (free) carries SRT / RTMP from your own encoders, OBS and production PCs to the Pi. Cloudflare
  does not carry SRT, RTMP or WebRTC, so viewers watch HLS through the tunnel. For big audiences restream to
  YouTube / Facebook.
* A Pi 3 relays and records streams fine but cannot re-encode live (master control burn-in, restreams with
  graphics): do that on the production PC, or use a Pi 4 / 5. Keep the recordings on a USB drive.

Steps:

1. **The Pi.** Raspberry Pi Imager → *Raspberry Pi OS Lite (64-bit)*. In its settings set a host name
   (`rfp-server`), a user and password, and switch SSH on. Use a network cable if you can. Then `ssh <user>@rfp-server.local`.
2. **The USB drive** (optional, for recordings), mounted at `/mnt/usb`:
   `lsblk` (find it, e.g. `sda1`) → `sudo mkdir -p /mnt/usb` → add
   `UUID=<uuid from "sudo blkid"> /mnt/usb ext4 defaults,nofail 0 2` to `/etc/fstab` → `sudo mount -a`.
   An empty drive is formatted first with `sudo mkfs.ext4 /dev/sda1`, which wipes it.
3. **Tailscale.** `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up`, and open the link
   it prints to sign in.
4. **Cloudflare.**
   1. Add the site (free plan). Check that every DNS record it imports is there, mail (MX, TXT) included.
   2. At the registrar (Squarespace → Domains → DNS → nameservers), switch to Cloudflare's two nameservers.
      Wait until Cloudflare shows the site as *Active*.
   3. Zero Trust → Networks → Tunnels → **Create a tunnel** (Cloudflared), named e.g. `rfp-pi`. Copy the
      token: the long text after `--token` in the command it shows.
   4. Under the tunnel's *Public hostnames*, add `regemarkfp.com`, `www.regemarkfp.com` and `admin.regemarkfp.com`,
      each as **HTTP** → `localhost:8080`. First delete any old A records for those names that point at the old server.
5. **RFP Manager.** On a website that is still running (e.g. the Render one): Settings → Server → **Make the
   setup command**. On the Pi, run that command with these added at the end:
   `--domain regemarkfp.com --admin-domain admin.regemarkfp.com --tunnel <the Cloudflare token> --recordings /mnt/usb/recordings`.
   Paste the token yourself; it stays on the Pi.
6. **Old recordings** (optional), from the Pi:
   `sudo rsync -av root@<old-server-ip>:/var/lib/mediamtx/recordings/ /mnt/usb/recordings/`.
   The database, stream keys and Google sign-in are in MongoDB Atlas, so nothing else moves. Then switch the old
   VM off.

Encoders on the tailnet send to the address the installer prints: `rtmp://<pi>.<tailnet>.ts.net/live` and
`srt://<pi>.<tailnet>.ts.net:8890`. Updates install by themselves: every night at 04:30 the server asks the website it came from (Render) for a newer version and installs it, using its own update key (`--no-auto-update` turns this off; `sudo rfp-autoupdate` updates now). By hand: make a new setup command and run it again.

**Updating from GitHub (free, no Render needed).** Run once on the server:
`curl -fsSL https://raw.githubusercontent.com/regemarkfp/rfp-manager/main/tools/server/github-update.sh | sudo bash -s -- --install`.
It installs the newest version from github.com/regemarkfp/rfp-manager now, and from then on `sudo rfp-autoupdate` and the
04:30 nightly check take the code straight from GitHub (a newer version in package.json on main). The old copy is kept as
`/opt/rfp-manager.old` and put back if the new one does not start; settings, the database, recordings and the NAS are not
touched, and `/etc/rfp-manager/stream-host` is applied. A later setup command keeps the GitHub updater. It stays a
home server, and the flags are not needed again. Logs: `journalctl -u rfp-manager -f`, `journalctl -u cloudflared -f`.

#### An old PC as server, database and NAS

A spare PC (e.g. an Intel Core i5 2nd generation or newer, 8–16 GB, an SSD) with **Ubuntu Server 24.04 LTS**
can be the website, its database and the house NAS in one:

```
<setup command> --domain regemarkfp.com --admin-domain admin.regemarkfp.com --tunnel <Cloudflare token> \
  --local-db --nas /srv/nas --no-recordings
```

* `--local-db` installs MongoDB on the PC and, the first time, copies everything from the database the website
  used (Atlas). From then on the database lives on the PC and is backed up every night at 03:15 to
  `NAS/backups` (14 days kept). Render and Atlas are not updated any more; copy a backup somewhere off the PC now
  and then (OneDrive, Google Drive, a USB drive).
* `--nas /srv/nas` makes the Samba share `\\<pc-name>\NAS` for the house network and Tailscale, with
  `assets/images` (every image in RFP Manager as a file, kept up to date), `templates` (point the production PC's
  template folder or CasparCG at it), `shared` and `backups`. Set your Samba password once with
  `sudo smbpasswd -a <your user>`, then map it in Windows: *This PC → Map network drive → \\<pc-name>\NAS*.
  Away from home it works the same over Tailscale.
* `--no-recordings`: streams are relayed but not recorded.
* In the BIOS, set *Restore on AC power loss → Power on*, so the PC starts again after load shedding. A small UPS
  keeps it up through short cuts.
* A 2.5 Gb network card (Realtek RTL8125 or Intel i225/i226) works with Ubuntu 24.04 out of the box.

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
| **Timelines** | Live & graphics → Timelines: a show on tracks against time, run with PLAY and GO (see Timeline below). |
| **Play log** | Adverts & sponsors → Play log: everything that went to air (graphics and adverts) with start, end, time on air, channel-layer, the text on it, **who took it** (the screen, the person and their address: "Graphics control · Ruan · 100.64.0.7", "Timeline GO", "Trigger", "Companion", "Input", "Ad playlist"), who took it off, and the **production** and match. Filter by dates, kind, production, match, person / screen, text, and pick only certain graphics or adverts; totals per sponsor and advert; **Print report** (a printable page of what the filters show, with totals) and Export CSV. |
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

### The tap scorer (rugby, hockey, football, netball, basketball)

The Score tab works like LIGR's scorer. One row per event (try, conversion, goal, cards, interchange …) with the
home team on the left and the away team on the right: tap a side and it is logged for that team, then pick the
player (on the field first, then the bench). The big number on each side is how many that team has.

- **Top bar:** History, Lineup, Match info, Undo, Moment (marks the moment for highlights), and the phase button:
  *Players entering* → *About to start* → **START FIRST HALF** → **END FIRST HALF** → **START SECOND HALF** … →
  **FULL TIME**. Starting a period starts the clock; ending one stops it. During the break the graphics read HALF TIME.
- **Clock row:** ✎ set the clock (or back to the start of the period), ▶ / ❚❚, and − / + one second.
- **On the field:** players on for each side, from the line-up, substitutions, sin bins and red cards. − / +
  corrects it by hand.
- **Lineup:** who starts, who is on the bench and who is not playing, with their number and position for this
  match. It starts from the team's squad (the *Starter* tick in Sport → Teams).
- **History:** every event, newest first. ⚑ marks a moment, ✎ changes the team, player or time, ✕ deletes it, and
  **+ Add event** logs one afterwards.
- **Match statistics** (tackles, carries, possession …) sit under the scoring rows unless the competition or match is
  set to *Stats to capture: Minimum*. *Ask for the player* (All / Scoring only / None) decides when the player list
  pops up.

### Data structure (same as LIGR)

| Record | Fields |
|---|---|
| Competition | Name, graphic name, short name, sport, format, season, age group, gender, division, colours, logo, two watermarks, theme, teams, **match settings** (periods, period and break length, overtime, golden point, kicking competition, sin bin, 20-minute red card, stats to capture, ask for the player, line-up and bench size, field-goal points), log points, archived |
| Club | Name, full graphic name, graphic name, abbreviation, home venue, primary / secondary colour and their text colours, logo, home / away / alternative kits, archived |
| Team | Club, sport, age group, gender, division, name and colours (from the club unless set), coach, players (number, player, position, position type, starter, captain), archived |
| Player | First and last name, graphic first and last name, sports, date of birth, height, weight, nationality, position, position type, photo, archived |
| Venue | Name, graphic name, address, city, country, home ground of (club), areas / fields, used for, capacity, surface, image |
| Match | Name, sport, competition, format, teams, dates and times, venue (the home club's ground if empty), status, scorer, commentators, officials, match settings (empty = from the competition) |

A match's settings win over its competition's; anything left empty uses the sport's rules. Archived records are
greyed out in the lists and left out of the pickers.

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

### Athletics: events and timing systems

**Events** are built from dropdowns on the scorer's Setup tab: gender, age group, discipline (sprints to combined events), round and heat. The name follows ("80m Hurdles Girls U16 · Heat 2"), the type (track or field) and the wind box come with the discipline. "+ Several events" makes one event for every gender and age group ticked (and every heat); "Copy as next heat" adds Heat 2, 3 …. Lanes, bibs, names and teams are picked from lists (names and teams you have used before; a known athlete brings their bib and team).

**On the day.** Graphics control → Athletics has the events as buttons (with ◀ Prev / Next ▶) and **Change events: automatically when the results are in** (straight away or after 5 s – 5 min): the next event becomes current and the graphics follow. Each lane (field events: each athlete) has a button: click for that athlete's lower third (lane, team, then PB / SB, attempts or the result), click again to take it off.

**Event numbers and the race clock.** Every event has a number (Setup: "Event no."; new events are numbered in order, FinishLynx brings its own) shown on the event buttons and as `ath_event_num`; the events list shows each event's gender and age group. The race clock shows 9.87 (hundredths) by default; choose 9 / 9.8 / 9.87 / 9.876 next to the clock on the scorer or in graphics control → Athletics (templates: `clock_digits`, or `data-digits` on a `data-clock` element).

**Field events** on the scorer: the athlete who is up is shown large; type the mark and press Enter (or X / – for a foul or a pass) and the next athlete comes up by themselves (fewest attempts first, in competition order). Rounds (3–6) and "top 8 after round 3" are set there. High jump and pole vault: choose the bar, then O / X / – per try; three failures in a row and the athlete is out, the bar goes up with +3 / +5 / +10 cm, and ties are broken on failures. "Up" makes anyone up now, ↶ removes their last attempt, "Skip ▶" moves on. Graphics: "Field: Athlete Up" and the fields `ath_up_name`, `ath_up_attempts`, `ath_up_best`, `ath_bar`, `ath_attempt_round`.

**Timing systems** connect on the scorer's **Timing** tab (athletics only, on the production PC). Add one from the list:

| Preset | In the timing system | Brings |
|---|---|---|
| FinishLynx – files | Options → Database: Input directory = a folder this PC can see, tick "Write LIF" | Start lists (lynx.evt / lynx.ppl from the meet software) and official results (.lif) |
| FinishLynx – running time | Scoreboard → New: a running-time script, Network (UDP), this PC's IP and the port | The race clock |
| FinishLynx – live results | Scoreboard → New: a results script, Network (Connect), this PC's IP and the port | Places, lanes, names, times, reaction times, wind as the race finishes |
| ALGE timer | RS-232 output (USB adapter is fine) | Starts (C0) start the race clock; net times (RT) and finishes (C1) become results by bib |
| Another system | Network (UDP / TCP), serial, or a folder of CSV / text files | Whatever your rules read |

"What comes in" shows every line received and how it was read. A line that isn't understood can be read with your own rules (What it sends → My own layout): which lines, what they are (result, start-list entry, running time, event name, wind, gun), how they split (control codes, comma, semicolon, tab, spaces) and which column is which, chosen from dropdowns while an example line shows its columns. "Try it" previews pasted lines or sends them into the meet by hand.

Events that aren't set up yet are made from the names the system sends (gender, age group and discipline are read from "Men's 100 Meter", "Girls U16 80m Hurdles"…), the race being timed becomes the current event (graphics follow), and the race clock runs from the system. Results from .lif files are official: lines from a scoreboard never overwrite them. Serial ports on Windows are read through PowerShell (no drivers or extra software). New template fields: `ath_gender`, `ath_age`, `ath_discipline`, `rsN_reaction`.

### Variables (Live & graphics → Variables)

Every value RFP Manager can put in a template, listed sport by sport: **Every sport** (the same names in cricket and the others), **All sports except cricket** (clocks, cards, statistics …), each sport's own names, **Production and devices** (date, team, timeline, vMix / ATEM, your own variables) and **Graphic fields** (what each built-in graphic sends: line1, player_name …). Each row has the name, what it is, an example from a sample match (green: the value now, with a match on air) and **Copy**; numbered series (sl1_name … sl16_name) are one row with a number to choose. Copy as `{key}` (text fields and actions), `key`, or `data-f="key"` (your own HTML). Search covers every sport at once; "Copy all" copies a whole group.

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

Your own control panels: Live & graphics → Dashboards → new → **Design**. Drag controls onto the page, drag to move, drag the
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

### Variables and game triggers (Live & graphics → Variables & triggers)

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
plan. Make one under Live & graphics → Timelines (name, date, the production or match it belongs to, length, tempo), then
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

### Music rights, cue sheets and the production report

- **Music library** (Media & music → Music library): every track with its title, artist, composers, publishers, ISWC / ISRC, length, and its rights: where it comes from (commercial release, production music library, royalty-free, commissioned …), whether it is cleared, what for (TV, stream, social, PA, radio) and from / until when. Admins and Producers edit it.
- **Theme music**: a competition has its own theme music (Competition → Theme music), and a production can add more (Production → Music & report). Music playout on the production PC shows the theme music of the match on air first, then the whole library.
- **What gets logged, by itself**: tracks played from Music playout (CasparCG, layer 60 of the program channel), a vMix input whose title is a track's "vMix input title" while it runs (and is not muted), and the music under stream slates (Master control). Anything else (a DJ, the stadium PA, a band, the ATEM) goes on the production under "Music used (added by hand)". Tracks that are not cleared ask before they play and are flagged on the report.
- **After the production**: Production → Report & cue sheet. The report has the summary, matches and results, commentators and officials, crew and costs, the graphics and adverts that went to air, the music, the stream's viewers and recordings, and the incidents logged on the production (PDF or print). The music cue sheet comes in the SAMRO layout and a broadcaster layout, each as PDF or CSV, timed from the TX time.
- **Rights holders**: Media & music → Music use report lists every use over a period for a composer, publisher or library (CSV to send them).

### Production numbers, completing a production and its report

- Every production gets a number when the website first saves it: **P + year + order**, e.g. P2026-014. Numbers are per production team, never reused and never changed by an edit; older productions were numbered oldest first. The number shows in lists, pickers, the call sheet, the report and the cue sheet.
- **Complete production** (on the production, or on its report) opens the report form: 1–5 stars for Overall, Cameras & vision, Audio, Graphics, Stream, Crew, Timing, Equipment and Client satisfaction (each with a note; leave out what did not apply), the issues (kind, severity Minor → Critical, what was done, resolved or still open) and a summary. Completing sets the status to Completed and opens the report with the rating, issues, matches, crew and costs, what went to air, the music and the stream (PDF too). "Edit report" changes it later.

### Match centre on the public website

Click a match on regemarkfp.com (Matches, or Live matches on the home page) for its match centre at /match/<id>: the score and running clock, what happened (scores, cards, substitutions), team statistics, players and line-ups, match officials; the full scorecard for cricket. It updates every few seconds while the match is live. The same live stats show under the video on a watch page when the stream has a match (the picture covers them in full screen). Matches show when the team has "Show matches on the website" on, or when they are in a production that streams.

### Verse of the day (per person)

Settings → My account → Verse of the day: switch it on or off for your home page, pick the translation (the website's Bibles first, then Bibles imported on that machine under Worship → Bibles, then the free online ones: KJV, WEB, BBE, Open English Bible, Portuguese Almeida, Romanian, Latin Vulgate) and the time your day turns over (midnight unless you choose another, e.g. 05:00). The day is your computer's day, and the card turns over by itself at that time.

**Bibles on the website** (Settings → Website, site admins): search the Beblia collection (github.com/Beblia/Holy-Bible-XML-Format, 1000+ translations in 200+ languages, e.g. Afrikaans 1933/1953, 1983, 2020, NLV), pick one and add it. The website keeps it compressed in its database (and the NAS folder), so everyone can choose it for their verse of the day, on the website and on production PCs (they ask the website). Most modern translations are under copyright: you confirm the website may use it, and its copyright line shows with every verse.

### Following teams and clubs (match updates, like Google)

- On regemarkfp.com, **Teams** lists every club and team of production teams that show their matches on the website. A fan signs in and presses **Follow** on a club (all its teams) or one team: on the Teams page, a club's or team's page (/team/<id>), or under a match.
- They choose what they hear about, per team: line-ups, kick-off, every score, half time and full time, red cards and big moments (cricket: wickets, fifties and hundreds, end of the innings, the result). **Following** (/following) lists their teams with these choices.
- The updates go to the RFP Manager app for Android (Firebase push, once the site admin has added the Firebase files under Settings → Server), to the browser (Chrome, Edge, Firefox on phone or PC; on an iPhone after "Add to Home Screen") and to the inbox. After the first follow the site offers to turn on notifications in that browser; Notifications → "Turn on" does it too. Quiet hours apply.
- **How often, per team**: updates as it happens and in the digest, as it happens only, or only in the digest; scores every time, only when the lead changes, or at most every 10 / 15 / 30 minutes; and which kinds of update.
- **How often, overall** (Following → How often): a score digest (off, the evening of a match day, every day, or once a week on a chosen day) at the fan's time in their own time zone, with coming fixtures or not, as a notification and/or by email ("Send me one now" to try it); and a pause for all live updates (1 hour, until tomorrow, a week). One match can be muted from its page.
- The website works them out from the match as the scorer saves it (it reaches the website by sync), so it does not matter which PC or phone scores. Matches more than two days old are not announced.

### Software downloads (regemarkfp.com/software)

Settings → Website → Software on the website (site admins): add an app with its GitHub repository (e.g. regemarkfp/Regemark-Replay). Publish releases on GitHub as usual; every 6 hours (or with Sync) the website copies the installers of the last five releases (.exe, .msi, .dmg, .pkg, .AppImage, .deb, .rpm, archives) to the NAS (`/srv/nas/software` on the home server) and serves them from there. Each app can have an icon (Edit → App icon: upload, the image library or an image address; square, 256×256 or larger), shown on /software and its page. Each app gets a page with download buttons for the visitor's system first, release notes and earlier versions; downloads are counted. A price makes an app paid: until buying is switched on only the emails you list can download it. Apps can check for updates at `/api/software/<app>/latest`. A private repository needs a GitHub token in the config (`"software": { "token": "…" }`).

### Running the company

- **Clients** (Clients & sales → Clients): name, logo, kind, accounts email, phone, website, VAT and registration numbers, address, contact people, a custom discount (%) given on every new quote and invoice, their own prices for certain products or services, payment terms, private notes. A production or booking links to its client.
- **Products & services** (Clients & sales → Products & services): item, description, price, your cost, per (day, km …), default quantity, category. On a quote or invoice, type an item or pick it from the list: the description and price (or the client's own price) fill in.
- **Quotes & invoices** (Clients & sales → Quotes & invoices, on each production and on each client): numbered **RFPQ0001** and **RFPINV0001** (prefixes, digits and the next numbers under Billing details, e.g. carry on from Invoice Ninja at RFPINV0557). Every new one starts with the **booking fee** (R1 500 by default, with a description of what it is for; amount, wording or off under Billing details), then the production's costing when made from a production. Everything stays editable like in Invoice Ninja: client, production, title, number, dates, PO number, status, and every line (item, production/rental date, description, unit cost, quantity, discount %), a discount on the whole (% or rand), VAT, invoice terms and a note; payments are recorded (Partial / Paid) or added by PayFast. A quote becomes an invoice with **Convert**; **Copy** makes a new one. The PDF follows RegemarkFP's Invoice Ninja layout: logo and company, the numbers and balances with the client's details, the lines with their dates, invoice terms with the banking details and the totals, then the terms and conditions and the tagline (Billing details). **Quote and invoice terms** under Billing details apply to every document that has no terms of its own. Signing a quote is a **contract**: in their portal the client opens a popup with the terms and conditions, types their name and draws their signature or loads a picture of it. The quote PDF stays clean; the signature, the terms as they stood at that moment and a fingerprint (SHA-256) are kept with the quote, and **Contract (PDF)** shows the signed agreement (in the Studio and the portal). Signing confirms the production and tells the team.
- **Client portal** (`/portal/<link>`): emailing a quote or invoice gives the client a portal with all their quotes (to read and sign), invoices (to pay with PayFast), productions, bookings and reviews, and their adverts. Everyone on it has their own link; they add colleagues themselves, and you see and remove them on the client's page (Invite to the portal).
- **Ad spaces** (Adverts & sponsors → Ad spaces): sizes and places for client adverts (per sport or General, layout, width × height in pixels, seconds on screen, file types, price per match / month / season). Clients upload their picture in the portal; it waits as **Pending** under Adverts until you set it to Approved (only approved adverts play), and a paid space gets an invoice they pay in the portal.
- **Importing from Invoice Ninja** (Quotes & invoices → Import from Invoice Ninja, Admins): your Invoice Ninja address and an API token (Settings → Account Management → Integrations → API Tokens; used once, not kept). Clients with their contacts, products, quotes and invoices (with what was paid, the line dates, and a copy of each Invoice Ninja PDF) come across as a backup; run it again for anything newer. Quotes and invoices kept on productions before 0.1.48 moved to the new list by themselves.
- **Crew answers from the call sheet email**: "I'm in" / "Can't make it" buttons, no sign-in needed; the producer is told. Crew mark the days they cannot work (My availability); a production shows clashes (not available, booked twice the same day, declined).
- **Kit out / in** per production: scan a barcode (or type a serial or name) as kit goes out and comes back; damaged and missing items; service and insurance dates on equipment.
- **Client page**: a private link per production with its call sheet, stream, recordings, report and the quotes and invoices you have sent.
- **Sponsor reports** (Adverts & sponsors → Sponsor reports): proof of play per sponsor per month from the playout log, as a PDF and emailed to the sponsor email on their adverts.
- **Health alerts** during a show: a weak stream for a minute, a live match with no scoring for 12 minutes, a production PC going offline on a production day.

### For fans

Competitions can be followed (with a log table), an hour-before-kick-off reminder, the fixtures of your teams as a calendar subscription (Following → Add to my calendar), predictions before kick-off and the fans' player of the match, ▶ replays of each moment from the stream recording, player profiles (only when the team switches on "Show player profiles"), the sermon archive on church channels (Sermon fields on a production), and gift tickets and passes.

### Production teams

Each production team has its own name on the website: a second team with the same name is refused. Two teams that
should be one (for example one made on a production PC before it was linked) are merged under
**Settings → Production team → Merge another production team into this one** (you must be an Admin of both).
Everything in the other team moves across, the other team is removed, and linked PCs follow by themselves.

### The Android app and the RegemarkFP look

In the Android app the Studio looks like an Android app: an app bar on top (logo, production team, notifications bell,
your picture → Settings) and tabs at the bottom (Home, Matches, Productions, Calendar, More; Crew, Coaches and Officials
get their own), with More listing everything else, your account and Sign out. Forms open as bottom sheets. The website
and production PCs keep the side menu (`/app?android=1` shows the app layout in a browser, `?android=0` turns it off).
Admins, Producers, Scorers and Crew who open the website or the Studio in a phone's browser on Android (not in the app) is offered the app once
(Download / Not now; asked again after 14 days).
Buttons, text fields, cards, panels, chat bubbles and video thumbnails everywhere are slanted like the RFP logo (add class `noslant` to keep one square).

### People and roles

Settings → Members (Admins). Adding someone emails them an invitation: **Accept the invitation** opens `/join/<link>`,
where they set their own password (no Google account needed) and go straight into the team, or they sign in with Google
using that email. The link works for 14 days and stops working once they have a password or are removed; **Send invite**
on their row emails a fresh one. When someone accepts, the team's Admins get a notification (app, browser and inbox) and an email
(switch it off under Settings → Notifications → "someone accepts their invitation").

Phone numbers (booking form, crew, bookings, call sheets, My account) have a country picker and are saved with the code,
e.g. `+27 82 123 4567`. A number typed with a 0 gets the default code: the WhatsApp country (Settings → Server →
WhatsApp), otherwise South Africa (+27).

The roles:

| Role | Can |
|---|---|
| Admin | everything, including members and team settings |
| Producer | productions, crew, crew roles, equipment, bookings, costing, approving expenses, and every other record |
| Scorer | score matches (on the production PC) and control graphics |
| Crew | see productions, and add their own expenses with receipts |
| Coach | change their own clubs, those clubs' teams and players, and pick the team sheet for their matches |
| Official | see the matches they are named on, and confirm the result |

* **Coach:** after choosing the role, tick the club(s) they look after. Their home page is **My teams**: their
  clubs and teams, the next matches (with a reminder to pick the team sheet) and results. On a match they pick the
  **team sheet**: who plays, numbers, positions, captain and bench. The scorer and the graphics use that team sheet
  for that match. Coaches do not see productions, crew or costs.
* **Official:** after choosing the role, type their name as it is written under *Match officials* on the matches
  ("Referee: A Name"). Their home page is **My matches**. After the game they open the match and press **Confirm the
  result** (score, cards and incidents, notes). The result shows on the fixtures list and goes to the coaches and
  producers by email.
* **Pictures:** everyone signed in with Google shows with their Google profile picture (menus, members, expenses).
  It updates when they next sign in after changing it in their Google account. Settings → My account has their
  phone number too.

### Calendar, and what crew members see

**Productions → Calendar** shows every production by month (or as a list on a phone); tick *Matches too* to add the
fixtures. Click one to open it.

People with the **Crew** role see only: **My gigs** (their upcoming gigs, what they earned in the last 30 days and
what they are still owed), the **Calendar**, **My expenses** and Settings. On the calendar their own gigs are green;
clicking one shows the details, their role and call time, the crew they work with (with phone numbers), notes and
hospitals. Crew are matched by the email on their Crew record. Pay is the crew role's day rate × days (or the
*Day rate* on that booking); producers tick **Paid** on the booking once paid. *Still owed* is past gigs not yet paid
plus approved expenses not yet paid back. Crew never see rates, costs or what others are paid.

### Verse of the day

Every dashboard shows a verse of the day, the same for everyone that day. It comes from a Bible on the production
PC (worship control), or else the King James Version from bible-api.com.

### Expenses and receipts

On a production, **+ Add expense**: what it was for, category, amount (and VAT), and the receipt. On a phone
**📷 Photo** opens the camera; **File or PDF** takes a PDF or a picture from the gallery. Crew members see only their
own expenses. Producers and Admins see all of them on the production and under **Productions → Expenses**, and set
each one to **Approved**, **Rejected** or **Paid back**. Approved expenses are added to the production's
**Costing**; tick *Invoice to the client* to add them to what you invoice too. Receipts can only be opened by the
person who added them and by Producers and Admins.

### Email notifications

The website emails people when:

* they are added to a production team (with what their role lets them do),
* they are booked as crew on a production (role, date, call time, venue): their email is on their Crew record,
* they are named as an official on a match,
* an expense is waiting for approval (Producers and Admins), or theirs was approved, rejected or paid back,
* the officials confirmed a result (the coaches of both teams, Producers and Admins).

Each person can switch emails off under Settings → My account. To switch emails on for the website, add these on
Render (Environment), or on your own server in `/etc/rfp-manager/env`:

* **Brevo** (free for 300 emails a day; easiest): make a free account at brevo.com, add and confirm your sender
  address (Senders), create an API key (SMTP & API → API keys), then set `MAIL_PROVIDER=brevo`,
  `MAIL_FROM=RFP Manager <info@yourdomain>` and `MAIL_API_KEY=<the key>`.
* **Resend**: `MAIL_PROVIDER=resend`, `MAIL_FROM`, `MAIL_API_KEY` (your domain must be verified at resend.com).
* **SMTP** (your own server only; Render's free plan blocks mail ports): `SMTP_URL=smtps://user:password@smtp.host:465`
  and `MAIL_FROM`. With Google Workspace use smtp.gmail.com with an app password.

### The booking form (/book)

One page, in sections: **You** (name, organisation, email, WhatsApp number, best way to reach them), **The event**
(service, date and last day, start and end time, venue and town), questions for **the kind of job**, **What you need**
(deliverables, cameras, where to stream, internet and power at the venue, indoors or outdoors) and **Anything else**
(budget band, how they heard of you, notes). The job questions follow the service and the kind of event:

* **Sport broadcasts:** the sport, level, teams or age groups, the matches, how many matches and fields at once, the
  competition, what the broadcast needs (score bug and graphics, commentary, replays, line-ups and stats, sponsor
  adverts, drone, big screen, stats for coaches, highlights per match) and sponsors.
* **Church service:** kind of service, how often, what goes on screen (lyrics, Bible verses, names), what happens
  afterwards (sermon archive, clips, podcast) and their own equipment.
* **Wedding / funeral:** guests, coverage, what the family receives, names for titles.
* **Conference, concert, school event:** audience, speakers, rooms at once, slides, hybrid speakers, Q&A, lower thirds,
  sponsor branding, the programme.
* **Video & photography:** what is needed, hours, final length, deadline and where it will be used.

**Everything is yours to change** in Settings → Website → **Booking form** (site admins): the line under the heading;
each standard field on or off, required or not, and its label (and the choices for *best way to reach you*, *budget*
and *how did you hear*); the *kind of event* question, its kinds and the services that skip it; and the **sections of
questions**: add, remove, rename and reorder them, choose the services or kinds of event each one shows for (none =
every service), and edit their questions (short or long text, number, date, pick one, tick any; required; full width;
the choices; a hint). *Back to the standard form* undoes it all. Name and service are always asked, and people give an
email or a phone number. Required fields are checked by the website too.

The answers are on the booking (*What they need*), in the email to the Admins and the client's copy, and in the
description of the production made when a Producer accepts it (its TX time is the start time).

### Booking requests: tracking and messages (email + WhatsApp)

Every booking request from the website gets its own private page, **/track/<key>**, like a parcel. The link is shown
after sending the request and is in the thank-you email. The page shows the steps, each with the date it was reached:

Received → Being reviewed → Quote sent → Confirmed → Crew booked → Event day → Completed (or Declined / Cancelled)

* **The step follows the work.** A Producer is allocated: *Being reviewed*. A quote on its production is sent: *Quote
  sent*. The booking is *Booked* or its production *Confirmed*: *Confirmed*. A crew member is ticked confirmed: *Crew
  booked*. The date of the event: *Event day*. The production is *Completed*: *Completed*. *Not going ahead* or a
  cancelled production: *Declined* (never confirmed) or *Cancelled*. **Client sees** on the booking sets a step by hand.
* **Each new step is sent to the client** by email and WhatsApp, unless **Quiet** is ticked on the booking.
* **Messages.** On the booking, under *Client & messages*, the Producer writes to the client: it goes by email and
  WhatsApp at once (untick either), with the tracking link. Each message shows whether the email went and the WhatsApp
  ticks (sent, delivered, read). The client answers on the tracking page or on WhatsApp; the answer appears on the
  booking and the Producer (or the Admins when nobody is allocated) gets an email and a notification.
* **Copy tracking link** and **What the client sees ↗** are on the booking.
* **The way the client talks to you decides the channel.** A client whose last message came by WhatsApp, or who chose
  WhatsApp on the form, is written to on WhatsApp only (replies and step updates; email only if WhatsApp fails, marked
  "instead of WhatsApp"). One who chose email gets email only. Otherwise both. The reply box ticks Email / WhatsApp to
  match, and you can tick the other to send it there too.

**Ratings after the event.** When a booking reaches *Completed*, the client's message asks them to rate it, with a
link straight to the rating on their tracking page (and one reminder three days later if they have not). They give
1–5 stars overall and for quality, communication, punctuality and setup, and value for money, a comment, and say
whether you may show it on the website (and under what name). The team gets an email and a notification; the rating
is on the booking and on **Clients & sales → Ratings** (averages and every rating). Reviews clients allowed show under
*What clients say* on the home page (hide one from the booking; switch them all off in Settings → Website).

Google does not let a website post a review for someone, so after rating, clients get a **Share it on Google too**
button that opens your Google review page, where they post it themselves (the home page has *Review us on Google*).
Put your link in Settings → Website → *Google review link*: Google Business Profile → *Ask for reviews* → copy the link
(a Place ID starting ChIJ works too). Every client gets the button, whatever they rated: Google does not allow asking
only happy clients.

**WhatsApp (Settings → Server → WhatsApp, site admins)** works one of two ways.

*Link my WhatsApp (phone)*: the business's own WhatsApp is linked to the website the way WhatsApp Web is, with a QR
code (or a code typed in WhatsApp → Linked devices → Link with phone number instead). Messages then go from that number
by themselves and the clients' answers come back to the booking. Nothing to set up at Meta. **This is not an official
WhatsApp API: WhatsApp's terms do not allow it and it can ban the number.** The website keeps the risk down: it only
writes to people who sent a booking request, one message at a time with a pause between them, at most 60 an hour. Use
a WhatsApp Business number rather than a personal one. The first link installs the library it uses (Baileys) into the
data folder (`whatsapp/lib`, with npm, a few minutes); the linked session is kept in `whatsapp/auth`. Unlink there, or
on the phone under Linked devices. The phone has to come online now and then, or WhatsApp unlinks the website.

*Meta Business API*: the official way, sent through Meta's WhatsApp Business Cloud API from a business number (not
one already on the WhatsApp app):

1. developers.facebook.com → *Create app* (Business) → add **WhatsApp**, linked to your Meta Business account.
2. *WhatsApp → API setup*: add and verify the business number; copy its **Phone number ID** into the settings.
3. business.facebook.com → *Settings → System users*: add an Admin system user, assign it the app and the WhatsApp
   account, and generate a token (never expires) with `whatsapp_business_messaging` and
   `whatsapp_business_management`. Paste it into the settings yourself; it is a secret.
4. *WhatsApp Manager → Message templates*: create **booking_update**, category *Utility*, English, body
   `Hi {{1}}, there is an update on {{2}}: {{3}} Follow your booking here: {{4}}`. WhatsApp only lets a business start a
   conversation with an approved template; once the client writes back, messages go as normal text for 24 hours.
5. *WhatsApp → Configuration → Webhook*: the **callback URL** and **verify token** shown in the settings, then
   subscribe to `messages`. The **App secret** (*App settings → Basic*) makes the website check that calls come from Meta.
6. A payment method in WhatsApp Manager: Meta charges per conversation it starts with a template.

Numbers people type with a leading 0 get the country code from the settings (27: 068 … → 2768 …).

### Payments with PayFast (Settings → Server → PayFast)

One PayFast merchant account for the website takes every payment: stream tickets and channel passes, **invoices**
(a *Pay now* button in the invoice email and on the client page; paid invoices turn *Paid* by themselves), **booking
deposits** (set *Deposit* on a booking request; the client pays on their tracking page and the booking turns
*Booked*, which the client sees as *Confirmed*) and **software** with a price (on /software/<app>; the buyer signs in,
pays, and their account may download it from then on). The payer gets a receipt by email and the team is told.

Set up: a PayFast business account (payfast.io) → *Settings → Developer settings*: copy the **Merchant ID** and
**Merchant Key** and set a **Passphrase**, then type the three into Settings → Server → PayFast (site admins). Try it
first with a sandbox account (sandbox.payfast.co.za) and **Sandbox** ticked. PayFast confirms each payment to
`<site>/api/pay/payfast/itn`; the website checks the signature, PayFast's address, the amount and asks PayFast to
confirm before anything counts as paid. The `PAYFAST_*` variables still work and are used when nothing is saved there.

### Android app

The Android app is an APK that opens the website as an app (full screen, its own icon, Google sign-in, the camera
for receipts). It runs through Chrome, which every Android phone has.

* **Getting it:** the app is for the production team only (Admins, Producers, Scorers, Crew): signed in on an Android phone's browser they are offered it, and `/app/rfp-manager.apk` downloads only for them (others are asked to sign in, or told it is for the team). The installed app's own updates still download.
  Open the downloaded file and allow installing from your browser when Android asks (it is not from the Play Store).
* **Building it:** GitHub builds it by itself. The `android` folder and `.github/workflows/android.yml` are in the
  repository; whenever the `android` folder changes (or Actions → Android app → Run workflow), GitHub builds the APK,
  puts it into `public/app/rfp-manager.apk` and Render publishes it. The build is also kept as a download on the
  workflow run.
* **Another website address:** change `site` at the top of `android/app/build.gradle`, and the app is rebuilt.
* **Signing key:** `android/rfp-release.keystore` with its passwords in `android/keystore.properties`. Every update
  must be signed with the same key, so keep a copy of both. The key's fingerprint is what the website serves at
  `/.well-known/assetlinks.json` (setting `android.sha256`, or `ANDROID_SHA256`); that file is what lets the app open
  without an address bar. The key is in your private repository. If the repository is ever made public, make a new
  key and keep it out of the repository.
* People can also skip the APK: in Chrome on the website, ⋮ → **Add to Home screen** / **Install app**.

## 5. Templates

Set **Templates → Template folder on this PC** to CasparCG's template folder (`template-path` in casparcg.config).
RFP Manager then copies its own templates (`rfp/` and the themes that come with it) into that folder at every start
and update – only files that changed, your own templates are never touched – and "Copy RFP Manager's templates now"
does it by hand.

**CasparCG on another computer (e.g. a headless Ubuntu server):** share its template folder and point RFP Manager at
the share. On the server: `sudo apt install samba`, add to `/etc/samba/smb.conf`

```
[template]
   path = /opt/casparcg/template        # CasparCG's template-path
   read only = no
   valid users = caspar                 # the Linux user that runs CasparCG
```

then `sudo smbpasswd -a caspar` and `sudo systemctl restart smbd` (`sudo ufw allow samba` with a firewall). On the PC,
open `\\<server-ip>\template` in Explorer once and tick *Remember my credentials*, then use `\\<server-ip>\template`
as the template folder. Also set **Settings → Connections → Images in templates → Web address** (the server can't open
`file:///C:/…` paths on the PC). If the share is offline, RFP Manager tries again every five minutes.

The templates folder holds the CricketCG templates plus three for productions:

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
lib/bookings.js      booking tracking (/track/<key>) and client messages
shared/bookingform.js the booking form as data (the standard one, cleaning, which sections show)
lib/payments.js      PayFast for invoices, booking deposits and software (lib/pay.js: the checkout)
lib/whatsapp.js      WhatsApp: Meta Cloud API (send, webhook) or a linked phone (lib/walinked.js, Baileys)
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
lib/mail.js          email (Brevo, Resend, SMTP)   lib/notify.js   who gets which email
android/             the Android app (Trusted Web Activity), built by .github/workflows/android.yml
public/js/people-pages.js  coaches, officials, team sheets, results, expenses
lib/stream.js        streaming channels: MediaMTX checks, live status, watch pages   lib/tarball.js  the program as .tar.gz
tools/server/install.sh   sets up a server: website + MediaMTX + Caddy (VM, or at home with --tunnel)   public/watch.html  the viewer page
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

`npm test` runs 60 tests: the cricket engine (ICC conditions, DLS, super over, two-innings matches), the rules
and statistics of every other sport, worship control (slides, outputs, CCLI log, song and Bible file formats),
the short screen links, the live scorer and graphics control over the WebSocket against a stand-in CasparCG
server, the rundown monitor, accounts and roles, the image folder, Google token checks (against a locally
generated key), XML export and import, sync between an online instance and production PCs, scorer buttons and
macros per theme, advert options and the play log, vMix, ATEM, HyperDeck, Raspberry Pi GPIO, OBS, Companion, OSC, Art-Net, MIDI and X-keys (the Windows helper's line protocol, and Linux device files) against small stand-ins, input mappings, the Companion addresses, who took each graphic, the Timeline (cues, holds, GO,
crew screens, comments, rundown import), custom variables, game triggers (adverts on tries), dashboards, text of several lines (JSON, XML and `{nl}`), linking a PC by signing in on the website or with Google on the PC (a stand-in Google key), and remote access through the website (live pages, WebSocket, settings, adverts, screen keys, team checks, a forged identity, the PC going offline), the bridge PC (records read-only on the PC, no scoring through the website, working offline and catching up afterwards), coaches, officials and expenses (who may change what, team sheets used by the graphics, results, receipts and who may open them, costing), email notifications (each kind, switching off, an SMTP conversation), the Android app files (app link, manifest, service worker), the crew view (gigs, earnings, what is owed, no rates shown), the verse of the day (against a stand-in), streams on productions and branded channels (recordings as videos, the public front page, subscribing and the go-live email), streaming (stream keys, who may publish and watch, viewer tokens, passwords, live status against a stand-in MediaMTX) and the server setup command (bundle, settings, who may make it).

Not covered by the tests, so check these on your own setup first: a real CasparCG server, real vMix, ATEM,
HyperDeck, OBS, Companion, lighting desks and X-keys / MIDI hardware (built from their published protocols, tested only
against stand-ins; the Windows MIDI / X-keys helper and RFP Manager.exe (with its WebView2 windows) could not be built or run on the build machine; the X-keys key numbering and
backlight commands vary by model), a real relay board on a Pi
(pi-gpio.py was tried in its --mock mode only), the Android build (written for GitHub Actions and Android's tools, which this build machine could not reach; not built here), real Brevo / Resend / SMTP servers, a real MediaMTX server and tools/server/install.sh on a real VM (written to MediaMTX's documented settings; not run here), a real MongoDB Atlas
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
