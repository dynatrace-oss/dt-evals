export function renderTable(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const colWidths: number[] = headers.map((h, i) => {
    const maxRowWidth = rows.reduce((max, row) => Math.max(max, (row[i] ?? '').length), 0);
    return Math.max(h.length, maxRowWidth);
  });

  function formatRow(cells: string[]): string {
    const padded = colWidths.map((w, i) => (cells[i] ?? '').padEnd(w));
    return `│ ${padded.join(' │ ')} │`;
  }

  function formatSeparator(left: string, mid: string, right: string): string {
    const parts = colWidths.map(w => '─'.repeat(w + 2));
    return left + parts.join(mid) + right;
  }

  const lines: string[] = [];
  lines.push(formatSeparator('┌', '┬', '┐'));
  lines.push(formatRow(headers));
  lines.push(formatSeparator('├', '┼', '┤'));
  for (const row of rows) {
    lines.push(formatRow(row));
  }
  lines.push(formatSeparator('└', '┴', '┘'));

  return lines.join('\n');
}
