import { Schema } from "effect";
import { ENGINE_IDS, type InstanceRecord } from "../contracts";
const HandleReferenceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("process"), pid: Schema.Number, processGroupId: Schema.NullOr(Schema.Number), sessionId: Schema.NullOr(Schema.Number), startToken: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("docker"), containerId: Schema.String, daemonId: Schema.String, executablePath: Schema.String, executableToken: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("docker-pending"), containerName: Schema.String, nonce: Schema.String, daemonId: Schema.String, executablePath: Schema.String, executableToken: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("remote"), nodeId: Schema.String, name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("pinned"), holder: Schema.String }),
]);
const InstanceRecordSchema = Schema.Struct({ name: Schema.String, nodeId: Schema.String, engine: Schema.Literals(ENGINE_IDS), recipeId: Schema.String,
  runtime: Schema.Literals(["docker"]), ref: Schema.NullOr(HandleReferenceSchema), port: Schema.Number, devices: Schema.Array(Schema.String),
  nonce: Schema.String, startedAt: Schema.String, readyDeadlineAt: Schema.String });
export const decodeInstanceRecord = (value: unknown): InstanceRecord =>
  Schema.decodeUnknownSync(InstanceRecordSchema)(value) as InstanceRecord;
