"""Génère I18n.html à partir de tests/i18n_strings.txt et tests/i18n_codes.txt, et contrôle la couverture des traductions.
Usage : python3 tests/build_i18n.py   (depuis la racine du projet)"""
import json, re, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def rows(path, n):
    out = []
    for i, line in enumerate(open(os.path.join(ROOT, path), encoding="utf8"), 1):
        line = line.rstrip("\n")
        if not line or line.startswith("#"): continue
        parts = line.split("|")
        if len(parts) != n: sys.exit(f"{path}:{i} : {len(parts)} colonnes au lieu de {n} -> {line[:80]}")
        out.append(parts)
    return out

LANGS = ["en", "ar", "es", "it", "nl"]  # le français est la clé
strings = rows("tests/i18n_strings.txt", 1 + len(LANGS))
codes = rows("tests/i18n_codes.txt", 2 + len(LANGS))
empty = [(r[0], LANGS[j]) for r in strings for j, v in enumerate(r[1:]) if not v.strip()] + [(c[0], LANGS[j]) for c in codes for j, v in enumerate(c[2:]) if not v.strip()]
if empty: sys.exit("Traductions vides : " + repr(empty[:20]))
dup = [k for k in {r[0] for r in strings} if sum(1 for r in strings if r[0] == k) > 1]
if dup: print("Doublons (dernière valeur conservée) :", dup)

js = ("<script>\n\"use strict\";\n/* Fichier généré par tests/build_i18n.py — ne pas modifier à la main.\n   Clés = texte français ; codes de statut préfixés « st. ». */\n(function () {\n"
      "  const R = " + json.dumps(strings, ensure_ascii=False) + ";\n"
      "  const L = " + json.dumps(LANGS) + ";\n"
      "  R.forEach(function (r) { L.forEach(function (l, i) { I18N[l][r[0]] = r[i + 1]; }); });\n"
      "  const C = " + json.dumps(codes, ensure_ascii=False) + ";\n"
      "  C.forEach(function (c) { const k = \"st.\" + c[0]; I18N.fr[k] = c[1]; L.forEach(function (l, i) { I18N[l][k] = c[i + 2]; }); });\n"
      "})();\n</script>\n")
open(os.path.join(ROOT, "I18n.html"), "w", encoding="utf8").write(js)

# Couverture : chaînes affichées dans l'interface sans traduction
src = "".join(open(os.path.join(ROOT, f), encoding="utf8").read() for f in ["Components.html", "Login.html", "Scripts.html", "Dashboard.html", "Pages.html", "Assistant.html"])
found = set()
for p in [r'\bt\(\s*"((?:[^"\\]|\\.)*)"', r'\b(?:l|label|g|title|empty|help|intro|success|submitLabel)\s*:\s*"((?:[^"\\]|\\.)*)"', r'\bpanel\(\s*"((?:[^"\\]|\\.)*)"', r'\bkv\(\[\s*\[\s*"((?:[^"\\]|\\.)*)"', r'\]\s*,\s*\[\s*"((?:[^"\\]|\\.)*)"\s*,']:
    for m in re.finditer(p, src):
        s = m.group(1)
        if re.fullmatch(r"[A-Z_0-9.]+|[a-z0-9]{1,3}|[\W\d]*", s) or s in ("list", "cards", "map", "month", "prev", "equipment", "Bonjour"): continue
        found.add(s)
known = {r[0] for r in strings}
missing = sorted(s for s in found if s not in known and not re.fullmatch(r"[a-z]+", s))
codes_known = {c[0] for c in codes}
print(f"I18n.html généré : {len(strings)} chaînes, {len(codes)} codes. Chaînes d'interface sans traduction : {len(missing)}")
for s in missing: print("  -", s)
json.dump({"strings": len(strings), "codes": len(codes), "missing": missing}, open(os.path.join(ROOT, "tests", "i18n_report.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
