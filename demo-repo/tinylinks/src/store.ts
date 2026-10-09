export interface Link {
  slug: string;
  url: string;
  createdAt: number;
  clicks: number;
}

/** In-memory link store. */
export class LinkStore {
  private links = new Map<string, Link>();

  create(url: string, slug: string, now = Date.now()): Link {
    const link: Link = { slug, url, createdAt: now, clicks: 0 };
    this.links.set(slug, link);
    return link;
  }

  get(slug: string): Link | undefined {
    return this.links.get(slug);
  }

  has(slug: string): boolean {
    return this.links.has(slug);
  }

  recordClick(slug: string): void {
    const link = this.links.get(slug);
    if (link) link.clicks++;
  }

  all(): Link[] {
    return [...this.links.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
}
