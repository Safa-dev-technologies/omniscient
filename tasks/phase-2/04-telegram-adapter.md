# Task 04: Telegram Adapter

## Overview
Implement the Telegram Bot API adapter for receiving and sending messages. Telegram's API is simpler than WhatsApp but has different security requirements.

## Files to Create

```
src/adapters/telegram/
├── telegram.adapter.ts     # Main adapter implementation
├── telegram.types.ts       # Telegram-specific types
├── telegram.utils.ts       # Signature verification, helpers
└── index.ts                # Re-exports
```

## Telegram Bot API Reference

- Base URL: `https://api.telegram.org/bot{token}`
- Send Message: `POST /sendMessage`
- Webhook: Set via `POST /setWebhook`
- Docs: https://core.telegram.org/bots/api

## Requirements

### 1. telegram.types.ts

Define types matching Telegram Bot API:

```typescript
// Incoming webhook payload (Update object)
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  // Other update types we don't handle
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;                    // Unix timestamp
  text?: string;
  caption?: string;                // For media messages

  // Media types
  photo?: TelegramPhotoSize[];
  audio?: TelegramAudio;
  video?: TelegramVideo;
  document?: TelegramDocument;
  voice?: TelegramVoice;
  sticker?: TelegramSticker;
  location?: TelegramLocation;
  contact?: TelegramContact;

  // Reply info
  reply_to_message?: TelegramMessage;

  // Special message types
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
  group_chat_created?: boolean;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramChat {
  id: number;                      // Can be negative for groups
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;                  // For groups/channels
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
  title?: string;
}

interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  type: 'regular' | 'mask' | 'custom_emoji';
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  emoji?: string;
}

interface TelegramLocation {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number;
}

interface TelegramContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  chat_instance: string;
  data?: string;                   // Callback data from button
}

// Outgoing message structures
interface TelegramSendMessageRequest {
  chat_id: number | string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  reply_markup?: TelegramReplyMarkup;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
}

interface TelegramReplyMarkup {
  inline_keyboard?: TelegramInlineKeyboardButton[][];
  keyboard?: TelegramKeyboardButton[][];
  remove_keyboard?: boolean;
  one_time_keyboard?: boolean;
  resize_keyboard?: boolean;
}

interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;          // Max 64 bytes
  url?: string;
}

interface TelegramKeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
}

// API response wrapper
interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}
```

### 2. telegram.utils.ts

```typescript
/**
 * Verify Telegram webhook using secret token
 * Telegram supports optional secret_token in setWebhook
 * If set, it's sent in X-Telegram-Bot-Api-Secret-Token header
 */
function verifyWebhookSecret(
  headerToken: string | undefined,
  expectedSecret: string
): boolean;

/**
 * Get file download URL from file_id
 * Requires calling getFile first to get file_path
 */
async function getFileUrl(
  fileId: string,
  botToken: string
): Promise<string>;

/**
 * Build display name from Telegram user
 */
function getDisplayName(user: TelegramUser): string;

/**
 * Escape special characters for MarkdownV2
 * Characters to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
function escapeMarkdownV2(text: string): string;
```

### 3. telegram.adapter.ts

```typescript
class TelegramAdapter implements ChannelAdapter {
  readonly channel = Channel.TELEGRAM;

  private botToken: string;
  private webhookSecret?: string;
  private botInfo?: TelegramUser;

  async initialize(config: AdapterConfig): Promise<void> {
    // Validate token by calling getMe
    // Store bot info for later use
  }

  async parseIncoming(
    payload: unknown,
    headers?: Record<string, string>
  ): Promise<NormalizedMessage | null>;

  async sendMessage(params: SendMessageParams): Promise<SendResult>;

  verifySignature(payload: string, signature: string): boolean {
    // For Telegram, this checks the X-Telegram-Bot-Api-Secret-Token header
    // if webhook was set up with secret_token
  }

  async isHealthy(): Promise<boolean> {
    // Call getMe to verify token is still valid
  }

  // Telegram-specific: Set webhook URL
  async setWebhook(url: string, secretToken?: string): Promise<boolean>;

  // Telegram-specific: Delete webhook
  async deleteWebhook(): Promise<boolean>;

  // Telegram-specific: Answer callback queries (for inline buttons)
  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string
  ): Promise<boolean>;
}
```

## Security Considerations

### Webhook Security

1. **Secret token verification**
   - When setting webhook, include `secret_token` parameter
   - Telegram sends this in `X-Telegram-Bot-Api-Secret-Token` header
   - Verify on every request

```typescript
async function setWebhook(url: string, secretToken: string): Promise<boolean> {
  const response = await fetch(`https://api.telegram.org/bot${this.botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secretToken,  // 1-256 characters, A-Za-z0-9_-
      allowed_updates: ['message', 'callback_query'],
    }),
  });
  // ...
}

function verifyWebhookSecret(headerToken: string | undefined, expected: string): boolean {
  if (!headerToken || !expected) return false;
  return crypto.timingSafeEqual(
    Buffer.from(headerToken),
    Buffer.from(expected)
  );
}
```

2. **Bot token security**
   - Bot token grants full control of the bot
   - NEVER log it, even partially
   - Revoke immediately if compromised (via @BotFather)

3. **IP allowlisting (optional)**
   - Telegram webhooks come from specific IP ranges
   - Can validate, but ranges may change

### Data Validation

1. **Validate chat_id is integer or string**
   - Private chats: positive integer
   - Groups/channels: negative integer
   - Usernames: string starting with @

2. **Callback data limits**
   - Max 64 bytes
   - Validate before sending

## Edge Cases to Handle

### parseIncoming()

1. **Channel posts vs messages**
   - `channel_post` is for channels, not private messages
   - Usually want to ignore or handle differently

2. **Edited messages**
   - `edited_message` instead of `message`
   - Consider including edit flag in metadata

3. **Callback queries (button clicks)**
   - Come as `callback_query` not `message`
   - Must call `answerCallbackQuery` to stop loading indicator
   - Extract `data` field for button payload

4. **Group messages**
   - Chat ID is negative
   - May want to filter to only respond when mentioned

5. **Media groups**
   - Multiple photos sent together
   - Each photo is a separate update with same `media_group_id`

6. **Stickers and animated stickers**
   - Stickers have emoji equivalent
   - Could extract emoji as text content

7. **System messages**
   - `new_chat_members`, `left_chat_member`, `group_chat_created`
   - Return `null` - not user messages

8. **Missing `from` field**
   - Channel posts may not have `from`
   - Handle gracefully

### sendMessage()

1. **Message length limits**
   - Text: 4096 characters max
   - Caption: 1024 characters max
   - Button text: 64 bytes max
   - Callback data: 64 bytes max

2. **Markdown escaping**
   - MarkdownV2 requires escaping many characters
   - Use HTML parse_mode if content has special chars
   - Or provide escaping utility

3. **Chat not found**
   - User may have blocked bot or deleted account
   - API returns error code 403 or 400

4. **Rate limits**
   - 30 messages/second to same chat
   - 20 messages/minute to same group
   - Handle 429 Too Many Requests

5. **Inline keyboards**
   - Max 8 buttons per row
   - Max 100 buttons total
   - Validate before sending

### File Downloads

1. **File size limits**
   - Bots can download files up to 20MB
   - Check file_size before downloading

2. **Temporary URLs**
   - File URLs expire after some time
   - Download promptly or store file_id for re-fetching

## API Integration

### Send Text Message

```typescript
POST https://api.telegram.org/bot{token}/sendMessage
Content-Type: application/json

{
  "chat_id": 123456789,
  "text": "Hello!",
  "parse_mode": "HTML",
  "reply_markup": {
    "inline_keyboard": [[
      { "text": "Option 1", "callback_data": "opt1" },
      { "text": "Option 2", "callback_data": "opt2" }
    ]]
  }
}

// Response
{
  "ok": true,
  "result": {
    "message_id": 123,
    "from": { "id": 123, "is_bot": true, "first_name": "MyBot" },
    "chat": { "id": 123456789, "type": "private", "first_name": "John" },
    "date": 1609459200,
    "text": "Hello!"
  }
}
```

### Answer Callback Query

```typescript
POST https://api.telegram.org/bot{token}/answerCallbackQuery
Content-Type: application/json

{
  "callback_query_id": "abc123",
  "text": "Button clicked!",       // Optional toast message
  "show_alert": false              // false = toast, true = alert popup
}
```

## Acceptance Criteria

- [ ] Implements `ChannelAdapter` interface completely
- [ ] Webhook secret verification is implemented
- [ ] Text messages can be sent successfully
- [ ] Inline keyboard buttons work
- [ ] Callback queries are handled (button clicks)
- [ ] `answerCallbackQuery` is called for button clicks
- [ ] Incoming text messages are parsed correctly
- [ ] Media messages set hasMedia=true with correct type
- [ ] System messages return null
- [ ] Bot can set its own webhook via `setWebhook()`
- [ ] All API errors are handled gracefully

## Testing Requirements

Create `tests/unit/adapters/telegram.adapter.test.ts`:

- [ ] Test webhook secret verification (valid, invalid, missing)
- [ ] Test parseIncoming with text message
- [ ] Test parseIncoming with photo message
- [ ] Test parseIncoming with callback query
- [ ] Test parseIncoming with system message (should return null)
- [ ] Test parseIncoming with channel post (should return null or handle)
- [ ] Test sendMessage success
- [ ] Test sendMessage with inline keyboard
- [ ] Test sendMessage with API error
- [ ] Test getDisplayName utility
- [ ] Test escapeMarkdownV2 utility

## Notes for Implementer

1. **Telegram user IDs are integers** - Different from WhatsApp (phone strings)
2. **Chat ID can be negative** - Groups have negative IDs
3. **Always answer callback queries** - Or button shows loading forever
4. **Consider parse_mode** - HTML is often easier than escaping Markdown
5. **Bot can't message first** - User must /start the bot first
6. **Use `reply_to_message_id`** - For threaded conversations
7. **File downloads need two steps** - getFile then download from file_path
