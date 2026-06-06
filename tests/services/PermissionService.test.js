const { PERMISSION_LEVELS, PERMISSIONS } = require('../../src/services/PermissionService');

jest.mock('../../src/database/models', () => ({
  Role: {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    create: jest.fn(),
    insertMany: jest.fn(),
    countDocuments: jest.fn(),
    deleteOne: jest.fn(),
  },
}));

jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

const PermissionService = require('../../src/services/PermissionService');
const { Role } = require('../../src/database/models');

describe('PermissionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PermissionService._roleCache.clear();
  });

  afterAll(() => {
    PermissionService.destroy();
  });

  describe('PERMISSION_LEVELS', () => {
    it('should have correct hierarchy', () => {
      expect(PERMISSION_LEVELS.BLOCKED).toBe(0);
      expect(PERMISSION_LEVELS.USER).toBe(10);
      expect(PERMISSION_LEVELS.MEMBER).toBe(20);
      expect(PERMISSION_LEVELS.SUPPORT).toBe(30);
      expect(PERMISSION_LEVELS.MOD).toBe(40);
      expect(PERMISSION_LEVELS.ADMIN).toBe(50);
      expect(PERMISSION_LEVELS.OWNER).toBe(60);
      expect(PERMISSION_LEVELS.SYSTEM).toBe(100);
    });
  });

  describe('PERMISSIONS', () => {
    it('should include all expected permissions', () => {
      expect(PERMISSIONS.STORE_CREATE).toBe('store:create');
      expect(PERMISSIONS.SETTINGS_MANAGE).toBe('settings:manage');
      expect(PERMISSIONS.BACKUP_MANAGE).toBe('backup:manage');
      expect(PERMISSIONS.OWNER_MANAGE).toBe('owner:manage');
    });
  });

  describe('getRequiredLevel', () => {
    it('should return correct level for owner permission', () => {
      expect(PermissionService.getRequiredLevel(PERMISSIONS.OWNER_MANAGE)).toBe(60);
    });

    it('should return ADMIN level for unknown permission', () => {
      expect(PermissionService.getRequiredLevel('unknown:perm')).toBe(50);
    });
  });

  describe('getLevelName', () => {
    it('should return Arabic names', () => {
      expect(PermissionService.getLevelName(0)).toBe('محظور');
      expect(PermissionService.getLevelName(50)).toBe('مدير');
      expect(PermissionService.getLevelName(60)).toBe('مالك');
    });

    it('should return unknown for invalid level', () => {
      expect(PermissionService.getLevelName(999)).toBe('غير معروف');
    });
  });

  describe('ensureDefaultRoles', () => {
    it('should create default roles when none exist', async () => {
      Role.countDocuments.mockResolvedValue(0);
      Role.insertMany.mockResolvedValue([{}, {}, {}, {}, {}, {}]);

      await PermissionService.ensureDefaultRoles('guild1');

      expect(Role.insertMany).toHaveBeenCalledTimes(1);
      const inserted = Role.insertMany.mock.calls[0][0];
      expect(inserted).toHaveLength(6);
      expect(inserted[0].level).toBe(60);
      expect(inserted[4].isDefault).toBe(true);
    });

    it('should skip if roles already exist', async () => {
      Role.countDocuments.mockResolvedValue(3);

      await PermissionService.ensureDefaultRoles('guild1');

      expect(Role.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('getUserLevel', () => {
    it('should return OWNER for guild owner', async () => {
      const interaction = {
        guild: { id: 'guild1', ownerId: 'owner1' },
        user: { id: 'owner1' },
        member: { permissions: { has: jest.fn() }, roles: { cache: new Map() } },
      };

      const level = await PermissionService.getUserLevel(interaction);
      expect(level).toBe(60);
    });

    it('should return ADMIN for users with Administrator permission', async () => {
      const interaction = {
        guild: { id: 'guild1', ownerId: 'owner2' },
        user: { id: 'user1' },
        member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      };

      const level = await PermissionService.getUserLevel(interaction);
      expect(level).toBe(50);
    });

    it('should return USER for members with no roles', async () => {
      Role.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([
        { discordRoleId: 'role1', level: 30, isDefault: false },
        { discordRoleId: null, level: 10, isDefault: true },
      ]) }) });

      const interaction = {
        guild: { id: 'guild1', ownerId: 'owner2' },
        user: { id: 'user1' },
        member: { permissions: { has: () => false }, roles: { cache: new Map() } },
      };

      const level = await PermissionService.getUserLevel(interaction);
      expect(level).toBe(10);
    });

    it('should return MOD level for users with mod role', async () => {
      const roleCache = new Map();
      roleCache.set('role1', { id: 'role1' });

      Role.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([
        { discordRoleId: 'role1', level: 40, isDefault: false },
        { discordRoleId: null, level: 20, isDefault: true },
      ]) }) });

      const interaction = {
        guild: { id: 'guild1', ownerId: 'owner2' },
        user: { id: 'user1' },
        member: { permissions: { has: () => false }, roles: { cache: roleCache } },
      };

      const level = await PermissionService.getUserLevel(interaction);
      expect(level).toBe(40);
    });
  });

  describe('hasPermission', () => {
    it('should return true for user-level permissions', async () => {
      const result = await PermissionService.hasPermission({}, PERMISSIONS.MARKET_VIEW);
      expect(result).toBe(true);
    });

    it('should return false for admin permission when user is USER level', async () => {
      Role.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([
        { discordRoleId: null, level: 10, isDefault: true },
      ]) }) });

      const interaction = {
        guild: { id: 'guild1', ownerId: 'owner2' },
        user: { id: 'user1' },
        member: { permissions: { has: () => false }, roles: { cache: new Map() } },
      };

      const result = await PermissionService.hasPermission(interaction, PERMISSIONS.SETTINGS_MANAGE);
      expect(result).toBe(false);
    });

    it('should return true for admin permission when user is ADMIN level', async () => {
      const interaction = {
        guild: { id: 'guild1', ownerId: 'owner2' },
        user: { id: 'admin1' },
        member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      };

      const result = await PermissionService.hasPermission(interaction, PERMISSIONS.SETTINGS_MANAGE);
      expect(result).toBe(true);
    });
  });

  describe('createPermissionGuard', () => {
    it('should call next when permission is granted', async () => {
      const interaction = {
        guild: { id: 'guild1', ownerId: 'owner1' },
        user: { id: 'owner1' },
        member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      };
      const next = jest.fn();

      const guard = PermissionService.createPermissionGuard(PERMISSIONS.SETTINGS_MANAGE);
      await guard(interaction, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should reply with error when permission is denied', async () => {
      Role.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([
        { discordRoleId: null, level: 10, isDefault: true },
      ]) }) });

      const reply = jest.fn();
      const interaction = {
        guild: { id: 'guild1', ownerId: 'owner2' },
        user: { id: 'user1' },
        member: { permissions: { has: () => false }, roles: { cache: new Map() } },
        reply,
      };
      const next = jest.fn();

      const guard = PermissionService.createPermissionGuard(PERMISSIONS.SETTINGS_MANAGE);
      await guard(interaction, next);

      expect(next).not.toHaveBeenCalled();
      expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    });
  });

  describe('addRole / updateRole / removeRole / listRoles', () => {
    it('addRole should create role and clear cache', async () => {
      Role.create.mockResolvedValue({ guildId: 'guild1', name: 'Test', level: 30 });

      const role = await PermissionService.addRole('guild1', 'Test', 30);

      expect(Role.create).toHaveBeenCalledWith(expect.objectContaining({ guildId: 'guild1', name: 'Test', level: 30 }));
    });

    it('updateRole should update and clear cache', async () => {
      Role.findByIdAndUpdate.mockResolvedValue({ guildId: 'guild1' });

      const result = await PermissionService.updateRole('roleId', { name: 'Updated' });

      expect(Role.findByIdAndUpdate).toHaveBeenCalledWith('roleId', expect.objectContaining({ name: 'Updated' }), expect.any(Object));
    });

    it('listRoles should return sorted roles', async () => {
      Role.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ level: 50 }, { level: 10 }]) }) });

      const roles = await PermissionService.listRoles('guild1');

      expect(roles).toHaveLength(2);
    });
  });

  describe('getEffectivePermissions', () => {
    it('should return permissions for user level', async () => {
      Role.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ discordRoleId: null, level: 10, isDefault: true }]) }) });

      const interaction = {
        guild: { id: 'guild1', ownerId: 'owner2' },
        user: { id: 'user1' },
        member: { permissions: { has: () => false }, roles: { cache: new Map() } },
      };

      const perms = await PermissionService.getEffectivePermissions(interaction);
      expect(perms).toContain('market:view');
      expect(perms).not.toContain('settings:manage');
    });
  });
});
