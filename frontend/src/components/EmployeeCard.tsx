import { getRoleLevel, type Employee, type EmployeeStatus, type RoleLevel } from "../utils/org";

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  standard: "Standard",
  promoted: "Promoted 2026",
  enhanced: "Enhanced Title 2026",
  new_hire: "New Hire 2026",
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
const avatarFallback = (name: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name).replace(/%20/g, "+")}&background=2C5F7C&color=fff`;

interface EmployeeCardProps {
  employee: Employee;
  selected: boolean;
  compact?: boolean;
  zoomScale?: number;
  isMatch?: boolean;
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
  onClick,
  onHover,
  onHoverMove
}: EmployeeCardProps) {
  const statusClass = employee.status === "standard" ? "" : `status-${employee.status}`;
  const isLowZoom = compact && zoomScale < 0.5;
  const isVeryLowZoom = compact && zoomScale < 0.4;
  const fallbackPhoto = avatarFallback(employee.name);
  const levelClass = ROLE_CLASS[getRoleLevel(employee.title)];

  return (
    <button
      type="button"
      className={`employee-card role-${levelClass} ${statusClass} ${selected ? "is-selected" : ""} ${!isMatch ? "not-match" : ""} ${compact ? "is-compact" : ""} ${isLowZoom ? "zoom-low" : ""} ${isVeryLowZoom ? "zoom-very-low" : ""}`}
      data-employee-id={employee.id}
      onClick={() => onClick(employee.id)}
      onMouseEnter={() => onHover?.(employee.id)}
      onMouseLeave={() => onHover?.(null)}
      onMouseMove={(event) => onHoverMove?.({ x: event.clientX, y: event.clientY })}
      onFocus={() => onHover?.(employee.id)}
      onBlur={() => onHover?.(null)}
      aria-label={`View ${employee.name}`}
    >
      <img
        src={employee.photo || fallbackPhoto}
        alt={employee.name}
        className="employee-photo"
        loading="lazy"
        onError={(event) => {
          event.currentTarget.onerror = null;
          event.currentTarget.src = fallbackPhoto;
        }}
      />
      <div className="employee-content">
        <h3>{employee.name}</h3>
        {!isVeryLowZoom && <p className="employee-title">{employee.title}</p>}
        {!isLowZoom && <p className="employee-department">{employee.department}</p>}
        {!compact && <span className="status-pill">{STATUS_LABEL[employee.status]}</span>}
      </div>
    </button>
  );
}
