import type { Employee } from "../utils/org";
import { getSupabaseClient } from "./supabaseClient";

const SHARED_SUPABASE_TABLE = (import.meta.env.VITE_SUPABASE_ORG_TABLE as string | undefined) || "org_shared_state";
const SHARED_SUPABASE_ROW_ID = (import.meta.env.VITE_SUPABASE_ORG_ROW_ID as string | undefined) || "employees";

export type SharedEmployeesPayload = {
  data: Employee[] | null;
  updatedAt: string | null;
};

const asEmployees = (value: unknown): Employee[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  return value as Employee[];
};

export const loadSharedEmployees = async (): Promise<SharedEmployeesPayload> => {
  const supabase = getSupabaseClient();
  const { data, error } = await (supabase as any)
    .from(SHARED_SUPABASE_TABLE)
    .select("data, updated_at")
    .eq("id", SHARED_SUPABASE_ROW_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`Shared load failed (Supabase: ${error.message})`);
  }

  const row = data as { data?: unknown; updated_at?: unknown } | null;
  const employees = asEmployees(row?.data);
  return {
    data: employees && employees.length > 0 ? employees : null,
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null
  };
};

export const saveSharedEmployees = async (employees: Employee[]): Promise<void> => {
  const supabase = getSupabaseClient();
  const { error } = await (supabase as any).from(SHARED_SUPABASE_TABLE).upsert(
    {
      id: SHARED_SUPABASE_ROW_ID,
      data: employees,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );
  if (error) {
    throw new Error(`Shared save failed (Supabase: ${error.message})`);
  }
};
