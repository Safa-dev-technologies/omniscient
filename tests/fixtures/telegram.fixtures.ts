import type {
  TelegramUpdate,
  TelegramApiResponse,
  TelegramMessage,
} from '../../src/adapters/telegram/telegram.types.js';

/**
 * Mock Telegram text message
 */
export const mockTelegramTextMessage: TelegramUpdate = {
  update_id: 123456789,
  message: {
    message_id: 100,
    from: {
      id: 987654321,
      is_bot: false,
      first_name: 'John',
      last_name: 'Doe',
      username: 'johndoe',
      language_code: 'en',
    },
    chat: {
      id: 987654321,
      type: 'private',
      first_name: 'John',
      last_name: 'Doe',
      username: 'johndoe',
    },
    date: 1699900000,
    text: 'Hello, I need help',
  },
};

/**
 * Mock Telegram callback query (button click)
 */
export const mockTelegramCallbackQuery: TelegramUpdate = {
  update_id: 123456790,
  callback_query: {
    id: 'callback123',
    from: {
      id: 987654321,
      is_bot: false,
      first_name: 'John',
      last_name: 'Doe',
      username: 'johndoe',
    },
    message: {
      message_id: 100,
      from: {
        id: 123456789,
        is_bot: true,
        first_name: 'TestBot',
      },
      chat: {
        id: 987654321,
        type: 'private',
      },
      date: 1699900000,
      text: 'Choose an option',
    },
    chat_instance: 'chat123',
    data: 'button_clicked',
  },
};

/**
 * Mock Telegram photo message
 */
export const mockTelegramPhotoMessage: TelegramUpdate = {
  update_id: 123456791,
  message: {
    message_id: 101,
    from: {
      id: 987654321,
      is_bot: false,
      first_name: 'John',
    },
    chat: {
      id: 987654321,
      type: 'private',
    },
    date: 1699900000,
    photo: [
      {
        file_id: 'photo_small',
        file_unique_id: 'photo_unique',
        width: 90,
        height: 90,
      },
      {
        file_id: 'photo_large',
        file_unique_id: 'photo_unique_large',
        width: 1280,
        height: 720,
      },
    ],
    caption: 'This is a photo',
  },
};

/**
 * Mock Telegram system message (new chat member)
 */
export const mockTelegramSystemMessage: TelegramUpdate = {
  update_id: 123456792,
  message: {
    message_id: 102,
    from: {
      id: 987654321,
      is_bot: false,
      first_name: 'John',
    },
    chat: {
      id: -1001234567890,
      type: 'group',
      title: 'Test Group',
    },
    date: 1699900000,
    new_chat_members: [
      {
        id: 123456789,
        is_bot: true,
        first_name: 'TestBot',
      },
    ],
  },
};

/**
 * Mock Telegram channel post (should be ignored)
 */
export const mockTelegramChannelPost: TelegramUpdate = {
  update_id: 123456793,
  channel_post: {
    message_id: 103,
    chat: {
      id: -1001234567890,
      type: 'channel',
      title: 'Test Channel',
    },
    date: 1699900000,
    text: 'Channel post',
  },
};

/**
 * Mock successful Telegram API response
 */
export const mockTelegramApiSuccess: TelegramApiResponse<TelegramMessage> = {
  ok: true,
  result: {
    message_id: 100,
    from: {
      id: 123456789,
      is_bot: true,
      first_name: 'TestBot',
    },
    chat: {
      id: 987654321,
      type: 'private',
    },
    date: 1699900000,
    text: 'Hello!',
  },
};

/**
 * Mock Telegram API error response
 */
export const mockTelegramApiError: TelegramApiResponse<never> = {
  ok: false,
  description: 'Invalid bot token',
  error_code: 401,
};

/**
 * Mock Telegram credentials for testing
 */
export const mockTelegramCredentials = {
  botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
  webhookSecret: 'webhook_secret_token',
};
