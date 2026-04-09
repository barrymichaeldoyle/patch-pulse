export function cleanText(text: string) {
  // Trim the text
  let cleaned = text.trim();

  // Remove bold, italic, and strikethrough formatting
  cleaned = cleaned.replace(/(\*|_|~)(.*?)\1/g, '$2');

  // Simplify links: <http://www.foo.com|www.foo.com> to www.foo.com
  cleaned = cleaned.replace(/<http[^|]+?\|([^>]+?)>/g, '$1');

  // Remove any remaining angle bracket content
  cleaned = cleaned.replace(/<[^>]+?>/g, '');

  return cleaned;
}
