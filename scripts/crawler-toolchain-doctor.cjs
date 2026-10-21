'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { defaultPython } = require('../server/scrapers/scrapling-bridge');
const { inspectInstallation: inspectUnbrowse } = require('./crawler-tools-unbrowse.cjs');

const ROOT = path.resolve(__dirname, '..');
const REQUIREMENTS = path.join(ROOT, 'scripts', 'crawlers', 'requirements.txt');
const PINNED_SCRAPLING = '0.4.15';
const PINNED_CAMOUFOX = '0.5.8';

function readPinnedDependency(pkgName, file = REQUIREMENTS) {
  if (!fs.existsSync(file)) return null;
  const regex = new RegExp(`^\\s*${pkgName}==([^\\s#]+)`);
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(val => regex.test(val));
  if (!line) return null;
  const match = line.match(regex);
  return match ? match[1].trim() : null;
}

function checkUnbrowseReadiness(options = {}) {
  const state = inspectUnbrowse(options.packageRoot, options.configDir);
  const ok = Boolean(state.installed && state.setupReady && state.tosAccepted);
  return {
    ok,
    name: 'unbrowse',
    installed: state.installed,
    version: state.version,
    packageRoot: state.packageRoot,
    wrapper: state.wrapper,
    setupReady: state.setupReady,
    tosAccepted: state.tosAccepted,
    details: ok ? 'Unbrowse wrapper and TOS-accepted config ready' : (state.installed ? 'Config or TOS acceptance missing' : 'Package wrapper not found'),
  };
}

function checkScraplingReadiness({ python = defaultPython(), requirementsFile = REQUIREMENTS, runner = execFileSync } = {}) {
  const pinned = readPinnedDependency('scrapling', requirementsFile);
  const checks = [
    { name: 'requirements-pin', ok: pinned === PINNED_SCRAPLING, detail: pinned ? `scrapling==${pinned}` : 'missing scrapling== pin' },
  ];

  if (!python || !fs.existsSync(python) || !fs.statSync(python).isFile()) {
    checks.push({ name: 'python-runtime', ok: false, detail: 'configured Python runtime is missing' });
    return { ok: false, name: 'scrapling', version: null, stealthReady: false, checks, details: 'Python runtime missing' };
  }

  const script = [
    'import json, sys',
    'report = {}',
    'try:',
    '    import scrapling',
    '    report["version"] = getattr(scrapling, "__version__", "unknown")',
    '    from scrapling.parser import Selector',
    '    s = Selector("<div>ok</div>")',
    '    report["parser_ok"] = bool(s.css("div::text").get() == "ok")',
    '    from scrapling import Fetcher, StealthyFetcher',
    '    report["stealth_ok"] = True',
    '    report["ok"] = bool(report["parser_ok"] and report["stealth_ok"])',
    'except Exception as e:',
    '    report["ok"] = False',
    '    report["error"] = str(e)',
    'print(json.dumps(report))',
  ].join('\n');

  try {
    const raw = runner(python, ['-c', script], { encoding: 'utf8', timeout: 10000 }).trim();
    const data = JSON.parse(raw);
    const versionOk = data.version === PINNED_SCRAPLING;
    checks.push({ name: 'scrapling-version', ok: versionOk, detail: data.version || 'unknown' });
    checks.push({ name: 'scrapling-parser', ok: Boolean(data.parser_ok), detail: data.parser_ok ? 'Selector verified' : 'Parser check failed' });
    checks.push({ name: 'scrapling-stealth', ok: Boolean(data.stealth_ok), detail: data.stealth_ok ? 'Fetcher and StealthyFetcher verified' : (data.error || 'Stealth fetcher failed') });

    const ok = checks.every(c => c.ok);
    return {
      ok,
      name: 'scrapling',
      version: data.version || null,
      stealthReady: Boolean(data.stealth_ok),
      parserReady: Boolean(data.parser_ok),
      checks,
      details: ok ? `Scrapling ${data.version} with parser and stealth fetchers ready` : (data.error || 'Scrapling checks failed'),
    };
  } catch (error) {
    checks.push({ name: 'scrapling-exec', ok: false, detail: error.message || 'Execution error' });
    return { ok: false, name: 'scrapling', version: null, stealthReady: false, checks, details: error.message };
  }
}

function checkCamoufoxReadiness({ python = defaultPython(), requirementsFile = REQUIREMENTS, runner = execFileSync, testBrowserLaunch = false } = {}) {
  const pinned = readPinnedDependency('camoufox', requirementsFile);
  const checks = [
    { name: 'requirements-pin', ok: pinned === PINNED_CAMOUFOX, detail: pinned ? `camoufox==${pinned}` : 'missing camoufox== pin' },
  ];

  if (!python || !fs.existsSync(python) || !fs.statSync(python).isFile()) {
    checks.push({ name: 'python-runtime', ok: false, detail: 'configured Python runtime is missing' });
    return { ok: false, name: 'camoufox', version: null, browserInstalled: false, checks, details: 'Python runtime missing' };
  }

  const script = [
    'import json, os, sys, importlib.metadata',
    'report = {}',
    'try:',
    '    import camoufox',
    '    from camoufox import pkgman',
    '    report["version"] = importlib.metadata.version("camoufox")',
    '    l_path = pkgman.launch_path()',
    '    b_installed = os.path.exists(l_path) if l_path else False',
    '    b_ver = pkgman.installed_verstr()',
    '    report["launch_path"] = str(l_path) if l_path else None',
    '    report["browser_installed"] = b_installed',
    '    report["browser_version"] = b_ver',
    `    test_launch = ${testBrowserLaunch ? 'True' : 'False'}`,
    '    if test_launch and b_installed:',
    '        from camoufox.sync_api import Camoufox',
    '        with Camoufox(headless=True) as browser:',
    '            page = browser.new_page()',
    '            page.goto("data:text/html,<html><body><h1 id=t>ready</h1></body></html>")',
    '            report["launch_ok"] = bool(page.inner_text("#t") == "ready")',
    '    else:',
    '        report["launch_ok"] = None',
    '    report["ok"] = bool(b_installed and (not test_launch or report.get("launch_ok")))',
    'except Exception as e:',
    '    report["ok"] = False',
    '    report["error"] = str(e)',
    'print(json.dumps(report))',
  ].join('\n');

  try {
    const raw = runner(python, ['-c', script], { encoding: 'utf8', timeout: testBrowserLaunch ? 25000 : 10000 }).trim();
    const data = JSON.parse(raw);
    checks.push({ name: 'camoufox-import', ok: Boolean(data.version), detail: data.version || 'import failed' });
    checks.push({ name: 'camoufox-browser-binary', ok: Boolean(data.browser_installed), detail: data.launch_path || 'camoufox binary missing (run camoufox fetch)' });
    if (testBrowserLaunch) {
      checks.push({ name: 'camoufox-headless-launch', ok: Boolean(data.launch_ok), detail: data.launch_ok ? 'Headless browser launch succeeded' : 'Browser launch failed' });
    }

    const ok = checks.every(c => c.ok);
    return {
      ok,
      name: 'camoufox',
      version: data.version || null,
      browserInstalled: Boolean(data.browser_installed),
      browserVersion: data.browser_version || null,
      launchPath: data.launch_path || null,
      launchTested: testBrowserLaunch ? Boolean(data.launch_ok) : false,
      checks,
      details: ok ? `Camoufox ${data.version} with browser binary ${data.browser_version} ready` : (data.error || 'Camoufox checks failed'),
    };
  } catch (error) {
    checks.push({ name: 'camoufox-exec', ok: false, detail: error.message || 'Execution error' });
    return { ok: false, name: 'camoufox', version: null, browserInstalled: false, checks, details: error.message };
  }
}

function auditCrawlerToolchain({ python = defaultPython(), testBrowserLaunch = false, requirementsFile = REQUIREMENTS } = {}) {
  const unbrowse = checkUnbrowseReadiness();
  const scrapling = checkScraplingReadiness({ python, requirementsFile });
  const camoufox = checkCamoufoxReadiness({ python, requirementsFile, testBrowserLaunch });

  const tools = { unbrowse, scrapling, camoufox };
  const ready = unbrowse.ok && scrapling.ok && camoufox.ok;

  return {
    ready,
    timestamp: new Date().toISOString(),
    python: python ? path.resolve(python) : null,
    tools,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const testBrowserLaunch = args.includes('--browser') || args.includes('--test-launch');
  const asJson = args.includes('--json') || !process.stdout.isTTY;

  const result = auditCrawlerToolchain({ testBrowserLaunch });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    console.log('\n=== CRAWLER TOOLCHAIN FORENSIC AUDIT ===');
    console.log(`Status: ${result.ready ? 'ALL READY (PASS)' : 'DEFECTS DETECTED (FAIL)'}`);
    console.log(`Python: ${result.python || 'NOT FOUND'}`);
    console.log('----------------------------------------');
    for (const [tool, report] of Object.entries(result.tools)) {
      const badge = report.ok ? '✓ PASS' : '✗ FAIL';
      console.log(`[${badge}] ${tool.toUpperCase()} (version: ${report.version || 'unknown'}): ${report.details}`);
      for (const check of report.checks || []) {
        console.log(`    - ${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
      }
    }
    console.log('========================================\n');
  }

  process.exitCode = result.ready ? 0 : 1;
}

module.exports = {
  PINNED_SCRAPLING,
  PINNED_CAMOUFOX,
  REQUIREMENTS,
  readPinnedDependency,
  checkUnbrowseReadiness,
  checkScraplingReadiness,
  checkCamoufoxReadiness,
  auditCrawlerToolchain,
};
