const employees = require("../data/employees.json");

const normalize = (value = "") => value.toString().trim().toLowerCase();

const buildEmployeeMap = () => {
  const map = new Map();

  employees.forEach((employee) => {
    map.set(employee.id, {
      ...employee,
      directReports: [],
    });
  });

  map.forEach((employee) => {
    if (employee.managerId && map.has(employee.managerId)) {
      map.get(employee.managerId).directReports.push(employee.id);
    }
  });

  return map;
};

const collectAncestors = (employeeId, map, collector) => {
  let current = map.get(employeeId);

  while (current?.managerId && map.has(current.managerId)) {
    collector.add(current.managerId);
    current = map.get(current.managerId);
  }
};

const collectDescendants = (employeeId, map, collector) => {
  const queue = [employeeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const current = map.get(currentId);

    if (!current) {
      continue;
    }

    current.directReports.forEach((reportId) => {
      collector.add(reportId);
      queue.push(reportId);
    });
  }
};

const createFilterSet = (map, query) => {
  if (!query) {
    return null;
  }

  const term = normalize(query);
  const matches = [];

  map.forEach((employee) => {
    const haystack = `${employee.name} ${employee.title} ${employee.department}`.toLowerCase();
    if (haystack.includes(term)) {
      matches.push(employee.id);
    }
  });

  if (matches.length === 0) {
    return new Set();
  }

  const includedIds = new Set();

  matches.forEach((employeeId) => {
    includedIds.add(employeeId);
    collectAncestors(employeeId, map, includedIds);
    collectDescendants(employeeId, map, includedIds);
  });

  return includedIds;
};

const toTreeNode = (employeeId, map, filterSet, managerName = null) => {
  if (!map.has(employeeId)) {
    return null;
  }

  if (filterSet && !filterSet.has(employeeId)) {
    return null;
  }

  const employee = map.get(employeeId);
  const directReports = employee.directReports
    .map((reportId) => toTreeNode(reportId, map, filterSet, employee.name))
    .filter(Boolean);

  return {
    id: employee.id,
    name: employee.name,
    title: employee.title,
    department: employee.department,
    managerId: employee.managerId,
    managerName,
    directReportIds: employee.directReports,
    directReportNames: employee.directReports
      .map((id) => map.get(id)?.name)
      .filter(Boolean),
    children: directReports,
  };
};

const listEmployees = (query = "") => {
  const map = buildEmployeeMap();
  const normalized = normalize(query);

  return Array.from(map.values())
    .filter((employee) => {
      if (!normalized) {
        return true;
      }

      const haystack = `${employee.name} ${employee.title} ${employee.department}`.toLowerCase();
      return haystack.includes(normalized);
    })
    .map((employee) => ({
      ...employee,
      managerName: employee.managerId ? map.get(employee.managerId)?.name ?? null : null,
      directReportNames: employee.directReports
        .map((id) => map.get(id)?.name)
        .filter(Boolean),
    }));
};

const getEmployeeById = (employeeId) => {
  const map = buildEmployeeMap();

  if (!map.has(employeeId)) {
    return null;
  }

  const employee = map.get(employeeId);

  return {
    ...employee,
    managerName: employee.managerId ? map.get(employee.managerId)?.name ?? null : null,
    directReportNames: employee.directReports
      .map((id) => map.get(id)?.name)
      .filter(Boolean),
  };
};

const getOrgChart = (query = "") => {
  const map = buildEmployeeMap();
  const root = Array.from(map.values()).find((employee) => !employee.managerId);

  if (!root) {
    return { tree: null, totalEmployees: map.size, matchedEmployees: 0 };
  }

  const filterSet = createFilterSet(map, query);
  const tree = toTreeNode(root.id, map, filterSet);

  const matchedEmployees = !query
    ? map.size
    : Array.from(map.values()).filter((employee) => {
        const haystack = `${employee.name} ${employee.title} ${employee.department}`.toLowerCase();
        return haystack.includes(normalize(query));
      }).length;

  return {
    tree,
    totalEmployees: map.size,
    matchedEmployees,
  };
};

module.exports = {
  getOrgChart,
  listEmployees,
  getEmployeeById,
};
