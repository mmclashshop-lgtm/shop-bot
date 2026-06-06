const ExportUtil = require('../../src/utils/export');

describe('ExportUtil', () => {
  const sampleOrders = [
    { orderNumber: 'ORD-001', itemName: 'Test', quantity: 2, total: 100, status: 'completed', buyerId: '123', sellerId: '456', createdAt: new Date() },
  ];

  const sampleTransactions = [
    { type: 'purchase', amount: -50, status: 'completed', description: 'Test', userId: '123', createdAt: new Date() },
  ];

  const sampleProducts = [
    { name: 'Product A', price: 100, category: 'tech', stock: 10, soldCount: 5, rating: { average: 4.5 } },
  ];

  test('toCSV generates CSV string', () => {
    const csv = ExportUtil.toCSV(sampleOrders, [
      { label: 'رقم الطلب', value: o => o.orderNumber },
      { label: 'المنتج', value: o => o.itemName },
      { label: 'الكمية', value: o => o.quantity },
    ]);
    expect(csv).toContain('ORD-001');
    expect(csv).toContain('Test');
    expect(csv.split('\n').length).toBe(2);
  });

  test('toJSON generates valid JSON', () => {
    const json = ExportUtil.toJSON(sampleOrders);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].orderNumber).toBe('ORD-001');
  });

  test('escapeCSV handles special chars', () => {
    expect(ExportUtil.escapeCSV('hello')).toBe('hello');
    expect(ExportUtil.escapeCSV('he,llo')).toBe('"he,llo"');
    expect(ExportUtil.escapeCSV('he"llo')).toBe('"he""llo"');
  });

  test('exportOrders formats correctly', () => {
    const csv = ExportUtil.exportOrders(sampleOrders);
    expect(csv).toContain('رقم الطلب');
    expect(csv).toContain('ORD-001');
  });

  test('exportTransactions formats correctly', () => {
    const csv = ExportUtil.exportTransactions(sampleTransactions);
    expect(csv).toContain('النوع');
    expect(csv).toContain('purchase');
  });

  test('exportProducts formats correctly', () => {
    const csv = ExportUtil.exportProducts(sampleProducts);
    expect(csv).toContain('الاسم');
    expect(csv).toContain('Product A');
  });
});
