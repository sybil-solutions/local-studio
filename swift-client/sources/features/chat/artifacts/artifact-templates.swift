import Foundation

enum ArtifactTemplates {
  private static let darkCSS = """
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%; height: 100%;
      background: #1c1b19;
      color: #efece7;
      font-family: -apple-system, system-ui, sans-serif;
      -webkit-text-size-adjust: 100%;
    }
    a { color: #8c53c6; }
    pre, code { font-family: ui-monospace, monospace; font-size: 13px; }
    """

  static func html(_ code: String) -> String {
    let lower = code.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if lower.hasPrefix("<!doctype") || lower.hasPrefix("<html") {
      return code
    }
    return """
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0" />
      <style>\(darkCSS)
      body { min-height: 100vh; }
      </style>
    </head>
    <body>
      \(code)
    </body>
    </html>
    """
  }

  static func svg(_ code: String) -> String {
    let svgMarkup: String
    if code.contains("<svg") {
      svgMarkup = code
    } else {
      svgMarkup = """
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\(code)</svg>
      """
    }
    return """
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0" />
      <style>
        \(darkCSS)
        body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
        svg { max-width: 100%; max-height: 90vh; width: auto; height: auto; }
      </style>
    </head>
    <body>
      \(svgMarkup)
    </body>
    </html>
    """
  }

  static func react(_ code: String) -> String {
    let stripped = code
      .replacingOccurrences(of: #"^\s*import\s+.*?;?\s*$"#, with: "", options: .regularExpression)
      .replacingOccurrences(of: #"^\s*export\s+\{[^}]+\}\s*;?\s*$"#, with: "", options: .regularExpression)
      .replacingOccurrences(of: #"^\s*export\s+(const|let|var|function|class)\s+"#, with: "$1 ", options: .regularExpression)
      .replacingOccurrences(of: #"\bexport\s+default\s+"#, with: "window.__DEFAULT_EXPORT__ = ", options: .regularExpression)

    return """
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0" />
      <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
      <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
      <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        \(darkCSS)
        #root { width: 100%; min-height: 100vh; }
        .error { color: #d14747; font-family: ui-monospace, monospace; white-space: pre-wrap; padding: 16px; }
      </style>
    </head>
    <body>
      <div id="root"></div>
      <div id="error" class="error" style="display:none;"></div>
      <script type="text/babel" data-presets="react,typescript">
        (() => {
          const showError = (msg) => {
            const el = document.getElementById('error');
            if (el) { el.style.display = 'block'; el.textContent = msg; }
          };
          window.addEventListener('error', (e) => showError(e?.error?.stack || e?.message || 'Error'));
          try {
            window.__DEFAULT_EXPORT__ = undefined;
            const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } = React;
            \(stripped)
            const container = document.getElementById('root');
            const root = ReactDOM.createRoot(container);
            const candidate = (typeof App !== 'undefined' && App) || window.__DEFAULT_EXPORT__ || null;
            if (!candidate) { showError('Define an App component or use export default.'); return; }
            const element = React.isValidElement(candidate) ? candidate : React.createElement(candidate);
            root.render(element);
          } catch (e) { showError(e?.stack || e?.message || 'Failed to render'); }
        })();
      </script>
    </body>
    </html>
    """
  }

  static func markdown(_ code: String) -> String {
    let escaped = code
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "`", with: "\\`")
      .replacingOccurrences(of: "$", with: "\\$")
    return """
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0" />
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <style>
        \(darkCSS)
        body { padding: 16px; line-height: 1.6; }
        h1, h2, h3, h4 { margin-top: 1em; margin-bottom: 0.5em; color: #efece7; }
        p { margin-bottom: 0.8em; }
        ul, ol { padding-left: 1.5em; margin-bottom: 0.8em; }
        code { background: #2a2725; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
        pre { background: #2a2725; padding: 12px; border-radius: 8px; overflow-x: auto; margin-bottom: 1em; }
        pre code { background: none; padding: 0; }
        blockquote { border-left: 3px solid #8c53c6; padding-left: 12px; color: #9a9590; margin-bottom: 0.8em; }
        table { border-collapse: collapse; margin-bottom: 1em; }
        th, td { border: 1px solid #2a2725; padding: 8px 12px; }
        th { background: #2a2725; }
      </style>
    </head>
    <body>
      <div id="content"></div>
      <script>
        document.getElementById('content').innerHTML = marked.parse(`\(escaped)`);
      </script>
    </body>
    </html>
    """
  }

  static func render(_ artifact: Artifact) -> String {
    switch artifact.type {
    case .html: return html(artifact.code)
    case .svg: return svg(artifact.code)
    case .react: return react(artifact.code)
    case .markdown: return markdown(artifact.code)
    }
  }
}
