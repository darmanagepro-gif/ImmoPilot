/* Mini-environnement « Node » pour exécuter le simulateur Apps Script (tests/gas-mock.js) dans un navigateur :
   Buffer, crypto (SHA-256, MD5, HMAC, aléa) et zlib (sans compression). Aucun accès réseau, aucun stockage. */
(function (G) {
  "use strict";
  var enc = new TextEncoder(), dec = new TextDecoder("utf-8");
  function toBin(u8) { var s = ""; for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; }
  function B(x) { return new BufferCls(x); }
  class BufferCls extends Uint8Array {
    static from(v, e) {
      if (typeof v === "string") {
        if (e === "base64") { var bin = atob(v.replace(/[\r\n\s]/g, "")), o = new BufferCls(bin.length); for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
        if (e === "hex") { var h = new BufferCls(v.length >> 1); for (var j = 0; j < h.length; j++) h[j] = parseInt(v.substr(j * 2, 2), 16); return h; }
        var u = enc.encode(v), r = new BufferCls(u.length); r.set(u); return r;
      }
      var a = new BufferCls(v.length); for (var k = 0; k < v.length; k++) a[k] = v[k]; return a;
    }
    static concat(list) { var n = 0; list.forEach(function (b) { n += b.length; }); var o = new BufferCls(n), p = 0; list.forEach(function (b) { o.set(b, p); p += b.length; }); return o; }
    static byteLength(s) { return enc.encode(String(s)).length; }
    toString(e) {
      if (e === "hex") { var s = ""; for (var i = 0; i < this.length; i++) s += (this[i] < 16 ? "0" : "") + this[i].toString(16); return s; }
      if (e === "base64") return btoa(toBin(this));
      return dec.decode(this);
    }
  }
  G.Buffer = BufferCls;

  /* ---- SHA-256 / MD5 synchrones ---- */
  var K256 = (function () { var k = [], n = 2; while (k.length < 64) { var p = true; for (var d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) k.push(Math.floor((Math.cbrt(n) % 1) * 4294967296)); n++; } return new Uint32Array(k); })();
  var H256 = (function () { var h = [], n = 2; while (h.length < 8) { var p = true; for (var d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) h.push(Math.floor((Math.sqrt(n) % 1) * 4294967296)); n++; } return h; })();
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256(data) {
    var len = data.length, nb = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(nb); m.set(data); m[len] = 0x80;
    var dv = new DataView(m.buffer); dv.setUint32(nb - 8, Math.floor(len / 536870912)); dv.setUint32(nb - 4, (len << 3) >>> 0);
    var h = new Uint32Array(H256), w = new Uint32Array(64);
    for (var off = 0; off < nb; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) { var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K256[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    var out = new BufferCls(32), o = new DataView(out.buffer); for (i = 0; i < 8; i++) o.setUint32(i * 4, h[i]); return out;
  }
  var KMD5 = (function () { var k = []; for (var i = 0; i < 64; i++) k.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0); return k; })();
  var SMD5 = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  function md5(data) {
    var len = data.length, nb = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(nb); m.set(data); m[len] = 0x80;
    var dv = new DataView(m.buffer); dv.setUint32(nb - 8, (len << 3) >>> 0, true); dv.setUint32(nb - 4, Math.floor(len / 536870912), true);
    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (var off = 0; off < nb; off += 64) {
      var M = new Uint32Array(16); for (var i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
      var A = a0, Bv = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (Bv & C) | (~Bv & D); g = i; } else if (i < 32) { F = (D & Bv) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = Bv ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (Bv | ~D); g = (7 * i) % 16; }
        F = (F + A + KMD5[i] + M[g]) | 0; A = D; D = C; C = Bv; Bv = (Bv + ((F << SMD5[i]) | (F >>> (32 - SMD5[i])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + Bv) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = new BufferCls(16), o = new DataView(out.buffer); o.setUint32(0, a0, true); o.setUint32(4, b0, true); o.setUint32(8, c0, true); o.setUint32(12, d0, true); return out;
  }
  function hashFn(alg) { if (alg === "sha256") return sha256; if (alg === "md5") return md5; throw new Error("Algorithme non pris en charge dans la démo : " + alg); }
  function hmac(alg, key, msg) {
    var H = hashFn(alg), k = key.length > 64 ? H(key) : key, ip = new Uint8Array(64 + msg.length), op = new Uint8Array(64 + (alg === "md5" ? 16 : 32));
    for (var i = 0; i < 64; i++) { var kb = i < k.length ? k[i] : 0; ip[i] = kb ^ 0x36; op[i] = kb ^ 0x5c; }
    ip.set(msg, 64); op.set(H(ip), 64); return H(op);
  }
  function rnd(n) { var u = new Uint8Array(n); (G.crypto || {}).getRandomValues ? G.crypto.getRandomValues(u) : u.forEach(function (_, i) { u[i] = Math.floor(Math.random() * 256); }); return BufferCls.from(u); }
  var cryptoShim = {
    randomBytes: rnd,
    randomUUID: function () { if (G.crypto && G.crypto.randomUUID) return G.crypto.randomUUID(); var b = rnd(16); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; var h = b.toString("hex"); return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20); },
    createHash: function (alg) { var parts = []; return { update: function (b) { parts.push(b); return this; }, digest: function () { return hashFn(alg)(BufferCls.concat(parts)); } }; },
    createHmac: function (alg, key) { var parts = []; return { update: function (b) { parts.push(b); return this; }, digest: function () { return hmac(alg, key, BufferCls.concat(parts)); } }; }
  };
  var zlibShim = { gzipSync: function (b) { return b; }, gunzipSync: function (b) { return b; } };
  G.__nodeShims = { crypto: cryptoShim, zlib: zlibShim, sha256: sha256, md5: md5, hmac: hmac };
  G.require = function (n) { if (n === "crypto") return cryptoShim; if (n === "zlib") return zlibShim; throw new Error("Module indisponible : " + n); };
  G.module = { exports: {} };
})(typeof window !== "undefined" ? window : globalThis);
