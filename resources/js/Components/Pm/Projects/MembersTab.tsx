import { useState } from 'react';
import { pmApi } from '../../../lib/pmApi';
import type { Employee, MemberRole, Project, ProjectMember } from '../../../types/pm';
import { MEMBER_ROLES } from '../../../types/pm';
import { Avatar, Badge, ConfirmModal, ErrorNote, Modal, formatDate, ghostBtn, inputCls, primaryBtn, useEmployees, useRunner, err } from './ui';

export default function MembersTab({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const { employees } = useEmployees();
  const [showInvite, setShowInvite] = useState(false);
  const [removing, setRemoving] = useState<ProjectMember | null>(null);
  const { busy, error, run } = useRunner(onChanged);

  async function confirmRemove() {
    if (!removing) return;
    const ok = await run(removing._id, () => pmApi.removeProjectMember(project._id, removing._id), "Couldn't remove that member.");
    if (ok) setRemoving(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{project.members.length} member{project.members.length === 1 ? '' : 's'}</p>
        <button onClick={() => setShowInvite(true)} className={primaryBtn}>Invite member</button>
      </div>

      <ErrorNote message={error} />

      {project.members.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">No members yet.</div>
      )}

      <div className="flex flex-col gap-2">
        {project.members.map((m) => (
          <div key={m._id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={m.name || m.email || '?'} size="h-8 w-8 text-xs" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{m.name || 'Unknown user'}</div>
                <div className="truncate text-xs text-slate-500">{m.email || m.userId}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-xs text-slate-400 sm:inline">Joined {formatDate(m.joinedAt)}</span>
              <Badge className="bg-slate-100 capitalize text-slate-600">{m.role}</Badge>
              <button onClick={() => setRemoving(m)} disabled={busy === m._id} className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {showInvite && (
        <InviteModal
          employees={employees}
          existing={project.members}
          onClose={() => setShowInvite(false)}
          onInvite={async (emp, role) => {
            const { data } = await pmApi.addProjectMember(project._id, { userId: emp.employeeId, role, name: emp.name });
            onChanged(data.project);
            setShowInvite(false);
          }}
        />
      )}

      {removing && (
        <ConfirmModal
          title="Remove member"
          message={`Remove ${removing.name || 'this member'} from the project?`}
          confirmLabel="Remove"
          busy={busy === removing._id}
          onConfirm={confirmRemove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function InviteModal({
  employees,
  existing,
  onClose,
  onInvite,
}: {
  employees: Employee[];
  existing: ProjectMember[];
  onClose: () => void;
  onInvite: (emp: Employee, role: MemberRole) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const matches = employees.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.designation ?? '').toLowerCase().includes(q));
  // Members expose a User id, employees an Employee id — match on name as a best effort;
  // Taskmandu rejects true duplicates with a 409 anyway.
  const isMember = (e: Employee) => existing.some((m) => (m.name ?? '').toLowerCase() === e.name.toLowerCase());

  async function invite(e: Employee) {
    setBusyId(e.employeeId);
    setError(null);
    try {
      await onInvite(e, role);
    } catch (ex) {
      setError(err(ex, "Couldn't add that member."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="Invite member" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…" className={inputCls} autoFocus />
          <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm capitalize">
            {MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <ErrorNote message={error} />
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {matches.length === 0 && <p className="p-2 text-sm text-slate-400">No employees found.</p>}
          {matches.map((e) => (
            <div key={e.employeeId} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 p-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-slate-900">{e.name}</div>
                {e.designation && <div className="truncate text-xs text-slate-400">{e.designation}</div>}
              </div>
              {isMember(e) ? (
                <span className="text-xs text-slate-400">Already a member</span>
              ) : (
                <button onClick={() => invite(e)} disabled={busyId !== null} className={`${primaryBtn} !py-1 text-xs`}>
                  {busyId === e.employeeId ? 'Adding…' : 'Add'}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <button onClick={onClose} className={ghostBtn}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
