import { useEffect, useMemo, useState } from "react";
import { directReportIds, managerFor, type Employee } from "../utils/org";

export interface NewEmployeeInput {
  name: string;
  title: string;
  department: string;
  location: string;
  email: string;
  startDate: string;
  managerId: string | null;
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
  photo?: string;
}

interface DetailsPanelProps {
  selectedEmployee: Employee | null;
  employees: Employee[];
  onFocus: (id: string) => void;
  onAddEmployee: (input: NewEmployeeInput) => void;
  onUpdateEmployee: (input: UpdateEmployeeInput) => void;
  onDeleteEmployee: (id: string) => void;
  isHoverPreview?: boolean;
}

const STATUS_LABEL: Record<Employee["status"], string> = {
  standard: "Standard Role",
  promoted: "Promoted 2026",
  enhanced: "Enhanced Title 2026",
  new_hire: "New Hire 2026"
};
const MAX_PHOTO_FILE_SIZE = 2 * 1024 * 1024;

const readPhotoAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });

export function DetailsPanel({
  selectedEmployee,
  employees,
  onFocus,
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
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
  const [formManagerId, setFormManagerId] = useState<string>("__selected__");
  const [formPhoto, setFormPhoto] = useState("");
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editStatus, setEditStatus] = useState<Employee["status"]>("standard");
  const [editManagerId, setEditManagerId] = useState<string>("__current__");
  const [editPhoto, setEditPhoto] = useState("");
  const isMutatingDisabled = isHoverPreview;
  const locationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          employees
            .map((employee) => employee.location?.trim())
            .filter((location): location is string => Boolean(location))
        )
      ).sort((left, right) => left.localeCompare(right)),
    [employees]
  );

  useEffect(() => {
    if (isMutatingDisabled) {
      setShowAddForm(false);
      setShowEditForm(false);
    }
  }, [isMutatingDisabled]);

  const handlePhotoSelection = async (file: File | null, setPhoto: (value: string) => void) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      window.alert("Please select a valid image file.");
      return;
    }
    if (file.size > MAX_PHOTO_FILE_SIZE) {
      window.alert("Image is too large. Please use an image up to 2 MB.");
      return;
    }
    try {
      const photoDataUrl = await readPhotoAsDataUrl(file);
      setPhoto(photoDataUrl);
    } catch {
      window.alert("Unable to load the selected image.");
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

  const manager = managerFor(employees, selectedEmployee.id);
  const reports = directReportIds(employees, selectedEmployee.id)
    .map((id) => employees.find((employee) => employee.id === id))
    .filter((employee): employee is Employee => Boolean(employee));

  return (
    <aside className="details-panel">
      {isHoverPreview && <p className="hover-preview-tag">Hover Preview</p>}
      <div className="details-head">
        <img src={selectedEmployee.photo} alt={selectedEmployee.name} loading="lazy" />
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

      <section>
        <h4>Manager</h4>
        {manager ? (
          <button type="button" className="link-btn" onClick={() => onFocus(manager.id)}>
            {manager.name}
          </button>
        ) : (
          <p>Top of hierarchy</p>
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
              setFormManagerId("__selected__");
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
              const managerId = formManagerId === "__selected__" ? selectedEmployee.id : formManagerId === "__none__" ? null : formManagerId;
              onAddEmployee({
                name: formName.trim(),
                title: formTitle.trim(),
                department: formDepartment.trim(),
                location: formLocation.trim(),
                email: formEmail.trim(),
                startDate: formStartDate,
                managerId,
                photo: formPhoto.trim()
              });
              setFormName("");
              setFormTitle("");
              setFormDepartment("");
              setFormLocation("");
              setFormEmail("");
              setFormStartDate("");
              setFormManagerId("__selected__");
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
              <input type="email" value={formEmail} onChange={(event) => setFormEmail(event.target.value)} placeholder="e.g. james.bienen@madison88.com" required />
            </label>
            <label className="form-field">
              <span>Start Date</span>
              <input type="date" value={formStartDate} onChange={(event) => setFormStartDate(event.target.value)} required />
            </label>
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
                    onChange={async (event) => {
                      const picker = event.currentTarget;
                      const file = picker.files?.[0] ?? null;
                      await handlePhotoSelection(file, setFormPhoto);
                      picker.value = "";
                    }}
                  />
                </div>
              </div>
              <small className="form-note form-photo-note">Optional. Upload JPG/PNG/WebP up to 2 MB, or paste an image URL.</small>
            </label>
            <label className="form-field">
              <span>Manager</span>
              <select value={formManagerId} onChange={(event) => setFormManagerId(event.target.value)}>
                <option value="__selected__">Manager: {selectedEmployee.name}</option>
                <option value="__none__">No manager (top-level)</option>
                {employees
                  .filter((employee) => employee.id !== selectedEmployee.id)
                  .map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
              </select>
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
                  setFormManagerId("__selected__");
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

      <section>
        <h4>Edit Employee</h4>
        {!showEditForm ? (
          <button
            type="button"
            className="link-btn"
            disabled={isMutatingDisabled}
            onClick={() => {
              setEditName(selectedEmployee.name);
              setEditTitle(selectedEmployee.title);
              setEditDepartment(selectedEmployee.department);
              setEditLocation(selectedEmployee.location);
              setEditEmail(selectedEmployee.email);
              setEditStartDate(selectedEmployee.startDate);
              setEditStatus(selectedEmployee.status);
              setEditManagerId(selectedEmployee.managerId ?? "__none__");
              setEditPhoto(selectedEmployee.photo);
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
              const managerId =
                editManagerId === "__none__" ? null : editManagerId === "__current__" ? selectedEmployee.managerId : editManagerId;
              onUpdateEmployee({
                id: selectedEmployee.id,
                name: editName.trim(),
                title: editTitle.trim(),
                department: editDepartment.trim(),
                location: editLocation.trim(),
                email: editEmail.trim(),
                startDate: editStartDate,
                status: editStatus,
                managerId,
                photo: editPhoto.trim()
              });
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
              <input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} placeholder="Email" required />
            </label>
            <label className="form-field">
              <span>Start Date</span>
              <input type="date" value={editStartDate} onChange={(event) => setEditStartDate(event.target.value)} required />
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
                    onChange={async (event) => {
                      const picker = event.currentTarget;
                      const file = picker.files?.[0] ?? null;
                      await handlePhotoSelection(file, setEditPhoto);
                      picker.value = "";
                    }}
                  />
                </div>
              </div>
              <small className="form-note form-photo-note">Upload a new image or keep the existing one.</small>
            </label>
            <label className="form-field">
              <span>Status</span>
              <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as Employee["status"])}>
                <option value="standard">Standard</option>
                <option value="promoted">Promoted</option>
                <option value="enhanced">Enhanced</option>
                <option value="new_hire">New Hire</option>
              </select>
            </label>
            <label className="form-field">
              <span>Manager</span>
              <select value={editManagerId} onChange={(event) => setEditManagerId(event.target.value)}>
                <option value="__current__">Keep current manager</option>
                <option value="__none__">No manager (top-level)</option>
                {employees
                  .filter((employee) => employee.id !== selectedEmployee.id)
                  .map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="add-form-actions">
              <button type="submit" className="link-btn">
                Save Changes
              </button>
              <button type="button" className="link-btn" onClick={() => setShowEditForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {isMutatingDisabled && <p className="form-note">Select the employee first before editing details.</p>}
      </section>

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
    </aside>
  );
}
