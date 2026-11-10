// Starts the dev server so phones, tablets and other computers on the same Wi-Fi can open it.
//   npm run dev:lan            (port 3000)       PORT=3100 npm run dev:lan   (another port)
//
// It binds to every network interface, finds this PC's LAN address, and sets APP_ORIGIN to it for
// this run only (the app's same-origin check on writes needs it), without editing .env.local.
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const port = String(process.env.PORT || 3000);
if (!/^\d{2,5}$/.test(port)) { console.error(`Invalid PORT "${port}".`); process.exit(1); }

const VIRTUAL = /vethernet|virtualbox|vmware|wsl|loopback|bluetooth|docker|hyper-v|tailscale|zerotier/i;
const isPrivate = ip => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && isPrivate(a.address)) found.push({ name, ip: a.address });
  }
  // Wi-Fi / Ethernet first, 192.168 and 10.x before 172.16/12.
  return found.sort((x, y) => Number(/^172\./.test(x.ip)) - Number(/^172\./.test(y.ip)));
}

const addresses = lanAddresses();
if (!addresses.length) {
  console.error('No private network address found. Connect to Wi-Fi or Ethernet, then try again.');
  process.exit(1);
}
const primary = addresses[0];
const origin = `http://${primary.ip}:${port}`;

console.log('\n  AZ_AI on your local network\n');
for (const a of addresses) console.log(`  ${a === primary ? '->' : '  '} http://${a.ip}:${port}   (${a.name})`);
console.log(`\n  Open ${origin} on this PC AND on your phone or tablet (same Wi-Fi).`);
console.log('  Use that address on this PC too: writes are only accepted from the app\'s own origin.');
console.log('  First time: click "Allow" on the Windows Firewall prompt (Private networks).');
console.log('  Note: Stripe\'s card form needs HTTPS, so test payments on http://localhost:3000 instead.\n');

const env = {
  ...process.env,
  APP_ORIGIN: origin,
  AZ_DEV_LAN_HOSTS: addresses.map(a => a.ip).join(','), // next.config.mjs allows these dev origins
};
const next = spawn(process.execPath, [require.resolve('next/dist/bin/next', { paths: [root] }), 'dev', '--hostname', '0.0.0.0', '--port', port], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => next.kill(signal));
next.on('exit', code => process.exit(code ?? 0));
