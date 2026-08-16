// 生成应用图标：在离屏页面里用 canvas 把 build/icon.svg 按多尺寸栅格化（保留透明圆角）
// → 合成 build/icon.ico + build/icon.png
// 用法：npm run icon（修改 icon.svg 后重跑一次即可）
const path = require('path');
const fs = require('fs');

const buildDir = path.join(__dirname, '..', 'build');

// ICO 容器：内嵌 PNG 条目（Vista+ 支持）；宽高字节 256 时以 0 表示
function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  images.forEach((img, i) => {
    const e = i * 16;
    entries[e] = img.size >= 256 ? 0 : img.size;
    entries[e + 1] = img.size >= 256 ? 0 : img.size;
    entries[e + 2] = 0;
    entries[e + 3] = 0;
    entries.writeUInt16LE(1, e + 4); // planes
    entries.writeUInt16LE(32, e + 6); // bpp
    entries.writeUInt32LE(img.buffer.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += img.buffer.length;
  });
  return Buffer.concat([header, entries, ...images.map((i) => i.buffer)]);
}

if (!process.versions.electron) {
  // 与 scripts/start.js 相同的技巧：清掉 ELECTRON_RUN_AS_NODE 后用 Electron 运行本文件
  const { spawn } = require('child_process');
  const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [__filename], { stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  const { app, BrowserWindow } = require('electron');
  const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8');
  // 用 canvas 栅格化而非截屏：SVG → Image → 画布 → toDataURL，透明通道有保证
  const html = `<!doctype html><meta charset="utf-8">
<canvas id="c"></canvas>
<script>
window.SVG_SRC = ${JSON.stringify(svg)};
window.renderIcon = async (sizes) => {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.SVG_SRC);
  await img.decode();
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  const out = {};
  for (const s of sizes) {
    c.width = s; c.height = s;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, s, s);
    ctx.drawImage(img, 0, 0, s, s);
    out[s] = {
      png: c.toDataURL('image/png').split(',')[1],
      cornerA: ctx.getImageData(0, 0, 1, 1).data[3],          // 圆角外应为透明 0
      centerA: ctx.getImageData(s >> 1, s >> 1, 1, 1).data[3], // 中心应为不透明 255
    };
  }
  return out;
};
</script>`;

  app.whenReady().then(async () => {
    fs.mkdirSync(buildDir, { recursive: true });
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
    const rendered = await win.webContents.executeJavaScript(`renderIcon(${JSON.stringify(sizes)})`);
    const pngs = [];
    let alphaOk = true;
    for (const s of sizes) {
      const r = rendered[s];
      if (r.cornerA !== 0 || r.centerA !== 255) alphaOk = false;
      pngs.push({ size: s, buffer: Buffer.from(r.png, 'base64') });
      if (s === 512) fs.writeFileSync(path.join(buildDir, 'icon.png'), Buffer.from(r.png, 'base64'));
    }
    const icoImages = pngs.filter((p) => p.size <= 256);
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), makeIco(icoImages));
    console.log(`图标已生成: build/icon.ico (${icoImages.length} 尺寸) + build/icon.png (512)`);
    console.log(alphaOk ? '透明圆角校验: 通过（四角透明、中心不透明）' : '透明圆角校验: 异常，请检查 icon.svg 是否含不透明背景');
    app.exit(alphaOk ? 0 : 1);
  });
}
