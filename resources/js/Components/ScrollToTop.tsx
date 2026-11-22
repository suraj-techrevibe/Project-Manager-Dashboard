import { useEffect, useState } from 'react';

/** Floating "back to top" button. Appears once the page has scrolled; used on every page layout. `raised` lifts it above the assistant bubble. */
export default function ScrollToTop({ raised = false }: { raised?: boolean }) {
    const [show, setShow] = useState(false);

    useEffect(() => {
        const onScroll = () => setShow(window.scrollY > 300);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <button
            type="button"
            aria-label="Scroll to top"
            title="Scroll to top"
            tabIndex={show ? 0 : -1}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className={`fixed ${raised ? 'bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]' : 'bottom-[max(1.25rem,env(safe-area-inset-bottom))]'} right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg transition duration-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 sm:right-6 ${
                show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
            }`}
        >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
        </button>
    );
}
