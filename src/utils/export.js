const { AttachmentBuilder } = require('discord.js');

class ExportUtil {
  static toCSV(data, columns) {
    const header = columns.map(c => ExportUtil.escapeCSV(c.label)).join(',');
    const rows = data.map(item => {
      return columns.map(c => ExportUtil.escapeCSV(String(c.value(item) ?? ''))).join(',');
    });
    return [header, ...rows].join('\n');
  }

  static toJSON(data, pretty = true) {
    return JSON.stringify(data, null, pretty ? 2 : 0);
  }

  static createAttachment(content, filename, type = 'csv') {
    const ext = type === 'csv' ? 'csv' : 'json';
    const fullName = `${filename}.${ext}`;
    const contentType = type === 'csv' ? 'text/csv' : 'application/json';
    return new AttachmentBuilder(Buffer.from(content, 'utf-8'), { name: fullName });
  }

  static escapeCSV(str) {
    if (!str) return '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  static exportOrders(orders) {
    return this.toCSV(orders, [
      { label: 'رقم الطلب', value: o => o.orderNumber },
      { label: 'المنتج', value: o => o.itemName },
      { label: 'الكمية', value: o => o.quantity },
      { label: 'السعر', value: o => o.total },
      { label: 'الحالة', value: o => o.status },
      { label: 'المشتري', value: o => o.buyerId },
      { label: 'البائع', value: o => o.sellerId },
      { label: 'التاريخ', value: o => o.createdAt ? new Date(o.createdAt).toISOString() : '' },
    ]);
  }

  static exportTransactions(transactions) {
    return this.toCSV(transactions, [
      { label: 'النوع', value: t => t.type },
      { label: 'المبلغ', value: t => t.amount },
      { label: 'الحالة', value: t => t.status },
      { label: 'الوصف', value: t => t.description },
      { label: 'المستخدم', value: t => t.userId },
      { label: 'التاريخ', value: t => t.createdAt ? new Date(t.createdAt).toISOString() : '' },
    ]);
  }

  static exportProducts(products) {
    return this.toCSV(products, [
      { label: 'الاسم', value: p => p.name },
      { label: 'السعر', value: p => p.price },
      { label: 'الفئة', value: p => p.category },
      { label: 'المخزون', value: p => p.stock },
      { label: 'المبيعات', value: p => p.soldCount },
      { label: 'التقييم', value: p => p.rating?.average || 0 },
      { label: 'المتجر', value: p => p.storeId?.toString() || '' },
    ]);
  }
}

module.exports = ExportUtil;
