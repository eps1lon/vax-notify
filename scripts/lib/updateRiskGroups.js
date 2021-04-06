//@ts-check
import fetch from "cross-fetch";
import * as fs from "fs/promises";
import * as path from "path";

// https://github.com/eps1lon/vax-notify/issues/1+
const ISSUE_NUMBER = 1;

/**
 * @typedef {Record<string, {label: string}>} EligibleGroups
 */

/**
 * @param {{browser: import('playwright').Browser}} config
 * @returns {Promise<EligibleGroups>}
 */
async function loadCurrentRiskGroups(config) {
  const context = await config.browser.newContext();

  const landingPage = await context.newPage();
  await landingPage.goto("https://sachsen.impfterminvergabe.de/");

  /**
   * @type {Promise<import('playwright').Page>}
   */
  const eligibilityPagePromise = new Promise((resolve) => {
    context.addListener("page", (newPage) => {
      resolve(newPage);
    });
  });

  {
    const targetPage = landingPage;
    const frame = targetPage.mainFrame();
    const element = await frame.waitForSelector("text='Weiter'");
    await element.click();
  }

  const eligibilityPage = await eligibilityPagePromise;
  await eligibilityPage.waitForSelector('h2:has-text("Berechtigungsprüfung")');

  /**
   * @type {EligibleGroups}
   */
  const eligibleGroups = {};

  const checkboxes = await eligibilityPage.$$('input[type="checkbox"]');
  await Promise.all(
    checkboxes.map(async ($checkbox) => {
      const axNode = await eligibilityPage.accessibility.snapshot({
        root: $checkbox,
      });
      if (axNode === null) {
        throw new TypeError("Unable to compute axNode for checkbox.");
      }

      const id = await $checkbox.getAttribute("id");
      if (id === null) {
        throw new TypeError("Unable to determine an ID for this group.");
      }

      eligibleGroups[id] = { label: axNode.name };
    })
  );

  return eligibleGroups;
}

/**
 * @returns {Promise<EligibleGroups>}
 */
async function loadRiskGroupsSnapshot() {
  const response = await fetch(
    "https://vax-notify.s3.eu-central-1.amazonaws.com/data/eligibleGroups.json"
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
 * @param {EligibleGroups} groups
 * @param {{snapshotPath: string}} config
 */
async function saveRiskGroups(groups, config) {
  await fs.mkdir(path.dirname(config.snapshotPath), { recursive: true });
  await fs.writeFile(
    config.snapshotPath,
    JSON.stringify({ groups, lastUpdated: new Date().toISOString() }, null, 2)
  );
}

/**
 *
 * @param {EligibleGroups} groups
 * @param {{dry: boolean,octokit: import('@octokit/rest').Octokit}} config
 * @returns {Promise<void>}
 */
async function updateSummary(groups, config) {
  const markdown = `
last update: ${new Date().toISOString()}

${Object.entries(groups)
  .map(([, group]) => {
    return `* ${group.label}`;
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
 * @param {EligibleGroups} groups
 * @param {EligibleGroups} snapshot
 * @param {{dry: boolean; octokit: import('@octokit/rest').Octokit}} config
 * @returns {Promise<boolean>}
 */
async function postChangeLogIfChanged(groups, snapshot, config) {
  /**
   * @type {EligibleGroups}
   */
  const removedGroups = {};
  /**
   * @type {EligibleGroups}
   */
  const addedGroups = {};
  /**
   * @type {Record<keyof EligibleGroups, {old: EligibleGroups[string], new: EligibleGroups[string]}>}
   */
  const changedGroups = {};

  const allGroupdIds = new Set([
    ...Object.keys(groups),
    ...Object.keys(snapshot),
  ]);
  allGroupdIds.forEach((id) => {
    if (snapshot[id] !== undefined && groups[id] === undefined) {
      removedGroups[id] = snapshot[id];
    } else if (snapshot[id] === undefined && groups[id] !== undefined) {
      addedGroups[id] = groups[id];
    } else {
      const labelChanged = snapshot[id].label !== groups[id].label;
      const didChange = labelChanged;

      if (didChange) {
        changedGroups[id] = { old: snapshot[id], new: groups[id] };
      }
    }
  });

  const didAddGroups = Object.keys(addedGroups).length > 0;
  const didRemoveGroups = Object.keys(removedGroups).length > 0;
  const didChangeGroups = Object.keys(changedGroups).length > 0;

  const didChange = didAddGroups || didRemoveGroups || didChangeGroups;

  if (!didChange) {
    return false;
  }

  let markdown = `
 ### Änderungen am ${new Date().toISOString()}  
`;

  if (didAddGroups) {
    markdown += `\n#### Neue Gruppen\n${Object.entries(addedGroups)
      .map(([, group]) => {
        return `* ${group.label}`;
      })
      .join("\n")}`;
  }

  if (didRemoveGroups) {
    markdown += `\n#### Gelöschte Gruppen\n${Object.entries(removedGroups)
      .map(([, group]) => {
        return `* ${group.label}`;
      })
      .join("\n")}`;
  }

  if (didChangeGroups) {
    markdown += `\n#### Geänderted Gruppen\n${Object.entries(changedGroups)
      .map(([, change]) => {
        return `* 
  \`\`\`diff
  - ${change.old.label}
  + ${change.new.label}
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
 * @param {{browser: import('playwright').Browser, dry: boolean, eligibleGroupsUpdatedHook: string | undefined, octokit: import('@octokit/rest').Octokit, snapshotPath: string}} config
 * @returns {Promise<void>}
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- this is a JS file
export default async function updateRiskGroups(config) {
  const [groups, snapshot] = await Promise.all([
    loadCurrentRiskGroups(config),
    loadRiskGroupsSnapshot(),
  ]);

  const [, didChange] = await Promise.all([
    updateSummary(groups, config),
    postChangeLogIfChanged(groups, snapshot, config),
  ]);
  await saveRiskGroups(groups, config);

  if (didChange && !config.dry) {
    if (config.eligibleGroupsUpdatedHook === undefined) {
      throw new TypeError(
        "Either run with --dry or set `ELIGIBLE_GROUPS_UPDATED_HOOK` environment variable."
      );
    }

    const hookResponse = await fetch(config.eligibleGroupsUpdatedHook);
    if (!hookResponse.ok) {
      throw new Error(
        `Failed to trigger deploy hook. ${hookResponse.status}: ${hookResponse.statusText}`
      );
    }

    console.log(await hookResponse.json());
  }
}
