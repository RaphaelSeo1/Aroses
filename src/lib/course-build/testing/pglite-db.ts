import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { CourseBuildStore, type RpcFn } from "../store.ts";

const MIGRATION = new URL("../../../../supabase/migrations/115_course_builds.sql", import.meta.url);

/** Minimal stand-ins for the Supabase objects migration 115 references. */
const SUPABASE_STUBS = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function public.is_app_super_admin() returns boolean language sql stable as $$ select false $$;
  create table public.courses (id uuid primary key, user_id uuid);
  create table public.exam_groups (id uuid primary key, course_id uuid);
  create table public.study_materials (id uuid primary key, course_id uuid);
`;

export type TestDb = {
  db: PGlite;
  store: CourseBuildStore;
  rpc: RpcFn;
  /** Makes rpc calls fail, to test fail-closed behavior. */
  breakRpc: (broken: boolean) => void;
  createUser: () => Promise<string>;
  createBuild: (opts: {
    userId: string;
    spendCapUsd?: number;
    dailyCapUsd?: number;
    sourcePages?: number;
  }) => Promise<string>;
  addStep: (buildId: string, step: { kind: string; ordinal?: number; wave: number; maxAttempts?: number; input?: unknown }) => Promise<string>;
  steps: (buildId: string) => Promise<Array<Record<string, unknown>>>;
  build: (buildId: string) => Promise<Record<string, unknown>>;
  ledger: (buildId: string) => Promise<Array<Record<string, unknown>>>;
  close: () => Promise<void>;
};

function toParam(v: unknown): unknown {
  if (v != null && typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);
  await db.exec(readFileSync(MIGRATION, "utf8"));

  let broken = false;
  const rpc: RpcFn = async (fn, args) => {
    if (broken) return { data: null, error: { message: "connection refused" } };
    const keys = Object.keys(args);
    const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    try {
      const res = await db.query(sql, keys.map((k) => toParam(args[k])));
      return { data: res.rows, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  };

  const createUser = async () => {
    const id = randomUUID();
    await db.query("insert into auth.users (id) values ($1)", [id]);
    return id;
  };

  const createBuild: TestDb["createBuild"] = async (opts) => {
    const courseId = randomUUID();
    await db.query("insert into public.courses (id, user_id) values ($1, $2)", [courseId, opts.userId]);
    const res = await db.query<{ id: string }>(
      `insert into public.course_builds (user_id, course_id, source_pages, spend_cap_usd, daily_cap_usd)
       values ($1, $2, $3, $4, $5) returning id`,
      [opts.userId, courseId, opts.sourcePages ?? 10, opts.spendCapUsd ?? 1, opts.dailyCapUsd ?? 10]
    );
    return res.rows[0].id;
  };

  const addStep: TestDb["addStep"] = async (buildId, step) => {
    const res = await db.query<{ id: string }>(
      `insert into public.course_build_steps (build_id, kind, ordinal, wave, max_attempts, input)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [buildId, step.kind, step.ordinal ?? 0, step.wave, step.maxAttempts ?? 3, JSON.stringify(step.input ?? {})]
    );
    return res.rows[0].id;
  };

  return {
    db,
    store: new CourseBuildStore(rpc),
    rpc,
    breakRpc: (b) => {
      broken = b;
    },
    createUser,
    createBuild,
    addStep,
    steps: async (buildId) =>
      (
        await db.query<Record<string, unknown>>(
          "select * from public.course_build_steps where build_id = $1 order by wave, ordinal, kind",
          [buildId]
        )
      ).rows,
    build: async (buildId) =>
      (await db.query<Record<string, unknown>>("select * from public.course_builds where id = $1", [buildId])).rows[0],
    ledger: async (buildId) =>
      (
        await db.query<Record<string, unknown>>(
          "select * from public.course_build_ai_ledger where build_id = $1 order by created_at, id",
          [buildId]
        )
      ).rows,
    close: () => db.close(),
  };
}
