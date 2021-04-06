//@ts-check
import { Octokit } from "@octokit/rest";
import fetch from "cross-fetch";
import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import * as playwright from "playwright";
import { URL } from "url";
import updateRiskGroups from "./lib/updateRiskGroups";

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

/**
 * @returns {Promise<void>}
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- this is a JS file
export default async function main() {
  const { browser, octokit, teardown } = await setup();

  const dry = process.argv.slice(2).includes("--dry");
  const eligibleGroupsUpdatedHook = process.env.ELIGIBLE_GROUPS_UPDATED_HOOK;
  const snapshotPath = new URL("../data/eligibleGroups.json", import.meta.url)
    .pathname;

  try {
    await updateRiskGroups({
      browser,
      dry,
      eligibleGroupsUpdatedHook,
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
