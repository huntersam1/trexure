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

  /* ---- demo carousel ---- */
  var demo = document.querySelector(".demo-carousel");
  if (demo) {
    var demoTabs = Array.prototype.slice.call(demo.querySelectorAll(".demo-tab"));
    var demoSlides = Array.prototype.slice.call(demo.querySelectorAll(".demo-slide"));
    var demoPrev = demo.querySelector(".demo-prev");
    var demoNext = demo.querySelector(".demo-next");
    var demoTrack = demo.querySelector(".demo-track");
    var demoCur = 0;

    function thumbMarkup(id) {
      return (
        '<img class="demo-thumb" src="https://img.youtube.com/vi/' + id + '/maxresdefault.jpg" ' +
        'onerror="this.onerror=null;this.src=\'https://img.youtube.com/vi/' + id + '/hqdefault.jpg\'" ' +
        'alt="" loading="lazy" />' +
        '<button class="demo-play" type="button" aria-label="Play demo">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>'
      );
    }

    function resetVideos() {
      demoSlides.forEach(function (s) {
        var frame = s.querySelector(".demo-frame");
        if (frame && frame.getAttribute("data-playing") === "1") {
          frame.removeAttribute("data-playing");
          frame.innerHTML = thumbMarkup(s.getAttribute("data-video"));
        }
      });
    }

    function showDemo(i) {
      i = (i + demoSlides.length) % demoSlides.length;
      resetVideos();
      demoCur = i;
      demoSlides.forEach(function (s, n) { s.classList.toggle("is-active", n === i); });
      demoTabs.forEach(function (t, n) {
        var on = n === i;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    demoTabs.forEach(function (t) {
      t.addEventListener("click", function () {
        showDemo(parseInt(t.getAttribute("data-i"), 10) || 0);
      });
    });
    if (demoPrev) demoPrev.addEventListener("click", function () { showDemo(demoCur - 1); });
    if (demoNext) demoNext.addEventListener("click", function () { showDemo(demoCur + 1); });

    if (demoTrack) {
      demoTrack.addEventListener("click", function (e) {
        var btn = e.target.closest && e.target.closest(".demo-play");
        if (!btn) return;
        var slide = btn.closest(".demo-slide");
        var id = slide && slide.getAttribute("data-video");
        var frame = slide && slide.querySelector(".demo-frame");
        if (!frame || !id) return;
        frame.setAttribute("data-playing", "1");
        frame.innerHTML =
          '<iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0" ' +
          'title="Trexure demo" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
          'allowfullscreen></iframe>';
      });
    }
  }
})();