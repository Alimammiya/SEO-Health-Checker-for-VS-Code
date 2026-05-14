const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzeSeo } = require('../dist/audit');

const healthyDocument = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Complete SEO Health Checker Landing Page</title>
    <meta name="description" content="A clear and useful landing page description that stays within the ideal search snippet length for testing.">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="https://example.com/seo-health-checker">
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"WebPage","name":"SEO Health Checker"}
    </script>
  </head>
  <body>
    <h1>SEO Health Checker</h1>
    <h2>Audit important tags</h2>
    <img src="/preview.png" alt="SEO Health Checker preview">
  </body>
</html>`;

test('returns a perfect score for a complete SEO document', () => {
  const report = analyzeSeo(healthyDocument, 'healthy.html');

  assert.equal(report.score, 100);
  assert.equal(report.findings.length, 0);
  assert.equal(report.categoryScores.length, 5);
  assert.equal(report.metadata.title.content, 'Complete SEO Health Checker Landing Page');
  assert.equal(report.metadata.metaTags.some(tag => tag.key === 'description'), true);
  assert.equal(report.metadata.headings.length, 2);
  assert.equal(report.metadata.links[0].href, 'https://example.com/seo-health-checker');
  assert.equal(report.metadata.images[0].src, '/preview.png');
  assert.equal(report.metadata.structuredData[0].valid, true);
});

test('detects common missing SEO elements', () => {
  const report = analyzeSeo('<html><head><title>Short</title></head><body><h3>Skipped</h3><img src="x.jpg"></body></html>');
  const messages = report.findings.map(finding => finding.message);

  assert.ok(messages.includes('Title is too short.'));
  assert.ok(messages.includes('Missing meta description.'));
  assert.ok(messages.includes('Missing canonical link.'));
  assert.ok(messages.includes('Missing <h1> heading.'));
  assert.ok(messages.includes('Image 1 is missing alt text.'));
  assert.ok(messages.includes('Missing HTML lang attribute.'));
});

test('flags relative canonical URLs and invalid JSON-LD', () => {
  const report = analyzeSeo(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reasonable title for a page</title>
    <meta name="description" content="This description is long enough for the analyzer and short enough for a search result snippet.">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="/relative-path">
    <script type="application/ld+json">{"@context": "https://schema.org",</script>
  </head>
  <body><h1>Main heading</h1><h2>Section</h2></body>
</html>`);
  const messages = report.findings.map(finding => finding.message);

  assert.ok(messages.includes('Canonical link is not an absolute HTTP(S) URL.'));
  assert.ok(messages.includes('Invalid JSON-LD structured data.'));
});

test('reads PHP output blocks inside meta tag attributes', () => {
  const report = analyzeSeo(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reasonable title for a PHP page</title>
    <meta name="description" content="<?php echo htmlspecialchars($description, ENT_QUOTES); ?>">
    <meta name="robots" content="<?php echo $robots; ?>">
    <link rel="canonical" href="https://example.com/php-page">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
  </head>
  <body><h1>PHP page</h1><h2>Section</h2></body>
</html>`, 'index.php');
  const messages = report.findings.map(finding => finding.message);

  assert.ok(!messages.includes('Missing meta description.'));
  assert.ok(!messages.includes('Missing robots meta tag.'));
});

test('reads common PHP SEO variables before a header include', () => {
  const report = analyzeSeo(`<?php
$pageTitle = $pageTitle ?? "Modern Off Page SEO Book - Advanced Link Building";
$metaDescription = $metaDescription ?? "Modern Off-Page SEO is a practical guide for SEO professionals who want to master advanced off-page optimization.";
$metaKeywords = $metaKeywords ?? "off page seo book, advanced link building book";
$canonicalURL = $canonicalURL ?? "https://alimammiya.com/off-page-seo-book";

include 'header.php'; ?>`, 'off-page-seo-book.php');
  const messages = report.findings.map(finding => finding.message);

  assert.ok(!messages.includes('Missing <title> tag.'));
  assert.ok(!messages.includes('Missing meta description.'));
  assert.ok(!messages.includes('Missing canonical link.'));
  assert.ok(!messages.includes('Canonical link is not an absolute HTTP(S) URL.'));
});
