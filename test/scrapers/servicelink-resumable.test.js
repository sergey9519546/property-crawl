'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ServiceLinkScraper,
  readCheckpointFile,
  writeCheckpointFile,
  clearCheckpointFile,
} = require('../../server/scrapers/servicelink');

function response(body, status = 200) {
  return {
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  };
}

function dummyRecord(id = 'a1c3k000004TZagAAG') {
  return {
    listingId: id,
    auctionProgram: 'TPS',
    propertyInfo: {
      address: '100 North St',
      city: 'Phoenix',
      state: 'AZ',
      postalCode: '85001',
      propertyType: 'Single Family Home',
      websiteUrl: `https://www.servicelinkauction.com/property-details/${id}`,
    },
    listingStatus: { statusText: 'Active' },
    createdDate: '2026-10-01',
  };
}

test('walks multiple pages bounded by maxPages and pageSize', async () => {
  const pageRequests = [];
  const p1Record = dummyRecord('a1c000000000001');
  const p2Record = dummyRecord('a1c000000000002');
  const p3Record = dummyRecord('a1c000000000003');

  const scraper = new ServiceLinkScraper({
    maxPages: 2,
    limit: 10,
    random: () => 0,
    sleep: async () => {},
    fetchImpl: async (url) => {
      const parsedUrl = new URL(url);
      pageRequests.push({
        url: parsedUrl.toString(),
        token: parsedUrl.searchParams.get('continuationToken'),
        limit: parsedUrl.searchParams.get('limit'),
      });

      if (pageRequests.length === 1) {
        return response({
          continuationToken: 'cursor-page-2',
          data: [p1Record],
        });
      }
      if (pageRequests.length === 2) {
        return response({
          continuationToken: 'cursor-page-3',
          data: [p2Record],
        });
      }
      return response({
        continuationToken: null,
        data: [p3Record],
      });
    },
  });

  const listings = await scraper.scrapeFeed();
  assert.equal(pageRequests.length, 2, 'Should stop after maxPages = 2 even though cursor-page-3 exists');
  assert.equal(pageRequests[0].token, null, 'First page should have no continuation token');
  assert.equal(pageRequests[0].limit, '10', 'Page size should respect limit');
  assert.equal(pageRequests[1].token, 'cursor-page-2', 'Second page should request with cursor-page-2');
  assert.equal(listings.length, 2);
  assert.equal(scraper.lastRunReport.truncated, true);
  assert.equal(scraper.lastRunReport.nextContinuationToken, 'cursor-page-3');
});

test('records pagination checkpoint when bounded sweep stops', async () => {
  const tmpCheckpoint = path.join(os.tmpdir(), `sl-chk-test-${Date.now()}-${process.pid}.json`);
  try {
    const scraper = new ServiceLinkScraper({
      checkpointPath: tmpCheckpoint,
      maxPages: 1,
      limit: 25,
      random: () => 0,
      sleep: async () => {},
      fetchImpl: async () => response({
        continuationToken: 'saved-token-abc',
        data: [dummyRecord('a1c000000000010')],
      }),
    });

    await scraper.scrapeFeed();
    assert.equal(fs.existsSync(tmpCheckpoint), true, 'Checkpoint file should be written');

    const checkpoint = readCheckpointFile(tmpCheckpoint);
    assert.ok(checkpoint);
    assert.equal(checkpoint.continuationToken, 'saved-token-abc');
    assert.equal(checkpoint.pagesCommitted, 1);
  } finally {
    clearCheckpointFile(tmpCheckpoint);
  }
});

test('subsequent run automatically resumes from saved checkpoint without restarting', async () => {
  const tmpCheckpoint = path.join(os.tmpdir(), `sl-resume-test-${Date.now()}-${process.pid}.json`);
  writeCheckpointFile(tmpCheckpoint, {
    continuationToken: 'persisted-cursor-xyz',
    sweepStartedAt: '2026-10-15T00:00:00.000Z',
    pagesCommitted: 3,
  });

  const requestedTokens = [];
  try {
    const scraper = new ServiceLinkScraper({
      checkpointPath: tmpCheckpoint,
      maxPages: 1,
      random: () => 0,
      sleep: async () => {},
      fetchImpl: async (url) => {
        const parsedUrl = new URL(url);
        requestedTokens.push(parsedUrl.searchParams.get('continuationToken'));
        return response({
          continuationToken: null,
          data: [dummyRecord('a1c000000000020')],
        });
      },
    });

    assert.equal(scraper.resumeToken, 'persisted-cursor-xyz', 'Scraper should load resume token from checkpoint file');

    await scraper.scrapeFeed();
    assert.deepEqual(requestedTokens, ['persisted-cursor-xyz'], 'Request should use resumed cursor token');
    assert.equal(fs.existsSync(tmpCheckpoint), false, 'Checkpoint should be cleared on complete sweep');
  } finally {
    clearCheckpointFile(tmpCheckpoint);
  }
});

test('--restart flag clears checkpoint and starts fresh from page 1', async () => {
  const tmpCheckpoint = path.join(os.tmpdir(), `sl-restart-test-${Date.now()}-${process.pid}.json`);
  writeCheckpointFile(tmpCheckpoint, {
    continuationToken: 'should-be-cleared',
    pagesCommitted: 5,
  });

  const requestedTokens = [];
  try {
    const scraper = new ServiceLinkScraper({
      checkpointPath: tmpCheckpoint,
      restart: true,
      maxPages: 1,
      random: () => 0,
      sleep: async () => {},
      fetchImpl: async (url) => {
        const parsedUrl = new URL(url);
        requestedTokens.push(parsedUrl.searchParams.get('continuationToken'));
        return response({
          continuationToken: 'new-cursor-123',
          data: [dummyRecord('a1c000000000030')],
        });
      },
    });

    assert.equal(scraper.resumeToken, null, 'Resume token should be null when restart is enabled');
    assert.equal(fs.existsSync(tmpCheckpoint), false, 'Checkpoint file should be cleared on restart');

    await scraper.scrapeFeed();
    assert.deepEqual(requestedTokens, [null], 'Request should start from page 1 (null token)');
  } finally {
    clearCheckpointFile(tmpCheckpoint);
  }
});

test('autoThrottle and crawlJitter are called between pages', async () => {
  let jitterCalls = 0;
  const scraper = new ServiceLinkScraper({
    maxPages: 3,
    limit: 5,
    random: () => 0,
    sleep: async () => {},
    fetchImpl: async (url) => {
      return response({
        continuationToken: 'next-token',
        data: [dummyRecord('a1c000000000040')],
      });
    },
  });

  scraper.crawlJitter = async () => {
    jitterCalls += 1;
  };

  await scraper.scrapeFeed();
  assert.equal(jitterCalls, 2, 'crawlJitter should be called between page 1-2 and page 2-3');
});
