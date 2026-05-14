import * as vscode from 'vscode';
import { analyzeSeo, SeoFinding, SeoReport } from './audit';

let diagnosticCollection: vscode.DiagnosticCollection;
let reportPanel: vscode.WebviewPanel | undefined;
let lastReport: { report: SeoReport; document: vscode.TextDocument } | undefined;

const SUPPORTED_LANGUAGE_IDS = new Set([
  'html',
  'handlebars',
  'php',
  'vue',
  'svelte',
  'astro',
  'javascriptreact',
  'typescriptreact'
]);

function isSupportedDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
    return false;
  }

  if (SUPPORTED_LANGUAGE_IDS.has(document.languageId)) {
    return true;
  }

  return /\.(html?|xhtml|php|vue|svelte|astro|jsx|tsx)$/i.test(document.fileName);
}

function createDiagnosticForFinding(document: vscode.TextDocument, finding: SeoFinding): vscode.Diagnostic {
  const line = Math.min(Math.max(finding.line, 0), Math.max(document.lineCount - 1, 0));
  const lineText = document.lineAt(line);
  const diagnosticRange = lineText.range.isEmpty ? new vscode.Range(line, 0, line, 1) : lineText.range;
  const severity = finding.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
  const diagnostic = new vscode.Diagnostic(diagnosticRange, finding.message, severity);
  diagnostic.source = 'SEO Health Checker';
  diagnostic.code = 'seo-health-checker';
  diagnostic.relatedInformation = [
    new vscode.DiagnosticRelatedInformation(
      new vscode.Location(document.uri, diagnosticRange),
      finding.recommendation
    )
  ];
  return diagnostic;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getScoreClass(score: number): string {
  if (score >= 85) {
    return 'good';
  }
  if (score >= 60) {
    return 'ok';
  }
  return 'poor';
}

function renderEmpty(message: string): string {
  return `<p class="muted">${escapeHtml(message)}</p>`;
}

function renderLineButton(line: number): string {
  return `<button class="line-link" data-line="${line}">Line ${line + 1}</button>`;
}

function renderValue(value: string | null | undefined): string {
  return value ? escapeHtml(value) : '<span class="muted">Not found</span>';
}

function renderMetadataRows(report: SeoReport): string {
  const rows = [
    ['Title', report.metadata.title?.content || '', report.metadata.title?.line ?? 0],
    ...report.metadata.metaTags.map(tag => [`Meta: ${tag.key || 'unknown'}`, tag.content, tag.line]),
    ['Charset', report.metadata.hasCharset ? 'Present' : 'Missing', 0],
    ['HTML language', report.metadata.hasHtmlLang ? 'Present' : 'Missing', 0]
  ];

  return rows.length === 0
    ? renderEmpty('No metadata found.')
    : `<div class="data-table">${rows.map(([label, value, line]) => `
        <div class="data-row">
          <div class="data-label">${escapeHtml(String(label))}</div>
          <div class="data-value">${renderValue(String(value))}</div>
          <div>${renderLineButton(Number(line))}</div>
        </div>
      `).join('')}</div>`;
}

function renderHeadings(report: SeoReport): string {
  return report.metadata.headings.length === 0
    ? renderEmpty('No headings found.')
    : `<div class="data-table">${report.metadata.headings.map(heading => `
        <div class="data-row">
          <div class="data-label">H${heading.level}</div>
          <div class="data-value">${renderValue(heading.content)}</div>
          <div>${renderLineButton(heading.line)}</div>
        </div>
      `).join('')}</div>`;
}

function renderLinks(report: SeoReport): string {
  return report.metadata.links.length === 0
    ? renderEmpty('No links found.')
    : `<div class="data-table">${report.metadata.links.map(link => `
        <div class="data-row">
          <div class="data-label">${escapeHtml(link.rel || 'link')}</div>
          <div class="data-value">${renderValue(link.href)}</div>
          <div>${renderLineButton(link.line)}</div>
        </div>
      `).join('')}</div>`;
}

function renderImages(report: SeoReport): string {
  return report.metadata.images.length === 0
    ? renderEmpty('No images found.')
    : `<div class="data-table">${report.metadata.images.map((image, index) => `
        <div class="data-row">
          <div class="data-label">Image ${index + 1}</div>
          <div class="data-value">
            <div>${renderValue(image.src)}</div>
            <div class="muted">Alt: ${renderValue(image.alt)}</div>
          </div>
          <div>${renderLineButton(image.line)}</div>
        </div>
      `).join('')}</div>`;
}

function renderStructuredData(report: SeoReport): string {
  return report.metadata.structuredData.length === 0
    ? renderEmpty('No JSON-LD structured data found.')
    : `<div class="data-table">${report.metadata.structuredData.map((script, index) => `
        <div class="data-row">
          <div class="data-label">JSON-LD ${index + 1}</div>
          <div class="data-value">${script.valid ? 'Valid JSON' : 'Invalid JSON'}</div>
          <div>${renderLineButton(script.line)}</div>
        </div>
      `).join('')}</div>`;
}

function getReportHtml(report: SeoReport, document: vscode.TextDocument, nonce: string): string {
  const errors = report.findings.filter(finding => finding.severity === 'error').length;
  const warnings = report.findings.filter(finding => finding.severity === 'warning').length;
  const scoreClass = getScoreClass(report.score);
  const categoryScoresHtml = report.categoryScores.map(category => `
    <div class="stat category ${getScoreClass(category.score)}">
      <span class="stat-value">${category.score}</span>
      <span class="stat-label">${escapeHtml(category.label)}</span>
      <span class="stat-note">${category.issues} issue${category.issues === 1 ? '' : 's'}</span>
    </div>
  `).join('');
  const findingsHtml = report.findings.length === 0
    ? `<section class="empty">
        <div class="empty-mark">✓</div>
        <h2>No SEO issues found</h2>
        <p>This document passes the current SEO Health Checker rules.</p>
      </section>`
    : report.findings.map((finding, index) => `
        <article class="finding ${finding.severity}">
          <div class="finding-top">
            <span class="badge">${escapeHtml(finding.severity)}</span>
            <button class="line-link" data-line="${finding.line}">Line ${finding.line + 1}</button>
          </div>
          <h3>${index + 1}. ${escapeHtml(finding.message)}</h3>
          <p>${escapeHtml(finding.recommendation)}</p>
        </article>
      `).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SEO Health Checker Report</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --panel: var(--vscode-editor-background);
      --surface: var(--vscode-sideBar-background);
      --surface-strong: var(--vscode-editorWidget-background);
      --border: var(--vscode-panel-border);
      --text: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-button-background);
      --accent-text: var(--vscode-button-foreground);
      --good: #2ea043;
      --ok: #d29922;
      --poor: #f85149;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--text);
      background: var(--panel);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.5;
    }

    .shell {
      max-width: 980px;
      margin: 0 auto;
      padding: 28px;
    }

    .hero {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 24px;
      align-items: center;
      padding: 24px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }

    .score {
      width: 144px;
      height: 144px;
      display: grid;
      place-items: center;
      border: 8px solid currentColor;
      border-radius: 50%;
      color: var(--ok);
    }

    .score.good { color: var(--good); }
    .score.poor { color: var(--poor); }

    .score-number {
      font-size: 42px;
      font-weight: 800;
      line-height: 1;
    }

    .score-label {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
      text-transform: uppercase;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      line-height: 1.2;
    }

    .path {
      margin: 0 0 18px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .categories {
      grid-template-columns: repeat(5, minmax(0, 1fr));
      margin-top: 18px;
    }

    .stat {
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-strong);
    }

    .stat-value {
      display: block;
      font-size: 24px;
      font-weight: 700;
    }

    .stat-label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }

    .stat-note {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
    }

    .category.good {
      border-color: color-mix(in srgb, var(--good) 55%, var(--border));
    }

    .category.ok {
      border-color: color-mix(in srgb, var(--ok) 55%, var(--border));
    }

    .category.poor {
      border-color: color-mix(in srgb, var(--poor) 55%, var(--border));
    }

    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin: 28px 0 12px;
    }

    h2 {
      margin: 0;
      font-size: 18px;
    }

    button {
      border: 0;
      border-radius: 4px;
      color: var(--accent-text);
      background: var(--accent);
      cursor: pointer;
      font: inherit;
      padding: 7px 12px;
    }

    button:hover {
      opacity: 0.9;
    }

    .findings {
      display: grid;
      gap: 10px;
    }

    .finding {
      padding: 16px;
      border: 1px solid var(--border);
      border-left: 4px solid var(--ok);
      border-radius: 8px;
      background: var(--surface);
    }

    .finding.error {
      border-left-color: var(--poor);
    }

    .finding-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .badge {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .line-link {
      color: var(--vscode-textLink-foreground);
      background: transparent;
      padding: 0;
    }

    .finding h3 {
      margin: 0 0 6px;
      font-size: 15px;
    }

    .finding p {
      margin: 0;
      color: var(--muted);
    }

    .empty {
      padding: 42px 24px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      text-align: center;
    }

    .empty-mark {
      width: 52px;
      height: 52px;
      display: grid;
      place-items: center;
      margin: 0 auto 14px;
      border-radius: 50%;
      color: white;
      background: var(--good);
      font-size: 28px;
      font-weight: 800;
    }

    .details {
      display: grid;
      gap: 14px;
      margin-top: 24px;
    }

    .detail-section {
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }

    .detail-section h2 {
      margin-bottom: 12px;
    }

    .data-table {
      display: grid;
      gap: 8px;
    }

    .data-row {
      display: grid;
      grid-template-columns: minmax(120px, 180px) minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
      padding: 10px 0;
      border-top: 1px solid var(--border);
    }

    .data-row:first-child {
      border-top: 0;
      padding-top: 0;
    }

    .data-label {
      color: var(--muted);
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .data-value {
      overflow-wrap: anywhere;
    }

    .muted {
      color: var(--muted);
    }

    @media (max-width: 700px) {
      .shell {
        padding: 16px;
      }

      .hero {
        grid-template-columns: 1fr;
      }

      .score {
        width: 120px;
        height: 120px;
      }

      .stats {
        grid-template-columns: 1fr;
      }

      .data-row {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="score ${scoreClass}">
        <div>
          <div class="score-number">${report.score}</div>
          <div class="score-label">Score</div>
        </div>
      </div>
      <div>
        <h1>SEO Health Report</h1>
        <p class="path">${escapeHtml(document.fileName)}</p>
        <div class="stats">
          <div class="stat">
            <span class="stat-value">${report.findings.length}</span>
            <span class="stat-label">Issues</span>
          </div>
          <div class="stat">
            <span class="stat-value">${errors}</span>
            <span class="stat-label">Errors</span>
          </div>
          <div class="stat">
            <span class="stat-value">${warnings}</span>
            <span class="stat-label">Warnings</span>
          </div>
        </div>
      </div>
    </section>

    <section class="stats categories">
      ${categoryScoresHtml}
    </section>

    <div class="toolbar">
      <h2>Recommendations</h2>
      <button id="refresh" type="button">Refresh</button>
    </div>

    <section class="findings">
      ${findingsHtml}
    </section>

    <section class="details">
      <article class="detail-section">
        <h2>Extracted Metadata</h2>
        ${renderMetadataRows(report)}
      </article>

      <article class="detail-section">
        <h2>Structured Data</h2>
        ${renderStructuredData(report)}
      </article>

      <article class="detail-section">
        <h2>Headings</h2>
        ${renderHeadings(report)}
      </article>

      <article class="detail-section">
        <h2>Links</h2>
        ${renderLinks(report)}
      </article>

      <article class="detail-section">
        <h2>Images</h2>
        ${renderImages(report)}
      </article>
    </section>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('refresh')?.addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });

    document.querySelectorAll('[data-line]').forEach(button => {
      button.addEventListener('click', () => {
        vscode.postMessage({
          command: 'openLine',
          line: Number(button.getAttribute('data-line'))
        });
      });
    });
  </script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function showWebviewReport(context: vscode.ExtensionContext, report: SeoReport, document: vscode.TextDocument): void {
  lastReport = { report, document };

  if (!reportPanel) {
    reportPanel = vscode.window.createWebviewPanel(
      'seoHealthChecker.report',
      'SEO Health Checker',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri]
      }
    );

    reportPanel.onDidDispose(() => {
      reportPanel = undefined;
    }, null, context.subscriptions);

    reportPanel.webview.onDidReceiveMessage(async message => {
      if (message.command === 'refresh') {
        const editor = vscode.window.activeTextEditor;
        if (editor && isSupportedDocument(editor.document)) {
          const refreshedReport = analyzeDocument(editor.document);
          if (refreshedReport) {
            showWebviewReport(context, refreshedReport, editor.document);
          }
        }
      }

      if (message.command === 'openLine' && lastReport) {
        const line = Math.min(Math.max(Number(message.line) || 0, 0), lastReport.document.lineCount - 1);
        const editor = await vscode.window.showTextDocument(lastReport.document, vscode.ViewColumn.One);
        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
    }, undefined, context.subscriptions);
  }

  reportPanel.title = `SEO Health: ${report.score}/100`;
  reportPanel.webview.html = getReportHtml(report, document, createNonce());
  reportPanel.reveal(vscode.ViewColumn.Beside);
}

function analyzeDocument(document: vscode.TextDocument): SeoReport | undefined {
  if (!isSupportedDocument(document)) {
    diagnosticCollection.delete(document.uri);
    return undefined;
  }

  const report = analyzeSeo(document.getText(), document.fileName);
  const diagnostics = report.findings.map(finding => createDiagnosticForFinding(document, finding));
  diagnosticCollection.set(document.uri, diagnostics);

  return report;
}

export function activate(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('seoHealthChecker');

  const analyzeCommand = vscode.commands.registerCommand('seoHealthChecker.analyzeCurrentDocument', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open a web document and run the command again.');
      return;
    }

    if (!isSupportedDocument(editor.document)) {
      vscode.window.showWarningMessage('SEO Health Checker supports HTML, PHP, Vue, Svelte, Astro, JSX, and TSX documents.');
      return;
    }

    const report = analyzeDocument(editor.document);
    if (!report) {
      return;
    }

    showWebviewReport(context, report, editor.document);

    if (report.findings.length === 0) {
      vscode.window.showInformationMessage('SEO Health Checker found no issues.');
    } else {
      vscode.window.showInformationMessage(`SEO Health Checker found ${report.findings.length} issue${report.findings.length === 1 ? '' : 's'} with a score of ${report.score}/100.`);
    }
  });

  const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document === vscode.window.activeTextEditor?.document) {
      const report = analyzeDocument(event.document);
      if (reportPanel && report) {
        showWebviewReport(context, report, event.document);
      }
    }
  });

  const saveSubscription = vscode.workspace.onDidSaveTextDocument(document => {
    const report = analyzeDocument(document);
    if (reportPanel && report) {
      showWebviewReport(context, report, document);
    }
  });

  const closeSubscription = vscode.workspace.onDidCloseTextDocument(document => {
    diagnosticCollection.delete(document.uri);
  });

  if (vscode.window.activeTextEditor) {
    analyzeDocument(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    analyzeCommand,
    changeSubscription,
    saveSubscription,
    closeSubscription,
    diagnosticCollection
  );
}

export function deactivate(): void {
  diagnosticCollection?.dispose();
}
