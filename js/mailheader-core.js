// ============================================================
// mailheader-core.js – Parser und Auswertung für Mail-Header (mailheader.html), ohne DOM, in Node testbar
// Alles läuft lokal: keine Netzwerkabfragen (kein DNS, WHOIS, Geolocation, keine Blocklisten), keine Speicherung. Der Rumpf der Nachricht wird verworfen.
// IP-Adressen werden nur nach Art eingeordnet (privat, Loopback, Link-Local, öffentlich). Auffälligkeiten sind Hinweise mit Begründung, nie ein Urteil.
// Erklärungen zu Microsoft-Headern (MS_*): nur Angaben, die gegen die Dokumentation von Microsoft Learn belegt sind (Eintrag q = Kennung in tests/mailheader-verification.json).
// Was sich nicht belegen lässt, erscheint als "ohne Erklärung" mit dem Rohwert.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MailHeaderCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_CHARS = 5 * 1024 * 1024;
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const ZONES = { UT: 0, UTC: 0, GMT: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
  const WARN_MS = 5 * 60 * 1000, HINT_MS = 60 * 1000, DATE_BEFORE_MS = 24 * 3600 * 1000;
  const MULTI_TLD = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.cn', 'co.za', 'co.in', 'com.tr', 'com.mx']);
  const SEV_ORDER = { warnung: 0, hinweis: 1, info: 2 };

  // ── Erklärungen zu Microsoft-Headern (Belege: tests/mailheader-verification.json) ──
  const MS_FFAR = {
    CIP: { t: 'Verbindende IP-Adresse (kann in der IP-Zulassungs- oder Sperrliste stehen).', q: 'ffar.CIP' },
    CTRY: { t: 'Herkunftsland laut verbindender IP-Adresse; muss nicht das Land der ursprünglichen Absender-IP sein.', q: 'ffar.CTRY' },
    DIR: { t: 'Richtung der Nachricht.', q: 'ffar.DIR', v: { INB: 'eingehend', OUT: 'ausgehend', INT: 'intern' } },
    H: { t: 'HELO/EHLO-Zeichenfolge des verbindenden Mailservers.', q: 'ffar.H' },
    IPV: { t: 'Ergebnis der IP-Reputationsprüfung.', q: 'ffar.IPV', v: { CAL: 'Spamfilter übersprungen: Quell-IP steht in der IP-Zulassungsliste', NLI: 'IP stand auf keiner IP-Reputationsliste' } },
    LANG: { t: 'Sprache der Nachricht als Ländercode (zum Beispiel ru_RU).', q: 'ffar.LANG' },
    PTR: { t: 'PTR-Eintrag (Reverse-DNS) der Quell-IP-Adresse.', q: 'ffar.PTR' },
    SCL: { t: 'Spam Confidence Level. In Cloud-Organisationen entscheidet dieser Wert nicht, ob eine Nachricht als Spam gilt oder welche Aktion folgt; dafür CAT und DIR ansehen.', q: 'ffar.SCL' },
    SFTY: { t: 'Nachricht als Phishing erkannt, mit Zusatzwert.', q: 'ffar.SFTY', v: { '9.19': 'Domain-Imitation (Absenderdomain versucht, eine geschützte Domain zu imitieren)', '9.20': 'Benutzer-Imitation', '9.25': 'Sicherheitshinweis bei Erstkontakt (kann auf verdächtige oder Phishing-Nachricht hindeuten)' } },
    SFV: { t: 'Ergebnis der Spamfilterung.', q: 'ffar.SFV', v: {
      BLK: 'Filterung übersprungen, blockiert: Absender steht in der Liste blockierter Absender des Benutzers',
      NSPM: 'als kein Spam eingestuft und zugestellt',
      SFE: 'Filterung übersprungen, zugelassen: Absender steht in der Liste sicherer Absender des Benutzers',
      SKA: 'Spamfilter übersprungen: Absender oder Domain steht in der Zulassungsliste einer Anti-Spam-Richtlinie',
      SKB: 'als Spam markiert: Absender oder Domain steht in der Sperrliste einer Anti-Spam-Richtlinie',
      SKI: 'Spamfilter übersprungen: Quell-IP steht in der IP-Zulassungsliste der Verbindungsfilter-Richtlinie',
      SKN: 'Spamfilter übersprungen wegen einer Exchange-Transportregel',
      SKQ: 'aus der Quarantäne freigegeben und zugestellt',
      SKS: 'vor der Spamfilterung als Spam markiert (Transportregel oder Entscheidung aus lokalem Exchange im Hybridbetrieb)',
      SPM: 'vom Spamfilter als Spam markiert',
    } },
    SRV: { t: 'Einstufung durch den Spamfilter.', q: 'ffar.SRV', v: { BULK: 'als Massenmail erkannt (Bulk-Complaint-Level-Schwelle)' } },
    CAT: { t: 'Kategorie der angewendeten Bedrohungsrichtlinie.', q: 'ffar.CAT', v: {
      AMP: 'Anti-Malware', BIMP: 'Markenimitation (nur Defender for Office 365)', BULK: 'Massenmail', DIMP: 'Domain-Imitation (nur Defender for Office 365)', FTBP: 'Anti-Malware, Filter für häufige Anhänge',
      GIMP: 'Postfachintelligenz-Imitation (nur Defender for Office 365)', HPHSH: 'Phishing mit hoher Sicherheit', HPHISH: 'Phishing mit hoher Sicherheit', HSPM: 'Spam mit hoher Sicherheit', INTOS: 'Phishing innerhalb der Organisation',
      MALW: 'Malware', OSPM: 'ausgehender Spam', PHSH: 'Phishing', SAP: 'Safe Attachments (nur Defender for Office 365)', SPM: 'Spam', SPOOF: 'Spoofing', UIMP: 'Benutzer-Imitation (nur Defender for Office 365)',
    } },
    ARC: { t: 'Felder des ARC-Protokolls (AAR, AMS, AS); AS enthält die Kettenprüfung cv=none, pass oder fail.', q: 'ffar.ARC' },
  };
  const MS_ANTISPAM = { BCL: { t: 'Bulk Complaint Level: ein höherer Wert bedeutet, dass die Massenmail wahrscheinlicher Beschwerden auslöst (und damit eher Spam ist).', q: 'antispam.BCL' } };
  const MS_AR = {
    spf: { pass: 'Die Quelle steht im SPF-Eintrag der Domain und darf für die Domain senden oder weiterleiten.', fail: 'Die Quelle steht nicht im SPF-Eintrag, die Domain verlangt Ablehnung (-all, "hard fail").', softfail: 'Die Quelle steht nicht im SPF-Eintrag, die Domain verlangt Annahme mit Markierung (~all, "soft fail").', neutral: 'Die Quelle steht nicht im SPF-Eintrag, die Domain gibt keine Anweisung (?all).', none: 'Die Domain hat keinen SPF-Eintrag, oder der Eintrag ergibt kein Ergebnis.', temperror: 'Vorübergehender Fehler (zum Beispiel DNS); dieselbe Prüfung kann später gelingen.', permerror: 'Dauerhafter Fehler (zum Beispiel falsch formatierter SPF-Eintrag).', q: 'ar.spf' },
    dkim: { pass: 'Die DKIM-Prüfung ist bestanden.', fail: 'Die DKIM-Prüfung ist fehlgeschlagen (zum Beispiel Nachricht nicht signiert oder Signatur nicht verifiziert), Grund in Klammern.', none: 'Die Nachricht war nicht signiert (sagt nichts darüber, ob die Domain einen DKIM-Eintrag hat).', q: 'ar.dkim' },
    dmarc: { pass: 'Die DMARC-Prüfung ist bestanden.', fail: 'Die DMARC-Prüfung ist fehlgeschlagen.', bestguesspass: 'Für die Domain gibt es keinen DMARC-TXT-Eintrag; mit Eintrag würde die Nachricht bestehen.', none: 'Für die Absenderdomain gibt es keinen DMARC-TXT-Eintrag im DNS.', q: 'ar.dmarc' },
    action: { 'pct.quarantine': 'DMARC fehlgeschlagen, Richtlinie p=quarantine, wegen pct unter 100 Prozent trotzdem zugestellt.', 'pct.reject': 'DMARC fehlgeschlagen, Richtlinie p=reject, wegen pct unter 100 Prozent trotzdem zugestellt.', permerror: 'Dauerhafter Fehler bei der DMARC-Auswertung (zum Beispiel falsch formatierter DMARC-Eintrag).', temperror: 'Vorübergehender Fehler bei der DMARC-Auswertung.', q: 'ar.action' },
    compauth: { t: 'Zusammengesetztes Authentifizierungsergebnis: Microsoft 365 kombiniert SPF, DKIM, DMARC und weitere Teile der Nachricht, Grundlage ist die Domain im From. Trotz compauth-Fehler kann die Nachricht zugestellt werden, wenn andere Prüfungen nichts Verdächtiges ergeben.', q: 'ar.compauth' },
  };
  const MS_REASON = [
    ['000', 'Explizite Authentifizierung fehlgeschlagen: DMARC fail, Richtlinie p=quarantine oder p=reject.'],
    ['001', 'Implizite Authentifizierung fehlgeschlagen: Die Absenderdomain hat keine oder nur schwache Authentifizierungs-Einträge (SPF ~all oder ?all, DMARC p=none).'],
    ['002', 'Eine Richtlinie der Organisation verbietet dem Absender/Domain-Paar ausdrücklich, gefälschte Mails zu senden (vom Administrator eingestellt).'],
    ['010', 'DMARC fehlgeschlagen, Richtlinie p=reject oder p=quarantine, und die Absenderdomain ist eine akzeptierte Domain der eigenen Organisation (Spoofing innerhalb der Organisation).'],
    ['100', 'SPF oder DKIM bestanden, und die Domains von MAIL FROM und From sind ausgerichtet.'],
    ['101', 'Die Nachricht wurde von der Domain des From-Absenders DKIM-signiert.'],
    ['102', 'Die Domains von MAIL FROM und From sind ausgerichtet, SPF bestanden.'],
    ['103', 'Die Domain der From-Adresse passt zum PTR-Eintrag der Quell-IP.'],
    ['104', 'Der PTR-Eintrag der Quell-IP passt zur Domain der From-Adresse.'],
    ['108', 'DKIM fehlgeschlagen wegen einer Änderung des Nachrichtentexts durch frühere, legitime Hops (zum Beispiel im lokalen Mailsystem der Organisation).'],
    ['109', 'Die Absenderdomain hat keinen DMARC-Eintrag, die Nachricht würde trotzdem bestehen.'],
    ['111', 'Trotz vorübergehendem oder dauerhaftem DMARC-Fehler passt die SPF- oder DKIM-Domain zur Domain der From-Adresse.'],
    ['112', 'Ein DNS-Zeitlimit verhinderte das Abrufen des DMARC-Eintrags.'],
    ['115', 'Gesendet aus einer Microsoft-365-Organisation, in der die Domain der From-Adresse als akzeptierte Domain eingerichtet ist.'],
    ['116', 'Der MX-Eintrag der From-Domain passt zum PTR-Eintrag der verbindenden IP.'],
    ['130', 'Das ARC-Ergebnis eines vertrauenswürdigen ARC-Siegelgebers hat den DMARC-Fehler außer Kraft gesetzt.'],
    ['201', 'Der PTR-Eintrag der From-Domain passt zum Subnetz des PTR-Eintrags der verbindenden IP.'],
    ['202', 'Die Domain der From-Adresse passt zur Domain des PTR-Eintrags der verbindenden IP.'],
    ['501', 'DMARC nicht erzwungen: gültiger Unzustellbarkeitsbericht (NDR), Kontakt zwischen Absender und Empfänger bestand schon.'],
    ['502', 'DMARC nicht erzwungen: gültiger NDR zu einer Nachricht aus dieser Organisation.'],
    ['601', 'Die Absenderdomain ist eine akzeptierte Domain der Organisation (Spoofing innerhalb der Organisation).'],
    ['701-704', 'DMARC nicht erzwungen, weil die Organisation bereits legitime Nachrichten von dieser Infrastruktur erhalten hat.'],
    ['905', 'DMARC nicht erzwungen wegen komplexer Weiterleitung (zum Beispiel über lokales Exchange oder einen Dienst außerhalb von Microsoft).'],
    ['1xx', 'Explizite oder implizite Authentifizierung bestanden (compauth=pass).'],
    ['2xx', 'Implizite Authentifizierung "soft-pass" (compauth=softpass).'],
    ['3xx', 'Nicht auf zusammengesetzte Authentifizierung geprüft (compauth=none).'],
    ['4xx', 'Zusammengesetzte Authentifizierung umgangen (compauth=none).'],
    ['6xx', 'Implizite Authentifizierung fehlgeschlagen (compauth=fail).'],
    ['7xx', 'Implizite Authentifizierung bestanden (compauth=pass).'],
    ['9xx', 'Zusammengesetzte Authentifizierung umgangen (compauth=none).'],
  ];
  const MS_ORG = {
    'x-ms-exchange-organization-scl': { name: 'X-MS-Exchange-Organization-SCL', t: 'Spam Confidence Level der Nachricht (0 bis 9, größer = verdächtiger; -1 nimmt die Nachricht von der Inhaltsfilterung aus). Laut Dokumentation zu Exchange Server 2013; in Cloud-Organisationen bestimmt der Wert nicht das Spam-Urteil.', q: 'org.SCL' },
    'x-ms-exchange-organization-authas': { name: 'X-MS-Exchange-Organization-AuthAs', t: 'Authentifizierungsquelle der Nachricht; mögliche Werte Anonymous, Internal, External oder Partner (laut Dokumentation zu Exchange Server 2013).', q: 'org.AuthAs', v: { anonymous: 'Anonymous', internal: 'Internal', external: 'External', partner: 'Partner' } },
    'x-ms-exchange-organization-authsource': { name: 'X-MS-Exchange-Organization-AuthSource', t: 'FQDN des Servers, der die Authentifizierung der Nachricht für die Organisation ausgewertet hat (laut Dokumentation zu Exchange Server 2013).', q: 'org.AuthSource' },
  };

  // ── Hilfsfunktionen ──
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function registrable(domain) {
    const d = String(domain || '').toLowerCase().replace(/\.$/, '');
    const p = d.split('.').filter(Boolean);
    if (p.length <= 2) return p.join('.');
    const last2 = p.slice(-2).join('.');
    return MULTI_TLD.has(last2) ? p.slice(-3).join('.') : last2;
  }
  const aligned = (a, b) => !!a && !!b && registrable(a) === registrable(b);
  const domainOf = (addr) => { const m = /@([^@\s>]+)\s*>?\s*$/.exec(String(addr || '')); return m ? m[1].toLowerCase().replace(/[>.]+$/, '') : ''; };

  function ipKind(ip) {
    const s = String(ip || '').trim().replace(/^ipv6:/i, '').replace(/^\[|\]$/g, '');
    let m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if ([a, b, Number(m[3]), Number(m[4])].some((x) => x > 255)) return null;
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'privat';
      if (a === 127) return 'Loopback';
      if (a === 169 && b === 254) return 'Link-Local';
      return 'öffentlich';
    }
    if (/^[0-9a-f:.]+$/i.test(s) && s.includes(':')) {
      const l = s.toLowerCase();
      const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
      if (mapped) return ipKind(mapped[1]);
      if (l === '::1') return 'Loopback';
      if (/^fe[89ab][0-9a-f]:/.test(l)) return 'Link-Local';
      if (/^f[cd][0-9a-f]{2}:/.test(l)) return 'privat';
      return 'öffentlich';
    }
    return null;
  }
  const isIp = (s) => ipKind(s) !== null;

  // ── RFC 2047 ──
  function decodeBytes(bytes, charset) {
    const cs = charset.toLowerCase();
    const label = { 'utf-8': 'utf-8', utf8: 'utf-8', 'iso-8859-1': 'windows-1252', latin1: 'windows-1252', 'iso-8859-15': 'iso-8859-15', 'windows-1252': 'windows-1252', cp1252: 'windows-1252', 'us-ascii': 'utf-8', ascii: 'utf-8' }[cs];
    if (!label) return null;
    try { return new TextDecoder(label, { fatal: false }).decode(new Uint8Array(bytes)); } catch (e) { return null; }
  }
  function b64Bytes(s) { try { const bin = (typeof atob === 'function' ? atob : (x) => Buffer.from(x, 'base64').toString('binary'))(s.replace(/\s+/g, '')); return Array.from(bin, (c) => c.charCodeAt(0)); } catch (e) { return null; } }
  function qBytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '_') out.push(0x20);
      else if (c === '=' && /^[0-9a-f]{2}$/i.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else out.push(c.charCodeAt(0) & 0xff);
    }
    return out;
  }
  function decodeWords(str) {
    const unknown = [];
    const s = String(str == null ? '' : str);
    const re = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;
    let out = '', last = 0, prevEncoded = false, m;
    while ((m = re.exec(s))) {
      const gap = s.slice(last, m.index);
      if (!(prevEncoded && /^\s*$/.test(gap))) out += gap;
      const cs = m[1].replace(/\*[^*]*$/, '');
      const bytes = m[2].toLowerCase() === 'b' ? b64Bytes(m[3]) : qBytes(m[3]);
      const dec = bytes ? decodeBytes(bytes, cs) : null;
      if (dec === null) { out += m[0]; if (!unknown.includes(cs)) unknown.push(cs); } else out += dec;
      last = m.index + m[0].length; prevEncoded = true;
    }
    out += s.slice(last);
    return { text: out, unknownCharsets: unknown };
  }

  // ── Header zerlegen ──
  function parse(input) {
    const text = typeof input === 'string' ? input : String(input == null ? '' : input);
    if (text.length > MAX_CHARS) return { ok: false, error: 'Die Eingabe ist größer als 5 MB und wird nicht ausgewertet.' };
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let i = 0, mbox = false;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length && /^From\s+\S+/.test(lines[i]) && !/^From:/i.test(lines[i])) { mbox = true; i++; }
    const headers = [], unparsable = [];
    let bodyDiscarded = false, headerChars = 0;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '' && headers.length) { bodyDiscarded = lines.slice(i + 1).some((l) => l.trim() !== ''); break; }
      if (line.trim() === '') continue;
      headerChars += line.length + 1;
      if (/^[ \t]/.test(line)) {
        if (headers.length) { const h = headers[headers.length - 1]; h.value += ' ' + line.trim(); h.raw += '\n' + line; } else unparsable.push(line);
        continue;
      }
      const m = /^([^\s:][^:\s]*)\s*:\s?(.*)$/.exec(line);
      if (m) headers.push({ name: m[1], lname: m[1].toLowerCase(), value: m[2].trim(), raw: line });
      else unparsable.push(line);
    }
    const map = {};
    headers.forEach((h) => { (map[h.lname] = map[h.lname] || []).push(h.value); });
    return { ok: true, headers, map, unparsable, mbox, bodyDiscarded, headerBytes: headerChars };
  }

  // ── Adressen ──
  function splitTop(s, sep) {
    const parts = []; let cur = '', q = false, c = 0, a = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && i + 1 < s.length && (q || c)) { cur += ch + s[++i]; continue; }
      if (ch === '"' && !c) q = !q;
      else if (!q && ch === '(') c++;
      else if (!q && ch === ')' && c) c--;
      else if (!q && !c && ch === '<') a = true;
      else if (!q && !c && ch === '>') a = false;
      if (ch === sep && !q && !c && !a) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
  }
  function stripComments(s) { let out = '', d = 0, q = false; for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === '"') q = !q; if (!q && ch === '(') { d++; continue; } if (!q && ch === ')' && d) { d--; continue; } if (!d) out += ch; } return out; }
  function parseAddresses(value) {
    const out = [];
    splitTop(String(value || ''), ',').forEach((part) => {
      try {
        const rawPart = part;
        const noC = stripComments(part).trim();
        const lt = noC.lastIndexOf('<'), gt = noC.indexOf('>', lt + 1);
        if (lt >= 0 && gt > lt) {
          let disp = noC.slice(0, lt).trim().replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1');
          disp = decodeWords(disp).text.trim();
          const addr = noC.slice(lt + 1, gt).trim();
          out.push({ display: disp, address: addr, domain: domainOf(addr), raw: rawPart });
        } else if (lt >= 0) out.push({ display: '', address: '', domain: '', raw: rawPart, broken: true });
        else {
          const m = /[^\s"<>(),;:]+@[^\s"<>(),;:]+/.exec(noC);
          const comment = /\(([^)]*)\)/.exec(part);
          if (m) out.push({ display: comment ? decodeWords(comment[1]).text.trim() : '', address: m[0], domain: domainOf(m[0]), raw: rawPart });
          else out.push({ display: '', address: '', domain: '', raw: rawPart, broken: true });
        }
      } catch (e) { out.push({ display: '', address: '', domain: '', raw: part, broken: true }); }
    });
    return out;
  }

  // ── Received ──
  function parseDate(s) {
    const m = /(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([+-]\d{4})|\b(UTC|UT|GMT|Z|[ECMP][SD]T)\b)?/.exec(String(s || ''));
    if (!m) return null;
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon === undefined) return null;
    let year = Number(m[3]); if (year < 100) year += year < 50 ? 2000 : 1900;
    let offMin = null;
    if (m[7]) offMin = (m[7][0] === '-' ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5)));
    else if (m[8]) offMin = ZONES[m[8].toUpperCase()];
    if (offMin === null || offMin === undefined) return null;
    const ms = Date.UTC(year, mon, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0)) - offMin * 60000;
    if (isNaN(ms)) return null;
    return { ms, zone: m[7] || m[8] || '' };
  }
  function segments(value) {
    const kw = /^(from|by|via|with|id|for)$/i; const segs = []; let depth = 0, tok = '', cur = null;
    const flush = () => { if (tok) { if (depth === 0 && kw.test(tok) && (cur === null || cur.text.trim() !== '' || cur.key !== tok.toLowerCase())) { cur = { key: tok.toLowerCase(), text: '' }; segs.push(cur); } else if (cur) cur.text += tok; tok = ''; } };
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (/\s/.test(ch) && depth === 0) { flush(); if (cur) cur.text += ' '; continue; }
      if (ch === '(' || ch === '[') depth++;
      if ((ch === ')' || ch === ']') && depth) depth--;
      tok += ch;
    }
    flush();
    return segs.map((s) => ({ key: s.key, text: s.text.trim() }));
  }
  function parseReceived(value) {
    const raw = String(value || '');
    const semi = raw.lastIndexOf(';');
    const body = semi >= 0 ? raw.slice(0, semi) : raw;
    const timeText = semi >= 0 ? raw.slice(semi + 1).trim() : '';
    const out = { raw, from: { name: '', ip: '', raw: '' }, by: '', protocol: '', tls: null, timeText, utcMs: null, zone: '', ok: true, reason: '' };
    try {
      const segs = segments(body);
      const get = (k) => (segs.find((s) => s.key === k) || {}).text || '';
      const from = get('from'), by = get('by'), withS = get('with');
      out.from.raw = from;
      out.from.name = (/^\[?[^\s(\[]+\]?/.exec(from) || [''])[0].replace(/^\[|\]$/g, '');
      const br = /\[(?:IPv6:)?([0-9a-fA-F:.]+)\]/.exec(from);
      const par = /\(\s*(?:[^()\s]+\s+)?(?:\[(?:IPv6:)?([0-9a-fA-F:.]+)\]|([0-9a-fA-F:.]+))\s*\)/.exec(from);
      out.from.ip = br ? br[1] : par ? (par[1] || par[2] || '') : (isIp(out.from.name) ? out.from.name : '');
      if (out.from.ip && !isIp(out.from.ip)) out.from.ip = '';
      out.from.ipKind = out.from.ip ? ipKind(out.from.ip) : null;
      out.by = (/^[^\s(]+/.exec(by) || [''])[0];
      out.byRaw = by;
      const proto = (/^[A-Za-z][A-Za-z0-9-]*(?:\s+Microsoft\s+SMTP\s+Server|\s+Server)?/.exec(withS) || [''])[0];
      out.protocol = withS ? (/^Microsoft SMTP Server/i.test(withS) ? 'Microsoft SMTP Server' : proto) : '';
      out.withRaw = withS;
      if (withS) {
        if (/TLS|ESMTPS|ESMTPSA|HTTPS/i.test(withS)) out.tls = true;
        else if (/^(E?SMTP|ESMTPA|LMTP|Microsoft SMTP Server)\b/i.test(withS)) out.tls = false;
        const v = /version=([A-Za-z0-9_.]+)/i.exec(withS), c = /cipher=([A-Za-z0-9_-]+)/i.exec(withS);
        out.tlsVersion = v ? v[1] : ''; out.cipher = c ? c[1] : '';
      }
      out.byExo = /\.(?:outbound\.)?protection\.outlook\.com$|\.prod\.outlook\.com$/i.test(out.by);
      out.fromExo = /\.(?:outbound\.)?protection\.outlook\.com$|\.prod\.outlook\.com$/i.test(out.from.name);
      const d = parseDate(timeText);
      if (d) { out.utcMs = d.ms; out.zone = d.zone; } else { out.ok = false; out.reason = timeText ? 'Zeitstempel nicht lesbar' : 'Zeitstempel fehlt'; }
      if (!from && !by) { out.ok = false; out.reason = 'weder from noch by erkennbar'; }
    } catch (e) { out.ok = false; out.reason = 'Zeile nicht lesbar'; }
    return out;
  }

  // ── Authentication-Results ──
  function parseAuthResults(value) {
    const parts = splitTop(String(value || ''), ';');
    // Microsoft stempelt den Header ohne authserv-id: beginnt das erste Element schon mit methode=ergebnis, gibt es keinen Servernamen
    const server = parts.length && !/^\s*[a-z0-9-]+\s*=/i.test(stripComments(parts[0])) ? parts.shift().replace(/\s+\d+\s*$/, '').trim() : '';
    const results = [];
    parts.forEach((p) => {
      const comment = (/\(([^)]*)\)/.exec(p) || [, ''])[1];
      const body = stripComments(p).trim();
      const m = /^([a-z0-9-]+)\s*=\s*([a-z0-9._-]+)/i.exec(body);
      if (!m) return;
      const props = {};
      const re = /([A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9._-]+)?)\s*=\s*("[^"]*"|[^\s;]+)/g; let pm; const rest = body.slice(m[0].length);
      while ((pm = re.exec(rest))) props[pm[1].toLowerCase()] = pm[2].replace(/^"|"$/g, '');
      const pol = /\bp=([a-z]+)/i.exec(comment);
      results.push({ method: m[1].toLowerCase(), result: m[2].toLowerCase(), comment: comment.trim(), props, policy: props['policy.published-domain-policy'] || (pol ? pol[1].toLowerCase() : '') });
    });
    return { server, results };
  }
  function parseTags(value) { const t = {}; String(value || '').split(';').forEach((p) => { const m = /^\s*([a-z]+)\s*=\s*([\s\S]*?)\s*$/i.exec(p); if (m) t[m[1].toLowerCase()] = m[2].replace(/\s+/g, ''); }); return t; }

  // ── Auswertung ──
  function explainReason(code) {
    const c = String(code || '');
    let hit = MS_REASON.find((r) => r[0] === c);
    if (!hit) hit = MS_REASON.find((r) => /^\d{3}-\d{3}$/.test(r[0]) && c >= r[0].slice(0, 3) && c <= r[0].slice(4));
    if (!hit && /^\d{3}$/.test(c)) hit = MS_REASON.find((r) => r[0] === c[0] + 'xx');
    return hit ? { code: c, text: hit[1], q: 'ar.reason' } : { code: c, text: '', q: null };
  }
  function explainForefront(value) {
    const fields = [];
    String(value || '').split(';').forEach((p) => {
      const t = p.trim(); if (!t) return;
      const i = t.indexOf(':'); const key = i < 0 ? t : t.slice(0, i), val = i < 0 ? '' : t.slice(i + 1).trim();
      const def = MS_FFAR[key.toUpperCase()];
      let erkl = '', q = null, wert = '';
      if (def) {
        erkl = def.t; q = def.q;
        if (def.v) { const parts = val.split(',').map((x) => x.trim()).filter(Boolean); const known = parts.map((x) => def.v[x] || def.v[x.toUpperCase()]).filter(Boolean); wert = parts.length && known.length === parts.length ? known.join('; ') : ''; if (!wert && val) erkl += ' Wert ohne Erklärung.'; }
      }
      fields.push({ key, value: val, erklaerung: erkl, wertErklaerung: wert, q, erklaert: !!def });
    });
    return fields;
  }

  function analyze(input, opts) {
    const p = typeof input === 'object' && input && input.headers ? input : parse(input);
    if (!p.ok) return { ok: false, error: p.error };
    const M = p.map, first = (n) => (M[n] || [])[0] || '';
    const dec = (s) => decodeWords(s);
    const unknownCs = [];
    const decode = (s) => { const d = dec(s); d.unknownCharsets.forEach((c) => { if (!unknownCs.includes(c)) unknownCs.push(c); }); return d.text; };
    const subject = decode(first('subject'));
    const addrs = (n) => (M[n] || []).flatMap((v) => parseAddresses(v));
    const from = addrs('from'), sender = addrs('sender'), replyTo = addrs('reply-to'), returnPath = addrs('return-path'), to = addrs('to'), cc = addrs('cc');
    const fromDomain = (from[0] && from[0].domain) || '';
    const msgId = first('message-id'); const msgIdDomain = domainOf(msgId.replace(/[<>]/g, ' ').trim());
    const dateRaw = first('date'), dateP = parseDate(dateRaw);

    // Hops: Received steht neueste Zeile zuerst; Reihenfolge der Auswertung: älteste zuerst
    const recvRaw = (M.received || []).slice().reverse();
    const hops = recvRaw.map((v, idx) => Object.assign({ nr: idx + 1 }, parseReceived(v)));
    let prev = null, maxDelay = null;
    hops.forEach((h) => {
      h.delayMs = null; h.clockSkew = false;
      if (h.ok && h.utcMs !== null) {
        if (prev) { const d = h.utcMs - prev.utcMs; if (d < 0) h.clockSkew = true; else { h.delayMs = d; if (maxDelay === null || d > maxDelay.delayMs) maxDelay = h; } }
        prev = h;
        h.utc = new Date(h.utcMs).toISOString();
      }
    });
    const timed = hops.filter((h) => h.ok && h.utcMs !== null);
    const totalMs = timed.length >= 2 ? Math.max(0, timed[timed.length - 1].utcMs - timed[0].utcMs) : null;
    if (maxDelay && maxDelay.delayMs > 0) maxDelay.maxDelay = true;
    hops.forEach((h) => { if (h.delayMs !== null) h.delaySeverity = h.delayMs >= WARN_MS ? 'warnung' : h.delayMs >= HINT_MS ? 'hinweis' : ''; });
    const firstPublic = hops.find((h) => h.ok && h.from.ipKind === 'öffentlich');
    if (firstPublic) firstPublic.einlieferer = true;

    // Authentifizierung
    const arList = (M['authentication-results'] || []).map((v) => parseAuthResults(v));
    const spfHdr = (M['received-spf'] || []).map((v) => { const m = /^\s*([a-z]+)/i.exec(v); return { result: m ? m[1].toLowerCase() : '', raw: v }; });
    const arc = {
      results: (M['arc-authentication-results'] || []).map((v) => { const i = /^\s*i\s*=\s*(\d+)/.exec(v); const r = parseAuthResults(v.replace(/^\s*i\s*=\s*\d+\s*;/, '')); return { instance: i ? Number(i[1]) : null, server: r.server, results: r.results }; }),
      seals: (M['arc-seal'] || []).map((v) => { const t = parseTags(v); return { instance: t.i ? Number(t.i) : null, cv: t.cv || '', d: t.d || '', s: t.s || '', a: t.a || '' }; }),
    };
    const dkimSigs = (M['dkim-signature'] || []).map((v) => { const t = parseTags(v); return { d: t.d || '', s: t.s || '', a: t.a || '', h: t.h || '' }; });
    const method = (name) => { for (const ar of arList) { const r = ar.results.find((x) => x.method === name); if (r) return Object.assign({ server: ar.server }, r); } return null; };
    const spf = method('spf'), dkim = method('dkim'), dmarc = method('dmarc'), compauth = method('compauth');
    const spfFrom = spf ? (spf.props['smtp.mailfrom'] || spf.props['smtp.helo'] || '') : '';
    const spfDomain = domainOf(spfFrom) || spfFrom.toLowerCase();
    const dkimDomain = dkim ? (dkim.props['header.d'] || dkim.props['header.i'] || '').replace(/^@/, '').toLowerCase().replace(/^none$/, '') : '';   // Microsoft schreibt header.d=none, wenn es keine Signatur gab
    const auth = {
      instances: arList, spfHeaders: spfHdr, arc, dkimSignatures: dkimSigs,
      spf: spf && { result: spf.result, server: spf.server, comment: spf.comment, mailfrom: spfFrom, domain: spfDomain, aligned: aligned(fromDomain, spfDomain), erklaerung: (MS_AR.spf[spf.result] || ''), q: MS_AR.spf[spf.result] ? MS_AR.spf.q : null },
      dkim: dkim && { result: dkim.result, server: dkim.server, comment: dkim.comment, domain: dkimDomain, aligned: aligned(fromDomain, dkimDomain), erklaerung: (MS_AR.dkim[dkim.result] || ''), q: MS_AR.dkim[dkim.result] ? MS_AR.dkim.q : null },
      dmarc: dmarc && { result: dmarc.result, server: dmarc.server, action: dmarc.props.action || '', policy: dmarc.policy, headerFrom: (dmarc.props['header.from'] || '').toLowerCase(), erklaerung: (MS_AR.dmarc[dmarc.result] || ''), actionErklaerung: MS_AR.action[dmarc.props.action] || '', q: MS_AR.dmarc[dmarc.result] ? MS_AR.dmarc.q : null },
      compauth: compauth && Object.assign({ result: compauth.result, reason: compauth.props.reason || '', server: compauth.server, erklaerung: MS_AR.compauth.t, q: MS_AR.compauth.q }, { reasonText: explainReason(compauth.props.reason).text, reasonQ: explainReason(compauth.props.reason).q }),
    };

    // Microsoft-Spamauswertung (nur belegte Angaben)
    const ms = { forefront: [], antispam: [], org: [], crossTenant: [], other: [] };
    (M['x-forefront-antispam-report'] || []).forEach((v) => { ms.forefront.push(explainForefront(v)); });
    (M['x-microsoft-antispam'] || []).forEach((v) => {
      ms.antispam.push(String(v).split(';').map((x) => x.trim()).filter(Boolean).map((t) => { const i = t.indexOf(':'); const key = i < 0 ? t : t.slice(0, i); const def = MS_ANTISPAM[key.toUpperCase()]; return { key, value: i < 0 ? '' : t.slice(i + 1).trim(), erklaerung: def ? def.t : '', q: def ? def.q : null, erklaert: !!def }; }));
    });
    Object.keys(MS_ORG).forEach((k) => {
      (M[k] || []).forEach((v) => { const def = MS_ORG[k]; ms.org.push({ name: def.name, value: v, erklaerung: def.t, wertErklaerung: def.v ? (def.v[String(v).trim().toLowerCase()] || '') : '', q: def.q, erklaert: true }); });
    });
    p.headers.forEach((h) => { if (/^x-ms-exchange-crosstenant-/.test(h.lname) || h.lname === 'x-ms-exchange-transport-crosstenantheadersstamped') ms.crossTenant.push({ name: h.name, value: h.value, erklaerung: '', erklaert: false }); });

    // Hinweise
    const hints = [];
    const hint = (id, severity, titel, begruendung, werte) => hints.push({ id, severity, titel, begruendung, werte: werte || [] });
    if (!hops.length) hint('received-fehlt', 'hinweis', 'Kein Received-Header', 'Ohne Received-Zeilen lässt sich der Weg der Nachricht nicht nachvollziehen.', []);
    if ((M.from || []).length > 1) hint('from-doppelt', 'warnung', 'Mehrere From-Header', 'Die Nachricht enthält mehrere From-Header; Mailprogramme zeigen nur einen davon an.', M.from.slice());
    if (fromDomain && returnPath[0] && returnPath[0].domain && !aligned(fromDomain, returnPath[0].domain)) hint('returnpath-abweichend', 'hinweis', 'Return-Path weicht vom Absender ab', 'Die Domain im Return-Path (Umschlagabsender) unterscheidet sich von der Domain im From. Das kommt bei Verteilern und Versanddiensten vor.', ['From: ' + fromDomain, 'Return-Path: ' + returnPath[0].domain]);
    if (fromDomain && replyTo[0] && replyTo[0].domain && !aligned(fromDomain, replyTo[0].domain)) hint('replyto-abweichend', 'hinweis', 'Reply-To weicht vom Absender ab', 'Antworten gehen an eine andere Domain als die des Absenders.', ['From: ' + fromDomain, 'Reply-To: ' + replyTo[0].domain]);
    if (from[0] && from[0].display) { const m = /[^\s"<>(),;]+@[^\s"<>(),;]+/.exec(from[0].display); if (m && m[0].toLowerCase() !== (from[0].address || '').toLowerCase()) hint('anzeigename-adresse', 'hinweis', 'Anzeigename enthält eine andere Adresse', 'Der Anzeigename im From nennt eine E-Mail-Adresse, die nicht die Adresse des Absenders ist.', ['Anzeigename: ' + from[0].display, 'Adresse: ' + from[0].address]); }
    if (from[0] && sender[0] && sender[0].address && sender[0].address.toLowerCase() !== from[0].address.toLowerCase()) hint('sender-abweichend', 'info', 'Sender weicht von From ab', 'Der Sender-Header nennt eine andere Adresse als das From (zum Beispiel bei Versand im Auftrag).', ['From: ' + from[0].address, 'Sender: ' + sender[0].address]);
    if (fromDomain && msgIdDomain && !aligned(fromDomain, msgIdDomain)) hint('messageid-fremd', 'info', 'Message-ID mit anderer Domain', 'Die Domain der Message-ID unterscheidet sich von der Domain im From.', ['From: ' + fromDomain, 'Message-ID: ' + msgIdDomain]);
    if (auth.dkim && auth.dkim.result === 'pass' && !auth.dkim.aligned) hint('dkim-nicht-ausgerichtet', 'hinweis', 'DKIM-Domain nicht ausgerichtet', 'DKIM wurde bestanden, die Signaturdomain gehört aber nicht zur Domain im From (für DMARC zählt sie dann nicht).', ['From: ' + fromDomain, 'header.d: ' + auth.dkim.domain]);
    if (auth.spf && auth.spf.result === 'fail') hint('spf-fail', 'warnung', 'SPF fail', 'Die sendende IP ist für die Domain laut SPF-Eintrag nicht zugelassen und die Domain verlangt Ablehnung.', ['smtp.mailfrom: ' + (auth.spf.mailfrom || '-')]);
    if (auth.spf && auth.spf.result === 'softfail') hint('spf-softfail', 'hinweis', 'SPF softfail', 'Die sendende IP ist laut SPF-Eintrag nicht zugelassen, die Domain verlangt aber nur eine Markierung.', ['smtp.mailfrom: ' + (auth.spf.mailfrom || '-')]);
    if (auth.dmarc && auth.dmarc.result === 'fail') hint('dmarc-fail', 'warnung', 'DMARC fail', 'Weder SPF noch DKIM bestehen mit ausgerichteter Domain.' + (auth.dmarc.policy ? ' Veröffentlichte Richtlinie: p=' + auth.dmarc.policy + '.' : ''), ['header.from: ' + (auth.dmarc.headerFrom || fromDomain), 'action: ' + (auth.dmarc.action || '-')]);
    if (auth.compauth && auth.compauth.result !== 'pass') hint('compauth-nicht-pass', auth.compauth.result === 'fail' ? 'warnung' : 'hinweis', 'compauth nicht pass', 'Das zusammengesetzte Ergebnis von Microsoft 365 ist "' + auth.compauth.result + '"' + (auth.compauth.reason ? ' (reason=' + auth.compauth.reason + ')' : '') + '.', ['compauth=' + auth.compauth.result + (auth.compauth.reason ? ' reason=' + auth.compauth.reason : '')]);
    if (dateP && timed.length) {
      if (timed[0].utcMs - dateP.ms > DATE_BEFORE_MS) hint('date-zu-frueh', 'hinweis', 'Date liegt weit vor dem ersten Received', 'Das Date liegt mehr als 24 Stunden vor dem ersten Received (die Nachricht lag lange beim Absender oder die Uhr dort geht falsch).', ['Date: ' + new Date(dateP.ms).toISOString(), 'erstes Received: ' + timed[0].utc]);
      const newest = timed[timed.length - 1];
      if (dateP.ms - newest.utcMs > HINT_MS * 5) hint('date-zukunft', 'hinweis', 'Date liegt in der Zukunft', 'Das Date liegt nach dem letzten Received.', ['Date: ' + new Date(dateP.ms).toISOString(), 'letztes Received: ' + newest.utc]);
    }
    let sawTls = false;
    hops.forEach((h) => { if (h.tls === true) sawTls = true; else if (h.tls === false && sawTls) { if (!hints.some((x) => x.id === 'hop-ohne-tls')) hint('hop-ohne-tls', 'hinweis', 'Hop ohne Verschlüsselung nach verschlüsseltem Hop', 'Ein späterer Hop ist laut Received-Zeile nicht verschlüsselt, obwohl ein früherer Hop TLS nutzte.', ['Hop ' + h.nr + ': ' + (h.withRaw || h.protocol)]); } });
    hops.forEach((h) => { if (h.clockSkew) hint('uhr-weicht-ab', 'hinweis', 'Uhr weicht ab (Hop ' + h.nr + ')', 'Der Zeitstempel liegt vor dem des vorherigen Hops; eine der beteiligten Uhren geht falsch. Die Verzögerung wird nicht gerechnet.', ['Hop ' + h.nr + ': ' + h.timeText]); });
    hops.forEach((h) => { if (h.delaySeverity) hint('hop-verzoegerung', h.delaySeverity, 'Verzögerung vor Hop ' + h.nr, 'Zwischen dem vorherigen Hop und Hop ' + h.nr + ' liegen ' + fmtDur(h.delayMs) + ' (ab 60 Sekunden Hinweis, ab 5 Minuten Warnung).', ['Hop ' + h.nr + ': ' + (h.by || h.timeText)]); });
    hops.forEach((h) => { if (!h.ok) hint('hop-nicht-auswertbar', 'info', 'Received-Zeile nicht auswertbar (Hop ' + h.nr + ')', h.reason + '.', [h.raw.slice(0, 200)]); });
    if (firstPublic) hint('einlieferer', 'info', 'Mutmaßlicher Einlieferer: Hop ' + firstPublic.nr, 'Der erste Hop mit öffentlicher IP-Adresse ist der mutmaßliche Einlieferer ins Mailsystem (Hinweis, kein Urteil).', ['Hop ' + firstPublic.nr + ': ' + firstPublic.from.name + ' [' + firstPublic.from.ip + ']']);
    if (unknownCs.length) hint('zeichensatz', 'info', 'Unbekannter Zeichensatz', 'Kodierte Wörter mit unbekanntem Zeichensatz bleiben unverändert sichtbar.', unknownCs);
    hints.forEach((h, i) => { h._i = i; });
    hints.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || (a._i - b._i));
    hints.forEach((h) => { delete h._i; });

    const summary = {
      subject, date: dateRaw, dateUtc: dateP ? new Date(dateP.ms).toISOString() : '', messageId: msgId, messageIdDomain: msgIdDomain,
      from, sender, replyTo, returnPath, toCount: to.length, ccCount: cc.length, headerBytes: p.headerBytes, hopCount: hops.length, totalMs,
      mailer: first('x-mailer'),
    };
    return {
      ok: true, summary, hops, maxDelayHop: maxDelay && maxDelay.delayMs > 0 ? maxDelay.nr : null, auth, ms, hints, unknownCharsets: unknownCs,
      raw: p.headers.map((h) => ({ name: h.name, value: h.value, key: KEY_HEADERS.has(h.lname) })), unparsable: p.unparsable, bodyDiscarded: p.bodyDiscarded, mbox: p.mbox,
    };
  }
  const KEY_HEADERS = new Set(['from', 'sender', 'reply-to', 'return-path', 'to', 'cc', 'subject', 'date', 'message-id', 'received', 'received-spf', 'authentication-results', 'arc-authentication-results', 'arc-seal', 'dkim-signature', 'x-forefront-antispam-report', 'x-microsoft-antispam', 'x-ms-exchange-organization-scl', 'x-ms-exchange-organization-authas', 'x-ms-exchange-organization-authsource']);

  function fmtDur(ms) {
    if (ms === null || ms === undefined) return '-';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + ' min' + (r ? ' ' + r + ' s' : '');
    const h = Math.floor(m / 60);
    return h + ' h ' + (m % 60) + ' min';
  }
  const addrText = (list) => (list || []).map((a) => (a.display ? a.display + ' ' : '') + (a.address ? '<' + a.address + '>' : a.raw)).join(', ') || '-';

  // Zusammenfassung für Tickets: Markdown-frei, kurz, ohne Rohheader
  function buildSummaryText(a) {
    if (!a || !a.ok) return '';
    const s = a.summary, L = [];
    L.push('Mail-Header-Auswertung');
    L.push('Betreff: ' + (s.subject || '-'));
    L.push('Datum: ' + (s.date || '-'));
    L.push('Von: ' + addrText(s.from));
    if (s.sender.length) L.push('Sender: ' + addrText(s.sender));
    if (s.replyTo.length) L.push('Antwort an: ' + addrText(s.replyTo));
    if (s.returnPath.length) L.push('Return-Path: ' + addrText(s.returnPath));
    L.push('An: ' + s.toCount + ' Empfänger, Cc: ' + s.ccCount);
    L.push('Hops: ' + s.hopCount + (s.totalMs !== null ? ', Gesamtlaufzeit ' + fmtDur(s.totalMs) : ''));
    a.hops.forEach((h) => {
      if (!h.ok) { L.push('  Hop ' + h.nr + ': nicht auswertbar (' + h.reason + ')'); return; }
      L.push('  Hop ' + h.nr + ': ' + (h.from.name || '?') + (h.from.ip ? ' [' + h.from.ip + ', ' + h.from.ipKind + ']' : '') + ' -> ' + (h.by || '?') + (h.byExo ? ' (Exchange Online)' : '') + ', ' + (h.utc || h.timeText) + (h.clockSkew ? ', Uhr weicht ab' : h.delayMs !== null ? ', +' + fmtDur(h.delayMs) : '') + (h.tls === true ? ', TLS' : h.tls === false ? ', ohne TLS' : ''));
    });
    const au = a.auth;
    L.push('SPF: ' + (au.spf ? au.spf.result + (au.spf.domain ? ' (' + au.spf.domain + (au.spf.aligned ? ', ausgerichtet' : ', nicht ausgerichtet') + ')' : '') : 'kein Ergebnis'));
    L.push('DKIM: ' + (au.dkim ? au.dkim.result + (au.dkim.domain ? ' (' + au.dkim.domain + (au.dkim.aligned ? ', ausgerichtet' : ', nicht ausgerichtet') + ')' : '') : 'kein Ergebnis'));
    L.push('DMARC: ' + (au.dmarc ? au.dmarc.result + (au.dmarc.policy ? ', p=' + au.dmarc.policy : '') + (au.dmarc.action ? ', action=' + au.dmarc.action : '') : 'kein Ergebnis'));
    if (au.compauth) L.push('compauth: ' + au.compauth.result + (au.compauth.reason ? ' (reason=' + au.compauth.reason + ')' : ''));
    const top = a.hints.filter((h) => h.severity !== 'info').slice(0, 6);
    if (top.length) { L.push('Hinweise:'); top.forEach((h) => L.push('  ' + (h.severity === 'warnung' ? 'Warnung' : 'Hinweis') + ': ' + h.titel + ' - ' + h.werte.join('; '))); } else L.push('Hinweise: keine');
    return L.join('\n') + '\n';
  }

  // Suche in der Rohansicht: liefert die Indizes der Header, deren Name oder Wert den Begriff enthält (verändert die Anzeige nicht)
  function searchRaw(raw, term) {
    const t = String(term || '').toLowerCase(); if (!t) return [];
    return raw.map((h, i) => ((h.name + ': ' + h.value).toLowerCase().includes(t) ? i : -1)).filter((i) => i >= 0);
  }

  return { MAX_CHARS, MS_FFAR, MS_ANTISPAM, MS_AR, MS_REASON, MS_ORG, parse, decodeWords, parseAddresses, parseReceived, parseDate, parseAuthResults, explainReason, explainForefront, analyze, buildSummaryText, searchRaw, registrable, aligned, ipKind, fmtDur };
}));
