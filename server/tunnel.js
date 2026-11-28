// Tạo đường hầm công khai (không cần mở port router) bằng cloudflared nếu có cài.
// https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function findCloudflared(root) {
  const local = path.join(root, 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  return fs.existsSync(local) ? local : 'cloudflared';
}

export function startTunnel(port, root, onEvent = () => {}) {
  return new Promise((resolve, reject) => {
    const bin = findCloudflared(root);
    let proc;
    try {
      proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return reject(e); }
    let done = false;
    const onData = buf => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(buf.toString());
      if (m && !done) { done = true; resolve({ url: m[0], close: () => proc.kill() }); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', err => {
      onEvent('tunnel_process_error', { code: err.code });
      if (!done) { done = true; reject(err); }
    });
    proc.on('exit', (code, signal) => {
      onEvent('tunnel_process_exit', { code, signal });
      if (!done) { done = true; reject(new Error('cloudflared thoát với mã ' + code)); }
    });
    setTimeout(() => { if (!done) { done = true; proc.kill(); reject(new Error('Hết thời gian chờ cloudflared')); } }, 30000);
  });
}
