import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import employeesData from "./data/employees.json";
import { DetailsPanel } from "./components/DetailsPanel";
import { FilterPanel } from "./components/FilterPanel";
import { HoverTooltip } from "./components/HoverTooltip";
import { Legend } from "./components/Legend";
import { MiniMap } from "./components/MiniMap";
import { SearchBar } from "./components/SearchBar";
import { OrgChartManual } from "./components/OrgChartManual";
import type { NewEmployeeInput } from "./components/DetailsPanel";
import type { UpdateEmployeeInput } from "./components/DetailsPanel";
import {
  employeeCountsByDepartment,
  employeeCountsByRoleLevel,
  filterEmployees,
  getRoleLevel,
  ensureConnectedHierarchy,
  inferHierarchy,
  isExecutiveEmployee,
  searchSuggestions,
  type Employee,
  type EmployeeStatus,
  type RoleLevel,
  type ViewMode
} from "./utils/org";

const rawEmployees = employeesData as Employee[];
const READ_ONLY_MODE = false;
const EMPLOYEES_STORAGE_KEY = "madison88_employees_v1";
const HISTORY_LIMIT = 40;
const generatedAvatarPhoto = (name: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name).replace(/%20/g, "+")}&background=2C5F7C&color=fff`;

export default function App() {
  const [employees, setEmployees] = useState<Employee[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(EMPLOYEES_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Employee[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return inferHierarchy(parsed);
          }
        }
      } catch {
        // Fallback to bundled data when local storage is unavailable or invalid.
      }
    }
    return inferHierarchy(rawEmployees);
  });
  const [historyPast, setHistoryPast] = useState<Employee[][]>([]);
  const [historyFuture, setHistoryFuture] = useState<Employee[][]>([]);
  const [depthLimit, setDepthLimit] = useState<number | null>(null);
  const [showDepartmentHeatmap, setShowDepartmentHeatmap] = useState(false);
  const [pinnedEmployeeIds, setPinnedEmployeeIds] = useState<string[]>([]);

  const commitEmployeesChange = useCallback((nextState: Employee[] | ((current: Employee[]) => Employee[])) => {
    setEmployees((current) => {
      const next = typeof nextState === "function" ? (nextState as (current: Employee[]) => Employee[])(current) : nextState;
      if (next === current) {
        return current;
      }
      setHistoryPast((past) => [...past.slice(-(HISTORY_LIMIT - 1)), current]);
      setHistoryFuture([]);
      return next;
    });
  }, []);
  const normalizedEmployees = useMemo(() => ensureConnectedHierarchy(employees), [employees]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hasInitializedFromUrl = useRef(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    normalizedEmployees.find((employee) => !employee.managerId)?.id ?? "001"
  );
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<string | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("full");
  const [department, setDepartment] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilters, setQuickFilters] = useState<EmployeeStatus[]>([]);
  const [executiveOnly, setExecutiveOnly] = useState(false);
  const [roleLevel, setRoleLevel] = useState<RoleLevel | null>(null);
  const [isCompactLayout, setIsCompactLayout] = useState(true);
  const [isDepartmentLaneView, setIsDepartmentLaneView] = useState(false);
  const [showSidePanels, setShowSidePanels] = useState(true);
  const [showFilterPanel, setShowFilterPanel] = useState(true);
  const [urlSyncReady, setUrlSyncReady] = useState(false);
  const [zoom, setZoom] = useState(0.42);
  const [translate, setTranslate] = useState({ x: 500, y: 90 });
  const zoomPercent = Math.round(zoom * 100);
  const canUndo = historyPast.length > 0;
  const canRedo = historyFuture.length > 0;
  const departments = useMemo(() => Array.from(new Set(normalizedEmployees.map((employee) => employee.department))).sort(), [normalizedEmployees]);
  const locations = useMemo(() => Array.from(new Set(normalizedEmployees.map((employee) => employee.location))).sort(), [normalizedEmployees]);
  const statusCounts = useMemo(
    () =>
      normalizedEmployees.reduce<Record<EmployeeStatus, number>>(
        (acc, employee) => {
          acc[employee.status] += 1;
          return acc;
        },
        { standard: 0, promoted: 0, enhanced: 0, new_hire: 0 }
      ),
    [normalizedEmployees]
  );
  const roleLevelCounts = useMemo(
    () =>
      normalizedEmployees.reduce<Record<RoleLevel, number>>(
        (acc, employee) => {
          const level = getRoleLevel(employee.title);
          acc[level] += 1;
          return acc;
        },
        { CEO: 0, President: 0, VP: 0, Director: 0, "Sr. Manager": 0, Manager: 0, "Assoc. Manager": 0, Supervisor: 0, "Sr. Specialist": 0, Specialist: 0, Staff: 0, "Assoc. Staff": 0 }
      ),
    [normalizedEmployees]
  );
  const executiveCount = useMemo(
    () => normalizedEmployees.filter((employee) => isExecutiveEmployee(employee)).length,
    [normalizedEmployees]
  );

  const [chartDims, setChartDims] = useState({ width: 2000, height: 1000 });

  const activeFilterCount =
    (department ? 1 : 0) +
    (location ? 1 : 0) +
    quickFilters.length +
    (executiveOnly ? 1 : 0) +
    (roleLevel ? 1 : 0) +
    (searchQuery ? 1 : 0) +
    (viewMode !== "full" ? 1 : 0);

  const { employees: visibleEmployees, matchingIds } = useMemo(
    () =>
      filterEmployees(normalizedEmployees, {
        viewMode,
        department,
        location,
        quickFilters,
        executiveOnly,
        roleLevel,
        searchQuery,
        selectedEmployeeId,
        // Keep reporting chain visible during filtering so the CEO/root context never disappears.
        showAncestors: true
      }),
    [normalizedEmployees, viewMode, department, location, quickFilters, executiveOnly, roleLevel, searchQuery, selectedEmployeeId, activeFilterCount]
  );

  const { depthById, maxVisibleDepth } = useMemo(() => {
    const depthMap = new Map<string, number>();
    if (visibleEmployees.length === 0) {
      return { depthById: depthMap, maxVisibleDepth: 1 };
    }

    const byId = new Map(visibleEmployees.map((employee) => [employee.id, employee]));
    const childrenByManager = new Map<string, Employee[]>();
    visibleEmployees.forEach((employee) => {
      if (!employee.managerId || !byId.has(employee.managerId)) {
        return;
      }
      const list = childrenByManager.get(employee.managerId) ?? [];
      list.push(employee);
      childrenByManager.set(employee.managerId, list);
    });

    const roots = visibleEmployees.filter((employee) => !employee.managerId || !byId.has(employee.managerId));
    const queue = roots.map((employee) => ({ id: employee.id, depth: 1 }));
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || depthMap.has(current.id)) {
        continue;
      }
      depthMap.set(current.id, current.depth);
      (childrenByManager.get(current.id) ?? []).forEach((child) => {
        queue.push({ id: child.id, depth: current.depth + 1 });
      });
    }

    visibleEmployees.forEach((employee) => {
      if (!depthMap.has(employee.id)) {
        depthMap.set(employee.id, 1);
      }
    });

    const maxDepth = Math.max(...Array.from(depthMap.values()), 1);
    return { depthById: depthMap, maxVisibleDepth: maxDepth };
  }, [visibleEmployees]);

  const chartEmployees = useMemo(
    () => (depthLimit ? visibleEmployees.filter((employee) => (depthById.get(employee.id) ?? 1) <= depthLimit) : visibleEmployees),
    [visibleEmployees, depthById, depthLimit]
  );

  const chartMatchingIds = useMemo(() => {
    const shownIds = new Set(chartEmployees.map((employee) => employee.id));
    return new Set(Array.from(matchingIds).filter((id) => shownIds.has(id)));
  }, [chartEmployees, matchingIds]);
  const depthOptions = useMemo(() => Array.from({ length: maxVisibleDepth }, (_, index) => index + 1), [maxVisibleDepth]);

  const selectedEmployee = useMemo(
    () => visibleEmployees.find((employee: Employee) => employee.id === selectedEmployeeId) ?? null,
    [visibleEmployees, selectedEmployeeId]
  );
  const hoveredEmployee = useMemo(
    () => visibleEmployees.find((employee: Employee) => employee.id === hoveredEmployeeId) ?? null,
    [visibleEmployees, hoveredEmployeeId]
  );
  const detailsEmployee = hoveredEmployee ?? selectedEmployee;
  const pinnedEmployees = useMemo(
    () =>
      pinnedEmployeeIds
        .map((id) => normalizedEmployees.find((employee) => employee.id === id))
        .filter((employee): employee is Employee => Boolean(employee)),
    [pinnedEmployeeIds, normalizedEmployees]
  );
  const isSelectedPinned = Boolean(selectedEmployeeId && pinnedEmployeeIds.includes(selectedEmployeeId));

  const suggestions = useMemo(() => searchSuggestions(normalizedEmployees, searchQuery), [normalizedEmployees, searchQuery]);

  const countsByDepartment = useMemo(() => employeeCountsByDepartment(visibleEmployees), [visibleEmployees]);
  const countsByRoleLevel = useMemo(() => employeeCountsByRoleLevel(visibleEmployees), [visibleEmployees]);
  const topDepartment = useMemo(
    () =>
      Object.entries(countsByDepartment)
        .sort(([, left], [, right]) => right - left)[0],
    [countsByDepartment]
  );
  const uniqueLocations = useMemo(() => new Set(visibleEmployees.map((employee: Employee) => employee.location)).size, [visibleEmployees]);

  const fitView = useCallback(() => {
    if (!wrapperRef.current) return;
    const containerWidth = wrapperRef.current.clientWidth;
    const containerHeight = wrapperRef.current.clientHeight;

    // Calculate scale to fit with margin
    const padding = 80; // Reduced padding to give more room for the chart
    const scaleX = (containerWidth - padding) / (chartDims.width || 2000);
    const scaleY = (containerHeight - padding) / (chartDims.height || 1000);

    // Clamp zoom to reasonable range - don't go below 0.35 to keep it readable
    const newZoom = Math.max(0.35, Math.min(scaleX, scaleY, 0.9));

    setZoom(newZoom);

    // Center the chart
    setTranslate({
      x: (containerWidth - chartDims.width * newZoom) / 2,
      y: Math.max(40, (containerHeight - chartDims.height * newZoom) / 2),
    });
  }, [chartDims]);

  const zoomAroundPoint = useCallback(
    (nextZoom: number, focalPoint?: { x: number; y: number }) => {
      const clampedZoom = Math.max(0.2, Math.min(2, nextZoom));
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        setZoom(clampedZoom);
        return;
      }

      const rect = wrapper.getBoundingClientRect();
      const focusX = focalPoint?.x ?? rect.left + rect.width / 2;
      const focusY = focalPoint?.y ?? rect.top + rect.height / 2;
      const localX = focusX - rect.left;
      const localY = focusY - rect.top;

      const worldX = (localX - translate.x) / zoom;
      const worldY = (localY - translate.y) / zoom;

      setZoom(clampedZoom);
      setTranslate({
        x: localX - worldX * clampedZoom,
        y: localY - worldY * clampedZoom,
      });
    },
    [translate, zoom]
  );

  const downloadPng = useCallback(async () => {
    const exportRoot = wrapperRef.current?.querySelector(".org-export-root") as HTMLElement | null;
    if (!exportRoot) {
      window.alert("Unable to export right now. Please try again.");
      return;
    }

    const rawWidth = Math.max(1200, exportRoot.scrollWidth);
    const rawHeight = Math.max(720, exportRoot.scrollHeight);
    const maxDimension = 8000;
    const scaleFactor = Math.min(1, maxDimension / Math.max(rawWidth, rawHeight));
    const exportWidth = Math.floor(rawWidth * scaleFactor);
    const exportHeight = Math.floor(rawHeight * scaleFactor);

    try {
      const pngUrl = await toPng(exportRoot, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#071723",
        width: exportWidth,
        height: exportHeight,
        imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
      });

      const link = document.createElement("a");
      link.href = pngUrl;
      link.download = `madison88-org-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
    } catch (error) {
      console.error("Failed to export PNG", error);
      window.alert("PNG export failed. Check image permissions and try again.");
    }
  }, []);

  const undoEmployeesChange = useCallback(() => {
    setHistoryPast((past) => {
      if (past.length === 0) {
        return past;
      }
      const previous = past[past.length - 1];
      setHistoryFuture((future) => [employees, ...future].slice(0, HISTORY_LIMIT));
      setEmployees(previous);
      return past.slice(0, -1);
    });
    setHoveredEmployeeId(null);
    setHoverPosition(null);
  }, [employees]);

  const redoEmployeesChange = useCallback(() => {
    setHistoryFuture((future) => {
      if (future.length === 0) {
        return future;
      }
      const [next, ...rest] = future;
      setHistoryPast((past) => [...past.slice(-(HISTORY_LIMIT - 1)), employees]);
      setEmployees(next);
      return rest;
    });
    setHoveredEmployeeId(null);
    setHoverPosition(null);
  }, [employees]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const targetTag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (targetTag === "input" || targetTag === "textarea" || targetTag === "select") {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoEmployeesChange();
        } else {
          undoEmployeesChange();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoEmployeesChange();
        return;
      }

      if (event.key === "=" || event.key === "+") {
        zoomAroundPoint(zoom + 0.1);
      } else if (event.key === "-") {
        zoomAroundPoint(zoom - 0.1);
      } else if (event.key === "0") {
        fitView();
      } else if (event.key.toLowerCase() === "f") {
        document.getElementById("global-search")?.focus();
      }
    };

    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [fitView, redoEmployeesChange, undoEmployeesChange, zoomAroundPoint, zoom]);

  // Only auto-zoom when layout type changes significantly
  useEffect(() => {
    // If we have dimensions, fitView is better than a hardcoded zoom
    if (chartDims.width > 300) {
      fitView();
    } else {
      setZoom(isCompactLayout ? 0.45 : 0.65);
    }
  }, [isCompactLayout, isDepartmentLaneView]); // Also trigger on Lane view toggle

  useEffect(() => {
    fitView();
  }, [fitView, viewMode, department, location, quickFilters, executiveOnly, roleLevel, searchQuery]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(employees));
    } catch {
      // Ignore persistence errors in restricted/private environments.
    }
  }, [employees]);

  useEffect(() => {
    if (depthLimit && depthLimit > maxVisibleDepth) {
      setDepthLimit(maxVisibleDepth);
    }
  }, [depthLimit, maxVisibleDepth]);

  useEffect(() => {
    if (selectedEmployeeId && !normalizedEmployees.some((employee) => employee.id === selectedEmployeeId)) {
      setSelectedEmployeeId(normalizedEmployees.find((employee) => !employee.managerId)?.id ?? normalizedEmployees[0]?.id ?? null);
    }
  }, [normalizedEmployees, selectedEmployeeId]);

  useEffect(() => {
    const employeeIdSet = new Set(normalizedEmployees.map((employee) => employee.id));
    setPinnedEmployeeIds((current) => current.filter((id) => employeeIdSet.has(id)));
  }, [normalizedEmployees]);

  const togglePinnedEmployee = useCallback((employeeId: string) => {
    setPinnedEmployeeIds((current) => {
      if (current.includes(employeeId)) {
        return current.filter((id) => id !== employeeId);
      }
      const next = [...current, employeeId];
      if (next.length > 6) {
        return next.slice(next.length - 6);
      }
      return next;
    });
  }, []);

  const resetAllFilters = useCallback(() => {
    setViewMode("full");
    setDepartment(null);
    setLocation(null);
    setQuickFilters([]);
    setExecutiveOnly(false);
    setRoleLevel(null);
    setSearchQuery("");
  }, []);

  const onToggleStatus = (status: EmployeeStatus) => {
    setQuickFilters((current) =>
      current.includes(status) ? current.filter((entry) => entry !== status) : [...current, status]
    );
  };

  const applyLeadershipPreset = useCallback(() => {
    setViewMode("full");
    setDepartment(null);
    setLocation(null);
    setQuickFilters([]);
    setSearchQuery("");
    setRoleLevel("CEO");
    setExecutiveOnly(true);
    setIsDepartmentLaneView(false);
  }, []);

  const applyDepartmentPreset = useCallback(() => {
    setViewMode("full");
    setDepartment(null);
    setLocation(null);
    setQuickFilters([]);
    setSearchQuery("");
    setRoleLevel(null);
    setExecutiveOnly(false);
    setIsDepartmentLaneView(true);
  }, []);

  const applyAllEmployeesPreset = useCallback(() => {
    resetAllFilters();
    setIsDepartmentLaneView(false);
  }, [resetAllFilters]);

  const resetToOriginalDirectory = useCallback(() => {
    const confirmed = window.confirm("Reset all changes and restore the original employee directory?");
    if (!confirmed) {
      return;
    }

    const restored = inferHierarchy(rawEmployees);
    commitEmployeesChange(restored);
    setSelectedEmployeeId(restored.find((employee) => !employee.managerId)?.id ?? restored[0]?.id ?? null);
    setShowFilterPanel(false);
    applyAllEmployeesPreset();

    try {
      window.localStorage.removeItem(EMPLOYEES_STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  }, [applyAllEmployeesPreset, commitEmployeesChange]);

  const addEmployee = useCallback(
    (input: NewEmployeeInput) => {
      const name = input.name.trim();
      const title = input.title.trim();
      const departmentValue = input.department.trim();
      const locationValue = input.location.trim();
      const normalizedEmail = input.email.trim().toLowerCase();
      const startDate = input.startDate.trim();
      const normalizedPhoto = input.photo?.trim() ?? "";
      if (!name || !title || !departmentValue || !locationValue || !normalizedEmail || !startDate) {
        window.alert("Please complete all required employee fields before saving.");
        return;
      }

      if (employees.some((employee) => employee.email.trim().toLowerCase() === normalizedEmail)) {
        window.alert("Email already exists. Please use a unique email address.");
        return;
      }

      const nextId =
        (employees.reduce((max, employee) => Math.max(max, Number.parseInt(employee.id, 10) || 0), 0) + 1)
          .toString()
          .padStart(3, "0");

      const newEmployee: Employee = {
        id: nextId,
        name,
        title,
        department: departmentValue,
        location: locationValue,
        email: normalizedEmail,
        startDate,
        status: "standard",
        managerId: input.managerId,
        photo: normalizedPhoto || generatedAvatarPhoto(name)
      };

      commitEmployeesChange([...employees, newEmployee]);
      setSelectedEmployeeId(nextId);
    },
    [commitEmployeesChange, employees]
  );

  const updateEmployee = useCallback((input: UpdateEmployeeInput) => {
    const name = input.name.trim();
    const title = input.title.trim();
    const departmentValue = input.department.trim();
    const locationValue = input.location.trim();
    const normalizedEmail = input.email.trim().toLowerCase();
    const startDate = input.startDate.trim();
    const normalizedPhoto = input.photo?.trim() ?? "";
    if (!name || !title || !departmentValue || !locationValue || !normalizedEmail || !startDate) {
      window.alert("Please complete all required employee fields before saving.");
      return;
    }

    if (input.managerId === input.id) {
      window.alert("An employee cannot be their own manager.");
      return;
    }

    if (employees.some((employee) => employee.id !== input.id && employee.email.trim().toLowerCase() === normalizedEmail)) {
      window.alert("Email already exists. Please use a unique email address.");
      return;
    }

    commitEmployeesChange(
      employees.map((employee) =>
        employee.id === input.id
          ? {
            ...employee,
            name,
            title,
            department: departmentValue,
            location: locationValue,
            email: normalizedEmail,
            startDate,
            status: input.status,
            managerId: input.managerId,
            photo: normalizedPhoto || employee.photo || generatedAvatarPhoto(name)
          }
          : employee
      )
    );
  }, [commitEmployeesChange, employees]);

  const deleteEmployee = useCallback(
    (employeeId: string) => {
      if (employees.length <= 1) {
        window.alert("Cannot delete the last employee in the directory.");
        return;
      }

      const employeeToDelete = employees.find((employee) => employee.id === employeeId);
      if (!employeeToDelete) {
        return;
      }

      const directReportsCount = employees.filter((employee) => employee.managerId === employeeId).length;
      const reassignmentLabel = employeeToDelete.managerId ? "their manager" : "top-level";
      const confirmationMessage =
        directReportsCount > 0
          ? `Delete ${employeeToDelete.name}? ${directReportsCount} direct report(s) will be reassigned to ${reassignmentLabel}.`
          : `Delete ${employeeToDelete.name} from the org chart?`;

      if (!window.confirm(confirmationMessage)) {
        return;
      }

      commitEmployeesChange((current) => {
        const target = current.find((employee) => employee.id === employeeId);
        if (!target) {
          return current;
        }

        const nextManagerId = target.managerId ?? null;
        return current
          .filter((employee) => employee.id !== employeeId)
          .map((employee) =>
            employee.managerId === employeeId
              ? {
                ...employee,
                managerId: nextManagerId
              }
              : employee
          );
      });

      setHoveredEmployeeId((current) => (current === employeeId ? null : current));
      setHoverPosition(null);
      setSelectedEmployeeId((currentSelectedId) => {
        if (currentSelectedId !== employeeId) {
          return currentSelectedId;
        }

        if (employeeToDelete.managerId && employees.some((employee) => employee.id === employeeToDelete.managerId && employee.id !== employeeId)) {
          return employeeToDelete.managerId;
        }

        const fallback = employees.find((employee) => employee.id !== employeeId && !employee.managerId)?.id ?? employees.find((employee) => employee.id !== employeeId)?.id ?? null;
        return fallback;
      });
    },
    [commitEmployeesChange, employees]
  );

  useEffect(() => {
    if (hasInitializedFromUrl.current) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const preset = params.get("preset");
    const role = params.get("role");
    const query = params.get("q");
    const panels = params.get("panels");

    if (preset === "department") {
      applyDepartmentPreset();
    } else if (preset === "all") {
      applyAllEmployeesPreset();
    } else {
      applyAllEmployeesPreset();
    }

    if (role && (["CEO", "President", "VP", "Director", "Sr. Manager", "Manager", "Assoc. Manager", "Supervisor", "Sr. Specialist", "Specialist", "Staff", "Assoc. Staff"] as string[]).includes(role)) {
      const roleValue = role as RoleLevel;
      setRoleLevel(roleValue);
      setExecutiveOnly(roleValue === "CEO" || roleValue === "President" || roleValue === "VP");
    }

    if (query) {
      setSearchQuery(query);
    }

    setShowSidePanels(panels !== "0");
    setShowFilterPanel(params.get("filters") !== "0");
    hasInitializedFromUrl.current = true;
    setUrlSyncReady(true);
  }, [applyAllEmployeesPreset, applyDepartmentPreset, applyLeadershipPreset]);

  useEffect(() => {
    if (!urlSyncReady) {
      return;
    }

    const params = new URLSearchParams();
    const preset = executiveOnly && (roleLevel === "CEO" || roleLevel === "President" || roleLevel === "VP") ? "leadership" : isDepartmentLaneView ? "department" : "all";
    params.set("preset", preset);
    if (roleLevel) {
      params.set("role", roleLevel);
    }
    if (searchQuery.trim()) {
      params.set("q", searchQuery.trim());
    }
    if (showSidePanels) {
      params.set("panels", "1");
    }
    if (showFilterPanel) {
      params.set("filters", "1");
    }

    const queryString = params.toString();
    const nextUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  }, [urlSyncReady, executiveOnly, roleLevel, isDepartmentLaneView, searchQuery, showSidePanels, showFilterPanel]);

  // Custom interaction handlers for the manual chart
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.employee-card')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - translate.x, y: e.clientY - translate.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setTranslate({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const centerCanvas = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const containerWidth = wrapper.clientWidth;
    const containerHeight = wrapper.clientHeight;

    setTranslate({
      x: (containerWidth - chartDims.width * zoom) / 2,
      y: (containerHeight - chartDims.height * zoom) / 2,
    });
  }, [chartDims.height, chartDims.width, zoom]);

  const zoomOut = useCallback(() => {
    zoomAroundPoint(zoom - 0.08);
  }, [zoomAroundPoint, zoom]);

  const zoomIn = useCallback(() => {
    zoomAroundPoint(zoom + 0.08);
  }, [zoomAroundPoint, zoom]);

  const handleWheel = useCallback((e: globalThis.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    zoomAroundPoint(zoom + delta, { x: e.clientX, y: e.clientY });
  }, [zoomAroundPoint, zoom]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper) {
      wrapper.addEventListener('wheel', handleWheel, { passive: false });
      return () => wrapper.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // Auto-centering
  useEffect(() => {
    if (chartDims.width > 300) {
      fitView();
    }
  }, [chartDims.width, chartDims.height, fitView, activeFilterCount, isDepartmentLaneView]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="title-wrap">
          <p className="brand" aria-label="madison88">
            <span className="brand-word">madison</span>
            <span className="brand-number">88</span>
          </p>
          <p className="brand-tagline">Org Intelligence Dashboard</p>
        </div>
        <div className="hero-header-right">
          <h2>Global Team</h2>
        </div>
        <div className="header-tools">
          <div className="header-meta" aria-label="view metrics">
            <span>{chartEmployees.length} shown</span>
            <span>{visibleEmployees.length} filtered</span>
            <span>{normalizedEmployees.length} total</span>
            <span>{activeFilterCount} active filters</span>
          </div>
          <SearchBar
            query={searchQuery}
            suggestions={suggestions}
            onChange={setSearchQuery}
            onClear={() => setSearchQuery("")}
            onSelectSuggestion={(id) => {
              setSelectedEmployeeId(id);
              setViewMode("individual");
              setSearchQuery("");
            }}
          />
        </div>
      </header>

      <main className={`layout-grid ${showSidePanels ? "" : "no-left"}`}>
        {showSidePanels && (
          <section className="left-column">
            <section className="summary-panel insight-strip" aria-label="Live insights">
              <h3>Live Insights</h3>
              <div className="insight-pill">
                <span>Visible Team</span>
                <strong>{chartEmployees.length}</strong>
              </div>
              <div className="insight-pill">
                <span>Active Locations</span>
                <strong>{uniqueLocations}</strong>
              </div>
              <div className="insight-pill">
                <span>Largest Department</span>
                <strong>{topDepartment ? `${topDepartment[0]} (${topDepartment[1]})` : "N/A"}</strong>
              </div>
            </section>
            <Legend />
            <MiniMap zoom={zoom} translate={translate} totalNodes={chartEmployees.length} />
            <section className="summary-panel pinned-panel" aria-label="Pinned employees">
              <div className="pinned-head">
                <h3>Pinned Compare</h3>
                <span>{pinnedEmployees.length}/6</span>
              </div>
              {pinnedEmployees.length === 0 && <p className="pinned-empty">Pin key roles to compare at a glance.</p>}
              {pinnedEmployees.map((employee) => (
                <div key={employee.id} className="pinned-card">
                  <p className="pinned-name">{employee.name}</p>
                  <p className="pinned-title">{employee.title}</p>
                  <p className="pinned-meta">{employee.department} - {employee.location}</p>
                  <div className="pinned-actions">
                    <button type="button" className="ghost-btn" onClick={() => setSelectedEmployeeId(employee.id)}>
                      Focus
                    </button>
                    <button type="button" className="ghost-btn" onClick={() => togglePinnedEmployee(employee.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </section>
            <section className="summary-panel" aria-label="Headcount summary">
              <h3>Department Headcount</h3>
              {Object.entries(countsByDepartment).map(([name, count]) => (
                <p key={name}>
                  <span>{name}</span>
                  <strong>{count}</strong>
                </p>
              ))}
            </section>
            <section className="summary-panel" aria-label="Role level breakdown">
              <h3>Role Breakdown</h3>
              {Object.entries(countsByRoleLevel).map(([name, count]) => (
                <p key={name}>
                  <span>{name}</span>
                  <strong>{count}</strong>
                </p>
              ))}
            </section>
          </section>
        )}

        <section className="chart-column">
          <div className="chart-actions">
            <div className="chart-toolbar" aria-label="Zoom controls">
              <button type="button" onClick={undoEmployeesChange} disabled={!canUndo} aria-label="Undo last employee change">
                Undo
              </button>
              <button type="button" onClick={redoEmployeesChange} disabled={!canRedo} aria-label="Redo last employee change">
                Redo
              </button>
              <button type="button" onClick={zoomOut} aria-label="Zoom out">
                Zoom -
              </button>
              <button type="button" onClick={zoomIn} aria-label="Zoom in">
                Zoom +
              </button>
              <label className="toolbar-select" aria-label="Expand or collapse hierarchy by level">
                <span>Level</span>
                <select
                  value={depthLimit ?? "all"}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDepthLimit(value === "all" ? null : Number(value));
                  }}
                >
                  <option value="all">All Levels</option>
                  {depthOptions.map((level) => (
                    <option key={level} value={level}>
                      Level {level}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={fitView}>
                Fit View
              </button>
              <button
                type="button"
                onClick={() => {
                  fitView();
                }}
              >
                Reset View
              </button>
              {!READ_ONLY_MODE && (
                <>
                  <button type="button" onClick={() => setIsDepartmentLaneView((current) => !current)}>
                    {isDepartmentLaneView ? "Hierarchical View" : "Department Lanes"}
                  </button>
                  <button type="button" onClick={() => setShowDepartmentHeatmap((current) => !current)}>
                    {showDepartmentHeatmap ? "Hide Heatmap" : "Department Heatmap"}
                  </button>
                  <button type="button" onClick={() => setIsCompactLayout((current) => !current)}>
                    {isCompactLayout ? "Comfort Layout" : "Compact Layout"}
                  </button>
                  <button
                    type="button"
                    onClick={centerCanvas}
                  >
                    Center Canvas
                  </button>
                </>
              )}
              <button type="button" onClick={downloadPng}>
                Download PNG
              </button>
              <button
                type="button"
                onClick={() => selectedEmployeeId && togglePinnedEmployee(selectedEmployeeId)}
                disabled={!selectedEmployeeId}
              >
                {isSelectedPinned ? "Unpin Selected" : "Pin Selected"}
              </button>
              <button type="button" onClick={resetToOriginalDirectory}>
                Reset Directory
              </button>
              <button type="button" onClick={() => setShowFilterPanel((current) => !current)}>
                {showFilterPanel ? "Hide Filters" : "Show Filters"}
              </button>
              {READ_ONLY_MODE && (
                <button type="button" onClick={() => setShowSidePanels((current) => !current)}>
                  {showSidePanels ? "Hide Panels" : "Show Panels"}
                </button>
              )}
            </div>
            <div className="toolbar-meta" role="status" aria-live="polite">
              <span>Zoom {zoomPercent}%</span>
              <span>Pan X {Math.round(translate.x)}</span>
              <span>Pan Y {Math.round(translate.y)}</span>
              <span>Tip: Drag to pan, mouse wheel to zoom, F to search</span>
            </div>
          </div>

          <div
            className="chart-surface"
            ref={wrapperRef}
            onMouseLeave={() => {
              setHoveredEmployeeId(null);
              setHoverPosition(null);
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                cursor: isDragging ? 'grabbing' : 'grab',
                overflow: 'hidden',
                userSelect: 'none'
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div style={{
                transform: `translate(${translate.x}px, ${translate.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
              }}>
                <OrgChartManual
                  employees={chartEmployees}
                  isDepartmentLaneView={isDepartmentLaneView}
                  showDepartmentHeatmap={showDepartmentHeatmap}
                  selectedEmployeeId={selectedEmployeeId}
                  hoveredEmployeeId={hoveredEmployeeId}
                  onSelect={setSelectedEmployeeId}
                  onHover={setHoveredEmployeeId}
                  onHoverMove={setHoverPosition}
                  zoomScale={zoom}
                  matchingIds={chartMatchingIds}
                  onDimensionsChange={setChartDims}
                />
              </div>
            </div>
          </div>

          {showFilterPanel && (
            <>
              <button
                type="button"
                className="filter-backdrop"
                aria-label="Close filters"
                onClick={() => setShowFilterPanel(false)}
              />
              <aside className="filter-drawer" onClick={(event) => event.stopPropagation()}>
                <FilterPanel
                  viewMode={viewMode}
                  department={department}
                  location={location}
                  quickFilters={quickFilters}
                  executiveOnly={executiveOnly}
                  roleLevel={roleLevel}
                  departments={departments}
                  locations={locations}
                  statusCounts={statusCounts}
                  roleLevelCounts={roleLevelCounts as any}
                  executiveCount={executiveCount}
                  readonlyMode={READ_ONLY_MODE}
                  hasActiveFilters={activeFilterCount > 0}
                  onViewMode={(mode) => setViewMode(mode)}
                  onDepartment={(value) => {
                    setDepartment(value);
                    setViewMode("department");
                  }}
                  onLocation={(value) => {
                    setLocation(value);
                    setViewMode("location");
                  }}
                  onToggleStatus={onToggleStatus}
                  onToggleExecutive={() => {
                    setExecutiveOnly((current) => {
                      const next = !current;
                      if (next) {
                        setRoleLevel(employees.find(e => e.id === "001")?.title.toLowerCase().includes("ceo") ? "CEO" : "President");
                        setViewMode("full");
                        setDepartment(null);
                        setLocation(null);
                        setSearchQuery("");
                      } else if (roleLevel === "CEO" || roleLevel === "President" || roleLevel === "VP") {
                        setRoleLevel(null);
                      }
                      return next;
                    });
                  }}
                  onRoleLevel={(level) => {
                    setRoleLevel(level);
                    if (level) {
                      setViewMode("full");
                    }
                    if (level !== "CEO" && level !== "President" && level !== "VP" && executiveOnly) {
                      setExecutiveOnly(false);
                    }
                    if ((level === "CEO" || level === "President" || level === "VP") && !executiveOnly) {
                      setExecutiveOnly(true);
                    }
                  }}
                  onPresetLeadership={applyLeadershipPreset}
                  onPresetDepartment={applyDepartmentPreset}
                  onPresetAllEmployees={applyAllEmployeesPreset}
                  onResetAll={resetAllFilters}
                />
              </aside>
            </>
          )}
        </section>

        <DetailsPanel
          selectedEmployee={detailsEmployee}
          employees={normalizedEmployees}
          onFocus={setSelectedEmployeeId}
          onAddEmployee={addEmployee}
          onUpdateEmployee={updateEmployee}
          onDeleteEmployee={deleteEmployee}
          isHoverPreview={Boolean(hoveredEmployee)}
        />
      </main>
      {hoveredEmployee && hoverPosition && (
        <HoverTooltip employee={hoveredEmployee} employees={normalizedEmployees} position={hoverPosition} />
      )}
    </div>
  );
}
