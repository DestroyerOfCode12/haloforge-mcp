import { describe, it, expect } from "vitest";
import { mergeRecord } from "../../src/safety/merge.js";
import { diffRecord, looselyEqual, NOT_SET } from "../../src/safety/diff.js";

const ticketType = {
  id: 7,
  name: "MCP TEST | Incident",
  sequence: 1,
  fields: [
    { fieldid: 10, groupid: 1, seq: 1, techdetail: true },
    { fieldid: 11, groupid: 1, seq: 2, techdetail: true },
    { fieldid: 12, groupid: 2, seq: 3, techdetail: false },
  ],
  userfields: [{ fieldid: 50, seq: 1 }],
};
const rules = { fields: ["fieldid", "id"], userfields: ["fieldid", "id"] };

describe("merge helper", () => {
  it("updates, appends and removes nested items while keeping the rest", () => {
    const { payload, warnings } = mergeRecord(ticketType, {
      id: 7,
      fields: [
        { fieldid: 11, seq: 5 },
        { fieldid: 99, groupid: 2, seq: 6 },
        { fieldid: 12, _remove: true },
      ],
    }, rules);
    expect(warnings).toEqual([]);
    expect(payload).toEqual({
      id: 7,
      fields: [
        { fieldid: 10, groupid: 1, seq: 1, techdetail: true },
        { fieldid: 11, groupid: 1, seq: 5, techdetail: true },
        { fieldid: 99, groupid: 2, seq: 6 },
      ],
    });
    expect(payload).not.toHaveProperty("userfields");
  });

  it("matches ids given as strings and warns when removing something absent", () => {
    const { payload, warnings } = mergeRecord(ticketType, { fields: [{ fieldid: "10", seq: 9 }, { fieldid: 404, _remove: true }] }, rules);
    expect((payload.fields as Array<{ seq: number }>)[0].seq).toBe(9);
    expect(warnings[0]).toMatch(/nothing to remove/);
    expect(payload.id).toBe(7);
  });

  it("replaces arrays on request and can return the full object", () => {
    const { payload } = mergeRecord(ticketType, { fields: [{ fieldid: 10 }] }, rules, { replaceArrays: ["fields"], fullObject: true });
    expect(payload.fields).toEqual([{ fieldid: 10 }]);
    expect(payload.userfields).toEqual(ticketType.userfields);
    expect(payload.name).toBe(ticketType.name);
  });

  it("merges by id by default and warns before replacing an unmatched array", () => {
    const wf = { id: 1, steps: [{ id: 1, name: "A" }, { id: 2, name: "B" }], tags: [{ text: "x" }] };
    const merged = mergeRecord(wf, { steps: [{ id: 2, name: "B2" }], tags: [{ text: "y" }] });
    expect(merged.payload.steps).toEqual([{ id: 1, name: "A" }, { id: 2, name: "B2" }]);
    expect(merged.payload.tags).toEqual([{ text: "y" }]);
    expect(merged.warnings[0]).toMatch(/tags: no match key/);
  });
});

describe("diff", () => {
  it("lists only real changes, item by item in nested arrays", () => {
    const { payload } = mergeRecord(ticketType, { id: 7, name: "MCP TEST | Incident (v2)", sequence: "1", fields: [{ fieldid: 11, seq: 5 }, { fieldid: 99, seq: 6 }, { fieldid: 12, _remove: true }] }, rules);
    const changes = diffRecord(ticketType, payload, rules);
    expect(changes).toEqual([
      { path: "name", before: "MCP TEST | Incident", after: "MCP TEST | Incident (v2)" },
      { path: "fields[fieldid=11].seq", before: 2, after: 5 },
      { path: "fields[fieldid=99]", before: NOT_SET, after: { fieldid: 99, seq: 6 } },
      { path: "fields[fieldid=12]", before: { fieldid: 12, groupid: 2, seq: 3, techdetail: false }, after: NOT_SET },
    ]);
  });

  it("treats a create as all fields new", () => {
    expect(diffRecord(undefined, { name: "x", seq: 1 })).toEqual([
      { path: "name", before: NOT_SET, after: "x" },
      { path: "seq", before: NOT_SET, after: 1 },
    ]);
  });

  it("compares loosely", () => {
    expect(looselyEqual(1, "1")).toBe(true);
    expect(looselyEqual(null, undefined)).toBe(true);
    expect(looselyEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(looselyEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
