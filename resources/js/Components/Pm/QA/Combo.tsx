import { useState } from 'react';
import { input } from './types';

export type ComboGroup = { label: string; options: string[] };

const OTHER = '__other__';

/**
 * Choose from a list, or switch to typing a custom value.
 * A real dropdown is used on purpose: type-ahead lists (datalist) are unreliable on phones.
 */
export function Combo({ id, value, groups, placeholder, customLabel, onChange }: {
  id: string; value: string; groups: ComboGroup[]; placeholder: string; customLabel: string; onChange: (v: string) => void;
}) {
  const all = groups.flatMap(g => g.options);
  const known = all.includes(value);
  const [typing, setTyping] = useState((value !== '' && !known) || all.length === 0);

  if (typing) {
    return <div className="flex items-center gap-2">
      <input id={id} className={input} placeholder={customLabel} value={value} onChange={e => onChange(e.target.value)}/>
      {all.length > 0 && <button type="button" className="shrink-0 text-xs font-medium text-indigo-700 hover:underline" onClick={() => { setTyping(false); if (!known) onChange(''); }}>Pick from list</button>}
    </div>;
  }

  return <select id={id} className={input} value={known ? value : ''} onChange={e => {
    if (e.target.value === OTHER) { setTyping(true); onChange(''); } else onChange(e.target.value);
  }}>
    <option value="">{placeholder}</option>
    {groups.filter(g => g.options.length > 0).map(g => <optgroup key={g.label} label={g.label}>{g.options.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>)}
    <option value={OTHER}>{customLabel}</option>
  </select>;
}

/** Split names into "from Taskmandu" and "added here" groups, ignoring case. */
export function splitNames(all: string[], fromTaskmandu: string[], taskmanduLabel: string, otherLabel: string): ComboGroup[] {
  const tm = new Set(fromTaskmandu.map(n => n.toLowerCase()));
  return [
    { label: taskmanduLabel, options: fromTaskmandu },
    { label: otherLabel, options: all.filter(n => !tm.has(n.toLowerCase())) },
  ];
}
