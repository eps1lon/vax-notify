//@ts-check
import { Octokit } from "@octokit/rest";
import fetch, { Request } from "cross-fetch";
import * as fs from "fs/promises";
import Mustache from "mustache";
import * as path from "path";
import * as playwright from "playwright";
import { URL } from "url";

/**
 * @typedef {object} Mail
 * @property {(data: { centre: string, freeDates: number }) => Promise<void>} sendFreeDates
 */

const __DEV__ = process.env.NODE_ENV !== "production";
const ISSUE_NUMBER = 8;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

/**
 * @type {Mail}
 */
const dryMail = {
  async sendFreeDates(data) {
    console.log(`${data.freeDates} free dates for centre '${data.centre}'`);
  },
};

const SENDER_ID = 1499870;
const LIST_ID = __DEV__
  ? "9d668146-89c7-47b4-b600-65e1d73ce60f"
  : "a2915f4d-f1af-4968-80a0-54d802ff578a";
/**
 * Mapping from a centre name to a SendGrid suppression_group_id
 * @type {Record<string, number>}
 */
const CENTRE_TO_SUPRESSION_GROUP_ID = {
  "Bautzen IZ": 22686,
  "Belgern IZ": 22687,
  "Borna IZ": 22688,
  "Chemnitz IZ": 22689,
  "Dresden IZ": 22664,
  "Eich IZ": 22690,
  "Erz IZ": 22691,
  "Leipzig Messe IZ": 22692,
  "Löbau IZ": 22693,
  "Mittweida IZ": 22694,
  "Pirna IZ": 22695,
  "Riesa IZ": 22696,
  "Zwickau IZ": 22697,
};

// TESTING
const NOTIFY_ABOUT_NO_DATES = process.argv
  .slice(2)
  .includes("--notify-no-dates");

/**
 * @remarks We observed that for "Dresden IZ" the number of available dates frequently changed between 0-2.
 *          We don't consider these new dates or at least we don't want to send notifications for it.
 * @param {number} oldCount
 * @param {number} newCount
 * @returns {boolean} If change of available dates is not transient
 */
function newDatesAvailable(oldCount, newCount) {
  return oldCount <= 2 && newCount >= 2 && newCount - oldCount >= 2;
}

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
        .match(/^\s*(\d+)\s*(freier Termin|freie Termine)/);
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

  const { dates } = await response.json();
  return dates;
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
 * @param {VaxDates} dates
 * @param {VaxDates} snapshot
 * @param {{ mail: Mail }} config
 * @returns {Promise<void>}
 */
async function sendNewsletterIfNewDatesAvailable(dates, snapshot, config) {
  /**
   * @type {Set<keyof VaxDates>}
   */
  const centresWithNewDates = new Set();
  Object.keys(dates).forEach((centre) => {
    if (newDatesAvailable(snapshot[centre] ?? 0, dates[centre] ?? 0)) {
      centresWithNewDates.add(centre);
    }
  });

  const sendNotificationsFor = NOTIFY_ABOUT_NO_DATES
    ? new Set(Object.keys(dates))
    : centresWithNewDates;

  const results = await Promise.allSettled(
    Array.from(sendNotificationsFor, async (centre) => {
      try {
        await config.mail.sendFreeDates({ centre, freeDates: dates[centre] });
      } catch (error) {
        error.message = `${centre}: ${error.message}`;
        throw error;
      }
    })
  );

  const rejections = results.filter(
    /**
     * @returns {result is PromiseRejectedResult}
     */
    (result) => {
      return result.status === "rejected";
    }
  );
  if (rejections.length > 0) {
    throw new Error(
      `At least one notifications failed:${rejections
        .map((rejection) => {
          return `  ${rejection.reason.stack}`;
        })
        .join("\n")}`
    );
  }
}

/**
 * @param {{browser: playwright.Browser, dry: boolean, mail: Mail, octokit: Octokit, snapshotPath: string}} config
 * @returns {Promise<void>}
 */
async function updateFreeDates(config) {
  const [freeDates, snapshot] = await Promise.all([
    loadCurrentFreeDates(config),
    loadFreeDatesSnapshot(),
  ]);

  await saveFreeDates(freeDates, config);

  const results = await Promise.allSettled([
    updateSummary(freeDates, config),
    postChangeLogIfChanged(freeDates, snapshot, config),
    sendNewsletterIfNewDatesAvailable(freeDates, snapshot, config),
  ]);

  const rejections = results.filter(
    /**
     * @returns {result is PromiseRejectedResult}
     */
    (result) => {
      return result.status === "rejected";
    }
  );
  if (rejections.length > 0) {
    throw new Error(
      `At least one update failed:${rejections
        .map((rejection) => {
          return `  ${rejection.reason}\n  ${rejection.reason.stack}`;
        })
        .join("\n")}`
    );
  }
}

/**
 * @returns {Mail}
 */
function setupSendGrid() {
  /**
   * @param {string} endpoint
   * @param {{method: RequestInit['method'], body: any}} init
   * @returns {Promise<any>}
   */
  async function sgGridRequest(endpoint, init) {
    if (SENDGRID_API_KEY === undefined) {
      throw new TypeError(
        "Need process.env.SENDGRID_API_KEY in order to send mails."
      );
    }
    const request = new Request(
      new URL(`/v3/${endpoint}`, "https://api.sendgrid.com").toString(),
      {
        body: JSON.stringify(init.body),
        headers: {
          Authorization: `Bearer ${SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        method: init.method,
      }
    );
    const response = await fetch(request);

    if (response.ok) {
      return response.json();
    }
    throw new Error(
      `${request.url}: ${response.status} ${response.statusText}`
    );
  }

  return {
    async sendFreeDates(data) {
      const { centre, freeDates } = data;
      const supressionGroupID = CENTRE_TO_SUPRESSION_GROUP_ID[centre];
      if (supressionGroupID === undefined) {
        throw new TypeError(
          `Unable to find supression group ID for centre '${centre}'. Did you mean one of ${Object.keys(
            CENTRE_TO_SUPRESSION_GROUP_ID
          )}?`
        );
      }

      const htmlContent = await fs
        .readFile(new URL("./free-dates.mustache", import.meta.url), {
          encoding: "utf-8",
        })
        .then((template) => {
          return Mustache.render(template, { centre, freeDates });
        });

      const singleSend = await sgGridRequest("/marketing/singlesends", {
        method: "POST",
        body: {
          name: `new dates ${centre}`,
          send_to: {
            list_ids: [LIST_ID],
          },
          email_config: {
            subject: `${centre}: neue Covid-19 Impftermine`,
            html_content: htmlContent,
            suppression_group_id: supressionGroupID,
            sender_id: SENDER_ID,
          },
        },
      });
      console.log(`Created singlesend ${JSON.stringify(singleSend, null, 2)}`);

      const sendAt = new Date(new Date().valueOf() + 1000 * 60).toISOString();
      console.log(`scheduling for ${sendAt}`);
      const scheduled = await sgGridRequest(
        `marketing/singlesends/${singleSend.id}/schedule`,
        {
          method: "PUT",
          body: {
            send_at: sendAt,
          },
        }
      );
      console.log(`scheduled for ${JSON.stringify(scheduled, null, 2)}`);
    },
  };
}

async function setup() {
  const browserLaunch = playwright.chromium.launch();

  const [browser] = await Promise.all([browserLaunch]);
  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  return {
    browser,
    sgGrid: setupSendGrid(),
    octokit,
    teardown: async () => {
      await Promise.all([browser.close()]);
    },
  };
}

async function main() {
  const { browser, octokit, sgGrid, teardown } = await setup();

  const dry = process.argv.slice(2).includes("--dry");
  const useDryMail = process.argv.slice(2).includes("--dryMail");
  const snapshotPath = new URL("../data/freeDates.json", import.meta.url)
    .pathname;

  try {
    await updateFreeDates({
      browser,
      dry,
      mail: useDryMail ? dryMail : sgGrid,
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
