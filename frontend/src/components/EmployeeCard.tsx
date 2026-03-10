import { getRoleLevel, type Employee, type EmployeeStatus, type RoleLevel } from "../utils/org";
import { resolveEmployeePhoto } from "../utils/photo";

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  standard: "Standard",
  promoted: "Promoted 2026",
  enhanced: "Enhanced title 2026",
  new_hire: "New hire 2026",
  vacant: "Vacant Position"
};

const ROLE_CLASS: Record<RoleLevel, string> = {
  CEO: "executive",
  President: "executive",
  VP: "vp",
  Director: "director",
  "Sr. Manager": "director",
  Manager: "manager",
  "Assoc. Manager": "manager",
  Supervisor: "lead",
  "Sr. Specialist": "lead",
  Specialist: "member",
  Staff: "member",
  "Assoc. Staff": "member"
};
interface EmployeeCardProps {
  employee: Employee;
  selected: boolean;
  compact?: boolean;
  zoomScale?: number;
  isMatch?: boolean;
  showStatusColors?: boolean;
  onClick: (id: string) => void;
  onHover?: (id: string | null) => void;
  onHoverMove?: (position: { x: number; y: number }) => void;
}

export function EmployeeCard({
  employee,
  selected,
  isMatch = true,
  compact = false,
  zoomScale = 1,
  showStatusColors = true,
  onClick,
  onHover,
  onHoverMove
}: EmployeeCardProps) {
  const statusClass = showStatusColors && employee.status !== "standard" ? `status-${employee.status}` : "";
  const isLowZoom = compact && zoomScale < 0.5;
  const isVeryLowZoom = compact && zoomScale < 0.4;
  const fallbackPhoto = resolveEmployeePhoto("", employee.name, `fallback-${employee.id}`);
  const photoSrc = resolveEmployeePhoto(employee.photo, employee.name, employee.id);
  const levelClass = ROLE_CLASS[getRoleLevel(employee.title)];

  return (
    <button
      type="button"
      className={`employee-card ${showStatusColors ? `role-${levelClass}` : "no-colors"} ${statusClass} ${selected ? "is-selected" : ""} ${!isMatch ? "not-match" : ""} ${compact ? "is-compact" : ""} ${isLowZoom ? "zoom-low" : ""} ${isVeryLowZoom ? "zoom-very-low" : ""}`}
      data-employee-id={employee.id}
      onClick={() => onClick(employee.id)}
      onMouseEnter={() => onHover?.(employee.id)}
      onMouseLeave={() => onHover?.(null)}
      onMouseMove={(event) => onHoverMove?.({ x: event.clientX, y: event.clientY })}
      onFocus={() => onHover?.(employee.id)}
      onBlur={() => onHover?.(null)}
      aria-label={`View ${employee.name}`}
    >
      <div className="card-glass-shine" />
      <div className="card-border-glow" />

      <div className="employee-photo-wrapper">
        <img
          src={photoSrc}
          alt={employee.name}
          className="employee-photo"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = fallbackPhoto;
          }}
        />
        {showStatusColors && employee.status !== "standard" && !isVeryLowZoom && (
          <div className={`status-indicator status-${employee.status}`} />
        )}
      </div>

      <div className="employee-content">
        <div className="employee-name-row">
          <h3>{employee.name}</h3>
        </div>
        {!isVeryLowZoom && <p className="employee-title">{employee.title}</p>}
        {!isLowZoom && (
          <div className="employee-meta-row">
            <span className="employee-department">{employee.department}</span>
          </div>
        )}
        {!compact && showStatusColors && (
          <div className="status-pill-wrapper">
            <span className="status-pill">{STATUS_LABEL[employee.status]}</span>
          </div>
        )}
      </div>
    </button>
  );
}
