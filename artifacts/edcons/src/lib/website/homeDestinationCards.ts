import type { PageBlock } from "./blockTypes";

export type HomeDestination = {
  id: number | null;
  name: string;
  country?: string | null;
  shortDescription?: string | null;
  canonicalPath: string;
  cardHeroImageUrl?: string | null;
  heroImageUrl?: string | null;
  thumbnailUrl?: string | null;
  flagEmoji?: string | null;
};

export function hydrateManagedHomeDestinations(blocks: PageBlock[], destinations: HomeDestination[]): PageBlock[] {
  const items = destinations.filter(destination => destination.name && destination.canonicalPath).slice(0, 6).map(destination => ({
    id: destination.id ?? destination.canonicalPath,
    title: destination.name,
    description: destination.shortDescription || destination.country || "",
    canonicalPath: destination.canonicalPath,
    imageUrl: destination.cardHeroImageUrl || destination.thumbnailUrl || destination.heroImageUrl || null,
    flagEmoji: destination.flagEmoji || null,
  }));
  if (!items.length) return blocks;
  const heroVisuals = items
    .filter(item => item.imageUrl)
    .slice(0, 3)
    .map(item => ({ title: item.title, imageUrl: item.imageUrl, canonicalPath: item.canonicalPath, flagEmoji: item.flagEmoji }));
  return blocks.map(block => {
    if (block.blockType === "catalog_grid" && block.content.source === "destinations") {
      return { ...block, content: { ...block.content, items } };
    }
    if (block.blockType === "home_fallback_hero" && heroVisuals.length) {
      return { ...block, content: { ...block.content, heroVisuals } };
    }
    return block;
  });
}
