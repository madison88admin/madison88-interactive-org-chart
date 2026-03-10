import { useEffect, useMemo, useState } from "react";
import { directReportIds, managerFor, type Employee, type RegionalRole } from "../utils/org";
import { resolveEmployeePhoto } from "../utils/photo";

export interface NewEmployeeInput {
  name: string;
  title: string;
  department: string;
  location: string;
  email: string;
  startDate: string;
  status: Employee["status"];
  managerId: string | null;
  additionalManagerIds?: string[];
  regionalRoles?: RegionalRole[];
  photo?: string;
}

export interface UpdateEmployeeInput {
  id: string;
  name: string;
  title: string;
  department: string;
  location: string;
  email: string;
  startDate: string;
  status: Employee["status"];
  managerId: string | null;
  additionalManagerIds?: string[];
  regionalRoles?: RegionalRole[];
  photo?: string;
}

interface DetailsPanelProps {
  selectedEmployee: Employee | null;
  employees: Employee[];
  onFocus: (id: string) => void;
  onAddEmployee: (input: NewEmployeeInput) => void;
  onUpdateEmployee: (input: UpdateEmployeeInput) => void;
  onAssignReports: (managerId: string, reportIds: string[]) => void;
  onDeleteEmployee: (id: string) => void;
  onUploadPhoto?: (file: File, employeeId?: string) => Promise<string>;
  onNotify: (message: string, title?: string) => void;
  readonlyMode?: boolean;
  isHoverPreview?: boolean;
}

const STATUS_LABEL: Record<Employee["status"], string> = {
  standard: "Standard Role",
  promoted: "Promoted 2026",
  enhanced: "Enhanced Title 2026",
  new_hire: "New Hire 2026",
  vacant: "Vacant Position"
};
const STATUS_FORM_OPTIONS: Array<{ value: Employee["status"]; label: string }> = [
  { value: "vacant", label: "Vacant Position" },
  { value: "promoted", label: "Promoted 2026" },
  { value: "enhanced", label: "Enhanced title 2026" },
  { value: "new_hire", label: "New hire 2026" },
  { value: "standard", label: "Standard role" }
];
const MAX_PHOTO_FILE_SIZE = 2 * 1024 * 1024;
const STANDARD_PHOTO_SIZE = 320;
const MANAGER_PLACEHOLDER_VALUES = new Set(["__selected__", "__current__", "__none__", "__peer__"]);
type RegionalRoleDraft = { location: string; title: string; department: string };

const managerMatchesSearch = (employee: Employee, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return (
    employee.name.toLowerCase().includes(normalizedQuery) ||
    employee.title.toLowerCase().includes(normalizedQuery) ||
    employee.department.toLowerCase().includes(normalizedQuery)
  );
};

const filterManagersWithSelection = (options: Employee[], query: string, selectedValue: string) => {
  const filtered = options.filter((employee) => managerMatchesSearch(employee, query));
  if (!query.trim() || MANAGER_PLACEHOLDER_VALUES.has(selectedValue)) {
    return filtered;
  }
  if (filtered.some((employee) => employee.id === selectedValue)) {
    return filtered;
  }
  const selectedEmployee = options.find((employee) => employee.id === selectedValue);
  if (!selectedEmployee) {
    return filtered;
  }
  return [selectedEmployee, ...filtered];
};

const groupManagersByDepartment = (options: Employee[], department: string) => {
  const normalizedDepartment = department.trim().toLowerCase();
  if (!normalizedDepartment) {
    return { sameDepartment: [] as Employee[], otherDepartments: options };
  }
  const sameDepartment: Employee[] = [];
  const otherDepartments: Employee[] = [];
  options.forEach((employee) => {
    if (employee.department.trim().toLowerCase() === normalizedDepartment) {
      sameDepartment.push(employee);
      return;
    }
    otherDepartments.push(employee);
  });
  return { sameDepartment, otherDepartments };
};

const normalizeAdditionalManagers = (
  value: string[],
  employeeId: string,
  primaryManagerId: string | null
) => {
  const unique = Array.from(new Set(value.filter(Boolean)));
  return unique.filter((id) => id !== employeeId && id !== primaryManagerId);
};

const normalizeLocationKey = (value: string) => value.trim().toLowerCase();

const sanitizeRegionalRoles = (
  entries: RegionalRoleDraft[],
  baseLocation: string,
  onNotify: (message: string, title?: string) => void
): RegionalRole[] | null => {
  const normalizedBaseLocation = normalizeLocationKey(baseLocation);
  const seenLocation = new Set<string>();
  const roles: RegionalRole[] = [];

  for (const entry of entries) {
    const location = entry.location.trim();
    const title = entry.title.trim();
    const department = entry.department.trim();
    const hasAnyValue = Boolean(location || title || department);
    if (!hasAnyValue) {
      continue;
    }
    if (!location || !title) {
      onNotify("Each additional position requires both location and title.", "Validation");
      return null;
    }
    const locationKey = normalizeLocationKey(location);
    if (locationKey === normalizedBaseLocation) {
      continue;
    }
    if (seenLocation.has(locationKey)) {
      onNotify("Only one additional position is allowed per location.", "Validation");
      return null;
    }
    seenLocation.add(locationKey);
    roles.push({
      location,
      title,
      ...(department ? { department } : {})
    });
  }

  return roles;
};

const normalizePhotoFile = (file: File): Promise<File> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    const originalName = file.name.replace(/\.[^.]+$/, "") || "employee-photo";

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = STANDARD_PHOTO_SIZE;
      canvas.height = STANDARD_PHOTO_SIZE;
      const context = canvas.getContext("2d");

      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Unable to process image."));
        return;
      }

      // Fit and crop image to a fixed square so profile pictures remain consistent.
      const scale = Math.max(
        STANDARD_PHOTO_SIZE / image.naturalWidth,
        STANDARD_PHOTO_SIZE / image.naturalHeight
      );
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      const offsetX = (STANDARD_PHOTO_SIZE - drawWidth) / 2;
      const offsetY = (STANDARD_PHOTO_SIZE - drawHeight) / 2;

      context.fillStyle = "#d9edf9";
      context.fillRect(0, 0, STANDARD_PHOTO_SIZE, STANDARD_PHOTO_SIZE);
      context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) {
            reject(new Error("Unable to process image."));
            return;
          }
          resolve(
            new File([blob], `${originalName}.webp`, {
              type: "image/webp"
            })
          );
        },
        "image/webp",
        0.9
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to load image file."));
    };

    image.src = objectUrl;
  });

export function DetailsPanel({
  selectedEmployee,
  employees,
  onFocus,
  onAddEmployee,
  onUpdateEmployee,
  onAssignReports,
  onDeleteEmployee,
  onUploadPhoto,
  onNotify,
  readonlyMode = false,
  isHoverPreview = false
}: DetailsPanelProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDepartment, setFormDepartment] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formStatus, setFormStatus] = useState<Employee["status"]>("standard");
  const [formManagerId, setFormManagerId] = useState<string>("__selected__");
  const [formManagerSearch, setFormManagerSearch] = useState("");
  const [formAdditionalManagerIds, setFormAdditionalManagerIds] = useState<string[]>([]);
  const [assignReportsSearch, setAssignReportsSearch] = useState("");
  const [assignReportIds, setAssignReportIds] = useState<string[]>([]);
  const [reassignReportIds, setReassignReportIds] = useState<string[]>([]);
  const [reassignManagerSearch, setReassignManagerSearch] = useState("");
  const [reassignTargetManagerId, setReassignTargetManagerId] = useState<string>("");
  const [formRegionalRoles, setFormRegionalRoles] = useState<RegionalRoleDraft[]>([]);
  const [formPhoto, setFormPhoto] = useState("");
  const [isFormPhotoUploading, setIsFormPhotoUploading] = useState(false);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editStatus, setEditStatus] = useState<Employee["status"]>("standard");
  const [editManagerId, setEditManagerId] = useState<string>("__current__");
  const [editManagerSearch, setEditManagerSearch] = useState("");
  const [editAdditionalManagerIds, setEditAdditionalManagerIds] = useState<string[]>([]);
  const [editRegionalRoles, setEditRegionalRoles] = useState<RegionalRoleDraft[]>([]);
  const [editPhoto, setEditPhoto] = useState("");
  const [isEditPhotoUploading, setIsEditPhotoUploading] = useState(false);
  const isMutatingDisabled = isHoverPreview;
  const locationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          employees.flatMap((employee) => [
            employee.location?.trim(),
            ...(employee.regionalRoles?.map((entry) => entry.location?.trim()) ?? [])
          ])
            .filter((location): location is string => Boolean(location))
        )
      ).sort((left, right) => left.localeCompare(right)),
    [employees]
  );
  const selectedEmployeeId = selectedEmployee?.id ?? "";
  const managerOptions = useMemo(
    () =>
      [...employees]
        .filter((employee) => employee.id !== selectedEmployeeId)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [employees, selectedEmployeeId]
  );
  const filteredAddManagerOptions = useMemo(
    () => filterManagersWithSelection(managerOptions, formManagerSearch, formManagerId),
    [formManagerId, formManagerSearch, managerOptions]
  );
  const filteredEditManagerOptions = useMemo(
    () => filterManagersWithSelection(managerOptions, editManagerSearch, editManagerId),
    [editManagerId, editManagerSearch, managerOptions]
  );
  const addManagerDepartment = formDepartment.trim() || selectedEmployee?.department.trim() || "";
  const editManagerDepartment = editDepartment.trim() || selectedEmployee?.department.trim() || "";
  const groupedAddManagerOptions = useMemo(
    () => groupManagersByDepartment(filteredAddManagerOptions, addManagerDepartment),
    [addManagerDepartment, filteredAddManagerOptions]
  );
  const groupedEditManagerOptions = useMemo(
    () => groupManagersByDepartment(filteredEditManagerOptions, editManagerDepartment),
    [editManagerDepartment, filteredEditManagerOptions]
  );
  const additionalManagerOptions = useMemo(
    () => managerOptions,
    [managerOptions]
  );
  const assignableReports = useMemo(() => {
    if (!selectedEmployee) {
      return [];
    }
    const query = assignReportsSearch.trim().toLowerCase();
    return employees
      .filter((employee) => employee.id !== selectedEmployee.id && employee.managerId !== selectedEmployee.id)
      .filter((employee) => {
        if (!query) {
          return true;
        }
        return (
          employee.name.toLowerCase().includes(query) ||
          employee.title.toLowerCase().includes(query) ||
          employee.department.toLowerCase().includes(query)
        );
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [assignReportsSearch, employees, selectedEmployee]);

  useEffect(() => {
    if (isMutatingDisabled) {
      setShowAddForm(false);
      setShowEditForm(false);
    }
  }, [isMutatingDisabled]);
  useEffect(() => {
    setAssignReportsSearch("");
    setAssignReportIds([]);
  }, [selectedEmployee?.id]);

  const handlePhotoSelection = async (
    file: File | null,
    setPhoto: (value: string) => void,
    setUploading: (value: boolean) => void,
    employeeId?: string
  ) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      onNotify("Please select a valid image file.", "Validation");
      return;
    }
    if (file.size > MAX_PHOTO_FILE_SIZE) {
      onNotify("Image is too large. Please use an image up to 2 MB.", "Validation");
      return;
    }
    try {
      setUploading(true);
      const normalizedPhotoFile = await normalizePhotoFile(file);
      if (onUploadPhoto) {
        const uploadedPhotoUrl = await onUploadPhoto(normalizedPhotoFile, employeeId);
        setPhoto(uploadedPhotoUrl);
      } else {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("Unable to read image file."));
          reader.readAsDataURL(normalizedPhotoFile);
        });
        setPhoto(dataUrl);
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Unable to upload the selected image.";
      onNotify(message, "Upload Error");
    } finally {
      setUploading(false);
    }
  };

  if (!selectedEmployee) {
    return (
      <aside className="details-panel">
        <h3>Employee Details</h3>
        <p>Select an employee card to inspect reporting lines and details.</p>
      </aside>
    );
  }

  const persistedSelectedEmployee = employees.find((employee) => employee.id === selectedEmployee.id) ?? selectedEmployee;
  const manager = managerFor(employees, selectedEmployee.id);
  const additionalManagers = (selectedEmployee.additionalManagerIds ?? [])
    .map((id) => employees.find((employee) => employee.id === id))
    .filter((employee): employee is Employee => Boolean(employee))
    .sort((left, right) => left.name.localeCompare(right.name));
  const reports = directReportIds(employees, selectedEmployee.id)
    .map((id) => employees.find((employee) => employee.id === id))
    .filter((employee): employee is Employee => Boolean(employee))
    .sort((left, right) => left.name.localeCompare(right.name));
  const regionalRoles = [...(selectedEmployee.regionalRoles ?? [])]
    .filter((entry) => entry.location?.trim() && entry.title?.trim())
    .sort((left, right) => left.location.localeCompare(right.location));
  const selectedPhoto = resolveEmployeePhoto(selectedEmployee.photo, selectedEmployee.name, selectedEmployee.id);
  const selectedFallbackPhoto = resolveEmployeePhoto("", selectedEmployee.name, `fallback-${selectedEmployee.id}`);

  return (
    <aside className="details-panel">
      {isHoverPreview && <p className="hover-preview-tag">Hover Preview</p>}
      <div className="details-head">
        <img
          src={selectedPhoto}
          alt={selectedEmployee.name}
          loading="lazy"
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = selectedFallbackPhoto;
          }}
        />
        <div>
          <h3>{selectedEmployee.name}</h3>
          <p className="detail-subtitle">{selectedEmployee.title}</p>
          <span className={`detail-status status-${selectedEmployee.status}`}>{STATUS_LABEL[selectedEmployee.status]}</span>
        </div>
      </div>
      <div className="detail-facts">
        <p>
          <strong>Department</strong>
          <span>{selectedEmployee.department}</span>
        </p>
        <p>
          <strong>Location</strong>
          <span>{selectedEmployee.location}</span>
        </p>
        <p>
          <strong>Email</strong>
          <span>{selectedEmployee.email}</span>
        </p>
        <p>
          <strong>Start Date</strong>
          <span>{selectedEmployee.startDate}</span>
        </p>
      </div>

      {regionalRoles.length > 0 && (
        <section>
          <h4>Regional Roles</h4>
          <div className="reports-list">
            {regionalRoles.map((entry, index) => (
              <p key={`${entry.location}-${entry.title}-${index}`}>
                {entry.location}: {entry.department ? `${entry.title} - ${entry.department}` : entry.title}
              </p>
            ))}
          </div>
        </section>
      )}

      <section>
        <h4>Manager</h4>
        {manager ? (
          <button type="button" className="link-btn" onClick={() => onFocus(manager.id)}>
            {manager.name}
          </button>
        ) : (
          <p>Top of hierarchy</p>
        )}
        {additionalManagers.length > 0 && (
          <div className="reports-list">
            <p className="form-note">Additional managers</p>
            {additionalManagers.map((employee) => (
              <button key={`additional-manager-${employee.id}`} type="button" className="link-btn" onClick={() => onFocus(employee.id)}>
                {employee.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4>Direct Reports ({reports.length})</h4>
        {reports.length === 0 && <p>No direct reports</p>}
        {reports.length > 0 && (
          <div className="reports-list">
            {reports.map((employee) => (
              <button key={employee.id} type="button" className="link-btn" onClick={() => onFocus(employee.id)}>
                {employee.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {!readonlyMode && (
        <section>
          <h4>Add Employee</h4>
          {!showAddForm ? (
            <button
              type="button"
              className="link-btn"
              disabled={isMutatingDisabled}
              onClick={() => {
                setFormName("");
                setFormTitle("");
                setFormDepartment(selectedEmployee.department);
                setFormLocation(selectedEmployee.location);
                setFormEmail("");
                setFormStartDate(new Date().toISOString().slice(0, 10));
                setFormStatus("standard");
                setFormManagerId("__selected__");
                setFormManagerSearch("");
                setFormAdditionalManagerIds([]);
                setFormRegionalRoles([]);
                setFormPhoto("");
                setShowAddForm(true);
              }}
            >
              Add New Employee
            </button>
          ) : (
            <form
              className="add-employee-form form-template"
              onSubmit={(event) => {
                event.preventDefault();
                const managerId =
                  formManagerId === "__selected__"
                    ? selectedEmployee.id
                    : formManagerId === "__peer__"
                      ? selectedEmployee.managerId ?? null
                      : formManagerId === "__none__"
                        ? null
                        : formManagerId;
                const additionalManagerIds = normalizeAdditionalManagers(
                  formAdditionalManagerIds,
                  selectedEmployee.id,
                  managerId
                );
                const regionalRoles = sanitizeRegionalRoles(formRegionalRoles, formLocation, onNotify);
                if (regionalRoles === null) {
                  return;
                }
                onAddEmployee({
                  name: formName.trim(),
                  title: formTitle.trim(),
                  department: formDepartment.trim(),
                  location: formLocation.trim(),
                  email: formEmail.trim(),
                  startDate: formStartDate,
                  status: formStatus,
                  managerId,
                  additionalManagerIds,
                  regionalRoles,
                  photo: formPhoto.trim()
                });
                setFormName("");
                setFormTitle("");
                setFormDepartment("");
                setFormLocation("");
                setFormEmail("");
                setFormStartDate("");
                setFormStatus("standard");
                setFormManagerId("__selected__");
                setFormManagerSearch("");
                setFormAdditionalManagerIds([]);
                setFormRegionalRoles([]);
                setFormPhoto("");
                setShowAddForm(false);
              }}
            >
              <label className="form-field">
                <span>Full Name</span>
                <input value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="e.g. James Bienen" required />
              </label>
              <label className="form-field">
                <span>Job Title</span>
                <input value={formTitle} onChange={(event) => setFormTitle(event.target.value)} placeholder="e.g. CEO" required />
              </label>
              <label className="form-field">
                <span>Department</span>
                <input value={formDepartment} onChange={(event) => setFormDepartment(event.target.value)} placeholder="e.g. Executive" required />
              </label>
              <label className="form-field">
                <span>Location</span>
                <select value={formLocation} onChange={(event) => setFormLocation(event.target.value)} required>
                  {locationOptions.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Email</span>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(event) => setFormEmail(event.target.value)}
                  placeholder={formStatus === "vacant" ? "Optional for vacant position" : "e.g. james.bienen@madison88.com"}
                />
              </label>
              <label className="form-field">
                <span>Start Date</span>
                <input type="date" value={formStartDate} onChange={(event) => setFormStartDate(event.target.value)} />
              </label>
              <label className="form-field">
                <span>Status</span>
                <select value={formStatus} onChange={(event) => setFormStatus(event.target.value as Employee["status"])}>
                  {STATUS_FORM_OPTIONS.map((statusOption) => (
                    <option key={statusOption.value} value={statusOption.value}>
                      {statusOption.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-field">
                <span>Double Position by Location</span>
                <div className="regional-roles-editor">
                  {formRegionalRoles.length === 0 && (
                    <p className="form-note">Optional. Add another location-specific position.</p>
                  )}
                  {formRegionalRoles.map((entry, index) => (
                    <div key={`add-role-${index}`} className="regional-role-row">
                      <select
                        value={entry.location}
                        onChange={(event) =>
                          setFormRegionalRoles((current) =>
                            current.map((role, roleIndex) =>
                              roleIndex === index ? { ...role, location: event.target.value } : role
                            )
                          )
                        }
                      >
                        <option value="">Select location</option>
                        {locationOptions.map((locationOption) => (
                          <option key={locationOption} value={locationOption}>
                            {locationOption}
                          </option>
                        ))}
                      </select>
                      <input
                        value={entry.title}
                        onChange={(event) =>
                          setFormRegionalRoles((current) =>
                            current.map((role, roleIndex) =>
                              roleIndex === index ? { ...role, title: event.target.value } : role
                            )
                          )
                        }
                        placeholder="Position title"
                      />
                      <input
                        value={entry.department}
                        onChange={(event) =>
                          setFormRegionalRoles((current) =>
                            current.map((role, roleIndex) =>
                              roleIndex === index ? { ...role, department: event.target.value } : role
                            )
                          )
                        }
                        placeholder="Department (optional)"
                      />
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() =>
                          setFormRegionalRoles((current) => current.filter((_, roleIndex) => roleIndex !== index))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() =>
                      setFormRegionalRoles((current) => [
                        ...current,
                        { location: "", title: "", department: formDepartment.trim() }
                      ])
                    }
                  >
                    Add Double Position
                  </button>
                </div>
              </div>
              <label className="form-field">
                <span>Photo</span>
                <div className="photo-input-wrap">
                  <div className="form-photo-preview">
                    {formPhoto ? <img src={formPhoto} alt="New employee photo preview" loading="lazy" /> : <span className="form-photo-empty">No image</span>}
                  </div>
                  <div className="photo-input-controls">
                    <input
                      type="url"
                      value={formPhoto}
                      onChange={(event) => setFormPhoto(event.target.value)}
                      placeholder="Paste photo URL (optional)"
                    />
                    <input
                      type="file"
                      accept="image/*"
                      disabled={isFormPhotoUploading}
                      onChange={async (event) => {
                        const picker = event.currentTarget;
                        const file = picker.files?.[0] ?? null;
                        await handlePhotoSelection(file, setFormPhoto, setIsFormPhotoUploading);
                        picker.value = "";
                      }}
                    />
                    <div className="photo-input-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={!formPhoto || isFormPhotoUploading}
                        onClick={() => setFormPhoto("")}
                      >
                        Remove photo
                      </button>
                    </div>
                    {isFormPhotoUploading && <small className="form-note">Uploading photo...</small>}
                  </div>
                </div>
                <small className="form-note form-photo-note">Optional. Upload JPG/PNG/WebP up to 2 MB. Uploaded photos are auto-fit to the system size.</small>
              </label>
              <label className="form-field">
                <span>Search Manager</span>
                <input
                  type="search"
                  value={formManagerSearch}
                  onChange={(event) => setFormManagerSearch(event.target.value)}
                  placeholder="Search name, title, department"
                />
              </label>
              <label className="form-field">
                <span>Manager</span>
                <select value={formManagerId} onChange={(event) => setFormManagerId(event.target.value)}>
                  <option value="__selected__">Manager: {selectedEmployee.name}</option>
                  <option value="__peer__">Same level as {selectedEmployee.name}</option>
                  <option value="__none__">No manager (top-level)</option>
                  {groupedAddManagerOptions.sameDepartment.length > 0 && (
                    <optgroup label={`Same department (${addManagerDepartment})`}>
                      {groupedAddManagerOptions.sameDepartment.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {groupedAddManagerOptions.otherDepartments.length > 0 && (
                    <optgroup label="Other departments">
                      {groupedAddManagerOptions.otherDepartments.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {formManagerSearch.trim() && filteredAddManagerOptions.length === 0 && (
                  <small className="form-note">No matching managers found.</small>
                )}
              </label>
              <label className="form-field">
                <span>Additional Managers (optional)</span>
                <select
                  multiple
                  value={formAdditionalManagerIds}
                  onChange={(event) =>
                    setFormAdditionalManagerIds(Array.from(event.target.selectedOptions).map((option) => option.value))
                  }
                >
                  {additionalManagerOptions.map((employee) => (
                    <option key={`add-secondary-${employee.id}`} value={employee.id}>
                      {employee.name} - {employee.title}
                    </option>
                  ))}
                </select>
                <small className="form-note">Hold Ctrl/Cmd to select multiple managers.</small>
              </label>
              <div className="add-form-actions">
                <button type="submit" className="link-btn">
                  Save Employee
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setShowAddForm(false);
                    setFormName("");
                    setFormTitle("");
                    setFormDepartment("");
                    setFormLocation("");
                    setFormEmail("");
                    setFormStartDate("");
                    setFormStatus("standard");
                    setFormManagerId("__selected__");
                    setFormManagerSearch("");
                    setFormAdditionalManagerIds([]);
                    setFormRegionalRoles([]);
                    setFormPhoto("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {isMutatingDisabled && <p className="form-note">Select the employee first before adding a direct report.</p>}
        </section>
      )}

      {!readonlyMode && (
        <section>
          <h4>Edit Employee</h4>
          {!showEditForm ? (
            <button
              type="button"
              className="link-btn"
              disabled={isMutatingDisabled}
              onClick={() => {
                setEditName(persistedSelectedEmployee.name);
                setEditTitle(persistedSelectedEmployee.title);
                setEditDepartment(persistedSelectedEmployee.department);
                setEditLocation(persistedSelectedEmployee.location);
                setEditEmail(persistedSelectedEmployee.email);
                setEditStartDate(persistedSelectedEmployee.startDate);
                setEditStatus(persistedSelectedEmployee.status);
                setEditManagerId(persistedSelectedEmployee.managerId ?? "__none__");
                setEditManagerSearch("");
                setEditAdditionalManagerIds([...(persistedSelectedEmployee.additionalManagerIds ?? [])]);
                setEditRegionalRoles(
                  (persistedSelectedEmployee.regionalRoles ?? []).map((entry) => ({
                    location: entry.location,
                    title: entry.title,
                    department: entry.department ?? ""
                  }))
                );
                setEditPhoto(persistedSelectedEmployee.photo);
                setShowEditForm(true);
              }}
            >
              Edit Selected Employee
            </button>
          ) : (
            <form
              className="add-employee-form form-template"
              onSubmit={(event) => {
                event.preventDefault();
                const regionalRoles = sanitizeRegionalRoles(editRegionalRoles, editLocation, onNotify);
                if (regionalRoles === null) {
                  return;
                }
                const managerId =
                  editManagerId === "__none__" ? null : editManagerId === "__current__" ? persistedSelectedEmployee.managerId : editManagerId;
                const additionalManagerIds = normalizeAdditionalManagers(
                  editAdditionalManagerIds,
                  persistedSelectedEmployee.id,
                  managerId
                );
                onUpdateEmployee({
                  id: persistedSelectedEmployee.id,
                  name: editName.trim(),
                  title: editTitle.trim(),
                  department: editDepartment.trim(),
                  location: editLocation.trim(),
                  email: editEmail.trim(),
                  startDate: editStartDate,
                  status: editStatus,
                  managerId,
                  additionalManagerIds,
                  regionalRoles,
                  photo: editPhoto.trim()
                });
                setEditManagerSearch("");
                setEditAdditionalManagerIds([]);
                setEditRegionalRoles([]);
                setShowEditForm(false);
              }}
            >
              <label className="form-field">
                <span>Full Name</span>
                <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Full name" required />
              </label>
              <label className="form-field">
                <span>Job Title</span>
                <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder="Job title" required />
              </label>
              <label className="form-field">
                <span>Department</span>
                <input value={editDepartment} onChange={(event) => setEditDepartment(event.target.value)} placeholder="Department" required />
              </label>
              <label className="form-field">
                <span>Location</span>
                <select value={editLocation} onChange={(event) => setEditLocation(event.target.value)} required>
                  {locationOptions.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Email</span>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(event) => setEditEmail(event.target.value)}
                  placeholder={editStatus === "vacant" ? "Optional for vacant position" : "Email"}
                />
              </label>
              <label className="form-field">
                <span>Start Date</span>
                <input type="date" value={editStartDate} onChange={(event) => setEditStartDate(event.target.value)} />
              </label>
              <label className="form-field">
                <span>Photo</span>
                <div className="photo-input-wrap">
                  <div className="form-photo-preview">
                    {editPhoto ? <img src={editPhoto} alt="Updated employee photo preview" loading="lazy" /> : <span className="form-photo-empty">No image</span>}
                  </div>
                  <div className="photo-input-controls">
                    <input
                      type="url"
                      value={editPhoto}
                      onChange={(event) => setEditPhoto(event.target.value)}
                      placeholder="Paste photo URL (optional)"
                    />
                    <input
                      type="file"
                      accept="image/*"
                      disabled={isEditPhotoUploading}
                      onChange={async (event) => {
                        const picker = event.currentTarget;
                        const file = picker.files?.[0] ?? null;
                        await handlePhotoSelection(
                          file,
                          setEditPhoto,
                          setIsEditPhotoUploading,
                          persistedSelectedEmployee.id
                        );
                        picker.value = "";
                      }}
                    />
                    <div className="photo-input-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={!editPhoto || isEditPhotoUploading}
                        onClick={() => setEditPhoto("")}
                      >
                        Remove photo
                      </button>
                    </div>
                    {isEditPhotoUploading && <small className="form-note">Uploading photo...</small>}
                  </div>
                </div>
                <small className="form-note form-photo-note">Upload a new image, keep existing, or remove photo to use default avatar. Uploaded photos are auto-fit to the system size.</small>
              </label>
              <label className="form-field">
                <span>Status</span>
                <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as Employee["status"])}>
                  {STATUS_FORM_OPTIONS.map((statusOption) => (
                    <option key={statusOption.value} value={statusOption.value}>
                      {statusOption.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-field">
                <span>Double Position by Location</span>
                <div className="regional-roles-editor">
                  {editRegionalRoles.length === 0 && (
                    <p className="form-note">Optional. Add another location-specific position.</p>
                  )}
                  {editRegionalRoles.map((entry, index) => (
                    <div key={`edit-role-${index}`} className="regional-role-row">
                      <select
                        value={entry.location}
                        onChange={(event) =>
                          setEditRegionalRoles((current) =>
                            current.map((role, roleIndex) =>
                              roleIndex === index ? { ...role, location: event.target.value } : role
                            )
                          )
                        }
                      >
                        <option value="">Select location</option>
                        {locationOptions.map((locationOption) => (
                          <option key={locationOption} value={locationOption}>
                            {locationOption}
                          </option>
                        ))}
                      </select>
                      <input
                        value={entry.title}
                        onChange={(event) =>
                          setEditRegionalRoles((current) =>
                            current.map((role, roleIndex) =>
                              roleIndex === index ? { ...role, title: event.target.value } : role
                            )
                          )
                        }
                        placeholder="Position title"
                      />
                      <input
                        value={entry.department}
                        onChange={(event) =>
                          setEditRegionalRoles((current) =>
                            current.map((role, roleIndex) =>
                              roleIndex === index ? { ...role, department: event.target.value } : role
                            )
                          )
                        }
                        placeholder="Department (optional)"
                      />
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() =>
                          setEditRegionalRoles((current) => current.filter((_, roleIndex) => roleIndex !== index))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() =>
                      setEditRegionalRoles((current) => [
                        ...current,
                        { location: "", title: "", department: editDepartment.trim() }
                      ])
                    }
                  >
                    Add Double Position
                  </button>
                </div>
              </div>
              <label className="form-field">
                <span>Search Manager</span>
                <input
                  type="search"
                  value={editManagerSearch}
                  onChange={(event) => setEditManagerSearch(event.target.value)}
                  placeholder="Search name, title, department"
                />
              </label>
              <label className="form-field">
                <span>Manager</span>
                <select value={editManagerId} onChange={(event) => setEditManagerId(event.target.value)}>
                  <option value="__current__">Keep current manager</option>
                  <option value="__none__">No manager (top-level)</option>
                  {groupedEditManagerOptions.sameDepartment.length > 0 && (
                    <optgroup label={`Same department (${editManagerDepartment})`}>
                      {groupedEditManagerOptions.sameDepartment.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {groupedEditManagerOptions.otherDepartments.length > 0 && (
                    <optgroup label="Other departments">
                      {groupedEditManagerOptions.otherDepartments.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {editManagerSearch.trim() && filteredEditManagerOptions.length === 0 && (
                  <small className="form-note">No matching managers found.</small>
                )}
              </label>
              <label className="form-field">
                <span>Additional Managers (optional)</span>
                <select
                  multiple
                  value={editAdditionalManagerIds}
                  onChange={(event) =>
                    setEditAdditionalManagerIds(Array.from(event.target.selectedOptions).map((option) => option.value))
                  }
                >
                  {additionalManagerOptions.map((employee) => (
                    <option key={`edit-secondary-${employee.id}`} value={employee.id}>
                      {employee.name} - {employee.title}
                    </option>
                  ))}
                </select>
                <small className="form-note">Hold Ctrl/Cmd to select multiple managers.</small>
              </label>
              <div className="add-form-actions">
                <button type="submit" className="link-btn">
                  Save Changes
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setEditManagerSearch("");
                    setEditAdditionalManagerIds([]);
                    setEditRegionalRoles([]);
                    setShowEditForm(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {isMutatingDisabled && <p className="form-note">Select the employee first before editing details.</p>}
        </section>
      )}

      {!readonlyMode && (
        <section className="assign-reports-section">
          <h4>Assign Multiple Direct Reports</h4>
          <p className="form-note">Select employees and assign them under {selectedEmployee.name}.</p>
          <label className="form-field assign-reports-search">
            <span>Search Employees</span>
            <input
              type="search"
              value={assignReportsSearch}
              onChange={(event) => setAssignReportsSearch(event.target.value)}
              placeholder="Search name, title, department"
            />
          </label>
          <div className="reports-list assign-reports-list">
            {assignableReports.length === 0 && <p className="form-note">No available employees to assign.</p>}
            {assignableReports.map((employee) => {
              const checked = assignReportIds.includes(employee.id);
              return (
                <label key={`assign-${employee.id}`} className="assign-report-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const isChecked = event.target.checked;
                      setAssignReportIds((current) =>
                        isChecked ? [...current, employee.id] : current.filter((id) => id !== employee.id)
                      );
                    }}
                  />
                  <span>{employee.name} - {employee.title}</span>
                </label>
              );
            })}
          </div>
          <div className="add-form-actions assign-reports-actions">
            <button
              type="button"
              className="link-btn assign-action-btn"
              disabled={assignReportIds.length === 0}
              onClick={() => {
                onAssignReports(selectedEmployee.id, assignReportIds);
                setAssignReportIds([]);
              }}
            >
              Assign Selected ({assignReportIds.length})
            </button>
            <button
              type="button"
              className="link-btn assign-action-btn"
              onClick={() => setAssignReportIds([])}
              disabled={assignReportIds.length === 0}
            >
              Clear
            </button>
          </div>
        </section>
      )}

      {!readonlyMode && (
        <section className="assign-reports-section redistribute-section">
          <h4>Redistribute Current Reports</h4>
          <p className="form-note">Select reports to move to a different manager.</p>

          <div className="reports-list reassign-reports-list">
            {reports.length === 0 && <p className="form-note">No current reports to redistribute.</p>}
            {reports.map((employee) => {
              const checked = reassignReportIds.includes(employee.id);
              return (
                <label key={`reassign-source-${employee.id}`} className="assign-report-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const isChecked = event.target.checked;
                      setReassignReportIds((current) =>
                        isChecked ? [...current, employee.id] : current.filter((id) => id !== employee.id)
                      );
                    }}
                  />
                  <span>{employee.name} - {employee.title}</span>
                </label>
              );
            })}
          </div>

          {reassignReportIds.length > 0 && (
            <div className="reassign-controls animate-fade-in">
              <label className="form-field">
                <span>Select New Manager for {reassignReportIds.length} reports</span>
                <input
                  type="search"
                  value={reassignManagerSearch}
                  onChange={(event) => setReassignManagerSearch(event.target.value)}
                  placeholder="Search new manager..."
                />
                <select
                  value={reassignTargetManagerId}
                  onChange={(event) => setReassignTargetManagerId(event.target.value)}
                  className="reassign-manager-select"
                >
                  <option value="">-- Choose New Manager --</option>
                  {managerOptions
                    .filter(m => !reassignReportIds.includes(m.id)) // Can't assign to someone being moved
                    .filter(m => managerMatchesSearch(m, reassignManagerSearch))
                    .map(m => (
                      <option key={`target-${m.id}`} value={m.id}>
                        {m.name} ({m.department})
                      </option>
                    ))
                  }
                </select>
              </label>

              <div className="add-form-actions">
                <button
                  type="button"
                  className="link-btn assign-action-btn"
                  disabled={!reassignTargetManagerId}
                  onClick={() => {
                    onAssignReports(reassignTargetManagerId, reassignReportIds);
                    setReassignReportIds([]);
                    setReassignTargetManagerId("");
                    setReassignManagerSearch("");
                  }}
                >
                  Move to Selected Manager
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setReassignReportIds([]);
                    setReassignTargetManagerId("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {!readonlyMode && (
        <section>
          <h4>Delete Employee</h4>
          <p className="form-note">This permanently removes the employee from the current directory.</p>
          <button
            type="button"
            className="link-btn danger-btn"
            onClick={() => onDeleteEmployee(selectedEmployee.id)}
            disabled={isHoverPreview}
          >
            Delete Selected Employee
          </button>
          {isHoverPreview && <p className="form-note">Select the employee first before deleting.</p>}
        </section>
      )}

      {readonlyMode && (
        <section>
          <h4>View-Only Access</h4>
          <p className="form-note">Editing actions are disabled in this shared view.</p>
        </section>
      )}
    </aside>
  );
}
