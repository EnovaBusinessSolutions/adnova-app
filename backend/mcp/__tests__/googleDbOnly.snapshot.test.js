'use strict';

describe('resolveSnapshotFirstData MCP_GOOGLE_READS_FROM_DB_ONLY', () => {
  const origSnap = process.env.MCP_SNAPSHOT_FIRST_ENABLED;
  const origDbOnly = process.env.MCP_GOOGLE_READS_FROM_DB_ONLY;

  afterEach(() => {
    process.env.MCP_SNAPSHOT_FIRST_ENABLED = origSnap;
    process.env.MCP_GOOGLE_READS_FROM_DB_ONLY = origDbOnly;
    jest.resetModules();
  });

  test('Google: snapshot path without global snapshot_first; never calls execLive when fresh', async () => {
    delete process.env.MCP_SNAPSHOT_FIRST_ENABLED;
    process.env.MCP_GOOGLE_READS_FROM_DB_ONLY = 'true';
    const { resolveSnapshotFirstData } = require('../snapshot/runSnapshotFirst');
    const execLive = jest.fn(async () => {
      throw new Error('live should not run');
    });
    const data = await resolveSnapshotFirstData({
      toolName: 'get_ad_performance',
      userId: 'u1',
      refreshSource: 'googleAds',
      buildSnapshot: async () => ({
        ok: true,
        data: { channel: 'google', spend: 42 },
        fresh: true,
        snapshot_id: 's1',
        snapshot_age_min: 1,
        partial_coverage: false,
      }),
      execLive,
    });
    expect(data.spend).toBe(42);
    expect(execLive).not.toHaveBeenCalled();
  });

  test('Google: stale snapshot returns DB data without execLive', async () => {
    delete process.env.MCP_SNAPSHOT_FIRST_ENABLED;
    process.env.MCP_GOOGLE_READS_FROM_DB_ONLY = 'true';
    const { resolveSnapshotFirstData } = require('../snapshot/runSnapshotFirst');
    const execLive = jest.fn(async () => ({ channel: 'google', spend: 999 }));
    const data = await resolveSnapshotFirstData({
      toolName: 'get_channel_summary',
      userId: 'u1',
      refreshSource: 'googleAds',
      buildSnapshot: async () => ({
        ok: true,
        data: { channel: 'google', spend: 7 },
        fresh: false,
        snapshot_id: 's2',
        snapshot_age_min: 999,
        partial_coverage: true,
      }),
      execLive,
    });
    expect(data.spend).toBe(7);
    expect(execLive).not.toHaveBeenCalled();
  });

  test('Google: no snapshot throws GOOGLE_SNAPSHOT_MISS without execLive', async () => {
    delete process.env.MCP_SNAPSHOT_FIRST_ENABLED;
    process.env.MCP_GOOGLE_READS_FROM_DB_ONLY = 'true';
    const { resolveSnapshotFirstData } = require('../snapshot/runSnapshotFirst');
    const execLive = jest.fn(async () => ({ spend: 1 }));
    await expect(
      resolveSnapshotFirstData({
        toolName: 'get_ad_performance',
        userId: 'u1',
        refreshSource: 'googleAds',
        buildSnapshot: async () => ({ ok: false }),
        execLive,
      })
    ).rejects.toMatchObject({ code: 'GOOGLE_SNAPSHOT_MISS' });
    expect(execLive).not.toHaveBeenCalled();
  });

  test('Meta unchanged: without snapshot_first still uses execLive', async () => {
    delete process.env.MCP_SNAPSHOT_FIRST_ENABLED;
    process.env.MCP_GOOGLE_READS_FROM_DB_ONLY = 'true';
    const { resolveSnapshotFirstData } = require('../snapshot/runSnapshotFirst');
    const execLive = jest.fn(async () => ({ channel: 'meta', spend: 3 }));
    const data = await resolveSnapshotFirstData({
      toolName: 'get_ad_performance',
      userId: 'u1',
      refreshSource: 'metaAds',
      buildSnapshot: async () => ({ ok: false }),
      execLive,
    });
    expect(data.spend).toBe(3);
    expect(execLive).toHaveBeenCalledTimes(1);
  });
});
