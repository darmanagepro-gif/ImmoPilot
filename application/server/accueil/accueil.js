(function () {
  "use strict";
  var box = document.getElementById("intro"), vid = document.getElementById("vid"), skip = document.getElementById("skip");
  var target = null, gone = false, started = false, timers = [];

  function go() {
    if (gone || !target) return;
    gone = true;
    timers.forEach(clearTimeout);
    location.href = target;
  }

  function play(kind, href) {
    target = href; gone = false; started = false;
    box.classList.add("on");
    requestAnimationFrame(function () { box.classList.add("show"); });
    box.setAttribute("aria-hidden", "false");
    skip.focus({ preventScroll: true });
    vid.src = "/intro-" + kind + ".mp4";
    vid.muted = false; // le clic autorise le son
    var p = vid.play();
    if (p && p.catch) p.catch(function () {
      vid.muted = true; // son refusé par le navigateur : on rejoue sans le son
      var q = vid.play();
      if (q && q.catch) q.catch(go); // lecture impossible : on ouvre directement l'application
    });
    // Sécurités : la vidéo ne démarre pas (réseau lent) ou se fige.
    timers.push(setTimeout(function () { if (!started) go(); }, 5000));
    timers.push(setTimeout(go, 16000));
  }

  vid.addEventListener("playing", function () { started = true; });
  vid.addEventListener("ended", go);
  vid.addEventListener("error", go);
  skip.addEventListener("click", go);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && box.classList.contains("on")) go(); });

  // Retour arrière depuis l'application : on réaffiche le choix, pas la vidéo figée.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) { box.classList.remove("on", "show"); try { vid.pause(); } catch (x) { /* rien */ } gone = false; }
  });

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  Array.prototype.forEach.call(document.querySelectorAll("a[data-intro]"), function (a) {
    a.addEventListener("click", function (e) {
      // Ouverture dans un nouvel onglet (Ctrl, Cmd, clic molette) ou animations désactivées : comportement normal.
      if (reduce || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      play(a.getAttribute("data-intro"), a.href);
    });
  });
})();
