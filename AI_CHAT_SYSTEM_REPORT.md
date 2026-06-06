# AI Chat System — Architecture & Implementation Report

## Overview

Transform the existing modal-based AI system into a full ChatGPT-style Discord experience using dedicated private AI channels per user.

## Architecture

### Components

1. **`src/commands/ai/main.js`** — Modified `/ai` command. Panel with 3 buttons:
   - 💬 New Chat — creates/opens private AI channel
   - 📚 Help — usage guide
   - ⚙ Settings — AI settings (future)

2. **`src/services/AIChatSessionManager.js`** — NEW. Core service managing:
   - Channel creation with proper permissions
   - Session tracking (userId → channelId mapping)
   - Auto-cleanup of inactive channels
   - Rate limiting / cooldown enforcement
   - Conversation memory persistence

3. **`src/events/messageCreate.js`** — NEW. Listens for messages in AI channels:
   - Detects bot mentions and normal messages in AI channels
   - Forwards messages to AIService.chat()
   - Sends response with typing indicator
   - Handles channel action buttons

4. **`src/database/models/AIChat.js`** — Existing model (unchanged)

5. **`src/services/AIService.js`** — Existing service (unchanged, reused)

### Data Flow

```
/ai → Panel → [New Chat] → AIChatSessionManager.createChannel()
                              ↓
                        Create #ai-{username} in "AI Chats" category
                              ↓
                        Send welcome embed with action buttons
                              ↓
                        User types message → messageCreate event
                              ↓
                        AIChatSessionManager.handleMessage()
                              ↓
                        AIService.chat() → response
                              ↓
                        Bot replies with typing indicator
```

### Channel Lifecycle

```
Created → Active → Inactive (no message for N hours) → Deleted
                ↕
           User sends new message
```

## Channel Structure

### Category: "AI Chats"
- Created once per guild
- Positioned near top of channel list
- Name configurable in config

### Channel: `ai-{username}`
- One channel per user per guild
- Lowercase, spaces replaced with hyphens
- Max 100 characters (Discord limit)

### Permissions
| Role | Permission |
|------|-----------|
| Channel creator (user) | View, Read, Send Messages, Attach Files |
| Staff (Manage Messages) | View, Read, Send Messages |
| @everyone | Deny all |

## Welcome Embed

```
┌──────────────────────────────────┐
│ 🤖 AI Chat — {username}          │
│                                   │
│ مرحباً بك في محادثة الذكاء        │
│ الاصطناعي! 🎉                     │
│                                   │
│ اكتب أي شيء وسأرد عليك فوراً.    │
│                                   │
│ [🗑 Delete] [🔄 Clear] [📋 Export] │
│ [❌ Close]                         │
└──────────────────────────────────┘
```

## Action Buttons (in channel)

| Button | Action |
|--------|--------|
| 🗑 Delete Chat | Deletes the channel immediately |
| 🔄 Clear Memory | Clears conversation history, sends confirmation |
| 📋 Export Conversation | Sends transcript via ephemeral DM |
| ❌ Close Chat | Same as Delete (confirms first) |

## Rate Limiting

- **Per-user**: 30 requests/minute (from existing AIService)
- **Per-guild**: 500 requests/day (from existing AIService)
- **Per-user daily**: 100 requests/day (from existing AIService)
- **Cooldown between messages**: 2 seconds minimum
- **Anti-spam**: Same middleware as existing

## Auto-Cleanup

- Interval: every 30 minutes
- Threshold: channels inactive for 24 hours (configurable)
- Deletes channel and associated AIChat documents
- Sends a DM to the user before deletion (if possible)

## Implementation Details

### AIChatSessionManager methods:

```
createChannel(user, guild) → Channel
  - Checks for existing channel (no duplicates)
  - Creates category if missing
  - Creates channel with permission overwrites
  - Sends welcome embed with buttons
  - Returns channel

getChannel(userId, guildId) → Channel | null
  - Returns existing channel or null

handleMessage(message) → void
  - Starts typing indicator
  - Calls AIService.chat() with memory context
  - Sends response (splits if > 2000 chars)
  - Updates conversation memory

deleteChannel(channelId) → void
  - Cleans up channel and associated data

clearMemory(userId, guildId) → void
  - Clears AIChat documents for user

exportConversation(userId, guildId) → string
  - Returns formatted conversation transcript

_cleanupInactiveChannels() → void
  - Deletes channels inactive for 24h
```

### Config additions (in config/index.js):

```js
aiChat: {
  categoryName: 'AI Chats',
  inactivityTimeoutHours: 24,
  cleanupIntervalMinutes: 30,
  cooldownMs: 2000,
}
```

### Existing AI preserved:
- AIService.js — untouched
- AIChat.js model — untouched
- MemoryService.js — untouched
- All AI helper methods (generateProductDescription, etc.) — preserved

## Security Considerations

- No duplicate channels per user (checked before creation)
- Permission overwrites deny @everyone
- Only the channel owner and staff can see the channel
- Bot ignores non-AI-channel messages for AI processing
- Rate limits prevent abuse
- Auto-cleanup prevents channel hoarding
- Export only sent to the channel owner's DMs

## Files Modified/Created

| File | Action |
|------|--------|
| `src/commands/ai/main.js` | **MODIFIED** — New panel with 3 buttons |
| `src/services/AIChatSessionManager.js` | **CREATED** — Core channel management |
| `src/events/messageCreate.js` | **CREATED** — Message event handler |
| `src/config/index.js` | **MODIFIED** — Added aiChat config |
| `src/index.js` | **MODIFIED** — Wire new service |
| `src/handlers/commandHandler.js` | **MODIFIED** — Add messageCreate handler |
| `src/handlers/eventHandler.js` | **MODIFIED** — Load message event |

## Testing Checklist

- [ ] `/ai` opens panel
- [ ] "New Chat" creates channel in correct category
- [ ] No duplicate channels per user
- [ ] Permissions correctly set (user + staff only)
- [ ] Welcome embed appears with buttons
- [ ] Normal messages trigger AI response
- [ ] Typing indicator shows
- [ ] Buttons work: delete, clear, export, close
- [ ] Auto-cleanup deletes inactive channels
- [ ] Rate limits enforced
- [ ] Cooldown between messages works
- [ ] All 81 source files pass syntax check
