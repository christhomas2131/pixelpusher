// Ensures both arm64 and x64 sharp prebuilds are present in node_modules so
// electron-builder can produce universal (or per-arch) macOS builds regardless
// of which architecture this machine runs on.
//
// sharp ships its native code via @img/sharp-darwin-<arch> packages declared
// as optionalDependencies, with cpu/os filters that make npm skip the variant
// for the host. On an Intel Mac, only sharp-darwin-x64 lands in node_modules
// — building an arm64 .app would then bundle the wrong binary.
//
// `npm install --cpu=<arch> --os=darwin --include=optional --no-save sharp`
// bypasses the host filter and forces the cross-arch variant into place
// without touching package.json.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE_MODULES_IMG = path.join(ROOT, 'node_modules', '@img');

function exists(arch) {
  return (
    fs.existsSync(path.join(NODE_MODULES_IMG, `sharp-darwin-${arch}`)) &&
    fs.existsSync(path.join(NODE_MODULES_IMG, `sharp-libvips-darwin-${arch}`))
  );
}

function ensure(arch) {
  if (exists(arch)) {
    console.log(`[mac-arches] sharp-darwin-${arch} already present`);
    return;
  }
  console.log(`[mac-arches] installing sharp-darwin-${arch}…`);
  execFileSync(
    'npm',
    ['install', '--no-save', '--include=optional', `--cpu=${arch}`, '--os=darwin', 'sharp'],
    { stdio: 'inherit', cwd: ROOT },
  );
  if (!exists(arch)) {
    console.error(`[mac-arches] FAILED: sharp-darwin-${arch} still missing after install`);
    process.exit(1);
  }
  console.log(`[mac-arches] sharp-darwin-${arch} installed`);
}

if (process.platform !== 'darwin') {
  console.log('[mac-arches] skipping (not running on darwin)');
  process.exit(0);
}

ensure('arm64');
ensure('x64');
console.log('[mac-arches] both arches present');
