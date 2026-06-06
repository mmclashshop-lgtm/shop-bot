# 💾 نظام النسخ الاحتياطي — Backup System Report

## 📋 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    BackupService                            │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Scheduler   │  │  Backup      │  │  Health Monitor  │   │
│  │  (CronJobs)  │──│  Engine      │──│  (Hourly Check)  │   │
│  └─────────────┘  └──────┬───────┘  └──────────────────┘   │
│                          │                                  │
│  ┌───────────────────────┼───────────────────────────────┐  │
│  │                       ▼                               │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌────────────────┐   │  │
│  │  │  mongodump   │  │  Gzip    │  │  Verification  │   │  │
│  │  │  (stream)    │──│(built-in)│  │  (MD5+Gzip+)  │   │  │
│  │  └─────────────┘  └──────────┘  └────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Storage Layout                            │  │
│  │  data/backups/                                        │  │
│  │  ├── daily/      (7 copies, rotated daily)            │  │
│  │  ├── weekly/     (4 copies, rotated weekly)           │  │
│  │  └── monthly/    (12 copies, rotated monthly)         │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Metadata Storage                          │  │
│  │  • MongoDB Collection: BackupLog                      │  │
│  │  • Per-backup JSON: <file>.meta.json                  │  │
│  │  • Fields: backupId, type, size, md5Hash, status,     │  │
│  │    duration, collectionCount, documentCount, ...      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 🔄 Backup Schedules

| Type    | Frequency     | Retention | Cron Expression | Directory      |
|---------|---------------|-----------|-----------------|----------------|
| Daily   | Every day     | 7 copies  | `0 0 * * *`    | `data/backups/daily/` |
| Weekly  | Every Sunday  | 4 copies  | `0 0 * * 0`    | `data/backups/weekly/`|
| Monthly | 1st of month  | 12 copies | `0 0 1 * *`    | `data/backups/monthly/`|

### Retention Policy Enforcement
- **Daily:** Oldest backups are deleted when count exceeds 7
- **Weekly:** Oldest backups are deleted when count exceeds 4
- **Monthly:** Oldest backups are deleted when count exceeds 12
- Enforcement runs automatically **after each successful backup**

## 🔧 Backup Process

### 1. Backup Creation (`/backup create`)

```
1. Validate type → ensure mongodump is available
2. Generate backupId (backup_<type>_<timestamp>_<random>)
3. Create BackupLog entry (status: 'running')
4. Execute mongodump --gzip --archive=<path>
   - Streams directly to gzip-compressed archive
   - 10-minute timeout
   - No intermediate files
5. On success:
   - Update BackupLog: status → 'completed', size, md5, duration
   - Write .meta.json alongside archive
   - Enforce retention policy
   - Notify admin via DM
6. On failure:
   - Update BackupLog: status → 'failed', errorMessage
   - Delete partial archive + meta file
   - Notify admin via DM
```

### 2. Backup Verification (`/backup list` → verify on select)

```
1. Stat file → check size > 0
2. MD5 hash comparison (against stored hash)
3. Gzip integrity check (decompress stream → verify data > 0)
4. Update BackupLog: status → 'verified' or 'corrupted'
5. Alert admin on corruption
```

### 3. Backup Restore (`/backup restore`)

```
1. Fetch BackupLog by backupId
2. Verify backup file exists on disk
3. Run verification (MD5 + gzip integrity)
4. If verification FAILS → abort with detailed error
5. If verification PASSES → execute mongorestore --drop --gzip --archive=<path>
6. Update BackupLog: restoredAt, restoredBy, restoredSuccess
7. Notify admin via DM
```

## 📊 Backup Metadata (BackupLog Collection)

| Field               | Type     | Description                              |
|---------------------|----------|------------------------------------------|
| backupId            | String   | Unique identifier                        |
| type                | String   | daily / weekly / monthly                 |
| status              | String   | running / completed / failed / verified / corrupted |
| filePath            | String   | Absolute path to backup archive          |
| fileName            | String   | Archive filename                         |
| sizeBytes           | Number   | Uncompressed database size               |
| compressedSizeBytes | Number   | Compressed archive size                  |
| compressionRatio    | Number   | compressionRatio = compressed / original |
| md5Hash             | String   | MD5 checksum for integrity               |
| databaseSize        | String   | Human-readable total DB size             |
| collectionCount     | Number   | Number of collections backed up          |
| documentCount       | Number   | Number of documents backed up            |
| durationMs          | Number   | Backup duration in milliseconds          |
| errorMessage        | String   | Error details if failed                  |
| verifiedAt          | Date     | Last verification timestamp              |
| verifiedSuccess     | Boolean  | Was verification successful?             |
| restoredAt          | Date     | Last restore timestamp                   |
| restoredSuccess     | Boolean | Was restore successful?                  |
| metadata            | Object   | mongodumpVersion, nodeVersion, platform, hostname |

## 🚨 Admin Alerts

The system sends **Discord DMs to the owner** for:

| Event                          | Severity | Description                              |
|--------------------------------|----------|------------------------------------------|
| `backup_completed`             | ✅ Info  | Backup created successfully              |
| `backup_failed`                | 🔴 Error | Backup creation failed                   |
| `backup_restored`              | ✅ Info  | Backup restored successfully             |
| `backup_restore_failed`        | 🔴 Error | Restore operation failed                 |
| `backup_verification_failed`   | 🟠 Warning | Backup file may be corrupted           |

## 🩺 Health Monitoring

Run automatically **every hour**:

| Check                          | What it validates                       |
|--------------------------------|-----------------------------------------|
| Last backup age                | < 48 hours → healthy                    |
| Last backup status             | Must not be 'failed'                    |
| Storage capacity               | < 80% → healthy                         |
| Backup file existence          | Backup files must exist on disk         |
| Running backups                | No stale running entries                 |

### Health Status Reporting
- View via `/backup status`
- Includes: last backup info, storage stats, issues found
- Recovery suggestions provided automatically

## 💡 Auto-Recovery Suggestions

The system analyzes health state and provides recommendations:

| Issue                         | Suggestion                              | Priority  |
|-------------------------------|-----------------------------------------|-----------|
| No backups exist              | Create first backup immediately         | Critical  |
| Last backup failed            | Check disk space + MongoDB, retry       | High      |
| Backup > 2 days old           | Manual backup trigger recommended       | Medium    |
| Storage > 80% capacity        | Free disk space or increase storage     | Critical  |

## 📝 Commands Reference

### `/backup create <type>`
- **Type:** daily | weekly | monthly
- **Permission:** Administrator
- **Description:** Creates a new backup of the specified type
- **Response:** Embed with backupId, size, duration

### `/backup restore <backup_id>`
- **Permission:** Administrator
- **Description:** Restores database from a backup
- **Process:** Requires confirmation button → verification → restore
- **Warning:** Destructive — replaces current database

### `/backup list [type]`
- **Permission:** Administrator
- **Description:** Lists all backups (optionally filtered by type)
- **Response:** Embed with backupId, type, status, size, date

### `/backup status`
- **Permission:** Administrator
- **Description:** Shows backup system health, storage stats, running jobs
- **Response:** Full status embed with recovery suggestions

## 🔄 Recovery Plan

### Partial Recovery (single collection lost)
```
1. Identify the collection and nearest backup
2. Restore using: mongorestore --nsInclude=<db.collection> --archive=<backup>
```

### Full Recovery (database corrupted)
```
1. Stop the bot: pm2 stop market-ai-bot
2. Verify latest backup integrity: /backup list
3. Run restore: /backup restore <backup_id>
4. Verify data: Check critical collections
5. Restart the bot: pm2 start market-ai-bot
```

### Disaster Recovery (server lost)
```
1. Deploy new server with same codebase
2. Install MongoDB + mongodump/mongorestore
3. Transfer backup archive from cloud storage to data/backups/<type>/
4. Run: mongorestore --drop --gzip --archive=<backup_file>
5. Start bot: pm2 start ecosystem.config.js
```

## 🛡️ File Format

```
mongodb_<type>_<YYYY-MM-DDTHH-mm-ss>.gz
```

Example:
```
mongodb_daily_2026-06-06T00-00-00.gz
```

Each archive is accompanied by a metadata file:
```
mongodb_daily_2026-06-06T00-00-00.gz.meta.json
```

## ⚙️ Configuration

Backup settings are hardcoded in `BackupService.js`:

- **Daily retention:** 7 copies
- **Weekly retention:** 4 copies
- **Monthly retention:** 12 copies
- **Backup timeout:** 10 minutes (600,000 ms)
- **Health check interval:** 1 hour
- **Backup root directory:** `data/backups/`

## ❌ Failure Handling

| Failure Mode              | Detection                      | Action                                    |
|---------------------------|--------------------------------|-------------------------------------------|
| mongodump not installed   | Child process error            | Log error + notify admin                  |
| mongodump timeout (>10m)  | execFile timeout               | Kill process + log + notify admin         |
| Disk full during backup   | Write error / exit code        | Partial file deleted + notify admin       |
| MongoDB connection lost   | mongodump error                | Log + notify admin                        |
| Backup file corruption    | Verification check             | Mark as corrupted + notify admin          |
| Restore failure           | mongorestore error             | Log + notify admin                        |
| Cron job missed           | Health check (age > 48h)       | Flag in health report + suggestion        |

## 📁 Files Created

| File                                    | Purpose                                  |
|-----------------------------------------|------------------------------------------|
| `src/services/BackupService.js`         | Core backup engine                       |
| `src/commands/backup/main.js`           | Discord slash commands                   |
| `src/database/models/BackupLog.js`      | MongoDB backup metadata model            |
| `src/database/models/index.js`          | Updated model exports                    |
| `src/deploy-commands.js`                | Updated PUBLIC_COMMANDS                  |
| `src/index.js`                          | BackupService initialization/shutdown    |
| `data/backups/daily/`                   | Daily backup storage                     |
| `data/backups/weekly/`                  | Weekly backup storage                    |
| `data/backups/monthly/`                 | Monthly backup storage                   |

## 📊 Storage Estimation

| Database Size | Daily (7)  | Weekly (4) | Monthly (12) | Total (23 copies) |
|--------------|------------|------------|--------------|-------------------|
| 100 MB       | 700 MB     | 400 MB     | 1.2 GB       | ~2.3 GB           |
| 500 MB       | 3.5 GB     | 2 GB       | 6 GB         | ~11.5 GB          |
| 1 GB         | 7 GB       | 4 GB       | 12 GB        | ~23 GB            |
| 5 GB         | 35 GB      | 20 GB      | 60 GB        | ~115 GB           |

*Compression ratio varies: MongoDB data typically compresses 3:1 to 8:1 with gzip.*
