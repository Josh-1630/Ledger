# Spending Ledger

A private money manager that installs on your phone like an app: income, expenses, transfers, accounts, budgets with over-limit alerts, subcategories, repeating entries, savings goals and insights.

- **Private:** all data is stored on the device that uses it. Nothing is sent to a server, so anyone else who opens the link sees an empty app.
- **PIN lock:** optional 4 to 6 digit PIN, asked on open and after a minute in the background.
- **Offline:** after the first visit it works without internet.
- **Backups:** More → Back up saves a `.json` file; More → Restore brings it back. CSV export and import are there too.

## Install on your phone
- **Android (Chrome):** open the link, tap **Install** on the banner (or menu → Install app).
- **iPhone (Safari):** open the link, tap **Share** → **Add to Home Screen**.

## Hosting
Static files only (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`). Served from GitHub Pages: Settings → Pages → Deploy from branch `main`, folder `/ (root)`.

When releasing changes, bump `CACHE` in `sw.js` so installed copies pick up the new version.
