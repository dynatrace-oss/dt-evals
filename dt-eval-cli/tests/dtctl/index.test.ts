import { describe, it, expect } from 'vitest';
import { liveSubdomain } from '../../src/dtctl/index.js';

describe('liveSubdomain', () => {
  it('rewrites *.apps.dynatrace.com to *.live.dynatrace.com', () => {
    expect(liveSubdomain('https://abc123.apps.dynatrace.com'))
      .toBe('https://abc123.live.dynatrace.com');
  });

  it('rewrites *.apps.dynatracelabs.com to *.dynatracelabs.com', () => {
    expect(liveSubdomain('https://abc123.apps.dynatracelabs.com'))
      .toBe('https://abc123.dynatracelabs.com');
  });

  it('preserves a path after the host', () => {
    expect(liveSubdomain('https://abc123.apps.dynatrace.com/api/v2/bizevents/ingest'))
      .toBe('https://abc123.live.dynatrace.com/api/v2/bizevents/ingest');
  });

  it('is idempotent on already-rewritten .live. URLs', () => {
    const url = 'https://abc123.live.dynatrace.com';
    expect(liveSubdomain(url)).toBe(url);
  });

  it('passes through on-prem / cluster URLs unchanged', () => {
    const url = 'https://my-cluster.internal.example.com';
    expect(liveSubdomain(url)).toBe(url);
  });
});
