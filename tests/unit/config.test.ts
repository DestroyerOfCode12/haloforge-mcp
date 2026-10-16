import { describe, it, expect } from "vitest";
import { loadInstances } from "../../src/types/config.js";
import { singleEnv, twoInstanceEnv, TRIAL_URL } from "../helpers.js";

describe("instance configuration", () => {
  it("keeps the original single instance variables working with safe defaults", () => {
    const { instances, defaultName } = loadInstances(singleEnv());
    expect(defaultName).toBe("default");
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ name: "default", baseUrl: TRIAL_URL, mode: "read", disableDelete: true, scope: "all" });
    expect(instances[0].writeAllowlist).toBeUndefined();
  });

  it("reads several instances with per instance modes", () => {
    const { instances, defaultName } = loadInstances(twoInstanceEnv());
    expect(defaultName).toBe("trial");
    expect(instances.map((i) => [i.name, i.mode])).toEqual([["trial", "write"], ["prod", "read"]]);
  });

  it("falls back to global safety settings and lets instances override them", () => {
    const env = twoInstanceEnv({ HALO_MODE: "full", HALO_DISABLE_DELETE: "false", HALO_WRITE_ALLOWLIST: "Report, DashboardLinks" });
    delete env.HALO_PROD_MODE;
    env.HALO_TRIAL_DISABLE_DELETE = "true";
    const { instances } = loadInstances(env);
    const [trial, prod] = instances;
    expect(trial.mode).toBe("write");
    expect(trial.disableDelete).toBe(true);
    expect(prod.mode).toBe("full");
    expect(prod.disableDelete).toBe(false);
    expect([...prod.writeAllowlist!]).toEqual(["report", "dashboardlinks"]);
  });

  it("honours HALO_DEFAULT_INSTANCE", () => {
    expect(loadInstances(twoInstanceEnv({ HALO_DEFAULT_INSTANCE: "prod" })).defaultName).toBe("prod");
    expect(() => loadInstances(twoInstanceEnv({ HALO_DEFAULT_INSTANCE: "other" }))).toThrow(/not a configured instance/);
  });

  it("discovers HALO_<NAME>_BASE_URL instances when nothing else is set", () => {
    const env = twoInstanceEnv();
    delete env.HALO_INSTANCES;
    const { instances } = loadInstances(env);
    expect(instances.map((i) => i.name).sort()).toEqual(["prod", "trial"]);
  });

  it("rejects bad modes, missing credentials and bad URLs without echoing secrets", () => {
    expect(() => loadInstances(singleEnv({ HALO_MODE: "admin" }))).toThrow(/read, write or full/);
    const env = twoInstanceEnv();
    delete env.HALO_PROD_CLIENT_SECRET;
    expect(() => loadInstances(env)).toThrow(/HALO_PROD_CLIENT_SECRET/);
    expect(() => loadInstances(singleEnv({ HALO_BASE_URL: "ftp://x" }))).toThrow(/http or https/);
    expect(() => loadInstances({})).toThrow(/No Halo instance configured/);
  });
});
