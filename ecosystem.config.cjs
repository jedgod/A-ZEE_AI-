// PM2 process file for the price-alert worker ("Monitor this for me").  Use this on a server that keeps processes running.
//
//   pm2 start ecosystem.config.cjs      start it (it then calls the tick route every 2 minutes)
//   pm2 save && pm2 startup             keep it across reboots (run the command that `pm2 startup` prints)
//   pm2 logs aztrade-monitor-worker     see each cycle: {"ok":true,"evaluated":3,"triggered":1,"stale":0}
//
// It reads MONITOR_WORKER_SECRET from the environment or .env.local / .env, and calls the running web app at MONITOR_TICK_URL.
// Only one cycle ever runs at a time (a database lock), so a second copy is harmless but pointless: keep instances at 1.
//
// No always-on server? Skip PM2 and have any scheduler send this every 2 minutes (the header name matters):
//   curl -fsS -X POST "https://YOUR-DOMAIN/api/internal/monitor-tick" -H "x-worker-secret: $MONITOR_WORKER_SECRET"
// (GitHub Actions can do this too, but its shortest interval is 5 minutes and it can be delayed.)
module.exports = {
  apps: [{
    name: "aztrade-monitor-worker",
    script: "scripts/monitor-tick.cjs",
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "200M",
    env: { NODE_ENV: "production", MONITOR_TICK_URL: "http://127.0.0.1:3000" },
  }],
};
