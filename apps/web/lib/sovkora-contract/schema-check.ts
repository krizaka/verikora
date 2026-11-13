/** The subset of JSON Schema Sovkora's run schema is written in (type, required, properties, items, minItems, minimum). */
export type SchemaNode = {
  type?: string;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  minItems?: number;
  minimum?: number;
};

function kindOf(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  return value === null ? "null" : typeof value;
}

function typeMatches(value: unknown, type: string | undefined): boolean {
  const kind = kindOf(value);
  return (
    !type ||
    type === kind ||
    (type === "integer" && Number.isInteger(value)) ||
    (type === "number" && kind === "number")
  );
}

function objectViolations(value: unknown, schema: SchemaNode, path: string): string[] {
  const object = (value ?? {}) as Record<string, unknown>;
  const missing = (schema.required ?? []).filter((key) => !(key in object)).map((key) => `${path}.${key} is required`);
  const inner = Object.entries(schema.properties ?? {})
    .filter(([key]) => key in object)
    .flatMap(([key, child]) => schemaViolations(object[key], child, `${path}.${key}`));
  return [...missing, ...inner];
}

function arrayViolations(value: unknown[], schema: SchemaNode, path: string): string[] {
  const short =
    schema.minItems !== undefined && value.length < schema.minItems
      ? [`${path}: fewer than ${schema.minItems} items`]
      : [];
  const { items } = schema;
  return [...short, ...(items ? value.flatMap((item, i) => schemaViolations(item, items, `${path}[${i}]`)) : [])];
}

/** What a value breaks in a schema of that subset, as readable lines (empty = valid). Used by the contract test and by the read of a run's report. */
export function schemaViolations(value: unknown, schema: SchemaNode, path = "$"): string[] {
  if (!typeMatches(value, schema.type)) {
    return [`${path}: expected ${schema.type}, got ${kindOf(value)}`];
  }
  const found: string[] = [];
  if (schema.type === "object" || schema.properties || schema.required) {
    found.push(...objectViolations(value, schema, path));
  }
  if (Array.isArray(value)) {
    found.push(...arrayViolations(value, schema, path));
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    found.push(`${path}: below ${schema.minimum}`);
  }
  return found;
}
