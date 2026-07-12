import { useState, useEffect } from 'react';
import type { RuntimeCapabilities } from '@agent-monitor/shared';
import { api } from '../api/client';

export function useRuntimeCapabilities(): RuntimeCapabilities | null {
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);

  useEffect(() => {
    api.getRuntimeCapabilities().then(setCapabilities).catch(() => {});
  }, []);

  return capabilities;
}
