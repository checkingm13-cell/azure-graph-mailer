/**
 * Indian Standard Time (IST - Asia/Kolkata, UTC+05:30) Utility
 * Ensures all scheduling, logging, and database operations run strictly in Indian Time.
 */

// Force Node.js timezone
process.env.TZ = 'Asia/Kolkata';

const IST_OFFSET_MINUTES = 330; // +5 hours 30 mins
const IST_SQL_NOW = "datetime('now', '+330 minutes')";

/**
 * Formats a Date or timestamp as SQLite-compatible 'YYYY-MM-DD HH:mm:ss' in Asia/Kolkata
 */
function toISTString(d = new Date()) {
  const dateObj = typeof d === 'number' || typeof d === 'string' ? new Date(d) : d;
  if (!dateObj || isNaN(dateObj.getTime())) {
    return toISTString(new Date());
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(dateObj);
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Parses user schedule input (e.g. '2026-09-17T17:30' or '2026-09-17 17:30:00')
 * strictly anchored to Indian Standard Time (UTC+05:30).
 */
function parseIST(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  
  let str = String(input).trim();
  // If no timezone offset is explicitly provided, append Indian Standard Time (+05:30)
  if (!str.includes('+') && !str.includes('Z') && !str.match(/-\d\d:\d\d$/)) {
    if (str.includes('T')) {
      if (str.length === 16) str += ':00'; // YYYY-MM-DDTHH:mm -> YYYY-MM-DDTHH:mm:00
      str += '+05:30';
    } else if (str.includes(' ')) {
      str = str.replace(' ', 'T') + '+05:30';
    } else {
      str += '+05:30';
    }
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Returns current timestamp string in IST
 */
function nowIST() {
  return toISTString(new Date());
}

module.exports = {
  IST_SQL_NOW,
  IST_OFFSET_MINUTES,
  toISTString,
  parseIST,
  nowIST
};
