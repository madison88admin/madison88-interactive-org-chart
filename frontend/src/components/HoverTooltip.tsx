import { directReportIds, managerFor, type Employee } from "../utils/org";

interface HoverTooltipProps {
  employee: Employee;
  employees: Employee[];
  position: { x: number; y: number };
}

export function HoverTooltip({ employee, employees, position }: HoverTooltipProps) {
  const manager = managerFor(employees, employee.id);
  const reportCount = directReportIds(employees, employee.id).length;

  const left = Math.min(position.x + 18, window.innerWidth - 260);
  const top = Math.min(position.y + 18, window.innerHeight - 190);

  return (
    <div
      className="hover-tooltip"
      style={{ left: `${left}px`, top: `${top}px` }}
      role="status"
      aria-live="polite"
    >
      <div className="hover-tooltip-head">
        <img src={employee.photo} alt={employee.name} loading="lazy" />
        <div>
          <p className="hover-tooltip-name">{employee.name}</p>
          <p className="hover-tooltip-title">{employee.title}</p>
        </div>
      </div>
      <p>{employee.department}</p>
      <p>{employee.location}</p>
      <p>
        <strong>Manager:</strong> {manager?.name ?? "Top of hierarchy"}
      </p>
      <p>
        <strong>Direct reports:</strong> {reportCount}
      </p>
    </div>
  );
}
