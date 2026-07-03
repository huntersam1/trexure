/* Trexure — homepage interactions */
(function () {
  "use strict";

  /* ---- sticky nav state ---- */
  var nav = document.querySelector(".nav");
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle("scrolled", window.scrollY > 12);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- mobile nav ---- */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("open");
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---- scroll reveal ---- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---- legal TOC active highlight ---- */
  var tocLinks = document.querySelectorAll(".toc a");
  var heads = document.querySelectorAll(".prose h2");
  if (tocLinks.length && heads.length && "IntersectionObserver" in window) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            var id = e.target.getAttribute("id");
            tocLinks.forEach(function (l) {
              l.classList.toggle("active", l.getAttribute("href") === "#" + id);
            });
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    heads.forEach(function (h) { spy.observe(h); });
  }

  /* ---- cookie consent ---- */
  var KEY = "trexure_cookie_consent";
  var banner = document.querySelector(".cookie");
  if (banner) {
    var choice = null;
    try { choice = localStorage.getItem(KEY); } catch (e) {}
    if (!choice) {
      setTimeout(function () { banner.classList.add("show"); }, 900);
    }
    var accept = banner.querySelector(".cookie-accept");
    var decline = banner.querySelector(".cookie-decline");
    function close() { banner.classList.remove("show"); setTimeout(function(){ banner.style.display = "none"; }, 500); }
    if (accept) accept.addEventListener("click", function () {
      try { localStorage.setItem(KEY, "accepted"); } catch (e) {}
      close();
    });
    if (decline) decline.addEventListener("click", function () {
      try { localStorage.setItem(KEY, "declined"); } catch (e) {}
      close();
    });
  }
})();