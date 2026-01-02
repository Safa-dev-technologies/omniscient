/**
 * Telegram Bot API types
 * Based on https://core.telegram.org/bots/api
 */

/**
 * Incoming webhook payload (Update object)
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

/**
 * Telegram message object
 */
export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number; // Unix timestamp
  text?: string;
  caption?: string; // For media messages

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
  media_group_id?: string;
}

/**
 * Telegram user object
 */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Telegram chat object
 */
export interface TelegramChat {
  id: number; // Can be negative for groups
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string; // For groups/channels
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Telegram photo size
 */
export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

/**
 * Telegram document
 */
export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram audio
 */
export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
  title?: string;
}

/**
 * Telegram video
 */
export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram voice
 */
export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram sticker
 */
export interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  type: 'regular' | 'mask' | 'custom_emoji';
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  emoji?: string;
}

/**
 * Telegram location
 */
export interface TelegramLocation {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number;
}

/**
 * Telegram contact
 */
export interface TelegramContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
}

/**
 * Telegram callback query (button click)
 */
export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  chat_instance: string;
  data?: string; // Callback data from button (max 64 bytes)
}

/**
 * Outgoing message request
 */
export interface TelegramSendMessageRequest {
  chat_id: number | string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  reply_markup?: TelegramReplyMarkup;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
}

/**
 * Reply markup (keyboard)
 */
export interface TelegramReplyMarkup {
  inline_keyboard?: TelegramInlineKeyboardButton[][];
  keyboard?: TelegramKeyboardButton[][];
  remove_keyboard?: boolean;
  one_time_keyboard?: boolean;
  resize_keyboard?: boolean;
}

/**
 * Inline keyboard button
 */
export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string; // Max 64 bytes
  url?: string;
}

/**
 * Keyboard button
 */
export interface TelegramKeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
}

/**
 * Telegram API response wrapper
 */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/**
 * Telegram file object (from getFile)
 */
export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}
