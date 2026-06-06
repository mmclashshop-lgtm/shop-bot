const { checkBan, validateOwnership, antiScam, invalidateCachedUser } = require('../../src/middleware/security');

// Mock User model
jest.mock('../../src/database/models', () => ({
  User: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
  Store: {},
}));

const { User } = require('../../src/database/models');

const baseInteraction = {
  user: { id: '123' },
  isButton: () => false,
  isStringSelectMenu: () => false,
  isModalSubmit: () => false,
  isMessageComponent: () => false,
  deferred: false,
  replied: false,
  reply: jest.fn().mockResolvedValue(true),
  editReply: jest.fn().mockResolvedValue(true),
};

describe('Middleware - checkBan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateCachedUser('123');
    invalidateCachedUser('456');
  });

  test('allows non-banned users', async () => {
    User.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ isBanned: false }) });
    const next = jest.fn();
    await checkBan({ ...baseInteraction }, next);
    expect(next).toHaveBeenCalled();
  });

  test('blocks banned users', async () => {
    User.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ isBanned: true, banReason: 'Spam' }) });
    const next = jest.fn();
    await checkBan({ ...baseInteraction }, next);
    expect(baseInteraction.reply).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('allows unregistered users', async () => {
    User.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const next = jest.fn();
    await checkBan({ ...baseInteraction }, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('Middleware - validateOwnership', () => {
  test('skips non-protected commands', async () => {
    const next = jest.fn();
    await validateOwnership({
      ...baseInteraction,
      options: { getSubcommand: () => 'create', getString: () => null },
    }, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('Middleware - antiScam', () => {
  test('allows clean content', async () => {
    const next = jest.fn();
    await antiScam({
      ...baseInteraction,
      options: { data: [{ value: 'safe content' }] },
    }, next);
    expect(next).toHaveBeenCalled();
  });

  test('blocks content with scam keywords', async () => {
    User.findOneAndUpdate.mockResolvedValue(true);
    const next = jest.fn();
    await antiScam({
      ...baseInteraction,
      options: { data: [{ value: 'this is a scam' }] },
    }, next);
    expect(baseInteraction.reply).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
