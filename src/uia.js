'use strict';
// Client for tools/uia_server.ps1: one long-lived PowerShell that answers UI Automation queries in ~50 ms.
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

function scriptPath() {
  // inside a packaged app the .ps1 is unpacked next to app.asar (PowerShell cannot read from inside an asar)
  return path.join(__dirname, '..', 'tools', 'uia_server.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

class Uia {
  constructor(log) { this.log = log || (() => {}); this.proc = null; this.pending = new Map(); this.seq = 0; this.ready = null; }

  start() {
    if (this.proc) return this.ready;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath()], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdin.setDefaultEncoding('utf8');
    let resolveReady; this.ready = new Promise((r) => { resolveReady = r; });
    const rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      let m; try { m = JSON.parse(line.replace(/^﻿/, '')); } catch (_) { return; }
      if (m.ready) return resolveReady(true);
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); clearTimeout(p.t); p.resolve(m); }
    });
    this.proc.stderr.on('data', (d) => this.log('uia stderr: ' + String(d).slice(0, 200)));
    this.proc.on('exit', () => {
      this.proc = null; this.ready = null;
      for (const [, p] of this.pending) { clearTimeout(p.t); p.resolve({ found: false, reason: 'helper-exited' }); }
      this.pending.clear();
    });
    return this.ready;
  }

  async request(cmd, timeoutMs = 9000) {
    await this.start();
    if (!this.proc) return { found: false, reason: 'helper-down' };
    const id = ++this.seq;
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.pending.delete(id); resolve({ found: false, reason: 'timeout' }); }, timeoutMs);
      this.pending.set(id, { resolve, t });
      try { this.proc.stdin.write(JSON.stringify({ ...cmd, id }) + '\n'); } catch (_) { clearTimeout(t); this.pending.delete(id); resolve({ found: false, reason: 'write-failed' }); }
    });
  }

  stop() { try { if (this.proc) this.proc.kill(); } catch (_) { /* ignore */ } this.proc = null; }
}

module.exports = { Uia };
