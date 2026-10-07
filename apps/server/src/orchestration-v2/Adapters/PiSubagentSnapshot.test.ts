import { assert, describe, it } from "@effect/vitest";
import { readPiSubagentSnapshot } from "./PiSubagentSnapshot.ts";
import * as Schema from "effect/Schema";
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const widget = (snapshot: unknown) => ({
  type: "extension_ui_request",
  method: "setWidget",
  widgetLines: ["PI_SUBAGENT_ASYNC_JSON:" + encode(snapshot)],
});
describe("Pi subagent snapshots", () => {
  it("keeps nested child identities distinct across workflows and ignores host monitors", () => {
    const result = readPiSubagentSnapshot(
      widget({
        kind: "pi-subagents.async-status-snapshot",
        version: 1,
        runs: [
          {
            id: "a",
            kind: "workflow",
            label: "workflow",
            state: "running",
            children: [
              {
                id: "step:0",
                kind: "step",
                label: "coder",
                state: "running",
                activity: { currentTool: "edit" },
              },
              { id: "monitor", kind: "host-step", label: "watch", state: "running" },
            ],
          },
          {
            id: "b",
            kind: "workflow",
            label: "workflow",
            state: "running",
            children: [{ id: "step:0", kind: "step", label: "reviewer", state: "queued" }],
          },
        ],
      }),
    );
    assert.deepEqual(
      result?.map((row) => row.id),
      ["a", "a/step:0", "b", "b/step:0"],
    );
    assert.equal(result?.[1]?.progress, "edit");
    assert.equal(result?.[3]?.status, "pending");
  });
  it("ignores malformed, unsupported, unrelated and oversized widgets", () => {
    for (const event of [
      { type: "extension_ui_request", method: "setWidget", widgetLines: ["other widget"] },
      {
        type: "extension_ui_request",
        method: "setWidget",
        widgetLines: ["PI_SUBAGENT_ASYNC_JSON:{"],
      },
      widget({ kind: "pi-subagents.async-status-snapshot", version: 2, runs: [] }),
      widget({ kind: "pi-subagents.async-status-snapshot", version: 1, runs: "bad" }),
      widget({
        kind: "pi-subagents.async-status-snapshot",
        version: 1,
        runs: [],
        extra: "a".repeat(65536),
      }),
    ])
      assert.isUndefined(readPiSubagentSnapshot(event));
    assert.deepEqual(
      readPiSubagentSnapshot(
        widget({
          kind: "pi-subagents.async-status-snapshot",
          version: 1,
          runs: [{ id: "bad", label: "bad", state: "constructor" }],
        }),
      ),
      [],
    );
  });
});
