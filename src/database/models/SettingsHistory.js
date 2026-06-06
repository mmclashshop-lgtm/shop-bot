const mongoose = require('mongoose');

const settingsHistorySchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  changeId: { type: String, required: true, unique: true },
  section: { type: String, required: true },
  key: { type: String, required: true },
  oldValue: { type: mongoose.Schema.Types.Mixed, required: true },
  newValue: { type: mongoose.Schema.Types.Mixed, required: true },
  changedBy: { type: String, required: true },
  changedByTag: { type: String, default: '' },
  reason: { type: String, default: '' },
  version: { type: Number, required: true },
  backup: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

settingsHistorySchema.index({ guildId: 1, createdAt: -1 });
settingsHistorySchema.index({ guildId: 1, section: 1, createdAt: -1 });

module.exports = mongoose.model('SettingsHistory', settingsHistorySchema);
