const express = require("express");
const cors = require("cors");
const { getOrgChart, listEmployees, getEmployeeById } = require("./utils/orgUtils");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "org-visualization-api" });
});

app.get("/api/employees", (req, res) => {
  const query = req.query.query?.toString() ?? "";
  const employees = listEmployees(query);

  res.json({
    data: employees,
    meta: {
      total: employees.length,
      query,
    },
  });
});

app.get("/api/employees/:id", (req, res) => {
  const employee = getEmployeeById(req.params.id);

  if (!employee) {
    return res.status(404).json({ message: "Employee not found" });
  }

  return res.json({ data: employee });
});

app.get("/api/org-chart", (req, res) => {
  const query = req.query.query?.toString() ?? "";
  const result = getOrgChart(query);

  res.json({
    data: result.tree,
    meta: {
      totalEmployees: result.totalEmployees,
      matchedEmployees: result.matchedEmployees,
      query,
    },
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Org chart API running at http://localhost:${PORT}`);
});
