/** Requête HTTPS appelée de façon synchrone par gas-runtime.js (UrlFetchApp) : lit la requête en JSON sur l'entrée standard. */
"use strict";
let input = "";
process.stdin.on("data", function (c) { input += c; });
process.stdin.on("end", async function () {
  try {
    const r = JSON.parse(input);
    if (!/^https:\/\//.test(r.url)) throw new Error("Seules les adresses https:// sont autorisées.");
    const res = await fetch(r.url, { method: r.method || "GET", headers: r.headers || {}, body: r.body === null ? undefined : r.body, signal: AbortSignal.timeout(60000) });
    const headers = {}; res.headers.forEach(function (v, k) { headers[k] = v; });
    process.stdout.write(JSON.stringify({ status: res.status, text: await res.text(), headers: headers }));
  } catch (e) { process.stdout.write(JSON.stringify({ error: String(e && e.message || e) })); }
});
