"""
Navigation dans un cadre « façon Google » (Chromium réel, Playwright).

L'application est chargée dans un iframe sandboxé, avec <base target="_top"> et un google.script.history simulé
(voir tests/preview-server.js, route /frame). On vérifie que les clics sur le menu et sur les liens internes
restent dans l'application (pas de page blanche) et que le bouton Retour fonctionne.

Usage : lancer d'abord   NODE_PATH=<node_modules avec chart.js et leaflet> node tests/preview-server.js 8787
        puis              python3 tests/frame-nav-test.py
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

BASE = "http://localhost:8787"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
results = []

def check(name, cond, detail=""):
    results.append({"test": name, "ok": bool(cond), "detail": detail})

async def app_frame(page):
    for _ in range(50):
        f = page.frame(url=lambda u: "gas=1" in u)
        if f:
            return f
        await page.wait_for_timeout(100)
    raise RuntimeError("cadre de l'application introuvable")

async def title(f):
    return (await f.locator("#page-title").text_content() or "").strip()

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path=CHROME)

        # 1. Contrôle : un lien « # » non intercepté provoque bien une navigation de la page entière dans ce cadre
        #    (c'est le mécanisme de la page blanche).
        pg = await br.new_page()
        await pg.goto(BASE + "/frame?as=superA"); f = await app_frame(pg); await pg.wait_for_timeout(3000)
        await f.evaluate("""() => { const a = document.createElement('a'); a.href = '#reports'; a.id = 'raw'; a.textContent = 'x';
                                    a.addEventListener('click', e => e.stopPropagation()); document.body.appendChild(a); }""")
        await f.click("#raw"); await pg.wait_for_timeout(1500)
        check("Contrôle : lien brut « #reports » → la page entière quitte l'application (page blanche)", "/frame" not in pg.url, pg.url)
        await pg.close()

        # 2. Super administrateur : menu « Rapports »
        pg = await br.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE + "/frame?as=superA"); f = await app_frame(pg); await pg.wait_for_timeout(3000)
        await f.click('a[data-r="reports"]'); await pg.wait_for_timeout(3000)
        check("Super administrateur › Rapports : reste dans l'application", "/frame" in pg.url, pg.url)
        check("Super administrateur › Rapports : page Rapports affichée", await title(f) == "Rapports", await title(f))
        check("Super administrateur › Rapports : rapport chargé (synthèse affichée)", "Synthèse" in (await f.locator("#content").inner_text()))
        check("Historique Google alimenté", "reports" in await f.evaluate("window.__histLog"), str(await f.evaluate("window.__histLog")))
        for r in ["users", "subscriptions", "admin", "audit", "notifications", "settings", "dashboard"]:
            await f.click(f'a[data-r="{r}"]'); await pg.wait_for_timeout(1500)
            check(f"Super administrateur › menu « {r} » : reste dans l'application", "/frame" in pg.url and await title(f) != "", await title(f))
        await f.evaluate("window.__histBack('reports')"); await pg.wait_for_timeout(2500)
        check("Bouton Retour (google.script.history) : retour sur Rapports", await title(f) == "Rapports", await title(f))
        check("Aucune erreur JavaScript (super administrateur)", not errs, "; ".join(errs[:3]))
        await pg.close()

        # 3. Propriétaire : menu, puis lien vers une fiche de bien
        pg = await br.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE + "/frame?as=ownerA"); f = await app_frame(pg); await pg.wait_for_timeout(3000)
        for r in ["properties", "reservations", "finance", "reports", "pareto", "incidents", "leases"]:
            await f.click(f'a[data-r="{r}"]'); await pg.wait_for_timeout(1800)
            check(f"Propriétaire › menu « {r} » : reste dans l'application", "/frame" in pg.url and await title(f) != "", await title(f))
        await f.click('a[data-r="properties"]'); await pg.wait_for_timeout(2000)
        link = f.locator('#content a[href^="#property/"]').first
        if await link.count():
            await link.click(); await pg.wait_for_timeout(2500)
            check("Propriétaire › lien vers une fiche de bien : fiche ouverte dans l'application", "/frame" in pg.url and "property/" in (await f.evaluate("S.route")), await f.evaluate("S.route"))
        else:
            await f.locator("#content .card, #content tr").nth(1).click(); await pg.wait_for_timeout(2500)
            check("Propriétaire › ouverture d'une fiche de bien : dans l'application", "/frame" in pg.url and "property/" in (await f.evaluate("S.route")), await f.evaluate("S.route"))
        check("Aucune erreur JavaScript (propriétaire)", not errs, "; ".join(errs[:3]))
        await pg.close()
        await br.close()

    ok = all(r["ok"] for r in results)
    for r in results:
        print(("  ✔ " if r["ok"] else "  ✘ ") + r["test"] + ("" if r["ok"] else "  — " + str(r["detail"])))
    print("\nRésultat : %d/%d" % (sum(r["ok"] for r in results), len(results)))
    json.dump(results, open(__file__.replace("frame-nav-test.py", "frame-nav-results.json"), "w"), ensure_ascii=False, indent=2)
    sys.exit(0 if ok else 1)

asyncio.run(main())
