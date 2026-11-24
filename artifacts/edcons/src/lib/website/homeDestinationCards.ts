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

export type HomeUniversity = {
  id: number;
  name: string;
  country?: string | null;
  logoUrl?: string | null;
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
    if (block.blockType === "home_fallback_stats" && heroVisuals.length) {
      return { ...block, content: { ...block.content, imageUrl: heroVisuals[0]?.imageUrl, secondaryImageUrl: heroVisuals[1]?.imageUrl || heroVisuals[0]?.imageUrl } };
    }
    if (block.blockType === "home_fallback_features" && heroVisuals.length) {
      const cards = Array.isArray(block.content.cards) ? block.content.cards : [];
      return { ...block, content: { ...block.content, cards: cards.map((card, index) => ({ ...(card as Record<string, unknown>), imageUrl: heroVisuals[index % heroVisuals.length]?.imageUrl })) } };
    }
    if (block.blockType === "counter_grid" && block.content.variant === "home-offer" && heroVisuals.length) {
      return { ...block, content: { ...block.content, imageUrl: heroVisuals[1]?.imageUrl || heroVisuals[0]?.imageUrl, secondaryImageUrl: heroVisuals[2]?.imageUrl || heroVisuals[0]?.imageUrl } };
    }
    if (block.blockType === "icon_cards" && block.content.variant === "home-why" && heroVisuals.length) {
      return { ...block, content: { ...block.content, imageUrl: heroVisuals[2]?.imageUrl || heroVisuals[0]?.imageUrl } };
    }
    if (block.blockType === "grid_box" && block.content.variant === "home-journal" && heroVisuals.length) {
      const cards = Array.isArray(block.content.cards) ? block.content.cards : [];
      return { ...block, content: { ...block.content, cards: cards.map((card, index) => ({ ...(card as Record<string, unknown>), imageUrl: heroVisuals[index % heroVisuals.length]?.imageUrl })) } };
    }
    return block;
  });
}

export function hydrateManagedHomeUniversities(blocks: PageBlock[], universities: HomeUniversity[]): PageBlock[] {
  const seen = new Set<string>();
  const logos = universities.flatMap(university => {
    const name = university.name?.trim();
    const imageUrl = university.logoUrl?.trim();
    if (!name || !imageUrl || seen.has(imageUrl)) return [];
    seen.add(imageUrl);
    return [{ name, imageUrl, country: university.country || "" }];
  }).slice(0, 8);
  if (!logos.length) return blocks;
  return blocks.map(block => block.blockType === "logo_grid" && block.content.variant === "home-universities"
    ? { ...block, content: { ...block.content, logos } }
    : block);
}
