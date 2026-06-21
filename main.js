document.addEventListener("DOMContentLoaded", () => {
  // Programmatically generate spiral rings and spine rings to keep HTML semantic and clean
  document.querySelectorAll(".spiral-rings-left").forEach(container => {
    container.innerHTML = Array(15).fill('<div class="ring-loop"></div>').join("");
  });
  document.querySelectorAll(".notebook-spine-rings").forEach(container => {
    container.innerHTML = Array(15).fill('<div class="spine-ring"></div>').join("");
  });

  // --- Pannable Canvas Logic ---
  const viewport = document.getElementById("viewport");
  const canvasArea = document.getElementById("canvas-area");

  let isDragging = false;
  let hasDragged = false;
  let startX, startY;
  let scrollLeft, scrollTop;
  let activeModel = null;
  let lastFocusedElement = null; // Voor focus-restore bij sluiten van panels

  const isMobile = () => window.innerWidth < 640;

  // Respect OS-level animation preference across all GSAP calls
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = (n) => prefersReducedMotion ? 0 : n;

  // Shared helper — used in both the focus animation and the close animation
  const parseOrbit = (str) => {
    const parts = str.trim().split(/\s+/);
    return { theta: parseFloat(parts[0]), phi: parseFloat(parts[1]), radius: parts[2] };
  };

  const modelsLayer = document.getElementById("models-layer");
  const overlay = document.querySelector(".glass-overlay");
  const blogPanel = document.getElementById("blog-panel");
  const blogPanelContent = document.getElementById("blog-panel-content");
  const closeButton = document.getElementById("close-blog-panel");
  const reflectionsNotebookContainer = document.getElementById("reflections-notebook-container");
  const closeReflectionsNotebookBtn = document.getElementById("close-reflections-notebook");

  // Spread overlay elements
  const spreadOverlay = document.getElementById("spread-overlay");
  const spreadMain = document.getElementById("spread-main");
  const spreadMainImg = document.getElementById("spread-main-img");
  const spreadRepoLink = document.getElementById("spread-repo-link");
  const spreadRepoContainer = document.getElementById("spread-repo-container");
  const closeSpreadBtn = document.getElementById("close-spread");

  // --- Dialog close button wiring ---
  if (closeButton) {
    closeButton.addEventListener("click", () => closeAllPanels());
  }

  if (closeSpreadBtn) {
    closeSpreadBtn.addEventListener("click", closeSpread);
  }

  // Close spread when clicking the dialog backdrop (outside the card)
  if (spreadOverlay) {
    spreadOverlay.addEventListener("click", (e) => {
      if (e.target === spreadOverlay) closeSpread();
    });
  }

  // Listen for Escape key to close active panels
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (spreadOverlay && spreadOverlay.classList.contains("active")) {
        closeSpread();
      } else if (notebookContainer && notebookContainer.classList.contains("open")) {
        closeNotebook();
      } else if (reflectionsNotebookContainer && reflectionsNotebookContainer.classList.contains("open")) {
        closeReflectionsNotebook();
      } else {
        closeAllPanels();
      }
    }
  });

  // Focus trap helper for keyboard users
  function handleFocusTrap(e, container) {
    if (e.key !== 'Tab') return;
    const focusables = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  }

  blogPanel?.addEventListener("keydown", (e) => handleFocusTrap(e, blogPanel));
  spreadOverlay?.addEventListener("keydown", (e) => handleFocusTrap(e, spreadOverlay));
  reflectionsNotebookContainer?.addEventListener("keydown", (e) => handleFocusTrap(e, reflectionsNotebookContainer));

  // Make viewport focusable for keyboard navigation
  viewport.setAttribute('tabindex', '0');
  viewport.setAttribute('aria-label', 'Pannable canvas – gebruik pijltjestoetsen om te navigeren');

  // Center starting position
  viewport.scrollLeft = (canvasArea.offsetWidth - viewport.clientWidth) / 2;
  viewport.scrollTop = (canvasArea.offsetHeight - viewport.clientHeight) / 2;

  // --- Keyboard navigation on the canvas ---
  viewport.addEventListener('keydown', (e) => {
    if (activeModel !== null) return; // Don't scroll while a model is focused
    const STEP = 160;
    const moves = {
      ArrowUp:    [0, -STEP],
      ArrowDown:  [0,  STEP],
      ArrowLeft:  [-STEP, 0],
      ArrowRight: [ STEP, 0],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      viewport.scrollBy({ left: dx, top: dy, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    }
  });

  function onPointerDown(e) {
    hasDragged = false;
    if (
      e.target.closest("a") !== null ||
      e.target.closest(".interactive-model-wrapper") !== null
    )
      return;
    if (activeModel !== null) return;

    isDragging = true;
    startX = e.pageX - viewport.offsetLeft;
    startY = e.pageY - viewport.offsetTop;
    scrollLeft = viewport.scrollLeft;
    scrollTop = viewport.scrollTop;
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    hasDragged = true;

    const x = e.pageX - viewport.offsetLeft;
    const y = e.pageY - viewport.offsetTop;
    const walkX = x - startX;
    const walkY = y - startY;

    viewport.scrollLeft = scrollLeft - walkX;
    viewport.scrollTop = scrollTop - walkY;
  }

  function onPointerUp() {
    isDragging = false;
  }

  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  // Allow diagonal scrolling with trackpad/mouse wheel
  // Source (APA format):
  // Google. (2026). Gemini 3.1 Pro (High) [Large language model].
  // (Conversation regarding overriding browser scroll axis-locking to enable freeform trackpad scrolling).
  viewport.addEventListener(
    "wheel",
    (e) => {
      if (activeModel !== null) return;
      e.preventDefault(); // Prevent browser's native axis-locking scroll
      viewport.scrollLeft += e.deltaX;
      viewport.scrollTop += e.deltaY;
    },
    { passive: false },
  );

  // --- 3D Model Focus / Apple Glass Effect Logic ---
  const modelWrappers = document.querySelectorAll(".interactive-model-wrapper");

  const loadModelIfNeeded = (viewer) => {
    if (!viewer || viewer.dataset.loaded === "true") return;
    const src = viewer.dataset.src;
    if (!src) return;
    viewer.setAttribute("src", src);
    viewer.dataset.loaded = "true";
  };

  // Lazy-load models when they (almost) enter the pannable viewport
  const modelObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) loadModelIfNeeded(entry.target);
      });
    },
    { root: viewport, rootMargin: "400px", threshold: 0.01 },
  );

  modelWrappers.forEach((wrapper) => {
    const viewer = wrapper.querySelector("model-viewer");
    if (viewer) modelObserver.observe(viewer);

    // Keyboard accessibility: trigger click when Enter or Space is pressed
    wrapper.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        wrapper.click();
      }
    });

    wrapper.addEventListener("click", (e) => {
      // Return early if dragging the background, or if this element is already focused
      if (hasDragged || activeModel === wrapper) return;

      // Remember where focus was so we can restore it on close
      lastFocusedElement = document.activeElement;

      activeModel = wrapper;

      overlay.classList.add("active");
      modelsLayer.classList.add("has-active-model");
      wrapper.classList.add("active"); // CSS handles z-index via .active rule
      viewport.classList.add("panel-open"); // CSS handles overflow: hidden

      const rect = wrapper.getBoundingClientRect();
      // Center position of screen
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      // Bereken offset t.o.v. de huidige positie op je scherm
      const dx = centerX - (rect.left + rect.width / 2);
      const dy = centerY - (rect.top + rect.height / 2);
      const activeOrbit = wrapper.dataset.activeOrbit || "100deg 0deg 90%";
      loadModelIfNeeded(viewer);
      viewer.removeAttribute("camera-controls");

      wrapper.dataset.gsapX = gsap.getProperty(wrapper, "x") || 0;
      wrapper.dataset.gsapY = gsap.getProperty(wrapper, "y") || 0;

      // Parse current and target orbit values to animate between them
      const currentOrbit =
        viewer.getAttribute("camera-orbit") || "0deg 75deg 105%";
      const fromOrbit = parseOrbit(currentOrbit);
      const toOrbit = parseOrbit(activeOrbit);
      const orbitProxy = { theta: fromOrbit.theta, phi: fromOrbit.phi };

      // Sweep naar het midden — op mobile omhoog schuiven, op desktop naar links
      const mobile = isMobile();

      gsap.to(wrapper, {
        x: parseFloat(wrapper.dataset.gsapX) + dx - (mobile ? 0 : 320),
        y:
          parseFloat(wrapper.dataset.gsapY) +
          dy -
          (mobile ? window.innerHeight * 0.34 : 0),
        width: mobile ? 180 : 352,
        height: mobile ? 270 : 528,
        duration: dur(1.2),
        ease: "power4.out",
      });

      // Animate camera orbit in sync with the wrapper movement
      gsap.to(orbitProxy, {
        theta: toOrbit.theta,
        phi: toOrbit.phi,
        duration: dur(1.2),
        ease: "power4.out",
        onUpdate: () => {
          viewer.setAttribute(
            "camera-orbit",
            `${orbitProxy.theta}deg ${orbitProxy.phi}deg ${toOrbit.radius}`,
          );
        },
      });

      // Show blog panel with template content
      const template = wrapper.querySelector(".blog-content-source");
      if (template) {
        blogPanelContent.innerHTML = ""; // Clear old content
        const clone = template.content.cloneNode(true);
        blogPanelContent.appendChild(clone);
        initializeTabs();
      }

      // Open the blog panel on the side by adding the active class
      blogPanel.classList.add("active");

      // Move focus into the panel for keyboard / screenreader users
      requestAnimationFrame(() => closeButton?.focus());
    });
  });

  // --- Dynamic Tab Initialization ---
  function initializeTabs(container = blogPanelContent) {
    const tabButtons = container.querySelectorAll(".tab-button");
    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        tabButtons.forEach((b) => b.classList.remove("active"));
        container.querySelectorAll(".tab-content").forEach((tc) => tc.classList.remove("active"));

        btn.classList.add("active");
        const tabId = btn.dataset.tab;
        const targetContent = container.querySelector(`#${tabId}`);
        if (targetContent) {
          targetContent.classList.add("active");
        }
      });
    });
  }

  // --- Paper click handlers & 3D Notebook Logic ---
  const paperScreenshots = document.querySelectorAll(".paper-screenshot");
  const notebookContainer = document.getElementById("notebook-container");
  const closeNotebookBtn = document.getElementById("close-notebook");

  function openNotebook() {
    if (!notebookContainer || notebookContainer.classList.contains("open")) return;

    notebookContainer.style.zIndex = "2000";
    notebookContainer.classList.add("open");

    // Open in place: expand width to the left (by shifting x by -350px) so the right half/spine remains stationary
    const mobile = isMobile();
    const targetW = mobile ? window.innerWidth * 0.9 : 700;
    const targetX = mobile ? 0 : -350;

    gsap.to(notebookContainer, {
      width: targetW,
      x: targetX,
      duration: dur(1.2),
      ease: "power4.out"
    });

    const frontCover = notebookContainer.querySelector(".notebook-cover-front");
    gsap.to(frontCover, {
      rotateY: -180,
      duration: dur(1.2),
      ease: "power4.out"
    });
  }

  function closeNotebook() {
    if (!notebookContainer || !notebookContainer.classList.contains("open")) return;

    gsap.to(notebookContainer, {
      width: 350,
      x: 0,
      duration: dur(1.0),
      ease: "power3.inOut",
      onComplete: () => {
        notebookContainer.classList.remove("open");
        notebookContainer.style.zIndex = "";
      }
    });

    const frontCover = notebookContainer.querySelector(".notebook-cover-front");
    gsap.to(frontCover, {
      rotateY: 0,
      duration: dur(1.0),
      ease: "power3.inOut"
    });

    const sheet1 = document.getElementById("notebook-sheet-1");
    
    if (sheet1) {
      gsap.to(sheet1, {
        rotateY: 0,
        duration: dur(0.8),
        ease: "power2.inOut",
        onComplete: () => {
          sheet1.classList.remove("flipped");
        }
      });
    }
  }

  if (closeNotebookBtn) {
    closeNotebookBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeNotebook();
    });
  }

  // --- Page Flipping Listeners ---
  const sheet1 = document.getElementById("notebook-sheet-1");

  if (sheet1) {
    const s1Front = sheet1.querySelector(".sheet-front");
    const s1Back = sheet1.querySelector(".sheet-back");

    if (s1Front) {
      s1Front.addEventListener("click", (e) => {
        if (isMobile() || hasDragged) return;
        e.stopPropagation();
        
        gsap.to(sheet1, {
          rotateY: -180,
          duration: dur(0.8),
          ease: "power2.out",
          onStart: () => {
            sheet1.classList.add("flipped");
          }
        });
      });
    }

    if (s1Back) {
      s1Back.addEventListener("click", (e) => {
        if (isMobile() || hasDragged) return;
        e.stopPropagation();

        gsap.to(sheet1, {
          rotateY: 0,
          duration: dur(0.8),
          ease: "power2.out",
          onComplete: () => {
            sheet1.classList.remove("flipped");
          }
        });
      });
    }
  }

  // --- Reflections Notebook Logic ---
  function openReflectionsNotebook() {
    if (!reflectionsNotebookContainer || reflectionsNotebookContainer.classList.contains("open")) return;

    // Save focus position for restore on close
    lastFocusedElement = document.activeElement;

    reflectionsNotebookContainer.style.zIndex = "2000";
    reflectionsNotebookContainer.classList.add("open");

    const mobile = isMobile();
    const targetW = mobile ? window.innerWidth * 0.9 : 700;
    const targetX = mobile ? 0 : -350;

    gsap.to(reflectionsNotebookContainer, {
      width: targetW,
      x: targetX,
      duration: dur(1.2),
      ease: "power4.out"
    });

    const frontCover = reflectionsNotebookContainer.querySelector(".notebook-cover-front");
    gsap.to(frontCover, {
      rotateY: -180,
      duration: dur(1.2),
      ease: "power4.out"
    });
  }

  function closeReflectionsNotebook() {
    if (!reflectionsNotebookContainer || !reflectionsNotebookContainer.classList.contains("open")) return;

    gsap.to(reflectionsNotebookContainer, {
      width: 350,
      x: 0,
      duration: dur(1.0),
      ease: "power3.inOut",
      onComplete: () => {
        reflectionsNotebookContainer.classList.remove("open");
        reflectionsNotebookContainer.style.zIndex = "";
        if (lastFocusedElement) lastFocusedElement.focus();
      }
    });

    const frontCover = reflectionsNotebookContainer.querySelector(".notebook-cover-front");
    gsap.to(frontCover, {
      rotateY: 0,
      duration: dur(1.0),
      ease: "power3.inOut"
    });

    const sheet1 = document.getElementById("reflections-sheet-1");
    if (sheet1) {
      gsap.to(sheet1, {
        rotateY: 0,
        duration: dur(0.8),
        ease: "power2.inOut",
        onComplete: () => {
          sheet1.classList.remove("flipped");
        }
      });
    }
  }

  if (closeReflectionsNotebookBtn) {
    closeReflectionsNotebookBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeReflectionsNotebook();
    });
  }

  // Close notebooks when clicking outside of them on the canvas
  document.addEventListener("click", (e) => {
    if (hasDragged) return;
    if (notebookContainer && notebookContainer.classList.contains("open")) {
      if (!notebookContainer.contains(e.target)) {
        closeNotebook();
      }
    }
    if (reflectionsNotebookContainer && reflectionsNotebookContainer.classList.contains("open")) {
      if (!reflectionsNotebookContainer.contains(e.target)) {
        closeReflectionsNotebook();
      }
    }
  });

  // Page flipping logic for reflections notebook
  const reflectionsSheet1 = document.getElementById("reflections-sheet-1");
  if (reflectionsSheet1) {
    const s1Front = reflectionsSheet1.querySelector(".sheet-front");
    const s1Back = reflectionsSheet1.querySelector(".sheet-back");

    if (s1Front) {
      s1Front.addEventListener("click", (e) => {
        if (isMobile() || hasDragged) return;
        e.stopPropagation();
        
        gsap.to(reflectionsSheet1, {
          rotateY: -180,
          duration: dur(0.8),
          ease: "power2.out",
          onStart: () => {
            reflectionsSheet1.classList.add("flipped");
          }
        });
      });
    }

    if (s1Back) {
      s1Back.addEventListener("click", (e) => {
        if (isMobile() || hasDragged) return;
        e.stopPropagation();

        gsap.to(reflectionsSheet1, {
          rotateY: 0,
          duration: dur(0.8),
          ease: "power2.out",
          onComplete: () => {
            reflectionsSheet1.classList.remove("flipped");
          }
        });
      });
    }
  }

  paperScreenshots.forEach((paper) => {
    // Keyboard accessibility: trigger click when Enter or Space is pressed
    paper.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        paper.click();
      }
    });

    paper.addEventListener("click", (e) => {
      if (hasDragged) return;

      if (paper.id === "notebook-container") {
        e.preventDefault();
        openNotebook();
        return;
      }

      if (paper.id === "reflections-notebook-container") {
        e.preventDefault();
        openReflectionsNotebook();
        return;
      }

      const template = paper.querySelector(".blog-content-source");
      if (template) {
        e.preventDefault();
        openSpread(paper, template);
      }
    });
  });

  // --- Project Overlay Logic ---
  function openSpread(paper, template) {
    if (!spreadOverlay) return;

    // Save focus position for restore on close
    lastFocusedElement = document.activeElement;

    // ── 1. Populate image & repo link ───────────────────────────────────
    const imgEl = paper.querySelector("img");
    spreadMainImg.src = imgEl ? imgEl.src : "";
    spreadMainImg.alt = imgEl ? imgEl.alt : "";

    const repoUrl = paper.dataset.repoUrl || "https://github.com/JelleHotting/Weekly-Nerd";
    if (spreadRepoLink) {
      spreadRepoLink.href = repoUrl;
    }

    // ── 2. Build scribble annotations ──────────────────────────────────
    buildScribbles(template);

    // ── 3. Show overlay & lock scroll ──────────────────────────────────
    spreadOverlay.classList.add("active");
    viewport.classList.add("panel-open");

    // ── 4. GSAP: set initial position ──────────────────────────────────
    // Card starts at the clicked paper's screen position, scaled small
    const rect = paper.getBoundingClientRect();
    const srcX = rect.left + rect.width / 2 - window.innerWidth / 2;
    const srcY = rect.top + rect.height / 2 - window.innerHeight / 2;
    // Scale factor: original card width vs spread card width (600px img + 28px padding)
    const scaleFrom = rect.width / 628;

    gsap.set(spreadMain, {
      xPercent: -50, yPercent: -50,
      x: srcX, y: srcY,
      scale: scaleFrom,
      rotation: 0,
      opacity: 1,
    });
    gsap.set(spreadRepoContainer, { opacity: 0, y: 15 });
    gsap.set(".spread-scribble.has-content", { opacity: 0, y: 10 });

    // ── 5. GSAP: animate open sequence ─────────────────────────────────
    // Main card flies to center
    gsap.to(spreadMain, {
      x: 0, y: 0, scale: 1, rotation: -1,
      duration: dur(0.85), ease: "power4.out",
    });

    // Scribble annotations stagger in (only those with content)
    gsap.to(".spread-scribble.has-content", {
      opacity: 1, y: 0,
      stagger: prefersReducedMotion ? 0 : 0.1, duration: dur(0.5), delay: prefersReducedMotion ? 0 : 0.3, ease: "power2.out",
    });

    // Repo link button animate in
    gsap.to(spreadRepoContainer, {
      opacity: 1,
      y: 0,
      duration: dur(0.5),
      delay: prefersReducedMotion ? 0 : 0.45,
      ease: "power2.out",
    });

    // Move focus to close button for keyboard / screenreader users
    requestAnimationFrame(() => closeSpreadBtn?.focus());
  }

  function closeSpread() {
    if (!spreadOverlay || !spreadOverlay.classList.contains("active")) return;

    // Scribbles out first (only animate those that were shown)
    gsap.to(".spread-scribble.has-content", { opacity: 0, y: -8, duration: dur(0.18), stagger: prefersReducedMotion ? 0 : 0.04 });

    // Repo link out
    gsap.to(spreadRepoContainer, { opacity: 0, y: -8, duration: dur(0.18) });

    // Main card shrinks out
    gsap.to(spreadMain, {
      scale: 0.25, opacity: 0,
      duration: dur(0.45), delay: prefersReducedMotion ? 0 : 0.05, ease: "power3.in",
      onComplete: () => {
        spreadOverlay.classList.remove("active");
        viewport.classList.remove("panel-open");
        // Restore focus to the element that opened the spread
        if (lastFocusedElement) lastFocusedElement.focus();
        // Cleanup after transition
        setTimeout(() => {
          spreadMainImg.src = "";
          if (spreadRepoLink) spreadRepoLink.href = "";
          gsap.set([spreadMain, spreadRepoContainer], { clearProps: "all" });
        }, 100);
      },
    });
  }

  function buildScribbles(template) {
    // Clone into a detached div so we can query without side-effects
    const frag = template.content.cloneNode(true);
    const temp = document.createElement("div");
    temp.appendChild(frag);

    const titleText = temp.querySelector(".blog-title")?.textContent?.trim() || "";
    const bullets = [...temp.querySelectorAll(".blog-list li")]
      .slice(0, 2)
      .map((li) => li.textContent.trim());
    const vibeEl = temp.querySelector(".vibe");
    const vibeText = vibeEl?.closest(".blog-text")?.textContent?.trim() || "";

    // Reset all scribbles — clear text and remove has-content marker
    document.querySelectorAll(".spread-scribble").forEach((el) => {
      el.classList.remove("has-content");
    });

    // Populate each scribble and mark it active if it has content
    if (titleText) {
      document.getElementById("scribble-title-text").textContent = titleText;
      document.getElementById("scribble-title").classList.add("has-content");
    }

    if (bullets[0]) {
      document.getElementById("scribble-tag-1-text").textContent = bullets[0];
      document.getElementById("scribble-tag-1").classList.add("has-content");
    }

    if (bullets[1]) {
      document.getElementById("scribble-tag-2-text").textContent = bullets[1];
      document.getElementById("scribble-tag-2").classList.add("has-content");
    }

    if (vibeText) {
      const shortVibe = vibeText.length > 180 ? vibeText.slice(0, 180) + "\u2026" : vibeText;
      document.getElementById("scribble-vibe-text").textContent = shortVibe;
      document.getElementById("scribble-vibe").classList.add("has-content");
    }
  }



  // --- Unified Close Logic ---
  function closeAllPanels() {
    // Prevent double-firing if already closed
    const notebookOpen = notebookContainer && notebookContainer.classList.contains("open");
    const reflectionsOpen = reflectionsNotebookContainer && reflectionsNotebookContainer.classList.contains("open");
    if (!blogPanel.classList.contains("active") && activeModel === null && !notebookOpen && !reflectionsOpen) return;

    overlay.classList.remove("active");
    modelsLayer.classList.remove("has-active-model");
    viewport.classList.remove("panel-open");

    if (blogPanel.classList.contains("active")) {
      blogPanel.classList.remove("active");
    }

    closeNotebook();
    closeReflectionsNotebook();

    if (activeModel) {
      const wrapper = activeModel;
      const viewer = wrapper.querySelector("model-viewer");
      wrapper.classList.remove("active");
      
      const defaultOrbit = wrapper.dataset.defaultOrbit || "0deg 75deg 105%";
      viewer.removeAttribute("camera-controls");

      const currentOrbit = viewer.getAttribute("camera-orbit") || defaultOrbit;
      const fromOrbit = parseOrbit(currentOrbit);
      const toOrbit = parseOrbit(defaultOrbit);
      const orbitProxy = { theta: fromOrbit.theta, phi: fromOrbit.phi };
      gsap.to(orbitProxy, {
        theta: toOrbit.theta,
        phi: toOrbit.phi,
        duration: dur(1.0),
        ease: "power3.inOut",
        onUpdate: () => {
          viewer.setAttribute(
            "camera-orbit",
            `${orbitProxy.theta}deg ${orbitProxy.phi}deg ${toOrbit.radius}`,
          );
        },
      });

      // CSS handles .model-instruction opacity via .active class
      gsap.to(wrapper, {
        x: parseFloat(wrapper.dataset.gsapX),
        y: parseFloat(wrapper.dataset.gsapY),
        // Let CSS reclaim the original dimensions instead of hardcoding isMobile() sizes
        width: isMobile() ? 100 : 160,
        height: isMobile() ? 150 : 240,
        duration: dur(1.0),
        ease: "power3.inOut",
        onComplete: () => {
          activeModel = null;
          // Restore focus to element that triggered the panel
          if (lastFocusedElement) lastFocusedElement.focus();
        },
      });
    }
  }

  overlay.addEventListener("click", closeAllPanels);

  // --- Theme Toggle Logic ---
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      document.body.classList.toggle("theme-drafting");
      const isDrafting = document.body.classList.contains("theme-drafting");
      localStorage.setItem("theme", isDrafting ? "drafting" : "blueprint");
    });
    
    // Load saved theme
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "drafting") {
      document.body.classList.add("theme-drafting");
    }
  }
});
