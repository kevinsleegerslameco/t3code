import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import type { OrchestrationV2Subagent } from "@t3tools/contracts";
import {
  piRecordField as field,
  piRecordString as text,
  piRecordNumber as number,
  type PiRpcRecord,
} from "./PiRpc.ts";

const decodeSnapshot = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const PREFIX = "PI_SUBAGENT_ASYNC_JSON:";
const STATES: Record<string, OrchestrationV2Subagent["status"]> = {
  queued: "pending",
  running: "running",
  complete: "completed",
  failed: "failed",
  partial: "failed",
  paused: "idle",
  stopped: "interrupted",
  rejected: "failed",
};

export interface PiSubagentSnapshotRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly status: OrchestrationV2Subagent["status"];
  readonly startedAt: number | undefined;
  readonly endedAt: number | undefined;
  readonly progress: string | undefined;
}

/** pi-subagents 0.70 emits this bounded, versioned widget in RPC mode. */
export function readPiSubagentSnapshot(
  event: PiRpcRecord,
): ReadonlyArray<PiSubagentSnapshotRow> | undefined {
  if (event["type"] !== "extension_ui_request" || event["method"] !== "setWidget") return undefined;
  const lines = event["widgetLines"];
  if (!Array.isArray(lines)) return undefined;
  const line = lines.find(
    (line): line is string => typeof line === "string" && line.startsWith(PREFIX),
  );
  if (line === undefined || line.length > 64 * 1024) return undefined;
  const decoded = decodeSnapshot(line.slice(PREFIX.length));
  if (Option.isNone(decoded)) return undefined;
  const snapshot = decoded.value;
  if (
    text(snapshot, "kind") !== "pi-subagents.async-status-snapshot" ||
    number(snapshot, "version") !== 1
  )
    return undefined;
  const runs = field(snapshot, "runs");
  if (!Array.isArray(runs)) return undefined;
  const rows: PiSubagentSnapshotRow[] = [];
  const visit = (node: unknown, parentId: string | null, depth: number) => {
    if (depth > 4 || rows.length >= 200 || text(node, "kind") === "host-step") return;
    const id = text(node, "id");
    const label = text(node, "label");
    const state = text(node, "state");
    const status = state === undefined || !Object.hasOwn(STATES, state) ? undefined : STATES[state];
    if (!id || id.length > 160 || !label || status === undefined) return;
    // A step id is local to its parent; the complete path survives reordering.
    const taskId = parentId === null ? id : `${parentId}/${id}`;
    const activity = field(node, "activity");
    const tool = text(activity, "currentTool");
    rows.push({
      id: taskId,
      parentId,
      title: label.slice(0, 160),
      status,
      startedAt: number(node, "startedAt"),
      endedAt: number(node, "endedAt"),
      progress: tool?.slice(0, 200) ?? text(activity, "state")?.slice(0, 200),
    });
    const children = field(node, "children");
    if (Array.isArray(children))
      for (const child of children.slice(0, 8)) visit(child, taskId, depth + 1);
  };
  for (const run of runs.slice(0, 20)) visit(run, null, 0);
  return rows;
}
