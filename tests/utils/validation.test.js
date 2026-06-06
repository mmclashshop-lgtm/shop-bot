const {
  validateString,
  validateNumber,
  validateBoolean,
  validateUrl,
  validateDiscordId,
  validateArray,
  validateStoreCreate,
  validateProductCreate,
  validateServiceCreate,
  validateReviewCreate,
  validateTicketCreate,
  validateCouponCreate,
  ValidationError,
} = require('../../src/utils/validation');

describe('Validation - String', () => {
  test('validates required string', () => {
    expect(() => validateString(undefined, 'test', { required: true })).toThrow(ValidationError);
    expect(() => validateString(null, 'test', { required: true })).toThrow(ValidationError);
    expect(validateString('hello', 'test', { required: true })).toBe('hello');
    expect(() => validateString('', 'test', { required: true, minLength: 1 })).toThrow(ValidationError);
  });

  test('validates min/max length', () => {
    expect(() => validateString('ab', 'test', { minLength: 3 })).toThrow();
    expect(() => validateString('hello world', 'test', { maxLength: 5 })).toThrow();
    expect(validateString('hello', 'test', { minLength: 2, maxLength: 10 })).toBe('hello');
  });

  test('validates enum', () => {
    expect(() => validateString('invalid', 'test', { enum: ['a', 'b'] })).toThrow();
    expect(validateString('a', 'test', { enum: ['a', 'b'] })).toBe('a');
  });
});

describe('Validation - Number', () => {
  test('validates required number', () => {
    expect(() => validateNumber(undefined, 'test', { required: true })).toThrow();
    expect(validateNumber(5, 'test', { required: true })).toBe(5);
  });

  test('validates min/max', () => {
    expect(() => validateNumber(1, 'test', { min: 5 })).toThrow();
    expect(() => validateNumber(10, 'test', { max: 5 })).toThrow();
    expect(validateNumber(5, 'test', { min: 0, max: 10 })).toBe(5);
  });

  test('validates integer', () => {
    expect(() => validateNumber(1.5, 'test', { integer: true })).toThrow();
    expect(validateNumber(5, 'test', { integer: true })).toBe(5);
  });

  test('validates positive', () => {
    expect(() => validateNumber(0, 'test', { positive: true })).toThrow();
    expect(validateNumber(5, 'test', { positive: true })).toBe(5);
  });
});

describe('Validation - Boolean', () => {
  test('boolean validation', () => {
    expect(validateBoolean(true, 'test')).toBe(true);
    expect(validateBoolean(false, 'test')).toBe(false);
    expect(validateBoolean(undefined, 'test', { default: true })).toBe(true);
  });
});

describe('Validation - URL', () => {
  test('URL validation', () => {
    expect(() => validateUrl('not-url', 'test', { required: true })).toThrow();
    expect(validateUrl('https://example.com', 'test')).toBe('https://example.com');
    expect(validateUrl(undefined, 'test')).toBeNull();
  });
});

describe('Validation - Discord ID', () => {
  test('validates Discord IDs', () => {
    expect(() => validateDiscordId('abc', 'test', { required: true })).toThrow();
    expect(validateDiscordId('123456789012345678', 'test')).toBe('123456789012345678');
  });
});

describe('Validation - Array', () => {
  test('validates arrays', () => {
    expect(() => validateArray('not-array', 'test')).toThrow();
    expect(() => validateArray([1, 2], 'test', { minLength: 3 })).toThrow();
    expect(() => validateArray(['a', 'b', 'a'], 'test', { unique: true })).toThrow();
    expect(validateArray([1, 2, 3], 'test', { maxLength: 5 })).toEqual([1, 2, 3]);
  });
});

describe('Validation - Store Create', () => {
  test('validates store creation', () => {
    expect(() => validateStoreCreate({})).toThrow();
    const result = validateStoreCreate({
      name: 'My Store',
      description: 'A great store with products',
    });
    expect(result.name).toBe('My Store');
    expect(result.description).toBe('A great store with products');
  });
});

describe('Validation - Product Create', () => {
  test('validates product creation', () => {
    expect(() => validateProductCreate({ name: 'Test', description: 'Desc' })).toThrow();
    const result = validateProductCreate({
      name: 'Test Product',
      description: 'A great product description',
      price: 100,
      category: 'tech',
    });
    expect(result.name).toBe('Test Product');
    expect(result.price).toBe(100);
    expect(result.category).toBe('tech');
  });
});

describe('Validation - Service Create', () => {
  test('validates service creation', () => {
    const result = validateServiceCreate({
      name: 'Web Dev',
      description: 'Full stack web development service with multiple features',
      category: 'programming',
      price: 500,
      deliveryTime: 7,
    });
    expect(result.name).toBe('Web Dev');
    expect(result.category).toBe('programming');
  });
});

describe('Validation - Review Create', () => {
  test('validates review creation', () => {
    const result = validateReviewCreate({ rating: 5, comment: 'Great!' });
    expect(result.rating).toBe(5);
    expect(result.comment).toBe('Great!');
    expect(result.isAnonymous).toBe(false);
  });
});
