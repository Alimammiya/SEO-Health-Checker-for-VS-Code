export type SeoSeverity = 'error' | 'warning';

export interface SeoFinding {
  message: string;
  recommendation: string;
  severity: SeoSeverity;
  line: number;
}

export interface SeoCategoryScore {
  label: string;
  score: number;
  issues: number;
}

export interface SeoReportMetadata {
  title: { content: string; line: number } | null;
  metaTags: MetaTag[];
  links: LinkTag[];
  headings: HeadingTag[];
  images: ImageTag[];
  structuredData: StructuredDataTag[];
  hasCharset: boolean;
  hasHtmlLang: boolean;
}

export interface SeoReport {
  score: number;
  categoryScores: SeoCategoryScore[];
  metadata: SeoReportMetadata;
  findings: SeoFinding[];
  summary: string;
}

interface ExtractedTag {
  tag: string;
  line: number;
}

export interface MetaTag {
  key: string;
  content: string;
  line: number;
}

export interface LinkTag {
  rel: string;
  href: string;
  line: number;
}

export interface HeadingTag {
  level: number;
  content: string;
  line: number;
}

export interface ImageTag {
  src: string;
  alt: string | null;
  line: number;
}

export interface StructuredDataTag {
  valid: boolean;
  line: number;
}

interface PhpSeoMetadata {
  title?: { content: string; line: number };
  description?: { content: string; line: number };
  keywords?: { content: string; line: number };
  robots?: { content: string; line: number };
  canonical?: { content: string; line: number };
}

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
  'fbclid',
  'gclid',
  'msclkid'
]);

function lineNumberFromIndex(text: string, index: number): number {
  if (index < 0) {
    return 0;
  }

  return text.slice(0, index).split(/\r\n|\r|\n/).length - 1;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return stripTags(value).replace(/\s+/g, ' ').trim();
}

function extractTags(text: string, tagName: string): ExtractedTag[] {
  const tags: ExtractedTag[] = [];
  const regex = new RegExp(`<${tagName}\\b`, 'gi');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    let quote: string | null = null;
    let inPhpBlock = false;
    let endIndex = -1;

    for (let index = regex.lastIndex; index < text.length; index += 1) {
      const character = text[index];
      const nextCharacter = text[index + 1];

      if (inPhpBlock) {
        if (character === '?' && nextCharacter === '>') {
          inPhpBlock = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (character === '<' && nextCharacter === '?') {
          inPhpBlock = true;
          index += 1;
          continue;
        }

        if (character === quote) {
          quote = null;
        }
        continue;
      }

      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }

      if (character === '<' && nextCharacter === '?') {
        inPhpBlock = true;
        index += 1;
        continue;
      }

      if (character === '>') {
        endIndex = index;
        break;
      }
    }

    if (endIndex >= 0) {
      tags.push({
        tag: text.slice(match.index, endIndex + 1),
        line: lineNumberFromIndex(text, match.index)
      });
      regex.lastIndex = endIndex + 1;
    }
  }

  return tags;
}

function parseAttributeValue(tag: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+))`, 'i');
  const match = regex.exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value ? value.trim() : null;
}

function captureTagContent(text: string, tagName: string): { content: string; line: number } | null {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(text);
  if (!match) {
    return null;
  }

  return {
    content: normalizeWhitespace(match[1]),
    line: lineNumberFromIndex(text, match.index)
  };
}

function unescapePhpString(value: string, quote: string): string {
  return value.replace(/\\(["'\\nrt$])/g, (_, character: string) => {
    if (character === 'n') {
      return '\n';
    }
    if (character === 'r') {
      return '\r';
    }
    if (character === 't') {
      return '\t';
    }
    if (character === '$' && quote === "'") {
      return `\\${character}`;
    }
    return character;
  });
}

function getPhpStringAssignment(text: string, variableName: string): { content: string; line: number } | undefined {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\$${escapedName}\\s*=\\s*(?:\\$${escapedName}\\s*\\?\\?\\s*)?(["'])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1\\s*;`, 'i');
  const match = regex.exec(text);

  if (!match) {
    return undefined;
  }

  return {
    content: unescapePhpString(match[2], match[1]).trim(),
    line: lineNumberFromIndex(text, match.index)
  };
}

function extractPhpSeoMetadata(text: string): PhpSeoMetadata {
  return {
    title: getPhpStringAssignment(text, 'pageTitle') || getPhpStringAssignment(text, 'title'),
    description: getPhpStringAssignment(text, 'metaDescription') || getPhpStringAssignment(text, 'description'),
    keywords: getPhpStringAssignment(text, 'metaKeywords') || getPhpStringAssignment(text, 'keywords'),
    robots: getPhpStringAssignment(text, 'metaRobots') || getPhpStringAssignment(text, 'robots'),
    canonical: getPhpStringAssignment(text, 'canonicalURL') || getPhpStringAssignment(text, 'canonicalUrl')
  };
}

function extractMetaTags(text: string): MetaTag[] {
  return extractTags(text, 'meta')
    .map(({ tag, line }) => {
      const key = parseAttributeValue(tag, 'name') || parseAttributeValue(tag, 'property') || parseAttributeValue(tag, 'http-equiv') || '';
      const content = parseAttributeValue(tag, 'content') || '';
      return { key: key.toLowerCase(), content, line };
    })
    .filter(tag => tag.key || tag.content);
}

function extractLinks(text: string): LinkTag[] {
  return extractTags(text, 'link')
    .map(({ tag, line }) => ({
      rel: (parseAttributeValue(tag, 'rel') || '').toLowerCase(),
      href: parseAttributeValue(tag, 'href') || '',
      line
    }))
    .filter(link => link.rel || link.href);
}

function extractHeadings(text: string): HeadingTag[] {
  const headings: HeadingTag[] = [];
  const regex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    headings.push({
      level: Number(match[1]),
      content: normalizeWhitespace(match[2]),
      line: lineNumberFromIndex(text, match.index)
    });
  }

  return headings;
}

function extractImages(text: string): ImageTag[] {
  return extractTags(text, 'img').map(({ tag, line }) => ({
    src: parseAttributeValue(tag, 'src') || '',
    alt: parseAttributeValue(tag, 'alt'),
    line
  }));
}

function extractStructuredData(text: string): StructuredDataTag[] {
  const scripts: StructuredDataTag[] = [];
  const regex = /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    try {
      JSON.parse(match[1].trim());
      scripts.push({ valid: true, line: lineNumberFromIndex(text, match.index) });
    } catch {
      scripts.push({ valid: false, line: lineNumberFromIndex(text, match.index) });
    }
  }

  return scripts;
}

function hasCharset(text: string, metaTags: MetaTag[]): boolean {
  return /<meta\b[^>]*\bcharset\s*=/i.test(text) || metaTags.some(tag => tag.key === 'content-type' && /charset=/i.test(tag.content));
}

function getHtmlTagLine(text: string): number {
  const match = /<html\b[^>]*>/i.exec(text);
  return match ? lineNumberFromIndex(text, match.index) : 0;
}

function hasHtmlLang(text: string): boolean {
  const match = /<html\b[^>]*>/i.exec(text);
  return Boolean(match && parseAttributeValue(match[0], 'lang'));
}

function normalizeUrlForCanonical(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    for (const [key] of Array.from(url.searchParams.entries())) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function isAbsoluteHttpUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isCanonicalSuspicious(canonical: string): boolean {
  const normalizedCanonical = normalizeUrlForCanonical(canonical);
  return !normalizedCanonical || !isAbsoluteHttpUrl(normalizedCanonical);
}

function pushFinding(findings: SeoFinding[], finding: SeoFinding): void {
  findings.push(finding);
}

function addFallbackMetaTag(metaTags: MetaTag[], key: string, fallback: { content: string; line: number } | undefined): void {
  if (fallback && !metaTags.some(tag => tag.key === key)) {
    metaTags.push({ key, content: fallback.content, line: fallback.line });
  }
}

function countIssues(findings: SeoFinding[], patterns: RegExp[]): number {
  return findings.filter(finding => patterns.some(pattern => pattern.test(finding.message))).length;
}

function scoreCategory(issueCount: number): number {
  return Math.max(0, 100 - issueCount * 20);
}

function buildCategoryScores(findings: SeoFinding[], overallScore: number): SeoCategoryScore[] {
  const metaIssues = countIssues(findings, [
    /title/i,
    /meta/i,
    /canonical/i,
    /viewport/i,
    /charset/i,
    /lang/i
  ]);
  const structuredDataIssues = countIssues(findings, [/structured data/i, /JSON-LD/i]);
  const headingIssues = countIssues(findings, [/h1/i, /h2/i, /heading/i]);
  const imageIssues = countIssues(findings, [/image/i, /alt text/i]);

  return [
    { label: 'Meta Tags', score: scoreCategory(metaIssues), issues: metaIssues },
    { label: 'Structured Data', score: scoreCategory(structuredDataIssues), issues: structuredDataIssues },
    { label: 'Headings', score: scoreCategory(headingIssues), issues: headingIssues },
    { label: 'Images', score: scoreCategory(imageIssues), issues: imageIssues },
    { label: 'Overall SEO Health', score: overallScore, issues: findings.length }
  ];
}

export function analyzeSeo(text: string, filePath = ''): SeoReport {
  const findings: SeoFinding[] = [];
  const phpSeoMetadata = extractPhpSeoMetadata(text);
  const title = captureTagContent(text, 'title') || phpSeoMetadata.title || null;
  const metaTags = extractMetaTags(text);
  addFallbackMetaTag(metaTags, 'description', phpSeoMetadata.description);
  addFallbackMetaTag(metaTags, 'keywords', phpSeoMetadata.keywords);
  addFallbackMetaTag(metaTags, 'robots', phpSeoMetadata.robots);
  const links = extractLinks(text);
  if (phpSeoMetadata.canonical && !links.some(link => link.rel.split(/\s+/).includes('canonical'))) {
    links.push({ rel: 'canonical', href: phpSeoMetadata.canonical.content, line: phpSeoMetadata.canonical.line });
  }
  const canonicalLink = links.find(link => link.rel.split(/\s+/).includes('canonical'));
  const headings = extractHeadings(text);
  const h1Tags = headings.filter(heading => heading.level === 1);
  const h2Tags = headings.filter(heading => heading.level === 2);
  const images = extractImages(text);
  const structuredData = extractStructuredData(text);
  const descriptionTag = metaTags.find(tag => tag.key === 'description');
  const robotsTag = metaTags.find(tag => tag.key === 'robots');
  const viewportTag = metaTags.find(tag => tag.key === 'viewport');
  const charsetPresent = hasCharset(text, metaTags);
  const htmlLangPresent = hasHtmlLang(text);

  if (!title?.content) {
    pushFinding(findings, {
      message: 'Missing <title> tag.',
      recommendation: 'Add a unique and descriptive <title> tag to the document head.',
      severity: 'error',
      line: 0
    });
  } else {
    if (title.content.length < 10) {
      pushFinding(findings, {
        message: 'Title is too short.',
        recommendation: 'Make the title at least 10 characters long and descriptive.',
        severity: 'warning',
        line: title.line
      });
    }
    if (title.content.length > 70) {
      pushFinding(findings, {
        message: 'Title is too long.',
        recommendation: 'Keep the title under 70 characters so it displays well in search results.',
        severity: 'warning',
        line: title.line
      });
    }
  }

  if (!descriptionTag?.content) {
    pushFinding(findings, {
      message: 'Missing meta description.',
      recommendation: 'Add a <meta name="description"> tag that clearly summarizes the page.',
      severity: 'warning',
      line: 0
    });
  } else {
    if (descriptionTag.content.length < 50) {
      pushFinding(findings, {
        message: 'Meta description is too short.',
        recommendation: 'Use at least 50 characters to summarize the page clearly.',
        severity: 'warning',
        line: descriptionTag.line
      });
    }
    if (descriptionTag.content.length > 160) {
      pushFinding(findings, {
        message: 'Meta description is too long.',
        recommendation: 'Keep the description under 160 characters for search snippets.',
        severity: 'warning',
        line: descriptionTag.line
      });
    }
  }

  if (!robotsTag?.content) {
    pushFinding(findings, {
      message: 'Missing robots meta tag.',
      recommendation: 'Add <meta name="robots" content="index,follow"> or an appropriate robots policy.',
      severity: 'warning',
      line: 0
    });
  }

  const duplicateKeys = Array.from(
    new Set(metaTags.map(tag => tag.key).filter((key, index, keys) => key && keys.indexOf(key) !== index))
  );
  if (duplicateKeys.length > 0) {
    pushFinding(findings, {
      message: `Duplicate meta tags detected: ${duplicateKeys.join(', ')}.`,
      recommendation: 'Remove duplicate meta tags and keep only one instance per name/property.',
      severity: 'warning',
      line: metaTags.find(tag => duplicateKeys.includes(tag.key))?.line ?? 0
    });
  }

  if (!canonicalLink?.href) {
    pushFinding(findings, {
      message: 'Missing canonical link.',
      recommendation: 'Add a <link rel="canonical" href="https://example.com/page"> tag to specify the preferred URL.',
      severity: 'warning',
      line: canonicalLink?.line ?? 0
    });
  } else if (isCanonicalSuspicious(canonicalLink.href)) {
    pushFinding(findings, {
      message: 'Canonical link is not an absolute HTTP(S) URL.',
      recommendation: 'Use an absolute canonical URL, including protocol and host.',
      severity: 'warning',
      line: canonicalLink.line
    });
  }

  if (h1Tags.length === 0) {
    pushFinding(findings, {
      message: 'Missing <h1> heading.',
      recommendation: 'Add one clear <h1> heading to describe the page topic.',
      severity: 'warning',
      line: 0
    });
  } else if (h1Tags.length > 1) {
    pushFinding(findings, {
      message: 'Multiple <h1> headings detected.',
      recommendation: 'Use a single primary <h1> for page structure and accessibility.',
      severity: 'warning',
      line: h1Tags[1].line
    });
  }

  if (h2Tags.length === 0) {
    pushFinding(findings, {
      message: 'No <h2> headings found.',
      recommendation: 'Use <h2> headings to structure sections under the main topic.',
      severity: 'warning',
      line: 0
    });
  }

  for (let index = 1; index < headings.length; index += 1) {
    const previous = headings[index - 1];
    const current = headings[index];
    if (current.level - previous.level > 1) {
      pushFinding(findings, {
        message: `Heading hierarchy skips from H${previous.level} to H${current.level}.`,
        recommendation: 'Keep heading levels in order so readers and crawlers can follow the document structure.',
        severity: 'warning',
        line: current.line
      });
    }
  }

  images.forEach((image, index) => {
    if (image.alt === null || image.alt.trim() === '') {
      pushFinding(findings, {
        message: `Image ${index + 1} is missing alt text.`,
        recommendation: 'Add a descriptive alt attribute for accessibility and image SEO.',
        severity: 'warning',
        line: image.line
      });
    }
  });

  if (!viewportTag?.content) {
    pushFinding(findings, {
      message: 'Missing viewport meta tag.',
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for responsive pages.',
      severity: 'warning',
      line: 0
    });
  }

  if (!charsetPresent) {
    pushFinding(findings, {
      message: 'Missing charset declaration.',
      recommendation: 'Add <meta charset="UTF-8"> near the top of the document head.',
      severity: 'warning',
      line: 0
    });
  }

  if (!htmlLangPresent) {
    pushFinding(findings, {
      message: 'Missing HTML lang attribute.',
      recommendation: 'Add a lang attribute to the <html> tag, such as <html lang="en">.',
      severity: 'warning',
      line: getHtmlTagLine(text)
    });
  }

  if (structuredData.length === 0) {
    pushFinding(findings, {
      message: 'No JSON-LD structured data found.',
      recommendation: 'Add JSON-LD structured data when it fits the page type to improve rich-result eligibility.',
      severity: 'warning',
      line: 0
    });
  } else {
    structuredData
      .filter(script => !script.valid)
      .forEach(script => {
        pushFinding(findings, {
          message: 'Invalid JSON-LD structured data.',
          recommendation: 'Fix the JSON syntax inside the application/ld+json script.',
          severity: 'warning',
          line: script.line
        });
      });
  }

  const errors = findings.filter(finding => finding.severity === 'error').length;
  const warnings = findings.length - errors;
  const score = Math.max(0, 100 - errors * 12 - warnings * 4);
  const categoryScores = buildCategoryScores(findings, score);
  const fileLabel = filePath ? ` for ${filePath}` : '';
  const summary = `Found ${findings.length} issue${findings.length === 1 ? '' : 's'}${fileLabel}; SEO score ${score}/100.`;

  return {
    score,
    categoryScores,
    metadata: {
      title,
      metaTags,
      links,
      headings,
      images,
      structuredData,
      hasCharset: charsetPresent,
      hasHtmlLang: htmlLangPresent
    },
    summary,
    findings
  };
}
