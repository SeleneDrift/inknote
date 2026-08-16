// 渲染 docs/screenshots/banner.html 并截图为 banner.png
// 用法：node_modules/electron/dist/electron.exe scripts/banner-shot.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const W = 1280, H = 400;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots', 'banner.png');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'docs', 'screenshots', 'banner.html'));
  await new Promise((r) => setTimeout(r, 1200));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, img.toPNG());
  console.log('banner saved:', OUT);
  app.quit();
});
