import { useEffect } from "react";
import { resolveViewportCssVars } from "./viewport-layout";

export function useVisualViewportCssVars(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let raf = 0;

    const apply = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        const vars = resolveViewportCssVars({
          innerHeight: window.innerHeight,
          visualViewport: viewport
            ? { height: viewport.height, offsetTop: viewport.offsetTop }
            : null,
        });
        for (const [name, value] of Object.entries(vars)) {
          root.style.setProperty(name, value);
        }
      });
    };

    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
    };
  }, []);
}
