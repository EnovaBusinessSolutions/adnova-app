'use strict';

jest.mock('../snapshot/config', () => ({
  isSnapshotFirstEnabledForTool: () => true,
  isBackgroundRefreshEnabled: () => false,
  getRefreshDebounceMs: () => 300000,
  isGoogleReadsFromDbOnly: () => false,
}));

const { runSnapshotFirstTool, resolveSnapshotFirstData } = require('../snapshot/runSnapshotFirst');

describe('runSnapshotFirst emptyFallback / live_error_no_snapshot', () => {
  test('runSnapshotFirstTool uses emptyFallback when no snapshot and execLive throws', async () => {
    const resp = await runSnapshotFirstTool({
      toolName: 'get_ad_performance',
      userId: '507f1f77bcf86cd799439011',
      refreshSource: null,
      buildSnapshot: async () => ({ ok: false }),
      execLive: async () => {
        throw new Error('Request failed with status code 403');
      },
      emptyFallback: () => ({
        channel: 'google',
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        cpc: 0,
        cpm: 0,
        currency: 'USD',
        date_from: '2026-01-01',
        date_to: '2026-01-10',
        rows: [],
      }),
    });
    const data = JSON.parse(resp.content[0].text);
    expect(data.channel).toBe('google');
    expect(data.spend).toBe(0);
  });

  test('runSnapshotFirstTool rethrows ACCOUNT_NOT_CONNECTED even with emptyFallback', async () => {
    await expect(
      runSnapshotFirstTool({
        toolName: 'get_ad_performance',
        userId: '507f1f77bcf86cd799439011',
        refreshSource: null,
        buildSnapshot: async () => ({ ok: false }),
        execLive: async () => {
          throw Object.assign(new Error('not connected'), { code: 'ACCOUNT_NOT_CONNECTED' });
        },
        emptyFallback: () => ({ channel: 'google', spend: 999 }),
      })
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_CONNECTED' });
  });

  test('resolveSnapshotFirstData throws on no_snapshot execLive failure', async () => {
    await expect(
      resolveSnapshotFirstData({
        toolName: 'get_ad_performance',
        userId: 'u1',
        refreshSource: null,
        buildSnapshot: async () => ({ ok: false }),
        execLive: async () => {
          throw new Error('403');
        },
      })
    ).rejects.toThrow('403');
  });
});
