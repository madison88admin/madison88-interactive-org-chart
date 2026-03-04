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
  const readonlyMode = props.readonlyMode ?? false;
  return (
    <div className="filter-panel">
      <div className="active-filters-bar">
        <p>{props.hasActiveFilters ? "Filters active" : "No active filters"}</p>
        <button type="button" className="ghost-btn" onClick={props.onResetAll} disabled={!props.hasActiveFilters}>
          Reset all
        </button>
      </div>

      <div className="filter-group">
        <h3>Quick Start</h3>
        <p className="group-hint">Choose a preset to jump into the org view faster.</p>
        <div className="chip-grid">
          <button type="button" className="chip" onClick={props.onPresetLeadership}>
            Leadership
          </button>
          <button type="button" className="chip" onClick={props.onPresetDepartment}>
            Department
          </button>
          <button type="button" className="chip" onClick={props.onPresetAllEmployees}>
            All Employees
          </button>
        </div>
      </div>
      {!readonlyMode && (
        <div className="filter-group">
          <h3>View</h3>
          <div className="chip-grid">
            {(["full", "department", "location", "individual"] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                className={`chip ${props.viewMode === mode ? "active" : ""}`}
                onClick={() => props.onViewMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      )}

      {!readonlyMode && (
        <div className="filter-group">
          <h3>2026 Quick Filters</h3>
        <div className="chip-grid">
          {[
            ["promoted", "Promoted"],
            ["new_hire", "New Hires"],
            ["enhanced", "Enhanced Titles"]
          ].map(([status, label]) => {
            const typedStatus = status as EmployeeStatus;
            const count = props.statusCounts[typedStatus] ?? 0;
            const isActive = props.quickFilters.includes(typedStatus);
            return (
              <button
                type="button"
                key={status}
                className={`chip ${isActive ? "active" : ""}`}
                onClick={() => props.onToggleStatus(typedStatus)}
                disabled={!isActive && count === 0}
                aria-disabled={!isActive && count === 0}
                title={!isActive && count === 0 ? "No employees available for this filter" : undefined}
              >
                {`${label} (${count})`}
              </button>
            );
          })}
            <button
              type="button"
              className={`chip ${props.executiveOnly ? "active" : ""}`}
              onClick={props.onToggleExecutive}
              disabled={!props.executiveOnly && props.executiveCount === 0}
              aria-disabled={!props.executiveOnly && props.executiveCount === 0}
              title={!props.executiveOnly && props.executiveCount === 0 ? "No executives available for this filter" : undefined}
            >
              {`Executives Only (${props.executiveCount})`}
            </button>
          </div>
        </div>
      )}

      <div className="filter-group">
        <h3>Role Level</h3>
        <div className="chip-grid">
          <button
            type="button"
            className={`chip ${props.roleLevel === null ? "active" : ""}`}
            onClick={() => props.onRoleLevel(null)}
          >
            All
          </button>
          {(["CEO", "President", "VP", "Director", "Sr. Manager", "Manager", "Assoc. Manager", "Supervisor", "Sr. Specialist", "Specialist", "Staff", "Assoc. Staff"] as const).map((level) => {
              const count = props.roleLevelCounts[level] ?? 0;
              const isActive = props.roleLevel === level;
              return (
                <button
                  type="button"
                  key={level}
                  className={`chip ${isActive ? "active" : ""}`}
                  onClick={() => props.onRoleLevel(level)}
                  disabled={!isActive && count === 0}
                  aria-disabled={!isActive && count === 0}
                  title={!isActive && count === 0 ? "No employees available for this role level" : undefined}
                >
                  {`${level} (${count})`}
                </button>
              );
            })}
        </div>
      </div>

      {readonlyMode ? (
        <details className="filter-collapsible">
          <summary>Locations</summary>
          <div className="chip-scroll">
            <button
              type="button"
              className={`chip ${props.location === null ? "active" : ""}`}
              onClick={() => props.onLocation(null)}
            >
              All
            </button>
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
        </details>
      ) : (
        <div className="filter-group">
          <h3>Locations</h3>
          <div className="chip-scroll">
            <button
              type="button"
              className={`chip ${props.location === null ? "active" : ""}`}
              onClick={() => props.onLocation(null)}
            >
              All
            </button>
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

      {readonlyMode ? (
        <details className="filter-collapsible">
          <summary>Departments</summary>
          <div className="chip-scroll">
            <button
              type="button"
              className={`chip ${props.department === null ? "active" : ""}`}
              onClick={() => props.onDepartment(null)}
            >
              All
            </button>
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
        </details>
      ) : (
        <div className="filter-group">
          <h3>Departments</h3>
          <div className="chip-scroll">
            <button
              type="button"
              className={`chip ${props.department === null ? "active" : ""}`}
              onClick={() => props.onDepartment(null)}
            >
              All
            </button>
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
    </div>
  );
}
