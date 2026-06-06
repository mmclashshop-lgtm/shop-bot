const validator = require('validator');
const { ValidationError } = require('./errors');
const config = require('../config');

function validateRequired(data, fields) {
  const missing = fields.filter(field => {
    const value = data[field];
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  });

  if (missing.length > 0) {
    throw new ValidationError(`الحقول مطلوبة: ${missing.join(', ')}`, { missing });
  }
}

function validateString(value, fieldName, options = {}) {
  if (value === undefined || value === null) {
    if (options.required) {
      throw new ValidationError(`${fieldName} مطلوب`);
    }
    return options.default || '';
  }

  const str = String(value).trim();

  if (options.minLength && str.length < options.minLength) {
    throw new ValidationError(`${fieldName} يجب أن يكون ${options.minLength} أحرف على الأقل`, { field: fieldName, minLength: options.minLength });
  }

  if (options.maxLength && str.length > options.maxLength) {
    throw new ValidationError(`${fieldName} يجب أن لا يتجاوز ${options.maxLength} حرف`, { field: fieldName, maxLength: options.maxLength });
  }

  if (options.pattern && !options.pattern.test(str)) {
    throw new ValidationError(`${fieldName} صيغة غير صالحة`, { field: fieldName, pattern: options.pattern.toString() });
  }

  if (options.enum && !options.enum.includes(str)) {
    throw new ValidationError(`${fieldName} قيمة غير مسموحة`, { field: fieldName, allowed: options.enum });
  }

  return str;
}

function validateNumber(value, fieldName, options = {}) {
  if (value === undefined || value === null) {
    if (options.required) {
      throw new ValidationError(`${fieldName} مطلوب`);
    }
    return options.default ?? 0;
  }

  const num = Number(value);

  if (isNaN(num) || !Number.isFinite(num)) {
    throw new ValidationError(`${fieldName} يجب أن يكون رقماً صحيحاً`, { field: fieldName });
  }

  if (options.min !== undefined && num < options.min) {
    throw new ValidationError(`${fieldName} يجب أن يكون ${options.min} على الأقل`, { field: fieldName, min: options.min });
  }

  if (options.max !== undefined && num > options.max) {
    throw new ValidationError(`${fieldName} يجب أن لا يتجاوز ${options.max}`, { field: fieldName, max: options.max });
  }

  if (options.integer && !Number.isInteger(num)) {
    throw new ValidationError(`${fieldName} يجب أن يكون عدداً صحيحاً`, { field: fieldName });
  }

  if (options.positive && num <= 0) {
    throw new ValidationError(`${fieldName} يجب أن يكون موجباً`, { field: fieldName });
  }

  return num;
}

function validateBoolean(value, fieldName, options = {}) {
  if (value === undefined || value === null) {
    return options.default ?? false;
  }
  return Boolean(value);
}

function validateUrl(value, fieldName, options = {}) {
  const str = validateString(value, fieldName, { required: options.required });

  if (!str) return options.default || null;

  if (!validator.isURL(str, { protocols: ['http', 'https'], require_protocol: true })) {
    throw new ValidationError(`${fieldName} يجب أن يكون رابط صحيح`, { field: fieldName });
  }

  return str;
}

function validateImageUrl(value, fieldName, options = {}) {
  const url = validateUrl(value, fieldName, options);

  if (!url) return options.default || null;

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const isImage = imageExtensions.some(ext => url.toLowerCase().includes(ext));

  if (!isImage && options.strict) {
    throw new ValidationError(`${fieldName} يجب أن يكون رابط صورة`, { field: fieldName });
  }

  return url;
}

function validateDiscordId(value, fieldName, options = {}) {
  const str = validateString(value, fieldName, { required: options.required });

  if (!str) return options.default || null;

  if (!/^\d{17,19}$/.test(str)) {
    throw new ValidationError(`${fieldName} يجب أن يكون معرف ديسكورد صحيح`, { field: fieldName });
  }

  return str;
}

function validateArray(value, fieldName, options = {}) {
  if (value === undefined || value === null) {
    if (options.required) {
      throw new ValidationError(`${fieldName} مطلوب`);
    }
    return options.default || [];
  }

  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} يجب أن يكون مصفوفة`, { field: fieldName });
  }

  if (options.minLength && value.length < options.minLength) {
    throw new ValidationError(`${fieldName} يجب أن يحتوي على ${options.minLength} عناصر على الأقل`, { field: fieldName });
  }

  if (options.maxLength && value.length > options.maxLength) {
    throw new ValidationError(`${fieldName} يجب أن لا يتجاوز ${options.maxLength} عنصر`, { field: fieldName });
  }

  if (options.unique) {
    const unique = [...new Set(value)];
    if (unique.length !== value.length) {
      throw new ValidationError(`${fieldName} لا يجب أن يحتوي على قيم مكررة`, { field: fieldName });
    }
  }

  if (options.itemValidator) {
    value.forEach((item, index) => {
      try {
        options.itemValidator(item, `${fieldName}[${index}]`);
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        throw new ValidationError(`${fieldName}[${index}]: ${err.message}`);
      }
    });
  }

  return value;
}

function validateObject(value, fieldName, schema, options = {}) {
  if (value === undefined || value === null) {
    if (options.required) {
      throw new ValidationError(`${fieldName} مطلوب`);
    }
    return options.default || {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${fieldName} يجب أن يكون كائن`, { field: fieldName });
  }

  const result = {};
  for (const [key, validator] of Object.entries(schema)) {
    try {
      result[key] = validator(value[key], `${fieldName}.${key}`);
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError(`${fieldName}.${key}: ${err.message}`);
    }
  }

  return result;
}

function validateStoreCreate(data) {
  return {
    name: validateString(data.name, 'اسم المتجر', { required: true, minLength: 2, maxLength: 100 }),
    description: validateString(data.description, 'وصف المتجر', { required: true, minLength: 10, maxLength: 2000 }),
    image: validateImageUrl(data.image, 'صورة المتجر', { required: false }),
    banner: validateImageUrl(data.banner, 'بانر المتجر', { required: false }),
  };
}

function validateProductCreate(data) {
  return {
    name: validateString(data.name, 'اسم المنتج', { required: true, minLength: 2, maxLength: 100 }),
    description: validateString(data.description, 'وصف المنتج', { required: true, minLength: 10, maxLength: 2000 }),
    shortDescription: validateString(data.shortDescription, 'الوصف المختصر', { required: false, maxLength: 300 }),
    price: validateNumber(data.price, 'السعر', { required: true, min: 0, max: 1000000 }),
    originalPrice: validateNumber(data.originalPrice, 'السعر الأصلي', { required: false, min: 0 }),
    category: validateString(data.category, 'الفئة', { required: true, minLength: 1, maxLength: 50 }),
    subcategory: validateString(data.subcategory, 'الفئة الفرعية', { required: false, maxLength: 50 }),
    stock: validateNumber(data.stock, 'المخزون', { required: false, min: -1, integer: true, default: -1 }),
    images: validateArray(data.images, 'الصور', { required: false, maxLength: config.limits.maxImagesPerProduct, itemValidator: v => validateImageUrl(v, 'صورة') }),
    tags: validateArray(data.tags, 'الوسوم', { required: false, maxLength: 20, itemValidator: v => validateString(v, 'وسم', { maxLength: 30 }) }),
    deliveryType: validateString(data.deliveryType, 'نوع التسليم', { required: false, enum: ['instant', 'manual', 'digital', 'physical', 'service'], default: 'instant' }),
    deliveryContent: validateString(data.deliveryContent, 'محتوى التسليم', { required: false, maxLength: 5000 }),
    requirements: validateString(data.requirements, 'المتطلبات', { required: false, maxLength: 1000 }),
  };
}

function validateServiceCreate(data) {
  return {
    name: validateString(data.name, 'اسم الخدمة', { required: true, minLength: 2, maxLength: 100 }),
    description: validateString(data.description, 'وصف الخدمة', { required: true, minLength: 20, maxLength: 3000 }),
    shortDescription: validateString(data.shortDescription, 'الوصف المختصر', { required: false, maxLength: 300 }),
    category: validateString(data.category, 'الفئة', { required: true, enum: ['programming', 'design', 'translation', 'video_editing', 'hosting', 'marketing', 'writing', 'music', 'other'] }),
    subcategory: validateString(data.subcategory, 'الفئة الفرعية', { required: false, maxLength: 50 }),
    price: validateNumber(data.price, 'السعر', { required: true, min: 0, max: 1000000 }),
    pricingModel: validateString(data.pricingModel, 'نموذج التسعير', { required: false, enum: ['fixed', 'hourly', 'per_project', 'custom'], default: 'fixed' }),
    deliveryTime: validateNumber(data.deliveryTime, 'وقت التسليم', { required: true, min: 1, integer: true }),
    deliveryTimeUnit: validateString(data.deliveryTimeUnit, 'وحدة الوقت', { required: false, enum: ['hours', 'days', 'weeks'], default: 'days' }),
    revisions: validateNumber(data.revisions, 'التعديلات', { required: false, min: 0, max: 50, integer: true, default: 2 }),
    images: validateArray(data.images, 'الصور', { required: false, maxLength: 10, itemValidator: v => validateImageUrl(v, 'صورة') }),
    tags: validateArray(data.tags, 'الوسوم', { required: false, maxLength: 20, itemValidator: v => validateString(v, 'وسم', { maxLength: 30 }) }),
    requirements: validateString(data.requirements, 'المتطلبات', { required: false, maxLength: 2000 }),
    whatYouGet: validateString(data.whatYouGet, 'ما ستحصل عليه', { required: false, maxLength: 2000 }),
    packages: validateArray(data.packages, 'الباقات', { required: false, maxLength: 5, itemValidator: pkg => {
      validateString(pkg.name, 'اسم الباقة', { required: true, maxLength: 50 });
      validateNumber(pkg.price, 'سعر الباقة', { required: true, min: 0 });
      validateNumber(pkg.deliveryTime, 'وقت تسليم الباقة', { required: false, min: 0, integer: true, default: 0 });
      validateString(pkg.deliveryTimeUnit, 'وحدة وقت الباقة', { required: false, enum: ['hours', 'days', 'weeks'], default: 'days' });
      validateNumber(pkg.revisions, 'تعديلات الباقة', { required: false, min: 0, integer: true, default: 0 });
      validateArray(pkg.features, 'مميزات الباقة', { required: false, maxLength: 10, itemValidator: f => validateString(f, 'ميزة', { maxLength: 100 }) });
      validateBoolean(pkg.isPopular, 'باقة شائعة', { default: false });
    }}),
  };
}

function sanitizeMongoObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    if (obj.startsWith('$') || obj.includes('$where') || obj.includes('$ne') || obj.includes('$gt')) {
      return obj.replace(/\$/g, '');
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeMongoObject);
  }
  if (typeof obj === 'object') {
    const cleaned = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('$')) continue;
      cleaned[key] = sanitizeMongoObject(val);
    }
    return cleaned;
  }
  return obj;
}

function validateReviewCreate(data) {
  return {
    rating: validateNumber(data.rating, 'التقييم', { required: true, min: 1, max: 5, integer: true }),
    title: validateString(data.title, 'العنوان', { required: false, maxLength: 200 }),
    comment: validateString(data.comment, 'التعليق', { required: false, maxLength: 2000 }),
    pros: validateString(data.pros, 'المميزات', { required: false, maxLength: 1000 }),
    cons: validateString(data.cons, 'العيوب', { required: false, maxLength: 1000 }),
    isAnonymous: validateBoolean(data.isAnonymous, 'مجهول', { default: false }),
  };
}

function validateTicketCreate(data) {
  return {
    type: validateString(data.type, 'النوع', { required: false, enum: ['support', 'report', 'dispute', 'partnership', 'verification', 'technical', 'billing', 'other'], default: 'support' }),
    subject: validateString(data.subject, 'الموضوع', { required: true, minLength: 5, maxLength: 200 }),
    description: validateString(data.description, 'الوصف', { required: true, minLength: 20, maxLength: 3000 }),
    priority: validateString(data.priority, 'الأولوية', { required: false, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' }),
    storeId: validateString(data.storeId, 'معرف المتجر', { required: false }),
    orderId: validateString(data.orderId, 'معرف الطلب', { required: false }),
  };
}

function validateCouponCreate(data) {
  return {
    code: validateString(data.code, 'الكود', { required: true, minLength: 3, maxLength: 20, pattern: /^[A-Z0-9]+$/ }),
    name: validateString(data.name, 'الاسم', { required: true, maxLength: 100 }),
    description: validateString(data.description, 'الوصف', { required: false, maxLength: 500 }),
    type: validateString(data.type, 'النوع', { required: true, enum: ['percentage', 'fixed', 'free_shipping', 'buy_x_get_y'] }),
    value: validateNumber(data.value, 'القيمة', { required: true, min: 0 }),
    maxDiscount: validateNumber(data.maxDiscount, 'الحد الأقصى للخصم', { required: false, min: 0 }),
    minPurchase: validateNumber(data.minPurchase, 'الحد الأدنى للشراء', { required: false, min: 0, default: 0 }),
    applicableTo: validateString(data.applicableTo, 'ينطبق على', { required: false, enum: ['all', 'products', 'services', 'store', 'category', 'specific'], default: 'all' }),
    usageLimit: validateObject(data.usageLimit, 'حد الاستخدام', {
      total: v => validateNumber(v, 'إجمالي الاستخدام', { required: false, min: 0, integer: true, default: 0 }),
      perUser: v => validateNumber(v, 'لكل مستخدم', { required: false, min: 1, integer: true, default: 1 }),
    }, { required: false }),
    startsAt: validateString(data.startsAt, 'تاريخ البداية', { required: false }),
    endsAt: validateString(data.endsAt, 'تاريخ النهاية', { required: false }),
    isPublic: validateBoolean(data.isPublic, 'عام', { default: true }),
  };
}

function requireAdmin(interaction) {
  const { PermissionFlagsBits } = require('discord.js');
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return { missing: true, message: '🚫 هذا الأمر للمشرفين فقط.' };
  }
  return { missing: false };
}

function requireOwner(interaction, store, customMessage) {
  if (store.ownerId !== interaction.user.id) {
    return { missing: true, message: customMessage || '🚫 غير مصرح: يمكنك إدارة متاجرك فقط.' };
  }
  return { missing: false };
}

module.exports = {
  validateRequired,
  validateString,
  validateNumber,
  validateBoolean,
  validateUrl,
  validateImageUrl,
  validateDiscordId,
  validateArray,
  validateObject,
  sanitizeMongoObject,
  validateStoreCreate,
  validateProductCreate,
  validateServiceCreate,
  validateReviewCreate,
  validateTicketCreate,
  validateCouponCreate,
  requireAdmin,
  requireOwner,
};