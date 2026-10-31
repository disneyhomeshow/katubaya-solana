// Sprites of the gamification design, rendered at 2x. Each sprite's metadata is [width, height,
// anchorX, anchorY] in those 2x pixels: the anchor is the point that stands on the ground.

export type Mood = "idle" | "talk" | "celebrate" | "alert";

export const BROTO: Record<Mood, string> = {
  idle: "/game/broto/idle.png",
  talk: "/game/broto/talk.png",
  celebrate: "/game/broto/celebrate.png",
  alert: "/game/broto/alert.png",
};

export const AVATAR = { operator: "/game/avatar/operator.png", admin: "/game/avatar/admin.png" };

export type SpriteMeta = [w: number, h: number, ax: number, ay: number];

// ---- The warehouse yard (one 1200 × 640 render)

export const YARD_BG = "/game/yard/yard.png";
export const CRATE = "/game/yard/crate.png";

export const YARD = {
  truckBay: { src: "/game/yard/truck-bay.png", meta: [406, 321, 150, 239.9] },
  truckRoad: { src: "/game/yard/truck-road.png", meta: [441, 294, 178, 224.9] },
  vault: { src: "/game/yard/vault.png", meta: [191, 139, 79, 102.9] },
  vaultOpen: { src: "/game/yard/vault-open.png", meta: [233, 187, 79, 146.9] },
  porter: { src: "/game/yard/porter.png", meta: [192, 173, 79, 125.9] },
  customer: { src: "/game/yard/customer.png", meta: [192, 158, 75, 134.9] },
  farmer: { src: "/game/yard/farmer.png", meta: [171, 159, 49, 130.9] },
  operator: { src: "/game/yard/operator.png", meta: [158, 157, 46, 131.9] },
  counter: { src: "/game/yard/counter.png", meta: [326, 247, 106, 203.8] },
  gate: { src: "/game/yard/gate.png", meta: [255, 256, 86, 203.9] },
  treeRound: { src: "/game/yard/tree-round.png", meta: [229, 224, 63, 192.7] },
  treeBanana: { src: "/game/yard/tree-banana.png", meta: [321, 244, 118, 172.7] },
} satisfies Record<string, { src: string; meta: SpriteMeta }>;

export type YardSprite = keyof typeof YARD;

export type Heading = "px" | "pz" | "nx" | "nz";

/**
 * The forklift by heading (forks toward +x, +z, −x, −z), empty and carrying: sprite, size and anchor,
 * then where its beacon (bx, by) and exhaust (ex, ey) sit on the sprite.
 */
export const FORKLIFT: Record<Heading, { empty: SpriteMeta; loaded: SpriteMeta; bx: string; by: string; ex: string; ey: string }> = {
  px: { empty: [308, 239, 98, 189.8], loaded: [308, 238, 98, 189.8], bx: "23%", by: "9%", ex: "14%", ey: "42%" },
  pz: { empty: [279, 251, 105, 187.8], loaded: [278, 250, 104, 187.8], bx: "41%", by: "8%", ex: "74%", ey: "30%" },
  nx: { empty: [305, 258, 137, 212.8], loaded: [304, 258, 136, 212.8], bx: "50%", by: "21%", ex: "76%", ey: "44%" },
  nz: { empty: [297, 265, 95, 218.8], loaded: [297, 265, 95, 218.8], bx: "27%", by: "24%", ex: "30%", ey: "58%" },
};

export function forkliftSrc(head: Heading, loaded: boolean): string {
  return `/game/yard/fork-${head}${loaded ? "-loaded" : ""}.png`;
}

/** The three crop renders. Orders and lots pick theirs from the crop name. */
export const CROP = { banana: "/game/crop/banana.png", cacau: "/game/crop/cacau.png", mandioca: "/game/crop/mandioca.png" };

export function cropImage(name: string): string {
  const n = name.toLowerCase();
  if (/banan|pacov/.test(n)) return CROP.banana;
  if (/cacau|cocoa|açaí|acai|cupua|café|cafe/.test(n)) return CROP.cacau;
  if (/mandioc|aipim|macax|palmit|inhame|batat|car[aá]\b/.test(n)) return CROP.mandioca;
  const keys = [CROP.banana, CROP.cacau, CROP.mandioca];
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return keys[h % keys.length];
}

// ---- The program map (tiles drawn in SVG, 60 px per world unit)

export const MAP = {
  wh: { src: "/game/map/warehouse.png", meta: [421, 246, 200, 158.9] },
  site: { src: "/game/map/site.png", meta: [427, 235, 180, 157.9] },
  tree: { src: "/game/map/tree.png", meta: [112, 110, 32, 92.1] },
  palm: { src: "/game/map/palm.png", meta: [146, 118, 54, 83.1] },
  admin: { src: "/game/map/admin.png", meta: [89, 84, 30, 67.4] },
} satisfies Record<string, { src: string; meta: SpriteMeta }>;

/** The map's truck from 16 headings, 22.5° apart, starting at +x and turning toward +z. */
export const MAP_TRUCK: SpriteMeta[] = [
  [178, 120, 77, 87.6], [158, 130, 67, 92.6], [127, 133, 52, 94.6], [129, 133, 49, 94.6],
  [163, 131, 65, 93.6], [187, 121, 77, 88.6], [195, 107, 81, 80.6], [194, 101, 80, 76.6],
  [189, 112, 78, 79.6], [168, 117, 67, 80.6], [135, 118, 52, 80.6], [123, 117, 49, 79.6],
  [153, 118, 65, 80.6], [176, 112, 76, 79.6], [181, 104, 78, 77.6], [180, 104, 77, 79.6],
];

export function mapTruckSrc(index: number): string {
  return `/game/map/truck-${String(index).padStart(2, "0")}.png`;
}
