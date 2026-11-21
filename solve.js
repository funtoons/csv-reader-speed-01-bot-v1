// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// answer {columns, rows, errors} for {text, header}, reading the text once,
// left to right. Dependency-free ES module, no clock, no randomness, no
// network, nothing kept from one call to the next.
//
// Speed comes from two things the plain reference reader does not do:
// a whole record whose line holds no quote and no stray CR is split by the
// engine's native split, and every other field is scanned in one tight pass
// over character codes and cut out with a single slice instead of being
// built up one character at a time.
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;
  const addContent = (s) => {
    if (s.indexOf('\r') === -1) {
      let k = 0;
      let ix = s.indexOf('\n');
      while (ix !== -1) { k += 1; ix = s.indexOf('\n', ix + 1); }
      line += k;
      return s;
    }
    const m = s.match(/\r\n|\r|\n/g);
    if (m !== null) line += m.length;
    return s.replace(/\r\n?/g, '\n');
  };
  while (true) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let lastQuoted = false;
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? n : nl;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= end) {
      const r = text.indexOf('\r', pos);
      if (r === -1 || r >= end) {
        fields = text.slice(pos, end).split(',');
        pos = nl === -1 ? n : nl + 1;
        if (nl !== -1) line += 1;
      } else if (nl !== -1 && r === end - 1) {
        fields = text.slice(pos, end - 1).split(',');
        pos = nl + 1;
        line += 1;
      }
    }
    if (fields === null) {
      fields = [];
      let ended = 0;
      do {
        let value = '';
        lastQuoted = text.charCodeAt(pos) === 34;
        let needUnquoted = false;
        let junkCheck = false;
        if (lastQuoted) {
          const open = pos;
          const openLine = line;
          let start = pos + 1;
          let closed = false;
          while (true) {
            const qq = text.indexOf('"', start);
            if (qq === -1) {
              pos = open + 1;
              line = openLine;
              errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
              value = '"';
              needUnquoted = true;
              break;
            }
            if (text.charCodeAt(qq + 1) === 34) {
              value += addContent(text.slice(start, qq));
              value += '"';
              start = qq + 2;
              continue;
            }
            value += addContent(text.slice(start, qq));
            pos = qq + 1;
            closed = true;
            break;
          }
          if (closed) {
            if (pos >= n) ended = 2;
            else {
              const c = text.charCodeAt(pos);
              if (c === 44) { pos += 1; ended = 0; }
              else if (c === 10) { pos += 1; line += 1; ended = 1; }
              else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; ended = 1; }
              else { needUnquoted = true; junkCheck = true; }
            }
          }
        } else needUnquoted = true;
        if (needUnquoted) {
          const before = value.length;
          let scan = pos;
          while (true) {
            while (pos < n) {
              const c = text.charCodeAt(pos);
              if (c === 44 || c === 10 || c === 13) break;
              pos += 1;
            }
            if (pos >= n) { value += text.slice(scan, pos); ended = 2; break; }
            const c = text.charCodeAt(pos);
            if (c === 44) { value += text.slice(scan, pos); pos += 1; ended = 0; break; }
            if (c === 10) { value += text.slice(scan, pos); pos += 1; line += 1; ended = 1; break; }
            if (text.charCodeAt(pos + 1) === 10) { value += text.slice(scan, pos); pos += 2; line += 1; ended = 1; break; }
            value += text.slice(scan, pos);
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            pos += 1;
            scan = pos;
          }
          if (junkCheck && value.length > before) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
        fields.push(value);
      } while (ended === 0);
    }
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
