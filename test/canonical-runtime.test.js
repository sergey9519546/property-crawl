const assert = require('assert');
const { spawnSync } = require('child_process');
const test = require('node:test');

test('npm run dev launches the Next.js application command', () => {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run dev -- --help']
    : ['run', 'dev', '--', '--help'];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 15_000,
  });

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.strictEqual(
    result.status,
    0,
    `expected the dev command to exit successfully with --help, got:\n${output}`,
  );
  assert.match(output, /Next\.js/i, `expected Next.js CLI help, got:\n${output}`);
});
