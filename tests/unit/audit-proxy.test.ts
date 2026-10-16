import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AuditLog } from "../../src/safety/audit.js";
import { registerSecret } from "../../src/utils/secrets.js";
import { proxyFromEnv } from "../../src/utils/proxy.js";
import { describeNetworkError } from "../../src/utils/network.js";
import { auditPath } from "../helpers.js";

describe("audit log", () => {
  it("appends JSON lines and masks secrets", () => {
    const path = auditPath();
    registerSecret("super-secret-value-123");
    const log = new AuditLog(path);
    log.write({ instance: "trial", tool: "t", resource: "Report", action: "update", ids: [1], status: "error", error: "failed with super-secret-value-123" });
    log.write({ instance: "trial", tool: "t", resource: "Report", action: "create", ids: [2], status: "ok" });
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].error).toBe("failed with ***");
    expect(lines[0].time).toMatch(/^\d{4}-/);
  });

  it("can be turned off", () => {
    expect(new AuditLog("off").path).toBeNull();
  });
});

describe("proxy and network errors", () => {
  it("reads proxy variables in either case", () => {
    expect(proxyFromEnv({})).toBeUndefined();
    expect(proxyFromEnv({ https_proxy: "http://127.0.0.1:3128" })).toBe("http://127.0.0.1:3128");
    expect(proxyFromEnv({ HTTPS_PROXY: "http://a:1", HTTP_PROXY: "http://b:2" })).toBe("http://a:1");
  });

  it("explains a proxy refusal", () => {
    const err = Object.assign(new TypeError("fetch failed"), { cause: { message: "Proxy response (403) !== 200 when HTTP Tunneling" } });
    expect(describeNetworkError(err)).toMatch(/proxy refused the connection with HTTP 403/);
  });
});
