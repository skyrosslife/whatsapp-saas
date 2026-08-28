import { vi } from "vitest";

export interface QueryResult {
  data: unknown;
  error: unknown;
}

export interface TableStub {
  /** Result returned by .single()/.maybeSingle()/await. Override per test. */
  result: QueryResult;
  /** Captured payloads from insert/update/upsert calls, in order. */
  writes: { op: "insert" | "update" | "upsert"; payload: unknown }[];
  /** Captured .eq() filters, in order. */
  filters: { col: string; val: unknown }[];
}

export interface SupabaseMock {
  client: {
    from: ReturnType<typeof vi.fn>;
  };
  /** Per-table stub. Access/mutate `.result` before the code under test runs. */
  table: (name: string) => TableStub;
}

export function makeSupabaseMock(): SupabaseMock {
  const tables = new Map<string, TableStub>();

  const getTable = (name: string): TableStub => {
    let t = tables.get(name);
    if (!t) {
      t = { result: { data: null, error: null }, writes: [], filters: [] };
      tables.set(name, t);
    }
    return t;
  };

  const from = vi.fn((name: string) => {
    const t = getTable(name);
    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    builder.select = vi.fn(chain);
    builder.order = vi.fn(chain);
    builder.limit = vi.fn(chain);
    builder.gt = vi.fn((col: string, val: unknown) => {
      t.filters.push({ col, val });
      return builder;
    });
    builder.not = vi.fn((col: string, op: unknown, val: unknown) => {
      t.filters.push({ col, val: `${op}:${val}` });
      return builder;
    });
    builder.eq = vi.fn((col: string, val: unknown) => {
      t.filters.push({ col, val });
      return builder;
    });
    builder.insert = vi.fn((payload: unknown) => {
      t.writes.push({ op: "insert", payload });
      return builder;
    });
    builder.update = vi.fn((payload: unknown) => {
      t.writes.push({ op: "update", payload });
      return builder;
    });
    builder.upsert = vi.fn((payload: unknown) => {
      t.writes.push({ op: "upsert", payload });
      return builder;
    });
    builder.single = vi.fn(() => Promise.resolve(t.result));
    builder.maybeSingle = vi.fn(() => Promise.resolve(t.result));
    // Awaiting the builder itself (no .single()) resolves to the result.
    builder.then = (resolve: (v: QueryResult) => unknown) => resolve(t.result);

    return builder;
  });

  return { client: { from }, table: getTable };
}
