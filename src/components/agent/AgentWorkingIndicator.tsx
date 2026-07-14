import { useEffect, useRef, useState } from "react";

export function AgentWorkingIndicator() {
  const startedAt = useRef(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt.current) / 1_000));
    }, 250);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      role="status"
      aria-label={`Agent working for ${elapsedSeconds} seconds`}
      className="flex items-center gap-2 px-1.5 py-1 text-[11px] text-[var(--color-text-faint)]"
    >
      <span
        aria-hidden="true"
        className="grid grid-cols-2 gap-[2px]"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            className="h-[2px] w-[2px] rounded-full bg-[var(--color-text-muted)] motion-safe:animate-pulse"
            style={{ animationDelay: `${index * 100}ms` }}
          />
        ))}
      </span>
      <span>{elapsedSeconds}s</span>
    </div>
  );
}
