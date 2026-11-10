import type { ComponentType } from "react";
import type { HealingSceneId, WeatherEffect } from "@/lib/team/healing";
import { YardArt } from "./yard";
import { BeachArt } from "./beach";
import { FishingArt } from "./fishing";
import { MountainArt } from "./mountain";
import { RooftopArt } from "./rooftop";
import { RooftopNightArt } from "./rooftop-night";
import { SnowForestArt } from "./snow-forest";
import { CampArt } from "./camp";

/** Props every scene painting receives. Scenes only recolor sky/light from these. */
export type SceneArtProps = { isDay: boolean; effect: WeatherEffect };

/** The six healing places plus the hub yard. */
export type SceneArtId = HealingSceneId | "yard";

/** One rooftop: the night painting (lit windows, string lights) takes over after dark. */
function RooftopDayNightArt(props: SceneArtProps) {
  return props.isDay ? RooftopArt(props) : RooftopNightArt(props);
}

/** Pure SVG paintings, 1600x900 logical units, keyed by scene id. */
export const SCENE_ART: Record<SceneArtId, ComponentType<SceneArtProps>> = {
  yard: YardArt,
  beach: BeachArt,
  fishing: FishingArt,
  mountain: MountainArt,
  rooftop: RooftopDayNightArt,
  "snow-forest": SnowForestArt,
  camp: CampArt,
};
