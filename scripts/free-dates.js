//@ts-check
import fetch from "cross-fetch";
import * as fs from "fs/promises";
import * as path from "path";
import * as playwright from "playwright";
import { URL } from "url";

/**
 * @typedef {Record<string, number>} VaxDates
 */

/**
 * @param {{browser: playwright.Browser}} config
 * @returns {Promise<VaxDates>}
 */
async function loadCurrentFreeDates(config) {
  const context = await config.browser.newContext();

  const page = await context.newPage();
  await page.goto("https://www.countee.ch/app/de/counter/impfee/_iz_sachsen");

  await page.waitForSelector('h1:has-text("Freie Impftermine in Sachsen")');

  const $centres = await page.$$(".container .rows > div");

  /**
   * @type {VaxDates}
   */
  const dates = {};

  await Promise.all(
    $centres.map(async ($centre) => {
      const $name = await $centre.$("h1");
      if ($name === null) {
        throw new TypeError("Expected an <h1> inside a column.");
      }
      const name = await $name.textContent();
      if (name === null) {
        throw new TypeError("Expected <h1> to have text.");
      }

      const text = await $centre.textContent();
      if (text === null) {
        throw new TypeError("Expected column to have text");
      }
      const freeDatesMatch = text
        .replace(name, "")
        .match(/^\s*(\d+)\s*freie Termine/);
      if (freeDatesMatch === null) {
        throw new Error(`Unable to parse free dates in '${text}'.`);
      }

      const freeDates = +freeDatesMatch[1];
      if (Number.isNaN(freeDates)) {
        throw new TypeError(
          `Unable to parse '${text}' into a number. Matched '${freeDatesMatch[1]}'.`
        );
      }

      dates[name] = freeDates;
    })
  );

  return dates;
}

/**
 * @returns {Promise<VaxDates>}
 */
async function loadFreeDatesSnapshot() {
  const response = await fetch(
    "https://vax-notify.s3.eu-central-1.amazonaws.com/data/freeDates.json"
  );

  if (!response.ok) {
    throw new Error(
      `Unable to fetch snapshot. ${response.status}: ${response.statusText}`
    );
  }

  const { groups } = await response.json();
  return groups;
}

/**
 *
 * @param {VaxDates} dates
 * @param {{snapshotPath: string}} config
 */
async function saveFreeDates(dates, config) {
  await fs.mkdir(path.dirname(config.snapshotPath), { recursive: true });
  await fs.writeFile(
    config.snapshotPath,
    JSON.stringify({ dates, lastUpdated: new Date().toISOString() }, null, 2)
  );
}

/**
 * @param {{browser: playwright.Browser, dry: boolean, snapshotPath: string}} config
 * @returns {Promise<void>}
 */
async function updateFreeDates(config) {
  const [freeDates, snapshot] = await Promise.all([
    loadCurrentFreeDates(config),
    loadFreeDatesSnapshot(),
  ]);

  await saveFreeDates(freeDates, config);
}

async function setup() {
  const browserLaunch = playwright.chromium.launch();

  const [browser] = await Promise.all([browserLaunch]);

  return {
    browser,
    teardown: async () => {
      await Promise.all([browser.close()]);
    },
  };
}

async function main() {
  const { browser, teardown } = await setup();

  const dry = process.argv.slice(2).includes("--dry");
  const snapshotPath = new URL("../data/freeDates.json", import.meta.url)
    .pathname;

  try {
    await updateFreeDates({
      browser,
      dry,
      snapshotPath,
    });
  } finally {
    teardown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
