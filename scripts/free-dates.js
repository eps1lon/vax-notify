//@ts-check
import { Octokit } from "@octokit/rest";
import fetch from "cross-fetch";
import * as fs from "fs/promises";
import * as path from "path";
import * as playwright from "playwright";
import { URL } from "url";

const ISSUE_NUMBER = 8;

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
 *
 * @param {VaxDates} dates
 * @param {{dry: boolean,octokit: Octokit}} config
 * @returns {Promise<void>}
 */
async function updateSummary(dates, config) {
  const markdown = `
last update: ${new Date().toISOString()}

${Object.entries(dates)
  .map(([name, dates]) => {
    return `* ${name}: ${dates}`;
  })
  .join("\n")}
`;

  if (config.dry) {
    console.log(markdown);
  } else {
    await config.octokit.issues.update({
      issue_number: ISSUE_NUMBER,
      owner: "eps1lon",
      repo: "vax-notify",
      body: markdown,
    });
  }
}

/**
 * @param {VaxDates} dates
 * @param {VaxDates} snapshot
 * @param {{dry: boolean; octokit: Octokit}} config
 * @returns {Promise<boolean>}
 */
async function postChangeLogIfChanged(dates, snapshot, config) {
  /**
   * @type {string[]}
   */
  const removedCentres = [];
  /**
   * @type {string[]}
   */
  const addedCentres = [];
  /**
   * @type {Record<keyof VaxDates, {old: VaxDates[string], new: VaxDates[string]}>}
   */
  const changedDates = {};

  const allGroupdIds = new Set([
    ...Object.keys(dates),
    ...Object.keys(snapshot),
  ]);
  allGroupdIds.forEach((id) => {
    if (snapshot[id] !== undefined && dates[id] === undefined) {
      removedCentres.push(id);
    } else if (snapshot[id] === undefined && dates[id] !== undefined) {
      addedCentres.push(id);
    } else {
      const didChange = snapshot[id] !== dates[id];

      if (didChange) {
        changedDates[id] = { old: snapshot[id], new: dates[id] };
      }
    }
  });

  const didAddCentres = Object.keys(addedCentres).length > 0;
  const didRemoveCentres = Object.keys(removedCentres).length > 0;
  const didChangeDates = Object.keys(changedDates).length > 0;

  const didChange = didAddCentres || didRemoveCentres || didChangeDates;

  if (!didChange) {
    return false;
  }

  let markdown = `
 ### Änderungen am ${new Date().toISOString()}  
`;

  if (didAddCentres) {
    markdown += `\n#### Neue Zentren\n${Object.entries(addedCentres)
      .map(([name, dates]) => {
        return `* ${name}: ${dates}`;
      })
      .join("\n")}`;
  }

  if (didRemoveCentres) {
    markdown += `\n#### GElöschte Zentren\n${Object.entries(removedCentres)
      .map(([name, dates]) => {
        return `* ${name}: ${dates}`;
      })
      .join("\n")}`;
  }

  if (didChangeDates) {
    markdown += `\n#### Geänderted Gruppen\n${Object.entries(changedDates)
      .map(([name, change]) => {
        return `* ${name}
  \`\`\`diff
  - ${change.old}
  + ${change.new}
  \`\`\``;
      })
      .join("\n")}`;
  }

  if (config.dry) {
    console.log(markdown);
  } else {
    await config.octokit.issues.createComment({
      issue_number: ISSUE_NUMBER,
      owner: "eps1lon",
      repo: "vax-notify",
      body: markdown,
    });
  }

  return true;
}

/**
 * @param {{browser: playwright.Browser, dry: boolean, octokit: Octokit, snapshotPath: string}} config
 * @returns {Promise<void>}
 */
async function updateFreeDates(config) {
  const [freeDates, snapshot] = await Promise.all([
    loadCurrentFreeDates(config),
    loadFreeDatesSnapshot(),
  ]);

  await Promise.all([
    updateSummary(freeDates, config),
    postChangeLogIfChanged(freeDates, snapshot, config),
  ]);

  await saveFreeDates(freeDates, config);
}

async function setup() {
  const browserLaunch = playwright.chromium.launch();

  const [browser] = await Promise.all([browserLaunch]);
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  return {
    browser,
    octokit,
    teardown: async () => {
      await Promise.all([browser.close()]);
    },
  };
}

async function main() {
  const { browser, octokit, teardown } = await setup();

  const dry = process.argv.slice(2).includes("--dry");
  const snapshotPath = new URL("../data/freeDates.json", import.meta.url)
    .pathname;

  try {
    await updateFreeDates({
      browser,
      dry,
      octokit,
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
