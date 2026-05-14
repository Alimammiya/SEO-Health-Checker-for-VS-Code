# SEO Health Checker for VS Code

This extension analyzes the current open web document and reports on-page SEO issues such as title quality, meta description, robots tags, canonical URLs, headings, image alt text, viewport, charset, language, and JSON-LD structured data.

## Features

- Scores Meta Tags, Structured Data, Headings, Images, and Overall SEO Health.
- Shows file diagnostics for missing title, meta description, canonical, viewport, charset, language, H1, structured data, and missing image alt text.
- Opens a report panel with issues, recommendations, extracted metadata, headings, links, images, and structured data.
- Supports common PHP SEO variables such as `$pageTitle`, `$metaDescription`, `$metaKeywords`, and `$canonicalURL` when pages include shared headers.

## Setup

1. Open the `Vscode` folder in VS Code.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` to launch the extension in a development host window.

## Repository

GitHub: https://github.com/Alimammiya/SEO-Health-Checker-for-VS-Code.git

## Usage

- Open an HTML, PHP, Vue, Svelte, Astro, JSX, or TSX file in VS Code.
- Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
- Run `SEO Health Checker: Analyze Current Document`.
- Review the visual score report that opens beside your document.

## Notes

- Diagnostics are also reported in the Problems panel.
- The report panel includes score cards, category scores, issue severity, recommendations, extracted metadata, headings, links, images, structured data, and line links.
- Supported documents are checked automatically while editing.
