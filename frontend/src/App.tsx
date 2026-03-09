import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import employeesData from "./data/employees.json";
import { DetailsPanel } from "./components/DetailsPanel";
import { FilterPanel } from "./components/FilterPanel";
import { HoverTooltip } from "./components/HoverTooltip";
import { Legend } from "./components/Legend";
import { SearchBar } from "./components/SearchBar";
import { OrgChartManual } from "./components/OrgChartManual";
import type { NewEmployeeInput } from "./components/DetailsPanel";
import type { UpdateEmployeeInput } from "./components/DetailsPanel";
import { loadSharedEmployees, saveSharedEmployees } from "./services/sharedEmployees";
import { uploadEmployeePhoto } from "./services/photoStorage";
import { hasSupabaseConfig } from "./services/supabaseClient";
import {
  calculateDepartmentLaneLayout,
  type LayoutNode
} from "./utils/layout";
import { APP_BUILD_ID, avatarFallback } from "./utils/photo";
import {
  allEmployeeLocations,
  resolveEmployeeForLocation,
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
const EMPLOYEES_STORAGE_PREFIX = "madison88_employees";
const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
const EMPLOYEES_DATA_SIGNATURE = hashString(
  rawEmployees
    .map((employee) =>
      [
        employee.id,
        employee.name,
        employee.title,
        employee.department,
        employee.location,
        employee.email,
        employee.startDate,
        employee.status,
        employee.managerId ?? "",
        JSON.stringify(employee.additionalManagerIds ?? []),
        employee.photo,
        JSON.stringify(employee.regionalRoles ?? [])
      ].join("|")
    )
    .join("~")
);
const EMPLOYEES_STORAGE_KEY = `${EMPLOYEES_STORAGE_PREFIX}_${APP_BUILD_ID}_${EMPLOYEES_DATA_SIGNATURE}`;
const HISTORY_LIMIT = 40;
type LocalEmployeesCache = {
  data: Employee[];
  updatedAt: string | null;
};

const parseTimestamp = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readLocalEmployeesCache = (): LocalEmployeesCache | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const saved = window.localStorage.getItem(EMPLOYEES_STORAGE_KEY);
  if (!saved) {
    return null;
  }

  try {
    const parsed = JSON.parse(saved) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return {
        data: inferHierarchy(parsed as Employee[]),
        updatedAt: null
      };
    }
    if (parsed && typeof parsed === "object") {
      const payload = parsed as { data?: unknown; updatedAt?: unknown };
      if (Array.isArray(payload.data) && payload.data.length > 0) {
        return {
          data: inferHierarchy(payload.data as Employee[]),
          updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null
        };
      }
    }
  } catch {
    // Fallback to bundled data when local storage is unavailable or invalid.
  }

  return null;
};

const generatedAvatarPhoto = (name: string) => avatarFallback(name);
const normalizeLocationKey = (value: string) => value.trim().toLowerCase();
const normalizeRegionalRoles = (roles: Employee["regionalRoles"], baseLocation: string): Employee["regionalRoles"] => {
  if (!roles || roles.length === 0) {
    return undefined;
  }
  const baseLocationKey = normalizeLocationKey(baseLocation);
  const seenLocation = new Set<string>();
  const normalized = roles.reduce<NonNullable<Employee["regionalRoles"]>>((acc, role) => {
    const location = role.location.trim();
    const title = role.title.trim();
    const department = role.department?.trim() ?? "";
    if (!location || !title) {
      return acc;
    }
    const locationKey = normalizeLocationKey(location);
    if (locationKey === baseLocationKey || seenLocation.has(locationKey)) {
      return acc;
    }
    seenLocation.add(locationKey);
    acc.push({
      location,
      title,
      ...(department ? { department } : {})
    });
    return acc;
  }, []);
  return normalized.length > 0 ? normalized : undefined;
};
const normalizeAdditionalManagerIds = (
  candidateIds: string[] | undefined,
  employeeId: string,
  primaryManagerId: string | null,
  employees: Employee[]
) => {
  const allowed = new Set(employees.map((employee) => employee.id));
  const normalized = Array.from(new Set((candidateIds ?? []).map((id) => id.trim()).filter(Boolean)));
  const filtered = normalized.filter(
    (id) => id !== employeeId && id !== primaryManagerId && allowed.has(id)
  );
  return filtered.length > 0 ? filtered : undefined;
};
type ModalMode = "info" | "confirm";
type ModalTone = "primary" | "danger";
type ScopeMode = "global" | "regional" | "departmental";

const readBooleanQueryParam = (key: string): boolean | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get(key);
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    return false;
  }
  return null;
};

const LIVE_READONLY_DEFAULT = !import.meta.env.DEV;
const IS_PRODUCTION_BUILD = !import.meta.env.DEV;

export default function App() {
  const persistOverride = useMemo(() => readBooleanQueryParam("persist"), []);
  const readonlyOverride = useMemo(() => readBooleanQueryParam("readonly"), []);
  const sharedSyncEnabled = hasSupabaseConfig();
  const localPersistenceEnabled = persistOverride ?? true;
  const initialLocalCache = useMemo(
    () => (localPersistenceEnabled ? readLocalEmployeesCache() : null),
    [localPersistenceEnabled]
  );
  const [employees, setEmployees] = useState<Employee[]>(() => {
    if (initialLocalCache?.data && initialLocalCache.data.length > 0) {
      return initialLocalCache.data;
    }
    return inferHierarchy(rawEmployees);
  });
  const employeesRef = useRef(employees);
  const [historyPast, setHistoryPast] = useState<Employee[][]>([]);
  const [historyFuture, setHistoryFuture] = useState<Employee[][]>([]);
  const [depthLimit, setDepthLimit] = useState<number | null>(null);
  const [showDepartmentHeatmap] = useState(false);

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
  const roleLocationContext = location;
  const contextualEmployees = useMemo(
    () => normalizedEmployees.map((employee) => resolveEmployeeForLocation(employee, roleLocationContext)),
    [normalizedEmployees, roleLocationContext]
  );
  const [isCompactLayout] = useState(true);
  const [isDepartmentLaneView, setIsDepartmentLaneView] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(true);
  const [isTabletViewport, setIsTabletViewport] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isReadOnlyView, setIsReadOnlyView] = useState(() => {
    return readonlyOverride ?? LIVE_READONLY_DEFAULT;
  });
  const [modalState, setModalState] = useState<{
    open: boolean;
    mode: ModalMode;
    tone: ModalTone;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    linkValue: string;
  }>({
    open: false,
    mode: "info",
    tone: "primary",
    title: "",
    message: "",
    confirmText: "OK",
    cancelText: "Cancel",
    linkValue: ""
  });
  const modalActionRef = useRef<(() => void) | null>(null);
  const [sharedLoadCompleted, setSharedLoadCompleted] = useState(!sharedSyncEnabled);
  const lastSharedSnapshotRef = useRef<string | null>(null);
  const localDraftUpdatedAtRef = useRef<string | null>(initialLocalCache?.updatedAt ?? null);
  const sharedSyncErrorShownRef = useRef(false);
  const [urlSyncReady, setUrlSyncReady] = useState(false);
  const [zoom, setZoom] = useState(0.55);
  const [translate, setTranslate] = useState({ x: 500, y: 90 });
  const closeSystemModal = useCallback(() => {
    modalActionRef.current = null;
    setModalState((current) => ({ ...current, open: false, linkValue: "" }));
  }, []);
  const showInfoModal = useCallback(
    (message: string, title = "Notification", options?: { linkValue?: string; confirmText?: string }) => {
      modalActionRef.current = null;
      setModalState({
        open: true,
        mode: "info",
        tone: "primary",
        title,
        message,
        confirmText: options?.confirmText ?? "OK",
        cancelText: "Cancel",
        linkValue: options?.linkValue ?? ""
      });
    },
    []
  );
  const showConfirmModal = useCallback(
    (
      message: string,
      onConfirm: () => void,
      options?: { title?: string; confirmText?: string; cancelText?: string; tone?: ModalTone }
    ) => {
      modalActionRef.current = onConfirm;
      setModalState({
        open: true,
        mode: "confirm",
        tone: options?.tone ?? "primary",
        title: options?.title ?? "Confirm Action",
        message,
        confirmText: options?.confirmText ?? "Confirm",
        cancelText: options?.cancelText ?? "Cancel",
        linkValue: ""
      });
    },
    []
  );
  const handleSystemModalConfirm = useCallback(() => {
    const action = modalActionRef.current;
    modalActionRef.current = null;
    setModalState((current) => ({ ...current, open: false, linkValue: "" }));
    action?.();
  }, []);

  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);

  useEffect(() => {
    if (sharedSyncEnabled) {
      return;
    }
    showInfoModal(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable shared org data.",
      "Supabase Required"
    );
  }, [sharedSyncEnabled, showInfoModal]);

  useEffect(() => {
    if (!sharedSyncEnabled) {
      setSharedLoadCompleted(true);
      return;
    }

    let cancelled = false;

    const hydrateFromSharedStore = async () => {
      try {
        const remotePayload = await loadSharedEmployees();
        if (cancelled) {
          return;
        }

        const remoteEmployees = remotePayload.data;
        if (remoteEmployees && remoteEmployees.length > 0) {
          const normalizedRemoteEmployees = inferHierarchy(remoteEmployees);
          const remoteSnapshot = JSON.stringify(normalizedRemoteEmployees);
          const localSnapshot = JSON.stringify(employeesRef.current);
          const remoteUpdatedAt = parseTimestamp(remotePayload.updatedAt);
          const localUpdatedAt = parseTimestamp(localDraftUpdatedAtRef.current);

          if (localSnapshot !== remoteSnapshot && localUpdatedAt > remoteUpdatedAt) {
            // Keep newer local draft and let sync effect push it to shared storage.
            lastSharedSnapshotRef.current = remoteSnapshot;
          } else {
            lastSharedSnapshotRef.current = remoteSnapshot;
            setEmployees(normalizedRemoteEmployees);
          }
        } else {
          lastSharedSnapshotRef.current = JSON.stringify(inferHierarchy(rawEmployees));
        }
      } catch (error) {
        console.error("Failed to load shared employees", error);
        lastSharedSnapshotRef.current = JSON.stringify(inferHierarchy(rawEmployees));
      } finally {
        if (!cancelled) {
          setSharedLoadCompleted(true);
        }
      }
    };

    void hydrateFromSharedStore();

    return () => {
      cancelled = true;
    };
  }, [sharedSyncEnabled]);

  const focusEmployeeInChart = useCallback((employeeId: string) => {
    setSelectedEmployeeId(employeeId);
    setHoveredEmployeeId(null);
    setHoverPosition(null);

    const centerOnCard = (attempt = 0) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        return;
      }

      const selectorId = employeeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const card = wrapper.querySelector(`[data-employee-id="${selectorId}"]`) as HTMLElement | null;
      if (!card) {
        if (attempt < 10) {
          window.requestAnimationFrame(() => centerOnCard(attempt + 1));
        }
        return;
      }

      const wrapperRect = wrapper.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const cardCenterX = cardRect.left - wrapperRect.left + cardRect.width / 2;
      const cardCenterY = cardRect.top - wrapperRect.top + cardRect.height / 2;
      const targetCenterX = wrapper.clientWidth / 2;
      const targetCenterY = wrapper.clientHeight / 2;
      const deltaX = targetCenterX - cardCenterX;
      const deltaY = targetCenterY - cardCenterY;

      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        const existingPulseCards = wrapper.querySelectorAll(".employee-card.focus-pulse");
        existingPulseCards.forEach((element) => element.classList.remove("focus-pulse"));
        card.classList.remove("focus-pulse");
        // Force reflow so repeated focus on the same card replays the pulse.
        void card.offsetWidth;
        card.classList.add("focus-pulse");
        window.setTimeout(() => {
          card.classList.remove("focus-pulse");
        }, 1200);
        return;
      }

      setTranslate((current) => ({
        x: current.x + deltaX,
        y: current.y + deltaY
      }));

      window.requestAnimationFrame(() => {
        const nextCard = wrapper.querySelector(`[data-employee-id="${selectorId}"]`) as HTMLElement | null;
        if (!nextCard) {
          return;
        }
        const existingPulseCards = wrapper.querySelectorAll(".employee-card.focus-pulse");
        existingPulseCards.forEach((element) => element.classList.remove("focus-pulse"));
        nextCard.classList.remove("focus-pulse");
        void nextCard.offsetWidth;
        nextCard.classList.add("focus-pulse");
        window.setTimeout(() => {
          nextCard.classList.remove("focus-pulse");
        }, 1200);
      });
    };

    window.requestAnimationFrame(() => centerOnCard());
  }, []);
  const zoomPercent = Math.round(zoom * 100);
  const canUndo = !isReadOnlyView && historyPast.length > 0;
  const canRedo = !isReadOnlyView && historyFuture.length > 0;
  const departments = useMemo(() => Array.from(new Set(contextualEmployees.map((employee) => employee.department))).sort(), [contextualEmployees]);
  const locations = useMemo(() => allEmployeeLocations(normalizedEmployees), [normalizedEmployees]);
  const statusCounts = useMemo(
    () =>
      contextualEmployees.reduce<Record<EmployeeStatus, number>>(
        (acc, employee) => {
          acc[employee.status] += 1;
          return acc;
        },
        { standard: 0, promoted: 0, enhanced: 0, new_hire: 0, vacant: 0 }
      ),
    [contextualEmployees]
  );
  const roleLevelCounts = useMemo(
    () =>
      contextualEmployees.reduce<Record<RoleLevel, number>>(
        (acc, employee) => {
          const level = getRoleLevel(employee.title);
          acc[level] += 1;
          return acc;
        },
        { CEO: 0, President: 0, VP: 0, Director: 0, "Sr. Manager": 0, Manager: 0, "Assoc. Manager": 0, Supervisor: 0, "Sr. Specialist": 0, Specialist: 0, Staff: 0, "Assoc. Staff": 0 }
      ),
    [contextualEmployees]
  );
  const executiveCount = useMemo(
    () => contextualEmployees.filter((employee) => isExecutiveEmployee(employee)).length,
    [contextualEmployees]
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
      filterEmployees(contextualEmployees, {
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
    [contextualEmployees, viewMode, department, location, quickFilters, executiveOnly, roleLevel, searchQuery, selectedEmployeeId, activeFilterCount]
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

  const effectiveDepthLimit = useMemo(() => {
    if (isTabletViewport) {
      return depthLimit ? Math.min(depthLimit, 2) : 2;
    }
    return depthLimit;
  }, [depthLimit, isTabletViewport]);

  const chartEmployees = useMemo(
    () =>
      effectiveDepthLimit
        ? visibleEmployees.filter((employee) => (depthById.get(employee.id) ?? 1) <= effectiveDepthLimit)
        : visibleEmployees,
    [visibleEmployees, depthById, effectiveDepthLimit]
  );
  const hasNoResults = chartEmployees.length === 0;

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
  const detailsEmployee = isReadOnlyView ? hoveredEmployee ?? selectedEmployee : selectedEmployee;
  const suggestions = useMemo(() => searchSuggestions(contextualEmployees, searchQuery), [contextualEmployees, searchQuery]);
  const scopeLabel = useMemo(() => {
    if (viewMode === "individual" && selectedEmployee) {
      return `${selectedEmployee.name} Focus`;
    }
    if (viewMode === "department" && department) {
      return `${department} Dept`;
    }
    if (viewMode === "location" && location) {
      return location;
    }
    if (roleLevel) {
      return `${roleLevel} Roles`;
    }
    if (executiveOnly) {
      return "Executive Team";
    }
    if (searchQuery.trim()) {
      return "Search Results";
    }
    if (isDepartmentLaneView) {
      return "Department Lanes";
    }
    return "Global Team";
  }, [department, executiveOnly, isDepartmentLaneView, location, roleLevel, searchQuery, selectedEmployee, viewMode]);
  const activeScope: ScopeMode = viewMode === "location" ? "regional" : viewMode === "department" ? "departmental" : "global";
  const chartTransitionKey = `${activeScope}-${location ?? "all"}-${department ?? "all"}`;
  const mobileDepartmentGroups = useMemo(
    () =>
      Object.entries(
        visibleEmployees.reduce<Record<string, Employee[]>>((acc, employee) => {
          const key = employee.department || "Unassigned";
          const list = acc[key] ?? [];
          list.push(employee);
          acc[key] = list;
          return acc;
        }, {})
      )
        .map(([group, members]) => ({
          group,
          members: [...members].sort((left, right) => left.name.localeCompare(right.name))
        }))
        .sort((left, right) => left.group.localeCompare(right.group)),
    [visibleEmployees]
  );

  const activateGlobalScope = useCallback(() => {
    setViewMode("full");
    setDepartment(null);
    setLocation(null);
    setRoleLevel(null);
    setExecutiveOnly(false);
    setQuickFilters([]);
  }, []);

  const activateRegionalScope = useCallback(() => {
    const nextLocation = location ?? locations[0] ?? null;
    setViewMode("location");
    setLocation(nextLocation);
    setDepartment(null);
    setRoleLevel(null);
    setExecutiveOnly(false);
    setQuickFilters([]);
  }, [location, locations]);

  const activateDepartmentalScope = useCallback(() => {
    const nextDepartment = department ?? departments[0] ?? null;
    setViewMode("department");
    setDepartment(nextDepartment);
    setLocation(null);
    setRoleLevel(null);
    setExecutiveOnly(false);
    setQuickFilters([]);
  }, [department, departments]);

  const fitView = useCallback(() => {
    if (!wrapperRef.current) return;
    const containerWidth = wrapperRef.current.clientWidth;
    const containerHeight = wrapperRef.current.clientHeight;

    // Calculate scale to fit with margin
    const padding = 44;
    const scaleX = (containerWidth - padding) / (chartDims.width || 2000);
    const scaleY = (containerHeight - padding) / (chartDims.height || 1000);

    // Keep regional/departmental charts readable by default.
    const baseMinZoom = activeScope === "global" ? 0.42 : 0.56;
    const readabilityMinZoom =
      chartEmployees.length <= 10 ? 0.74 : chartEmployees.length <= 24 ? 0.62 : baseMinZoom;
    const newZoom = Math.max(readabilityMinZoom, Math.min(scaleX, scaleY, 1.1));

    setZoom(newZoom);

    // Center the chart
    setTranslate({
      x: (containerWidth - chartDims.width * newZoom) / 2,
      y: Math.max(22, (containerHeight - chartDims.height * newZoom) / 2),
    });
  }, [activeScope, chartDims, chartEmployees.length]);

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
    const surface = wrapperRef.current;
    if (!surface) {
      showInfoModal("Unable to export right now. Please try again.", "Export");
      return;
    }
    const exportWidth = Math.max(1, surface.clientWidth);
    const exportHeight = Math.max(1, surface.clientHeight);

    try {
      const pngUrl = await toPng(surface, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#071723",
        width: exportWidth,
        height: exportHeight,
        style: {
          overflow: "hidden"
        },
        imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
      });

      const link = document.createElement("a");
      link.href = pngUrl;
      link.download = `madison88-org-view-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
    } catch (error) {
      console.error("Failed to export PNG", error);
      showInfoModal("PNG export failed. Check image permissions and try again.", "Export");
    }
  }, [showInfoModal]);

  const uploadPhotoToSupabase = useCallback(
    async (file: File, employeeId?: string) => {
      return uploadEmployeePhoto(file, employeeId);
    },
    []
  );

  const exportPdf = useCallback(async () => {
    if (!wrapperRef.current) {
      showInfoModal("Unable to export PDF right now. Please try again.", "Export");
      return;
    }

    try {
      const printableEmployees = chartEmployees;
      if (!printableEmployees || printableEmployees.length === 0) {
        showInfoModal("No chart data to export.", "Export");
        return;
      }

      const byId = new Map<string, LayoutNode>();
      printableEmployees.forEach((employee) => {
        byId.set(employee.id, {
          id: employee.id,
          employee,
          children: [],
          x: 0,
          y: 0,
          subtreeWidth: 0
        });
      });

      const forestRoots: LayoutNode[] = [];
      printableEmployees.forEach((employee) => {
        const node = byId.get(employee.id);
        if (!node) {
          return;
        }
        const managerNode = employee.managerId ? byId.get(employee.managerId) : undefined;
        if (managerNode && managerNode.id !== node.id) {
          managerNode.children.push(node);
        } else {
          forestRoots.push(node);
        }
      });

      if (forestRoots.length === 0) {
        showInfoModal("No chart hierarchy available for export.", "Export");
        return;
      }

      const anchorEmployee = printableEmployees[0];
      const syntheticRoot: LayoutNode = {
        id: "__export_root__",
        employee: {
          ...anchorEmployee,
          id: "__export_root__",
          name: "Export Root",
          title: "",
          managerId: null
        },
        children: forestRoots,
        x: 0,
        y: 0,
        subtreeWidth: 0
      };

      const exportLayoutConfig = {
        nodeWidth: 194,
        nodeHeight: 112,
        levelGap: 34,
        siblingGap: 24
      };
      const flattenNodes = (rootNode: LayoutNode): LayoutNode[] => {
        const list: LayoutNode[] = [];
        const visit = (node: LayoutNode) => {
          list.push(node);
          node.children.forEach(visit);
        };
        visit(rootNode);
        return list.filter((node) => node.id !== "__export_root__");
      };

      const measureBounds = (nodes: LayoutNode[]) => {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        nodes.forEach((node) => {
          minX = Math.min(minX, node.x);
          minY = Math.min(minY, node.y);
          maxX = Math.max(maxX, node.x + exportLayoutConfig.nodeWidth);
          maxY = Math.max(maxY, node.y + exportLayoutConfig.nodeHeight);
        });

        const contentWidth = Math.max(1, maxX - minX);
        const contentHeight = Math.max(1, maxY - minY);
        return { minX, minY, maxX, maxY, contentWidth, contentHeight };
      };

      // Branch out downward across all levels by wrapping each level into compact rows.
      const exportColumnLimit = printableEmployees.length <= 28 ? 4 : printableEmployees.length <= 70 ? 5 : 6;
      calculateDepartmentLaneLayout(syntheticRoot, exportLayoutConfig, exportColumnLimit, 99);
      let exportNodes = flattenNodes(syntheticRoot);
      let bounds = measureBounds(exportNodes);

      // If still too wide, reflow with fewer columns to push more vertical branching.
      const initialAspectRatio = bounds.contentWidth / Math.max(bounds.contentHeight, 1);
      if (initialAspectRatio > 2.1 && exportColumnLimit > 4) {
        calculateDepartmentLaneLayout(syntheticRoot, exportLayoutConfig, exportColumnLimit - 2, 99);
        exportNodes = flattenNodes(syntheticRoot);
        bounds = measureBounds(exportNodes);
      }

      const depthByNodeId = new Map<string, number>();
      const assignDepth = (node: LayoutNode, depth: number) => {
        if (node.id !== "__export_root__") {
          depthByNodeId.set(node.id, depth);
        }
        node.children.forEach((child) => assignDepth(child, depth + 1));
      };
      syntheticRoot.children.forEach((child) => assignDepth(child, 1));
      const maxHierarchyDepth = Math.max(...Array.from(depthByNodeId.values()), 1);

      const { minX, minY, contentWidth, contentHeight } = bounds;
      const orientation: "portrait" | "landscape" = "landscape";
      const smallHierarchy = exportNodes.length <= 24;
      const denseHierarchy = exportNodes.length > 58;
      const pdf = new jsPDF({
        orientation,
        unit: "mm",
        format: denseHierarchy ? "a1" : "a2",
        compress: true
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 5;
      const usableWidth = pageWidth - margin * 2;
      const usableHeight = pageHeight - margin * 2;
      const widthScale = usableWidth / Math.max(contentWidth, 1);
      const heightScale = usableHeight / Math.max(contentHeight, 1);
      const fitScale = Math.min(widthScale, heightScale);
      const contentAspectRatio = contentWidth / Math.max(contentHeight, 1);
      const upscaleCap = smallHierarchy ? 0.84 : exportNodes.length <= 44 ? 1.02 : 1.08;
      const exportScale = Math.min(fitScale, upscaleCap);
      // Use more horizontal canvas for narrow/tall outputs to improve readability.
      const horizontalStretchMultiplier =
        contentAspectRatio < 0.68
          ? Math.min(1.55, Math.max(1.18, widthScale / Math.max(exportScale, 0.01)))
          : 1.08;
      const stretchedXScale = Math.min(widthScale, exportScale * horizontalStretchMultiplier);

      const initialsFromName = (name: string): string => {
        const parts = name
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (parts.length === 0) {
          return "NA";
        }
        if (parts.length === 1) {
          return parts[0].slice(0, 2).toUpperCase();
        }
        return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
      };

      const asPhotoDataUrl = async (value: string): Promise<string | null> => {
        const source = value.trim();
        if (!source) {
          return null;
        }
        if (source.startsWith("data:image/")) {
          return source;
        }
        try {
          const response = await fetch(source, { mode: "cors", cache: "force-cache" });
          if (!response.ok) {
            return null;
          }
          const blob = await response.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(new Error("photo-read-failed"));
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      const photoCache = new Map<string, string | null>();
      const uniquePhotoSources = Array.from(
        new Set(
          exportNodes
            .map((node) => node.employee.photo?.trim() ?? "")
            .filter((photo) => Boolean(photo))
        )
      );
      await Promise.all(
        uniquePhotoSources.map(async (photo) => {
          photoCache.set(photo, await asPhotoDataUrl(photo));
        })
      );

      const drawPage = (
        pageLeft: number,
        pageTop: number,
        xScale: number,
        yScale: number,
        offsetX: number,
        offsetY: number,
        clipToPage: boolean,
        pageIndex: number,
        pageCount: number
      ) => {
        const pageRight = pageLeft + usableWidth / xScale;
        const pageBottom = pageTop + usableHeight / yScale;
        const intersects = (left: number, top: number, right: number, bottom: number) =>
          !(right < pageLeft || left > pageRight || bottom < pageTop || top > pageBottom);

        const toPdfX = (value: number) => offsetX + (value - pageLeft) * xScale;
        const toPdfY = (value: number) => offsetY + (value - pageTop) * yScale;
        const nodeWidthMm = exportLayoutConfig.nodeWidth * xScale;
        const nodeHeightMm = exportLayoutConfig.nodeHeight * yScale;
        const nodeCorner = Math.max(0.8, Math.min(2.2, nodeHeightMm * 0.12));
        const nameFontSize = Math.max(7.4, Math.min(10.4, nodeHeightMm * 0.23));
        const titleFontSize = Math.max(6.2, Math.min(8.2, nodeHeightMm * 0.18));

        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidth, pageHeight, "F");

        pdf.setLineCap("round");
        pdf.setLineJoin("round");
        exportNodes.forEach((node) => {
          node.children.forEach((child) => {
            if (child.id === "__export_root__") {
              return;
            }
            const sourceDepth = depthByNodeId.get(node.id) ?? 1;
            const depthRatio =
              maxHierarchyDepth > 1 ? (sourceDepth - 1) / (maxHierarchyDepth - 1) : 0;
            const channel = Math.round(52 + depthRatio * 56);
            const connectorThickness = Math.max(0.3, Math.min(0.62, 0.58 - depthRatio * 0.16));

            const sx = node.x + exportLayoutConfig.nodeWidth / 2;
            const sy = node.y + exportLayoutConfig.nodeHeight;
            const ex = child.x + exportLayoutConfig.nodeWidth / 2;
            const ey = child.y;
            if (clipToPage && !intersects(Math.min(sx, ex), Math.min(sy, ey), Math.max(sx, ex), Math.max(sy, ey))) {
              return;
            }
            const startX = toPdfX(sx);
            const startY = toPdfY(sy);
            const endX = toPdfX(ex);
            const endY = toPdfY(ey);
            const midY = startY + Math.max(1.2, (endY - startY) * 0.45);

            pdf.setDrawColor(channel, channel + 23, channel + 39);
            pdf.setLineWidth(connectorThickness);
            pdf.line(startX, startY, startX, midY);
            pdf.line(startX, midY, endX, midY);
            pdf.line(endX, midY, endX, endY);

            // Small anchor markers improve readability when lines cross dense sections.
            pdf.setFillColor(channel, channel + 23, channel + 39);
            pdf.circle(startX, startY, 0.26, "F");
            pdf.circle(endX, endY, 0.24, "F");
          });
        });

        exportNodes.forEach((node) => {
          const nx = node.x;
          const ny = node.y;
          const nr = node.x + exportLayoutConfig.nodeWidth;
          const nb = node.y + exportLayoutConfig.nodeHeight;
          if (clipToPage && !intersects(nx, ny, nr, nb)) {
            return;
          }

          const x = toPdfX(node.x);
          const y = toPdfY(node.y);
          pdf.setFillColor(255, 255, 255);
          pdf.setDrawColor(124, 149, 166);
          pdf.setLineWidth(0.2);
          pdf.roundedRect(x, y, nodeWidthMm, nodeHeightMm, nodeCorner, nodeCorner, "FD");

          const textMarginX = Math.max(1.2, nodeWidthMm * 0.05);
          const avatarSize = Math.max(4.4, Math.min(10.8, nodeHeightMm * 0.42));
          const avatarX = x + (nodeWidthMm - avatarSize) / 2;
          const avatarY = y + Math.max(1.2, nodeHeightMm * 0.08);
          const photoSource = node.employee.photo?.trim() ?? "";
          const photoDataUrl = photoSource ? photoCache.get(photoSource) ?? null : null;
          if (photoDataUrl) {
            const format = photoDataUrl.includes("image/png") ? "PNG" : "JPEG";
            pdf.addImage(photoDataUrl, format as "PNG" | "JPEG", avatarX, avatarY, avatarSize, avatarSize, undefined, "FAST");
          } else {
            pdf.setFillColor(233, 242, 248);
            pdf.setDrawColor(132, 157, 176);
            pdf.circle(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, "FD");
            pdf.setTextColor(66, 94, 116);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(Math.max(3.4, Math.min(6.6, avatarSize * 0.65)));
            pdf.text(initialsFromName(node.employee.name), avatarX + avatarSize / 2, avatarY + avatarSize / 2 + 0.1, {
              align: "center",
              baseline: "middle"
            });
          }

          const contentTop = avatarY + avatarSize + Math.max(1.2, nodeHeightMm * 0.08);
          const contentBottom = y + nodeHeightMm - Math.max(1.2, nodeHeightMm * 0.08);
          const nameLineHeight = Math.max(1.4, nameFontSize * 0.42);
          const titleLineHeight = Math.max(1.2, titleFontSize * 0.42);
          const maxTextWidth = Math.max(8, nodeWidthMm - textMarginX * 2);

          let nameLines = pdf.splitTextToSize(node.employee.name, maxTextWidth).slice(0, 3);
          let titleLines = pdf.splitTextToSize(node.employee.title, maxTextWidth).slice(0, 2);
          const blockGap = Math.max(0.9, nodeHeightMm * 0.045);
          let nameBlockHeight = nameLines.length * nameLineHeight;
          let titleBlockHeight = titleLines.length * titleLineHeight;
          let totalTextHeight = nameBlockHeight + blockGap + titleBlockHeight;
          const availableTextHeight = Math.max(0, contentBottom - contentTop);

          if (totalTextHeight > availableTextHeight) {
            nameLines = nameLines.slice(0, 2);
            titleLines = titleLines.slice(0, 1);
            nameBlockHeight = nameLines.length * nameLineHeight;
            titleBlockHeight = titleLines.length * titleLineHeight;
            totalTextHeight = nameBlockHeight + blockGap + titleBlockHeight;
          }

          const textStartY = contentTop + Math.max(0, (availableTextHeight - totalTextHeight) / 2);
          pdf.setTextColor(16, 45, 66);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(nameFontSize);
          pdf.text(nameLines, x + nodeWidthMm / 2, textStartY, { align: "center", baseline: "top" });

          pdf.setTextColor(58, 87, 109);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(titleFontSize);
          const titleStartY = textStartY + nameBlockHeight + blockGap;
          pdf.text(titleLines, x + nodeWidthMm / 2, titleStartY, { align: "center", baseline: "top" });
        });

        if (pageCount > 1) {
          pdf.setTextColor(90, 104, 118);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(8);
          pdf.text(`Page ${pageIndex + 1} of ${pageCount}`, pageWidth - margin, pageHeight - 3.5, { align: "right" });
        }
      };

      // Always keep PDF export to one landscape page.
      const offsetX = margin + Math.max(0, (usableWidth - contentWidth * stretchedXScale) / 2);
      const offsetY = margin + Math.max(0, (usableHeight - contentHeight * exportScale) / 2);
      drawPage(minX, minY, stretchedXScale, exportScale, offsetX, offsetY, false, 0, 1);

      pdf.save(`madison88-org-view-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error("Failed to export PDF", error);
      showInfoModal("PDF export failed. Please try again.", "Export");
    }
  }, [chartEmployees, showInfoModal]);

  const printChart = useCallback(() => {
    window.print();
  }, []);

  const undoEmployeesChange = useCallback(() => {
    if (isReadOnlyView) {
      return;
    }
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
  }, [employees, isReadOnlyView]);

  const redoEmployeesChange = useCallback(() => {
    if (isReadOnlyView) {
      return;
    }
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
  }, [employees, isReadOnlyView]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const targetTag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (targetTag === "input" || targetTag === "textarea" || targetTag === "select") {
        return;
      }
      if (isReadOnlyView) {
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
  }, [fitView, isReadOnlyView, redoEmployeesChange, undoEmployeesChange, zoomAroundPoint, zoom]);

  useEffect(() => {
    const syncViewport = () => {
      const width = window.innerWidth;
      setIsMobileViewport(width <= 760);
      setIsTabletViewport(width > 760 && width <= 1120);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

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
    if (!localPersistenceEnabled) {
      return;
    }
    if (sharedSyncEnabled && !sharedLoadCompleted) {
      return;
    }
    try {
      const updatedAt = new Date().toISOString();
      localDraftUpdatedAtRef.current = updatedAt;
      window.localStorage.setItem(
        EMPLOYEES_STORAGE_KEY,
        JSON.stringify({
          data: employees,
          updatedAt
        })
      );
    } catch {
      // Ignore persistence errors in restricted/private environments.
    }
  }, [employees, localPersistenceEnabled, sharedLoadCompleted, sharedSyncEnabled]);

  useEffect(() => {
    if (!localPersistenceEnabled) {
      return;
    }
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith(`${EMPLOYEES_STORAGE_PREFIX}_`) && key !== EMPLOYEES_STORAGE_KEY)
        .forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Ignore persistence cleanup errors in restricted/private environments.
    }
  }, [localPersistenceEnabled]);

  useEffect(() => {
    if (!sharedSyncEnabled || !sharedLoadCompleted || isReadOnlyView) {
      return;
    }

    const snapshot = JSON.stringify(employees);
    if (snapshot === lastSharedSnapshotRef.current) {
      return;
    }

    const syncTimer = window.setTimeout(async () => {
      try {
        await saveSharedEmployees(employees);
        lastSharedSnapshotRef.current = snapshot;
        sharedSyncErrorShownRef.current = false;
      } catch (error) {
        console.error("Failed to save shared employees", error);
        if (!sharedSyncErrorShownRef.current) {
          showInfoModal("Unable to sync changes for all users right now. Please try again in a moment.", "Sync Error");
          sharedSyncErrorShownRef.current = true;
        }
      }
    }, 500);

    return () => {
      window.clearTimeout(syncTimer);
    };
  }, [employees, isReadOnlyView, sharedLoadCompleted, sharedSyncEnabled, showInfoModal]);

  useEffect(() => {
    if (!sharedSyncEnabled || !sharedLoadCompleted) {
      return;
    }

    let cancelled = false;
    const pollRemoteEmployees = async () => {
      try {
        const remotePayload = await loadSharedEmployees();
        if (cancelled || !remotePayload.data) {
          return;
        }

        const normalizedRemoteEmployees = inferHierarchy(remotePayload.data);
        const remoteSnapshot = JSON.stringify(normalizedRemoteEmployees);
        const localSnapshot = JSON.stringify(employeesRef.current);
        if (remoteSnapshot === localSnapshot) {
          return;
        }

        const remoteUpdatedAt = parseTimestamp(remotePayload.updatedAt);
        const localUpdatedAt = parseTimestamp(localDraftUpdatedAtRef.current);
        if (remoteUpdatedAt >= localUpdatedAt) {
          lastSharedSnapshotRef.current = remoteSnapshot;
          setEmployees(normalizedRemoteEmployees);
        }
      } catch {
        // Ignore transient polling errors.
      }
    };

    const intervalId = window.setInterval(() => {
      void pollRemoteEmployees();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [sharedLoadCompleted, sharedSyncEnabled]);

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
    setViewMode("department");
    setDepartment((current) => current ?? departments[0] ?? null);
    setLocation(null);
    setQuickFilters([]);
    setSearchQuery("");
    setRoleLevel(null);
    setExecutiveOnly(false);
    setIsDepartmentLaneView(false);
  }, [departments]);

  const applyAllEmployeesPreset = useCallback(() => {
    activateGlobalScope();
    setIsDepartmentLaneView(false);
  }, [activateGlobalScope]);

  const addEmployee = useCallback(
    (input: NewEmployeeInput) => {
      if (isReadOnlyView) {
        return;
      }
      const name = input.name.trim();
      const title = input.title.trim();
      const departmentValue = input.department.trim();
      const locationValue = input.location.trim();
      const normalizedEmail = input.email.trim().toLowerCase();
      const startDate = input.startDate.trim();
      const status = input.status;
      const normalizedPhoto = input.photo?.trim() ?? "";
      const normalizedRegionalRoles = normalizeRegionalRoles(input.regionalRoles, locationValue);
      const requiresContactDetails = status !== "vacant";
      if (!name || !title || !departmentValue || !locationValue) {
        showInfoModal("Please complete all required employee fields before saving.", "Validation");
        return;
      }
      if (requiresContactDetails && (!normalizedEmail || !startDate)) {
        showInfoModal("Email and start date are required unless status is Vacant.", "Validation");
        return;
      }

      if (normalizedEmail && employees.some((employee) => employee.email.trim().toLowerCase() === normalizedEmail)) {
        showInfoModal("Email already exists. Please use a unique email address.", "Validation");
        return;
      }

      const nextId =
        (employees.reduce((max, employee) => Math.max(max, Number.parseInt(employee.id, 10) || 0), 0) + 1)
          .toString()
          .padStart(3, "0");
      const additionalManagerIds = normalizeAdditionalManagerIds(
        input.additionalManagerIds,
        nextId,
        input.managerId,
        employees
      );

      const newEmployee: Employee = {
        id: nextId,
        name,
        title,
        department: departmentValue,
        location: locationValue,
        email: normalizedEmail || `vacant-${nextId}@madison88.local`,
        startDate: startDate || new Date().toISOString().slice(0, 10),
        status,
        managerId: input.managerId,
        ...(additionalManagerIds ? { additionalManagerIds } : {}),
        regionalRoles: normalizedRegionalRoles,
        photo: normalizedPhoto || generatedAvatarPhoto(name)
      };

      commitEmployeesChange([...employees, newEmployee]);
      setSelectedEmployeeId(nextId);
    },
    [commitEmployeesChange, employees, isReadOnlyView, showInfoModal]
  );

  const updateEmployee = useCallback((input: UpdateEmployeeInput) => {
    if (isReadOnlyView) {
      return;
    }
    const name = input.name.trim();
    const title = input.title.trim();
    const departmentValue = input.department.trim();
    const locationValue = input.location.trim();
    const normalizedEmail = input.email.trim().toLowerCase();
    const startDate = input.startDate.trim();
    const normalizedPhoto = input.photo?.trim() ?? "";
    const normalizedRegionalRoles = normalizeRegionalRoles(input.regionalRoles, locationValue);
    const requiresContactDetails = input.status !== "vacant";
    if (!name || !title || !departmentValue || !locationValue) {
      showInfoModal("Please complete all required employee fields before saving.", "Validation");
      return;
    }
    if (requiresContactDetails && (!normalizedEmail || !startDate)) {
      showInfoModal("Email and start date are required unless status is Vacant.", "Validation");
      return;
    }

    if (input.managerId === input.id) {
      showInfoModal("An employee cannot be their own manager.", "Validation");
      return;
    }
    const additionalManagerIds = normalizeAdditionalManagerIds(
      input.additionalManagerIds,
      input.id,
      input.managerId,
      employees
    );

    if (normalizedEmail && employees.some((employee) => employee.id !== input.id && employee.email.trim().toLowerCase() === normalizedEmail)) {
      showInfoModal("Email already exists. Please use a unique email address.", "Validation");
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
            email: normalizedEmail || `vacant-${input.id}@madison88.local`,
            startDate: startDate || employee.startDate || new Date().toISOString().slice(0, 10),
            status: input.status,
            managerId: input.managerId,
            ...(additionalManagerIds ? { additionalManagerIds } : { additionalManagerIds: undefined }),
            regionalRoles: normalizedRegionalRoles,
            photo:
              input.photo !== undefined
                ? (normalizedPhoto || generatedAvatarPhoto(name))
                : (employee.photo || generatedAvatarPhoto(name))
          }
          : employee
      )
    );
  }, [commitEmployeesChange, employees, isReadOnlyView, showInfoModal]);

  const assignReportsToManager = useCallback(
    (managerId: string, reportIds: string[]) => {
      if (isReadOnlyView) {
        return;
      }
      const manager = employees.find((employee) => employee.id === managerId);
      if (!manager) {
        showInfoModal("Selected manager was not found.", "Validation");
        return;
      }

      const uniqueReportIds = Array.from(new Set(reportIds.filter((id) => id && id !== managerId)));
      if (uniqueReportIds.length === 0) {
        return;
      }

      const byId = new Map(employees.map((employee) => [employee.id, employee]));
      const ancestorIds = new Set<string>();
      let currentAncestorId = manager.managerId;
      while (currentAncestorId) {
        ancestorIds.add(currentAncestorId);
        currentAncestorId = byId.get(currentAncestorId)?.managerId ?? null;
      }

      const invalidAssignments = uniqueReportIds.filter((id) => ancestorIds.has(id));
      if (invalidAssignments.length > 0) {
        const invalidNames = invalidAssignments
          .map((id) => byId.get(id)?.name ?? id)
          .join(", ");
        showInfoModal(
          `Cannot assign manager ancestors as direct reports (${invalidNames}).`,
          "Validation"
        );
        return;
      }

      const reportIdSet = new Set(uniqueReportIds);
      commitEmployeesChange(
        employees.map((employee) =>
          reportIdSet.has(employee.id)
            ? {
                ...employee,
                managerId,
                additionalManagerIds: employee.additionalManagerIds?.filter((id) => id !== managerId)
              }
            : employee
        )
      );
    },
    [commitEmployeesChange, employees, isReadOnlyView, showInfoModal]
  );

  const deleteEmployee = useCallback(
    (employeeId: string) => {
      if (isReadOnlyView) {
        return;
      }
      if (employees.length <= 1) {
        showInfoModal("Cannot delete the last employee in the directory.", "Validation");
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

      showConfirmModal(
        confirmationMessage,
        () => {
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
                    managerId: nextManagerId,
                    additionalManagerIds: employee.additionalManagerIds?.filter(
                      (id) => id !== employeeId && id !== nextManagerId
                    )
                  }
                  : {
                    ...employee,
                    additionalManagerIds: employee.additionalManagerIds?.filter((id) => id !== employeeId)
                  }
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
        {
          title: "Delete Employee",
          confirmText: "Delete",
          cancelText: "Cancel",
          tone: "danger"
        }
      );
    },
    [commitEmployeesChange, employees, isReadOnlyView, showConfirmModal, showInfoModal]
  );

  useEffect(() => {
    if (hasInitializedFromUrl.current) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const preset = params.get("preset");
    const role = params.get("role");
    const query = params.get("q");
    const readonly = params.get("readonly");

    if (preset === "departmental" || preset === "department") {
      applyDepartmentPreset();
    } else if (preset === "regional") {
      activateRegionalScope();
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

    if (readonly === "1" || readonly === "0") {
      setIsReadOnlyView(readonly === "1");
    } else if (readonlyOverride !== null) {
      setIsReadOnlyView(readonlyOverride);
    } else {
      setIsReadOnlyView(LIVE_READONLY_DEFAULT);
    }
    setShowFilterPanel(params.get("filters") !== "0");
    hasInitializedFromUrl.current = true;
    setUrlSyncReady(true);
  }, [activateRegionalScope, applyAllEmployeesPreset, applyDepartmentPreset, applyLeadershipPreset, readonlyOverride]);

  useEffect(() => {
    if (!urlSyncReady) {
      return;
    }

    const params = new URLSearchParams();
    const preset =
      executiveOnly && (roleLevel === "CEO" || roleLevel === "President" || roleLevel === "VP")
        ? "leadership"
        : viewMode === "location"
          ? "regional"
          : viewMode === "department"
            ? "departmental"
            : "all";
    params.set("preset", preset);
    if (roleLevel) {
      params.set("role", roleLevel);
    }
    if (searchQuery.trim()) {
      params.set("q", searchQuery.trim());
    }
    if (showFilterPanel) {
      params.set("filters", "1");
    }
    if (!IS_PRODUCTION_BUILD && persistOverride !== null) {
      params.set("persist", persistOverride ? "1" : "0");
    }
    if (readonlyOverride !== null) {
      params.set("readonly", isReadOnlyView ? "1" : "0");
    } else if (isReadOnlyView) {
      params.set("readonly", "1");
    }

    const queryString = params.toString();
    const nextUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  }, [urlSyncReady, executiveOnly, roleLevel, viewMode, isReadOnlyView, searchQuery, showFilterPanel, persistOverride, readonlyOverride]);

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

  useEffect(() => {
    if (!modalState.open) {
      return;
    }

    const onModalKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSystemModal();
        return;
      }
      if (event.key === "Enter") {
        handleSystemModalConfirm();
      }
    };

    window.addEventListener("keydown", onModalKeydown);
    return () => window.removeEventListener("keydown", onModalKeydown);
  }, [closeSystemModal, handleSystemModalConfirm, modalState.open]);

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
          <h2>
            {activeScope === "global"
              ? "Global Team"
              : activeScope === "regional"
                ? `Regional Team - ${scopeLabel}`
                : `Departmental Team - ${scopeLabel}`}
          </h2>
        </div>
        <div className="header-tools">
          <SearchBar
            query={searchQuery}
            suggestions={suggestions}
            onChange={setSearchQuery}
            onClear={() => setSearchQuery("")}
            onSelectSuggestion={(id) => {
              focusEmployeeInChart(id);
              setViewMode("individual");
              setSearchQuery("");
            }}
          />
        </div>
      </header>

      <section className="scope-control-bar" aria-label="Chart scope controls">
        <div className="scope-main-controls">
          <div className="scope-button-group" role="tablist" aria-label="Chart Scope">
            <button
              type="button"
              role="tab"
              aria-selected={activeScope === "global"}
              className={`scope-btn ${activeScope === "global" ? "is-active" : ""}`}
              onClick={activateGlobalScope}
            >
              Global
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeScope === "regional"}
              className={`scope-btn ${activeScope === "regional" ? "is-active" : ""}`}
              onClick={activateRegionalScope}
            >
              Regional
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeScope === "departmental"}
              className={`scope-btn ${activeScope === "departmental" ? "is-active" : ""}`}
              onClick={activateDepartmentalScope}
            >
              Departmental
            </button>
          </div>

          {activeScope === "regional" && (
            <div className="scope-chip-row" aria-label="Regional locations">
              {locations.map((entry) => (
                <button
                  type="button"
                  key={entry}
                  className={`scope-chip ${location === entry ? "is-active" : ""}`}
                  onClick={() => {
                    setViewMode("location");
                    setLocation(entry);
                  }}
                >
                  {entry}
                </button>
              ))}
            </div>
          )}

          {activeScope === "departmental" && (
            <div className="scope-chip-row" aria-label="Departments">
              {departments.map((entry) => (
                <button
                  type="button"
                  key={entry}
                  className={`scope-chip ${department === entry ? "is-active" : ""}`}
                  onClick={() => {
                    setViewMode("department");
                    setDepartment(entry);
                  }}
                >
                  {entry}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="scope-support-panels">
          <Legend compact />
        </div>
      </section>

      <main className="layout-grid no-left">
        <section className="chart-column">
          <div className="chart-actions">
            <div className="chart-toolbar" aria-label="Zoom controls">
              <div className="toolbar-group toolbar-group-nav">
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
              </div>
              <div className="toolbar-group toolbar-group-end toolbar-group-actions">
                <button type="button" onClick={downloadPng}>
                  Download PNG
                </button>
                <button type="button" onClick={exportPdf}>
                  Export PDF
                </button>
                <button type="button" onClick={printChart}>
                  Print
                </button>
                <button type="button" onClick={() => setShowFilterPanel((current) => !current)}>
                  {showFilterPanel ? "Hide Filters" : "Show Filters"}
                </button>
              </div>
            </div>
            <div className="toolbar-meta" role="status" aria-live="polite">
              <span>Zoom {zoomPercent}%</span>
              <span>Pan X {Math.round(translate.x)}</span>
              <span>Pan Y {Math.round(translate.y)}</span>
              {isTabletViewport && <span>Tablet mode: Level 2 preview</span>}
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
            {(isMobileViewport ? mobileDepartmentGroups.length === 0 : hasNoResults) ? (
              <div className="chart-empty-state" role="status" aria-live="polite">
                <h3>No matching employees</h3>
                <p>Walang results sa selected filters. Try another filter or reset to view all employees.</p>
                <div className="chart-empty-actions">
                  <button
                    type="button"
                    onClick={() => {
                      resetAllFilters();
                      setDepthLimit(null);
                      setShowFilterPanel(true);
                    }}
                  >
                    Reset Filters
                  </button>
                  <button type="button" onClick={() => setShowFilterPanel(true)}>
                    Open Filters
                  </button>
                </div>
              </div>
            ) : isMobileViewport ? (
              <div className="mobile-list-view" key={chartTransitionKey}>
                <p className="mobile-view-note">Mobile view: grouped list by department</p>
                {mobileDepartmentGroups.map((group) => (
                  <section key={group.group} className="mobile-group">
                    <h3>{group.group}</h3>
                    {group.members.map((employee) => (
                      <button
                        key={employee.id}
                        type="button"
                        className="mobile-employee-item"
                        onClick={() => focusEmployeeInChart(employee.id)}
                      >
                        <span>{employee.name}</span>
                        <small>{employee.title}</small>
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            ) : (
              <div
                key={chartTransitionKey}
                className="chart-pan-layer"
                style={{
                  width: "100%",
                  height: "100%",
                  cursor: isDragging ? "grabbing" : "grab",
                  overflow: "hidden",
                  userSelect: "none"
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <div
                  style={{
                    transform: `translate(${translate.x}px, ${translate.y}px) scale(${zoom})`,
                    transformOrigin: "0 0",
                    transition: isDragging ? "none" : "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)"
                  }}
                >
                  <OrgChartManual
                    employees={chartEmployees}
                    isDepartmentLaneView={isDepartmentLaneView}
                    exportMode={false}
                    isCompactLayout={isCompactLayout}
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
            )}
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
                  readonlyMode={isReadOnlyView}
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
          onFocus={focusEmployeeInChart}
          onAddEmployee={addEmployee}
          onUpdateEmployee={updateEmployee}
          onAssignReports={assignReportsToManager}
          onDeleteEmployee={deleteEmployee}
          onUploadPhoto={uploadPhotoToSupabase}
          onNotify={showInfoModal}
          readonlyMode={isReadOnlyView}
          isHoverPreview={isReadOnlyView && Boolean(hoveredEmployee)}
        />
      </main>
      {hoveredEmployee && hoverPosition && (
        <HoverTooltip employee={hoveredEmployee} employees={contextualEmployees} position={hoverPosition} />
      )}
      {modalState.open && (
        <div className="system-modal-backdrop" onClick={closeSystemModal}>
          <section
            className={`system-modal ${modalState.tone === "danger" ? "is-danger" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="system-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="system-modal-title">{modalState.title}</h3>
            <p>{modalState.message}</p>
            {modalState.linkValue && (
              <div className="system-modal-link-wrap">
                <input
                  value={modalState.linkValue}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                  onClick={(event) => event.currentTarget.select()}
                  aria-label="Share link"
                />
              </div>
            )}
            <div className="system-modal-actions">
              {modalState.mode === "confirm" && (
                <button type="button" className="ghost-btn" onClick={closeSystemModal}>
                  {modalState.cancelText}
                </button>
              )}
              {modalState.linkValue && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={async () => {
                    try {
                      await window.navigator.clipboard.writeText(modalState.linkValue);
                      showInfoModal("View-only link copied.", "Share Link");
                    } catch {
                      // Keep modal open so user can manually copy.
                    }
                  }}
                >
                  Copy Link
                </button>
              )}
              <button
                type="button"
                className={modalState.tone === "danger" ? "danger-btn" : ""}
                onClick={handleSystemModalConfirm}
              >
                {modalState.confirmText}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
