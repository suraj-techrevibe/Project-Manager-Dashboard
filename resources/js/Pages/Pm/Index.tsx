import { Head } from '@inertiajs/react';
import { useState } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import FlagsPanel from '@/Components/Pm/FlagsPanel';
import ChatPanel from '@/Components/Pm/ChatPanel';
import BriefDrafter from '@/Components/Pm/BriefDrafter';
import ClientUpdate from '@/Components/Pm/ClientUpdate';
import ScopeCheck from '@/Components/Pm/ScopeCheck';
import GitPanel from '@/Components/Pm/GitPanel';
import ProjectsPanel from '@/Components/Pm/ProjectsPanel';
import type { PmFlag, PmMetrics } from '@/types/pm';

type Tab = 'today' | 'ask' | 'brief' | 'client' | 'scope' | 'git' | 'projects';

const tabs: { key: Tab; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'projects', label: 'Projects' },
  { key: 'ask', label: 'Ask' },
  { key: 'brief', label: 'Brief to tickets' },
  { key: 'client', label: 'Client update' },
  { key: 'scope', label: 'Scope check' },
  { key: 'git', label: 'Git' },
];

export default function PmIndex({ flags, metrics }: { flags: PmFlag[]; metrics: PmMetrics }) {
  const [tab, setTab] = useState<Tab>('today');

  return (
    <AuthenticatedLayout header={<h2 className="text-lg font-medium text-slate-800">PM agent</h2>}>
      <Head title="PM agent" />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === t.key
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'today' && <FlagsPanel flags={flags} metrics={metrics} />}
        {tab === 'projects' && <ProjectsPanel />}
        {tab === 'ask' && <ChatPanel />}
        {tab === 'brief' && <BriefDrafter />}
        {tab === 'client' && <ClientUpdate />}
        {tab === 'scope' && <ScopeCheck />}
        {tab === 'git' && <GitPanel />}
      </div>
    </AuthenticatedLayout>
  );
}
