document.addEventListener("DOMContentLoaded", () => {
  // --- Pannable Canvas Logic ---
  const viewport = document.getElementById("viewport");
  const canvasArea = document.getElementById("canvas-area");

  let isDragging = false;
  let hasDragged = false;
  let firstInteractionDone = false;
  let startX, startY;
  let scrollLeft, scrollTop;
  let activeModel = null;

  const isMobile = () => window.innerWidth < 640;

  const instructionText = document.querySelector(".instruction-text");
  const modelsLayer = document.getElementById("models-layer");
  const overlay = document.querySelector(".glass-overlay");
  const blogPanel = document.getElementById("blog-panel");
  const blogPanelContent = document.getElementById("blog-panel-content");

  // Center starting position
  viewport.scrollLeft = (canvasArea.offsetWidth - viewport.clientWidth) / 2;
  viewport.scrollTop = (canvasArea.offsetHeight - viewport.clientHeight) / 2;

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

  modelWrappers.forEach((wrapper) => {
    const viewer = wrapper.querySelector("model-viewer");

    wrapper.addEventListener("click", (e) => {
      // Return early if dragging the background, or if this element is already focused
      if (hasDragged || activeModel === wrapper) return;

      activeModel = wrapper;

      overlay.classList.add("active");
      modelsLayer.classList.add("has-active-model");
      wrapper.classList.add("active");
      wrapper.style.zIndex = "100";
      viewport.style.overflow = "hidden";

      const rect = wrapper.getBoundingClientRect();
      // Center position of screen
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      // Bereken offset t.o.v. de huidige positie op je scherm
      const dx = centerX - (rect.left + rect.width / 2);
      const dy = centerY - (rect.top + rect.height / 2);
      const activeOrbit = wrapper.dataset.activeOrbit || "100deg 0deg 90%";
      viewer.setAttribute("camera-controls", "false");

      const instruction = wrapper.querySelector(".model-instruction");
      if (instruction) gsap.to(instruction, { opacity: 0, duration: 0.3 });

      wrapper.dataset.gsapX = gsap.getProperty(wrapper, "x") || 0;
      wrapper.dataset.gsapY = gsap.getProperty(wrapper, "y") || 0;

      // Parse current and target orbit values to animate between them
      const currentOrbit = viewer.getAttribute("camera-orbit") || "0deg 75deg 105%";
      const parseOrbit = (str) => {
        const parts = str.trim().split(/\s+/);
        return {
          theta: parseFloat(parts[0]),
          phi: parseFloat(parts[1]),
          radius: parts[2],
        };
      };
      const fromOrbit = parseOrbit(currentOrbit);
      const toOrbit = parseOrbit(activeOrbit);
      const orbitProxy = { theta: fromOrbit.theta, phi: fromOrbit.phi };

      // Sweep naar het midden — op mobile omhoog schuiven, op desktop naar links
      const mobile = isMobile();
      gsap.to(wrapper, {
        x: parseFloat(wrapper.dataset.gsapX) + dx - (mobile ? 0 : 320),
        y: parseFloat(wrapper.dataset.gsapY) + dy - (mobile ? window.innerHeight * 0.34 : 0),
        width:  mobile ? 180 : 352,
        height: mobile ? 270 : 528,
        duration: 1.2,
        ease: "power4.out",
      });

      // Animate camera orbit in sync with the wrapper movement
      gsap.to(orbitProxy, {
        theta: toOrbit.theta,
        phi: toOrbit.phi,
        duration: 1.2,
        ease: "power4.out",
        onUpdate: () => {
          viewer.setAttribute(
            "camera-orbit",
            `${orbitProxy.theta}deg ${orbitProxy.phi}deg ${toOrbit.radius}`
          );
        },
      });

      // Show blog panel with template content
      const template = wrapper.querySelector(".blog-content-source");
      if (template) {
        blogPanelContent.innerHTML = ""; // Clear old content
        const clone = template.content.cloneNode(true);
        blogPanelContent.appendChild(clone);
      }

      blogPanel.classList.add("active");
    });
  });

  overlay.addEventListener("click", () => {
    if (!activeModel) return;

    const wrapper = activeModel;
    const viewer = wrapper.querySelector("model-viewer");

    overlay.classList.remove("active");
    modelsLayer.classList.remove("has-active-model");
    wrapper.classList.remove("active");
    blogPanel.classList.remove("active");
    viewport.style.overflow = "auto";

    const defaultOrbit = wrapper.dataset.defaultOrbit || "0deg 75deg 105%";
    viewer.removeAttribute("camera-controls");

    // Animate camera back to default orbit in sync with the collapse
    const currentOrbit = viewer.getAttribute("camera-orbit") || defaultOrbit;
    const parseOrbit = (str) => {
      const parts = str.trim().split(/\s+/);
      return { theta: parseFloat(parts[0]), phi: parseFloat(parts[1]), radius: parts[2] };
    };
    const fromOrbit = parseOrbit(currentOrbit);
    const toOrbit = parseOrbit(defaultOrbit);
    const orbitProxy = { theta: fromOrbit.theta, phi: fromOrbit.phi };
    gsap.to(orbitProxy, {
      theta: toOrbit.theta,
      phi: toOrbit.phi,
      duration: 1.0,
      ease: "power3.inOut",
      onUpdate: () => {
        viewer.setAttribute(
          "camera-orbit",
          `${orbitProxy.theta}deg ${orbitProxy.phi}deg ${toOrbit.radius}`
        );
      },
    });

    const instruction = wrapper.querySelector(".model-instruction");
    if (instruction)
      gsap.to(instruction, { opacity: 1, duration: 0.5, delay: 0.5 });

    gsap.to(wrapper, {
      x: parseFloat(wrapper.dataset.gsapX),
      y: parseFloat(wrapper.dataset.gsapY),
      width:  isMobile() ? 100 : 160,
      height: isMobile() ? 150 : 240,
      duration: 1.0,
      ease: "power3.inOut",
      onComplete: () => {
        wrapper.style.zIndex = "5";
        activeModel = null;
      },
    });
  });
});
