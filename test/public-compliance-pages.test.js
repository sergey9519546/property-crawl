'use strict';

// test/public-compliance-pages.test.js
//
// Contract and compliance verification for the public marketing, legal,
// and informational surfaces: /terms, /privacy, /about, /contact, /resources.
//
// Enforces that legal non-negotiables ($0 Liability Moat, TCPA, CA § 1695)
// and statutory auction disclaimers remain non-negotiably present in the pages.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('Terms of service page exists and contains mandatory statutory disclaimers', () => {
  const termsPath = path.join(ROOT, 'src/app/terms/page.tsx');
  assert.ok(fs.existsSync(termsPath), 'Terms page must exist');
  const content = fs.readFileSync(termsPath, 'utf8');

  // Verify non-brokerage disclaimer
  assert.match(content, /not a licensed real estate broker/i);
  assert.match(content, /discovery/i);

  // Verify TCPA and California Civil Code § 1695 non-negotiable compliance
  assert.match(content, /Telephone Consumer Protection Act/i);
  assert.match(content, /47 U\.S\.C\. § 227/);
  assert.match(content, /California Civil Code § 1695/);

  // Verify appraisal and bankruptcy stay disclaimers
  assert.match(content, /Under no circumstances does a Deal Score/i);
  assert.match(content, /11 U\.S\.C\. § 362/);
});

test('Privacy policy page exists and enforces zero personal data monetization', () => {
  const privacyPath = path.join(ROOT, 'src/app/privacy/page.tsx');
  assert.ok(fs.existsSync(privacyPath), 'Privacy policy page must exist');
  const content = fs.readFileSync(privacyPath, 'utf8');

  // Verify zero data sale pledge
  assert.match(content, /do not sell, rent, lease,[\s\r\n]+or monetize/i);

  // Verify public legal notice distinction
  assert.match(content, /statutorily mandated public legal notices/i);

  // Verify CCPA / CPRA disclosures
  assert.match(content, /California Consumer Privacy Act/i);
  assert.match(content, /Right to Know/i);
  assert.match(content, /Right to Delete/i);
});

test('About page says who it is for and what it does not do, in buyer language', () => {
  const aboutPath = path.join(ROOT, 'src/app/about/page.tsx');
  assert.ok(fs.existsSync(aboutPath), 'About page must exist');
  const content = fs.readFileSync(aboutPath, 'utf8');

  assert.match(content, /Zero Cold Calls/i);
  assert.match(content, /title search/i);
  assert.match(content, /href="\/listings"/);
  // Buyer copy, not a borrowed brand or engineering vocabulary.
  assert.doesNotMatch(content, /Zillow for distressed|Email-as-API|Scrapling|Platform-Level County Parsers/i);
});

test('Contact page provides interactive inquiry form', () => {
  const contactPath = path.join(ROOT, 'src/app/contact/page.tsx');
  assert.ok(fs.existsSync(contactPath), 'Contact page must exist');
  const content = fs.readFileSync(contactPath, 'utf8');

  assert.match(content, /Contact PerfectProperty/i);
  assert.match(content, /fetch\("\/api\/contact"/);
  assert.match(content, /handleSubmit/);
});

test('Resources page provides knowledge base and changelog', () => {
  const resourcesPath = path.join(ROOT, 'src/app/resources/page.tsx');
  assert.ok(fs.existsSync(resourcesPath), 'Resources page must exist');
  const content = fs.readFileSync(resourcesPath, 'utf8');

  assert.match(content, /id="knowledge-base"/);
  assert.match(content, /id="changelog"/);
  assert.match(content, /Judicial Foreclosure/i);
  assert.match(content, /Fla\. Stat\. § 201\.02/);
});

test('Portfolio page exists and renders within WorkspaceShell', () => {
  const portfolioPath = path.join(ROOT, 'src/app/portfolio/page.tsx');
  assert.ok(fs.existsSync(portfolioPath), 'Portfolio page must exist');
  const content = fs.readFileSync(portfolioPath, 'utf8');

  assert.match(content, /WorkspaceShell/);
  assert.match(content, /PortfolioView/);
});

test('Nearby comps component exists and is mounted on listing detail page', () => {
  const compsCompPath = path.join(ROOT, 'src/components/listings/nearby-comps.tsx');
  assert.ok(fs.existsSync(compsCompPath), 'NearbyComps component must exist');

  const detailPath = path.join(ROOT, 'src/app/listings/[id]/page.tsx');
  const detailContent = fs.readFileSync(detailPath, 'utf8');
  assert.match(detailContent, /NearbyComps/);
});
