export interface TelegramMessage {
  id: string;
  text: string;
  html: string;
  date: string;
  images: string[];
  videos: string[];
  links: string[];
  channel: string;
}

export interface ScrapedChannel {
  name: string;
  messages: TelegramMessage[];
}

export interface LastProcessed {
  [channelName: string]: string; // channel -> last message ID
}
