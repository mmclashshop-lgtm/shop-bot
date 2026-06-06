const {
  generateOrderNumber,
  generateTicketNumber,
  generateReferralCode,
  generateCouponCode,
  formatCurrency,
  formatNumber,
  calculateCommission,
  calculateDiscount,
  calculateFinalPrice,
  sanitizeInput,
  truncate,
  slugify,
  isValidUrl,
  isValidImageUrl,
  toArabicNumbers,
  toEnglishNumbers,
  sleep,
  clamp,
  chunkArray,
  getRandomElement,
} = require('../../src/utils/helpers');

describe('Helpers - Order/Ticket Numbers', () => {
  test('generateOrderNumber returns ORD- format', () => {
    const num = generateOrderNumber();
    expect(num).toMatch(/^ORD-/);
    expect(num.length).toBeGreaterThan(10);
  });

  test('generateTicketNumber returns TKT- format', () => {
    const num = generateTicketNumber();
    expect(num).toMatch(/^TKT-/);
  });

  test('generateOrderNumber is unique', () => {
    const nums = new Set(Array.from({ length: 100 }, () => generateOrderNumber()));
    expect(nums.size).toBe(100);
  });
});

describe('Helpers - Codes', () => {
  test('generateReferralCode returns alphanumeric', () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^[A-Z0-9]+$/);
    expect(code.length).toBe(8);
  });

  test('generateCouponCode returns alphanumeric', () => {
    const code = generateCouponCode();
    expect(code).toMatch(/^[A-Z0-9]+$/);
    expect(code.length).toBe(10);
  });
});

jest.mock('../../src/config', () => ({
  currency: { symbol: '₪', code: 'ILS' },
}));

describe('Helpers - Formatting', () => {
  test('formatCurrency formats correctly', () => {
    const result = formatCurrency(1500);
    expect(result).toContain('₪');
    expect(result).toContain('1,500');
  });

  test('formatNumber formats thousands', () => {
    expect(formatNumber(1500)).toBe('1.5K');
    expect(formatNumber(1500000)).toBe('1.5M');
    expect(formatNumber(500)).toBe('500');
  });
});

describe('Helpers - Calculations', () => {
  test('calculateCommission', () => {
    expect(calculateCommission(1000, 0.05)).toBe(50);
    expect(calculateCommission(100, 0.1)).toBe(10);
    expect(calculateCommission(0, 0.05)).toBe(0);
  });

  test('calculateDiscount', () => {
    expect(calculateDiscount(1000, 10)).toBe(100);
    expect(calculateDiscount(200, 25)).toBe(50);
  });

  test('calculateFinalPrice', () => {
    expect(calculateFinalPrice(1000, 10)).toBe(900);
    expect(calculateFinalPrice(1000, 0)).toBe(1000);
  });
});

describe('Helpers - Validation', () => {
  test('isValidUrl', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  test('isValidImageUrl', () => {
    expect(isValidImageUrl('https://example.com/image.jpg')).toBe(true);
    expect(isValidImageUrl('https://example.com/file.pdf')).toBe(false);
  });

  test('sanitizeInput removes @everyone', () => {
    expect(sanitizeInput('hello @everyone')).not.toContain('@everyone');
    expect(sanitizeInput('normal text')).toBe('normal text');
  });

  test('sanitizeInput truncates long text', () => {
    const long = 'a'.repeat(3000);
    expect(sanitizeInput(long).length).toBeLessThanOrEqual(2000);
  });
});

describe('Helpers - Utility', () => {
  test('truncate', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
    expect(truncate('short', 10)).toBe('short');
  });

  test('slugify', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('  Test  ')).toBe('test');
  });

  test('clamp', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  test('chunkArray', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 2)).toEqual([]);
  });

  test('getRandomElement', () => {
    const arr = [1, 2, 3];
    const el = getRandomElement(arr);
    expect(arr).toContain(el);
  });

  test('toArabicNumbers and toEnglishNumbers', () => {
    expect(toArabicNumbers(123)).toBe('١٢٣');
    expect(toEnglishNumbers('١٢٣')).toBe('123');
  });
});
