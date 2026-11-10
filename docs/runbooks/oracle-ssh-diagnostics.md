# Runbook: diagnose the Oracle E2 Micro SSH banner timeout (READ-ONLY)

Symptom (measured 2026-11-10, 3 + 2 attempts): TCP port 22 accepts in ~65-120 ms, but sshd sends **no SSH banner** within 12-15 s.
Use **your own authenticated OCI Console session** (Compute -> Instances -> the instance -> *Console connection* / *Run Command*). **Do not paste passwords, API keys,
private keys or tokens anywhere**, including to this assistant. Every command below only reads state. **Do not reboot, resize, rebuild or change anything** until a
separate approval; run the commands, copy the *output* (not credentials) back for analysis.

Run in this order. If *Run Command* is unavailable (it needs the Oracle Cloud Agent running, which may itself be starved), use the serial/VNC **Console connection**.

## 1. Is the machine alive and what is starving it?
```
date; uptime
free -m
cat /proc/pressure/memory /proc/pressure/cpu /proc/pressure/io 2>/dev/null
vmstat 1 5
ps -eo pid,ppid,stat,pcpu,pmem,rss,etime,comm --sort=-rss | head -15
df -hT / /boot /boot/efi 2>/dev/null
```
Look for: very low `available` memory, heavy swap (`si/so` in vmstat), `D`-state processes, any process with a large RSS, `/` at 100 %.

## 2. Was sshd or something else killed or stalled?
```
sudo dmesg -T | grep -i -E "out of memory|oom|killed process|segfault|i/o error|blocked for more than" | tail -20
sudo journalctl -k --since "-24h" -p warning | tail -30
sudo systemctl status sshd --no-pager -l | head -25
sudo journalctl -u sshd --since "-24h" --no-pager | tail -50
```
Look for OOM kills of `sshd`, `Server listening` lines missing after a restart, `error: kex_exchange_identification`, `Timeout before authentication`, `Could not get shadow information`, DNS lookups.

## 3. sshd configuration and listeners (no secrets are printed)
```
sudo sshd -T 2>/dev/null | grep -E "^(port|usedns|logingracetime|maxstartups|maxauthtries|passwordauthentication|permitrootlogin|clientaliveinterval|loglevel)"
sudo ss -tlnp | grep -E ":22\b"
sudo ss -tn state established '( sport = :22 )' | wc -l
sudo ss -tn state syn-recv '( sport = :22 )' | wc -l
```
`MaxStartups` exhaustion or hundreds of half-open/unauthenticated connections (brute-force noise) can also stop new banners. `UsedNS yes` plus a broken resolver makes the banner slow: check `cat /etc/resolv.conf` and `getent hosts one.one.one.one`.

## 4. Brute-force / connection flood check (counts only)
```
sudo journalctl -u sshd --since "-6h" --no-pager | grep -c -E "Failed password|Invalid user|Connection closed by .* \[preauth\]"
sudo journalctl -u sshd --since "-6h" --no-pager | grep -E "Failed password|Invalid user" | sed -E 's/.* from ([0-9.]+).*/\1/' | sort | uniq -c | sort -rn | head -5
```

## 5. cloud-init, firewall, boot logs
```
sudo cloud-init status --long
sudo tail -40 /var/log/cloud-init-output.log
sudo journalctl -b -p err --no-pager | tail -40
sudo systemctl --failed --no-pager
sudo firewall-cmd --state 2>/dev/null && sudo firewall-cmd --list-all
sudo iptables -S 2>/dev/null | head -30
getenforce 2>/dev/null
```

## 6. Network/agent state
```
ip -br addr; ip route; sudo ss -s
sudo systemctl status oracle-cloud-agent --no-pager 2>/dev/null | head -12
```

## 7. Host key fingerprints (this is what lets us trust the connection later)
```
for k in /etc/ssh/ssh_host_*_key.pub; do sudo ssh-keygen -lf "$k"; done
```
Send back only the lines like `256 SHA256:xxxxxxxx ... (ED25519)`. These are public fingerprints. We will pin the key on this PC **only if the fingerprint
offered over the network equals the console fingerprint**:
```
ssh-keyscan -t ed25519 148.116.82.70 > "$HOME/.ssh/azee-oracle.known_hosts"      # run only after sshd answers again
ssh-keygen -lf "$HOME/.ssh/azee-oracle.known_hosts"                                  # must equal the console value exactly
```
Then connect with `-o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/azee-oracle.known_hosts`.

## 8. How to read the outcome
| Finding | Likely fix (all need separate approval) |
|---|---|
| memory exhausted / OOM kills / heavy swap | stop the memory hog, add 2 GB swap, restart sshd; the E2 Micro (1 GB) is too small for this workload |
| sshd running but `MaxStartups`/flood | restrict port 22 in the OCI security list to your source address; lower `LoginGraceTime`; fail2ban |
| sshd slow on DNS | `UseDNS no`, fix `/etc/resolv.conf` |
| sshd not running / failed unit | read `journalctl -u sshd`, `sshd -t`, then start it |
| disk 100 % | free space (logs), then restart sshd |
| VM unresponsive in console too | soft reboot from the console, after your explicit approval |
