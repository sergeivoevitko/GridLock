# GridLock

_Lock in your grid before you post._

Plan how your Instagram grid will look before you post. Load any public account,
add photos from your computer, and drag everything around. Nothing is ever posted.

## Requirements
Install **Node.js** (version 18 or newer) from https://nodejs.org (the "LTS" button).

## Run it

**Web mode** (opens in your browser):
- Windows: double-click `start-web.bat`
- Or in a terminal in this folder: `npm run web`
- Then open http://localhost:5178 (it opens automatically). Keep the black window open while you use it.

**Desktop mode** (its own app window):
- Windows: double-click `start-desktop.bat` (the first run downloads the app parts, about 1 minute)
- Or: `npm install` once, then `npm run desktop`
- To build a single .exe you can keep anywhere: `npm run dist` (output in the `dist` folder)

## How to use
1. Type a username and press **Load**.
2. Add photos with **+ Add photos**, or drag them from your folders into the app.
   Drop them on a tile to insert them at that spot, or anywhere else to put them on top.
3. Drag any tile to move it. 🟢 green dot = already on Instagram, 🟣 purple dot = planned.
4. **Refresh** pulls new posts from Instagram and keeps your plan.
5. **Reset** removes planned photos and restores the original order.
6. **4:5 / 1:1** switches between Instagram's current portrait grid and the classic square grid.

## Offline
Every time a feed loads, a copy of it (images included) is saved on your computer.
When you reopen the app it shows your last account and plan right away, even without
internet. Refresh needs internet.

## Good to know
- Without login, Instagram only gives the ~12 most recent posts. Older posts seen in
  earlier loads are kept, so the grid grows over time.
- Instagram sometimes limits requests. If that happens, wait a few minutes; the saved copy is shown meanwhile.
- Private accounts can't be loaded.
- Web mode and desktop mode keep separate plans.
- HEIC photos (iPhone) may not open in every browser. Use JPG or PNG if one fails.
