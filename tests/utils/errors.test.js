const {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  InsufficientFundsError,
  AIError,
  DatabaseError,
} = require('../../src/utils/errors');

describe('Error Classes', () => {
  test('AppError - base class', () => {
    const err = new AppError('test error', 400);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('test error');
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('AppError');
  });

  test('ValidationError', () => {
    const err = new ValidationError('invalid input', { field: 'name' });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('invalid');
  });

  test('NotFoundError', () => {
    const err = new NotFoundError('User not found', { userId: '123' });
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('غير موجود');
  });

  test('UnauthorizedError', () => {
    const err = new UnauthorizedError('Login required');
    expect(err.statusCode).toBe(401);
  });

  test('ForbiddenError', () => {
    const err = new ForbiddenError('No permission');
    expect(err.statusCode).toBe(403);
  });

  test('ConflictError', () => {
    const err = new ConflictError('Already exists');
    expect(err.statusCode).toBe(409);
  });

  test('RateLimitError', () => {
    const err = new RateLimitError('Too fast', 30);
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain('Too fast');
  });

  test('InsufficientFundsError', () => {
    const err = new InsufficientFundsError('Need more money', 100, 50);
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('غير كافٍ');
  });

  test('AIError', () => {
    const err = new AIError('API down');
    expect(err.statusCode).toBe(503);
  });

  test('DatabaseError', () => {
    const err = new DatabaseError('Connection failed');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('Connection failed');
  });
});
