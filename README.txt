OPULENT HARDWARE Event Results - GitHub Live + Excel Fallback v6

This version restores the GitHub Pages live-data flow while keeping the newer UI,
compare view, hamburger dock, and local Excel fallback.

Main browser flow:
1. index.html auto-loads ./data/current-event.json.
2. The hamburger dock lets users switch Overall, PAX, Class, and Compare.
3. FETCH LIVE reloads the JSON.
4. CHOOSE EXCEL still parses a local SFR-style workbook in the browser.

GitHub live-data flow:
- The included GitHub Action runs scripts/fetch-sfr-results.js.
- The script opens https://live.sfrautox.com/#N with Playwright.
- It captures Overall, PAX, and Class views.
- scripts/parser.js converts the captured text into data/current-event.json.
- GitHub Pages serves index.html and the generated JSON.

Files to copy into the former GitHub repo:
- index.html
- assets/style.css
- assets/app.js
- data/current-event.json
- package.json
- scripts/parser.js
- scripts/fetch-sfr-results.js
- .github/workflows/fetch-sfr-results.yml

Note:
Direct browser fetching from live.sfrautox.com is usually not reliable because of
browser/CORS/static hosting limits. The GitHub Action is the live-data bridge.
