import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkspaceUnlockLimiter,
  workspaceUnlockBucket,
} from '../src/lib/workspace-unlock-limiter.ts';

test('workspace unlock attempts are bounded and report retry timing', () => {
  let now = 10_000;
  const limiter = new WorkspaceUnlockLimiter(3, 30_000, () => now);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(limiter.check('global').allowed, true);
    limiter.recordFailure('global');
  }
  assert.deepEqual(limiter.check('global'), { allowed: false, retryAfterSeconds: 30 });
  now += 29_001;
  assert.equal(limiter.check('global').retryAfterSeconds, 1);
  now += 999;
  assert.deepEqual(limiter.check('global'), { allowed: true, retryAfterSeconds: 0 });
});

test('successful unlock resets failures and forwarded headers cannot create new buckets', () => {
  const limiter = new WorkspaceUnlockLimiter(1, 60_000, () => 20_000);
  limiter.recordFailure('global');
  assert.equal(limiter.check('global').allowed, false);
  limiter.reset('global');
  assert.equal(limiter.check('global').allowed, true);

  const first = new Request('https://app.example/api/workspace/session', { headers: { 'x-forwarded-for': '203.0.113.1' } });
  const second = new Request('https://app.example/api/workspace/session', { headers: { 'x-forwarded-for': '203.0.113.2', 'x-real-ip': '198.51.100.9' } });
  assert.equal(workspaceUnlockBucket(first), 'global');
  assert.equal(workspaceUnlockBucket(second), 'global');
});