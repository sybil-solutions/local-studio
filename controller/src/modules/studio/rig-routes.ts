import { randomUUID } from "node:crypto";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import {
  RigCreateSchema,
  RigNodeCreateSchema,
  RigNodeUpdateSchema,
  RigUpdateSchema,
  type Rig,
  type RigAccelerator,
  type RigNode,
  type RigsPayload,
} from "@local-studio/contracts/rigs";
import { Effect } from "effect";
import type { Schema } from "effect";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import type { RouteRegistrar } from "../../http/route-registrar";
import { Event } from "../system/event-manager";
import {
  buildDetectedNode,
  refreshLocalNode,
  seedDefaultRig,
  LOCAL_RIG_NODE_ID,
} from "./rig-detection";

const requiredName = (value: string): Effect.Effect<string, ReturnType<typeof badRequest>> => {
  const name = value.trim();
  return name ? Effect.succeed(name) : Effect.fail(badRequest("name is required"));
};

const optionalString = (
  value: string | null | undefined,
  current: string | null,
): string | null => {
  if (value === undefined) return current;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const positiveOrNull = (
  value: number | null | undefined,
  current: number | null,
  label: string,
): Effect.Effect<number | null, ReturnType<typeof badRequest>> => {
  if (value === undefined) return Effect.succeed(current);
  if (value === null) return Effect.succeed(null);
  return Number.isFinite(value) && value > 0
    ? Effect.succeed(value)
    : Effect.fail(badRequest(`${label} must be a positive number`));
};

type AcceleratorInput = Schema.Schema.Type<typeof RigNodeCreateSchema>["accelerators"] extends
  | ReadonlyArray<infer A>
  | undefined
  ? A
  : never;

const accelerators = (
  value: ReadonlyArray<AcceleratorInput> | undefined,
  current: RigAccelerator[],
): Effect.Effect<RigAccelerator[], ReturnType<typeof badRequest>> =>
  value === undefined
    ? Effect.succeed(current)
    : Effect.forEach(value, (entry) =>
        Effect.gen(function* () {
          const name = yield* requiredName(entry.name);
          const count = entry.count ?? 1;
          if (!Number.isInteger(count) || count < 1) {
            return yield* Effect.fail(badRequest("accelerator count must be a positive integer"));
          }
          const memoryGb = yield* positiveOrNull(entry.memory_gb, null, "accelerator memory_gb");
          const bandwidth = yield* positiveOrNull(
            entry.memory_bandwidth_gbs,
            null,
            "accelerator memory_bandwidth_gbs",
          );
          return {
            name,
            count,
            memory_gb: memoryGb,
            memory_type: optionalString(entry.memory_type, null),
            memory_bandwidth_gbs: bandwidth,
            unified_memory: entry.unified_memory ?? false,
          };
        }),
      );

export const registerStudioRigRoutes: RouteRegistrar = (app, context) => {
  const store = context.stores.rigStore;

  const listRigs = store.listEffect();
  const getRig = (rigId: string): Effect.Effect<Rig | null, unknown> => store.getEffect(rigId);
  const saveRig = (rig: Rig): Effect.Effect<void, unknown> => store.saveEffect(rig);
  const deleteRig = (rigId: string): Effect.Effect<boolean, unknown> => store.deleteEffect(rigId);
  const publishRigUpdate = (): Effect.Effect<void, unknown> =>
    context.eventManager.publish(new Event(CONTROLLER_EVENTS.RIG_UPDATED, {}));
  const loadRigsWithLocalNode = Effect.gen(function* () {
    const rigs = yield* listRigs;
    const detected = yield* buildDetectedNode();
    const refreshed = refreshLocalNode(rigs, detected);
    if (refreshed) {
      yield* saveRig(refreshed);
      return rigs;
    }
    const seeded = seedDefaultRig(detected);
    yield* saveRig(seeded);
    return [...rigs, seeded];
  });
  const requireRig = (rigId: string): Effect.Effect<Rig, unknown> =>
    getRig(rigId).pipe(
      Effect.flatMap((rig) =>
        rig ? Effect.succeed(rig) : Effect.fail(notFound(`Rig "${rigId}" not found`)),
      ),
    );
  const saveRigTouched = (rig: Rig): Effect.Effect<Rig, unknown> => {
    const touched = { ...rig, updated_at: new Date().toISOString() };
    return saveRig(touched).pipe(Effect.as(touched));
  };

  app.get(
    "/studio/rigs",
    effectHandler((ctx) =>
      loadRigsWithLocalNode.pipe(
        Effect.map((rigs) => {
          const payload: RigsPayload = { rigs, local_node_id: LOCAL_RIG_NODE_ID };
          return ctx.json(payload);
        }),
      ),
    ),
  );

  app.post(
    "/studio/rigs",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, RigCreateSchema);
        const now = new Date().toISOString();
        const rig: Rig = {
          id: randomUUID(),
          name: yield* requiredName(body.name),
          description: optionalString(body.description, null),
          nodes: [],
          created_at: now,
          updated_at: now,
        };
        yield* saveRig(rig);
        yield* publishRigUpdate();
        return ctx.json({ success: true, rig });
      }),
    ),
  );

  app.put(
    "/studio/rigs/:rigId",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const rig = yield* requireRig(ctx.req.param("rigId") ?? "");
        const body = yield* decodeJsonBody(ctx, RigUpdateSchema);
        const updated = yield* saveRigTouched({
          ...rig,
          name: body.name === undefined ? rig.name : yield* requiredName(body.name),
          description: optionalString(body.description, rig.description),
        });
        yield* publishRigUpdate();
        return ctx.json({ success: true, rig: updated });
      }),
    ),
  );

  app.delete(
    "/studio/rigs/:rigId",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const rigId = ctx.req.param("rigId") ?? "";
        if (!(yield* deleteRig(rigId))) {
          return yield* Effect.fail(notFound(`Rig "${rigId}" not found`));
        }
        yield* publishRigUpdate();
        return ctx.json({ success: true });
      }),
    ),
  );

  app.post(
    "/studio/rigs/:rigId/nodes",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const rig = yield* requireRig(ctx.req.param("rigId") ?? "");
        const body = yield* decodeJsonBody(ctx, RigNodeCreateSchema);
        const node: RigNode = {
          id: randomUUID(),
          name: yield* requiredName(body.name),
          hardware_type: body.hardware_type ?? "custom",
          role: body.role ?? "standalone",
          source: "manual",
          hostname: optionalString(body.hostname, null),
          address: optionalString(body.address, null),
          os: optionalString(body.os, null),
          cpu_model: optionalString(body.cpu_model, null),
          cpu_cores: null,
          memory_gb: yield* positiveOrNull(body.memory_gb, null, "memory_gb"),
          accelerators: yield* accelerators(body.accelerators, []),
          notes: optionalString(body.notes, null),
        };
        const updated = yield* saveRigTouched({ ...rig, nodes: [...rig.nodes, node] });
        yield* publishRigUpdate();
        return ctx.json({ success: true, rig: updated, node });
      }),
    ),
  );

  app.put(
    "/studio/rigs/:rigId/nodes/:nodeId",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const rig = yield* requireRig(ctx.req.param("rigId") ?? "");
        const nodeId = ctx.req.param("nodeId") ?? "";
        const index = rig.nodes.findIndex((node) => node.id === nodeId);
        const current = index >= 0 ? rig.nodes[index] : undefined;
        if (!current) return yield* Effect.fail(notFound(`Node "${nodeId}" not found`));
        const body = yield* decodeJsonBody(ctx, RigNodeUpdateSchema);
        const updatedNode: RigNode = {
          ...current,
          name: body.name === undefined ? current.name : yield* requiredName(body.name),
          hardware_type: body.hardware_type ?? current.hardware_type,
          role: body.role ?? current.role,
          hostname: optionalString(body.hostname, current.hostname),
          address: optionalString(body.address, current.address),
          os: optionalString(body.os, current.os),
          cpu_model: optionalString(body.cpu_model, current.cpu_model),
          memory_gb: yield* positiveOrNull(body.memory_gb, current.memory_gb, "memory_gb"),
          accelerators: yield* accelerators(body.accelerators, current.accelerators),
          notes: optionalString(body.notes, current.notes),
        };
        const nodes = [...rig.nodes];
        nodes[index] = updatedNode;
        const updated = yield* saveRigTouched({ ...rig, nodes });
        yield* publishRigUpdate();
        return ctx.json({ success: true, rig: updated, node: updatedNode });
      }),
    ),
  );

  app.delete(
    "/studio/rigs/:rigId/nodes/:nodeId",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const rig = yield* requireRig(ctx.req.param("rigId") ?? "");
        const nodeId = ctx.req.param("nodeId") ?? "";
        if (nodeId === LOCAL_RIG_NODE_ID) {
          return yield* Effect.fail(badRequest("The detected local node cannot be removed"));
        }
        if (!rig.nodes.some((node) => node.id === nodeId)) {
          return yield* Effect.fail(notFound(`Node "${nodeId}" not found`));
        }
        const updated = yield* saveRigTouched({
          ...rig,
          nodes: rig.nodes.filter((node) => node.id !== nodeId),
        });
        yield* publishRigUpdate();
        return ctx.json({ success: true, rig: updated });
      }),
    ),
  );
};
