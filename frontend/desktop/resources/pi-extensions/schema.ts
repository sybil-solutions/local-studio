// Dependency-free stand-in for the `typebox` Type builders the bundled
// extensions use.
//
// These files are shipped as-is in the packaged app's Resources and loaded by
// pi from disk at runtime. The packaged Resources directory has NO
// node_modules anywhere above it, so a bare runtime import like
// `import { Type } from "typebox"` can never resolve there — it loads fine in
// dev (repo node_modules) and then fails in the packaged app with
// "Cannot find module 'typebox'". Extensions must only use node builtins,
// relative files in this directory, and type-only imports (which the TS
// loader erases before resolution ever happens).
//
// The builders below produce objects byte-for-byte identical to what
// typebox@1.3.7 emits for the subset these extensions use — same enumerable
// JSON-Schema keys in the same order, same non-enumerable '~kind'/'~optional'
// markers — so pi's schema handling (guards, validation, serialization to the
// model API) sees real TypeBox-shaped schemas. The TYPES still come from
// typebox via `import type`, so `Static<typeof Schema>` inference and pi's
// own `registerTool` param typing keep working unchanged under
// `npm run typecheck:extensions`; type-only imports cost nothing at runtime.

import type {
  Static,
  TArray,
  TBoolean,
  TLiteral,
  TLiteralValue,
  TNumber,
  TObject,
  TOptional,
  TProperties,
  TSchema,
  TString,
  TUnion,
  TUnsafe,
} from "typebox";

export type { Static, TSchema };

type SchemaOptions = Record<string, unknown>;

/** Attach TypeBox's non-enumerable marker keys ('~kind', '~optional',
 *  '~unsafe') so guards dispatch correctly while JSON output stays clean. */
function withMarkers<T>(schema: object, markers: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(markers)) {
    Object.defineProperty(schema, key, {
      value,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  return schema as T;
}

function isOptionalSchema(schema: unknown): boolean {
  return (
    typeof schema === "object" &&
    schema !== null &&
    (schema as Record<string, unknown>)["~optional"] === true
  );
}

export const Type = {
  String(options?: SchemaOptions): TString {
    return withMarkers({ type: "string", ...options }, { "~kind": "String" });
  },

  Number(options?: SchemaOptions): TNumber {
    return withMarkers({ type: "number", ...options }, { "~kind": "Number" });
  },

  Boolean(options?: SchemaOptions): TBoolean {
    return withMarkers({ type: "boolean", ...options }, { "~kind": "Boolean" });
  },

  Literal<Value extends TLiteralValue>(value: Value, options?: SchemaOptions): TLiteral<Value> {
    return withMarkers({ type: typeof value, const: value, ...options }, { "~kind": "Literal" });
  },

  Array<Items extends TSchema>(items: Items, options?: SchemaOptions): TArray<Items> {
    return withMarkers({ type: "array", items, ...options }, { "~kind": "Array" });
  },

  Union<Types extends TSchema[]>(anyOf: [...Types], options?: SchemaOptions): TUnion<Types> {
    return withMarkers({ anyOf, ...options }, { "~kind": "Union" });
  },

  Object<Properties extends TProperties>(
    properties: Properties,
    options?: SchemaOptions,
  ): TObject<Properties> {
    const required = Object.keys(properties).filter((key) => !isOptionalSchema(properties[key]));
    return withMarkers(
      {
        type: "object",
        ...(required.length > 0 ? { required } : {}),
        properties,
        ...options,
      },
      { "~kind": "Object" },
    );
  },

  Optional<Schema extends TSchema>(schema: Schema): TOptional<Schema> {
    // Copy with descriptors so the non-enumerable '~kind' marker survives.
    const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(schema));
    return withMarkers(copy, { "~optional": true });
  },

  /** Pass a hand-written JSON Schema through with a chosen static type. */
  Unsafe<Type>(schema: Record<string, unknown>): TUnsafe<Type> {
    return withMarkers({ ...schema }, { "~unsafe": null });
  },
};
