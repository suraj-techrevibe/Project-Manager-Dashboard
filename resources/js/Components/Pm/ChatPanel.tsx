import { FormEvent, useState } from 'react';
import { pmApi } from '../../lib/pmApi';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const suggestions = [
  "Who's overloaded this week?",
  'Which done cards are unverified?',
  'What is blocking the most cards?',
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Ask about any card, person, or deadline.' },
  ]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim()) {
      setError('Enter a question first');
      return;
    }
    setError(null);
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setQuestion('');
    setLoading(true);
    try {
      const { data } = await pmApi.ask(q);
      setMessages((m) => [...m, { role: 'assistant', text: data.answer }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: "Couldn't reach the assistant. Try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    ask(question);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex min-h-[120px] flex-col gap-2">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-sm ${
              m.role === 'user'
                ? 'self-end bg-blue-50 text-slate-900'
                : 'self-start bg-slate-100 text-slate-700'
            }`}
          >
            {m.text}
          </div>
        ))}
        {loading && <div className="self-start text-xs text-slate-400">Checking the board…</div>}
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => ask(s)}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setError(null);
          }}
          placeholder="Ask about any card..."
          className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {error && <div className="mt-1.5 text-xs text-red-600">{error}</div>}
    </div>
  );
}
