/** Demo-mode helpers used when the local Python agent is offline. */

export function agentOnline(lastSeen: Date | null | undefined) {
  return !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 30000;
}

export function contractSize(symbol: string) {
  if (symbol.startsWith("XAU")) return 100;
  if (symbol.startsWith("XAG")) return 5000;
  if (/^(US30|NAS|SPX|GER|UK100)/.test(symbol)) return 1;
  return 100000;
}

export function pipSize(symbol: string) {
  const u = symbol.toUpperCase();
  if (u.includes("JPY")) return 0.01;
  if (u.startsWith("XAU") || u.startsWith("GOLD")) return 0.1;
  if (u.startsWith("XAG") || u.startsWith("SILVER") || /^(USOIL|UKOIL|WTI|BRENT|XTI|XBR)/.test(u)) return 0.01;
  if (u.startsWith("BTC")) return 1;
  if (u.startsWith("ETH")) return 0.1;
  if (/^(LTC|XRP|SOL|DOGE|ADA|BNB|DOT|AVAX)/.test(u)) return 0.01;
  if (/^(US30|US100|US500|USTEC|NAS|NDX|SPX|SP500|DJ|DOW|WS30|GER|DE40|DE30|DAX|UK100|FTSE|JP225|JPN225|NIK|FRA40|EU50|AUS200|HK50)/.test(u)) return 1;
  return 0.0001;
}

export function calcPnl(symbol: string, side: string, volume: number, open: number, cur: number) {
  const diff = side === "BUY" ? cur - open : open - cur;
  let pnl = diff * volume * contractSize(symbol);
  if (symbol.endsWith("JPY")) pnl = pnl / cur;
  return Math.round(pnl * 100) / 100;
}

export function jitter(symbol: string, price: number) {
  const p = pipSize(symbol);
  const step = (Math.random() - 0.48) * p * 6;
  return Math.round((price + step) / (p / 10)) * (p / 10);
}

/** Lightweight MetaEditor-like static check for demo mode (real compile runs in the Python agent). */
export function demoCompile(fileName: string, code: string) {
  const lines = code.split("\n");
  const errs: string[] = [];
  const warns: string[] = [];
  let depth = 0;
  let paren = 0;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (ch === "(") paren++;
      if (ch === ")") paren--;
    }
    const t = line.trim();
    const next = (lines.slice(i + 1).find((l) => l.trim()) ?? "").trim();
    const isStmt = /^return\b/.test(t) || /=|\w+\s*\(.*\)\s*$/.test(t);
    if (
      t &&
      isStmt &&
      !/^(if|for|while|else|switch|case|#|\/\/|&&|\|\||\+|-|\?|:)/.test(t) &&
      !/[;{},(]$/.test(t) &&
      !/(&&|\|\||\+|-|\*|\/|\?|:)$/.test(t) &&
      !next.startsWith("{") &&
      !/^(\?|:|&&|\|\||[-+*\/.]|\))/.test(next) && // ifade sonraki satırda devam ediyor
      !(next.startsWith("}") && /^\w+(\s*=\s*[-\w]+)?$/.test(t) && !/^return\b/.test(t)) // enum son üyesi
    ) {
      errs.push(`${fileName}(${i + 1},${raw.length - raw.trimStart().length + 1}) : error 143: ';' - expected`);
    }
  });
  if (depth !== 0) errs.push(`${fileName}(${lines.length},1) : error 149: unbalanced braces ('{' / '}')`);
  if (paren !== 0) errs.push(`${fileName}(${lines.length},1) : error 150: unbalanced parentheses`);
  if (!/OnTick\s*\(|OnCalculate\s*\(|OnStart\s*\(/.test(code))
    errs.push(`${fileName}(1,1) : error 209: event handling function not found (OnTick/OnCalculate/OnStart)`);
  if (!/#property\s+version/.test(code)) warns.push(`${fileName}(1,1) : warning 89: version property not set`);
  if (/OnInit\s*\(/.test(code) === false && /OnTick/.test(code))
    warns.push(`${fileName}(1,1) : warning 91: OnInit not defined`);
  return { errors: errs, warnings: warns };
}
