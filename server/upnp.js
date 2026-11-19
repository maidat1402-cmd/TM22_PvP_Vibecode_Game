// Client UPnP-IGD tối giản (không cần thư viện ngoài): tự mở port trên router
// để người chơi từ xa (Internet) có thể kết nối vào máy chủ của bạn.
import dgram from 'node:dgram';
import os from 'node:os';

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const SERVICES = [
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];

function discover(timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const found = new Set();
    const msg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\nMX: 2\r\n' +
      'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n');
    sock.on('message', buf => {
      const m = /^location:\s*(.+)$/im.exec(buf.toString());
      if (m) found.add(m[1].trim());
    });
    sock.on('error', reject);
    sock.bind(() => {
      sock.send(msg, SSDP_PORT, SSDP_ADDR);
      setTimeout(() => sock.send(msg, SSDP_PORT, SSDP_ADDR), 500);
    });
    setTimeout(() => { sock.close(); resolve([...found]); }, timeoutMs);
  });
}

async function findControl(location) {
  const xml = await (await fetch(location)).text();
  for (const svc of SERVICES) {
    const idx = xml.indexOf(svc);
    if (idx < 0) continue;
    const after = xml.slice(idx);
    const m = /<controlURL>\s*([^<]+)\s*<\/controlURL>/i.exec(after);
    if (m) return { service: svc, url: new URL(m[1], location).toString() };
  }
  return null;
}

async function soap(ctrl, action, args = {}) {
  const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body><u:${action} xmlns:u="${ctrl.service}">${
  Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('')
}</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(ctrl.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${ctrl.service}#${action}"` },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${action} thất bại (${res.status}): ${(/<errorDescription>([^<]*)/.exec(text) || [])[1] || ''}`);
  return text;
}

// Chọn IP nội bộ cùng dải mạng với router
function localIpFor(host) {
  const nets = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal);
  const prefix = host.split('.').slice(0, 3).join('.');
  return (nets.find(n => n.address.startsWith(prefix)) || nets[0] || {}).address;
}

export async function openPort(port, description = 'ChibiClash') {
  const locations = await discover();
  if (!locations.length) throw new Error('Không tìm thấy router hỗ trợ UPnP (hãy bật UPnP trong trang quản trị router).');
  let lastErr;
  for (const loc of locations) {
    try {
      const ctrl = await findControl(loc);
      if (!ctrl) continue;
      const internal = localIpFor(new URL(loc).hostname);
      await soap(ctrl, 'AddPortMapping', {
        NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP', NewInternalPort: port,
        NewInternalClient: internal, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: 0,
      });
      let externalIp = null;
      try {
        const r = await soap(ctrl, 'GetExternalIPAddress');
        externalIp = (/<NewExternalIPAddress>([^<]*)/.exec(r) || [])[1] || null;
      } catch { /* bỏ qua */ }
      const close = async () => {
        try { await soap(ctrl, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' }); } catch { /* */ }
      };
      return { externalIp, internal, close };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Router không có dịch vụ WANIPConnection.');
}
