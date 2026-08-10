/**
 * Tenant reachability — the design doc's "Credentials — good: valid ones connect".
 *
 * The cheapest possible real check, and the one every other suite depends on: if
 * this is red, a failure anywhere else says nothing about dt-evals. It also
 * proves the harness itself works (env resolution → DQL client → tenant).
 */

import { describe, expect, it } from 'vitest';
import { DynatraceClient, PermanentQueryError } from '../src/dynatrace.js';
import { e2eEnabled, tenant } from '../src/env.js';

describe.skipIf(!e2eEnabled())('tenant reachability', () => {
  it('executes a DQL query against the configured tenant', async () => {
    const { appsEndpoint, apiToken } = tenant();
    const client = new DynatraceClient(appsEndpoint, apiToken);

    // `fetch logs | limit 1` is what the CLI's own connectivity probe uses
    // (dt-eval-cli/src/cli/commands/validate.ts:15), so a pass here means
    // `validate`'s connection check will pass for the same reason.
    // The test is that this resolves rather than throws: `execute` only returns
    // once the query reached SUCCEEDED, and turns anything else — a rejected
    // token, a missing scope, a bad gateway — into a throw.
    //
    // Deliberately *not* asserting on the records. An idle tenant legitimately
    // returns zero, so a volume assertion would make this about data rather than
    // about credentials. An earlier version asserted `Array.isArray(records)`,
    // which reads like a check but cannot fail: execute() returns
    // `response.result?.records ?? []` (src/dynatrace.ts), always an array.
    await expect(
      client.execute('fetch logs, from:now() - 1h | limit 1'),
    ).resolves.toBeDefined();
  });

  it('rejects a bad token rather than silently returning nothing', async () => {
    const { appsEndpoint } = tenant();
    const client = new DynatraceClient(appsEndpoint, 'dt0c01.INVALID.INVALID');

    // The negative half of the same check. This matters more than it looks:
    // Grail answers a missing *scope* with SUCCEEDED-and-zero-records, so
    // "empty result" is not a reliable signal of an auth problem. A rejected
    // token must surface as a thrown error.
    //
    // PermanentQueryError specifically, not a bare toThrow(): the tenant rejects
    // this token with a 4xx, which decode() classifies as permanent
    // (src/dynatrace.ts). A bare toThrow() is also satisfied by a DNS failure, a
    // 500 or an abort timeout — exactly the "the network was down" case this
    // test claims to distinguish itself from.
    await expect(client.execute('fetch logs | limit 1')).rejects.toThrow(PermanentQueryError);
  });
});
