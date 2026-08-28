// 使用现有托盘图标同一设计（黄色圆 + 两条书脊线）生成安装程序所需 ICO。
// 运行：node scripts/make-icon.cjs （sharp 来自平台根目录 node_modules）
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SIZES = [16, 24, 32, 48, 64, 128, 256];

// 与 tray-icon.png 一致的造型，放大到 256×256。
const svg =
  '<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">' +
  '<circle cx="128" cy="128" r="112" fill="#FFD43B"/>' +
  '<rect x="72" y="104" width="112" height="24" rx="12" fill="#B8860B"/>' +
  '<rect x="72" y="144" width="112" height="24" rx="12" fill="#B8860B"/>' +
  "</svg>";

async function main() {
  const outDir = path.join(__dirname, "..", "build");
  fs.mkdirSync(outDir, { recursive: true });

  const png256 = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  fs.writeFileSync(path.join(outDir, "icon.png"), png256);

  const pngs = [];
  for (const size of SIZES) {
    const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
    pngs.push({ size, buf });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(SIZES.length, 4); // count

  const entries = [];
  let offset = 6 + SIZES.length * 16;
  for (const { size, buf } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size === 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(buf.length, 8); // bytes in resource
    entry.writeUInt32LE(offset, 12); // offset
    entries.push(entry);
    offset += buf.length;
  }

  const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
  fs.writeFileSync(path.join(outDir, "icon.ico"), ico);
  console.log("已生成 build/icon.png 与 build/icon.ico");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
