const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  level: { type: Number, required: true, min: 0, max: 100 },
  permissions: [{ type: String }],
  discordRoleId: { type: String, default: null },
  isDefault: { type: Boolean, default: false },
  color: { type: String, default: '#99AAB5' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

roleSchema.index({ guildId: 1, level: 1 });
roleSchema.index({ guildId: 1, discordRoleId: 1 }, { sparse: true });

module.exports = mongoose.model('Role', roleSchema);
