const crypto = require('crypto');
const ms = require('ms');
const moment = require('moment');
require('moment-duration-format');

const config = require('../config');

function generateOrderNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `ORD-${timestamp}-${random}`;
}

function generateTicketNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TKT-${timestamp}-${random}`;
}

function generateReferralCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateCouponCode(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function formatCurrency(amount, currency = config.currency) {
  const sym = currency?.symbol || '💰';
  return `${amount.toLocaleString()} ${sym}`;
}

const formatNumber = (num) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
};

function formatDuration(ms) {
  return moment.duration(ms).format('d [يوم] h [ساعة] m [دقيقة] s [ثانية]');
}

function formatDate(date, format = 'LLLL') {
  return moment(date).locale('ar').format(format);
}

function formatRelativeTime(date) {
  return moment(date).locale('ar').fromNow();
}

function truncate(text, length = 100, suffix = '...') {
  if (!text) return '';
  if (text.length <= length) return text;
  return text.substring(0, length - suffix.length) + suffix;
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function calculateCommission(amount, rate) {
  return Math.round(amount * rate * 100) / 100;
}

function calculateDiscount(price, percentage) {
  return Math.round(price * (percentage / 100) * 100) / 100;
}

function calculateFinalPrice(price, discountPercentage) {
  if (!discountPercentage || discountPercentage <= 0) return price;
  return price - calculateDiscount(price, discountPercentage);
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function isValidImageUrl(url) {
  if (!isValidUrl(url)) return false;
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  return imageExtensions.some(ext => url.toLowerCase().includes(ext));
}

function sanitizeInput(input, maxLength = 2000) {
  if (!input) return '';
  return input
    .trim()
    .substring(0, maxLength)
    .replace(/@everyone|@here/g, '')
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .replace(/<@&\d+>/g, '');
}

function parseTimeString(timeString) {
  const result = ms(timeString);
  return result || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retry(fn, retries = 3, delay = 1000) {
  return fn().catch(err => {
    if (retries <= 0) throw err;
    return sleep(delay).then(() => retry(fn, retries - 1, delay * 2));
  });
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function calculatePercentage(value, total) {
  if (total === 0) return 0;
  return Math.round((value / total) * 10000) / 100;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeObjects(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = mergeObjects(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function pick(object, keys) {
  return keys.reduce((obj, key) => {
    if (object && Object.prototype.hasOwnProperty.call(object, key)) {
      obj[key] = object[key];
    }
    return obj;
  }, {});
}

function omit(object, keys) {
  const result = { ...object };
  keys.forEach(key => delete result[key]);
  return result;
}

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

function throttle(fn, limit) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
function toArabicNumbers(num) {
  return num.toString().split('').map(d => arabicNumbers[parseInt(d)] || d).join('');
}

function toEnglishNumbers(str) {
  return str.replace(/[٠-٩]/g, d => arabicNumbers.indexOf(d).toString());
}

module.exports = {
  generateOrderNumber,
  generateTicketNumber,
  generateReferralCode,
  generateCouponCode,
  formatCurrency,
  formatNumber,
  formatDuration,
  formatDate,
  formatRelativeTime,
  truncate,
  slugify,
  calculateCommission,
  calculateDiscount,
  calculateFinalPrice,
  isValidUrl,
  isValidImageUrl,
  sanitizeInput,
  parseTimeString,
  sleep,
  retry,
  chunkArray,
  shuffleArray,
  getRandomElement,
  clamp,
  calculatePercentage,
  deepClone,
  mergeObjects,
  pick,
  omit,
  debounce,
  throttle,
  toArabicNumbers,
  toEnglishNumbers,
};