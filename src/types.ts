export interface TelegramMessage {
  id: string;
  text: string;
  html: string;
  date: string;
  images: string[];
  videos: string[];
  documents: { url: string; title: string; size?: string }[]; // PDFs, files
  links: string[];
  channel: string;
  groupedId?: string | null; // For grouped messages (albums)
}

export interface ScrapedChannel {
  name: string;
  messages: TelegramMessage[];
}

export interface LastProcessed {
  [channelName: string]: string; // channel -> last message ID
}
