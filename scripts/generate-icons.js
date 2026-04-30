// PixelPusher icon generator
// Run with: npx electron scripts/generate-icons.js
// (Must run via Electron because sharp is compiled for Electron's Node ABI)

const { app } = require('electron');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT      = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const SVG_PATH  = path.join(ROOT, 'src', 'renderer', 'assets', 'icon.svg');

const ALL_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

function createIco(entries) {
  // entries: [{size, buffer}] — PNG data for each size
  const count      = entries.length;
  const dataOffset = 6 + count * 16;
  const totalSize  = dataOffset + entries.reduce((s, e) => s + e.buffer.length, 0);
  const buf        = Buffer.alloc(totalSize);

  buf.writeUInt16LE(0,     0); // reserved
  buf.writeUInt16LE(1,     2); // type: ICO
  buf.writeUInt16LE(count, 4);

  let imgOffset = dataOffset;
  for (let i = 0; i < count; i++) {
    const { size, buffer } = entries[i];
    const pos = 6 + i * 16;
    buf.writeUInt8(size >= 256 ? 0 : size, pos);     // width  (0 = 256)
    buf.writeUInt8(size >= 256 ? 0 : size, pos + 1); // height
    buf.writeUInt8(0,  pos + 2); // color count
    buf.writeUInt8(0,  pos + 3); // reserved
    buf.writeUInt16LE(1,  pos + 4); // planes
    buf.writeUInt16LE(32, pos + 6); // bpp
    buf.writeUInt32LE(buffer.length, pos + 8);  // image size
    buf.writeUInt32LE(imgOffset,     pos + 12); // image offset
    imgOffset += buffer.length;
  }

  let pos = dataOffset;
  for (const { buffer } of entries) {
    buffer.copy(buf, pos);
    pos += buffer.length;
  }

  return buf;
}

async function generateIcons() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  const svgBuffer = fs.readFileSync(SVG_PATH);
  const pngs = [];

  console.log('Generating PNG sizes...');
  for (const size of ALL_SIZES) {
    const buffer = await sharp(svgBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    fs.writeFileSync(path.join(BUILD_DIR, `icon-${size}.png`), buffer);
    pngs.push({ size, buffer });
    console.log(`  ${size}x${size} ✓`);
  }

  // icon.png — 512px version used by Linux and dev window
  const png512 = pngs.find(p => p.size === 512);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png512.buffer);
  console.log('Wrote build/icon.png');

  // icon.ico — multi-size Windows icon with embedded PNGs
  const icoEntries = pngs.filter(p => ICO_SIZES.includes(p.size));
  const ico = createIco(icoEntries);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), ico);
  console.log('Wrote build/icon.ico');

  console.log('\nDone! All icons written to build/');
}

app.whenReady().then(async () => {
  try {
    await generateIcons();
  } catch (err) {
    console.error('\nIcon generation failed:', err.message ?? err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
