import { getStore } from "@netlify/blobs";

const STORE_NAME = "madison88_org_chart";
const STORE_KEY = "employees";

const store = getStore(STORE_NAME);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

const asEmployees = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }
  return value;
};

export default async (request) => {
  if (request.method === "GET") {
    const payload = await store.get(STORE_KEY, { type: "json" });
    return json({
      data: asEmployees(payload?.data) ?? null,
      updatedAt: typeof payload?.updatedAt === "string" ? payload.updatedAt : null
    });
  }

  if (request.method === "PUT" || request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ message: "Invalid JSON body." }, 400);
    }

    const employees = asEmployees(body?.data);
    if (!employees) {
      return json({ message: "Expected payload format: { data: Employee[] }." }, 400);
    }

    const updatedAt = new Date().toISOString();
    await store.setJSON(STORE_KEY, { data: employees, updatedAt });
    return json({ ok: true, updatedAt });
  }

  return json({ message: "Method not allowed." }, 405);
};
