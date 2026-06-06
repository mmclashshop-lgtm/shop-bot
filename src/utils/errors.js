class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'المورد') {
    super(`${resource} غير موجود`, 404, 'NOT_FOUND', { resource });
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'غير مصرح') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'ممنوع') {
    super(message, 403, 'FORBIDDEN');
  }
}

class ConflictError extends AppError {
  constructor(message, details = {}) {
    super(message, 409, 'CONFLICT', details);
  }
}

class RateLimitError extends AppError {
  constructor(message = 'تم تجاوز الحد المسموح', retryAfter = 60) {
    super(message, 429, 'RATE_LIMITED', { retryAfter });
  }
}

class InsufficientFundsError extends AppError {
  constructor(required, available) {
    super('رصيد غير كافٍ', 400, 'INSUFFICIENT_FUNDS', { required, available });
  }
}

class StoreLimitError extends AppError {
  constructor(current, max) {
    super(`وصلت للحد الأقصى للمتاجر (${current}/${max})`, 400, 'STORE_LIMIT', { current, max });
  }
}

class ProductLimitError extends AppError {
  constructor(current, max) {
    super(`وصلت للحد الأقصى للمنتجات (${current}/${max})`, 400, 'PRODUCT_LIMIT', { current, max });
  }
}

class OutOfStockError extends AppError {
  constructor(productName) {
    super(`المنتج "${productName}" نفد من المخزون`, 400, 'OUT_OF_STOCK', { productName });
  }
}

class InvalidCouponError extends AppError {
  constructor(reason) {
    super(`كوبون غير صالح: ${reason}`, 400, 'INVALID_COUPON', { reason });
  }
}

class OrderNotFoundError extends NotFoundError {
  constructor(orderId) {
    super('الطلب');
    this.details.orderId = orderId;
  }
}

class StoreNotFoundError extends NotFoundError {
  constructor(storeId) {
    super('المتجر');
    this.details.storeId = storeId;
  }
}

class ProductNotFoundError extends NotFoundError {
  constructor(productId) {
    super('المنتج');
    this.details.productId = productId;
  }
}

class UserNotFoundError extends NotFoundError {
  constructor(userId) {
    super('المستخدم');
    this.details.userId = userId;
  }
}

class TicketNotFoundError extends NotFoundError {
  constructor(ticketId) {
    super('التذكرة');
    this.details.ticketId = ticketId;
  }
}

class AIError extends AppError {
  constructor(message, details = {}) {
    super(message, 503, 'AI_ERROR', details);
  }
}

class DatabaseError extends AppError {
  constructor(message, details = {}) {
    super(message, 500, 'DATABASE_ERROR', details);
  }
}

class DiscordAPIError extends AppError {
  constructor(message, details = {}) {
    super(message, 502, 'DISCORD_API_ERROR', details);
  }
}

function handleError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error.name === 'ValidationError') {
    return new ValidationError(error.message, { fields: error.errors });
  }

  if (error.name === 'MongoServerError' && error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    return new ConflictError(`${field} مستخدم بالفعل`, { field, value: error.keyValue[field] });
  }

  if (error.name === 'CastError') {
    return new ValidationError('معرف غير صالح', { field: error.path, value: error.value });
  }

  return new AppError(error.message || 'حدث خطأ غير متوقع', 500, 'UNKNOWN_ERROR', {
    originalError: error.name,
    stack: error.stack,
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  InsufficientFundsError,
  StoreLimitError,
  ProductLimitError,
  OutOfStockError,
  InvalidCouponError,
  OrderNotFoundError,
  StoreNotFoundError,
  ProductNotFoundError,
  UserNotFoundError,
  TicketNotFoundError,
  AIError,
  DatabaseError,
  DiscordAPIError,
  handleError,
  asyncHandler,
};