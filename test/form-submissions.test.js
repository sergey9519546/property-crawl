'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { persistFormSubmission, removeNewsletterEmail, resetFormSubmissionsForTests, sanitize } = require('../src/lib/form-submissions');

function withoutResend(fn) {
  const savedKey = process.env.RESEND_API_KEY;
  const savedFrom = process.env.RESEND_FROM;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (savedKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = savedKey;
      if (savedFrom === undefined) delete process.env.RESEND_FROM;
      else process.env.RESEND_FROM = savedFrom;
    });
}

function tempFormDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pc-forms-'));
}

test('sanitize trims, strips CR, and caps length', () => {
  assert.equal(sanitize('  hello\r\nworld  ', 12), 'hello\nworld');
  assert.equal(sanitize(12345, 3), '123');
  assert.equal(sanitize(null, 10), '');
});

test('persistFormSubmission stores newsletter payloads locally', async () => {
  await withoutResend(async () => {
  const dir = tempFormDir();
  process.env.PROPERTY_FORM_SUBMISSIONS_DIR = dir;
  process.env.NEWSLETTER_ENDPOINT = '';
  process.env.NEWSLETTER_WEBHOOK_URL = '';
  resetFormSubmissionsForTests('newsletter');

  const result = await persistFormSubmission('newsletter', { email: 'ops@example.com' });
  assert.equal(result.ok, true);
  assert.equal(result.delivery, 'local');
  assert.equal(result.forward.forwarded, false);

  const file = path.join(dir, 'newsletter.jsonl');
  assert.ok(fs.existsSync(file));
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.email, 'ops@example.com');
  assert.equal(record.kind, 'newsletter');
  assert.ok(record.receivedAt);

  process.env.PROPERTY_FORM_SUBMISSIONS_DIR = '';
  });
});

test('persistFormSubmission stores contact payloads locally without claiming delivery', async () => {
  await withoutResend(async () => {
  const dir = tempFormDir();
  process.env.PROPERTY_FORM_SUBMISSIONS_DIR = dir;
  process.env.CONTACT_ENDPOINT = '';
  process.env.CONTACT_WEBHOOK_URL = '';
  resetFormSubmissionsForTests('contact');

  const result = await persistFormSubmission('contact', {
    name: 'Ada',
    email: 'ada@example.com',
    company: 'Analytical Engines',
    message: 'Need underwriting export for FL tax deeds.',
  });
  assert.equal(result.ok, true);
  assert.equal(result.delivery, 'local');

  const file = path.join(dir, 'contact.jsonl');
  const record = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.equal(record.name, 'Ada');
  assert.equal(record.message.includes('FL tax deeds'), true);

  process.env.PROPERTY_FORM_SUBMISSIONS_DIR = '';
  });
});

test('removeNewsletterEmail deletes only the exact newsletter address', async () => {
  const dir = tempFormDir();
  process.env.PROPERTY_FORM_SUBMISSIONS_DIR = dir;
  fs.writeFileSync(path.join(dir, 'newsletter.jsonl'), [
    JSON.stringify({ email: 'keep@example.com' }),
    JSON.stringify({ email: 'drop@example.com' }),
    'not-json',
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'contact.jsonl'), JSON.stringify({ email: 'drop@example.com', message: 'leave me' }) + '\n');
  const result = removeNewsletterEmail(' Drop@Example.com ');
  assert.equal(result.removed, 1);
  const newsletter = fs.readFileSync(path.join(dir, 'newsletter.jsonl'), 'utf8');
  assert.match(newsletter, /keep@example.com/);
  assert.doesNotMatch(newsletter, /drop@example.com/);
  assert.match(newsletter, /not-json/);
  assert.match(fs.readFileSync(path.join(dir, 'contact.jsonl'), 'utf8'), /drop@example.com/);
  process.env.PROPERTY_FORM_SUBMISSIONS_DIR = '';
});

test('newsletter route delegates to shared form store', async () => {
  const routePath = path.resolve(__dirname, '../src/app/api/newsletter/route.ts');
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /@\/lib\/form-submissions/);
  assert.match(source, /persistFormSubmission\("newsletter"/);
  assert.match(source, /delivery/);
  assert.match(source, /A valid email is required/);
});

test('contact route delegates to shared form store', async () => {
  const routePath = path.resolve(__dirname, '../src/app/api/contact/route.ts');
  const source = fs.readFileSync(routePath, 'utf8');
  assert.match(source, /@\/lib\/form-submissions/);
  assert.match(source, /persistFormSubmission\("contact"/);
  assert.match(source, /Message is required/);
});

test('form UI copy no longer claims email delivery when local-only', () => {
  const footer = fs.readFileSync(path.resolve(__dirname, '../src/components/site/site-footer.tsx'), 'utf8');
  const contact = fs.readFileSync(path.resolve(__dirname, '../src/components/site/contact-form.tsx'), 'utf8');
  assert.match(footer, /Email delivery is not configured yet/);
  assert.match(contact, /Outbound delivery is not configured yet/);
  assert.doesNotMatch(contact, /will follow up by email/);
});
