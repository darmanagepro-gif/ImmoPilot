#!/usr/bin/env node
/**
 * Test de charge et de stabilité DarPilot (sans dépendance).
 * À lancer sur le serveur contre une INSTANCE TEMPORAIRE (copie de la démo), jamais contre les instances clientes.
 *
 *   node loadtest.js --url http://127.0.0.1:8099 --steps 1,5,10,25,50,100,200 --step-seconds 20 --soak 300 --soak-users 25 --pid 1234 --out res.json
 *
 * Chaque utilisateur virtuel a sa propre adresse IP simulée (X-Forwarded-For) : il est traité comme une personne distincte.
 * Scénario de lecture réaliste (tableau de bord, biens, réservations, notifications…) via des sessions de démonstration,
 * puis un palier « connexions » (calcul du mot de passe à 600 000 itérations) et un test d'endurance.
 */
"use strict";
const http = require("http"), fs = require("fs");
const A = {}; process.argv.slice(2).forEach(function (x, i, arr) { if (x.indexOf("--") === 0) A[x.slice(2)] = arr[i + 1]; });
const URL0 = new URL(A.url || "http://127.0.0.1:8099");
const STEPS = String(A.steps || "1,5,10,25,50,100,200").split(",").map(Number);
const STEP_S = Number(A["step-seconds"] || 20), SOAK_S = Number(A.soak || 300), SOAK_U = Number(A["soak-users"] || 25);
const LOGIN_U = Number(A["login-users"] || 10), LOGIN_S = Number(A["login-seconds"] || 20);
const PID = A.pid ? Number(A.pid) : 0;
const agent = new http.Agent({ keepAlive: true, maxSockets: 1000 });
const READS = ["me.boot", "dash.get", "property.list", "resv.list", "notif.list", "lease.list", "inv.list", "wo.list"];

let ipSeq = 0;
function newIp() { ipSeq++; return "10." + ((ipSeq >> 16) & 255) + "." + ((ipSeq >> 8) & 255) + "." + (ipSeq & 255); }
function rpc(ip, fn, args) {
  return new Promise(function (resolve) {
    const body = JSON.stringify({ fn: fn, args: args }), t0 = process.hrtime.bigint();
    const req = http.request({ host: URL0.hostname, port: URL0.port, path: "/rpc", method: "POST", agent: agent, timeout: 30000,
      headers: { "Content-Type": "application/json", "X-ImmoPilot": "1", "X-Forwarded-For": ip, "Content-Length": Buffer.byteLength(body) } }, function (res) {
      let b = ""; res.on("data", function (c) { b += c; });
      res.on("end", function () {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6; let j = null; try { j = JSON.parse(b); } catch (e) { j = null; }
        resolve({ ms: ms, status: res.statusCode, ok: res.statusCode === 200 && j && (j.ok === true || j.token), data: j });
      });
    });
    req.on("timeout", function () { req.destroy(new Error("timeout")); });
    req.on("error", function (e) { resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: 0, ok: false, err: e.message }); });
    req.end(body);
  });
}
function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort(function (x, y) { return x - y; }); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); }
function procSample() {
  const o = { load1: Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0]) };
  const mi = fs.readFileSync("/proc/meminfo", "utf8"); o.memAvailMB = Math.round(Number((/MemAvailable:\s+(\d+)/.exec(mi) || [])[1] || 0) / 1024);
  if (PID) { try { const st = fs.readFileSync("/proc/" + PID + "/status", "utf8"); o.rssMB = Math.round(Number((/VmRSS:\s+(\d+)/.exec(st) || [])[1] || 0) / 1024);
    const s = fs.readFileSync("/proc/" + PID + "/stat", "utf8").split(") ")[1].split(" "); o.cpuTicks = Number(s[11]) + Number(s[12]); } catch (e) { o.dead = true; } }
  return o;
}

async function views() {
  const r = await rpc(newIp(), "apiPublic", ["demo.views", {}]);
  const list = (r.data && r.data.data && (r.data.data.views || r.data.data)) || [];
  const ids = (Array.isArray(list) ? list : []).filter(function (v) { return v && v.available !== false; }).map(function (v) { return v.id; });
  if (!ids.length) throw new Error("Aucune vue de démonstration disponible : " + JSON.stringify(r.data).slice(0, 300));
  return ids;
}

/** Palier : N utilisateurs simultanés qui enchaînent les lectures sans pause pendant `secs` secondes. */
async function stage(n, secs, viewIds, label) {
  const lat = [], errs = {}; let ok = 0, ko = 0, sessionsKo = 0;
  const s0 = procSample(), t0 = Date.now(), stopAt = t0 + secs * 1000, samples = [];
  const timer = setInterval(function () { samples.push(procSample()); }, 1000);
  await Promise.all(Array.from({ length: n }, async function (_, i) {
    const ip = newIp();
    const e = await rpc(ip, "apiPublic", ["demo.enter", { view: viewIds[i % viewIds.length] }]);
    const tok = e.data && e.data.data && e.data.data.token;
    if (!tok) { sessionsKo++; errs["session: " + (e.err || (e.data && e.data.data && e.data.data.error) || (e.data && e.data.error && e.data.error.code) || e.status)] = (errs["session"] || 0) + 1; return; }
    let k = i;
    while (Date.now() < stopAt) {
      const route = READS[k++ % READS.length];
      const r = await rpc(ip, "api", [tok, route, {}]);
      lat.push(r.ms);
      if (r.ok) ok++; else { ko++; const key = r.err || (r.data && r.data.error && r.data.error.code) || ("HTTP " + r.status); errs[key] = (errs[key] || 0) + 1; }
    }
  }));
  clearInterval(timer);
  const dur = (Date.now() - t0) / 1000, s1 = procSample();
  const cpu = PID && s1.cpuTicks != null && s0.cpuTicks != null ? Math.round((s1.cpuTicks - s0.cpuTicks) / 100 / dur * 100) : null;
  const res = { label: label || (n + " utilisateurs"), users: n, seconds: Math.round(dur), requests: ok + ko, ok: ok, errors: ko, sessionErrors: sessionsKo,
    errorRate: ok + ko ? Math.round(ko / (ok + ko) * 10000) / 100 : 0, rps: Math.round((ok + ko) / dur * 10) / 10,
    p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: Math.round(Math.max.apply(null, lat.concat([0]))), cpuPct: cpu,
    rssMB: Math.max.apply(null, samples.map(function (x) { return x.rssMB || 0; }).concat([s1.rssMB || 0])),
    load1: Math.max.apply(null, samples.map(function (x) { return x.load1; }).concat([s1.load1])),
    memAvailMinMB: Math.min.apply(null, samples.map(function (x) { return x.memAvailMB; }).concat([s1.memAvailMB])), errorsDetail: errs, processDied: !!s1.dead };
  console.error(JSON.stringify(res));
  return res;
}

/** Connexions : chaque tentative calcule le mot de passe (PBKDF2 600 000) — c'est l'opération la plus coûteuse du serveur. */
async function loginStage(n, secs) {
  const lat = []; let done = 0, other = 0; const t0 = Date.now(), stopAt = t0 + secs * 1000;
  await Promise.all(Array.from({ length: n }, async function (_, i) {
    let k = 0;
    while (Date.now() < stopAt) {
      const r = await rpc(newIp(), "apiPublic", ["auth.login", { email: "charge" + i + "-" + (k++) + "@example.test", password: "MotDePasse2026x" }]);
      lat.push(r.ms);
      const code = r.data && r.data.error && r.data.error.code;
      if (code === "AUTH") done++; else other++; // AUTH = mot de passe vérifié (compte inexistant) : traitement complet
    }
  }));
  const dur = (Date.now() - t0) / 1000;
  const res = { label: "Connexions (" + n + " en parallèle)", users: n, seconds: Math.round(dur), logins: done, unexpected: other, loginsPerSec: Math.round(done / dur * 10) / 10, p50: pct(lat, 50), p95: pct(lat, 95), max: Math.round(Math.max.apply(null, lat.concat([0]))) };
  console.error(JSON.stringify(res));
  return res;
}

(async function main() {
  const out = { startedAt: new Date().toISOString(), url: URL0.href, cpus: require("os").cpus().length, memTotalMB: Math.round(require("os").totalmem() / 1048576), steps: [], login: null, soak: null };
  const ids = await views();
  out.views = ids;
  for (const n of STEPS) {
    const r = await stage(n, STEP_S, ids);
    out.steps.push(r);
    if (r.processDied || r.errorRate > 50) { out.stoppedEarly = "arrêt du palier " + n + " (erreurs " + r.errorRate + " %)"; break; }
  }
  out.login = await loginStage(LOGIN_U, LOGIN_S);
  if (SOAK_S > 0) {
    // Endurance : charge modérée prolongée, découpée en tranches pour voir une éventuelle dérive (mémoire, lenteur).
    const slices = [], per = Math.max(30, Math.round(SOAK_S / 5));
    for (let t = 0; t < SOAK_S; t += per) slices.push(await stage(SOAK_U, per, ids, "Endurance " + SOAK_U + " utilisateurs, tranche " + (slices.length + 1)));
    out.soak = slices;
  }
  out.finishedAt = new Date().toISOString();
  const txt = JSON.stringify(out, null, 1);
  if (A.out) fs.writeFileSync(A.out, txt); else console.log(txt);
  agent.destroy();
})().catch(function (e) { console.error("ECHEC : " + e.message); process.exit(1); });
