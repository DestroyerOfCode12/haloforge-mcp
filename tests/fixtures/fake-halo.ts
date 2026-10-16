/**
 * A small fake Halo API for checking the integration suite itself.
 *
 *   npx tsx tests/fixtures/fake-halo.ts 8787
 *   RUN_INTEGRATION=1 HALO_TRIAL_BASE_URL=http://127.0.0.1:8787 HALO_TRIAL_CLIENT_ID=x \
 *     HALO_TRIAL_CLIENT_SECRET=fake-secret HALO_TRIAL_MODE=write npm run test:integration
 *
 * It stores records in memory, answers list, get and POST for any resource,
 * runs reports, serves report groups (lookup 41) and refuses DELETE. It is not
 * a faithful copy of Halo; it only exercises the suite's own logic.
 */

import { createServer } from "node:http";
import { CONFIG_RESOURCES } from "../../src/catalogue/config-resources.js";

type Obj = Record<string, unknown>;

const db: Record<string, Obj[]> = {};
for (const r of CONFIG_RESOURCES) db[r.resource.toLowerCase()] = [];
db.fieldinfo = [{ id: 10, name: "summary" }, { id: 11, name: "details" }];
db.report = [{ id: 1, name: "Open tickets", group_id: 0, sql: "select 1", charttype: -1 }];
db.lookup = [{ id: 2, lookupid: 41, name: "Default reports" }];
let nextId = 1000;

function send(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (url.pathname === "/auth/token") return send(res, 200, { access_token: "fake-token-0123456789", token_type: "Bearer", expires_in: 32400 });
    const [, api, resourceRaw, id] = url.pathname.split("/");
    if (api !== "api" || !resourceRaw) return send(res, 404, { message: "not found" });
    const resource = resourceRaw.toLowerCase();
    const table = (db[resource] ??= []);
    if (req.method === "DELETE") return send(res, 405, { message: "the fake refuses deletes" });
    if (req.method === "POST") {
      const body = JSON.parse(raw || "[]") as Obj[];
      const saved = body.map((r) => {
        if (r.id !== undefined) {
          const i = table.findIndex((x) => String(x.id) === String(r.id));
          if (i < 0) return r;
          table[i] = { ...table[i], ...r };
          return table[i];
        }
        const created: Obj = { ...r, id: nextId++ };
        if (resource === "tickettype") created.fields = [{ fieldid: 10, groupid: 1, seq: 1 }, { fieldid: 11, groupid: 1, seq: 2 }];
        table.push(created);
        return created;
      });
      return send(res, 200, saved.length === 1 ? saved[0] : saved);
    }
    if (id) {
      const rec = table.find((r) => String(r.id) === id);
      if (!rec) return send(res, 404, { message: "not found" });
      if (resource === "report" && url.searchParams.get("loadreport") === "true") {
        return send(res, 200, { ...rec, report: { rows: [{ Team: "A", Count: 1 }, { Team: "B", Count: 2 }] } });
      }
      return send(res, 200, rec);
    }
    let list = table;
    if (resource === "lookup" && url.searchParams.get("lookupid")) list = list.filter((r) => String(r.lookupid) === url.searchParams.get("lookupid"));
    const size = Number(url.searchParams.get("page_size") || 50);
    const page = Number(url.searchParams.get("page_no") || 1);
    return send(res, 200, { record_count: list.length, records: list.slice((page - 1) * size, page * size) });
  });
});

const port = Number(process.argv[2] || 8787);
server.listen(port, "127.0.0.1", () => process.stderr.write(`Fake Halo on http://127.0.0.1:${port}\n`));
