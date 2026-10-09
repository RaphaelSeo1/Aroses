import { boardSceneSvg } from "@/lib/mentored/board-scene";
import type { BoardScene } from "@/types/mentored";

/** Drawn teaching board. Markup comes from the same SVG builder the tests check. */
export function BoardSceneView({ scene }: { scene: BoardScene }) {
  const svg = boardSceneSvg(scene);
  return (
    <div
      className="mx-auto aspect-square w-full max-w-3xl overflow-hidden rounded-2xl shadow-sm ring-1 ring-white/40"
      data-board-scene={scene.kicker ?? "diagram"}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
