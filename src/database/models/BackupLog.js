const mongoose = require('mongoose');

const backupLogSchema = new mongoose.Schema({
  backupId: { type: String, required: true, unique: true },
  type: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true },
  status: { type: String, enum: ['running', 'completed', 'failed', 'verified', 'corrupted'], default: 'running' },
  filePath: { type: String, required: true },
  fileName: { type: String, required: true },
  sizeBytes: { type: Number, default: 0 },
  compressedSizeBytes: { type: Number, default: 0 },
  compressionRatio: { type: Number, default: 0 },
  md5Hash: { type: String, default: '' },
  databaseSize: { type: String, default: '' },
  collectionCount: { type: Number, default: 0 },
  documentCount: { type: Number, default: 0 },
  durationMs: { type: Number, default: 0 },
  errorMessage: { type: String, default: '' },
  verifiedAt: { type: Date },
  verifiedBy: { type: String, default: '' },
  verifiedSuccess: { type: Boolean },
  restoredAt: { type: Date },
  restoredBy: { type: String, default: '' },
  restoredSuccess: { type: Boolean },
  metadata: {
    mongodumpVersion: String,
    nodeVersion: String,
    platform: String,
    hostname: String,
    totalDbSize: String,
  },
}, { timestamps: true });

backupLogSchema.index({ type: 1, createdAt: -1 });
backupLogSchema.index({ status: 1 });
backupLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('BackupLog', backupLogSchema);
