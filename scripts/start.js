// 启动脚本：删除 ELECTRON_RUN_AS_NODE（用户环境遗留，会导致 Electron 退化为纯 Node）后启动应用
const { spawn } = require('child_process');
const path = require('path');

delete process.env.ELECTRON_RUN_AS_NODE;

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: process.env, cwd: path.join(__dirname, '..') });

child.on('exit', (code) => process.exit(code ?? 0));
