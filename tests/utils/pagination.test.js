const PaginationUtil = require('../../src/utils/pagination');

describe('PaginationUtil', () => {
  test('parseCustomId extracts prefix, action, page', () => {
    const result = PaginationUtil.parseCustomId('product_list_store123_next_3');
    expect(result.prefix).toBe('product_list_store123');
    expect(result.action).toBe('next');
    expect(result.page).toBe(3);
  });

  test('parseCustomId handles first action', () => {
    const result = PaginationUtil.parseCustomId('product_list_store123_first_1');
    expect(result.action).toBe('first');
    expect(result.page).toBe(1);
  });

  test('createButtons returns array with buttons when multiple pages', () => {
    const buttons = PaginationUtil.createButtons('test', 2, 5);
    expect(Array.isArray(buttons)).toBe(true);
    expect(buttons[0].components.length).toBeGreaterThan(0);
  });

  test('createButtons returns info-only button when only one page', () => {
    const buttons = PaginationUtil.createButtons('test', 1, 1);
    expect(Array.isArray(buttons)).toBe(true);
    expect(buttons[0].components.length).toBe(1);
    expect(buttons[0].components[0].data.label).toContain('1/1');
  });

  test('createPageEmbed returns embed with correct fields', () => {
    const embed = PaginationUtil.createPageEmbed(
      'Test Title',
      'Test Description',
      [{ name: 'Field1', value: 'Value1', inline: true }],
      1,
      5
    );
    expect(embed.data.title).toBe('Test Title');
    expect(embed.data.description).toBe('Test Description');
    expect(embed.data.fields).toHaveLength(1);
    expect(embed.data.footer.text).toContain('1/5');
  });
});
