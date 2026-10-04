interface SpinnerProps {
  /** Tailwind size classes, default is a small inline 16px spinner. */
  className?: string;
  /** Optional text shown next to the spinner. */
  label?: string;
}

/** Small inline loading spinner. Inherits the text colour, so it works on dark and light buttons. */
export default function Spinner({ className = 'h-4 w-4', label }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
      <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
