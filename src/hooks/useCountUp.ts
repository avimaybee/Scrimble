import { useEffect, useState } from 'react';

interface UseCountUpOptions {
  target: number;
  durationMs: number;
  enabled?: boolean;
}

export function useCountUp({ target, durationMs, enabled = true }: UseCountUpOptions) {
  const [value, setValue] = useState(() => (enabled && target > 0 ? 0 : target));

  useEffect(() => {
    if (!enabled || target <= 0) {
      setValue(target);
      return;
    }

    let frameId = 0;
    const startedAt = performance.now();

    const tick = (timestamp: number) => {
      const elapsed = timestamp - startedAt;
      const progress = Math.min(elapsed / Math.max(durationMs, 1), 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [durationMs, enabled, target]);

  return value;
}
