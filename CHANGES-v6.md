# v6 — Task page: assignees, "Assigned by", editable sub-tasks

Replace these two files (independent of the other zips):
- resources/js/Components/Pm/Projects/ui.tsx          (AssigneePicker fix)
- resources/js/Components/Pm/Projects/TaskDetail.tsx  (Assigned by / Assigned to, sub-task Edit)

No backend change, no migration. Just refresh after `npm run dev` picks them up.
