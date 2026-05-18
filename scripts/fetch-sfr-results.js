import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { parseSfrLiveText } from './parser.js';

const SOURCE_URL = process.env.SFR_SOURCE_URL || 'https://live.sfrautox.com/#N';
const OUT_FILE = process.env.OUT_FILE || 'data/current-event.json';

async function clickLikelyView(page, label) {
  const candidates = [
    `text=/^${label}$/i`,
    `button:has-text("${label}")`,
    `a:has-text("${label}")`,
    `[role="tab"]:has-text("${label}")`
  ];

  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click({ timeout: 2500 });
        await page.waitForTimeout(1000);
        return true;
      } catch (_) {
        // Keep trying candidates. The live page markup changes occasionally.
      }
    }
  }

  return false;
}

async function bodyText(page) {
  return page.locator('body').innerText({ timeout: 10000 });
}

async function captureLiveText(page) {
  const chunks = [];

  chunks.push('[[OVERALL_VIEW]]');
  chunks.push(await bodyText(page));

  await clickLikelyView(page, 'PAX');
  chunks.push('[[PAX_VIEW]]');
  chunks.push(await bodyText(page));

  await clickLikelyView(page, 'Class');
  chunks.push('[[CLASS_VIEW]]');
  chunks.push(await bodyText(page));

  return chunks.join('\n');
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });
    await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);

    const sourceText = await captureLiveText(page);
    const parsed = parseSfrLiveText(sourceText, {
      sourceUrl: SOURCE_URL,
      updatedAt: new Date().toISOString()
    });

    parsed.rawCaptureDiagnostics = {
      sourceTextLength: sourceText.length,
      generatedAt: new Date().toISOString()
    };

    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(parsed, null, 2));

    console.log(`Wrote ${OUT_FILE}`);
    console.log(`Overall rows: ${parsed.overall?.length || 0}`);
    console.log(`PAX rows: ${parsed.pax?.length || 0}`);
    console.log(`Class groups: ${parsed.classOrder?.length || 0}`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
