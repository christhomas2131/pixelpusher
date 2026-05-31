// Ensures both arm64 and x64 sharp prebuilds are present in node_modules so
// electron-builder can produce per-arch macOS builds regardless of which
// architecture this machine runs on.
//
// sharp ships its native code via @img/sharp-darwin-<arch> packages declared
// as optionalDependencies, with cpu/os filters that make npm skip variants
// that don't match the host. On an Intel Mac, only sharp-darwin-x64 lands
// in node_modules — building an arm64 .app would then bundle the wrong
// binary, and the resulting app crashes on launch when sharp's loader can't
// find a matching prebuild.
//
// Two-pass `npm install --cpu=…` doesn't work: each pass swaps out the
// other arch's variant ("added 5, removed 5"). Instead we install the
// cross-arch packages **directly by name** (bypassing the optionalDependency
// CPU filter) after letting npm install the host arch normally.

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

function sharpVersion() {
  // Pick the version off whichever variant is currently installed; both
  // variants are kept in lockstep upstream.
  for (const variant of ['sharp-darwin-x64', 'sharp-darwin-arm64']) {
    const pkgJson = path.join(NODE_MODULES_IMG, variant, 'package.json');
    if (fs.existsSync(pkgJson)) {
      return JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version;
    }
  }
  throw new Error('No sharp prebuild present at all — run `npm install` first');
}

function libvipsVersion() {
  for (const variant of ['sharp-libvips-darwin-x64', 'sharp-libvips-darwin-arm64']) {
    const pkgJson = path.join(NODE_MODULES_IMG, variant, 'package.json');
    if (fs.existsSync(pkgJson)) {
      return JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version;
    }
  }
  throw new Error('No libvips prebuild present at all — run `npm install` first');
}

// Resolve the npm CLI. When this script runs from `npm run …`, npm sets
// `npm_execpath` to the absolute path of the npm JS entrypoint — using that
// is safer than relying on $PATH (devs whose primary tool is pnpm or yarn
// may have a stale Homebrew npm shadowing the one their `package.json`
// expects).
function npmInvocation() {
  const npmExec = process.env.npm_execpath;
  if (npmExec && fs.existsSync(npmExec)) {
    // npm_execpath points at the JS file; run it under the current Node.
    return { cmd: process.execPath, leadingArgs: [npmExec] };
  }
  return { cmd: 'npm', leadingArgs: [] };
}

function installCrossArch(arch) {
  if (exists(arch)) {
    console.log(`[mac-arches] sharp-darwin-${arch} already present`);
    return;
  }
  const sv = sharpVersion();
  const lv = libvipsVersion();
  console.log(`[mac-arches] installing @img/sharp-darwin-${arch}@${sv} + @img/sharp-libvips-darwin-${arch}@${lv}…`);
  const { cmd, leadingArgs } = npmInvocation();
  // --no-save:          don't pollute package.json
  // --no-package-lock:  the cross-arch package is build data, not a
  //                     dependency — keep the lockfile clean
  // --ignore-scripts:   don't re-trigger postinstall (e.g. electron-rebuild)
  // --force:            override npm's cpu/os filtering on optional deps
  execFileSync(
    cmd,
    [
      ...leadingArgs,
      'install',
      '--no-save',
      '--no-package-lock',
      '--ignore-scripts',
      '--force',
      `@img/sharp-darwin-${arch}@${sv}`,
      `@img/sharp-libvips-darwin-${arch}@${lv}`,
    ],
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

// Whichever arch is missing gets installed by name. We do NOT swap arches via
// --cpu/--os flags — those remove the existing variant.
const archMissing = !exists('arm64') ? 'arm64' : !exists('x64') ? 'x64' : null;
if (archMissing) {
  installCrossArch(archMissing);
}
if (!exists('arm64') || !exists('x64')) {
  console.error('[mac-arches] FAILED: not all arches present after install');
  console.error('  arm64:', exists('arm64'));
  console.error('  x64:  ', exists('x64'));
  process.exit(1);
}
console.log('[mac-arches] both arches present');
