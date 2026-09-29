# Pour — local party tracker

A touch-friendly bar counter, recipe notebook, and live leaderboard. React + TypeScript frontend, Node.js server, and a local SQLite database. No cloud account or database setup.

## Start on Windows

Double-click **Start Party Tracker.cmd**. It builds the app, opens `http://localhost:4310`, and runs the server. Keep the launcher window open while serving. The first launch installs dependencies and needs internet access. Later launches run locally.

Requires Node.js 22.13+ (Node.js 24 LTS recommended). The launcher can also use the Node.js runtime bundled with Codex if it is installed. This machine's older system Node.js is not used for the server.

1. Create a party and set the measuring shot size in mL.
2. In **Setup & Data → Drink Menu**, add spirits, mixers, premade drinks, and saved cocktails. Set spirit prices per mL in USD (fractional cents are allowed); premade drinks and cocktails have fixed prices.
3. In **At the Bar**, add/select a guest, select a drink, choose shots, and tap **Serve Drink**. The guest stays selected; the drink clears to prevent accidental repeat submissions.
4. Use **Just served** to check the last pour. Undo/redo covers submissions and voids. Tap a serving for its original recipe, void, or confirmed permanent deletion.

Names are case-insensitively unique, whitespace-normalized, and displayed in title case. Guest colors and UUIDs persist across parties. Guests are sorted by their latest non-voided serving in the selected party; there is no separate active guest membership.

## Volumes, scoring, prices

- Set **Drink markup · %** in **Setup & Data → Party & Sharing → Edit Party Settings**. All menu and custom-mix prices are base prices; each serving adds this party's markup (25% turns $4 into $5), then rounds the final charge to cents. Existing parties default to 0%. Historical servings keep their original charge and markup. New parties inherit the current markup, and setup exports/imports include it.

- A shot is a configurable entry shortcut. Every serving saves actual mL, ABV, recipe, measuring shot size, and price at submission.
- Shots allow quarter increments. ABV and US proof display together (`proof = ABV × 2`).
- Cocktails count the alcohol from each ingredient. Non-alcoholic mixers support measured amounts or “top up.” Live custom mixes remain in serving history even if you do not save them to the menu.
- Points = total pure alcohol mL / (reference shot mL × reference ABV / 100). The reference is customizable per party. Changing it rescales scores, while changing the measuring shot affects future pours only.
- Spirit prices are USD per mL. Each serving costs rate × shots × measuring-shot mL, rounded to cents only at the final total. Saved cocktails and premade drinks have fixed serving prices; custom mixes have an entered price.
- Tabs are **total value served in USD**, not payment processing or outstanding-balance accounting. The eye button hides tabs in party mode. The guest leaderboard never displays tabs.
- Archived drinks remain in historical records. Restore a recipe ingredient before using it again.
- Undo/redo is shared for the current party. A new submission or void clears the redo branch. Hard deletion permanently removes that serving and its related undo/redo entries.

Existing per-shot spirit prices are converted once using the newest party’s shot size (44.36 mL if no party exists). Historical serving prices are unchanged.

## Phone leaderboard / LAN

Open **Setup & Data → Party & Sharing** to copy a leaderboard link for guests on the same Wi-Fi. The page works on phones and refreshes every five seconds. Keep the host computer awake. If necessary, allow Node.js on **private networks** through Windows Firewall.

The server listens on port 4310 on all network interfaces. There is no login or PIN. The guest page has no editing controls, but other devices on the LAN can access the main app and API. Use a trusted local network. LAN access is optional; everything works on localhost.

## Data and backup

**Export Setup** and **Import Setup** are at the top of Setup & Data and on the initial welcome screen. The JSON setup file contains the guest directory (UUIDs and colors), all drinks and mixers (including archived ones), recipes, prices, and the selected party's shot/reference settings. Serving history, scores, and tabs are excluded.

Import shows a preview before applying changes. It adds new entries and keeps existing ones: drinks match by UUID, guests by UUID or case-insensitive name. Matching entries are not overwritten. Optionally create a fresh party using the file's settings; otherwise only guests and drinks are imported and current party settings stay unchanged. Invalid files are rejected without partial changes. Use the database backup below to preserve full history.

Data is stored in `data/partytracker.sqlite`. To back up, stop the server and copy the **entire data folder** (including any SQLite WAL files). Restore it with the server stopped. CSV export is available in Overview and Serving History; it includes voided records and ingredient snapshots. A CSV is a report, not a restorable database backup.

No sample guests, drinks, or servings are inserted into your actual database.

## Development

With a supported Node.js on PATH:

```sh
npm install
npm run dev
```

Development frontend: `http://localhost:5173`; backend: port 4310.

```sh
npm test
npm run build
npm start
```

Tests exercise alcohol/price snapshots, mixed recipes, uniqueness and transactional renaming, undo/redo/void/delete, party separation, idempotent submissions, and database persistence. Set `PARTYTRACKER_DATA` to a different directory for isolated testing. `PORT` changes the production server port.

The main bar layout is designed for 1080p or larger landscape touchscreens. The leaderboard also supports phone widths.
