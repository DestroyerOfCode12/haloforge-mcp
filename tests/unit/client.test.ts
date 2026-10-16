import { describe, it, expect, vi } from "vitest";
import { HaloClient } from "../../src/client/halo-client.js";
import { loadInstances } from "../../src/types/config.js";
import { maskSecrets } from "../../src/utils/secrets.js";
import { json, mockFetch, singleEnv } from "../helpers.js";

function client() {
  const { instances } = loadInstances(singleEnv());
  return new HaloClient(instances[0], { maxRetries: 2, baseBackoffMs: 1 });
}

describe("client reliability", () => {
  it("retries a GET after a server error", async () => {
    let n = 0;
    const http = mockFetch(() => (++n === 1 ? json({ message: "busy" }, 503) : [{ id: 1 }]));
    const res = await client().list("/Status");
    expect(res.data).toEqual([{ id: 1 }]);
    expect(http.calls).toHaveLength(2);
  });

  it("never retries a POST after a server error, so a create cannot be sent twice", async () => {
    const http = mockFetch(() => json({ message: "boom" }, 500));
    await expect(client().post("/TicketType", { name: "x" })).rejects.toThrow(/500/);
    expect(http.calls).toHaveLength(1);
  });

  it("retries a POST on 429 because Halo did not process it", async () => {
    let n = 0;
    const http = mockFetch(() => (++n === 1 ? new Response("", { status: 429, headers: { "Retry-After": "0" } }) : { id: 1 }));
    await client().post("/TicketType", { name: "x" });
    expect(http.calls).toHaveLength(2);
  });

  it("retries a GET after a network error and reports clearly when it keeps failing", async () => {
    const fn = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith("/auth/token")) return json({ access_token: "abcdef0123456789", expires_in: 3600 });
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    });
    vi.stubGlobal("fetch", fn);
    await expect(client().list("/Status")).rejects.toThrow(/Could not reach instance "default" \(ECONNRESET\)/);
    expect(fn.mock.calls.filter((c) => !String(c[0]).endsWith("/auth/token"))).toHaveLength(3);
  });

  it("gives a clear auth error that never includes the secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "invalid_client", error_description: "bad credentials" }, 401))
    );
    const err = await client().list("/Status").catch((e: Error) => e);
    expect(String(err)).toMatch(/Authentication failed for instance "default" \(HTTP 401\).*invalid_client.*CLIENT_SECRET/);
    expect(String(err)).not.toContain("single-secret-value-xyz");
  });

  it("refreshes the token once on a 401", async () => {
    let n = 0;
    const http = mockFetch(() => (++n === 1 ? json({}, 401) : [{ id: 1 }]));
    await client().list("/Status");
    expect(http.calls).toHaveLength(2);
    expect(http.fn.mock.calls.filter((c) => String(c[0]).endsWith("/auth/token"))).toHaveLength(2);
  });

  it("masks registered secrets and bearer tokens", () => {
    loadInstances(singleEnv());
    expect(maskSecrets("x single-secret-value-xyz y")).toBe("x *** y");
    expect(maskSecrets("Authorization: Bearer abcdefghijklmnop")).toBe("Authorization: Bearer ***");
  });
});
