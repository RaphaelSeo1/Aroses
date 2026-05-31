"use client";

/**
 * Soft animated cloud background for the immersive Mentored Learning view.
 *
 * Six radial-gradient "puffs" over a pale blue-to-white base.
 *
 * PERFORMANCE: the puffs are intentionally STATIC (no drift animation).
 * Animating large `filter: blur()` elements forces the GPU to re-rasterize
 * them every frame, and because the immersive glass panels sit on top with a
 * `backdrop-filter`, that blur was being recomputed continuously too — the
 * main driver of the "fans spin up / everything lags" problem. Keeping the
 * clouds still lets the browser cache the blurred backdrop once.
 */
export function CloudBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #f0f6ff 0%, #fdf2f8 55%, #f8e8f5 100%)",
      }}
    >
      {/*
       * Drifting cloud puffs — each one a soft radial gradient circle.
       * On mobile we hide the three "decorative" puffs (d/e/f) and use a
       * smaller blur radius. `filter: blur(60px)` on six fullscreen
       * elements absolutely tanks scroll perf on lower-end phones, and
       * three subtle puffs over the gradient backdrop reads identically
       * past the first second.
       */}
      <div className="cb-puff cb-puff-a" />
      <div className="cb-puff cb-puff-b" />
      <div className="cb-puff cb-puff-c" />
      <div className="cb-puff cb-puff-d cb-puff-decorative" />
      <div className="cb-puff cb-puff-e cb-puff-decorative" />
      <div className="cb-puff cb-puff-f cb-puff-decorative" />

      <style jsx>{`
        .cb-puff {
          position: absolute;
          border-radius: 9999px;
          filter: blur(34px);
          opacity: 0.7;
          /* Static: no will-change (it would needlessly pin a compositor
             layer) and no animation — see the performance note above. */
          transform: translateZ(0);
          contain: layout paint;
        }
        @media (min-width: 768px) {
          .cb-puff {
            filter: blur(60px);
          }
        }
        @media (max-width: 767px) {
          .cb-puff-decorative {
            display: none;
          }
        }
        .cb-puff-a {
          width: 38rem;
          height: 38rem;
          top: -10rem;
          left: -8rem;
          background: radial-gradient(
            closest-side,
            rgba(255, 255, 255, 0.95),
            rgba(255, 255, 255, 0)
          );
        }
        .cb-puff-b {
          width: 32rem;
          height: 32rem;
          top: 5rem;
          right: -6rem;
          background: radial-gradient(
            closest-side,
            rgba(244, 207, 233, 0.85),
            rgba(244, 207, 233, 0)
          );
        }
        .cb-puff-c {
          width: 44rem;
          height: 44rem;
          bottom: -14rem;
          left: -6rem;
          background: radial-gradient(
            closest-side,
            rgba(220, 235, 255, 0.9),
            rgba(220, 235, 255, 0)
          );
        }
        .cb-puff-d {
          width: 28rem;
          height: 28rem;
          bottom: 4rem;
          right: 6rem;
          background: radial-gradient(
            closest-side,
            rgba(232, 217, 255, 0.7),
            rgba(232, 217, 255, 0)
          );
        }
        .cb-puff-e {
          width: 24rem;
          height: 24rem;
          top: 30%;
          left: 35%;
          background: radial-gradient(
            closest-side,
            rgba(255, 240, 245, 0.55),
            rgba(255, 240, 245, 0)
          );
        }
        .cb-puff-f {
          width: 30rem;
          height: 30rem;
          top: 55%;
          right: 25%;
          background: radial-gradient(
            closest-side,
            rgba(255, 255, 255, 0.55),
            rgba(255, 255, 255, 0)
          );
        }
      `}</style>
    </div>
  );
}
