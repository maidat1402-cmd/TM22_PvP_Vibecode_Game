// Log JSON theo dòng, tối đa ba tệp 4 MiB cho mỗi phiên chạy.
import fs from 'node:fs';
import path from 'node:path';

const LIMIT = 4 * 1024 * 1024;
let directory, prefix, stream, part = 0, bytes = 0, blocked = false, dropped = 0;

export function startServerLog(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    directory = dir;
    prefix = 'chibi-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
    return openPart();
  } catch (error) {
    console.error('[log]', error.code || error.name);
    return null;
  }
}

function openPart() {
  const file = path.join(directory, prefix + '-' + part + '.jsonl');
  const output = fs.createWriteStream(file, { flags: 'w' });
  stream = output;
  bytes = 0;
  output.on('drain', () => { if (stream === output) blocked = false; });
  output.on('error', error => {
    console.error('[log]', error.code || error.name);
    if (stream === output) stream = null;
  });
  return file;
}

export function logEvent(event, details = {}) {
  if (!stream) return;
  if (blocked) { dropped++; return; }
  const line = JSON.stringify({ time: new Date().toISOString(), event, ...details, ...(dropped ? { logDropped: dropped } : {}) }) + '\n';
  dropped = 0;
  const length = Buffer.byteLength(line);
  if (bytes + length > LIMIT) {
    stream.end();
    part = (part + 1) % 3;
    openPart();
  }
  bytes += length;
  blocked = !stream.write(line);
}

export function logError(event, error, details = {}) {
  logEvent(event, { ...details, name: error.name, code: error.code, stack: error.stack?.split('\n').slice(1, 7) });
}

// Ghi đồng bộ riêng cho lỗi làm tiến trình thoát, vì stream có thể chưa kịp ghi.
export function logFatal(error, origin) {
  try {
    const file = path.join(directory, prefix + '-fatal.jsonl');
    fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), event: 'fatal_error', origin,
      name: error.name, code: error.code, stack: error.stack?.split('\n').slice(1, 7) }) + '\n');
  } catch (writeError) { console.error('[log]', writeError.code || writeError.name); }
}

export function closeServerLog() {
  const output = stream;
  stream = null;
  if (!output) return Promise.resolve();
  return new Promise(resolve => {
    const fallback = setTimeout(resolve, 1000);
    output.end(() => { clearTimeout(fallback); resolve(); });
  });
}
