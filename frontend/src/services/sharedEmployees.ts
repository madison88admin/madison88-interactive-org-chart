import type { Employee } from "../utils/org";

const SHARED_EMPLOYEES_ENDPOINT = "/.netlify/functions/employees";

type SharedEmployeesResponse = {
  data?: Employee[] | null;
  updatedAt?: string;
};

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
  const response = await fetch(SHARED_EMPLOYEES_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 404) {
    return { data: null, updatedAt: null };
  }
  if (!response.ok) {
    throw new Error(`Shared load failed (${response.status})`);
  }

  const body = (await response.json()) as SharedEmployeesResponse;
  const employees = asEmployees(body.data);
  return {
    data: employees && employees.length > 0 ? employees : null,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null
  };
};

export const saveSharedEmployees = async (employees: Employee[]): Promise<void> => {
  const response = await fetch(SHARED_EMPLOYEES_ENDPOINT, {
    method: "PUT",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data: employees })
  });

  if (!response.ok) {
    throw new Error(`Shared save failed (${response.status})`);
  }
};
