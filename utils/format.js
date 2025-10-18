function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatContent(raw) {
  const text = escapeHtml(raw || '');
  let formatted = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  formatted = formatted.replace(/@([a-zA-Z0-9_]+)/g, '<a href="/u/$1">@$1</a>');
  formatted = formatted.replace(/#([\p{L}0-9_]+)/gu, '<a href="/search?q=%23$1">#$1</a>');
  return formatted;
}

module.exports = { escapeHtml, formatContent };
