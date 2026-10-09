export interface Link { slug: string; url: string; createdAt: number; clicks: number; expiresAt?: number; seq: number }
export class LinkStore {
  private links = new Map<string, Link>(); private seq = 0;
  create(url: string, slug: string, now = Date.now(), expiresAt?: number): Link {
    const link: Link = { slug, url, createdAt: now, clicks: 0, expiresAt, seq: this.seq++ };
    this.links.set(slug, link); return link;
  }
  get(slug: string) { return this.links.get(slug); }
  has(slug: string) { return this.links.has(slug); }
  delete(slug: string) { return this.links.delete(slug); }
  recordClick(slug: string) { const l = this.links.get(slug); if (l) l.clicks++; }
  all(): Link[] { return [...this.links.values()].sort((a, b) => a.seq - b.seq); }
}
