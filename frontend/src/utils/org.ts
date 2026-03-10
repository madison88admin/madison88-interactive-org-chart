export type EmployeeStatus = "standard" | "promoted" | "enhanced" | "new_hire" | "vacant";
export type RoleLevel =
  | "Level 0"
  | "Level 1"
  | "Level 2"
  | "Level 3"
  | "Level 4"
  | "Level 5"
  | "Level 6"
  | "Level 7";

export const ROLE_LEVELS_ORDER: RoleLevel[] = [
  "Level 0",
  "Level 1",
  "Level 2",
  "Level 3",
  "Level 4",
  "Level 5",
  "Level 6",
  "Level 7"
];

export interface Employee {
  id: string;
  name: string;
  title: string;
  department: string;
  location: string;
  regionalRoles?: RegionalRole[];
  email: string;
  startDate: string;
  status: EmployeeStatus;
  managerId: string | null;
  additionalManagerIds?: string[];
  photo: string;
}

export interface RegionalRole {
  location: string;
  title: string;
  department?: string;
}

export interface EmployeeNode {
  employee: Employee;
  children: EmployeeNode[];
}

export interface EmployeeTreeDatum {
  name: string;
  attributes: {
    id: string;
    title?: string;
    department?: string;
    location?: string;
    status?: EmployeeStatus;
    nodeType?: "employee" | "group";
  };
  children?: EmployeeTreeDatum[];
}

export const DEPARTMENTS = [
  "Materials",
  "Quality Control",
  "Testing & Compliance",
  "Production Planning",
  "Technical and 3D Design",
  "Product & Business Development",
  "Merchandising",
  "Costing",
  "Accounting",
  "IT",
  "HR & Admin",
  "Purchasing",
  "Logistics"
] as const;

export const LOCATIONS = [
  "Manila Office, Philippines",
  "United States (Denver & East Coast)",
  "China",
  "Indonesia",
  "Taiwan",
  "Bangladesh"
] as const;

export type ViewMode = "full" | "department" | "location" | "individual";

const normalizeLocationKey = (value: string) => value.trim().toLowerCase();

const regionalRoleForLocation = (employee: Employee, location: string | null) => {
  if (!location) {
    return null;
  }
  const targetKey = normalizeLocationKey(location);
  return (
    employee.regionalRoles?.find((entry) => normalizeLocationKey(entry.location) === targetKey) ?? null
  );
};

const includesTerm = (employee: Employee, term: string) => {
  const regionalContent =
    employee.regionalRoles
      ?.map((entry) => `${entry.location} ${entry.title} ${entry.department ?? ""}`)
      .join(" ") ?? "";
  const value = `${employee.name} ${employee.title} ${employee.department} ${regionalContent}`.toLowerCase();
  return value.includes(term.toLowerCase());
};

export const employeeMatchesLocation = (employee: Employee, location: string | null) => {
  if (!location) {
    return true;
  }
  const targetKey = normalizeLocationKey(location);
  if (normalizeLocationKey(employee.location) === targetKey) {
    return true;
  }
  return (employee.regionalRoles ?? []).some((entry) => normalizeLocationKey(entry.location) === targetKey);
};

export const resolveEmployeeForLocation = (employee: Employee, location: string | null): Employee => {
  const regionalRole = regionalRoleForLocation(employee, location);
  if (!regionalRole) {
    return employee;
  }
  return {
    ...employee,
    title: regionalRole.title?.trim() || employee.title,
    department: regionalRole.department?.trim() || employee.department,
    location: regionalRole.location?.trim() || employee.location
  };
};

export const allEmployeeLocations = (employees: Employee[]) => {
  const set = new Set<string>();
  employees.forEach((employee) => {
    const base = employee.location?.trim();
    if (base) {
      set.add(base);
    }
    (employee.regionalRoles ?? []).forEach((entry) => {
      const regionalLocation = entry.location?.trim();
      if (regionalLocation) {
        set.add(regionalLocation);
      }
    });
  });
  return Array.from(set).sort((left, right) => left.localeCompare(right));
};

const collectAncestors = (id: string, map: Map<string, Employee>, include: Set<string>) => {
  let current = map.get(id);
  while (current?.managerId) {
    include.add(current.managerId);
    current = map.get(current.managerId);
  }
};

const collectDescendants = (
  id: string,
  childrenByManager: Map<string, Employee[]>,
  include: Set<string>
) => {
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    (childrenByManager.get(current) ?? []).forEach((child) => {
      include.add(child.id);
      queue.push(child.id);
    });
  }
};

export const isExecutiveTitle = (title: string): boolean => {
  const primaryTitle = title.split("/")[0]?.trim() ?? title;
  const normalized = primaryTitle.toLowerCase();
  return (
    /\bceo\b/.test(normalized) ||
    normalized.includes("chief executive") ||
    /\bcfo\b/.test(normalized) ||
    normalized.includes("chief financial") ||
    /\bchief\b/.test(normalized) ||
    /\bpresident\b/.test(normalized) ||
    /\bvice president\b/.test(normalized) ||
    /\bvp\b/.test(normalized) ||
    /\bdirector\b/.test(normalized)
  );
};

export const isExecutiveEmployee = (employee: Employee): boolean => {
  return isExecutiveTitle(employee.title) || employee.department.trim().toLowerCase() === "executive";
};

export const getRoleLevel = (title: string): RoleLevel => {
  const normalized = title.toLowerCase();

  if (normalized === "ceo" || normalized.includes("chief executive") || /\bpresident\b/.test(normalized)) {
    return "Level 0";
  }

  if (
    /\bvice president\b/.test(normalized) ||
    /\bvp\b/.test(normalized) ||
    /\bcfo\b/.test(normalized) ||
    normalized.includes("chief financial") ||
    normalized.includes("director")
  ) {
    return "Level 1";
  }

  if (normalized.includes("sr. manager") || normalized.includes("senior manager")) {
    return "Level 2";
  }

  if (
    normalized.includes("assoc. manager") ||
    normalized.includes("associate manager") ||
    normalized.includes("manager")
  ) {
    return "Level 3";
  }

  if (normalized.includes("supervisor") || normalized.includes("lead")) {
    return "Level 4";
  }

  if (
    normalized.includes("engineer") ||
    normalized.includes("sr. specialist") ||
    normalized.includes("senior specialist") ||
    normalized.includes("sr. designer") ||
    normalized.includes("senior designer")
  ) {
    return "Level 5";
  }

  if (
    normalized.includes("specialist") ||
    normalized.includes("coordinator") ||
    normalized.includes("planner") ||
    normalized.includes("developer")
  ) {
    return "Level 6";
  }

  if (
    normalized.includes("associate") ||
    normalized.includes("assistant") ||
    normalized.includes("intern")
  ) {
    return "Level 7";
  }

  return "Level 6";
};

const roleWeight = (title: string): number => {
  const primaryTitle = title.split("/")[0]?.trim() ?? title;
  const normalized = primaryTitle.toLowerCase();
  if (/\bceo\b/.test(normalized) || normalized.includes("chief executive")) {
    return 100;
  }
  if (/\bvice president\b/.test(normalized) || /\bvp\b/.test(normalized)) {
    return 90;
  }
  if (/\bcfo\b/.test(normalized) || normalized.includes("chief financial")) {
    return 89;
  }
  if (/\bpresident\b/.test(normalized)) {
    return 95;
  }
  if (/\bchief\b/.test(normalized)) {
    return 94;
  }
  if (/\bdirector\b/.test(normalized)) {
    return 80;
  }
  if (/\bhead\b/.test(normalized)) {
    return 76;
  }
  if (/\bmanager\b/.test(normalized) || /\blead\b/.test(normalized)) {
    return 68;
  }
  if (/\bsupervisor\b/.test(normalized)) {
    return 60;
  }
  if (/\bspecialist\b/.test(normalized) || /\banalyst\b/.test(normalized) || /\bcoordinator\b/.test(normalized)) {
    return 52;
  }
  if (/\bassistant\b/.test(normalized) || /\bassociate\b/.test(normalized)) {
    return 44;
  }
  return 48;
};

const isFlatHierarchy = (employees: Employee[]) => {
  const roots = employees.filter((employee) => !employee.managerId);
  if (roots.length !== 1) {
    return false;
  }
  const rootId = roots[0].id;
  const nonRoots = employees.filter((employee) => employee.id !== rootId);
  if (nonRoots.length === 0) {
    return false;
  }
  const directToRoot = nonRoots.filter((employee) => employee.managerId === rootId).length;
  return directToRoot / nonRoots.length > 0.7;
};

export const ensureConnectedHierarchy = (employees: Employee[]): Employee[] => {
  if (employees.length === 0) {
    return employees;
  }

  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const roots = employees.filter((employee) => !employee.managerId || !byId.has(employee.managerId));
  const root = roots[0] ?? employees[0];
  const normalizedManagerById = new Map<string, string | null>();
  normalizedManagerById.set(root.id, null);

  employees.forEach((employee) => {
    if (employee.id === root.id) {
      return;
    }
    let managerId = employee.managerId;
    if (!managerId || managerId === employee.id || !byId.has(managerId)) {
      managerId = root.id;
    }
    normalizedManagerById.set(employee.id, managerId);
  });

  const createsCycle = (employeeId: string, managerId: string | null): boolean => {
    if (!managerId) {
      return false;
    }
    const visited = new Set<string>([employeeId]);
    let current: string | null = managerId;
    while (current) {
      if (visited.has(current)) {
        return true;
      }
      visited.add(current);
      current = normalizedManagerById.get(current) ?? null;
    }
    return false;
  };

  return employees.map((employee) => {
    if (employee.id === root.id) {
      return { ...employee, managerId: null };
    }
    const candidateManager = normalizedManagerById.get(employee.id) ?? root.id;
    return {
      ...employee,
      managerId: createsCycle(employee.id, candidateManager) ? root.id : candidateManager
    };
  });
};

export const inferHierarchy = (employees: Employee[]): Employee[] => {
  if (employees.length <= 2 || !isFlatHierarchy(employees)) {
    return employees;
  }

  const sortedByWeight = [...employees].sort((left, right) => {
    const weightDiff = roleWeight(right.title) - roleWeight(left.title);
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return left.name.localeCompare(right.name);
  });

  const existingRoot = employees.find((employee) => !employee.managerId);
  const root = existingRoot ?? sortedByWeight[0];

  const byDepartment = new Map<string, Employee[]>();
  employees.forEach((employee) => {
    if (employee.id === root.id) {
      return;
    }
    const list = byDepartment.get(employee.department) ?? [];
    list.push(employee);
    byDepartment.set(employee.department, list);
  });

  const managerById = new Map<string, string | null>();
  managerById.set(root.id, null);

  byDepartment.forEach((departmentPeople) => {
    const ordered = [...departmentPeople].sort((left, right) => {
      const weightDiff = roleWeight(right.title) - roleWeight(left.title);
      if (weightDiff !== 0) {
        return weightDiff;
      }
      return left.name.localeCompare(right.name);
    });

    const departmentHead = ordered[0];
    const departmentHeadWeight = roleWeight(departmentHead.title);
    managerById.set(departmentHead.id, root.id);

    for (let index = 1; index < ordered.length; index += 1) {
      const current = ordered[index];
      const currentWeight = roleWeight(current.title);
      let managerId = currentWeight >= departmentHeadWeight ? root.id : departmentHead.id;

      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const candidate = ordered[previous];
        if (roleWeight(candidate.title) > currentWeight) {
          managerId = candidate.id;
          break;
        }
      }

      managerById.set(current.id, managerId);
    }
  });

  return employees.map((employee) => ({
    ...employee,
    managerId: managerById.has(employee.id) ? (managerById.get(employee.id) ?? null) : root.id
  }));
};

export const buildPeopleMaps = (employees: Employee[]) => {
  const map = new Map(employees.map((employee) => [employee.id, employee]));
  const childrenByManager = new Map<string, Employee[]>();

  employees.forEach((employee) => {
    if (!employee.managerId) {
      return;
    }
    const list = childrenByManager.get(employee.managerId) ?? [];
    list.push(employee);
    childrenByManager.set(employee.managerId, list);
  });

  return { map, childrenByManager };
};

export const filterEmployees = (
  employees: Employee[],
  options: {
    department: string | null;
    location: string | null;
    viewMode: ViewMode;
    quickFilters: EmployeeStatus[];
    executiveOnly: boolean;
    roleLevel: RoleLevel | null;
    searchQuery: string;
    selectedEmployeeId: string | null;
    showAncestors?: boolean;
  }
) => {
  const { map, childrenByManager } = buildPeopleMaps(employees);
  const showAncestors = options.showAncestors ?? true;

  if (options.executiveOnly) {
    const matching = employees.filter((employee) => isExecutiveEmployee(employee));
    return {
      employees: matching,
      matchingIds: new Set(matching.map((e) => e.id))
    };
  }

  const matchingEmployees = employees.filter((employee) => {
    if (options.department && employee.department !== options.department) {
      return false;
    }

    if (options.location && !employeeMatchesLocation(employee, options.location)) {
      return false;
    }

    if (options.quickFilters.length > 0 && !options.quickFilters.includes(employee.status)) {
      return false;
    }

    if (options.roleLevel && getRoleLevel(employee.title) !== options.roleLevel) {
      return false;
    }

    if (options.searchQuery && !includesTerm(employee, options.searchQuery)) {
      return false;
    }

    return true;
  });

  const matchingIds = new Set(matchingEmployees.map((e) => e.id));

  if (options.viewMode !== "individual" || !options.selectedEmployeeId || !map.has(options.selectedEmployeeId)) {
    if (!showAncestors) {
      return {
        employees: matchingEmployees,
        matchingIds
      };
    }
    const include = new Set(matchingIds);
    matchingEmployees.forEach((employee) => collectAncestors(employee.id, map, include));
    return {
      employees: employees.filter((employee) => include.has(employee.id)),
      matchingIds
    };
  }

  const include = new Set<string>([options.selectedEmployeeId]);
  if (showAncestors) {
    collectAncestors(options.selectedEmployeeId, map, include);
  }
  collectDescendants(options.selectedEmployeeId, childrenByManager, include);

  return {
    employees: employees.filter((employee) => include.has(employee.id)),
    matchingIds: new Set([options.selectedEmployeeId])
  };
};

const toNode = (
  employee: Employee,
  childrenByManager: Map<string, Employee[]>,
  include: Set<string>
): EmployeeNode | null => {
  if (!include.has(employee.id)) {
    return null;
  }

  const children = (childrenByManager.get(employee.id) ?? [])
    .map((child) => toNode(child, childrenByManager, include))
    .filter((child): child is EmployeeNode => Boolean(child));

  return { employee, children };
};

export const buildTree = (employees: Employee[]): EmployeeNode | null => {
  if (employees.length === 0) {
    return null;
  }

  const { childrenByManager } = buildPeopleMaps(employees);
  const include = new Set(employees.map((employee) => employee.id));

  // Identify nodes that have no manager in the current set of employees
  const roots = employees.filter((employee) => !employee.managerId || !include.has(employee.managerId));

  if (roots.length === 0) {
    return toNode(employees[0], childrenByManager, include);
  }

  if (roots.length === 1) {
    return toNode(roots[0], childrenByManager, include);
  }

  // Multiple disconnected roots - create a synthetic parent
  const syntheticRoot: Employee = {
    id: "synthetic-root",
    name: "Filtered Results",
    title: "Collection of matching teams",
    department: "Various",
    location: "Various",
    email: "",
    startDate: "",
    status: "standard",
    managerId: null,
    photo: "https://ui-avatars.com/api/?name=Filtered+Results&background=0f6e8f&color=fff"
  };

  const children = roots
    .map((root) => toNode(root, childrenByManager, include))
    .filter((node): node is EmployeeNode => Boolean(node));

  return {
    employee: syntheticRoot,
    children
  };
};

export const toTreeDatum = (node: EmployeeNode): EmployeeTreeDatum => ({
  name: node.employee.name,
  attributes: {
    id: node.employee.id,
    title: node.employee.title,
    department: node.employee.department,
    location: node.employee.location,
    status: node.employee.status,
    nodeType: "employee"
  },
  children: node.children.map(toTreeDatum)
});

export const buildDepartmentTree = (employees: Employee[]): EmployeeTreeDatum | null => {
  const baseTree = buildTree(employees);
  if (!baseTree) {
    return null;
  }

  const root = baseTree.employee;
  const { childrenByManager } = buildPeopleMaps(employees);
  const byDepartment = new Map<string, Employee[]>();

  employees
    .filter((employee) => employee.id !== root.id)
    .forEach((employee) => {
      const list = byDepartment.get(employee.department) ?? [];
      list.push(employee);
      byDepartment.set(employee.department, list);
    });

  const groupNodes: EmployeeTreeDatum[] = Array.from(byDepartment.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([department, departmentEmployees]) => {
      const include = new Set(departmentEmployees.map((employee) => employee.id));
      const deptRoots = departmentEmployees
        .filter((employee) => !employee.managerId || !include.has(employee.managerId))
        .sort((left, right) => left.name.localeCompare(right.name));

      const children = deptRoots
        .map((employee) => toNode(employee, childrenByManager, include))
        .filter((node): node is EmployeeNode => Boolean(node))
        .map(toTreeDatum);

      return {
        name: department,
        attributes: {
          id: `group:${department}`,
          nodeType: "group",
          department
        },
        children
      };
    });

  return {
    name: root.name,
    attributes: {
      id: root.id,
      title: root.title,
      department: root.department,
      location: root.location,
      status: root.status,
      nodeType: "employee"
    },
    children: groupNodes
  };
};

export const employeeCountsByDepartment = (employees: Employee[]) => {
  return employees.reduce<Record<string, number>>((acc, employee) => {
    acc[employee.department] = (acc[employee.department] ?? 0) + 1;
    return acc;
  }, {});
};

export const employeeCountsByRoleLevel = (employees: Employee[]) => {
  return employees.reduce<Record<string, number>>((acc, employee) => {
    const level = getRoleLevel(employee.title);
    acc[level] = (acc[level] ?? 0) + 1;
    return acc;
  }, {});
};

export const directReportIds = (employees: Employee[], id: string) => {
  return employees.filter((employee) => employee.managerId === id).map((employee) => employee.id);
};

export const managerFor = (employees: Employee[], id: string) => {
  const person = employees.find((employee) => employee.id === id);
  if (!person?.managerId) {
    return null;
  }
  return employees.find((employee) => employee.id === person.managerId) ?? null;
};

export const searchSuggestions = (employees: Employee[], query: string) => {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const lower = query.toLowerCase();
  return employees
    .filter((employee) => includesTerm(employee, lower))
    .slice(0, 7)
    .map((employee) => ({
      id: employee.id,
      label: `${employee.name} - ${employee.title}`
    }));
};
