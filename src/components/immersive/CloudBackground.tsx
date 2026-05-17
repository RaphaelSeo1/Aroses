"use client";

/**
 * Soft animated cloud background for the immersive Mentored Learning view.
 *
 * Six radial-gradient "puffs" drift across the viewport at very slow speeds
 * over a pale blue-to-white base. Pure CSS keyframes (defined inline so the
 * component is self-contained) — no canvas, no JS animation frames.
 *
 * The puffs are positioned with negative offsets so they enter and exit the
 * viewport edges without revealing the gradient seam.
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
      {/* Drifting cloud puffs — each one a soft radial gradient circle. */}
      <div className="cb-puff cb-puff-a" />
      <div className="cb-puff cb-puff-b" />
      <div className="cb-puff cb-puff-c" />
      <div className="cb-puff cb-puff-d" />
      <div className="cb-puff cb-puff-e" />
      <div className="cb-puff cb-puff-f" />

      <style jsx>{`
        .cb-puff {
          position: absolute;
          border-radius: 9999px;
          filter: blur(60px);
          opacity: 0.7;
          will-change: transform;
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
          animation: drift-a 38s ease-in-out infinite alternate;
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
          animation: drift-b 46s ease-in-out infinite alternate;
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
          animation: drift-c 52s ease-in-out infinite alternate;
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
          animation: drift-d 60s ease-in-out infinite alternate;
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
          animation: drift-e 70s ease-in-out infinite alternate;
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
          animation: drift-f 56s ease-in-out infinite alternate;
        }
        @keyframes drift-a {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(4rem, 2rem);
          }
        }
        @keyframes drift-b {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(-3rem, 3rem);
          }
        }
        @keyframes drift-c {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(5rem, -3rem);
          }
        }
        @keyframes drift-d {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(-4rem, -2rem);
          }
        }
        @keyframes drift-e {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(-2rem, 4rem);
          }
        }
        @keyframes drift-f {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(3rem, -4rem);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cb-puff {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
