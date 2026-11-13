# GridLock

_Lock in your grid before you post._

Plan how your Instagram grid will look before you post. Load any public account,
add photos from your computer, and drag everything around. Nothing is ever posted.

## Requirements
Install **Node.js** (version 18 or newer) from https://nodejs.org (the "LTS" button).

## Run it
- Windows: double-click `start-web.bat`
- Or in a terminal in this folder: `npm start`

Your browser opens http://localhost:5178. Keep the small black window open while you use
GridLock; close it to stop. Nothing needs to be installed besides Node.js.

## How to use
1. Type a username and press **Load**.
2. Add photos with **+ Add photos**, or drag them from your folders into the app.
   Drop them on a tile to insert them at that spot, or anywhere else to put them on top.
3. Drag any tile to move it. 🟢 green dot = on Instagram, 🟣 purple dot = planned.
   Click the dot on one of your own photos to switch it between planned and on Instagram.
4. **Refresh** pulls new posts from Instagram and keeps your plan.
5. **Reset** removes planned photos and restores the original order.
6. **4:5 / 1:1** switches between Instagram's current portrait grid and the classic square grid.

## How loading works
GridLock opens the account's public profile page, like a visitor would, and reads the
newest ~12 posts from it. No login, and nothing is posted.

Instagram changes this page often and sometimes blocks logged-out visits. When that
happens GridLock tells you, and you can keep planning with the options below.

## Import your full grid (backup option)
1. In the Instagram app: **Settings > Accounts Center > Your information and permissions >
   Download your information**. Choose your account, **Some of your information > Posts**,
   format **JSON**, and request it.
2. When Instagram emails you the download, unzip it.
3. In GridLock, load or type your username, press **Import export**, and pick the unzipped folder.

All your photo posts are added with a green dot, in date order. Videos are skipped, and
posts already loaded from Instagram aren't added twice.

## Offline
GridLock runs entirely on your computer, so it works without internet. Every time a feed
loads, a copy of it (images included) is saved locally, and your plan is saved in your
browser. Offline you can open the app, see your last loaded feed, add photos, drag things
around and reset. Only Load and Refresh need internet.

## Good to know
- Only public accounts can be loaded by username, newest ~12 posts. Older posts seen in
  earlier loads are kept, so the grid grows over time.
- If Instagram limits requests, wait a while; the saved copy is shown meanwhile.
- Your plan is saved in the browser you use. Use the same browser each time (a different browser starts a fresh plan).
- HEIC photos (iPhone) may not open in every browser. Use JPG or PNG if one fails.
- Pulling data from Instagram automatically may go against Instagram's terms. Keep it to light, personal use.
