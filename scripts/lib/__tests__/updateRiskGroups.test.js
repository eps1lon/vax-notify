import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Octokit } from "@octokit/rest";
import * as fs from "fs/promises";
import nock from "nock";
import * as os from "os";
import * as path from "path";
import playwright from "playwright";
import * as url from "url";
import updateRiskGroups from "../updateRiskGroups.js";

describe("updateRiskGroups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * @type {import('playwright').Browser}
   */
  let browser;
  beforeAll(async () => {
    browser = await playwright.chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(() => {
    nock.disableNetConnect();
    if (!nock.isActive()) {
      nock.activate();
    }
  });
  afterEach(() => {
    nock.cleanAll();
    nock.restore();
    nock.enableNetConnect();
  });

  describe("happy path", () => {
    /**
     * @type {string}
     */
    let snapshotDir;
    beforeAll(async () => {
      snapshotDir = path.resolve(
        os.tmpdir(),
        "vax-notify/risk-group-snapshots"
      );
      await fs.mkdir(snapshotDir, { recursive: true });
    });

    test("works", async () => {
      const eligibleGroupsUpdatedHook = new url.URL(
        "v1/integrations/deploy/foo/bar",
        "https://api.vercel.com/"
      );
      const octokit = new Octokit();
      const snapshotPath = path.resolve(
        snapshotDir,
        `./${new Date().toISOString()}.json`
      );

      const github = nock("https://api.github.com")
        .patch("/repos/eps1lon/vax-notify/issues/1", ({ body }) => {
          return /\nlast update: .+\n/.test(body);
        })
        .reply(200)
        .post("/repos/eps1lon/vax-notify/issues/1/comments", ({ body }) => {
          return /### Änderungen am /.test(body) && /Neue Gruppen/.test(body);
        })
        .reply(200);
      const s3 = nock("https://vax-notify.s3.eu-central-1.amazonaws.com")
        .get("/data/eligibleGroups.json")
        .reply(200, {
          groups: {
            "gwt-uid-a": {
              label: "will be deleted",
            },
          },
          lastUpdated: "2021-04-06T08:49:01.445Z",
        });
      const vercel = nock(`${eligibleGroupsUpdatedHook.origin}`)
        .get(eligibleGroupsUpdatedHook.pathname)
        .reply(200, { mocked: true });

      jest.spyOn(console, "log").mockImplementation(() => {
        // silence console logs
      });

      await updateRiskGroups({
        browser,
        dry: false,
        eligibleGroupsUpdatedHook: eligibleGroupsUpdatedHook.toString(),
        octokit,
        snapshotPath,
      });

      expect(github.isDone()).toEqual(true);
      expect(s3.isDone()).toEqual(true);
      expect(vercel.isDone()).toEqual(true);
      await expect(
        fs
          .readFile(snapshotPath, { encoding: "utf-8" })
          .then((json) => JSON.parse(json))
      ).resolves.toMatchObject({
        lastUpdated: expect.anything(),
        groups: expect.objectContaining({}),
      });
      expect(console.log).toHaveBeenNthCalledWith(1, { mocked: true });
    });
  });
});
