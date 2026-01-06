import { describe, it, expect } from 'vitest';
import { urlProcessor } from '../../../src/modules/knowledge/processors/url.processor.js';

describe('URL Processor - Link Extraction', () => {
  describe('extractLinks', () => {
    it('should extract internal links', () => {
      const html = `
        <html>
          <body>
            <a href="/page1">Page 1</a>
            <a href="https://example.com/page2">Page 2</a>
            <a href="/page3#section">Page 3</a>
          </body>
        </html>
      `;

      const links = urlProcessor.extractLinks(html, 'https://example.com');

      expect(links).toContain('https://example.com/page1');
      expect(links).toContain('https://example.com/page2');
      expect(links).toContain('https://example.com/page3'); // Fragment removed
      expect(links).toHaveLength(3);
    });

    it('should ignore external links', () => {
      const html = `
        <html>
          <body>
            <a href="https://example.com/page1">Internal</a>
            <a href="https://other.com/page2">External</a>
            <a href="https://example.com/page3">Internal</a>
          </body>
        </html>
      `;

      const links = urlProcessor.extractLinks(html, 'https://example.com');

      expect(links).toContain('https://example.com/page1');
      expect(links).toContain('https://example.com/page3');
      expect(links).not.toContain('https://other.com/page2');
      expect(links).toHaveLength(2);
    });

    it('should handle relative URLs correctly', () => {
      const html = `
        <html>
          <body>
            <a href="../parent">Parent</a>
            <a href="./sibling">Sibling</a>
            <a href="child">Child</a>
          </body>
        </html>
      `;

      const links = urlProcessor.extractLinks(html, 'https://example.com/path/to/page');

      expect(links).toContain('https://example.com/path/parent');
      expect(links).toContain('https://example.com/path/to/sibling');
      expect(links).toContain('https://example.com/path/to/child');
    });

    it('should remove fragments from URLs', () => {
      const html = `
        <html>
          <body>
            <a href="/page#section1">Page 1</a>
            <a href="/page#section2">Page 2</a>
          </body>
        </html>
      `;

      const links = urlProcessor.extractLinks(html, 'https://example.com');

      // Should deduplicate since fragments are removed
      expect(links).toContain('https://example.com/page');
      expect(links).toHaveLength(1);
    });

    it('should deduplicate URLs', () => {
      const html = `
        <html>
          <body>
            <a href="/page">Link 1</a>
            <a href="/page">Link 2</a>
            <a href="https://example.com/page">Link 3</a>
          </body>
        </html>
      `;

      const links = urlProcessor.extractLinks(html, 'https://example.com');

      expect(links).toHaveLength(1);
      expect(links[0]).toBe('https://example.com/page');
    });

    it('should handle malformed hrefs gracefully', () => {
      const html = `
        <html>
          <body>
            <a href="/valid">Valid</a>
            <a href="javascript:void(0)">Invalid</a>
            <a href="mailto:test@example.com">Email</a>
            <a href="">Empty</a>
          </body>
        </html>
      `;

      const links = urlProcessor.extractLinks(html, 'https://example.com');

      expect(links).toHaveLength(1);
      expect(links[0]).toBe('https://example.com/valid');
    });

    it('should normalize trailing slashes', () => {
      const html = `
        <html>
          <body>
            <a href="/page/">With slash</a>
            <a href="/page">Without slash</a>
          </body>
        </html>
      `;

      const links = urlProcessor.extractLinks(html, 'https://example.com');

      // Should deduplicate after normalization
      expect(links).toHaveLength(1);
      expect(links[0]).toBe('https://example.com/page');
    });
  });

  describe('getCanonicalUrl', () => {
    it('should extract canonical URL', () => {
      const html = `
        <html>
          <head>
            <link rel="canonical" href="https://example.com/canonical-page" />
          </head>
          <body>Content</body>
        </html>
      `;

      const canonical = urlProcessor.getCanonicalUrl(html, 'https://example.com/current-page');

      expect(canonical).toBe('https://example.com/canonical-page');
    });

    it('should handle relative canonical URL', () => {
      const html = `
        <html>
          <head>
            <link rel="canonical" href="/canonical-page" />
          </head>
          <body>Content</body>
        </html>
      `;

      const canonical = urlProcessor.getCanonicalUrl(html, 'https://example.com/current-page');

      expect(canonical).toBe('https://example.com/canonical-page');
    });

    it('should return page URL if no canonical found', () => {
      const html = `
        <html>
          <head></head>
          <body>Content</body>
        </html>
      `;

      const canonical = urlProcessor.getCanonicalUrl(html, 'https://example.com/page');

      expect(canonical).toBe('https://example.com/page');
    });
  });
});
