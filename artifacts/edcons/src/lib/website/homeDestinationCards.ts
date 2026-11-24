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
  return blocks.map(block => block.blockType === "catalog_grid" && block.content.source === "destinations"
    ? { ...block, content: { ...block.content, items } }
    : block);
}
