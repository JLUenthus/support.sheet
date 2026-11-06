// ============================================================
// guide.sheet – guides-export-docx.js (Word-Export eines Guides, gebaut für den Import in Confluence)
// Baut aus dem Markdown eines Guides ein echtes WordprocessingML-Dokument (JSZip + eigenes XML, keine weitere Bibliothek, kein DOM, kein Netzwerk):
//   - Seite A4, Rand 2 cm; Überschriften mit den Word-Formatvorlagen Heading1 bis Heading4 (Confluence übernimmt sie als Überschriften)
//   - jedes Bild als wp:inline in einem eigenen Absatz (links, Abstand davor und danach), eindeutige docPr-Kennung, Alternativtext aus dem Markdown
//   - Anzeigegröße je Bild: höchstens 600 px breit und 1000 px hoch, Seitenverhältnis erhalten, nie vergrößert (Confluence lehnt Bilder über 900 x 1200 px beim Word-Import ab)
//   - Originaldatei bleibt unverändert eingebettet (PNG, JPEG, GIF, BMP); Typen, die Word nicht kennt (WEBP, SVG), werden vor dem Einbetten in PNG umgewandelt
//   - keine Textfelder, Formen, mc:AlternateContent; Tabellen einfach (Kopfzeile, ohne verbundene Zellen, ohne Verschachtelung); Codeblöcke als Absätze der Formatvorlage Code;
//     Aufgabenlisten als ☐ und ☑ im Text; Listen als echte Word-Listen (numbering.xml)
// Browser: window.GuidesExportDocx (erwartet JSZip und marked vorher); Node: require('./guides-export-docx.js') (für tests/guides-export-docx.test.js).
//   build({ title, markdown, links, attachments, getImage, convertToPng }) -> Promise<{ bytes: Uint8Array, stats }>
//     getImage(href) -> Promise<{ bytes, type?, name? } | null>   (null oder Ausnahme: Bild fehlt, an seiner Stelle steht "[Bild nicht übernommen: Name]")
//     convertToPng({ bytes, type, target: { width, height } | null }) -> Promise<{ bytes, width, height }>   (Standard: Canvas im Browser)
//   stats: { images, converted, skipped: [Name], embedded, bytes }
// Die private Notiz ist nie Teil der Quelle (sie steht nicht im Markdown), es gibt keinen Speicherzugriff.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./jszip.min.js'), require('./marked.min.js'));
  else root.GuidesExportDocx = factory(root.JSZip, root.marked);
}(typeof self !== 'undefined' ? self : this, function (JSZip, marked) {
  'use strict';

  const MAX_W = 600, MAX_H = 1000;          // Anzeigegröße in px (96 dpi): A4-Textbreite ist 642 px, 600 px bleiben darunter
  const PX = 9525;                           // EMU je Pixel
  const TEXT_TWIPS = 11906 - 2 * 1134;       // A4 abzüglich zweimal 2 cm Rand
  const CONVERT_MAX_W = 2400;
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  // ── Hilfen ──
  const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

  // Anzeigegröße: nie vergrößern, Breite höchstens 600, Höhe höchstens 1000, Seitenverhältnis erhalten
  function displaySize(w, h, maxW) {
    const mw = Math.min(MAX_W, maxW || MAX_W);
    const s = Math.min(1, mw / w, MAX_H / h);
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  // ── Bildtyp und Maße aus den Bytes (nicht aus Dateiname oder Typangabe) ──
  function sniff(b) {
    const u = (i) => b[i];
    if (b.length > 24 && u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47) return 'png';
    if (b.length > 4 && u(0) === 0xFF && u(1) === 0xD8) return 'jpeg';
    if (b.length > 10 && u(0) === 0x47 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x38) return 'gif';
    if (b.length > 26 && u(0) === 0x42 && u(1) === 0x4D) return 'bmp';
    if (b.length > 30 && u(0) === 0x52 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x46 && u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50) return 'webp';
    const head = String.fromCharCode.apply(null, Array.prototype.slice.call(b, 0, Math.min(b.length, 600)));
    if (/<svg[\s>]/i.test(head)) return 'svg';
    return 'unknown';
  }
  function sizeOf(b, type) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    try {
      if (type === 'png') return { w: dv.getUint32(16), h: dv.getUint32(20) };
      if (type === 'gif') return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
      if (type === 'bmp') return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
      if (type === 'jpeg') {
        let i = 2;
        while (i + 9 < b.length) {
          if (b[i] !== 0xFF) { i++; continue; }
          const m = b[i + 1];
          if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
          const len = dv.getUint16(i + 2);
          if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
          i += 2 + len;
        }
        return null;
      }
      if (type === 'webp') {
        const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
        if (tag === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
        if (tag === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3FFF, h: dv.getUint16(28, true) & 0x3FFF };
        if (tag === 'VP8L') { const v = dv.getUint32(21, true); return { w: 1 + (v & 0x3FFF), h: 1 + ((v >> 14) & 0x3FFF) }; }
        return null;
      }
      if (type === 'svg') {
        const t = new TextDecoder('utf-8').decode(b.subarray(0, Math.min(b.length, 4000)));
        const tag = (/<svg[^>]*>/i.exec(t) || [''])[0];
        const num = (n) => { const m = new RegExp('\\b' + n + '\\s*=\\s*["\']\\s*([0-9.]+)\\s*(px)?\\s*["\']', 'i').exec(tag); return m ? parseFloat(m[1]) : null; };
        let w = num('width'), h = num('height');
        if (!(w > 0 && h > 0)) { const vb = /viewBox\s*=\s*["']\s*[-0-9.]+[ ,]+[-0-9.]+[ ,]+([0-9.]+)[ ,]+([0-9.]+)/i.exec(tag); if (vb) { w = parseFloat(vb[1]); h = parseFloat(vb[2]); } }
        return w > 0 && h > 0 ? { w: Math.round(w), h: Math.round(h) } : null;
      }
    } catch (e) { /* abgeschnittene Datei */ }
    return null;
  }

  // ── Umwandlung für Typen, die Word nicht kennt: Canvas (nur im Browser) ──
  async function canvasConvert(opt) {
    const blob = new Blob([opt.bytes], { type: opt.type === 'svg' ? 'image/svg+xml' : 'image/webp' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Bild nicht lesbar')); img.src = url; });
      let w = opt.target && opt.target.width || img.naturalWidth || 300, h = opt.target && opt.target.height || img.naturalHeight || 150;
      if (w > CONVERT_MAX_W) { h = Math.round(h * CONVERT_MAX_W / w); w = CONVERT_MAX_W; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const out = await new Promise((res) => c.toBlob(res, 'image/png'));
      if (!out) throw new Error('PNG nicht erzeugt');
      return { bytes: new Uint8Array(await out.arrayBuffer()), width: w, height: h };
    } finally { URL.revokeObjectURL(url); }
  }

  // ── festes Gerüst ──
  const CT_DEFAULTS = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="bmp" ContentType="image/bmp"/>';
  const CT_OVERRIDES = '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>';
  const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  function stylesXml() {
    const head = (n, sz, before, after) => '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="' + before + '" w:after="' + after + '"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr><w:rPr><w:b/><w:color w:val="1F2937"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr></w:style>';
    return XMLH + '<w:styles ' + NS + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
      + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>'
      + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>'
      + head(1, 36, 360, 160) + head(2, 30, 300, 120) + head(3, 26, 240, 100) + head(4, 24, 200, 80)
      + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="6" w:color="C7CBD6"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>'
      + '<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="9CA3AF"/></w:pBdr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="4B5563"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Bild"><w:name w:val="Bild"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepLines/><w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr></w:style>'
      + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>'
      + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/></w:tblBorders></w:tblPr></w:style>'
      + '</w:styles>';
  }
  function numberingXml(orderedNums) {
    const fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
    let lv0 = '', lv1 = '';
    for (let i = 0; i < 9; i++) {
      lv0 += '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="' + (i % 2 ? '◦' : '•') + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 * (i + 1)) + '" w:hanging="360"/></w:pPr></w:lvl>';
      lv1 += '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmts[i % 3] + '"/><w:lvlText w:val="%' + (i + 1) + '."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 * (i + 1)) + '" w:hanging="360"/></w:pPr></w:lvl>';
    }
    let nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    orderedNums.forEach((o) => { nums += '<w:num w:numId="' + o.id + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="' + o.start + '"/></w:lvlOverride></w:num>'; });
    return XMLH + '<w:numbering ' + NS + '><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + lv0 + '</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + lv1 + '</w:abstractNum>' + nums + '</w:numbering>';
  }

  // ── Aufbau ──
  async function build(opt) {
    const title = (opt.title || '').trim() || 'Unbenannt';
    const getImage = opt.getImage || (async () => null);
    const convert = opt.convertToPng || canvasConvert;
    const zip = new JSZip();
    const stats = { images: 0, converted: 0, skipped: [], embedded: 0, bytes: 0 };
    const body = [];
    const rels = [];                 // { id, type, target, external }
    const media = new Map();         // href -> { rId, name, ext, w, h }
    const orderedNums = [];
    let docPrId = 0, relSeq = 0, mediaSeq = 0, numSeq = 1;

    const addRel = (type, target, external) => { const id = 'rId' + (100 + (++relSeq)); rels.push({ id, type, target, external }); return id; };

    // Läufe
    const runXml = (text, f) => {
      const parts = String(text).split('\n');
      let rPr = '';
      if (f.link) rPr += '<w:rStyle w:val="Hyperlink"/>'; else if (f.code) rPr += '<w:rStyle w:val="CodeChar"/>';
      if (f.b) rPr += '<w:b/>'; if (f.i) rPr += '<w:i/>'; if (f.s) rPr += '<w:strike/>';
      const rp = rPr ? '<w:rPr>' + rPr + '</w:rPr>' : '';
      return parts.map((p, k) => (k ? '<w:r>' + rp + '<w:br/></w:r>' : '') + (p === '' ? '' : '<w:r>' + rp + '<w:t xml:space="preserve">' + esc(p) + '</w:t></w:r>')).join('');
    };
    const safeHref = (h) => /^(https?:|mailto:)/i.test(h || '') ? h : null;

    // Inline-Tokens -> Teile: { run: xml } | { image: token }
    function inline(tokens, f, out) {
      for (const t of tokens || []) {
        if (t.type === 'text' || t.type === 'escape') { if (t.tokens && t.tokens.length) inline(t.tokens, f, out); else out.push({ run: runXml(unesc(t.text), f) }); }
        else if (t.type === 'strong') inline(t.tokens, Object.assign({}, f, { b: true }), out);
        else if (t.type === 'em') inline(t.tokens, Object.assign({}, f, { i: true }), out);
        else if (t.type === 'del') inline(t.tokens, Object.assign({}, f, { s: true }), out);
        else if (t.type === 'codespan') out.push({ run: runXml(unesc(t.text), Object.assign({}, f, { code: true })) });
        else if (t.type === 'br') out.push({ run: '<w:r><w:br/></w:r>' });
        else if (t.type === 'image') out.push({ image: t });
        else if (t.type === 'link') {
          const href = safeHref(t.href);
          if (!href) { inline(t.tokens, f, out); continue; }
          const sub = []; inline(t.tokens, Object.assign({}, f, { link: true }), sub);
          const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', href, true);
          let runs = ''; sub.forEach((p) => { if (p.run) runs += p.run; else out.push(p); });
          out.push({ run: '<w:hyperlink r:id="' + rid + '" w:history="1">' + runs + '</w:hyperlink>' });
        }
        else if (t.type === 'html') { if (/^<br\s*\/?>$/i.test((t.text || t.raw || '').trim())) out.push({ run: '<w:r><w:br/></w:r>' }); }
        else if (t.raw) out.push({ run: runXml(unesc(t.raw), f) });
      }
    }

    const pPr = (o) => {
      let x = '';
      if (o.style) x += '<w:pStyle w:val="' + o.style + '"/>';
      if (o.keepNext) x += '<w:keepNext/>';
      if (o.num) x += '<w:numPr><w:ilvl w:val="' + o.num.lvl + '"/><w:numId w:val="' + o.num.id + '"/></w:numPr>';
      if (o.spacing) x += o.spacing;
      if (o.ind) x += '<w:ind w:left="' + o.ind + '"/>';
      if (o.jc) x += '<w:jc w:val="' + o.jc + '"/>';
      return x ? '<w:pPr>' + x + '</w:pPr>' : '';
    };
    const para = (runs, o) => '<w:p>' + pPr(o || {}) + runs + '</w:p>';

    // ein Bild als wp:inline in eigenem Absatz
    async function imageParagraph(tok, ctx) {
      const href = tok.href || '';
      const alt = unesc(tok.text || '').trim();
      let name = decodeURIComponentSafe(href.split('/').pop().split('?')[0]) || 'Bild';
      const fail = () => { stats.skipped.push(name); return para(runXml('[Bild nicht übernommen: ' + name + ']', {}), { style: ctx.style, ind: ctx.ind }); };
      let m = media.get(href);
      if (!m) {
        let img = null;
        try { img = await getImage(href); } catch (e) { img = null; }
        if (!img || !img.bytes || !img.bytes.length) return fail();
        if (img.name) name = img.name;
        let bytes = img.bytes instanceof Uint8Array ? img.bytes : new Uint8Array(img.bytes);
        const type = sniff(bytes);
        let size = sizeOf(bytes, type);
        let ext = type;
        if (type === 'unknown') return fail();
        if (type === 'webp' || type === 'svg') {          // Word kennt diese Typen nicht: vor dem Einbetten in PNG umwandeln (mit Anzeigegröße gerechnet, höchstens 2400 px Breite)
          let target = null;
          if (size) { const d = displaySize(size.w, size.h, ctx.maxW); let tw = d.w * 2, th = d.h * 2; if (type === 'webp') { tw = Math.min(tw, size.w); th = Math.min(th, size.h); } if (tw > CONVERT_MAX_W) { th = Math.round(th * CONVERT_MAX_W / tw); tw = CONVERT_MAX_W; } target = { width: Math.max(1, Math.round(tw)), height: Math.max(1, Math.round(th)) }; }
          try {
            const c = await convert({ bytes, type, target });
            if (!c || !c.bytes || sniff(c.bytes) !== 'png') return fail();
            bytes = c.bytes; ext = 'png'; stats.converted++;
            if (!size) size = { w: c.width, h: c.height };
          } catch (e) { return fail(); }
        }
        if (!size || !(size.w > 0 && size.h > 0)) return fail();
        const file = 'image' + (++mediaSeq) + '.' + (ext === 'jpeg' ? 'jpg' : ext);
        zip.file('word/media/' + file, bytes, { compression: 'STORE' });      // bereits komprimiert, Originalbytes unverändert
        stats.embedded++;
        m = { rId: addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', 'media/' + file, false), file, w: size.w, h: size.h };
        media.set(href, m);
      }
      const d = displaySize(m.w, m.h, ctx.maxW);
      const cx = d.w * PX, cy = d.h * PX, id = ++docPrId;
      const descr = esc(alt || name);
      stats.images++;
      return '<w:p>' + pPr({ style: 'Bild', ind: ctx.ind }) + '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Bild ' + id + '" descr="' + descr + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + esc(m.file) + '" descr="' + descr + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + m.rId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }
    function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

    // Inline-Tokens -> Absätze (Bilder eigene Absätze, Text davor und danach getrennt)
    async function inlineParagraphs(tokens, ctx, pOpt) {
      const parts = []; inline(tokens, ctx.fmt || {}, parts);
      const out = []; let runs = '', first = true;
      const flush = (force) => { if (runs || force) { out.push(para(runs, Object.assign({}, pOpt, first ? {} : { num: null }))); first = false; } runs = ''; };
      for (const p of parts) {
        if (p.run) runs += p.run;
        else { flush(false); out.push(await imageParagraph(p.image, ctx)); first = false; }
      }
      if (runs || !out.length) flush(true);
      return out;
    }

    const HEAD = { 1: 'Heading1', 2: 'Heading2', 3: 'Heading3', 4: 'Heading4' };
    // Blöcke -> XML-Teile
    async function blocks(tokens, ctx, out) {
      for (const t of tokens || []) {
        if (t.type === 'space') continue;
        if (t.type === 'heading') {
          const ps = await inlineParagraphs(t.tokens, ctx, { style: HEAD[Math.min(4, t.depth)], keepNext: true });
          ps.forEach((x) => out.push(x));
        } else if (t.type === 'paragraph' || t.type === 'text') {
          const ps = await inlineParagraphs(t.tokens || [{ type: 'text', text: t.text || '' }], ctx, { style: ctx.style, ind: ctx.ind });
          ps.forEach((x) => out.push(x));
        } else if (t.type === 'code') {
          String(t.text || '').replace(/\r\n/g, '\n').split('\n').forEach((line) => {
            const runs = line === '' ? '' : '<w:r><w:t xml:space="preserve">' + esc(line.replace(/\t/g, '    ')) + '</w:t></w:r>';
            out.push('<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>' + runs + '</w:p>');
          });
          out.push('<w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>');
        } else if (t.type === 'blockquote') {
          await blocks(t.tokens, Object.assign({}, ctx, { style: 'Quote' }), out);
        } else if (t.type === 'hr') {
          out.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="9CA3AF"/></w:pBdr></w:pPr></w:p>');
        } else if (t.type === 'list') {
          await list(t, 0, ctx, out);
        } else if (t.type === 'table') {
          out.push(await table(t, ctx));
          out.push('<w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>');
        } else if (t.type === 'html') {
          const txt = unesc(String(t.text || t.raw || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
          if (txt) out.push(para(runXml(txt, {}), { style: ctx.style, ind: ctx.ind }));
        } else if (t.raw && String(t.raw).trim()) out.push(para(runXml(unesc(String(t.raw).trim()), {}), { style: ctx.style, ind: ctx.ind }));
      }
    }

    async function list(l, lvl, ctx, out) {
      const level = Math.min(lvl, 8);
      let numId = 1;
      if (l.ordered) { numId = ++numSeq; orderedNums.push({ id: numId, start: Number(l.start) > 0 ? Number(l.start) : 1 }); }
      for (const item of l.items) {
        const ind = 720 * (level + 1);
        let used = false;
        for (const c of item.tokens) {
          if (c.type === 'list') { await list(c, lvl + 1, ctx, out); continue; }
          if (c.type === 'text' || c.type === 'paragraph') {
            const prefix = item.task ? [{ type: 'text', text: item.checked ? '☑ ' : '☐ ' }] : [];
            const toks = prefix.concat(c.tokens || [{ type: 'text', text: c.text || '' }]);
            const o = item.task ? { style: 'ListParagraph', ind } : { style: 'ListParagraph', num: { lvl: level, id: numId } };
            const ps = await inlineParagraphs(toks, Object.assign({}, ctx, { ind }), o);
            ps.forEach((x) => out.push(x)); used = true;
          } else if (c.type !== 'space') { await blocks([c], Object.assign({}, ctx, { ind }), out); used = true; }
        }
        if (!used) out.push(para(runXml(item.task ? (item.checked ? '☑ ' : '☐ ') : '', {}), { style: 'ListParagraph', num: item.task ? null : { lvl: level, id: numId }, ind: item.task ? ind : null }));
      }
    }

    async function table(tb, ctx) {
      const cols = Math.max(1, tb.header.length);
      const wTw = Math.floor(TEXT_TWIPS / cols);
      const cellMaxPx = Math.max(16, Math.floor(wTw / 15) - 14);
      const cell = async (c, head, al, w) => {
        const o = { style: null, jc: al === 'center' ? 'center' : al === 'right' ? 'right' : null };
        const ps = await inlineParagraphs(c.tokens, { fmt: head ? { b: true } : {}, maxW: cellMaxPx }, o);
        return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (head ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E9F3"/>' : '') + '</w:tcPr>' + ps.join('') + '</w:tc>';
      };
      let x = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="' + (wTw * cols) + '" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>' + '<w:gridCol w:w="' + wTw + '"/>'.repeat(cols) + '</w:tblGrid>';
      x += '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>';
      for (let i = 0; i < cols; i++) x += await cell(tb.header[i], true, tb.align[i], wTw);
      x += '</w:tr>';
      for (const row of tb.rows) {
        x += '<w:tr><w:trPr><w:cantSplit/></w:trPr>';
        for (let i = 0; i < cols; i++) x += await cell(row[i] || { tokens: [] }, false, tb.align[i], wTw);
        x += '</w:tr>';
      }
      return x + '</w:tbl>';
    }

    // ── Inhalt: Titel, Markdown, Links, Dateien ──
    const tokens = marked.lexer(String(opt.markdown || ''));
    const firstHead = tokens.find((t) => t.type !== 'space');
    const sameTitle = firstHead && firstHead.type === 'heading' && firstHead.depth === 1 && unesc(firstHead.text || '').trim() === title;
    if (!sameTitle) body.push(para(runXml(title, {}), { style: 'Heading1', keepNext: true }));
    await blocks(tokens, {}, body);
    const links = Array.isArray(opt.links) ? opt.links.filter((l) => l && l.url) : [];
    if (links.length) {
      body.push(para(runXml('Links', {}), { style: 'Heading2', keepNext: true }));
      for (const l of links) {
        const label = l.text && String(l.text).trim() ? String(l.text).trim() : l.url;
        const sub = []; inline([{ type: 'link', href: l.url, tokens: [{ type: 'text', text: esc(label).replace(/&amp;/g, '&amp;') }] }], {}, sub);
        body.push(para(sub.map((p) => p.run || '').join(''), { style: 'ListParagraph', num: { lvl: 0, id: 1 } }));
      }
    }
    const atts = Array.isArray(opt.attachments) ? opt.attachments : [];
    if (atts.length) {
      body.push(para(runXml('Dateien', {}), { style: 'Heading2', keepNext: true }));
      atts.forEach((a) => body.push(para(runXml(a && a.name || '', {}), { style: 'ListParagraph', num: { lvl: 0, id: 1 } })));
    }
    body.push('<w:p/>');        // Dokument endet nicht mit einer Tabelle

    const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
    const documentXml = XMLH + '<w:document ' + NS + '><w:body>' + body.join('') + sect + '</w:body></w:document>';

    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const docRels = [{ id: 'rId1', type: REL + 'styles', target: 'styles.xml' }, { id: 'rId2', type: REL + 'numbering', target: 'numbering.xml' }, { id: 'rId3', type: REL + 'settings', target: 'settings.xml' }].concat(rels);
    const relsXml = XMLH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + docRels.map((r) => '<Relationship Id="' + r.id + '" Type="' + r.type + '" Target="' + esc(r.target) + '"' + (r.external ? ' TargetMode="External"' : '') + '/>').join('') + '</Relationships>';
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    zip.file('[Content_Types].xml', XMLH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + CT_DEFAULTS + CT_OVERRIDES + '</Types>');
    zip.file('_rels/.rels', XMLH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="' + REL + 'extended-properties" Target="docProps/app.xml"/></Relationships>');
    zip.file('word/document.xml', documentXml);
    zip.file('word/_rels/document.xml.rels', relsXml);
    zip.file('word/styles.xml', stylesXml());
    zip.file('word/numbering.xml', numberingXml(orderedNums));
    zip.file('word/settings.xml', XMLH + '<w:settings ' + NS + '><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/></w:settings>');
    zip.file('docProps/core.xml', XMLH + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + esc(title) + '</dc:title><dc:creator>support.sheet</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>');
    zip.file('docProps/app.xml', XMLH + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>support.sheet</Application></Properties>');

    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    stats.bytes = bytes.length;
    return { bytes, stats };
  }

  return { build, displaySize, sniff, sizeOf, MAX_W, MAX_H };
}));
