const { ttlJitter } = require('../../src/cache/CacheMonitor');

describe('Model: Role', () => {
  it('should have correct schema fields', () => {
    const Role = require('../../src/database/models/Role');
    const schema = Role.schema;

    expect(schema.paths.guildId).toBeDefined();
    expect(schema.paths.name).toBeDefined();
    expect(schema.paths.level).toBeDefined();
    expect(schema.paths.permissions).toBeDefined();
    expect(schema.paths.discordRoleId).toBeDefined();
    expect(schema.paths.isDefault).toBeDefined();
    expect(schema.paths.color).toBeDefined();
  });

  it('should have required fields', () => {
    const Role = require('../../src/database/models/Role');
    const schema = Role.schema;

    expect(schema.paths.guildId.options.required).toBe(true);
    expect(schema.paths.name.options.required).toBe(true);
    expect(schema.paths.level.options.required).toBe(true);
  });

  it('should have level constraints', () => {
    const Role = require('../../src/database/models/Role');
    const schema = Role.schema;

    expect(schema.paths.level.options.min).toBe(0);
    expect(schema.paths.level.options.max).toBe(100);
  });

  it('should have indexes', () => {
    const Role = require('../../src/database/models/Role');
    const indexes = Role.schema.indexes();

    const hasGuildLevelIndex = indexes.some(idx =>
      JSON.stringify(idx[0]) === JSON.stringify({ guildId: 1, level: 1 })
    );
    expect(hasGuildLevelIndex).toBe(true);

    const hasSparseDiscordIndex = indexes.some(idx =>
      JSON.stringify(idx[0]) === JSON.stringify({ guildId: 1, discordRoleId: 1 })
    );
    expect(hasSparseDiscordIndex).toBe(true);
  });
});

describe('Model: User', () => {
  it('should have expected schema paths', () => {
    const { User } = require('../../src/database/models');
    const schema = User.schema;

    expect(schema.paths.discordId).toBeDefined();
    expect(schema.paths.username).toBeDefined();
    expect(schema.paths.platformEarnings).toBeDefined();
  });
});
