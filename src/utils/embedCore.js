const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const { colors } = config;

class EmbedBuilderUtil {
  static createBase(options = {}) {
    const embed = new EmbedBuilder()
      .setColor(options.color || colors.primary)
      .setTimestamp();

    if (options.title) embed.setTitle(options.title);
    if (options.description) embed.setDescription(String(options.description));
    if (options.footer) embed.setFooter(typeof options.footer === 'object' ? options.footer : { text: options.footer });
    if (options.image) embed.setImage(options.image);
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (options.author) embed.setAuthor(options.author);
    if (options.fields) embed.addFields(options.fields);

    return embed;
  }

  static success(title, description, options = {}) {
    return this.createBase({ title: `${config.emojis.success} ${title}`, description, color: colors.success, ...options });
  }

  static error(title, description, options = {}) {
    return this.createBase({ title: `${config.emojis.error} ${title}`, description, color: colors.error, ...options });
  }

  static warning(title, description, options = {}) {
    return this.createBase({ title: `${config.emojis.warning} ${title}`, description, color: colors.warning, ...options });
  }

  static info(title, description, options = {}) {
    return this.createBase({ title: `${config.emojis.info} ${title}`, description, color: colors.info, ...options });
  }

  static loading(title, description, options = {}) {
    return this.createBase({ title: `${config.emojis.refresh} ${title}`, description, color: colors.info, ...options });
  }

  static getStoreColor(type) {
    const typeColors = { free: 0x95A5A6, vip: 0x3498DB, premium: 0x9B59B6, verified: 0xF1C40F };
    return typeColors[type] || colors.primary;
  }

  static getStoreTypeName(type) {
    const names = { free: 'مجاني', vip: 'VIP', premium: 'مميز', verified: 'موثق' };
    return names[type] || type;
  }

  static getTrustEmoji(level) {
    const emojiMap = { none: '', verified: '✅', trusted: '🏆', premium: '💎' };
    return emojiMap[level] || '';
  }

  static getTrustLevelName(level) {
    const names = { none: 'لا شيء', verified: 'موثق ✅', trusted: 'موثوق 🏆', premium: 'مميز 💎' };
    return names[level] || level;
  }

  static getServiceCategoryName(category) {
    const names = {
      programming: '💻 برمجة', design: '🎨 تصميم', translation: '🌐 ترجمة',
      video_editing: '🎬 مونتاج', hosting: '☁️ استضافة', marketing: '📢 تسويق',
      writing: '✍️ كتابة', music: '🎵 موسيقى', other: '📦 أخرى',
    };
    return names[category] || category;
  }

  static getTimeUnitName(unit) {
    const names = { hours: 'ساعة', days: 'يوم', weeks: 'أسبوع' };
    return names[unit] || unit;
  }

  static getOrderStatusEmoji(status) {
    const emojiMap = { pending: '⏳', paid: '✅', processing: '🔄', delivered: '📦', completed: '🎉', cancelled: '❌', refunded: '💸', disputed: '⚠️' };
    return emojiMap[status] || '❓';
  }

  static getOrderStatusName(status) {
    const names = {
      pending: 'في الانتظار', paid: 'مدفوع', processing: 'قيد المعالجة',
      delivered: 'تم التسليم', completed: 'مكتمل', cancelled: 'ملغي',
      refunded: 'مسترد', disputed: 'متنازع عليه',
    };
    return names[status] || status;
  }

  static getOrderStatusColor(status) {
    const statusColors = {
      pending: 0xF39C12, paid: 0x3498DB, processing: 0x9B59B6,
      delivered: 0x2ECC71, completed: 0x2ECC71, cancelled: 0xE74C3C,
      refunded: 0xE74C3C, disputed: 0xE67E22,
    };
    return statusColors[status] || colors.primary;
  }

  static getPriorityEmoji(priority) {
    const emojiMap = { low: '🟢', medium: '🟡', high: '🟠', urgent: '🔴' };
    return emojiMap[priority] || '⚪';
  }

  static getPriorityColor(priority) {
    const priorityColors = { low: 0x2ECC71, medium: 0xF39C12, high: 0xE67E22, urgent: 0xE74C3C };
    return priorityColors[priority] || colors.primary;
  }

  static getPriorityName(priority) {
    const names = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' };
    return names[priority] || priority;
  }

  static getTicketStatusEmoji(status) {
    const emojiMap = { open: '🟢', waiting_user: '🟡', waiting_staff: '🟠', in_progress: '🔵', resolved: '✅', closed: '🔴' };
    return emojiMap[status] || '⚪';
  }

  static getTicketStatusName(status) {
    const names = {
      open: 'مفتوحة', waiting_user: 'بانتظار المستخدم', waiting_staff: 'بانتظار الدعم',
      in_progress: 'قيد العمل', resolved: 'محلولة', closed: 'مغلقة',
    };
    return names[status] || status;
  }

  static getTicketTypeName(type) {
    const names = {
      support: 'دعم فني', report: 'بلاغ', dispute: 'نزاع', partnership: 'شراكة',
      verification: 'توثيق', technical: 'تقني', billing: 'فوترة', other: 'أخرى',
    };
    return names[type] || type;
  }

  static getPaymentStatusName(status) {
    const names = {
      pending: '⏳ في انتظار الدفع', awaiting_verification: '🔍 قيد المراجعة',
      confirmed: '✅ تم التأكيد', completed: '✅ مكتملة', failed: '❌ فشلت',
      expired: '⏰ منتهية', cancelled: '🚫 ملغية', disputed: '⚠️ متنازع عليها',
    };
    return names[status] || status;
  }

  static getWithdrawalStatusName(status) {
    const names = {
      pending: '⏳ معلق', approved: '✅ تمت الموافقة', rejected: '❌ مرفوض',
      processing: '🔄 قيد المعالجة', completed: '✅ مكتمل', cancelled: '🚫 ملغي',
    };
    return names[status] || status;
  }
}

module.exports = { EmbedBuilderUtil };
