import type { EmployeeStatus, RoleLevel, ViewMode } from "../utils/org";

interface FilterPanelProps {
  readonlyMode?: boolean;
  viewMode: ViewMode;
  department: string | null;
  location: string | null;
  quickFilters: EmployeeStatus[];
  executiveOnly: boolean;
  roleLevel: RoleLevel | null;
  departments: readonly string[];
  locations: readonly string[];
  statusCounts: Record<EmployeeStatus, number>;
  roleLevelCounts: Record<RoleLevel, number>;
  executiveCount: number;
  hasActiveFilters: boolean;
  onViewMode: (mode: ViewMode) => void;
  onDepartment: (department: string | null) => void;
  onLocation: (location: string | null) => void;
  onToggleStatus: (status: EmployeeStatus) => void;
  onToggleExecutive: () => void;
  onRoleLevel: (roleLevel: RoleLevel | null) => void;
  onPresetLeadership: () => void;
  onPresetDepartment: () => void;
  onPresetAllEmployees: () => void;
  onResetAll: () => void;
}

export function FilterPanel(props: FilterPanelProps) {
  const activeScope = props.viewMode === "location" ? "regional" : props.viewMode === "department" ? "departmental" : "global";
  const roleLevelOptions: Array<{ level: RoleLevel; label: string }> = [
    { level: "Level 0", label: "Level 0 - CEO / President" },
    { level: "Level 1", label: "Level 1 - VP / CFO / Director" },
    { level: "Level 2", label: "Level 2 - Senior Manager" },
    { level: "Level 3", label: "Level 3 - Manager / Associate Manager" },
    { level: "Level 4", label: "Level 4 - Supervisor / Lead" },
    { level: "Level 5", label: "Level 5 - Engineer / Sr. Specialist / Sr. Designer" },
    { level: "Level 6", label: "Level 6 - Specialist / Coordinator / Planner / Developer" },
    { level: "Level 7", label: "Level 7 - Associate / Assistant / Intern" }
  ];

  const activateGlobalScope = () => {
    props.onResetAll();
    props.onViewMode("full");
  };

  const activateRegionalScope = () => {
    props.onResetAll();
    const preferredLocation = props.location ?? props.locations[0] ?? null;
    props.onLocation(preferredLocation);
    props.onViewMode("location");
  };

  const activateDepartmentalScope = () => {
    props.onResetAll();
    const preferredDepartment = props.department ?? props.departments[0] ?? null;
    props.onDepartment(preferredDepartment);
    props.onViewMode("department");
  };

  return (
    <div className="filter-panel">
      <div className="active-filters-bar">
        <p>{props.hasActiveFilters ? "Filters active" : "No active filters"}</p>
        <button type="button" className="ghost-btn" onClick={props.onResetAll} disabled={!props.hasActiveFilters}>
          Reset all
        </button>
      </div>

      <div className="filter-group">
        <h3>Chart Scope</h3>
        <p className="group-hint">Filter by org scope only: Global, Regional, or Departmental.</p>
        <div className="chip-grid">
          <button type="button" className={`chip ${activeScope === "global" ? "active" : ""}`} onClick={activateGlobalScope}>
            Global
          </button>
          <button type="button" className={`chip ${activeScope === "regional" ? "active" : ""}`} onClick={activateRegionalScope}>
            Regional
          </button>
          <button
            type="button"
            className={`chip ${activeScope === "departmental" ? "active" : ""}`}
            onClick={activateDepartmentalScope}
          >
            Departmental
          </button>
        </div>
      </div>

      {activeScope === "regional" && (
        <div className="filter-group">
          <h3>Regional Locations</h3>
          <p className="group-hint">Choose a location to apply location-based positions.</p>
          <div className="chip-scroll">
            {props.locations.map((location) => (
              <button
                type="button"
                key={location}
                className={`chip ${props.location === location ? "active" : ""}`}
                onClick={() => props.onLocation(location)}
              >
                {location}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeScope === "departmental" && (
        <div className="filter-group">
          <h3>Departments</h3>
          <p className="group-hint">Choose a department for departmental chart view.</p>
          <div className="chip-scroll">
            {props.departments.map((department) => (
              <button
                type="button"
                key={department}
                className={`chip ${props.department === department ? "active" : ""}`}
                onClick={() => props.onDepartment(department)}
              >
                {department}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="filter-group">
        <h3>Hierarchy Level</h3>
        <p className="group-hint">Apply your Level 0 to Level 7 role mapping.</p>
        <div className="chip-grid">
          {roleLevelOptions.map((option) => (
            <button
              type="button"
              key={option.level}
              className={`chip ${props.roleLevel === option.level ? "active" : ""}`}
              onClick={() => props.onRoleLevel(props.roleLevel === option.level ? null : option.level)}
            >
              {option.label} ({props.roleLevelCounts[option.level] ?? 0})
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
