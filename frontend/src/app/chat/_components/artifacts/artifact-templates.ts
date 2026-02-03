// CRITICAL

export const buildSvgDocument = (svgCode: string, scale: number = 1) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
    }
    .container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .svg-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: scale(${scale});
      transform-origin: center center;
      transition: transform 0.2s ease;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="svg-wrapper">
      ${svgCode}
    </div>
  </div>
</body>
</html>
`;

export const buildReactDocument = (code: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #root {
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
    }
    .error {
      color: #b91c1c;
      font-family: ui-monospace, monospace;
      white-space: pre-wrap;
      padding: 16px;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error" class="error" style="display:none;"></div>
  <script type="text/babel" data-presets="react,typescript">
    (() => {
      const send = (type, message) => {
        try { window.parent?.postMessage({ type, message }, '*'); } catch {}
      };
      const showError = (message) => {
        const el = document.getElementById('error');
        if (el) { el.style.display = 'block'; el.textContent = message; }
      };
      window.addEventListener('error', (event) => {
        const msg = event?.error?.stack || event?.message || 'Unknown error';
        send('error', msg);
        showError(msg);
      });
      try {
        window.__DEFAULT_EXPORT__ = undefined;
        const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } = React;

        // Strip imports/exports for iframe execution
        ${code
          .replace(/^\s*import\s+.*?;?\s*$/gm, "")
          .replace(/^\s*export\s+\{[^}]+\}\s*;?\s*$/gm, "")
          .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, "$1 ")
          .replace(/\bexport\s+default\s+/g, "window.__DEFAULT_EXPORT__ = ")}

        const container = document.getElementById('root');
        const root = ReactDOM.createRoot(container);
        const candidate = (typeof App !== 'undefined' && App) || window.__DEFAULT_EXPORT__ || null;
        if (!candidate) {
          showError('Define an App component or use export default.');
          return;
        }
        const element = React.isValidElement(candidate) ? candidate : React.createElement(candidate);
        root.render(element);
      } catch (e) {
        const msg = e?.stack || e?.message || 'Failed to render';
        send('error', msg);
        showError(msg);
      }
    })();
  </script>
</body>
</html>
`;

export const buildJsDocument = (code: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    body { font-family: system-ui, sans-serif; padding: 16px; background: transparent; min-height: 100vh; }
    #output { white-space: pre-wrap; font-family: monospace; }
  </style>
</head>
<body>
  <div id="output"></div>
  <script>
    const output = document.getElementById('output');
    const send = (type, message) => {
      try { window.parent?.postMessage({ type, message }, '*'); } catch {}
    };
    const log = (...args) => {
      const line = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') + '\\n';
      output.textContent += line;
      send('output', line);
    };
    console.log = log;
    console.info = log;
    console.warn = log;
    console.error = (...args) => { log(...args); send('error', args.map(String).join(' ')); };
    window.addEventListener('error', (e) => send('error', e?.error?.stack || e?.message || 'Error'));
    try { ${code} } catch (e) { output.textContent = 'Error: ' + e.message; send('error', e?.stack || String(e)); }
  </script>
</body>
</html>
`;

export const buildHtmlDocument = (code: string) => {
  if (
    code.trim().toLowerCase().startsWith("<!doctype") ||
    code.trim().toLowerCase().startsWith("<html")
  ) {
    return code;
  }
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    body { font-family: system-ui, sans-serif; background: transparent; min-height: 100vh; }
  </style>
</head>
<body>
  ${code}
</body>
</html>
`;
};

export const buildTextDocument = (code: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0a0a0a; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; padding: 16px; color: #d8d4cd; }
    pre { white-space: pre-wrap; }
  </style>
</head>
<body>
  <pre>${code}</pre>
</body>
</html>
`;
