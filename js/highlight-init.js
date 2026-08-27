// ============================================================
// support.sheet - highlight.js Bootstrap
// js/highlight.min.js und js/highlight-powershell.min.js sind die
// offiziellen, vorgebauten Zero-Language-ES-Module von highlight.js
// 11.9.0 (kein CDN, kein eigenes Build-Tooling - siehe Auftrag
// PS-Scripts-Guide Schritt 3, Nachpruefung). Registriert die
// PowerShell-Grammatik und stellt window.hljs bereit, damit
// js/script-overlay.js unveraendert per "if (window.hljs)" darauf
// zugreifen kann.
// ============================================================
import hljs from './highlight.min.js';
import powershell from './highlight-powershell.min.js';

hljs.registerLanguage('powershell', powershell);
window.hljs = hljs;
