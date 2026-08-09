// Subscribes to a CSS media query so components can render a genuinely
// different tree on phones instead of restyling the desktop markup.

import { useEffect, useState } from 'react';

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// Breakpoint where tables collapse into stacked lists.
export const COMPACT_QUERY = '(max-width: 720px)';

export function useIsCompact() {
  return useMediaQuery(COMPACT_QUERY);
}
