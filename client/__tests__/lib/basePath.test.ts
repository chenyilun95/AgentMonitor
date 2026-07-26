import { describe, expect, it } from 'vitest';
import { detectAppBasePath } from '../../src/lib/basePath';

describe('detectAppBasePath', () => {
  it('keeps root deployments unchanged', () => {
    expect(detectAppBasePath('/')).toBe('');
    expect(detectAppBasePath('/agent/agent-1')).toBe('');
  });

  it('detects a Labs prefix from both entry and nested routes', () => {
    expect(detectAppBasePath('/labs/agent-monitor/')).toBe('/labs/agent-monitor');
    expect(detectAppBasePath('/labs/agent-monitor/agent/agent-1')).toBe('/labs/agent-monitor');
    expect(detectAppBasePath('/labs/agent-monitor-aliyunraw/login')).toBe('/labs/agent-monitor-aliyunraw');
  });
});
