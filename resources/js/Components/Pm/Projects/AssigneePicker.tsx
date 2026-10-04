import { Employee } from "@/types/pm";

export function AssigneePicker({
  employees,
  value,
  onChange,
}: {
  employees: Employee[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  // Taskmandu may store an assignee as the employeeId OR the Mongo _id, so a person
  // counts as selected if either form is in the list. (Matching only employeeId left
  // every box unchecked for tasks that were assigned by _id.)
  const isOn = (e: Employee) => value.includes(e.employeeId) || (!!e.id && value.includes(e.id));

  const toggle = (e: Employee) =>
    onChange(
      isOn(e)
        ? value.filter((x) => x !== e.employeeId && x !== e.id)
        : [...value, e.employeeId]
    );

  // Ids that match nobody in the employee list (e.g. someone who left). They stay on the
  // task and are shown, so saving never silently drops them.
  const known = new Set(employees.flatMap((e) => [e.employeeId, e.id].filter(Boolean) as string[]));
  const unknown = employees.length > 0 ? value.filter((id) => !known.has(id)) : [];

  return (
    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">
      {employees.length === 0 && <span className="text-xs text-slate-400">No employees loaded.</span>}
      {employees.map((e) => (
        <label key={e.employeeId} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isOn(e)} onChange={() => toggle(e)} />
          {e.name}
        </label>
      ))}
      {unknown.map((id) => (
        <label key={id} className="flex items-center gap-2 text-sm text-slate-400" title="Not in the current employee list">
          <input type="checkbox" checked onChange={() => onChange(value.filter((x) => x !== id))} />
          Unknown user ({id.slice(0, 6)}…)
        </label>
      ))}
    </div>
  );
}
