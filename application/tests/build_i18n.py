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

strings = rows("tests/i18n_strings.txt", 3)
codes = rows("tests/i18n_codes.txt", 4)
dup = [k for k in {r[0] for r in strings} if sum(1 for r in strings if r[0] == k) > 1]
if dup: print("Doublons (dernière valeur conservée) :", dup)

js = ("<script>\n\"use strict\";\n/* Fichier généré par tests/build_i18n.py — ne pas modifier à la main.\n   Clés = texte français ; codes de statut préfixés « st. ». */\n(function () {\n"
      "  const R = " + json.dumps(strings, ensure_ascii=False) + ";\n"
      "  R.forEach(function (r) { I18N.en[r[0]] = r[1]; I18N.ar[r[0]] = r[2]; });\n"
      "  const C = " + json.dumps(codes, ensure_ascii=False) + ";\n"
      "  C.forEach(function (c) { const k = \"st.\" + c[0]; I18N.fr[k] = c[1]; I18N.en[k] = c[2]; I18N.ar[k] = c[3]; });\n"
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
